// Client-side work-mode navigation: one task owns one dedicated main
// conversation in the work workspace, created on demand and reopened by id.
// The session and workspace services are resolved lazily through `ctx.get`, so
// a host without them leaves work mode visibly unavailable instead of failing
// during render.

import { requestJson } from './hooks.js'

/** The better-sidebar tab that hosts the workbench. */
export const WORK_TAB_ID = 'gantt-work'

let workFocusRevision = 0
/** @type {Set<() => void>} */
const workFocusListeners = new Set()

/**
 * Tell mounted workbenches that the conversation's focused task changed, so an
 * already-open tab refetches even when opening it does not remount anything.
 * @returns {void}
 */
export function noteWorkFocus() {
  workFocusRevision += 1
  for (const listener of [...workFocusListeners]) listener()
}

/**
 * Subscribe to focus revisions for `useSyncExternalStore`.
 * @param {() => void} listener
 * @returns {() => void}
 */
export function subscribeWorkFocus(listener) {
  workFocusListeners.add(listener)
  return () => workFocusListeners.delete(listener)
}

/** @returns {number} */
export function workFocusRevisionSnapshot() {
  return workFocusRevision
}

/**
 * Resolve the optional client services work mode needs. Absent services stay
 * null so callers can test availability without catching.
 * @param {any} ctx
 * @returns {{ sessions: any, uiWorkspace: any, workspaces: any, betterSidebar: any }}
 */
export function workServices(ctx) {
  const get = name => (typeof ctx?.get === 'function' ? ctx.get(name) : undefined)
  const sessions = get('sessions')
  const uiWorkspace = get('uiWorkspace')
  return {
    sessions: typeof sessions?.create === 'function' ? sessions : null,
    uiWorkspace: typeof uiWorkspace?.openSession === 'function' ? uiWorkspace : null,
    workspaces: get('workspaces') ?? null,
    betterSidebar: get('betterSidebar') ?? null,
  }
}

/**
 * Whether this host can open a task's work conversation.
 * @param {any} ctx
 * @returns {boolean}
 */
export function canOpenWorkTask(ctx) {
  const services = workServices(ctx)
  return services.sessions !== null && services.uiWorkspace !== null
}

/**
 * Whether this host can create and bind a task's work conversation. Opening
 * that conversation needs `uiWorkspace`, but the in-page panel and its execute
 * button only need the session service.
 * @param {any} ctx
 * @returns {boolean}
 */
export function canExecuteWorkTask(ctx) {
  return workServices(ctx).sessions !== null
}

/** A non-empty string service field, or null. @param {unknown} value @returns {string | null} */
function idOf(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * The Session on screen: the conversation whose sidebar hosts the workbench
 * tab. The better-sidebar snapshot names it while that panel is mounted; the
 * ui-session main binding names it even when the right sidebar is closed.
 * @param {any} ctx
 * @returns {string | null}
 */
export function activeSessionId(ctx) {
  const services = workServices(ctx)
  const fromSidebar = idOf(services.betterSidebar?.getSnapshot?.()?.sessionId)
  if (fromSidebar !== null) return fromSidebar
  const get = name => (typeof ctx?.get === 'function' ? ctx.get(name) : undefined)
  const uiSession = get('uiSession')
  const binding = uiSession?.adapter?.current?.value ?? uiSession?.current?.value
  return idOf(binding?.key)
}

/**
 * The workspace whose registered path equals the work directory, or null when
 * the directory is not a registered Workspace.
 * @param {any} workspaces
 * @param {unknown} cwd
 * @returns {string | null}
 */
export function workspaceIdFor(workspaces, cwd) {
  const source = workspaces?.list
  if (typeof source?.getSnapshot !== 'function' || typeof cwd !== 'string' || cwd === '') return null
  const items = source.getSnapshot()?.items
  if (!Array.isArray(items)) return null
  const match = items.find(item => item?.path === cwd)
  return typeof match?.workspaceId === 'string' && match.workspaceId !== '' ? match.workspaceId : null
}

/**
 * Read the focused task, its bound work conversation, and the work directory.
 * @param {{ taskId?: string | null, sessionId?: string | null }} [target]
 * @returns {Promise<{ ok: boolean, cwd: string, task: any, sessionId: string | null }>}
 */
export function loadWork(target = {}) {
  const taskId = target.taskId ?? null
  const sessionId = target.sessionId ?? null
  const query = new URLSearchParams()
  if (taskId !== null && taskId !== '') query.set('taskId', taskId)
  if (sessionId !== null && sessionId !== '') query.set('sessionId', sessionId)
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`
  return requestJson(`api/gantt/work${suffix}`)
}

/**
 * Open the workbench tab in one session's right sidebar when the host has one.
 * @param {any} betterSidebar
 * @param {string} sessionId
 * @returns {void}
 */
export function openWorkbenchTab(betterSidebar, sessionId) {
  if (typeof betterSidebar?.openTab !== 'function') return
  betterSidebar.openTab({ type: WORK_TAB_ID }, { sessionId })
}

/**
 * Open the task's content-dedicated conversation: reuse the bound session and
 * refresh its focus, or create a session in the work workspace and bind it.
 * @param {any} ctx
 * @param {{ id: string }} task
 * @param {{ open?: boolean }} [options] `open: false` only resolves and binds
 *   the conversation, leaving navigation to the caller (the new-window path).
 * @returns {Promise<{ sessionId: string, created: boolean }>}
 */
export async function openWorkTask(ctx, task, options = {}) {
  const open = options.open !== false
  const services = workServices(ctx)
  if (services.sessions === null || (open && services.uiWorkspace === null)) {
    throw new Error('work mode needs the session and workspace services')
  }
  const work = await loadWork({ taskId: task.id })
  const bound = typeof work.sessionId === 'string' && work.sessionId !== '' ? work.sessionId : null
  if (bound !== null) {
    await requestJson('api/gantt/focus/set', {
      method: 'POST',
      body: JSON.stringify({ sessionId: bound, taskId: task.id }),
    })
    if (open) {
      services.uiWorkspace.openSession(bound)
      openWorkbenchTab(services.betterSidebar, bound)
    }
    return { sessionId: bound, created: false }
  }
  const cwd = typeof work.cwd === 'string' ? work.cwd : ''
  const workspaceId = workspaceIdFor(services.workspaces, cwd)
  if (workspaceId === null && cwd === '') throw new Error('the host reported no work directory')
  const sessionId = await services.sessions.create(workspaceId === null ? { cwd } : { workspaceId })
  await requestJson('api/gantt/work/session', {
    method: 'POST',
    body: JSON.stringify({ taskId: task.id, sessionId }),
  })
  if (open) {
    services.uiWorkspace.openSession(sessionId)
    openWorkbenchTab(services.betterSidebar, sessionId)
  }
  return { sessionId, created: true }
}
