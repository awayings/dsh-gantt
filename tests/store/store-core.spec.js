import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttError, GanttStore, SCHEMA_VERSION, STATUSES, todayIso } from '../../src/host/store.js'
import { expectGanttError, makeTempDir, removeTempDir } from '../helpers/gantt.js'

let store
let tempDir

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
  if (tempDir) {
    removeTempDir(tempDir)
    tempDir = undefined
  }
})

function insertRaw(overrides) {
  const now = new Date().toISOString()
  const row = {
    id: 'raw',
    parent_id: null,
    title: 'Raw',
    description: '',
    status: 'todo',
    progress: 0,
    start_date: '2024-01-01',
    end_date: '2024-01-03',
    sort_order: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
  store.db.prepare(`
    INSERT INTO tasks (id, parent_id, title, description, status, progress,
                       start_date, end_date, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.parent_id, row.title, row.description, row.status, row.progress,
    row.start_date, row.end_date, row.sort_order, row.created_at, row.updated_at,
  )
  return row.id
}

describe('GanttStore construction', () => {
  it('opens an in-memory database with the expected schema', () => {
    expect(store.file).toBe(':memory:')
    expect(store.db).toBeDefined()
    expect(store.count()).toBe(0)
    const version = store.db.prepare('PRAGMA user_version').get()
    expect(version.user_version).toBe(SCHEMA_VERSION)
    const journal = store.db.prepare('PRAGMA journal_mode').get()
    expect(journal.journal_mode).toBe('memory')
  })

  it('is safe to close twice', () => {
    store.close()
    expect(() => store.close()).not.toThrow()
    store = undefined
  })
})

describe('count fallback', () => {
  it('falls back to zero when the aggregate query yields no row', () => {
    const fakeDb = /** @type {any} */ ({ prepare: () => ({ get: () => undefined }) })
    const original = store.db
    store.db = fakeDb
    try {
      expect(store.count()).toBe(0)
    } finally {
      store.db = original
    }
  })
})

describe('meta and snapshot', () => {
  it('describes an in-memory database', () => {
    expect(store.meta()).toEqual({
      dbPath: ':memory:',
      statuses: [...STATUSES],
      schemaVersion: SCHEMA_VERSION,
      taskCount: 0,
      engine: 'node:sqlite',
      kinds: ['track', 'node', 'task'],
      linkTypes: ['memory', 'file', 'url', 'task', 'note'],
    })
  })

  it('resolves a file-backed database path in meta', () => {
    tempDir = makeTempDir()
    const file = path.join(tempDir, 'gantt.db')
    const fileStore = new GanttStore(file)
    try {
      expect(fileStore.meta().dbPath).toBe(path.resolve(file))
      expect(fs.existsSync(file)).toBe(true)
    } finally {
      fileStore.close()
    }
  })

  it('returns an empty snapshot with the status vocabulary and zeroed stats', () => {
    expect(store.snapshot()).toEqual({
      today: todayIso(),
      statuses: [...STATUSES],
      tasks: [],
      stats: {
        total: 0,
        done: 0,
        inProgress: 0,
        blocked: 0,
        cancelled: 0,
        overdue: 0,
        progress: 0,
      },
      brief: { pending: 0, frontier: [], next: [], lanes: [] },
      dailyBrief: {
        date: todayIso(),
        generatedAt: expect.any(String),
        source: 'auto',
        dayKind: 'unknown',
        slots: [],
        items: [],
        tracks: [],
        unfilled: [],
        notes: ['no plan blocks; no template for unknown day kind'],
      },
    })
  })

  it('returns a snapshot with the nested tree and stats', () => {
    store.create({ title: 'Root', startDate: '2024-01-01', endDate: '2024-01-31' })
    const child = store.create({ title: 'Child', parentId: store.tree()[0].id, status: 'done' })
    const snapshot = store.snapshot()
    expect(snapshot.today).toBe(todayIso())
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0].children[0].id).toBe(child.id)
    expect(snapshot.stats.total).toBe(2)
    expect(snapshot.stats.done).toBe(2)
    expect(snapshot.brief.pending).toBe(0)
    expect(snapshot.brief.lanes).toEqual([])
  })
})

describe('row access', () => {
  it('maps database columns to camelCase rows and nodes', () => {
    insertRaw({ id: 'root', title: 'Root' })
    insertRaw({ id: 'child', parent_id: 'root', title: 'Child', sort_order: 1 })
    const row = store.getRow('root')
    expect(row).toEqual({
      id: 'root',
      parentId: null,
      title: 'Root',
      description: '',
      status: 'todo',
      progress: 0,
      startDate: '2024-01-01',
      endDate: '2024-01-03',
      sortOrder: 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      kind: 'task',
      ref: '',
      state: '',
      lane: '',
      dep: '',
      doneWhen: '',
      landing: '',
      estimate: '',
      category: '',
      inspiration: '',
      links: [],
      source: 'manual',
      workSessionId: null,
    })
    expect(store.getRow('child').parentId).toBe('root')
    expect(store.getRow('missing')).toBeNull()
    expect(store.getNode('root').number).toBe('1')
    expect(store.getNode('child').number).toBe('1.1')
    expect(store.getNode('missing')).toBeNull()
    expect(store.listRows()).toHaveLength(2)
    const idOf = store.listRows().map(item => item.id)
    expect(idOf).toEqual(['root', 'child'])
  })

  it('requires a non-empty id and reports missing tasks as 404', () => {
    expectGanttError(() => store.requireRow(undefined), 'id is required')
    expectGanttError(() => store.requireRow(''), 'id is required')
    expectGanttError(() => store.requireRow(7), 'id is required')
    expectGanttError(() => store.requireRow('ghost'), 'task ghost was not found', 404)
  })
})

describe('transaction', () => {
  it('commits and returns the callback result', () => {
    const result = store.transaction(() => {
      insertRaw({ id: 'inside' })
      return 'returned'
    })
    expect(result).toBe('returned')
    expect(store.count()).toBe(1)
  })

  it('rolls back every write when the callback throws', () => {
    const failure = new Error('callback failed')
    expect(() => store.transaction(() => {
      insertRaw({ id: 'doomed' })
      throw failure
    })).toThrow(failure)
    expect(store.count()).toBe(0)
  })

  it('keeps the original error when the rollback itself fails', () => {
    const broken = new GanttStore(':memory:')
    const failure = new Error('original failure')
    expect(() => broken.transaction(() => {
      broken.db.close()
      throw failure
    })).toThrow(failure)
    expect(() => broken.close()).not.toThrow()
  })
})

describe('nextSortOrder', () => {
  it('starts at zero for an empty parent group', () => {
    expect(store.nextSortOrder(null)).toBe(0)
    expect(store.nextSortOrder('unknown-parent')).toBe(0)
  })

  it('appends after the highest sibling order', () => {
    const first = store.create({ title: 'First root' })
    const second = store.create({ title: 'Second root' })
    expect(first.sortOrder).toBe(0)
    expect(second.sortOrder).toBe(1)
    expect(store.nextSortOrder(null)).toBe(2)
    store.create({ title: 'Child one', parentId: first.id })
    expect(store.nextSortOrder(first.id)).toBe(1)
  })
})

describe('isDescendant', () => {
  it('walks the parent chain', () => {
    const root = store.create({ title: 'Root' })
    const child = store.create({ title: 'Child', parentId: root.id })
    const grandchild = store.create({ title: 'Grandchild', parentId: child.id })
    expect(store.isDescendant(child.id, root.id)).toBe(true)
    expect(store.isDescendant(grandchild.id, root.id)).toBe(true)
    expect(store.isDescendant(grandchild.id, child.id)).toBe(true)
    expect(store.isDescendant(root.id, child.id)).toBe(false)
    expect(store.isDescendant('missing', root.id)).toBe(false)
  })

  it('stops walking a corrupted parent cycle', () => {
    insertRaw({ id: 'a' })
    insertRaw({ id: 'b', parent_id: 'a' })
    store.db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run('b', 'a')
    expect(store.isDescendant('a', 'not-in-the-tree')).toBe(true)
  })
})

describe('recomputeAncestors', () => {
  it('rolls a changed subtree up through every ancestor', () => {
    const root = store.create({ title: 'Root', startDate: '2024-01-01', endDate: '2024-01-31' })
    const middle = store.create({ title: 'Middle', parentId: root.id, startDate: '2024-01-02', endDate: '2024-01-20' })
    const leaf = store.create({ title: 'Leaf', parentId: middle.id, startDate: '2024-01-03', endDate: '2024-01-10' })
    store.db.prepare(`
      UPDATE tasks SET status = 'done', progress = 100, start_date = '2024-02-01',
                       end_date = '2024-02-28' WHERE id = ?
    `).run(leaf.id)
    store.recomputeAncestors(middle.id)
    const updatedMiddle = store.getRow(middle.id)
    expect(updatedMiddle.startDate).toBe('2024-02-01')
    expect(updatedMiddle.endDate).toBe('2024-02-28')
    expect(updatedMiddle.progress).toBe(100)
    expect(updatedMiddle.status).toBe('done')
    const updatedRoot = store.getRow(root.id)
    expect(updatedRoot.startDate).toBe('2024-02-01')
    expect(updatedRoot.progress).toBe(100)
    expect(updatedRoot.status).toBe('done')
  })

  it('picks the earliest start and latest end across siblings', () => {
    const parent = store.create({ title: 'Parent', startDate: '2024-03-01', endDate: '2024-03-02' })
    store.create({ title: 'Later', parentId: parent.id, startDate: '2024-03-10', endDate: '2024-03-20' })
    store.create({ title: 'Earlier', parentId: parent.id, startDate: '2024-02-01', endDate: '2024-03-15' })
    store.create({ title: 'Latest end', parentId: parent.id, startDate: '2024-03-05', endDate: '2024-03-25' })
    const row = store.getRow(parent.id)
    expect(row.startDate).toBe('2024-02-01')
    expect(row.endDate).toBe('2024-03-25')
  })

  it('skips rows without children and stops on a missing row', () => {
    const root = store.create({ title: 'Root' })
    const leaf = store.create({ title: 'Leaf', parentId: root.id })
    const before = store.getRow(leaf.id)
    store.recomputeAncestors(leaf.id)
    expect(store.getRow(leaf.id).updatedAt).toBe(before.updatedAt)
    expect(() => store.recomputeAncestors('missing-id')).not.toThrow()
  })

  it('breaks out of a corrupted parent cycle', () => {
    insertRaw({ id: 'a', start_date: '2024-01-01', end_date: '2024-01-02' })
    insertRaw({ id: 'b', parent_id: 'a', start_date: '2024-01-03', end_date: '2024-01-04' })
    store.db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run('b', 'a')
    expect(() => store.recomputeAncestors('a')).not.toThrow()
    expect(store.getRow('a').startDate).toBe('2024-01-03')
    expect(store.getRow('b').startDate).toBe('2024-01-03')
  })
})

describe('GanttError', () => {
  it('carries an HTTP-friendly status and name', () => {
    const defaulted = new GanttError('bad input')
    expect(defaulted.name).toBe('GanttError')
    expect(defaulted.status).toBe(400)
    expect(defaulted).toBeInstanceOf(Error)
    const notFound = new GanttError('nope', 404)
    expect(notFound.status).toBe(404)
  })
})
