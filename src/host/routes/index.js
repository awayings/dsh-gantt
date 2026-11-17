// The host's route table: every endpoint in the order docs/api.md documents it,
// composed from the per-resource modules and registered on the connection
// service.

import { createSessionTitles } from '../session-titles.js'
import { agentsRoute, readyRoute, registerAgentRoute, reportCompletionRoute, taskContextRoute } from './agents.js'
import { briefComputeRoute, briefRoute } from './brief.js'
import { registerRouteGroup } from './http.js'
import { focusRoute, setFocusRoute, trajectoryRoute } from './focus.js'
import { contextRoute, metaRoute, seedRoute } from './meta.js'
import { dayRoute, planImportRoute, planStatusRoute } from './plan.js'
import { createTaskRoute, decomposeRoute, deleteTaskRoute, scheduleTaskRoute, splitTaskRoute, statusRoute, treeRoute, updateTaskRoute } from './tasks.js'
import { workRoute, workSessionRoute, workSkillsRoute, workTeamRoute } from './work.js'

/** @typedef {import('./http.js').GanttContext} GanttContext */
/** @typedef {import('./http.js').GanttEndpoint} GanttEndpoint */
/** @typedef {import('./http.js').RouteSpec} RouteSpec */
/** @typedef {import('../store.js').GanttStore} GanttStore */
/** @type {RouteSpec[]} */
const ROUTES = [
  treeRoute,
  agentsRoute,
  registerAgentRoute,
  taskContextRoute,
  readyRoute,
  reportCompletionRoute,
  focusRoute,
  setFocusRoute,
  trajectoryRoute,
  workRoute,
  workSessionRoute,
  workSkillsRoute,
  workTeamRoute,
  metaRoute,
  createTaskRoute,
  updateTaskRoute,
  statusRoute,
  splitTaskRoute,
  deleteTaskRoute,
  seedRoute,
  dayRoute,
  planStatusRoute,
  planImportRoute,
  decomposeRoute,
  scheduleTaskRoute,
  contextRoute,
  briefRoute,
  briefComputeRoute,
]

/** The endpoint catalog served by `GET /meta`. @type {GanttEndpoint[]} */
export const ENDPOINTS = ROUTES.map(({ method, path, description }) => ({ method, path, description }))

/**
 * Register every host route on the connection service.
 * @param {GanttContext} ctx
 * @param {GanttStore} store
 * @param {import('../session-titles.js').SessionTitles} [titles]
 * @returns {void}
 */
export function registerRoutes(ctx, store, titles = createSessionTitles()) {
  /** @type {import('./http.js').RouteDeps} */
  const deps = { store, endpoints: ENDPOINTS, get: name => ctx.get?.(name), titles }
  /** @type {Map<string, RouteSpec[]>} */
  const byPath = new Map()
  for (const spec of ROUTES) {
    const specs = byPath.get(spec.path)
    if (specs === undefined) byPath.set(spec.path, [spec])
    else specs.push(spec)
  }
  for (const specs of byPath.values()) registerRouteGroup(ctx, specs, deps)
}
