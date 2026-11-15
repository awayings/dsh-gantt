// Plan routes: the day bundle read, block status updates, and the tracker import.

import path from 'node:path'
import { GanttError } from '../errors.js'
import { importTaskTracker, resolveTrackerDir } from '../tracker.js'
import { todayIso } from '../tree.js'
import { json, readBody, requestedDate, requiredId } from './http.js'

/** @typedef {import('../store.js').PlanStatus} PlanStatus */
/** @typedef {import('./http.js').RouteSpec} RouteSpec */
/** @type {RouteSpec} */
export const dayRoute = {
  method: 'GET',
  path: '/api/gantt/day',
  description: 'Read one day plan bundle. Query: date=YYYY-MM-DD (defaults to today).',
  fetch: async (request, { store }) => {
    const target = requestedDate(request)
    return json({ ok: true, today: todayIso(), date: target, ...store.dayPlan(target) })
  },
}

/** @type {RouteSpec} */
export const planStatusRoute = {
  method: 'POST',
  path: '/api/gantt/plan/status',
  description: 'Set a plan block status and optional notes. Body: { id, status, notes? }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    const id = requiredId(body)
    const block = store.setBlockStatus(
      id,
      /** @type {PlanStatus} */ (body.status),
      /** @type {string | null | undefined} */ (body.notes),
    )
    return json({ ok: true, block })
  },
}

/** @type {RouteSpec} */
export const planImportRoute = {
  method: 'POST',
  path: '/api/gantt/plan/import',
  description: 'Import the tracker markdown. Body: { dir?, year? }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    const dir = body.dir === undefined ? resolveTrackerDir() : body.dir
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new GanttError('dir must be an absolute path')
    const { year } = body
    if (year !== undefined && (typeof year !== 'number' || !Number.isInteger(year) || year < 1970 || year > 9999)) {
      throw new GanttError('year must be an integer from 1970 to 9999')
    }
    const imported = importTaskTracker(store, { dir, year: /** @type {number | undefined} */ (year) })
    return json({ ok: true, dir, imported })
  },
}
