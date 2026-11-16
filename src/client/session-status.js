// Live Session activity for the Gantt views: the host publishes one running /
// pending-interaction snapshot per Session, which the work-mode filter and the
// task rows read without polling.

import { useCallback, useSyncExternalStore } from 'react'

/** Shared empty snapshot for hosts without the Session UI service. */
export const EMPTY_STATUSES = new Map()

/**
 * Subscribe to the host's per-Session activity snapshot.
 * @param {any} ctx
 * @returns {Map<string, { running?: boolean, pendingInteraction?: unknown }>}
 */
export function useSessionStatuses(ctx) {
  const service = ctx && typeof ctx.get === 'function' ? ctx.get('uiSession') : undefined
  const source = service?.sessionStatus
  const subscribe = useCallback(
    listener => (typeof source?.subscribe === 'function' ? source.subscribe(listener) : () => {}),
    [source],
  )
  const read = useCallback(
    () => (typeof source?.getSnapshot === 'function' ? source.getSnapshot() : EMPTY_STATUSES),
    [source],
  )
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * One task's live activity from its bound work conversation, if any.
 * @param {Map<string, { running?: boolean, pendingInteraction?: unknown }>} statuses
 * @param {{ workSessionId?: string | null } | null} task
 * @returns {'waiting' | 'running' | null}
 */
export function taskActivity(statuses, task) {
  const sessionId = typeof task?.workSessionId === 'string' ? task.workSessionId : ''
  if (sessionId === '') return null
  const status = statuses?.get(sessionId)
  if (status === undefined) return null
  if (status.pendingInteraction !== undefined) return 'waiting'
  if (status.running === true) return 'running'
  return null
}

/**
 * The displayed state of one work conversation, falling back to the Session
 * list's running flag when the live status is not known yet.
 * @param {Map<string, { running?: boolean, pendingInteraction?: unknown }>} statuses
 * @param {string | null} sessionId
 * @param {boolean} [fallbackRunning]
 * @returns {'waiting' | 'running' | 'idle'}
 */
export function conversationState(statuses, sessionId, fallbackRunning = false) {
  const status = typeof sessionId === 'string' && sessionId !== '' ? statuses?.get(sessionId) : undefined
  if (status?.pendingInteraction !== undefined) return 'waiting'
  if (status?.running === true) return 'running'
  return fallbackRunning ? 'running' : 'idle'
}
