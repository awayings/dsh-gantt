import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { GanttStore, SCHEMA_VERSION } from '../../src/host/store.js'
import { parseTagsJson } from '../../src/host/store/tasks.js'
import { downgradeToV7, downgradeToV8, makeTempDir, removeTempDir } from '../helpers/gantt.js'

let dir
let store

afterEach(() => {
  store?.close()
  store = undefined
  if (dir) removeTempDir(dir)
  dir = undefined
})

/** Columns of the tasks table, in declaration order. */
function columns(db) {
  return /** @type {{ name: string }[]} */ (db.prepare('PRAGMA table_info(tasks)').all()).map(row => row.name)
}

describe('schema v9', () => {
  it('creates the tags column with an empty JSON array default', () => {
    store = new GanttStore(':memory:')
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(columns(store.db)).toContain('tags')
    const tagsColumn = store.db.prepare("SELECT dflt_value FROM pragma_table_info('tasks') WHERE name = 'tags'").get()
    expect(tagsColumn).toEqual({ dflt_value: "'[]'" })
    const task = store.create({ title: 'Plain' })
    expect(task.tags).toEqual([])
    expect(store.db.prepare('SELECT tags FROM tasks WHERE id = ?').get(task.id)).toEqual({ tags: '[]' })
  })

  it('upgrades a v8 database in place without losing its tasks', () => {
    dir = makeTempDir('dsh-gantt-v8-to-v9-')
    const file = path.join(dir, 'tasks.db')
    store = new GanttStore(file)
    const tagged = store.create({ title: 'Tagged', tags: ['alpha', 'beta'] })
    const plain = store.create({ title: 'Plain' })
    store.close()
    store = undefined

    downgradeToV8(file)
    const downgraded = new DatabaseSync(file)
    expect(columns(downgraded)).not.toContain('tags')
    expect(downgraded.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 })
    downgraded.close()

    store = new GanttStore(file)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(columns(store.db)).toContain('tags')
    expect(store.count()).toBe(2)
    expect(store.getRow(tagged.id)).toMatchObject({ title: 'Tagged', status: 'todo', tags: [] })
    expect(store.getNode(plain.id).tags).toEqual([])
  })

  it('upgrades a v7 database through the status rebuild with the tags column', () => {
    dir = makeTempDir('dsh-gantt-v7-to-v9-')
    const file = path.join(dir, 'tasks.db')
    store = new GanttStore(file)
    const parent = store.create({ title: 'Parent', kind: 'track', ref: 'track:9' })
    const child = store.create({ title: 'Existing task', parentId: parent.id })
    store.close()
    store = undefined

    downgradeToV7(file)

    store = new GanttStore(file)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(columns(store.db)).toContain('tags')
    expect(store.count()).toBe(2)
    expect(store.getRow(child.id)).toMatchObject({ title: 'Existing task', tags: [] })
  })

  it('degrades corrupt or legacy tags JSON to an empty array', () => {
    store = new GanttStore(':memory:')
    const task = store.create({ title: 'Corrupt' })
    for (const raw of ['{oops', '{}', 'null', '"text"', '[]']) {
      store.db.prepare('UPDATE tasks SET tags = ? WHERE id = ?').run(raw, task.id)
      expect(store.getRow(task.id).tags).toEqual([])
    }
    store.db.prepare('UPDATE tasks SET tags = ? WHERE id = ?').run('["a",7,"b"]', task.id)
    expect(store.getRow(task.id).tags).toEqual(['a', 'b'])
  })
})

describe('parseTagsJson', () => {
  it('tolerates non-JSON values and returns only string entries', () => {
    expect(parseTagsJson(undefined)).toEqual([])
    expect(parseTagsJson(null)).toEqual([])
    expect(parseTagsJson('')).toEqual([])
    expect(parseTagsJson('not json')).toEqual([])
    expect(parseTagsJson('{"a":1}')).toEqual([])
    expect(parseTagsJson('["a","b"]')).toEqual(['a', 'b'])
  })
})
