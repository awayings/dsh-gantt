import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION, STATUSES, todayIso } from '../../src/host/store.js'
import { apply } from '../../src/host/index.js'
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
  it('registers the twenty-eight documented endpoints with their methods', () => {
    const { routes } = start()
    expect(routes.size).toBe(28)
    expect([...routes.keys()].sort()).toEqual(Object.values(ROUTES).sort())
    for (const definition of routes.values()) {
      expect(definition.requestBody).toBe('buffered')
      expect(typeof definition.fetch).toBe('function')
    }
    expect(routes.get(ROUTES.tree).methods).toEqual(['GET'])
    expect(routes.get(ROUTES.agents).methods).toEqual(['GET'])
    expect(routes.get(ROUTES.registerAgent, 'POST').methods).toEqual(['POST'])
    expect(routes.get(ROUTES.taskContext).methods).toEqual(['GET'])
    expect(routes.get(ROUTES.ready).methods).toEqual(['GET'])
    expect(routes.get(ROUTES.reportCompletion, 'POST').methods).toEqual(['POST'])
    expect(routes.get(ROUTES.meta).methods).toEqual(['GET'])
    expect(routes.get(ROUTES.day).methods).toEqual(['GET'])
    expect(routes.get(ROUTES.context).methods).toEqual(['GET'])
    expect(routes.get(ROUTES.brief).methods).toEqual(['GET'])
    expect(routes.get(ROUTES.focus).methods).toEqual(['GET'])
    expect(routes.get(ROUTES.briefCompute).methods).toEqual(['POST'])
    for (const writePath of [ROUTES.tasks, ROUTES.update, ROUTES.status, ROUTES.split, ROUTES.remove, ROUTES.seed,
      ROUTES.planStatus, ROUTES.planImport, ROUTES.decompose, ROUTES.schedule, ROUTES.briefCompute, ROUTES.focusSet,
      ROUTES.registerAgent, ROUTES.reportCompletion]) {
      expect(routes.get(writePath, 'POST').methods).toEqual(['POST'])
    }
  })

  it('waits for the tools service when the host exposes an inject seam', () => {
    const saved = process.env.DSH_GANTT_DB
    process.env.DSH_GANTT_DB = ':memory:'
    try {
      /** @type {string[][]} */
      const injected = []
      const disposers = []
      const ctx = {
        effect(fn) {
          const dispose = fn()
          disposers.push(dispose)
          return dispose
        },
        inject(deps, callback) {
          injected.push(deps)
          callback(ctx)
        },
        get(name) {
          return name === 'tools' ? { register: () => () => {} } : undefined
        },
        systemPrompt: { section: () => () => {}, context: () => () => {} },
        connection: { fetch: { register: () => {} } },
      }
      apply(ctx)
      expect(injected).toEqual([['systemPrompt'], ['tools']])
      disposeAll(disposers)
    } finally {
      if (saved === undefined) delete process.env.DSH_GANTT_DB
      else process.env.DSH_GANTT_DB = saved
    }
  })

  it('registers the routes when the host exposes no ctx.get seam', () => {
    const saved = process.env.DSH_GANTT_DB
    process.env.DSH_GANTT_DB = ':memory:'
    try {
      const routes = new Map()
      const disposers = []
      const ctx = {
        effect(fn) {
          const dispose = fn()
          disposers.push(dispose)
          return dispose
        },
        connection: { fetch: { register: (definition) => { for (const method of definition.methods) routes.set(`${method} ${definition.path}`, { ...definition, methods: [method] }) } } },
      }
      apply(ctx)
      expect(routes.size).toBe(28)
      disposeAll(disposers)
    } finally {
      if (saved === undefined) delete process.env.DSH_GANTT_DB
      else process.env.DSH_GANTT_DB = saved
    }
  })

  it('registers one exact path per path and combines the agents methods', () => {
    const saved = process.env.DSH_GANTT_DB
    process.env.DSH_GANTT_DB = ':memory:'
    try {
      const routes = new Map()
      const disposers = []
      const ctx = {
        effect(fn) {
          const dispose = fn()
          disposers.push(dispose)
          return dispose
        },
        connection: {
          fetch: {
            register(definition) {
              if (routes.has(definition.path)) throw new Error(`duplicate route ${definition.path}`)
              routes.set(definition.path, definition)
            },
          },
        },
      }
      apply(ctx)
      expect(routes.size).toBe(27)
      expect(routes.get(ROUTES.agents).methods).toEqual(['GET', 'POST'])
      disposeAll(disposers)
    } finally {
      if (saved === undefined) delete process.env.DSH_GANTT_DB
      else process.env.DSH_GANTT_DB = saved
    }
  })

  it('registers the store and scheduler disposers through ctx.effect', () => {
    const { disposers } = start()
    expect(disposers).toHaveLength(2)
    expect(disposers.every(dispose => typeof dispose === 'function')).toBe(true)
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
        cancelled: 0,
        overdue: 0,
        progress: 0,
      },
      brief: { pending: 0, frontier: [], next: [], lanes: [] },
      dailyBrief: {
        date: todayIso(),
        generatedAt: expect.any(String),
        source: 'auto',
        dayKind: 'unknown',
        slots: [],
        items: [],
        tracks: [],
        unfilled: [],
        notes: ['no plan blocks; no template for unknown day kind'],
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
    expect(payload.tasks[0].kind).toBe('task')
    expect(payload.tasks[0].links).toEqual([])
    expect(payload.brief.pending).toBe(0)
  })
})

describe('GET /api/gantt/tree tag filter', () => {
  /** Create one task through the write route and return it. */
  async function createTagTask(routes, body) {
    const created = await invoke(routes, ROUTES.tasks, body)
    expect(created.status).toBe(201)
    return created.payload.task
  }

  /** One track with tagged and untagged descendants plus one untagged root. */
  async function tagFixture(routes) {
    const track = await createTagTask(routes, { title: 'Track', tags: ['ops'] })
    const ui = await createTagTask(routes, { title: 'UI', parentId: track.id, tags: ['ui'], status: 'done', progress: 100 })
    const ops = await createTagTask(routes, { title: 'Ops', parentId: track.id, tags: ['ops'], status: 'in_progress', progress: 40 })
    const infra = await createTagTask(routes, { title: 'Infra', parentId: ops.id, tags: ['ops', 'infra'] })
    const both = await createTagTask(routes, { title: 'Both', parentId: track.id, tags: ['ops', 'ui'], status: 'in_progress', progress: 10 })
    const plain = await createTagTask(routes, { title: 'Plain' })
    return { track, ui, ops, infra, both, plain }
  }

  /** Flatten a response tree into `[title, number]` pairs in document order. */
  function rendered(nodes) {
    const flat = []
    const walk = (list) => {
      for (const node of list) {
        flat.push([node.title, node.number])
        walk(node.children)
      }
    }
    walk(nodes)
    return flat
  }

  it('leaves the response shape unchanged without a tags parameter', async () => {
    const { routes } = start()
    await tagFixture(routes)
    const plain = await invoke(routes, ROUTES.tree)
    expect(plain.status).toBe(200)
    expect(plain.payload).not.toHaveProperty('filter')
    expect(rendered(plain.payload.tasks)).toEqual([
      ['Track', '1'], ['UI', '1.1'], ['Ops', '1.2'], ['Infra', '1.2.1'], ['Both', '1.3'], ['Plain', '2'],
    ])
    const explicitMode = await invoke(routes, `${ROUTES.tree}?mode=any`)
    expect(explicitMode.payload).toEqual(plain.payload)
  })

  it('keeps the matching tasks and their ancestor path with full-tree numbers', async () => {
    const { routes } = start()
    await tagFixture(routes)
    const full = await invoke(routes, ROUTES.tree)
    const filtered = await invoke(routes, `${ROUTES.tree}?tags=ops`)
    expect(filtered.status).toBe(200)
    expect(filtered.payload.filter).toEqual({ tags: ['ops'], mode: 'any' })
    expect(rendered(filtered.payload.tasks)).toEqual([
      ['Track', '1'], ['Ops', '1.2'], ['Infra', '1.2.1'], ['Both', '1.3'],
    ])
    expect(filtered.payload.stats).toEqual({
      total: 4,
      done: 0,
      inProgress: 2,
      blocked: 0,
      cancelled: 0,
      overdue: 0,
      progress: 0,
    })
    // brief and dailyBrief are whole-tree views, so a label filter never rewrites them.
    expect(filtered.payload.brief).toEqual(full.payload.brief)
    expect(filtered.payload.dailyBrief).toEqual(full.payload.dailyBrief)
  })

  it('retains unmatched ancestors as containers with recomputed rollups', async () => {
    const { routes } = start()
    await tagFixture(routes)
    const filtered = await invoke(routes, `${ROUTES.tree}?tags=infra`)
    expect(rendered(filtered.payload.tasks)).toEqual([
      ['Track', '1'], ['Ops', '1.2'], ['Infra', '1.2.1'],
    ])
    const track = filtered.payload.tasks[0]
    const ops = track.children[0]
    expect(track.hasChildren).toBe(true)
    expect(track.tags).toEqual(['ops'])
    expect(track).toMatchObject({ status: 'todo', progress: 0 })
    expect(ops).toMatchObject({ status: 'todo', progress: 0, hasChildren: true })
  })

  it('supports and mode, repeated parameters, commas, and deduplication', async () => {
    const { routes } = start()
    await tagFixture(routes)
    const and = await invoke(routes, `${ROUTES.tree}?tags=ops,ui&mode=and`)
    expect(and.payload.filter).toEqual({ tags: ['ops', 'ui'], mode: 'and' })
    expect(rendered(and.payload.tasks)).toEqual([['Track', '1'], ['Both', '1.3']])
    const repeated = await invoke(routes, `${ROUTES.tree}?tags=ops&tags=ui`)
    const commaSeparated = await invoke(routes, `${ROUTES.tree}?tags=ops,ui`)
    expect(repeated.payload).toEqual(commaSeparated.payload)
    expect(repeated.payload.filter).toEqual({ tags: ['ops', 'ui'], mode: 'any' })
    const deduped = await invoke(routes, `${ROUTES.tree}?tags=ops,ops&tags=ui`)
    expect(deduped.payload.filter).toEqual({ tags: ['ops', 'ui'], mode: 'any' })
    const blankMode = await invoke(routes, `${ROUTES.tree}?tags=ops&mode=`)
    expect(blankMode.payload.filter).toEqual({ tags: ['ops'], mode: 'any' })
  })

  it('maps invalid tag and mode parameters to 400', async () => {
    const { routes } = start()
    await tagFixture(routes)
    const cases = [
      ['tags=', 'tags[0] must not be empty'],
      ['tags=ops,,ui', 'tags[1] must not be empty'],
      [`tags=${'x'.repeat(41)}`, 'tags[0] must be at most 40 characters'],
      [
        `tags=${Array.from({ length: 21 }, (_, index) => `t${index}`).join(',')}`,
        'tags must have at most 20 entries',
      ],
      ['mode=all', 'mode must be one of any, and'],
      ['tags=ops&mode=all', 'mode must be one of any, and'],
    ]
    for (const [query, error] of cases) {
      const result = await invoke(routes, `${ROUTES.tree}?${query}`)
      expect(result.status).toBe(400)
      expect(result.payload).toEqual({ ok: false, error })
    }
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
    expect(payload.kinds).toEqual(['track', 'node', 'task'])
    expect(payload.linkTypes).toEqual(['memory', 'file', 'url', 'task', 'note'])
    expect(payload.endpoints).toHaveLength(28)
    expect(payload.endpoints.map(endpoint => endpoint.path).sort()).toEqual(Object.values(ROUTES).sort())
    expect(payload.endpoints.map(endpoint => endpoint.method)).toEqual([
      'GET', 'GET', 'POST', 'GET', 'GET', 'POST', 'GET', 'POST', 'GET', 'GET', 'POST', 'GET',
      'GET', 'GET', 'POST', 'POST', 'POST', 'POST', 'POST', 'POST', 'GET', 'POST', 'POST',
      'POST', 'POST', 'GET', 'GET', 'POST',
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
