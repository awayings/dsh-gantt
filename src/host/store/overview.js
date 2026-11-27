// The layered tree overview behind the assistant `gantt_context` drill-down
// and the MCP `get_tree_overview` tool: the whole tree at two levels by
// default, or the one level below a chosen parent. Rendering is pure
// (tree/overview.js); this module owns parent resolution and the result shape.

import { flattenTree } from '../tree.js'
import { renderTreeOverview } from '../tree/overview.js'

/** @typedef {import('./gantt.js').GanttStore} GanttStore */
/** @typedef {import('../tree.js').TaskNode} TaskNode */

/**
 * Render the layered overview. `parentId` is the internal id of the task to
 * drill into — the tool layers resolve point numbers and refs before calling —
 * or null for the two-level whole tree. An unknown id is a 404, matching every
 * other task read.
 * @param {GanttStore} store
 * @param {string | null} [parentId]
 * @returns {{ parentId: string | null, markdown: string, chars: number }}
 */
export function treeOverview(store, parentId = null) {
  const tree = store.tree()
  const parent = parentId === null
    ? null
    : /** @type {TaskNode} */ (flattenTree(tree).find(node => node.id === store.requireRow(parentId).id))
  const markdown = renderTreeOverview(tree, parent)
  return { parentId: parent === null ? null : parent.id, markdown, chars: markdown.length }
}
