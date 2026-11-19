// Tree building, parent rollups, and the stats summary.

import { todayIso } from '../clock.js'

/** @typedef {import('./refs.js').TaskKind} TaskKind */
/** @typedef {import('./refs.js').TaskStatus} TaskStatus */
/** @typedef {import('./links.js').TaskLink} TaskLink */

/**
 * A task row as exposed by the API (camelCase, links already parsed).
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
 * @property {string[]} tags
 * @property {string} source
 * @property {string} operatorId
 * @property {string} completedById
 * @property {string} report
 * @property {string | null} workSessionId
 */

/**
 * A task row placed in the nested tree, with its hierarchy number and rollups.
 * @typedef {TreeTask & { number: string, hasChildren: boolean, children: TreeTaskNode[] }} TreeTaskNode
 */

/**
 * Maximum tree nesting depth a `decompose` call may grow the tree to.
 * A track is depth 1, a Hermes node depth 2-3, and the actionable subtask
 * created by `decompose` depth 4: the tracker caps ids at three levels, so a
 * fourth level exists only for the plugin's own work breakdown.
 */
export const DECOMPOSE_MAX_DEPTH = 4

/**
 * Derive the read-time status of a task that owns children.
 *
 * The rule follows the tracker's own renderer for parents that carry a raw
 * tracker state, in this order: every child done → done; the parent's own state
 * is 进行 → in_progress; any child blocked → blocked; any child in_progress or
 * done → in_progress; otherwise todo. Manual parents (state === '') keep the
 * child-only rule: every child done → done, any blocked child → blocked, any
 * in_progress child or positive rolled-up progress → in_progress, else todo.
 * Cancelled children are dropped before the rule: they neither hold a parent
 * open nor count towards its progress, and a parent whose children are all
 * cancelled is itself cancelled. `progress` is the mean of the active children.
 * @param {{ status: TaskStatus }[]} children
 * @param {number} progress
 * @param {string} [state] the parent's own normalized tracker state ('' for manual)
 * @returns {TaskStatus}
 */
export function deriveSummaryStatus(children, progress, state = '') {
  const active = children.filter(child => child.status !== 'cancelled')
  if (children.length > 0 && active.length === 0) return 'cancelled'
  if (children.length > 0 && active.every(child => child.status === 'done')) return 'done'
  if (state !== '') {
    if (state === '进行') return 'in_progress'
    if (active.some(child => child.status === 'blocked')) return 'blocked'
    if (active.some(child => child.status === 'in_progress' || child.status === 'done')) return 'in_progress'
    return 'todo'
  }
  if (active.some(child => child.status === 'blocked')) return 'blocked'
  if (active.some(child => child.status === 'in_progress') || progress > 0) return 'in_progress'
  return 'todo'
}

/**
 * Recompute a node's cached rollup fields from its current children, applying
 * the documented child rules. `buildTree` runs it on the full tree; read-time
 * tag filtering runs it again on the pruned children so a filtered parent still
 * summarizes the subtree the caller can see. The caller guarantees that
 * `node.children` is non-empty.
 * @param {TreeTaskNode} node
 * @returns {void}
 */
export function rollupNode(node) {
  const { children } = node
  const active = children.filter(child => child.status !== 'cancelled')
  const rollup = active.length > 0 ? active : children
  node.startDate = rollup.reduce((min, child) => (child.startDate < min ? child.startDate : min), rollup[0].startDate)
  node.endDate = rollup.reduce((max, child) => (child.endDate > max ? child.endDate : max), rollup[0].endDate)
  node.progress = active.length === 0 ? 0 : Math.round(active.reduce((sum, child) => sum + child.progress, 0) / active.length)
  node.status = deriveSummaryStatus(children, node.progress, node.state)
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
    if (children.length > 0) rollupNode(node)
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
 * @property {number} cancelled
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
  let cancelled = 0
  let overdue = 0
  for (const task of flat) {
    if (task.status === 'done') done += 1
    else if (task.status === 'cancelled') cancelled += 1
    else {
      if (task.status === 'in_progress') inProgress += 1
      if (task.status === 'blocked') blocked += 1
      if (task.endDate < today) overdue += 1
    }
  }
  const active = flat.length - cancelled
  return {
    total: flat.length,
    done,
    inProgress,
    blocked,
    cancelled,
    overdue,
    progress: active === 0 ? 0 : Math.round((done / active) * 100),
  }
}
