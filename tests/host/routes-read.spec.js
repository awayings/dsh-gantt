import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION, STATUSES, todayIso } from '../../store.js'
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

describe('route registration', () => {
  it('registers the eleven documented endpoints with their methods', () => {
    const { routes } = start()
    expect(routes.size).toBe(11)
    expect([...routes.keys()].sort()).toEqual(Object.values(ROUTES).sort())
    for (const definition of routes.values()) {
      expect(definition.requestBody).toBe('buffered')
      expect(typeof definition.fetch).toBe('function')
    }
    expect(routes.get(ROUTES.tree).methods).toEqual(['GET'])
    expect(routes.get(ROUTES.meta).methods).toEqual(['GET'])
    expect(routes.get(ROUTES.day).methods).toEqual(['GET'])
    for (const writePath of [ROUTES.tasks, ROUTES.update, ROUTES.status, ROUTES.split, ROUTES.remove, ROUTES.seed,
      ROUTES.planStatus, ROUTES.planImport]) {
      expect(routes.get(writePath).methods).toEqual(['POST'])
    }
  })

  it('registers a store disposer through ctx.effect', () => {
    const { disposers } = start()
    expect(disposers).toHaveLength(1)
    expect(typeof disposers[0]).toBe('function')
  })
})

describe('GET /api/gantt/tree', () => {
  it('returns an empty snapshot with cache and sniffing headers', async () => {
    const { routes } = start()
    const result = await invoke(routes, ROUTES.tree)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(result.headers.get('x-content-type-options')).toBe('nosniff')
    expect(result.headers.get('content-type')).toContain('application/json')
    expect(result.payload).toEqual({
      ok: true,
      today: todayIso(),
      statuses: [...STATUSES],
      tasks: [],
      stats: {
        total: 0,
        done: 0,
        inProgress: 0,
        blocked: 0,
        overdue: 0,
        progress: 0,
      },
    })
  })

  it('returns the numbered tree and stats after a write', async () => {
    const { routes } = start()
    const parent = await invoke(routes, ROUTES.tasks, {
      title: 'Parent',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    })
    await invoke(routes, ROUTES.tasks, {
      title: 'Child',
      parentId: parent.payload.task.id,
      status: 'done',
    })
    const { payload } = await invoke(routes, ROUTES.tree)
    expect(payload.tasks).toHaveLength(1)
    expect(payload.tasks[0].number).toBe('1')
    expect(payload.tasks[0].hasChildren).toBe(true)
    expect(payload.tasks[0].children[0].number).toBe('1.1')
    expect(payload.stats.total).toBe(2)
    expect(payload.today).toBe(todayIso())
  })
})

describe('GET /api/gantt/meta', () => {
  it('describes the database, vocabulary, schema, and endpoint catalog', async () => {
    const { routes } = start()
    const result = await invoke(routes, ROUTES.meta)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    const { payload } = result
    expect(payload.ok).toBe(true)
    expect(payload.dbPath).toBe(':memory:')
    expect(payload.statuses).toEqual([...STATUSES])
    expect(payload.schemaVersion).toBe(SCHEMA_VERSION)
    expect(payload.taskCount).toBe(0)
    expect(payload.engine).toBe('node:sqlite')
    expect(payload.endpoints).toHaveLength(11)
    expect(payload.endpoints.map(endpoint => endpoint.path).sort()).toEqual(Object.values(ROUTES).sort())
    expect(payload.endpoints.map(endpoint => endpoint.method)).toEqual([
      'GET', 'GET', 'POST', 'POST', 'POST', 'POST', 'POST', 'POST', 'GET', 'POST', 'POST',
    ])
    for (const endpoint of payload.endpoints) {
      expect(typeof endpoint.description).toBe('string')
      expect(endpoint.description.length).toBeGreaterThan(0)
    }
  })

  it('reports the current task count', async () => {
    const { routes } = start()
    await invoke(routes, ROUTES.tasks, { title: 'One' })
    await invoke(routes, ROUTES.tasks, { title: 'Two' })
    const { payload } = await invoke(routes, ROUTES.meta)
    expect(payload.taskCount).toBe(2)
  })
})

describe('POST /api/gantt/seed', () => {
  it('seeds an empty database and returns the new snapshot', async () => {
    const { routes } = start()
    const first = await invoke(routes, ROUTES.seed)
    expect(first.status).toBe(200)
    expect(first.payload.ok).toBe(true)
    expect(first.payload.seeded).toBe(true)
    expect(first.payload.taskCount).toBe(13)
    expect(first.payload.today).toBe(todayIso())
    expect(first.payload.statuses).toEqual([...STATUSES])
    expect(first.payload.tasks).toHaveLength(2)
    expect(first.payload.stats.total).toBe(13)
  })

  it('reports a no-op seed without a snapshot payload', async () => {
    const { routes } = start()
    await invoke(routes, ROUTES.seed)
    const second = await invoke(routes, ROUTES.seed)
    expect(second.status).toBe(200)
    expect(second.payload.ok).toBe(true)
    expect(second.payload.seeded).toBe(false)
    expect(second.payload.taskCount).toBe(13)
    expect(second.payload.tasks).toBeUndefined()
    expect(second.payload.stats).toBeUndefined()
  })
})
