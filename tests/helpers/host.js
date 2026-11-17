import { apply } from '../../src/host/index.js'

/**
 * Build a fake plugin context that captures registered routes and disposers.
 * `services` backs `ctx.get(name)` so optional seams (llm, agentDefaultModel)
 * can be supplied per test.
 * @param {Record<string, unknown>} [services]
 */
export function createContext(services = {}) {
  const routes = createRouteTable()
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
          for (const method of definition.methods) {
            routes.set(`${method} ${definition.path}`, { ...definition, methods: [method] })
          }
        },
      },
    },
  }
  return { ctx, routes, disposers }
}

/**
 * A path-and-method route table. GET and POST share `/api/gantt/agents`, so the
 * fake connection registers on the method-qualified key while the tests still
 * read a route by path (GET wins when both exist).
 * @returns {Map<string, any> & { get: (path: string, method?: string) => any }}
 */
function createRouteTable() {
  /** @type {Map<string, any>} */
  const definitions = new Map()
  const getByKey = definitions.get.bind(definitions)
  return Object.assign(definitions, {
    /** @param {string} path @param {string} [method] */
    get(path, method) {
      if (method !== undefined) return getByKey(`${method} ${path}`)
      const matches = [...definitions.values()].filter(definition => definition.path === path)
      return matches.find(definition => definition.methods[0] === 'GET') ?? matches[0]
    },
    /** @returns {string[]} */
    keys() {
      return [...definitions.values()].map(definition => definition.path)
    },
  })
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
  const pathname = new URL(apiPath, 'http://localhost').pathname
  const requested = body === undefined ? 'GET' : 'POST'
  const definition = routes.get(pathname, requested) ?? routes.get(pathname)
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
  agents: '/api/gantt/agents',
  registerAgent: '/api/gantt/agents',
  taskContext: '/api/gantt/task/context',
  ready: '/api/gantt/ready',
  reportCompletion: '/api/gantt/task/report',
}
