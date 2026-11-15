// Pure task-tree helpers: date math, tree building, tracker materialisation,
// link validation, markdown context rendering, and the brief report.
//
// Kept free of SQLite and of store.js so store.js can import from here; every
// function in this module is a pure transformation of its arguments.

import { todayIso } from './clock.js'

/** @typedef {'todo' | 'in_progress' | 'blocked' | 'done'} TaskStatus */
/** @typedef {'track' | 'node' | 'task'} TaskKind */
/** @typedef {'memory' | 'file' | 'url' | 'task' | 'note'} LinkType */

/**
 * A validated task link.
 * @typedef {object} TaskLink
 * @property {LinkType} type
 * @property {string} ref
 * @property {string} [label]
 */

/**
 * One task row as exposed by the API (camelCase, links already parsed).
 * @typedef {object} TreeTask
 * @property {string} id
 * @property {string | null} parentId
 * @property {string} title
 * @property {string} description
 * @property {TaskStatus} status
 * @property {number} progress
 * @property {string} startDate
 * @property {string} endDate
 * @property {number} sortOrder
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {TaskKind} kind
 * @property {string} ref
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
 */

/**
 * A task row placed in the nested tree, with its hierarchy number and rollups.
 * @typedef {TreeTask & { number: string, hasChildren: boolean, children: TreeTaskNode[] }} TreeTaskNode
 */

/** @typedef {{ status: TaskStatus, progress: number, start_date: string, end_date: string }} ChildSummaryRow */

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
 * The day row rendered in the context document.
 * @typedef {object} ContextDay
 * @property {string} weekday
 * @property {string} dayKind
 * @property {boolean} marketOpen
 * @property {string} coreGoal
 */

/**
 * One plan block rendered in the context document.
 * @typedef {object} ContextBlock
 * @property {string} status
 * @property {string} startTime
 * @property {string} endTime
 * @property {string} slot
 * @property {string} category
 * @property {string} title
 * @property {string} landing
 * @property {string} estimate
 * @property {string} inspiration
 */

/**
 * Inputs of the markdown context document.
 * @typedef {object} ContextInput
 * @property {string} date
 * @property {ContextDay | null} day
 * @property {TreeTaskNode[]} trees
 * @property {ContextBlock[]} blocks
 * @property {{ code: string, blockId?: string }[]} integrity
 * @property {{ tracks: number, nodes: number, tasks: number, blocks: number }} counts
 */

/**
 * One rendered document line, carrying the information truncation needs.
 * @typedef {object} ContextLine
 * @property {string} text
 * @property {number} [depth]
 * @property {string} [date]
 */

/** @typedef {{ markdown: string, chars: number, truncated: boolean }} ContextDocument */

/** Allowed `tasks.kind` values. @type {TaskKind[]} */
export const TASK_KINDS = ['track', 'node', 'task']
/** Allowed `TaskLink.type` values. @type {LinkType[]} */
export const LINK_TYPES = ['memory', 'file', 'url', 'task', 'note']
/** Maximum number of links on one task. */
export const MAX_LINKS = 20
const MAX_LINK_REF = 500
const MAX_LINK_LABEL = 120
const DAY_MS = 86_400_000
const DEFAULT_CONTEXT_LIMIT = 12_000
/**
 * Maximum tree nesting depth a `decompose` call may grow the tree to.
 * A track is depth 1, a Hermes node depth 2-3, and the actionable subtask
 * created by `decompose` depth 4: the tracker caps ids at three levels, so a
 * fourth level exists only for the plugin's own work breakdown.
 */
export const DECOMPOSE_MAX_DEPTH = 4
/** Default `GET /context` character budget. */
export const CONTEXT_DEFAULT_LIMIT = DEFAULT_CONTEXT_LIMIT
/** Minimum and maximum `GET /context` character budget. */
export const CONTEXT_MIN_LIMIT = 1_000
export const CONTEXT_MAX_LIMIT = 60_000

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
 * @param {number} value
 * @returns {string}
 */
function pad(value) {
  return String(value).padStart(2, '0')
}

export { todayIso }

/**
 * @param {string} iso
 * @returns {number}
 */
export function isoToDay(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/**
 * @param {number} day
 * @returns {string}
 */
export function dayToIso(day) {
  const date = new Date(day)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * @param {string} iso
 * @param {number} days
 * @returns {string}
 */
export function addDays(iso, days) {
  return dayToIso(isoToDay(iso) + days * DAY_MS)
}

/**
 * Compare two dotted tracker ids (`1.8.4`, `1.9.3`) segment by segment as numbers.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareDotIds(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * @param {string} ref
 * @returns {string}
 */
function dotIdOf(ref) {
  const separator = ref.indexOf(':')
  return separator === -1 ? ref : ref.slice(separator + 1)
}

/**
 * The label a task shows in the context document: its tracker dotted id when it
 * has one, else its derived hierarchy number.
 * @param {TreeTaskNode} task
 * @returns {string}
 */
function displayNumber(task) {
  const separator = task.ref.indexOf(':')
  return separator === -1 ? task.number : task.ref.slice(separator + 1)
}

/**
 * Order task refs by their dotted id; manual tasks (empty ref) sort last.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareRefs(left, right) {
  const leftId = dotIdOf(left)
  const rightId = dotIdOf(right)
  if (leftId === '') return rightId === '' ? 0 : 1
  if (rightId === '') return -1
  return compareDotIds(leftId, rightId)
}

/**
 * The slot a block belongs to, derived from its start clock time only.
 * @param {unknown} start
 * @returns {'morning' | 'daytime' | 'evening' | 'other'}
 */
export function slotForStart(start) {
  if (typeof start !== 'string' || start === '') return 'other'
  if (start < '10:00') return 'morning'
  if (start < '19:30') return 'daytime'
  return 'evening'
}

/**
 * Derive the read-time status of a task that owns children.
 *
 * The rule follows the tracker's own renderer for parents that carry a raw
 * tracker state, in this order: every child done → done; the parent's own state
 * is 进行 → in_progress; any child blocked → blocked; any child in_progress or
 * done → in_progress; otherwise todo. Manual parents (state === '') keep the
 * child-only rule: every child done → done, any blocked child → blocked, any
 * in_progress child or positive rolled-up progress → in_progress, else todo.
 * `progress` is always the mean of the children's progress.
 * @param {{ status: TaskStatus }[]} children
 * @param {number} progress
 * @param {string} [state] the parent's own normalized tracker state ('' for manual)
 * @returns {TaskStatus}
 */
export function deriveSummaryStatus(children, progress, state = '') {
  if (children.length > 0 && children.every(child => child.status === 'done')) return 'done'
  if (state !== '') {
    if (state === '进行') return 'in_progress'
    if (children.some(child => child.status === 'blocked')) return 'blocked'
    if (children.some(child => child.status === 'in_progress' || child.status === 'done')) return 'in_progress'
    return 'todo'
  }
  if (children.some(child => child.status === 'blocked')) return 'blocked'
  if (children.some(child => child.status === 'in_progress') || progress > 0) return 'in_progress'
  return 'todo'
}

/**
 * Build the nested tree, assigning hierarchical numbers and rollup fields.
 * @param {TreeTask[]} rows
 * @returns {TreeTaskNode[]}
 */
export function buildTree(rows) {
  const ids = new Set(rows.map(row => row.id))
  /** @type {Map<string | null, TreeTask[]>} */
  const byParent = new Map()
  for (const row of rows) {
    const parentId = row.parentId && ids.has(row.parentId) ? row.parentId : null
    const siblings = byParent.get(parentId)
    if (siblings) siblings.push({ ...row, parentId })
    else byParent.set(parentId, [{ ...row, parentId }])
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => (
      left.sortOrder - right.sortOrder
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
    ))
  }

  /**
   * @param {string | null} parentId
   * @param {string} prefix
   * @returns {TreeTaskNode[]}
   */
  const build = (parentId, prefix) => (byParent.get(parentId) ?? []).map((row, index) => {
    const number = prefix ? `${prefix}.${index + 1}` : String(index + 1)
    const children = build(row.id, number)
    /** @type {TreeTaskNode} */
    const node = { ...row, number, hasChildren: children.length > 0, children }
    if (children.length > 0) {
      node.startDate = children.reduce((min, child) => (child.startDate < min ? child.startDate : min), children[0].startDate)
      node.endDate = children.reduce((max, child) => (child.endDate > max ? child.endDate : max), children[0].endDate)
      node.progress = Math.round(children.reduce((sum, child) => sum + child.progress, 0) / children.length)
      node.status = deriveSummaryStatus(children, node.progress, node.state)
    }
    return node
  })

  return build(null, '')
}

/**
 * Flatten a forest depth-first into document order.
 * @param {TreeTaskNode[]} nodes
 * @param {TreeTaskNode[]} [output]
 * @returns {TreeTaskNode[]}
 */
export function flattenTree(nodes, output = []) {
  for (const node of nodes) {
    output.push(node)
    flattenTree(node.children, output)
  }
  return output
}

/**
 * @typedef {object} TaskStats
 * @property {number} total
 * @property {number} done
 * @property {number} inProgress
 * @property {number} blocked
 * @property {number} overdue
 * @property {number} progress
 */

/**
 * Summarize every task in the forest for the snapshot's stats bar.
 * @param {TreeTaskNode[]} nodes
 * @returns {TaskStats}
 */
export function summarize(nodes) {
  const flat = flattenTree(nodes)
  const today = todayIso()
  let done = 0
  let inProgress = 0
  let blocked = 0
  let overdue = 0
  for (const task of flat) {
    if (task.status === 'done') done += 1
    else {
      if (task.status === 'in_progress') inProgress += 1
      if (task.status === 'blocked') blocked += 1
      if (task.endDate < today) overdue += 1
    }
  }
  return {
    total: flat.length,
    done,
    inProgress,
    blocked,
    overdue,
    progress: flat.length === 0 ? 0 : Math.round((done / flat.length) * 100),
  }
}

/**
 * Parse the stored JSON links column, degrading corrupt or legacy values to `[]`.
 * @param {unknown} raw
 * @returns {TaskLink[]}
 */
export function parseLinksJson(raw) {
  if (typeof raw !== 'string' || raw === '') return []
  try {
    return parseLinks(JSON.parse(raw)).links
  } catch {
    return []
  }
}

/**
 * Validate a `links` input array. Returns the normalized links or the first
 * validation error; it never throws so the store can map the error to `400`.
 * @param {unknown} value
 * @returns {{ links: TaskLink[], error: string | null }}
 */
export function parseLinks(value) {
  if (value === undefined || value === null) return { links: [], error: null }
  if (!Array.isArray(value)) return { links: [], error: 'links must be an array' }
  if (value.length > MAX_LINKS) return { links: [], error: `links must have at most ${MAX_LINKS} entries` }
  /** @type {TaskLink[]} */
  const links = []
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return { links: [], error: `links[${index}] must be an object` }
    }
    const record = /** @type {Record<string, unknown>} */ (item)
    const type = LINK_TYPES.find(candidate => candidate === record.type)
    if (type === undefined) {
      return { links: [], error: `links[${index}].type must be one of ${LINK_TYPES.join(', ')}` }
    }
    if (typeof record.ref !== 'string') return { links: [], error: `links[${index}].ref must be a string` }
    const ref = record.ref.trim()
    if (ref === '') return { links: [], error: `links[${index}].ref is required` }
    if ([...ref].length > MAX_LINK_REF) {
      return { links: [], error: `links[${index}].ref must be at most ${MAX_LINK_REF} characters` }
    }
    if (record.label !== undefined && record.label !== null && typeof record.label !== 'string') {
      return { links: [], error: `links[${index}].label must be a string` }
    }
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    if ([...label].length > MAX_LINK_LABEL) {
      return { links: [], error: `links[${index}].label must be at most ${MAX_LINK_LABEL} characters` }
    }
    links.push(label === '' ? { type, ref } : { type, ref, label })
  }
  return { links, error: null }
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

/**
 * @param {TreeTaskNode} track
 * @returns {string}
 */
function trackHeadingMeta(track) {
  const parts = []
  if (track.lane !== '') parts.push(track.lane)
  if (track.state !== '') parts.push(track.state)
  if (track.description !== '') parts.push(`卡住：${track.description}`)
  return parts.length === 0 ? '' : `（${parts.join(' · ')}）`
}

/**
 * @param {TreeTaskNode} node
 * @returns {string}
 */
function nodeLine(node) {
  const state = node.state === '' ? '' : ` ${node.state}`
  const parts = [`${displayNumber(node)} ${node.title} [${node.status}${state}] ${node.startDate}→${node.endDate}`]
  if (node.landing !== '') parts.push(`落点 ${node.landing}`)
  if (node.doneWhen !== '') parts.push(`完成标准 ${node.doneWhen}`)
  if (node.dep !== '') parts.push(`依赖 ${node.dep}`)
  if (node.estimate !== '') parts.push(`预估 ${node.estimate}`)
  if (node.category !== '') parts.push(`类 ${node.category}`)
  if (node.inspiration !== '') parts.push(`灵感 ${node.inspiration}`)
  if (node.links.length > 0) parts.push(`链接 ${node.links.map(link => `${link.type}:${link.ref}`).join(', ')}`)
  return parts.join(' · ')
}

/**
 * @param {TreeTaskNode[]} nodes
 * @param {number} depth
 * @param {ContextLine[]} lines
 * @returns {void}
 */
function appendNodeLines(nodes, depth, lines) {
  for (const node of nodes) {
    lines.push({ text: `${'  '.repeat(depth - 2)}- ${nodeLine(node)}`, depth })
    appendNodeLines(node.children, depth + 1, lines)
  }
}

/**
 * @param {ContextDay | null} day
 * @returns {string}
 */
function dayHeading(day) {
  if (day === null) return ''
  const parts = []
  if (day.weekday !== '') parts.push(day.weekday)
  if (day.dayKind === 'weekend') parts.push('周末')
  else if (day.dayKind === 'workday') parts.push('工作日')
  parts.push(day.marketOpen ? '交易日' : '休市')
  return `（${parts.join(' · ')}）`
}

/**
 * @param {ContextBlock} block
 * @returns {string}
 */
function blockLine(block) {
  const time = block.startTime === '' || block.endTime === '' ? (block.startTime || block.slot) : `${block.startTime}-${block.endTime}`
  const title = block.category === '' ? block.title : `${block.category} · ${block.title}`
  const parts = [`[${block.status}] ${time} ${title}`]
  if (block.landing !== '') parts.push(`落点 ${block.landing}`)
  if (block.estimate !== '') parts.push(`预估 ${block.estimate}`)
  if (block.inspiration !== '') parts.push(`灵感 ${block.inspiration}`)
  return parts.join(' · ')
}

/**
 * @param {ContextInput} input
 * @returns {ContextLine[]}
 */
function contextLines(input) {
  /** @type {ContextLine[]} */
  const lines = []
  const { counts } = input
  const headerParts = []
  if (counts.tracks > 0) headerParts.push(`${counts.tracks} 条支线`)
  if (counts.nodes > 0) headerParts.push(`${counts.nodes} 个节点`)
  if (counts.tasks > 0) headerParts.push(`${counts.tasks} 个任务`)
  lines.push({ text: headerParts.length === 0 ? '# 个人任务树' : `# 个人任务树（${headerParts.join(' · ')}）` })
  for (const root of input.trees) {
    lines.push({ text: '' })
    if (root.kind === 'track') {
      lines.push({ text: `## ${displayNumber(root)}. ${root.title}${trackHeadingMeta(root)}` })
      appendNodeLines(root.children, 2, lines)
    } else {
      appendNodeLines([root], 2, lines)
    }
  }
  lines.push({ text: '' })
  lines.push({ text: `## 今日 ${input.date}${dayHeading(input.day)}` })
  if (input.day !== null && input.day.coreGoal !== '') lines.push({ text: `- 核心目标：${input.day.coreGoal}` })
  for (const block of input.blocks) lines.push({ text: `- ${blockLine(block)}`, date: input.date })
  if (input.integrity.length > 0) {
    lines.push({ text: '' })
    lines.push({ text: '## 完整性提示' })
    for (const item of input.integrity) {
      lines.push({ text: `- ${item.code}${item.blockId === undefined ? '' : `: ${item.blockId}`}` })
    }
  }
  return lines
}

/**
 * @param {ContextLine[]} lines
 * @returns {string}
 */
function joinContextLines(lines) {
  return `${lines.map(line => line.text).join('\n')}\n`
}

/**
 * @param {ContextLine[]} lines
 * @returns {number | null}
 */
function deepestDepth(lines) {
  let depth = null
  for (const line of lines) {
    if (line.depth !== undefined && (depth === null || line.depth > depth)) depth = line.depth
  }
  return depth
}

/**
 * @param {ContextLine[]} lines
 * @returns {string | null}
 */
function oldestDate(lines) {
  let date = null
  for (const line of lines) {
    if (line.date !== undefined && (date === null || line.date < date)) date = line.date
  }
  return date
}

/**
 * Render the stable markdown context document and trim it to `limit` characters.
 *
 * Trimming removes the deepest node lines first and then the oldest dated lines;
 * only a document whose headers alone exceed the limit is hard-cut.
 * @param {ContextInput} input
 * @param {number} limit
 * @returns {ContextDocument}
 */
export function renderContextDocument(input, limit) {
  const lines = contextLines(input)
  let markdown = joinContextLines(lines)
  let truncated = false
  while (markdown.length > limit) {
    truncated = true
    const depth = deepestDepth(lines)
    if (depth !== null) {
      lines.splice(lines.map(line => line.depth).lastIndexOf(depth), 1)
      markdown = joinContextLines(lines)
      continue
    }
    const date = oldestDate(lines)
    if (date !== null) {
      lines.splice(lines.map(line => line.date).lastIndexOf(date), 1)
      markdown = joinContextLines(lines)
      continue
    }
    markdown = markdown.slice(0, limit)
    break
  }
  return { markdown, chars: markdown.length, truncated }
}
