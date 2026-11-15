// The read-time brief: pending leaves, frontier, and next pick per track.

/** @typedef {import('./refs.js').TaskStatus} TaskStatus */
/** @typedef {import('./build.js').TreeTaskNode} TreeTaskNode */

import { flattenTree } from './build.js'
import { compareRefs, dotIdOf } from './refs.js'

/**
 * One entry of the brief's frontier / next lists.
 * @typedef {object} BriefEntry
 * @property {string} id
 * @property {string} ref
 * @property {string} number
 * @property {string} title
 * @property {string} trackId
 * @property {string} trackName
 */

/**
 * One track's brief row.
 * @typedef {object} BriefLane
 * @property {string} id
 * @property {string} ref
 * @property {string} name
 * @property {string} lane
 * @property {string} state
 * @property {string} blocker
 * @property {BriefEntry | null} frontier
 * @property {BriefEntry | null} next
 */

/**
 * The read-time brief shipped with `GET /tree`.
 * @typedef {object} Brief
 * @property {number} pending
 * @property {BriefEntry[]} frontier
 * @property {BriefEntry[]} next
 * @property {BriefLane[]} lanes
 */


/**
 * @param {TreeTaskNode} task
 * @returns {boolean}
 */
function isPendingLeaf(task) {
  return task.children.length === 0 && (task.status === 'todo' || task.status === 'blocked')
}

/**
 * @param {TreeTaskNode} task
 * @param {Map<string, TaskStatus>} statusByNodeId
 * @returns {boolean}
 */
function isReady(task, statusByNodeId) {
  return task.dep === '' || statusByNodeId.get(task.dep) === 'done'
}

/**
 * @param {TreeTaskNode} task
 * @param {TreeTaskNode} track
 * @returns {BriefEntry}
 */
function briefEntry(task, track) {
  return {
    id: task.id,
    ref: task.ref,
    number: task.number,
    title: task.title,
    trackId: track.id,
    trackName: track.title,
  }
}

/**
 * Compute the frontier / next report from the rendered tree. Pure read: nothing
 * is persisted.
 * @param {TreeTaskNode[]} tree
 * @returns {Brief}
 */
export function computeBrief(tree) {
  const all = flattenTree(tree)
  /** @type {Map<string, TaskStatus>} */
  const statusByNodeId = new Map()
  for (const task of all) {
    if (task.kind === 'node') statusByNodeId.set(dotIdOf(task.ref), task.status)
  }
  /** @type {BriefEntry[]} */
  const frontier = []
  /** @type {BriefEntry[]} */
  const next = []
  /** @type {BriefLane[]} */
  const lanes = []
  for (const track of tree) {
    if (track.kind !== 'track') continue
    const candidates = flattenTree(track.children).filter(isPendingLeaf)
    const ordered = candidates.slice().sort((left, right) => compareRefs(left.ref, right.ref))
    const highest = ordered.at(-1) ?? null
    const firstReady = ordered.find(task => isReady(task, statusByNodeId)) ?? null
    if (highest !== null) frontier.push(briefEntry(highest, track))
    if (firstReady !== null) next.push(briefEntry(firstReady, track))
    lanes.push({
      id: track.id,
      ref: track.ref,
      name: track.title,
      lane: track.lane,
      state: track.state,
      blocker: track.description,
      frontier: highest === null ? null : briefEntry(highest, track),
      next: firstReady === null ? null : briefEntry(firstReady, track),
    })
  }
  return {
    pending: all.filter(isPendingLeaf).length,
    frontier,
    next,
    lanes,
  }
}
