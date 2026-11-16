import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GanttStore, SCHEMA_VERSION } from '../../src/host/store.js'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'

let dir
let store

afterEach(() => {
  store?.close()
  store = undefined
  if (dir) removeTempDir(dir)
  dir = undefined
})

describe('schema v5', () => {
  it('creates the trajectory table and bumps the version for a fresh database', () => {
    store = new GanttStore(':memory:')
    expect(SCHEMA_VERSION).toBe(5)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    const columns = /** @type {{ name: string }[]} */ (store.db.prepare('PRAGMA table_info(task_events)').all()).map(row => row.name)
    expect(columns).toEqual(['id', 'task_id', 'session_id', 'turn', 'action', 'detail', 'created_at'])
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM task_events').get()).toEqual({ count: 0 })
    const indexes = /** @type {{ name: string }[]} */ (store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'task_events' AND name LIKE 'idx_%'").all()).map(row => row.name)
    expect(indexes.sort()).toEqual(['idx_task_events_session', 'idx_task_events_task'])
  })

  it('adds the trajectory table when a v4 database is reopened without a backfill', () => {
    dir = makeTempDir('dsh-gantt-v4-to-v5-')
    const file = path.join(dir, 'tasks.db')
    store = new GanttStore(file)
    const task = store.create({ title: 'Existing task' })
    store.close()
    const db = new DatabaseSync(file)
    db.exec('DROP TABLE task_events; PRAGMA user_version = 4')
    db.close()
    store = new GanttStore(file)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(store.count()).toBe(1)
    expect(store.getRow(/** @type {string} */ (task?.id))?.title).toBe('Existing task')
    expect(store.trajectory()).toEqual([])
  })
})
