import path from 'node:path'
import { GanttError, GanttStore, resolveDatabasePath, todayIso } from './store.js'
import { importTaskTracker, resolveTrackerDir } from './tracker.js'
import { ChatError, runChat } from './chat.js'

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
 * @property {(name: string) => unknown} [get]
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
    description: 'Create a task. Body: { title, parentId?, kind?, ref?, startDate?, endDate?, status?, progress?, description?, lane?, dep?, doneWhen?, landing?, estimate?, category?, inspiration?, links? }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/task/update',
    description: 'Update task fields. Body: { id, title?, description?, parentId?, startDate?, endDate?, status?, progress?, lane?, dep?, doneWhen?, landing?, estimate?, category?, inspiration?, links? }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/task/status',
    description: 'Change only status and/or progress. Body: { id, status, progress? }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/task/split',
    description: 'Split a task into child subtasks. Body: { id, children: [{ title, startDate?, endDate?, ..., doneWhen?, landing?, links? }] }.',
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
  {
    method: 'POST',
    path: '/api/gantt/task/decompose',
    description: 'Decompose a task into child subtasks, optionally scheduling each. Body: { id, planDate?, children: [{ title, ..., plan? }] }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/task/schedule',
    description: 'Schedule a task into one day plan cell, idempotently. Body: { id, date, startTime?, endTime?, slot?, category?, landing?, estimate?, inspiration?, detail? }.',
  },
  {
    method: 'GET',
    path: '/api/gantt/context',
    description: 'Export the unified tree and one day plan as markdown. Query: date?, root?, limit?.',
  },
  {
    method: 'GET',
    path: '/api/gantt/brief',
    description: 'Read the daily 该动 brief for one date. Query: date=YYYY-MM-DD (defaults to today).',
  },
  {
    method: 'POST',
    path: '/api/gantt/brief/compute',
    description: 'Recompute and persist the daily 该动 brief. Body: { date? }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/chat',
    description: 'Chat with the configured model to decompose a task. Body: { message, taskId?, history? }.',
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
  ctx.effect(() => store.startScheduler(), 'gantt: recompute the daily brief at 08:00')

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
          const status = error instanceof GanttError || error instanceof ChatError ? error.status : 500
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

  route('POST', '/api/gantt/task/decompose', async (request) => {
    const body = await readBody(request)
    if (typeof body.id !== 'string' || body.id.length === 0) throw new GanttError('id is required')
    const result = store.decompose(
      body.id,
      /** @type {import('./store.js').DecomposeChildInput[]} */ (body.children),
      body.planDate,
    )
    return json({ ok: true, ...result })
  })

  route('POST', '/api/gantt/task/schedule', async (request) => {
    const body = await readBody(request)
    if (typeof body.id !== 'string' || body.id.length === 0) throw new GanttError('id is required')
    const { id, ...input } = body
    const result = store.scheduleTask(id, /** @type {import('./store.js').ScheduleInput} */ (input))
    return json({ ok: true, ...result })
  })

  route('GET', '/api/gantt/context', async (request) => {
    const params = new URL(request.url, 'http://localhost').searchParams
    const date = params.get('date')
    const root = params.get('root')
    const limit = params.get('limit')
    const result = store.contextDocument({
      date: date === null || date.trim() === '' ? undefined : date.trim(),
      root: root === null || root.trim() === '' ? undefined : root.trim(),
      limit: limit === null || limit.trim() === '' ? undefined : Number(limit),
    })
    return json(result)
  })

  route('GET', '/api/gantt/brief', async (request) => {
    const date = new URL(request.url, 'http://localhost').searchParams.get('date')
    const target = date === null || date.trim() === '' ? todayIso() : date.trim()
    const result = store.dailyBrief(target)
    return json({ ok: true, today: todayIso(), date: target, brief: result.report, cached: result.cached })
  })

  route('POST', '/api/gantt/brief/compute', async (request) => {
    const body = await readBody(request)
    const target = body.date === undefined ? todayIso() : /** @type {string} */ (body.date)
    const brief = store.computeDailyBrief(target, { source: 'manual' })
    return json({ ok: true, today: todayIso(), date: brief.date, brief, cached: false })
  })

  route('POST', '/api/gantt/chat', async (request) => {
    const body = await readBody(request)
    /** @param {string} name @returns {unknown} */
    const service = name => (typeof ctx.get === 'function' ? ctx.get(name) : undefined)
    const defaults = /** @type {any} */ (service('agentDefaultModel'))
    const llm = /** @type {any} */ (service('llm'))
    const context = store.contextDocument({ limit: 12000 })
    const brief = store.dailyBrief(todayIso()).report
    const result = await runChat({
      llm,
      selection: typeof defaults?.currentSelection === 'function' ? defaults.currentSelection() : undefined,
      message: /** @type {string} */ (body.message),
      history: /** @type {any} */ (body.history),
      taskId: /** @type {string | undefined} */ (body.taskId),
      context: { markdown: context.markdown, tasks: store.tree() },
      dailyBrief: brief,
      signal: request.signal,
    })
    return json({ ok: true, ...result })
  })
}
