// The gantt plugin's host entry: one SQLite store, its task-day 08:00 daily
// recompute, and the seventeen authenticated `/api/gantt/*` JSON routes.

import { GanttStore, resolveDatabasePath } from './store.js'
import { registerRoutes } from './routes/index.js'

/** @typedef {import('./routes/http.js').GanttContext} GanttContext */
/** @typedef {import('./routes/http.js').GanttEndpoint} GanttEndpoint */
/** @typedef {import('./routes/http.js').GanttRoute} GanttRoute */
/** @typedef {import('./store.js').PlanStatus} PlanStatus */
/** @typedef {import('./store.js').SplitChild} SplitChild */
/** @typedef {import('./store.js').TaskInput} TaskInput */
/** @typedef {import('./store.js').TaskPatch} TaskPatch */
/** @typedef {import('./store.js').TaskStatus} TaskStatus */

export const name = 'gantt'
export const inject = ['connection']

/**
 * Register the store, the scheduler effect, the route table, and the service
 * seam the chat route reads the model from.
 * @param {GanttContext} ctx
 * @returns {void}
 */
export function apply(ctx) {
  const store = new GanttStore(resolveDatabasePath())
  ctx.effect(() => () => store.close(), 'gantt: close SQLite database')
  ctx.effect(() => store.startScheduler(), 'gantt: recompute the daily brief at 08:00')
  registerRoutes(ctx, store, name => (typeof ctx.get === 'function' ? ctx.get(name) : undefined))
}
