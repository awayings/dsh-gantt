import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GanttStore, SCHEMA_VERSION } from '../../src/host/store.js'
import { migrateDatabase, openDatabase } from '../../src/host/store/db.js'
import { downgradeToV7, makeTempDir, removeTempDir } from '../helpers/gantt.js'

let dir
/** @type {import('node:child_process').ChildProcess[]} */
const children = []

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
  if (dir) removeTempDir(dir)
  dir = undefined
})

/** Run `fn` inside `BEGIN IMMEDIATE` the way GanttStore#transaction does. */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    fn()
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // keep the original error
    }
    throw error
  }
}

/**
 * Start a process that holds the write lock, applies the v8 migration, and
 * commits only after this process has had time to block on the lock.
 * @param {string} file
 */
async function migrateFromAnotherProcess(file) {
  const script = `
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(${JSON.stringify(file)})
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('BEGIN IMMEDIATE')
    process.stdout.write('locked\\n')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150)
    db.exec("ALTER TABLE tasks ADD COLUMN operator_id TEXT NOT NULL DEFAULT ''")
    db.exec("ALTER TABLE tasks ADD COLUMN completed_by_id TEXT NOT NULL DEFAULT ''")
    db.exec("ALTER TABLE tasks ADD COLUMN report TEXT NOT NULL DEFAULT ''")
    db.exec('PRAGMA user_version = ${SCHEMA_VERSION}')
    db.exec('COMMIT')
    db.close()
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] })
  children.push(child)
  await once(child.stdout, 'data')
  return child
}

/** Columns of one table, in declaration order. */
function columns(db, table) {
  return /** @type {{ name: string }[]} */ (db.prepare(`PRAGMA table_info(${table})`).all()).map(row => row.name)
}

describe('migration against a concurrent first start', () => {
  it('does not re-apply a migration another process committed while this one waited for the lock', async () => {
    dir = makeTempDir('dsh-gantt-migration-race-')
    const file = path.join(dir, 'tasks.db')
    const seed = new GanttStore(file)
    seed.create({ title: 'Existing' })
    seed.close()
    downgradeToV7(file)

    const db = openDatabase(file)
    const child = await migrateFromAnotherProcess(file)

    expect(() => migrateDatabase(db, fn => transaction(db, fn), () => {})).not.toThrow()

    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(columns(db, 'tasks')).toEqual(expect.arrayContaining(['operator_id', 'completed_by_id', 'report']))
    expect(db.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 1 })
    db.close()
    const [code] = await once(child, 'close')
    expect(code).toBe(0)
  })
})
