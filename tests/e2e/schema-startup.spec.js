// Concurrent first starts: after an upgrade the Web UI (`dsh web`), the MCP
// sidecar (`gantt-mcp`) and a one-shot CLI client can open the same SQLite file
// at the same moment. Each child process runs the real store against the real
// file, so the migration lock and the schema bootstrap are proved across
// process boundaries rather than only inside one connection.
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { GanttStore, SCHEMA_VERSION } from '../../src/host/store.js'
import { downgradeToV7, makeTempDir, removeTempDir } from '../helpers/gantt.js'

const storeUrl = pathToFileURL(path.resolve(import.meta.dirname, '../../src/host/store.js')).href

let dir

afterEach(() => {
  if (dir) removeTempDir(dir)
  dir = undefined
})

/**
 * Open the store in a fresh Node process, create one task, and close.
 * @param {string} file
 * @param {string} title
 * @param {number} startAt shared wall-clock start, so the processes collide
 * @returns {Promise<{ code: number | null, stderr: string }>}
 */
function openInChild(file, title, startAt) {
  const script = `
    const { GanttStore } = await import(${JSON.stringify(storeUrl)})
    const wait = ${startAt} - Date.now()
    if (wait > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait)
    const store = new GanttStore(${JSON.stringify(file)})
    store.create({ title: ${JSON.stringify(title)} })
    store.close()
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  return /** @type {Promise<{ code: number | null, stderr: string }>} */ (new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => resolve({ code, stderr }))
  }))
}

/** @param {string[]} titles */
async function startTogether(file, titles) {
  const startAt = Date.now() + 800
  const results = await Promise.all(titles.map(title => openInChild(file, title, startAt)))
  for (const result of results) expect(result.code, result.stderr).toBe(0)
  return results
}

describe('schema startup under concurrency', () => {
  it('migrates a v7 database once when three processes start together', async () => {
    dir = makeTempDir('dsh-gantt-concurrent-migrate-')
    const file = path.join(dir, 'tasks.db')
    const seed = new GanttStore(file)
    seed.create({ title: 'Existing' })
    seed.close()
    downgradeToV7(file)

    await startTogether(file, ['A', 'B', 'C'])

    const db = new DatabaseSync(file)
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(db.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 4 })
    const titles = /** @type {{ title: string }[]} */ (db.prepare('SELECT title FROM tasks ORDER BY title').all()).map(row => row.title)
    expect(titles).toEqual(['A', 'B', 'C', 'Existing'])
    db.close()
  })

  it('creates the schema once when three processes start on a fresh file', async () => {
    dir = makeTempDir('dsh-gantt-concurrent-create-')
    const file = path.join(dir, 'tasks.db')

    await startTogether(file, ['A', 'B', 'C'])

    const db = new DatabaseSync(file)
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(db.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 3 })
    db.close()
  })
})
