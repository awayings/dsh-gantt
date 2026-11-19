// Read-time filtering of the task tree by the manual `tags` labels. A filter
// keeps the matching tasks plus the ancestor path that carries their hierarchy
// numbers; a retained ancestor's rollup is recomputed from the surviving
// children so the returned subtree still summarizes what it shows.

import { GanttError } from '../errors.js'
import { rollupNode } from './build.js'

/** @typedef {import('./build.js').TreeTaskNode} TreeTaskNode */
/** @typedef {'any' | 'and'} TagMode */

/** The tag-match modes, in documented order. @type {TagMode[]} */
export const TAG_MODES = ['any', 'and']

/**
 * Validate one tag-match mode. Absent means `any`; any other value outside the
 * vocabulary is a 400, so a typo cannot silently widen a filter.
 * @param {unknown} value
 * @returns {TagMode}
 */
export function normalizeTagMode(value) {
  if (value === undefined || value === null || value === '') return 'any'
  const mode = TAG_MODES.find(candidate => candidate === value)
  if (mode === undefined) throw new GanttError(`mode must be one of ${TAG_MODES.join(', ')}`)
  return mode
}

/**
 * Whether one task's tags satisfy a filter. An empty filter matches everything,
 * so the same predicate serves both the unfiltered and the filtered reads.
 * @param {string[]} taskTags
 * @param {string[]} filterTags
 * @param {TagMode} mode
 * @returns {boolean}
 */
export function matchesTagFilter(taskTags, filterTags, mode) {
  if (filterTags.length === 0) return true
  if (mode === 'and') return filterTags.every(tag => taskTags.includes(tag))
  return filterTags.some(tag => taskTags.includes(tag))
}

/**
 * Prune a forest to the tasks matching `filterTags` plus their ancestor path.
 * A matching task keeps its own row and the matching part of its subtree; an
 * unmatched ancestor is kept only as a container. Numbers stay the full-tree
 * dotted ids (never renumbered), and any node that keeps children has its
 * rollup recomputed from them.
 * @param {TreeTaskNode[]} nodes
 * @param {string[]} filterTags
 * @param {TagMode} mode
 * @returns {TreeTaskNode[]}
 */
export function filterTreeByTags(nodes, filterTags, mode) {
  /** @type {TreeTaskNode[]} */
  const kept = []
  for (const node of nodes) {
    const children = filterTreeByTags(node.children, filterTags, mode)
    if (!matchesTagFilter(node.tags, filterTags, mode) && children.length === 0) continue
    const filtered = { ...node, children, hasChildren: children.length > 0 }
    if (children.length > 0) rollupNode(filtered)
    kept.push(filtered)
  }
  return kept
}
