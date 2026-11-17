// Route plumbing shared by every resource module: the JSON response shape, the
// buffered body parser, the id guard, and the error mapping.

import { GanttError } from '../errors.js'
import { todayIso } from '../tree.js'

/** @typedef {import('../store.js').GanttStore} GanttStore */

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
 * @property {{ section: (section: unknown) => () => void, context: (context: unknown) => () => void }} [systemPrompt]
 * @property {{ register: (tool: unknown) => unknown }} [tools]
 * @property {(name: string) => unknown} [get]
 * @property {(deps: string[], callback: (ctx: GanttContext) => unknown) => unknown} [inject]
 */

/**
 * What every route handler receives besides the request.
 * @typedef {object} RouteDeps
 * @property {GanttStore} store
 * @property {GanttEndpoint[]} endpoints
 * @property {(name: string) => unknown} get
 * @property {import('../session-titles.js').SessionTitles} titles
 */

/**
 * One route in the table: its documented contract plus the handler.
 * @typedef {object} RouteSpec
 * @property {'GET' | 'POST'} method
 * @property {string} path
 * @property {string} description
 * @property {(request: Request, deps: RouteDeps) => Response | Promise<Response>} fetch
 */

/**
 * @param {unknown} data
 * @param {number} [status]
 * @returns {Response}
 */
export function json(data, status = 200) {
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
export async function readBody(request) {
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
 * The `id` field of a request body; every task and plan write starts with it.
 * @param {Record<string, unknown>} body
 * @returns {string}
 */
export function requiredId(body) {
  if (typeof body.id !== 'string' || body.id.length === 0) throw new GanttError('id is required')
  return body.id
}

/**
 * The `date` query parameter, defaulting to the task-day today.
 * @param {Request} request
 * @returns {string}
 */
export function requestedDate(request) {
  const date = new URL(request.url, 'http://localhost').searchParams.get('date')
  return date === null || date.trim() === '' ? todayIso() : date.trim()
}

/**
 * Run one route handler, mapping a `GanttError` status and hiding any other
 * failure behind a 500.
 * @param {RouteSpec} spec
 * @param {Request} request
 * @param {RouteDeps} deps
 * @returns {Promise<Response>}
 */
async function routeResponse(spec, request, deps) {
  try {
    return await spec.fetch(request, deps)
  } catch (error) {
    const status = error instanceof GanttError ? error.status : 500
    const message = error instanceof Error ? error.message : String(error)
    return json({ ok: false, error: message }, status)
  }
}

/**
 * Register one route.
 * @param {GanttContext} ctx
 * @param {RouteSpec} spec
 * @param {RouteDeps} deps
 * @returns {void}
 */
export function registerRoute(ctx, spec, deps) {
  ctx.connection.fetch.register({
    path: spec.path,
    methods: [spec.method],
    requestBody: 'buffered',
    fetch: request => routeResponse(spec, request, deps),
  })
}

/**
 * Register every spec that shares one exact path as a single Fetch route with
 * all of its methods. The connection service rejects a second registration for
 * the same path, so GET and POST `/api/gantt/agents` must be combined here.
 * @param {GanttContext} ctx
 * @param {RouteSpec[]} specs
 * @param {RouteDeps} deps
 * @returns {void}
 */
export function registerRouteGroup(ctx, specs, deps) {
  if (specs.length === 1) {
    registerRoute(ctx, specs[0], deps)
    return
  }
  const [first] = specs
  ctx.connection.fetch.register({
    path: first.path,
    methods: specs.map(spec => spec.method),
    requestBody: 'buffered',
    fetch: (request) => {
      const spec = /** @type {RouteSpec} */ (specs.find(candidate => candidate.method === request.method))
      return routeResponse(spec, request, deps)
    },
  })
}
