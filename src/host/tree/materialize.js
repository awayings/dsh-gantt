// Materialise the tracker snapshot (tracks, nodes) into the unified task tree.

import { compareDotIds } from './refs.js'

/** @typedef {import('./refs.js').TaskKind} TaskKind */
/** @typedef {import('./refs.js').TaskStatus} TaskStatus */
/** @typedef {import('./links.js').TaskLink} TaskLink */


/**
 * One imported track row from the tracker snapshot.
 * @typedef {object} SnapshotTrack
 * @property {string} id
 * @property {string} name
 * @property {unknown} [lane]
 * @property {unknown} [state]
 * @property {unknown} [blocker]
 * @property {number} [sortOrder]
 */

/**
 * One imported node row from the tracker snapshot.
 * @typedef {object} SnapshotNode
 * @property {string} id
 * @property {unknown} [trackId]
 * @property {string} title
 * @property {unknown} [state]
 * @property {string | null} [startDate]
 * @property {string | null} [endDate]
 * @property {unknown} [dep]
 * @property {unknown} [doneWhen]
 */

/**
 * The subset of an existing task row that materialisation reads.
 * @typedef {object} ExistingTask
 * @property {string} id
 * @property {TaskKind} kind
 * @property {string} ref
 * @property {string} state
 * @property {TaskStatus} status
 * @property {number} progress
 * @property {TaskLink[]} links
 * @property {string | null} parentId
 * @property {string} source
 */

/**
 * One task row that materialisation wants to keep in sync.
 * @typedef {object} MaterializedTask
 * @property {TaskKind} kind
 * @property {string} ref
 * @property {string} title
 * @property {string} description
 * @property {TaskStatus} status
 * @property {number} progress
 * @property {string} state
 * @property {string} lane
 * @property {string} dep
 * @property {string} doneWhen
 * @property {string} landing
 * @property {string} estimate
 * @property {string} category
 * @property {string} inspiration
 * @property {TaskLink[]} links
 * @property {string} source
 * @property {string | null} parentRef
 * @property {number} sortOrder
 * @property {string} startDate
 * @property {string} endDate
 */

/** @typedef {MaterializedTask & { id: string }} MaterializedUpdate */

/**
 * The three deltas one materialisation pass produces.
 * @typedef {object} Materialization
 * @property {MaterializedTask[]} inserts
 * @property {MaterializedUpdate[]} updates
 * @property {string[]} deletes
 */

const DONE_STATES = ['已过', '已完成', '完成', '撤销']
const PROGRESS_STATES = ['进行', '进行中', '在做']
const BLOCKED_STATES = ['卡住']
const TODO_STATES = ['未开始', '已立项', '待定', '没开始', '未知']

/** @type {Map<string, string>} */
const STATE_ALIASES = new Map()
for (const state of DONE_STATES) STATE_ALIASES.set(state, '已过')
for (const state of PROGRESS_STATES) STATE_ALIASES.set(state, '进行')
for (const state of BLOCKED_STATES) STATE_ALIASES.set(state, '卡住')
for (const state of TODO_STATES) STATE_ALIASES.set(state, '未开始')
STATE_ALIASES.set('撤销', '撤销')

/**
 * Normalize a tracker state word to the canonical vocabulary. Unknown words are
 * kept verbatim: the tracker vocabulary is allowed to evolve.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeTrackerState(raw) {
  const state = typeof raw === 'string' ? raw.trim() : ''
  return STATE_ALIASES.get(state) ?? state
}

/**
 * Map any tracker state word (raw or normalized) to a task status.
 * @param {unknown} raw
 * @returns {TaskStatus}
 */
export function statusForState(raw) {
  const state = normalizeTrackerState(raw)
  if (state === '已过' || state === '撤销') return 'done'
  if (state === '进行') return 'in_progress'
  if (state === '卡住') return 'blocked'
  return 'todo'
}

/**
 * The progress a status implies when a tracker state changes.
 * @param {TaskStatus} status
 * @returns {number}
 */
export function progressForStatus(status) {
  if (status === 'done') return 100
  if (status === 'in_progress') return 50
  return 0
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Resolve the parent ref of a dotted node id by walking up its prefix chain:
 * `1.8.1` nests under `node:1.8`, `1.1` under `track:1`, and an id without a
 * matching ancestor becomes a root.
 * @param {string} nodeId
 * @param {Set<string>} nodeIds
 * @param {Set<string>} trackIds
 * @returns {string | null}
 */
function parentRefFor(nodeId, nodeIds, trackIds) {
  let candidate = nodeId
  for (;;) {
    const separator = candidate.lastIndexOf('.')
    if (separator <= 0) return null
    candidate = candidate.slice(0, separator)
    if (nodeIds.has(candidate)) return `node:${candidate}`
    if (trackIds.has(candidate)) return `track:${candidate}`
  }
}

/**
 * Derive the tracker snapshot rows that should exist in `tasks` after an import.
 *
 * Content fields always follow the tracker; the user state (`status` /
 * `progress`) is only overwritten when the normalized tracker state changed.
 * Links are user data and always survive an update. Rows whose ref vanished from
 * the import are deleted only when nothing (user work included) still hangs
 * below them.
 * @param {{ tracks: SnapshotTrack[], nodes: SnapshotNode[], existing: ExistingTask[], today: string }} input
 * @returns {Materialization}
 */
export function materializeTracker({ tracks, nodes, existing, today }) {
  const nodeIds = new Set(nodes.map(node => node.id))
  const trackIds = new Set(tracks.map(track => track.id))
  const laneByTrack = new Map(tracks.map(track => [track.id, text(track.lane)]))
  const existingByKey = new Map(existing.map(row => [`${row.kind}\u0000${row.ref}`, row]))
  /** @type {Map<string, { startDate: string, endDate: string }[]>} */
  const datesByTrack = new Map()

  /** @type {MaterializedTask[]} */
  const nodeDrafts = []
  const sortedNodes = nodes.slice().sort((left, right) => compareDotIds(left.id, right.id))
  sortedNodes.forEach((node, index) => {
    const startDate = node.startDate ?? today
    const endDate = node.endDate ?? (startDate <= today ? today : startDate)
    const trackId = text(node.trackId)
    const members = datesByTrack.get(trackId)
    if (members) members.push({ startDate, endDate })
    else datesByTrack.set(trackId, [{ startDate, endDate }])
    const state = normalizeTrackerState(node.state)
    const status = statusForState(state)
    nodeDrafts.push({
      kind: 'node',
      ref: `node:${node.id}`,
      title: node.title,
      description: text(node.doneWhen),
      status,
      progress: progressForStatus(status),
      state,
      lane: laneByTrack.get(trackId) ?? '',
      dep: text(node.dep),
      doneWhen: text(node.doneWhen),
      landing: '',
      estimate: '',
      category: '',
      inspiration: '',
      links: [],
      source: 'tracker',
      parentRef: parentRefFor(node.id, nodeIds, trackIds),
      sortOrder: index,
      startDate,
      endDate,
    })
  })

  /** @type {MaterializedTask[]} */
  const trackDrafts = tracks.map((track, index) => {
    const members = datesByTrack.get(track.id) ?? []
    const startDate = members.length === 0
      ? today
      : members.reduce((min, member) => (member.startDate < min ? member.startDate : min), members[0].startDate)
    const endDate = members.length === 0
      ? today
      : members.reduce((max, member) => (member.endDate > max ? member.endDate : max), members[0].endDate)
    const state = normalizeTrackerState(track.state)
    const status = statusForState(state)
    return {
      kind: 'track',
      ref: `track:${track.id}`,
      title: track.name,
      description: text(track.blocker),
      status,
      progress: progressForStatus(status),
      state,
      lane: text(track.lane),
      dep: '',
      doneWhen: '',
      landing: '',
      estimate: '',
      category: '',
      inspiration: '',
      links: [],
      source: 'tracker',
      parentRef: null,
      sortOrder: track.sortOrder ?? index,
      startDate,
      endDate,
    }
  })

  /** @type {MaterializedTask[]} */
  const inserts = []
  /** @type {MaterializedUpdate[]} */
  const updates = []
  const currentKeys = new Set()
  for (const draft of [...trackDrafts, ...nodeDrafts]) {
    const key = `${draft.kind}\u0000${draft.ref}`
    currentKeys.add(key)
    const previous = existingByKey.get(key)
    if (previous === undefined) {
      inserts.push(draft)
      continue
    }
    const stateChanged = previous.state !== draft.state
    updates.push({
      ...draft,
      id: previous.id,
      status: stateChanged ? draft.status : previous.status,
      progress: stateChanged ? draft.progress : previous.progress,
      links: previous.links,
    })
  }

  /** @type {Map<string, string[]>} */
  const childrenOf = new Map()
  for (const row of existing) {
    if (row.parentId === null) continue
    const children = childrenOf.get(row.parentId)
    if (children) children.push(row.id)
    else childrenOf.set(row.parentId, [row.id])
  }
  const deletes = new Set(existing
    .filter(row => row.source === 'tracker' && (row.kind === 'track' || row.kind === 'node') && !currentKeys.has(`${row.kind}\u0000${row.ref}`))
    .map(row => row.id))
  let shrinking = true
  while (shrinking) {
    shrinking = false
    for (const id of [...deletes]) {
      const children = childrenOf.get(id) ?? []
      if (children.some(childId => !deletes.has(childId))) {
        deletes.delete(id)
        shrinking = true
      }
    }
  }
  return { inserts, updates, deletes: [...deletes] }
}
