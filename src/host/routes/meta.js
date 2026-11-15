// Meta routes: the endpoint catalog and database facts, the tree-plus-day
// context document, and the demo seed.

import { json } from './http.js'

/** @typedef {import('./http.js').RouteSpec} RouteSpec */
/** @type {RouteSpec} */
export const metaRoute = {
  method: 'GET',
  path: '/api/gantt/meta',
  description: 'Read the database location, status vocabulary, and this endpoint catalog.',
  fetch: async (_request, { store, endpoints }) => json({
    ok: true,
    ...store.meta(),
    endpoints,
  }),
}

/** @type {RouteSpec} */
export const seedRoute = {
  method: 'POST',
  path: '/api/gantt/seed',
  description: 'Insert a small demo tree when the database is empty.',
  fetch: async (_request, { store }) => {
    const result = store.seed()
    return json({
      ok: true,
      ...result,
      ...(result.seeded ? store.snapshot() : {}),
    })
  },
}

/** @type {RouteSpec} */
export const contextRoute = {
  method: 'GET',
  path: '/api/gantt/context',
  description: 'Export the unified tree and one day plan as markdown. Query: date?, root?, limit?.',
  fetch: async (request, { store }) => {
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
  },
}
