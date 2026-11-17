// Read-only task picks: the ready/next/todo leaves an external agent can pull
// without scanning the whole tree.

import { GanttError } from '../errors.js'
import { computeBrief } from './brief.js'
import { flattenTree } from './build.js'
import { dotIdOf } from './refs.js'

/** @typedef {import('./build.js').TreeTaskNode} TreeTaskNode */
/** @typedef {'ready' | 'next' | 'todo'} ReadyTag */

/** The ready-list vocabularies, in documented order. @type {ReadyTag[]} */
export const READY_TAGS = ['ready', 'next', 'todo']

/** One picked leaf plus the track that owns it. @typedef {{ task: TreeTaskNode,
 * trackId: string, trackName: string }} ReadyEntry */

/** @param {TreeTaskNode} task @returns {boolean} */
function isPendingLeaf(task) {
  return task.children.length === 0 && (task.status === 'todo' || task.status === 'blocked')
}

/** The dependency state of every imported node, keyed by its dotted id.
 * @param {TreeTaskNode[]} tree @returns {Map<string, string>} */
function statusByDotId(tree) {
  /** @type {Map<string, string>} */
  const statuses = new Map()
  for (const task of flattenTree(tree)) {
    if (task.kind === 'node') statuses.set(dotIdOf(task.ref), task.status)
  }
  return statuses
}

/** @param {TreeTaskNode} task @param {Map<string, string>} statuses @returns {boolean} */
function isReady(task, statuses) {
  return task.dep === '' || statuses.get(dotIdOf(task.dep)) === 'done'
}

/**
 * Collect the pending leaves selected by one vocabulary, grouped by tree root
 * in rendered track order and then in document order.
 * @param {TreeTaskNode[]} tree
 * @param {ReadyTag} tag
 * @returns {ReadyEntry[]}
 */
export function collectReadyTasks(tree, tag) {
  if (!READY_TAGS.includes(tag)) throw new GanttError(`tag must be one of ${READY_TAGS.join(', ')}`)
  if (tag === 'next') {
    const byId = new Map(flattenTree(tree).map(task => [task.id, task]))
    return computeBrief(tree).next.map(entry => ({
      task: /** @type {TreeTaskNode} */ (byId.get(entry.id)),
      trackId: entry.trackId,
      trackName: entry.trackName,
    }))
  }
  const statuses = statusByDotId(tree)
  /** @type {ReadyEntry[]} */
  const entries = []
  for (const root of tree) {
    for (const task of flattenTree([root])) {
      if (!isPendingLeaf(task)) continue
      if (tag === 'ready' && !isReady(task, statuses)) continue
      entries.push({ task, trackId: root.id, trackName: root.title })
    }
  }
  return entries
}
