// Whole-tree keyword collection: the read-only locator behind the store search
// and the MCP `search_tasks` tool. Matching runs over the rendered tree, so a
// hit carries its point number, owning track, and ancestor chain — the
// coordinates a worker needs to go from a remembered concept to one task.

import { flattenTree } from './build.js'

/** @typedef {import('./build.js').TreeTaskNode} TreeTaskNode */

/** The task fields one keyword is matched against, in reported order. */
export const SEARCH_FIELDS = /** @type {const} */ (['title', 'description', 'doneWhen'])

/** One located task: the match, its owning track, its ancestor chain, and the
 * fields that carried the keyword.
 * @typedef {{ task: TreeTaskNode, trackId: string, trackName: string,
 * chain: Array<{ number: string, title: string }>, matchedFields: string[] }} SearchEntry */

/**
 * The ancestor path of one task, from its track root down to its parent. The
 * matched task's own number and title stay on the entry, so the chain carries
 * only the positions above it.
 * @param {Map<string, TreeTaskNode>} byId
 * @param {TreeTaskNode} task
 * @returns {Array<{ number: string, title: string }>}
 */
function chainOf(byId, task) {
  /** @type {Array<{ number: string, title: string }>} */
  const chain = []
  /** @type {string | null} */
  let parentId = task.parentId
  while (typeof parentId === 'string' && parentId !== '') {
    const parent = byId.get(parentId)
    if (parent === undefined) break
    chain.unshift({ number: parent.number, title: parent.title })
    parentId = parent.parentId
  }
  return chain
}

/**
 * Collect every task whose title, description, or doneWhen contains the
 * keyword — a case-insensitive substring match. Every depth, every kind, and
 * every status is searched (completed and cancelled work included), grouped by
 * track in rendered order and then in document order.
 * @param {TreeTaskNode[]} tree
 * @param {string} q the trimmed keyword
 * @returns {SearchEntry[]}
 */
export function collectSearchMatches(tree, q) {
  const needle = q.toLowerCase()
  const byId = new Map(flattenTree(tree).map(task => [task.id, task]))
  /** @type {SearchEntry[]} */
  const entries = []
  for (const root of tree) {
    for (const task of flattenTree([root])) {
      const matchedFields = SEARCH_FIELDS.filter(field => task[field].toLowerCase().includes(needle))
      if (matchedFields.length === 0) continue
      entries.push({ task, trackId: root.id, trackName: root.title, matchedFields, chain: chainOf(byId, task) })
    }
  }
  return entries
}
