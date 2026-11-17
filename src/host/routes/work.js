// Work-mode routes: the task ⇄ dedicated-conversation mapping, the work
// directory, and the optional host services a work conversation exposes to the
// workbench tab (skills and the conversation's agent team).

import { GanttError } from '../errors.js'
import { resolveWorkCwd } from '../store.js'
import { json, readBody } from './http.js'

/** @typedef {import('../store.js').GanttStore} GanttStore */
/** @typedef {import('../tree/build.js').TreeTaskNode} TreeTaskNode */
/** @typedef {import('./http.js').RouteDeps} RouteDeps */
/** @typedef {import('./http.js').RouteSpec} RouteSpec */

/** The subagent modes the workbench renders; an unknown mode is reported as is. */
const AGENT_MODES = ['continuable', 'one-shot', 'external', 'unknown']

/**
 * One query/body string, trimmed; absent or blank values are null.
 * @param {unknown} value
 * @returns {string | null}
 */
function trimmed(value) {
  if (typeof value !== 'string') return null
  const input = value.trim()
  return input === '' ? null : input
}

/**
 * One optional host service, read through the route deps seam.
 * @param {RouteDeps} deps
 * @param {string} name
 * @returns {any}
 */
function serviceOf(deps, name) {
  return typeof deps.get === 'function' ? deps.get(name) : undefined
}

/**
 * A string field of a service record; anything else becomes ''.
 * @param {unknown} value
 * @returns {string}
 */
function textOf(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * The client-facing work task subset: identity, rendered number, status,
 * completion standard, and the completion write-back fields the workbench and
 * the task dialog display.
 * @param {GanttStore} store
 * @param {string} taskId
 * @returns {{ id: string, number: string, ref: string, title: string, status: string,
 * progress: number, doneWhen: string, operatorId: string, completedById: string, report: string }}
 */
function workTask(store, taskId) {
  const node = /** @type {TreeTaskNode} */ (store.getNode(taskId))
  return {
    id: node.id,
    number: node.number,
    ref: node.ref,
    title: node.title,
    status: node.status,
    progress: node.progress,
    doneWhen: node.doneWhen,
    operatorId: node.operatorId,
    completedById: node.completedById,
    report: node.report,
  }
}

/** @type {RouteSpec} */
export const workRoute = {
  method: 'GET',
  path: '/api/gantt/work',
  description: 'Read a task\'s work directory, its dedicated conversation, and the focused task. Query: taskId?, sessionId?.',
  fetch: async (request, deps) => {
    const { store } = deps
    const params = new URL(request.url, 'http://localhost').searchParams
    const taskId = trimmed(params.get('taskId'))
    const sessionId = trimmed(params.get('sessionId'))
    if (taskId === null && sessionId === null) throw new GanttError('taskId or sessionId is required')
    /** @type {string | null} */
    let resolved = null
    if (taskId !== null) resolved = store.requireRow(taskId).id
    else resolved = store.focusOf(/** @type {string} */ (sessionId)) ?? store.workTaskOf(/** @type {string} */ (sessionId))
    const task = resolved === null ? null : workTask(store, resolved)
    return json({
      ok: true,
      cwd: resolveWorkCwd(),
      task,
      sessionId: task === null ? null : store.workSessionOf(task.id),
    })
  },
}

/** @type {RouteSpec} */
export const workSessionRoute = {
  method: 'POST',
  path: '/api/gantt/work/session',
  description: 'Bind a task to its content-dedicated conversation and focus that conversation. Body: { taskId, sessionId }.',
  fetch: async (request, { store }) => {
    const body = await readBody(request)
    const taskId = trimmed(body.taskId)
    if (taskId === null) throw new GanttError('taskId is required')
    const bound = store.transaction(() => {
      const result = store.upsertWorkSession(taskId, body.sessionId)
      store.setFocus(result.sessionId, result.taskId)
      return result
    })
    return json({ ok: true, ...bound })
  },
}

/** @type {RouteSpec} */
export const workSkillsRoute = {
  method: 'GET',
  path: '/api/gantt/work/skills',
  description: 'List the skills a work conversation can use through the optional host skills service.',
  fetch: async (_request, deps) => {
    const skills = serviceOf(deps, 'skills')
    if (typeof skills?.list !== 'function') return json({ ok: true, available: false, skills: [] })
    /** @type {any} */
    let candidates
    try {
      candidates = await skills.list()
    } catch (error) {
      throw new GanttError(error instanceof Error ? error.message : String(error), 500)
    }
    return json({
      ok: true,
      available: true,
      skills: (Array.isArray(candidates) ? candidates : []).map(skill => ({
        name: textOf(skill?.name),
        description: textOf(skill?.description),
        source: textOf(skill?.source),
      })),
    })
  },
}

/** @type {RouteSpec} */
export const workTeamRoute = {
  method: 'GET',
  path: '/api/gantt/work/team',
  description: 'List the subagents of one work conversation through the optional host subagent service. Query: sessionId.',
  fetch: async (request, deps) => {
    const sessionId = trimmed(new URL(request.url, 'http://localhost').searchParams.get('sessionId'))
    if (sessionId === null) throw new GanttError('sessionId is required')
    const subagents = serviceOf(deps, 'subagents')
    if (typeof subagents?.listChildren !== 'function') return json({ ok: true, available: false, agents: [] })
    /** @type {any} */
    let children
    try {
      children = await subagents.listChildren(sessionId)
    } catch (error) {
      return json({ ok: true, available: true, agents: [], error: error instanceof Error ? error.message : String(error) })
    }
    return json({
      ok: true,
      available: true,
      agents: (Array.isArray(children) ? children : []).map(agent => ({
        id: String(agent?.id ?? ''),
        label: textOf(agent?.label),
        mode: AGENT_MODES.find(mode => mode === agent?.mode) ?? 'unknown',
        createdAt: agent?.createdAt ?? null,
      })),
    })
  },
}
