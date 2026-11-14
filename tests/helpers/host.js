import { apply } from '../../index.js'

/** Build a fake plugin context that captures registered routes and disposers. */
export function createContext() {
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
export function bootPlugin() {
  const saved = process.env.DSH_GANTT_DB
  process.env.DSH_GANTT_DB = ':memory:'
  try {
    const { ctx, routes, disposers } = createContext()
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
  const definition = routes.get(apiPath)
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
}
