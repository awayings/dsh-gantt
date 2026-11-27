// Dispatch-notice ledger: the durable queue that carries one remote write-back
// to the conversation that delegated the task. The delegate tool arms a row
// (task + dispatching session); the MCP sidecar completes it when a remote
// worker writes a status back through report_completion/update_task; the host
// plugin drains completed rows by steering one lightweight message into the
// dispatching conversation. The task tree and its trajectory stay the state
// authority — a notice row is only an event signal, so a lost or duplicated
// row degrades to the pre-notice behavior (the dispatcher reads the
// trajectory) instead of corrupting any state.

import { randomUUID } from 'node:crypto'
import { GanttError } from '../errors.js'
import { oneOf } from './tasks.js'

/** @typedef {import('./gantt.js').GanttStore} GanttStore */
/** @typedef {import('../tree.js').TaskStatus} TaskStatus */

/** Column names one notice row carries, snake_case in storage, camelCase out. */
const NOTICE_SELECT = 'SELECT id, task_id AS taskId, session_id AS sessionId, status, agent_name AS agentName, created_at AS createdAt, completed_at AS completedAt, delivered_at AS deliveredAt, outcome FROM dispatch_notices'

/** One dispatch-notice row.
 * @typedef {{ id: string, taskId: string, sessionId: string, status: string,
 * agentName: string, createdAt: string, completedAt: string | null,
 * deliveredAt: string | null, outcome: string }} DispatchNotice */

/**
 * Statuses a remote write-back that deserve waking the dispatching
 * conversation: the terminal and attention states. `in_progress`/`todo`
 * restarts stay silent so a delegation pokes the dispatcher only when there
 * is something to relay or re-locate.
 * @type {TaskStatus[]}
 */
export const NOTICE_STATUSES = ['done', 'blocked', 'cancelled']

/** Rows one drain pass delivers at most, keeping a single tick bounded. */
export const DRAIN_BATCH_LIMIT = 20

/**
 * Arm one notice row: the task being delegated and the conversation to poke
 * when a remote write-back lands. Called by the delegate tool with its own
 * session, so the row is the only place that remembers who dispatched.
 * @param {GanttStore} store
 * @param {unknown} taskId
 * @param {unknown} sessionId
 * @returns {DispatchNotice}
 */
export function armDispatchNotice(store, taskId, sessionId) {
  const task = store.requireRow(taskId)
  if (typeof sessionId !== 'string' || sessionId.trim() === '') throw new GanttError('sessionId is required')
  const id = randomUUID()
  const at = new Date().toISOString()
  store.db.prepare(
    'INSERT INTO dispatch_notices (id, task_id, session_id, status, agent_name, created_at, completed_at, delivered_at, outcome) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)',
  ).run(id, task.id, sessionId.trim(), '', '', at, '')
  return /** @type {DispatchNotice} */ (store.db.prepare(`${NOTICE_SELECT} WHERE id = ?`).get(id))
}

/**
 * Complete the newest armed notice of one task: a remote worker just wrote a
 * status back. Only the latest delegation is completed — an earlier armed row
 * of a re-delegated task stays armed and later expires. The status and the
 * reporting agent name are recorded as the event signal the drain delivers.
 * @param {GanttStore} store
 * @param {unknown} taskId
 * @param {{ status: unknown, agentName?: unknown }} input
 * @returns {DispatchNotice | null} the completed row, or null when the task
 *   has no armed notice (it was never delegated through the tool)
 */
export function completeDispatchNotice(store, taskId, input) {
  const task = store.requireRow(taskId)
  const status = oneOf(input.status, 'status', ['todo', 'in_progress', 'blocked', 'done', 'cancelled'])
  const agentName = input.agentName === undefined || input.agentName === null ? '' : String(input.agentName).slice(0, 100)
  const row = /** @type {DispatchNotice | undefined} */ (store.db.prepare(
    `${NOTICE_SELECT} WHERE task_id = ? AND status = '' AND delivered_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  ).get(task.id))
  if (row === undefined) return null
  const at = new Date().toISOString()
  store.db.prepare(
    'UPDATE dispatch_notices SET status = ?, agent_name = ?, completed_at = ? WHERE id = ?',
  ).run(status, agentName, at, row.id)
  return /** @type {DispatchNotice} */ (store.db.prepare(`${NOTICE_SELECT} WHERE id = ?`).get(row.id))
}

/**
 * The completed notices waiting for delivery, oldest write-back first.
 * @param {GanttStore} store
 * @param {number} [limit]
 * @returns {DispatchNotice[]}
 */
export function pendingDispatchNotices(store, limit = DRAIN_BATCH_LIMIT) {
  return /** @type {DispatchNotice[]} */ (store.db.prepare(
    `${NOTICE_SELECT} WHERE completed_at IS NOT NULL AND delivered_at IS NULL ORDER BY completed_at, rowid LIMIT ?`,
  ).all(Math.max(1, Math.min(100, Math.floor(limit)))))
}

/**
 * Mark one notice delivered. Real steering records `steered`; the expiry
 * sweep records `expired`. A row is never delivered twice.
 * @param {GanttStore} store
 * @param {string} id
 * @param {'steered' | 'expired'} outcome
 * @returns {void}
 */
export function markDispatchNoticeDelivered(store, id, outcome) {
  store.db.prepare(
    'UPDATE dispatch_notices SET delivered_at = ?, outcome = ? WHERE id = ? AND delivered_at IS NULL',
  ).run(new Date().toISOString(), oneOf(outcome, 'outcome', ['steered', 'expired']), id)
}

/**
 * Expire notices whose delegation went quiet: armed rows never completed and
 * completed rows never delivered, both older than the cutoff. The sweep keeps
 * the pending set bounded; the trajectory keeps the truth either way.
 * @param {GanttStore} store
 * @param {string} cutoffIso created_at rows older than this expire
 * @returns {number} rows expired by this sweep
 */
export function expireDispatchNotices(store, cutoffIso) {
  const count = store.db.prepare(
    "UPDATE dispatch_notices SET delivered_at = ?, outcome = 'expired' WHERE delivered_at IS NULL AND created_at < ?",
  ).run(new Date().toISOString(), cutoffIso).changes
  return Number(count)
}
