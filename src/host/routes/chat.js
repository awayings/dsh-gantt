// The AI chat route: assemble the model seam, the tree context, and today's
// brief, then run one streamed decompose turn.

import { runChat } from '../chat.js'
import { todayIso } from '../tree.js'
import { json, readBody } from './http.js'

/** @typedef {import('./http.js').RouteSpec} RouteSpec */
/** @type {RouteSpec} */
export const chatRoute = {
  method: 'POST',
  path: '/api/gantt/chat',
  description: 'Chat with the configured model to decompose a task. Body: { message, taskId?, history? }.',
  fetch: async (request, { store, service }) => {
    const body = await readBody(request)
    const defaults = /** @type {any} */ (service('agentDefaultModel'))
    const llm = /** @type {any} */ (service('llm'))
    const context = store.contextDocument({ limit: 12000 })
    const brief = store.dailyBrief(todayIso()).report
    const result = await runChat({
      llm,
      selection: typeof defaults?.currentSelection === 'function' ? defaults.currentSelection() : undefined,
      message: /** @type {string} */ (body.message),
      history: /** @type {any} */ (body.history),
      taskId: /** @type {string | undefined} */ (body.taskId),
      context: { markdown: context.markdown, tasks: store.tree() },
      dailyBrief: brief,
      signal: request.signal,
    })
    return json({ ok: true, ...result })
  },
}
