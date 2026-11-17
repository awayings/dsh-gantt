// Agent, task-context, ready-list, and completion-report routes: the HTTP
// surface external coding tools use beside the MCP transport.

import { GanttError } from '../errors.js'
import { json, readBody } from './http.js'

/** @typedef {import('../store.js').AgentInput} AgentInput */
/** @typedef {import('../store.js').ReportCompletionInput} ReportCompletionInput */
/** @typedef {import('../tree/build.js').TreeTaskNode} TreeTaskNode */
/** @typedef {import('./http.js').RouteSpec} RouteSpec */

/** @type {RouteSpec} */
export const agentsRoute = {
  method: 'GET',
  path: '/api/gantt/agents',
  description: 'List registered external operators. Query: type?, role?, q?, limit?.',
  fetch: async (request, { store }) => {
    const params = new URL(request.url, 'http://localhost').searchParams
    const limit = params.get('limit')
    return json({
      ok: true,
      agents: store.listAgents({
        type: params.get('type') ?? undefined,
        role: params.get('role') ?? undefined,
        q: params.get('q') ?? undefined,
        limit: limit === null ? undefined : limit,
      }),
    })
  },
}

/** @type {RouteSpec} */
export const registerAgentRoute = {
  method: 'POST',
  path: '/api/gantt/agents',
  description: 'Register or update an external operator. Body: { id?, name, type, role?, description?, details?, endpoint? }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    return json({ ok: true, agent: store.registerAgent(/** @type {AgentInput} */ (body)) })
  },
}

/** @type {RouteSpec} */
export const taskContextRoute = {
  method: 'GET',
  path: '/api/gantt/task/context',
  description: 'Render one task\'s stable markdown context. Query: taskId.',
  fetch: async (request, { store }) => {
    const taskId = new URL(request.url, 'http://localhost').searchParams.get('taskId')
    if (taskId === null || taskId.trim() === '') throw new GanttError('taskId is required')
    const row = store.requireRow(taskId.trim())
    const context = store.taskContext(row.id)
    const node = /** @type {TreeTaskNode} */ (store.getNode(row.id))
    return json({ ok: true, ...context, task: contextTask(node) })
  },
}

/** @type {RouteSpec} */
export const readyRoute = {
  method: 'GET',
  path: '/api/gantt/ready',
  description: 'List the ready/next/todo leaves. Query: tag? (ready|next|todo), limit?.',
  fetch: async (request, { store }) => {
    const params = new URL(request.url, 'http://localhost').searchParams
    const limit = params.get('limit')
    return json({ ok: true, ...store.readyTasks({ tag: params.get('tag') ?? undefined, limit: limit === null ? undefined : limit }) })
  },
}

/** @type {RouteSpec} */
export const reportCompletionRoute = {
  method: 'POST',
  path: '/api/gantt/task/report',
  description: 'Write back an agent completion report. Body: { taskId, agentId, report, status?, progress? }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    return json({ ok: true, ...store.reportCompletion(/** @type {ReportCompletionInput} */ (body)) })
  },
}

/**
 * The compact task object returned beside the context markdown.
 * @param {TreeTaskNode} node
 * @returns {import('../store.js').ContextTask}
 */
function contextTask(node) {
  return {
    id: node.id,
    number: node.number,
    ref: node.ref,
    title: node.title,
    status: node.status,
    progress: node.progress,
    doneWhen: node.doneWhen,
  }
}
