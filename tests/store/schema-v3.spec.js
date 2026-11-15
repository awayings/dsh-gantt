// Schema v3 migration evidence: a fresh store, a v1-shaped empty database, and a
// sanitised copy of the live v2 database (6 tracks / 48 nodes / 27 blocks / 9 days).
// The live copy is never opened in place: every test works on a temp file copy.
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { GanttStore, SCHEMA_VERSION } from '../../store.js'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'
import { V2_BLOCK_ID, V2_NODES, V2_TRACKS, writeV2Database } from '../helpers/v2.js'
const V1_TASKS = `CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  progress INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`

let dir
let store

afterEach(() => {
  store?.close()
  store = undefined
  if (dir) removeTempDir(dir)
  dir = undefined
})

/** Create an empty on-disk database in the v1 shape and return its path. */
function makeV1Database(version) {
  dir = makeTempDir('dsh-gantt-v1-')
  const file = path.join(dir, 'tasks.db')
  const db = new DatabaseSync(file)
  db.exec(`${V1_TASKS}; INSERT INTO tasks (id, title, start_date, end_date, created_at, updated_at)
    VALUES ('legacy', 'Legacy task', '2024-01-01', '2024-01-02', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
    PRAGMA user_version = ${version}`)
  db.close()
  return file
}

/** Write the deterministic v2 schema fixture to a temp path. */
function makeV2Database() {
  dir = makeTempDir('dsh-gantt-v2-')
  return writeV2Database(path.join(dir, 'tasks.db'))
}

/** @param {GanttStore} target @returns {Map<string, import('../../store.js').TaskNode>} */
function nodesByRef(target) {
  const flat = []
  const walk = (node) => {
    flat.push(node)
    node.children.forEach(walk)
  }
  target.tree().forEach(walk)
  return new Map(flat.map(node => [node.ref, node]))
}

/** @param {GanttStore} target @param {string} ref */
function storedRow(target, ref) {
  return /** @type {any} */ (target.db.prepare('SELECT kind, ref, state, status, progress, source FROM tasks WHERE ref = ?').get(ref))
}

describe('fresh database', () => {
  it('starts at schema v3 with the twelve task columns and the unique ref index', () => {
    store = new GanttStore(':memory:')
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(SCHEMA_VERSION).toBe(3)
    const columns = /** @type {{ name: string }[]} */ (store.db.prepare('PRAGMA table_info(tasks)').all()).map(row => row.name)
    expect(columns).toEqual(expect.arrayContaining([
      'kind', 'ref', 'state', 'lane', 'dep', 'done_when', 'landing', 'estimate', 'category', 'inspiration', 'links', 'source',
    ]))
    const index = /** @type {{ sql: string } | undefined} */ (
      store.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_tasks_ref'").get()
    )
    expect(index?.sql).toContain("WHERE ref <> ''")
    const task = store.create({ title: 'Manual' })
    expect(task).toMatchObject({ kind: 'task', ref: '', state: '', source: 'manual', links: [] })
  })
})

describe('v1-shaped empty database', () => {
  it('adds the new columns, sets v3, and keeps the existing rows usable', () => {
    const file = makeV1Database(1)
    store = new GanttStore(file)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 })
    const legacy = store.getRow('legacy')
    expect(legacy).toMatchObject({ title: 'Legacy task', kind: 'task', ref: '', source: 'manual', links: [] })
    expect(store.create({ title: 'After migration' }).number).toBe('2')
  })

  it('repairs missing columns even when the version already says v3', () => {
    const file = makeV1Database(3)
    store = new GanttStore(file)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 })
    expect(store.getRow('legacy').kind).toBe('task')
    expect(store.count()).toBe(1)
  })
})

describe('v2 database fixture', () => {
  it('migrates a v2 snapshot into the unified tree: 2 roots and 4 nodes', () => {
    store = new GanttStore(makeV2Database())
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 })
    const snapshot = store.snapshot()
    expect(snapshot.tasks).toHaveLength(2)
    expect(snapshot.tasks.map(node => node.ref)).toEqual(['track:1', 'track:2'])
    const nodes = nodesByRef(store)
    expect([...nodes.values()].filter(node => node.kind === 'node')).toHaveLength(V2_NODES.length)
    expect(store.count()).toBe(V2_TRACKS.length + V2_NODES.length)
    expect(snapshot.brief.pending).toBe(2)
    expect(snapshot.brief.lanes).toHaveLength(2)
    expect(snapshot.brief.frontier.map(entry => entry.ref)).toEqual(['node:1.8.1', 'node:2.1'])
    expect(snapshot.brief.next.map(entry => entry.ref)).toEqual(['node:1.8.1', 'node:2.1'])
  })

  it('nests node 1.8.1 under 1.8 under track 1 and inherits the track lane', () => {
    store = new GanttStore(makeV2Database())
    const nodes = nodesByRef(store)
    const child = nodes.get('node:1.8.1')
    const parent = nodes.get('node:1.8')
    const track = nodes.get('track:1')
    expect(child?.parentId).toBe(parent?.id)
    expect(parent?.parentId).toBe(track?.id)
    expect(child).toMatchObject({
      kind: 'node',
      lane: '赚钱',
      title: 'S2 每日交易仓读数',
      startDate: '2026-11-09',
      endDate: '2026-11-15',
      doneWhen: '每天一句读数',
    })
  })

  it('maps every fixture state word to a status and normalises the stored state', () => {
    store = new GanttStore(makeV2Database())
    expect(storedRow(store, 'node:1.1')).toMatchObject({ state: '已过', status: 'done', progress: 100 })
    expect(storedRow(store, 'node:1.8.1')).toMatchObject({ state: '未开始', status: 'todo', progress: 0 })
    expect(storedRow(store, 'node:2.1')).toMatchObject({ state: '卡住', status: 'blocked', progress: 0 })
    expect(storedRow(store, 'track:1')).toMatchObject({ state: '进行', status: 'in_progress', progress: 50 })
    expect(storedRow(store, 'track:2')).toMatchObject({ state: '卡住', status: 'blocked', progress: 0 })
  })

  it('keeps the parent tracker state in the read-time rollup', () => {
    store = new GanttStore(makeV2Database())
    const nodes = nodesByRef(store)
    expect(nodes.get('track:1')?.status).toBe('in_progress')
    expect(nodes.get('track:2')?.status).toBe('blocked')
    expect(nodes.get('node:1.8')?.status).toBe('in_progress')
    expect(nodes.get('node:1.8.1')?.status).toBe('todo')
  })

  it('preserves the imported plan block and day row across the migration', () => {
    store = new GanttStore(makeV2Database())
    const bundle = store.dayPlan('2026-11-15')
    expect(bundle.day).toEqual({ date: '2026-11-15', weekday: '周日', dayKind: 'weekend', marketOpen: false, label: '周末（休市）', coreGoal: '收表', source: 'schedule' })
    expect(bundle.blocks.map(block => block.id)).toEqual([V2_BLOCK_ID])
    expect(bundle.tracks.map(track => track.ref)).toEqual(['track:1', 'track:2'])
    expect(bundle.tracks.every(track => track.priority === '')).toBe(true)
  })

  it('backfills track dates from its nodes and keeps the imported sort order', () => {
    store = new GanttStore(makeV2Database())
    const nodes = nodesByRef(store)
    expect(nodes.get('track:1')?.startDate).toBe('2026-07-01')
    expect(nodes.get('track:1')?.endDate).toBe('2026-11-15')
    expect(nodes.get('track:1')?.sortOrder).toBe(0)
    expect(nodes.get('track:2')?.sortOrder).toBe(1)
  })

  it('reopening and re-importing are idempotent: same rows, no duplicates', () => {
    const file = makeV2Database()
    store = new GanttStore(file)
    const before = /** @type {{ ref: string }[]} */ (store.db.prepare('SELECT ref FROM tasks ORDER BY ref').all()).map(row => row.ref)
    store.close()
    store = new GanttStore(file)
    const after = /** @type {{ ref: string }[]} */ (store.db.prepare('SELECT ref FROM tasks ORDER BY ref').all()).map(row => row.ref)
    expect(after).toEqual(before)
    expect(store.count()).toBe(6)
    const tracks = /** @type {import('../../store.js').SnapshotTrack[]} */ (
      store.db.prepare('SELECT id, name, lane, state, blocker, sort_order AS sortOrder FROM tracks ORDER BY sort_order, id').all()
    )
    const nodes = /** @type {import('../../store.js').SnapshotNode[]} */ (
      store.db.prepare('SELECT id, track_id AS trackId, title, state, start_date AS startDate, end_date AS endDate, dep, done_when AS doneWhen FROM nodes ORDER BY id').all()
    )
    const counts = store.replacePlan({ tracks, nodes })
    expect(counts.tasks).toEqual({ inserted: 0, updated: 6, removed: 0 })
    expect(store.count()).toBe(6)
    expect(store.db.prepare('SELECT COUNT(DISTINCT kind || ref) AS value FROM tasks').get()).toEqual({ value: 6 })
  })
})
