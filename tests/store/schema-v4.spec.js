import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GanttStore, SCHEMA_VERSION } from '../../src/host/store.js'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'
import { writeV2Database } from '../helpers/v2.js'

let dir
let store

afterEach(() => {
  store?.close()
  store = undefined
  if (dir) removeTempDir(dir)
  dir = undefined
})

/** Build a v4 database with materialised tracker rows, then downgrade its version to v3. */
function makeV3DatabaseWithMaterialisedRows() {
  dir = makeTempDir('dsh-gantt-v3-')
  const file = path.join(dir, 'tasks.db')
  const first = new GanttStore(file)
  first.replacePlan({
    tracks: [{ id: '1', name: '投资系统', state: '进行' }],
    nodes: [
      { id: '1.1', trackId: '1', title: '数据底座', state: '已过' },
      { id: '1.2', trackId: '1', title: '回测引擎', state: '未开始' },
    ],
  })
  expect(first.count()).toBe(3)
  first.close()
  const db = new DatabaseSync(file)
  db.exec('DELETE FROM tracks; DELETE FROM nodes; PRAGMA user_version = 3')
  db.close()
  return file
}

describe('schema v4', () => {
  it('creates the daily_briefs table and bumps the version for a fresh database', () => {
    store = new GanttStore(':memory:')
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(4)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    const columns = /** @type {{ name: string }[]} */ (store.db.prepare('PRAGMA table_info(daily_briefs)').all()).map(row => row.name)
    expect(columns).toEqual(['plan_date', 'generated_at', 'source', 'report'])
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM daily_briefs').get()).toEqual({ count: 0 })
  })

  it('still backfills a v2 database and creates the brief table', () => {
    dir = makeTempDir('dsh-gantt-v2-to-v4-')
    const file = writeV2Database(path.join(dir, 'tasks.db'))
    store = new GanttStore(file)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(store.count()).toBe(6)
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'daily_briefs'").get()).toEqual({ name: 'daily_briefs' })
  })

  it('does not re-import snapshots when a v3 database only needs the version bump', () => {
    const file = makeV3DatabaseWithMaterialisedRows()
    store = new GanttStore(file)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(store.count()).toBe(3)
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM daily_briefs').get()).toEqual({ count: 0 })
  })

  it('persists brief rows across a reopen', () => {
    dir = makeTempDir('dsh-gantt-briefs-')
    const file = path.join(dir, 'tasks.db')
    store = new GanttStore(file)
    store.create({ title: 'Task' })
    const report = store.computeDailyBrief('2026-11-15', { source: 'manual' })
    store.close()
    store = new GanttStore(file)
    expect(store.dailyBrief('2026-11-15')).toEqual({ report, cached: true })
  })
})
