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

/** Columns of the tasks table, in declaration order. */
function columns(db) {
  return /** @type {{ name: string }[]} */ (db.prepare('PRAGMA table_info(tasks)').all()).map(row => row.name)
}

describe('schema version contract', () => {
  it('refuses a database written by a newer build', () => {
    dir = makeTempDir('dsh-gantt-newer-schema-')
    const file = path.join(dir, 'tasks.db')
    store = new GanttStore(file)
    store.close()
    store = undefined
    const newer = new DatabaseSync(file)
    newer.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    newer.close()

    expect(() => new GanttStore(file)).toThrow(
      `refusing to open ${file}: schema v${SCHEMA_VERSION + 1} is newer than this build supports (v${SCHEMA_VERSION}); run the same release for the plugin and gantt-mcp`,
    )

    const untouched = new DatabaseSync(file)
    expect(untouched.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION + 1 })
    untouched.close()
  })

  it('restores a column that a database claiming the current version has lost', () => {
    dir = makeTempDir('dsh-gantt-schema-repair-')
    const file = path.join(dir, 'tasks.db')
    store = new GanttStore(file)
    store.close()
    store = undefined
    const damaged = new DatabaseSync(file)
    damaged.exec('ALTER TABLE tasks DROP COLUMN report')
    damaged.close()

    store = new GanttStore(file)
    expect(columns(store.db)).toContain('report')
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
  })
})
