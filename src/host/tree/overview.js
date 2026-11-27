// Layered overview of the task tree: the default view renders every root with
// its direct children (two levels), and a parent reference renders the one
// level below it, so a reader without a keyword still gets the whole picture
// and can drill down level by level. Pure and deterministic: it never reads
// the clock and never touches the store.

import { KIND_LABELS, STATUS_LABELS } from './chain.js'

/** @typedef {import('./build.js').TreeTaskNode} TreeTaskNode */

/**
 * The overview line of one task: its point number, title, kind and status, plus
 * the child count that marks it as drillable. The point number is the locator
 * every read tool accepts, so it — not the external ref — leads the line.
 * @param {TreeTaskNode} task
 * @param {number} depth the rendered indent, counting the view root as 1
 * @returns {string}
 */
function overviewLine(task, depth) {
  const kind = KIND_LABELS[task.kind] ?? task.kind
  const status = STATUS_LABELS[task.status] ?? task.status
  const children = task.children.length === 0 ? '' : ` · ${task.children.length} 个子任务`
  return `${'  '.repeat(depth - 1)}- ${task.number} ${task.title}（${kind} · ${status}）${children}`
}

/**
 * Render the layered overview as one markdown document. Without a parent it
 * covers the whole tree at two levels; with a parent it covers the one level
 * below that task. The closing hint appears only when at least one rendered
 * row is drillable.
 * @param {TreeTaskNode[]} tree
 * @param {TreeTaskNode | null} [parent]
 * @returns {string}
 */
export function renderTreeOverview(tree, parent = null) {
  /** @type {string[]} */
  const lines = []
  /** @type {TreeTaskNode[]} */
  let rows
  if (parent === null) {
    const tracks = tree.filter(task => task.kind === 'track').length
    const roots = tree.length - tracks
    const parts = []
    if (tracks > 0) parts.push(`${tracks} 条支线`)
    if (roots > 0) parts.push(`${roots} 个顶层任务`)
    lines.push(parts.length === 0 ? '# 任务树概览（前两层）' : `# 任务树概览（${parts.join(' · ')} · 前两层）`, '')
    if (tree.length === 0) lines.push('（任务树为空。）')
    rows = tree
    for (const root of tree) {
      lines.push(overviewLine(root, 1))
      for (const child of root.children) lines.push(overviewLine(child, 2))
    }
  } else {
    const kind = KIND_LABELS[parent.kind] ?? parent.kind
    const status = STATUS_LABELS[parent.status] ?? parent.status
    lines.push(`# ${parent.number} ${parent.title}（${kind} · ${status}）的下一层`, '')
    if (parent.children.length === 0) lines.push('（无子任务——已是最细一层。）')
    rows = parent.children
    for (const child of parent.children) lines.push(overviewLine(child, 1))
  }
  if (rows.some(task => task.children.length > 0)) {
    lines.push('', '带「N 个子任务」后缀的条目还有下一层，把它的点号作为下钻父任务再查一层即可。')
  }
  return `${lines.join('\n')}\n`
}
