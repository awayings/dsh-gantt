// End-to-end: the shipped client artifact against the shipped host half.
//
// Everything here crosses a real seam — the browser module-loader contract, a
// relative `fetch`, node:http, the registered route handler, and a real SQLite
// file. That is the layer the unit suites cannot reach: they stub fetch and use
// an in-memory database. Keep this suite small and behavioral; exhaustive cases
// belong in tests/store, tests/host, and tests/client.
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installFetch, startServer } from './server.js'
import {
  buttonByText,
  click,
  mount,
  q,
  qa,
  row,
  setField,
  setupApp,
  text,
  unmountAll,
} from '../client/harness.js'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'
import path from 'node:path'

const TREE = '/api/gantt/tree'
const TASKS = '/api/gantt/tasks'
const SEEDED = 13

let dir
let dbPath
let server
let restoreFetch
let app
let view

/**
 * Wait for a condition, letting React flush between attempts.
 *
 * The page talks to a real server, so the settle time is real too: poll instead
 * of assuming one macrotask is enough. Every wait happens inside act() so state
 * updates from the network response are flushed as part of the wait.
 * @param {() => unknown} check
 * @param {{ timeout?: number, label?: string }} [options]
 * @returns {Promise<unknown>}
 */
async function waitFor(check, options = {}) {
  const timeout = options.timeout ?? 10_000
  const label = options.label ?? 'condition'
  const deadline = Date.now() + timeout
  for (;;) {
    let value
    try {
      value = check()
    } catch {
      value = null
    }
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25))
    })
  }
}

/** Mount the registered main page against the live server. */
function renderPage() {
  app = setupApp()
  view = mount(createElement(app.page().component))
  return view
}

/** Restart the host on the same database file, as a new DSH process would. */
async function restartServer() {
  await server.close()
  server = await startServer({ dbPath })
  restoreFetch()
  restoreFetch = installFetch(server.origin)
  return server
}

beforeEach(async () => {
  dir = makeTempDir('dsh-gantt-e2e-')
  dbPath = path.join(dir, 'tasks.db')
  server = await startServer({ dbPath })
  restoreFetch = installFetch(server.origin)
})

afterEach(async () => {
  unmountAll()
  if (restoreFetch) restoreFetch()
  if (server) await server.close()
  if (dir) removeTempDir(dir)
  app = undefined
  view = undefined
})

describe('end-to-end', () => {
  it('serves the tree over HTTP and renders the empty state', async () => {
    const response = await fetch(`${server.origin}${TREE}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const payload = await response.json()
    expect(payload.ok).toBe(true)
    expect(payload.tasks).toEqual([])
    expect(payload.stats).toMatchObject({ total: 0, done: 0, progress: 0 })

    renderPage()
    const title = await waitFor(() => text(view.container, '.gantt-empty-title'), { label: 'empty state' })
    expect(title).toBe('No tasks yet')
  })

  it('loads demo data from the page and keeps it after a restart', async () => {
    renderPage()
    const seedButton = await waitFor(() => buttonByText(view.container, 'Load demo data'), { label: 'empty state' })
    click(seedButton)
    const rows = await waitFor(() => {
      const found = qa(view.container, '.gantt-row')
      return found.length === SEEDED ? found : null
    }, { label: 'seeded rows' })
    expect(rows).toHaveLength(SEEDED)
    expect(row(view.container, '1 DSH 插件发布')).not.toBeNull()

    const before = await fetch(`${server.origin}${TREE}`).then(result => result.json())
    expect(before.stats.total).toBe(SEEDED)
    const identifiers = before.tasks.map(task => task.id).sort()

    await restartServer()
    const after = await fetch(`${server.origin}${TREE}`).then(result => result.json())
    expect(after.tasks.map(task => task.id).sort()).toEqual(identifiers)
    expect(after.stats).toEqual(before.stats)
  })

  it('creates a task through the dialog, then splits it over HTTP and reads the rollup', async () => {
    renderPage()
    const newTask = await waitFor(() => buttonByText(view.container, 'New task'), { label: 'toolbar' })
    click(newTask)
    const dialog = await waitFor(() => q(view.container, '.gantt-dialog[role="dialog"]'), { label: 'create dialog' })
    setField(q(dialog, 'input.gantt-input'), 'Release train')
    click(buttonByText(dialog, 'Create'))
    await waitFor(() => row(view.container, '1 Release train'), { label: 'created row' })

    const tree = await fetch(`${server.origin}${TREE}`).then(result => result.json())
    expect(tree.stats.total).toBe(1)
    const split = await fetch(`${server.origin}/api/gantt/task/split`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: tree.tasks[0].id,
        children: [{ title: 'Draft' }, { title: 'Ship' }],
      }),
    })
    expect(split.status).toBe(200)

    const after = await fetch(`${server.origin}${TREE}`).then(result => result.json())
    const parent = after.tasks[0]
    expect(parent.hasChildren).toBe(true)
    expect(parent.children.map(task => task.number)).toEqual(['1.1', '1.2'])
    expect(parent.status).toBe('todo')
    expect(parent.progress).toBe(0)
    expect(parent.startDate).toBe(tree.tasks[0].startDate)
  })

  it('maps a malformed request body to the documented error envelope', async () => {
    const malformed = await fetch(`${server.origin}${TASKS}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ ok: false, error: 'request body must be valid JSON' })

    const notObject = await fetch(`${server.origin}${TASKS}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    })
    expect(notObject.status).toBe(400)
    expect(await notObject.json()).toEqual({ ok: false, error: 'request body must be a JSON object' })
  })
})
