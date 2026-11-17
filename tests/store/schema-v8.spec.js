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

/** Columns of one table, in declaration order. */
function columns(db, table) {
  return /** @type {{ name: string }[]} */ (db.prepare(`PRAGMA table_info(${table})`).all()).map(row => row.name)
}

/** Rewind a v8 database to the v7 shape: no agent table and no agent columns. */
function downgradeToV7(file) {
  const db = new DatabaseSync(file)
  db.exec('DROP TABLE agents')
  db.exec('ALTER TABLE tasks DROP COLUMN operator_id')
  db.exec('ALTER TABLE tasks DROP COLUMN completed_by_id')
  db.exec('ALTER TABLE tasks DROP COLUMN report')
  db.exec('PRAGMA user_version = 7')
  db.close()
}

describe('schema v8', () => {
  it('adds the operator, completer, and report columns and the agents table', () => {
    store = new GanttStore(':memory:')
    expect(SCHEMA_VERSION).toBe(8)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(columns(store.db, 'tasks')).toEqual(expect.arrayContaining(['operator_id', 'completed_by_id', 'report']))
    expect(columns(store.db, 'agents')).toEqual([
      'id', 'name', 'type', 'role', 'description', 'details', 'endpoint', 'created_at', 'updated_at',
    ])
    const index = /** @type {{ sql: string } | undefined} */ (
      store.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_agents_name'").get()
    )
    expect(index?.sql).toContain('UNIQUE INDEX')
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM agents').get()).toEqual({ count: 0 })
  })

  it('enforces the agent type vocabulary and the unique name', () => {
    store = new GanttStore(':memory:')
    store.registerAgent({ name: 'Codex', type: 'ai-agent' })
    expect(() => store.db.prepare(
      "INSERT INTO agents (id, name, type, created_at, updated_at) VALUES ('bad-type', 'Bad', 'robot', '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z')",
    ).run()).toThrow()
    expect(() => store.db.prepare(
      "INSERT INTO agents (id, name, type, created_at, updated_at) VALUES ('bad-name', 'Codex', 'human', '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z')",
    ).run()).toThrow()
  })

  it('upgrades a v7 database without losing its tasks', () => {
    dir = makeTempDir('dsh-gantt-v7-to-v8-')
    const file = path.join(dir, 'tasks.db')
    store = new GanttStore(file)
    const parent = store.create({ title: 'Parent', kind: 'track', ref: 'track:9' })
    const child = store.create({ title: 'Existing task', parentId: parent.id })
    store.update(child.id, { status: 'done' })
    store.close()

    downgradeToV7(file)

    store = new GanttStore(file)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 })
    expect(columns(store.db, 'tasks')).toEqual(expect.arrayContaining(['operator_id', 'completed_by_id', 'report']))
    expect(columns(store.db, 'agents')).toHaveLength(9)
    expect(store.count()).toBe(2)
    expect(store.getRow(child.id)).toMatchObject({
      title: 'Existing task',
      status: 'done',
      operatorId: '',
      completedById: '',
      report: '',
    })
    expect(store.listAgents()).toEqual([])
    expect(store.registerAgent({ name: 'Codex', type: 'ai-agent' })).toMatchObject({ name: 'Codex', type: 'ai-agent' })
  })
})
