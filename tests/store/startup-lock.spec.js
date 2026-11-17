import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/host/store/db.js'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'

let dir
/** @type {import('node:child_process').ChildProcess[]} */
const children = []

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
  if (dir) removeTempDir(dir)
  dir = undefined
})

/**
 * Start a process that holds an exclusive write lock on `file` for `holdMs`.
 * @param {string} file
 * @param {number} holdMs
 * @returns {Promise<import('node:child_process').ChildProcess>} resolves once the lock is held
 */
async function holdWriteLock(file, holdMs) {
  const script = `
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(${JSON.stringify(file)})
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('BEGIN EXCLUSIVE')
    process.stdout.write('locked\\n')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${holdMs})
    db.exec('COMMIT')
    db.close()
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'ignore'] })
  children.push(child)
  await once(child.stdout, 'data')
  return child
}

/** A file backed by a plain rollback-journal database, the state before WAL. */
function seedFile(name) {
  dir = makeTempDir(name)
  const file = path.join(dir, 'tasks.db')
  const seed = new DatabaseSync(file)
  seed.exec('CREATE TABLE seed (id INTEGER)')
  seed.close()
  return file
}

describe('opening a database that someone else is writing', () => {
  it('waits out a concurrent writer before switching a fresh file to WAL', async () => {
    const file = seedFile('dsh-gantt-wal-wait-')
    const child = await holdWriteLock(file, 300)

    const db = openDatabase(file)
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    db.close()
    await once(child, 'close')
  })

  it('gives up when the write lock outlives the wait', async () => {
    const file = seedFile('dsh-gantt-wal-timeout-')
    await holdWriteLock(file, 400)

    expect(() => openDatabase(file, 100)).toThrow(/database is locked/)
  })
})
