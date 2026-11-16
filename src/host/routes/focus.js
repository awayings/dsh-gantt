// Focus routes: which task one conversation is focused on. The sidebar panel
// writes it when the user clicks a row; the assistant tools read it so the
// model works on the chain the user is looking at.

import { json, readBody } from './http.js'

/** @typedef {import('./http.js').RouteSpec} RouteSpec */

/** @type {RouteSpec} */
export const focusRoute = {
  method: 'GET',
  path: '/api/gantt/focus',
  description: 'Read the task one conversation is focused on. Query: sessionId.',
  fetch: async (request, { store }) => {
    const sessionId = new URL(request.url, 'http://localhost').searchParams.get('sessionId')
    return json({ ok: true, taskId: store.focusOf(/** @type {string} */ (sessionId)) })
  },
}

/** @type {RouteSpec} */
export const setFocusRoute = {
  method: 'POST',
  path: '/api/gantt/focus/set',
  description: 'Focus one task for a conversation, or clear it. Body: { sessionId, taskId }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    const taskId = body.taskId === undefined || body.taskId === null ? null : body.taskId
    return json({ ok: true, taskId: store.setFocus(/** @type {string} */ (body.sessionId), /** @type {string | null} */ (taskId)) })
  },
}
