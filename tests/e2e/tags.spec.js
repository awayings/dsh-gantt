// End-to-end: task tags over the shipped artifact, the real HTTP API, and a
// real SQLite file. The unit suites cover validation and rendering branch by
// branch; this case proves the seam: the tag column survives the wire, the
// dialog-shaped payload the page writes is accepted, and the tag filter prunes
// the rendered tree while keeping ancestor paths.
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFetch, startServer } from './server.js'
import { click, mount, q, qa, row, setupApp, unmountAll } from '../client/harness.js'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'
import path from 'node:path'

const TREE = '/api/gantt/tree'
const TASKS = '/api/gantt/tasks'
const UPDATE = '/api/gantt/task/update'

let dir
let dbPath
let server
let restoreFetch
let view

/** Wait for a condition, letting React flush between attempts. */
async function waitFor(check, label = 'condition', timeout = 10_000) {
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

/** POST one JSON body through the shipped route. */
async function post(pathname, body) {
  return fetch(`${server.origin}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Create one task through the shipped write route. */
async function createTask(body) {
  const response = await post(TASKS, body)
  return (await response.json()).task
}

beforeEach(async () => {
  dir = makeTempDir('dsh-gantt-e2e-tags-')
  dbPath = path.join(dir, 'tasks.db')
  server = await startServer({ dbPath })
  restoreFetch = installFetch(server.origin)
})

afterEach(async () => {
  unmountAll()
  vi.unstubAllGlobals()
  if (restoreFetch) restoreFetch()
  if (server) await server.close()
  if (dir) removeTempDir(dir)
  view = undefined
})

describe('task tags end to end', () => {
  it('round-trips tags over HTTP and filters the rendered tree by tag', async () => {
    const parent = await createTask({ title: 'Tagged parent', tags: ['ops'] })
    const child = await createTask({ title: 'Tagged child', parentId: parent.id, tags: ['ui', 'ops'] })
    await createTask({ title: 'Plain' })

    const tree = await fetch(`${server.origin}${TREE}`).then(response => response.json())
    expect(tree.tasks.map(task => task.title)).toEqual(['Tagged parent', 'Plain'])
    expect(tree.tasks[0].tags).toEqual(['ops'])
    expect(tree.tasks[0].children[0].tags).toEqual(['ui', 'ops'])
    expect(tree.tasks[1].tags).toEqual([])

    const tagged = await post(UPDATE, { id: child.id, tags: ['ui'] })
    expect((await tagged.json()).task.tags).toEqual(['ui'])
    const cleared = await post(UPDATE, { id: child.id, tags: null })
    expect((await cleared.json()).task.tags).toEqual([])
    const restored = await post(UPDATE, { id: child.id, tags: ['ui', 'ops'] })
    expect((await restored.json()).task.tags).toEqual(['ui', 'ops'])

    const invalid = await post(TASKS, { title: 'Bad tags', tags: 'nope' })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ ok: false, error: 'tags must be an array' })

    const app = setupApp()
    view = mount(createElement(app.page().component))
    await waitFor(() => qa(view.container, '.gantt-row').length === 3, 'three rows')
    expect(qa(view.container, '.gantt-row-tag')).toHaveLength(3)

    const uiChip = await waitFor(
      () => q(view.container, '.gantt-tag-filter [data-label="tag:ui"]'),
      'ui tag filter',
    )
    click(uiChip)
    await waitFor(() => qa(view.container, '.gantt-row').length === 2, 'ui rows')
    expect(row(view.container, '1 Tagged parent')).not.toBeNull()
    expect(row(view.container, '1.1 Tagged child')).not.toBeNull()
    expect(row(view.container, '2 Plain')).toBeNull()
    expect(JSON.parse(String(window.localStorage.getItem('gantt.pageState'))).labels).toEqual(['tag:ui'])

    const clear = await waitFor(() => q(view.container, '[data-action="clear-tags"]'), 'clear labels')
    click(clear)
    await waitFor(() => qa(view.container, '.gantt-row').length === 3, 'cleared rows')

    // Predefined labels are unioned with artificial ones: an empty perspective
    // adds nothing, and a status label widens the tag selection again.
    click(q(view.container, '.gantt-tag-filter [data-label="preset:done"]'))
    await waitFor(() => qa(view.container, '.gantt-row').length === 0, 'empty done rows')
    click(q(view.container, '.gantt-tag-filter [data-label="tag:ops"]'))
    await waitFor(() => qa(view.container, '.gantt-row').length === 2, 'ops rows')
    expect(row(view.container, '2 Plain')).toBeNull()
    click(q(view.container, '.gantt-tag-filter [data-label="preset:unfinished"]'))
    await waitFor(() => qa(view.container, '.gantt-row').length === 3, 'union rows')
    expect(JSON.parse(String(window.localStorage.getItem('gantt.pageState'))).labels)
      .toEqual(['preset:done', 'tag:ops', 'preset:unfinished'])
  })
})
