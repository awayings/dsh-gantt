import { apply } from '../../src/host/index.js'

/**
 * Build a fake plugin context that captures registered routes and disposers.
 * `services` backs `ctx.get(name)` so optional seams (llm, agentDefaultModel)
 * can be supplied per test.
 * @param {Record<string, unknown>} [services]
 */
export function createContext(services = {}) {
  const routes = new Map()
  const disposers = []
  const ctx = {
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    get(name) {
      return services[name]
    },
    connection: {
      fetch: {
        register(definition) {
          routes.set(definition.path, definition)
        },
      },
    },
  }
  return { ctx, routes, disposers }
}

/**
 * Register every host route against an in-memory database.
 *
 * The env override is applied only while `apply` constructs the store so the
 * real database location is never touched.
 */
export function bootPlugin(options = {}) {
  const saved = process.env.DSH_GANTT_DB
  process.env.DSH_GANTT_DB = ':memory:'
  try {
    const { ctx, routes, disposers } = createContext(options.services)
    apply(ctx)
    return { routes, disposers }
  } finally {
    if (saved === undefined) delete process.env.DSH_GANTT_DB
    else process.env.DSH_GANTT_DB = saved
  }
}

/**
 * Invoke one registered route.
 *
 * A string body is sent verbatim (for malformed JSON); any other value is
 * JSON-encoded, and `undefined` sends no body at all.
 */
export async function invoke(routes, apiPath, body) {
  const definition = routes.get(new URL(apiPath, 'http://localhost').pathname)
  if (!definition) throw new Error(`route ${apiPath} was not registered`)
  const init = { method: definition.methods[0] }
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body)
  const response = await definition.fetch(new Request(`http://localhost${apiPath}`, init))
  return {
    response,
    status: response.status,
    headers: response.headers,
    payload: await response.json(),
  }
}

/** Run every captured disposer, tolerating already-disposed stores. */
export function disposeAll(disposers) {
  for (const dispose of disposers) dispose()
}

/** Every host route path, keyed by role. */
export const ROUTES = {
  tree: '/api/gantt/tree',
  meta: '/api/gantt/meta',
  tasks: '/api/gantt/tasks',
  update: '/api/gantt/task/update',
  status: '/api/gantt/task/status',
  split: '/api/gantt/task/split',
  remove: '/api/gantt/task/delete',
  seed: '/api/gantt/seed',
  day: '/api/gantt/day',
  planStatus: '/api/gantt/plan/status',
  planImport: '/api/gantt/plan/import',
  decompose: '/api/gantt/task/decompose',
  schedule: '/api/gantt/task/schedule',
  context: '/api/gantt/context',
  brief: '/api/gantt/brief',
  briefCompute: '/api/gantt/brief/compute',
  focus: '/api/gantt/focus',
  focusSet: '/api/gantt/focus/set',
  trajectory: '/api/gantt/trajectory',
  work: '/api/gantt/work',
  workSession: '/api/gantt/work/session',
  workSkills: '/api/gantt/work/skills',
  workTeam: '/api/gantt/work/team',
}
