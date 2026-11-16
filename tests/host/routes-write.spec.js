import { afterEach, describe, expect, it, vi } from 'vitest'
import { GanttStore } from '../../src/host/store.js'
import { ROUTES, bootPlugin, disposeAll, invoke } from '../helpers/host.js'

let boot

function start() {
  boot = bootPlugin()
  return boot
}

afterEach(() => {
  if (boot) disposeAll(boot.disposers)
  boot = undefined
  vi.restoreAllMocks()
})

async function createTask(routes, body = { title: 'Task' }) {
  const result = await invoke(routes, ROUTES.tasks, body)
  expect(result.status).toBe(201)
  return result.payload.task
}

describe('POST /api/gantt/tasks', () => {
  it('creates a task and returns it with 201', async () => {
    const { routes } = start()
    const result = await invoke(routes, ROUTES.tasks, {
      title: '  New   task ',
      description: ' detail ',
      startDate: '2024-01-01',
      endDate: '2024-01-05',
      status: 'in_progress',
      progress: 25,
    })
    expect(result.status).toBe(201)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(result.payload.ok).toBe(true)
    const { task } = result.payload
    expect(task.title).toBe('New task')
    expect(task.description).toBe('detail')
    expect(task.startDate).toBe('2024-01-01')
    expect(task.endDate).toBe('2024-01-05')
    expect(task.status).toBe('in_progress')
    expect(task.progress).toBe(25)
    expect(task.number).toBe('1')
  })

  it('maps validation failures to 400 and missing parents to 404', async () => {
    const { routes } = start()
    const invalid = await invoke(routes, ROUTES.tasks, {})
    expect(invalid.status).toBe(400)
    expect(invalid.payload).toEqual({ ok: false, error: 'title is required' })
    const missingParent = await invoke(routes, ROUTES.tasks, { title: 'Task', parentId: 'ghost' })
    expect(missingParent.status).toBe(404)
    expect(missingParent.payload.error).toBe('task ghost was not found')
  })

  it('rejects malformed and non-object JSON bodies', async () => {
    const { routes } = start()
    const malformed = await invoke(routes, ROUTES.tasks, '{oops')
    expect(malformed.status).toBe(400)
    expect(malformed.payload.error).toBe('request body must be valid JSON')
    for (const body of ['null', '[]', '"text"', '5']) {
      const result = await invoke(routes, ROUTES.tasks, body)
      expect(result.status).toBe(400)
      expect(result.payload).toEqual({ ok: false, error: 'request body must be a JSON object' })
    }
  })
})

describe('POST /api/gantt/task/update', () => {
  it('updates fields and returns the task', async () => {
    const { routes } = start()
    const task = await createTask(routes)
    const result = await invoke(routes, ROUTES.update, {
      id: task.id,
      title: 'Renamed',
      description: 'Updated',
      startDate: '2024-02-01',
      endDate: '2024-02-03',
      status: 'done',
    })
    expect(result.status).toBe(200)
    expect(result.payload.ok).toBe(true)
    expect(result.payload.task.title).toBe('Renamed')
    expect(result.payload.task.description).toBe('Updated')
    expect(result.payload.task.startDate).toBe('2024-02-01')
    expect(result.payload.task.progress).toBe(100)
    expect(result.payload.task.status).toBe('done')
  })

  it('requires an id', async () => {
    const { routes } = start()
    const result = await invoke(routes, ROUTES.update, { title: 'No id' })
    expect(result.status).toBe(400)
    expect(result.payload).toEqual({ ok: false, error: 'id is required' })
    const empty = await invoke(routes, ROUTES.update, { id: '', title: 'No id' })
    expect(empty.status).toBe(400)
    expect(empty.payload.error).toBe('id is required')
  })

  it('maps store validation errors to 4xx', async () => {
    const { routes } = start()
    const task = await createTask(routes)
    const unknown = await invoke(routes, ROUTES.update, { id: 'ghost', title: 'X' })
    expect(unknown.status).toBe(404)
    expect(unknown.payload.error).toBe('task ghost was not found')
    const invalidStatus = await invoke(routes, ROUTES.update, { id: task.id, status: 'later' })
    expect(invalidStatus.status).toBe(400)
    expect(invalidStatus.payload.error).toContain('status must be one of')
  })

  it('rejects a malformed body before touching the store', async () => {
    const { routes } = start()
    const result = await invoke(routes, ROUTES.update, '{')
    expect(result.status).toBe(400)
    expect(result.payload.error).toBe('request body must be valid JSON')
  })
})

describe('POST /api/gantt/task/status', () => {
  it('changes status and derived progress', async () => {
    const { routes } = start()
    const task = await createTask(routes)
    const done = await invoke(routes, ROUTES.status, { id: task.id, status: 'done' })
    expect(done.status).toBe(200)
    expect(done.payload.task.status).toBe('done')
    expect(done.payload.task.progress).toBe(100)
    const blocked = await invoke(routes, ROUTES.status, { id: task.id, status: 'blocked', progress: 30 })
    expect(blocked.payload.task.status).toBe('blocked')
    expect(blocked.payload.task.progress).toBe(30)
    const cancelled = await invoke(routes, ROUTES.status, { id: task.id, status: 'cancelled' })
    expect(cancelled.payload.task.status).toBe('cancelled')
  })

  it('requires an id and a valid status', async () => {
    const { routes } = start()
    const missing = await invoke(routes, ROUTES.status, { status: 'done' })
    expect(missing.status).toBe(400)
    expect(missing.payload.error).toBe('id is required')
    const task = await createTask(routes)
    const invalid = await invoke(routes, ROUTES.status, { id: task.id, status: 'nope' })
    expect(invalid.status).toBe(400)
    expect(invalid.payload.error).toContain('status must be one of')
  })
})

describe('POST /api/gantt/task/split', () => {
  it('splits a task and returns the parent and children', async () => {
    const { routes } = start()
    const parent = await createTask(routes, { title: 'Parent', startDate: '2024-01-01', endDate: '2024-01-10' })
    const result = await invoke(routes, ROUTES.split, {
      id: parent.id,
      children: [{ title: 'First' }, { title: 'Second', status: 'done' }],
    })
    expect(result.status).toBe(200)
    expect(result.payload.ok).toBe(true)
    expect(result.payload.parent.id).toBe(parent.id)
    expect(result.payload.children.map(child => child.number)).toEqual(['1.1', '1.2'])
    expect(result.payload.parent.children).toHaveLength(2)
    expect(result.payload.parent.status).toBe('in_progress')
  })

  it('requires an id and a valid children list', async () => {
    const { routes } = start()
    const missing = await invoke(routes, ROUTES.split, { children: [] })
    expect(missing.status).toBe(400)
    expect(missing.payload.error).toBe('id is required')
    const parent = await createTask(routes)
    const notArray = await invoke(routes, ROUTES.split, { id: parent.id, children: 'x' })
    expect(notArray.status).toBe(400)
    expect(notArray.payload.error).toBe('children must be a non-empty array')
    const notObject = await invoke(routes, ROUTES.split, { id: parent.id, children: [null] })
    expect(notObject.status).toBe(400)
    expect(notObject.payload.error).toBe('children[0] must be an object')
  })
})

describe('POST /api/gantt/task/delete', () => {
  it('deletes a task and reports its parent', async () => {
    const { routes } = start()
    const parent = await createTask(routes, { title: 'Parent' })
    const child = await createTask(routes, { title: 'Child', parentId: parent.id })
    const result = await invoke(routes, ROUTES.remove, { id: child.id })
    expect(result.status).toBe(200)
    expect(result.payload).toEqual({ ok: true, id: child.id, parentId: parent.id })
    const tree = await invoke(routes, ROUTES.tree)
    expect(tree.payload.stats.total).toBe(1)
  })

  it('requires an id and reports unknown tasks as 404', async () => {
    const { routes } = start()
    const missing = await invoke(routes, ROUTES.remove, {})
    expect(missing.status).toBe(400)
    expect(missing.payload.error).toBe('id is required')
    const unknown = await invoke(routes, ROUTES.remove, { id: 'ghost' })
    expect(unknown.status).toBe(404)
    expect(unknown.payload.error).toBe('task ghost was not found')
  })
})

describe('error mapping', () => {
  it('maps an unexpected Error to a 500 JSON payload', async () => {
    const { routes } = start()
    vi.spyOn(GanttStore.prototype, 'create').mockImplementationOnce(() => {
      throw new Error('database exploded')
    })
    const result = await invoke(routes, ROUTES.tasks, { title: 'Boom' })
    expect(result.status).toBe(500)
    expect(result.payload).toEqual({ ok: false, error: 'database exploded' })
    expect(result.headers.get('cache-control')).toBe('no-store')
  })

  it('stringifies a non-Error throw into a 500 payload', async () => {
    const { routes } = start()
    vi.spyOn(GanttStore.prototype, 'create').mockImplementationOnce(() => {
      throw 'plain failure'
    })
    const result = await invoke(routes, ROUTES.tasks, { title: 'Boom' })
    expect(result.status).toBe(500)
    expect(result.payload).toEqual({ ok: false, error: 'plain failure' })
  })
})

describe('store lifecycle', () => {
  it('closes the database through the registered disposer', async () => {
    const { routes, disposers } = start()
    const before = await invoke(routes, ROUTES.tree)
    expect(before.status).toBe(200)
    disposers[0]()
    expect(() => disposers[0]()).not.toThrow()
    const after = await invoke(routes, ROUTES.tree)
    expect(after.status).toBe(500)
    expect(after.payload.ok).toBe(false)
    expect(typeof after.payload.error).toBe('string')
    expect(after.payload.error.length).toBeGreaterThan(0)
  })
})
