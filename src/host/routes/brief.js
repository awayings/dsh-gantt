// Brief routes: the daily report read and the manual recompute.

import { todayIso } from '../tree.js'
import { json, readBody, requestedDate } from './http.js'

/** @typedef {import('./http.js').RouteSpec} RouteSpec */
/** @type {RouteSpec} */
export const briefRoute = {
  method: 'GET',
  path: '/api/gantt/brief',
  description: 'Read the daily 该动 brief for one date. Query: date=YYYY-MM-DD (defaults to today).',
  fetch: async (request, { store }) => {
    const target = requestedDate(request)
    const result = store.dailyBrief(target)
    return json({ ok: true, today: todayIso(), date: target, brief: result.report, cached: result.cached })
  },
}

/** @type {RouteSpec} */
export const briefComputeRoute = {
  method: 'POST',
  path: '/api/gantt/brief/compute',
  description: 'Recompute and persist the daily 该动 brief. Body: { date? }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    const target = body.date === undefined ? todayIso() : /** @type {string} */ (body.date)
    const brief = store.computeDailyBrief(target, { source: 'manual' })
    return json({ ok: true, today: todayIso(), date: brief.date, brief, cached: false })
  },
}
