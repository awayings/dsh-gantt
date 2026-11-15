import path from 'node:path'
import { GanttError, GanttStore, resolveDatabasePath, todayIso } from './store.js'
import { importTaskTracker, resolveTrackerDir } from './tracker.js'

/**
 * @typedef {import('./store.js').SplitChild} SplitChild
 * @typedef {import('./store.js').TaskInput} TaskInput
 * @typedef {import('./store.js').TaskPatch} TaskPatch
 * @typedef {import('./store.js').TaskStatus} TaskStatus
 * @typedef {import('./store.js').PlanStatus} PlanStatus
 */

/**
 * @typedef {object} GanttEndpoint
 * @property {'GET' | 'POST'} method
 * @property {string} path
 * @property {string} description
 */

/**
 * @typedef {object} GanttRoute
 * @property {string} path
 * @property {string[]} methods
 * @property {'buffered'} requestBody
 * @property {(request: Request) => Response | Promise<Response>} fetch
 */

/**
 * @typedef {object} GanttContext
 * @property {{ fetch: { register: (route: GanttRoute) => unknown } }} connection
 * @property {(effect: () => () => void, hint?: string) => unknown} effect
 */

export const name = 'gantt'
export const inject = ['connection']

/** @type {GanttEndpoint[]} */
const ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/gantt/tree',
    description: 'Read the hierarchical task tree with numbers, rollups, and stats.',
  },
  {
    method: 'GET',
    path: '/api/gantt/meta',
    description: 'Read the database location, status vocabulary, and this endpoint catalog.',
  },
  {
    method: 'POST',
    path: '/api/gantt/tasks',
    description: 'Create a task. Body: { title, parentId?, startDate?, endDate?, status?, progress?, description? }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/task/update',
    description: 'Update task fields. Body: { id, title?, description?, parentId?, startDate?, endDate?, status?, progress? }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/task/status',
    description: 'Change only status and/or progress. Body: { id, status, progress? }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/task/split',
    description: 'Split a task into child subtasks. Body: { id, children: [{ title, startDate?, endDate?, status?, progress? }] }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/task/delete',
    description: 'Delete a task and all of its descendants. Body: { id }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/seed',
    description: 'Insert a small demo tree when the database is empty.',
  },
  {
    method: 'GET',
    path: '/api/gantt/day',
    description: 'Read one day plan bundle. Query: date=YYYY-MM-DD (defaults to today).',
  },
  {
    method: 'POST',
    path: '/api/gantt/plan/status',
    description: 'Set a plan block status and optional notes. Body: { id, status, notes? }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/plan/import',
    description: 'Import the tracker markdown. Body: { dir?, year? }.',
  },
]

/**
 * @param {unknown} data
 * @param {number} [status]
 * @returns {Response}
 */
function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

/**
 * @param {Request} request
 * @returns {Promise<Record<string, unknown>>}
 */
async function readBody(request) {
  /** @type {unknown} */
  let body
  try {
    body = await request.json()
  } catch {
    throw new GanttError('request body must be valid JSON')
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new GanttError('request body must be a JSON object')
  }
  return /** @type {Record<string, unknown>} */ (body)
}

/**
 * Register the authenticated Gantt JSON routes on the host connection service.
 * @param {GanttContext} ctx
 * @returns {void}
 */
export function apply(ctx) {
  const store = new GanttStore(resolveDatabasePath())
  ctx.effect(() => () => store.close(), 'gantt: close SQLite database')

  /**
   * @param {'GET' | 'POST'} method
   * @param {string} path
   * @param {(request: Request) => Response | Promise<Response>} handler
   * @returns {void}
   */
  const route = (method, path, handler) => {
    ctx.connection.fetch.register({
      path,
      methods: [method],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          return await handler(request)
        } catch (error) {
          const status = error instanceof GanttError ? error.status : 500
          const message = error instanceof Error ? error.message : String(error)
          return json({ ok: false, error: message }, status)
        }
      },
    })
  }

  route('GET', '/api/gantt/meta', async () => json({
    ok: true,
    ...store.meta(),
    endpoints: ENDPOINTS,
  }))

  route('GET', '/api/gantt/tree', async () => json({
    ok: true,
    ...store.snapshot(),
  }))

  route('POST', '/api/gantt/tasks', async (request) => {
    const body = await readBody(request)
    const task = store.create(/** @type {TaskInput} */ (body))
    return json({ ok: true, task }, 201)
  })

  route('POST', '/api/gantt/task/update', async (request) => {
    const body = await readBody(request)
    if (typeof body.id !== 'string' || body.id.length === 0) throw new GanttError('id is required')
    const { id, ...patch } = body
    const task = store.update(id, /** @type {TaskPatch} */ (patch))
    return json({ ok: true, task })
  })

  route('POST', '/api/gantt/task/status', async (request) => {
    const body = await readBody(request)
    if (typeof body.id !== 'string' || body.id.length === 0) throw new GanttError('id is required')
    const task = store.setStatus(
      body.id,
      /** @type {TaskStatus} */ (body.status),
      /** @type {number | undefined} */ (body.progress),
    )
    return json({ ok: true, task })
  })

  route('POST', '/api/gantt/task/split', async (request) => {
    const body = await readBody(request)
    if (typeof body.id !== 'string' || body.id.length === 0) throw new GanttError('id is required')
    const result = store.split(body.id, /** @type {SplitChild[]} */ (body.children))
    return json({ ok: true, ...result })
  })

  route('POST', '/api/gantt/task/delete', async (request) => {
    const body = await readBody(request)
    if (typeof body.id !== 'string' || body.id.length === 0) throw new GanttError('id is required')
    const result = store.delete(body.id)
    return json({ ok: true, ...result })
  })

  route('POST', '/api/gantt/seed', async () => {
    const result = store.seed()
    return json({
      ok: true,
      ...result,
      ...(result.seeded ? store.snapshot() : {}),
    })
  })

  route('GET', '/api/gantt/day', async (request) => {
    const date = new URL(request.url, 'http://localhost').searchParams.get('date')
    const target = date === null || date.trim() === '' ? todayIso() : date.trim()
    return json({ ok: true, today: todayIso(), date: target, ...store.dayPlan(target) })
  })

  route('POST', '/api/gantt/plan/status', async (request) => {
    const body = await readBody(request)
    if (typeof body.id !== 'string' || body.id.length === 0) throw new GanttError('id is required')
    const block = store.setBlockStatus(
      body.id,
      /** @type {PlanStatus} */ (body.status),
      /** @type {string | null | undefined} */ (body.notes),
    )
    return json({ ok: true, block })
  })

  route('POST', '/api/gantt/plan/import', async (request) => {
    const body = await readBody(request)
    const dir = body.dir === undefined ? resolveTrackerDir() : body.dir
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new GanttError('dir must be an absolute path')
    const { year } = body
    if (year !== undefined && (typeof year !== 'number' || !Number.isInteger(year) || year < 1970 || year > 9999)) {
      throw new GanttError('year must be an integer from 1970 to 9999')
    }
    const imported = importTaskTracker(store, { dir, year: /** @type {number | undefined} */ (year) })
    return json({ ok: true, dir, imported })
  })
}
