/** Depth-first list of every task node. */
export function flattenTree(nodes) {
  const output = []
  const walk = (list) => {
    for (const node of list) {
      output.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return output
}

/** Rows visible under the current collapsed set, with depth. */
export function visibleRows(nodes, collapsed) {
  const output = []
  const walk = (list, depth) => {
    for (const node of list) {
      output.push({ task: node, depth })
      if (!collapsed.has(node.id)) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return output
}

/**
 * Prune the tree to the branches that contain one of `keepIds`. Ancestors of
 * a kept task are retained so the branch can render; every other node is
 * dropped outright, unlike a collapsed row which still exists.
 */
/** Prune the tree to branches that contain one of keepIds. */
export function filterTree(nodes, keepIds) {
  const kept = []
  for (const node of nodes) {
    const children = filterTree(node.children, keepIds)
    if (keepIds.has(node.id) || children.length > 0) {
      kept.push({ ...node, children, hasChildren: children.length > 0 })
    }
  }
  return kept
}

/** Pair each brief window with the task item picked for it, if any. */
/** Pair each brief window with the task item picked for it. */
export function briefWindows(report) {
  const slots = report && Array.isArray(report.slots) ? report.slots : []
  const items = report && Array.isArray(report.items) ? report.items : []
  return slots.map(window => ({
    window,
    item: items.find(item => item && item.slot === window.slot && item.startTime === window.startTime) ?? null,
  }))
}

/** HH:MM–HH:MM label for one brief window. */
export function briefTimeRange(window) {
  return [window.startTime, window.endTime].filter(Boolean).join('–') || '--:--'
}

/** Parent picker options with depth, in tree order. */
export function taskOptions(nodes) {
  const output = []
  const walk = (list, depth) => {
    for (const node of list) {
      output.push({ id: node.id, label: `${rowNumber(node)} ${node.title}`, depth })
      walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return output
}

/** Ids of a task and all of its descendants. */
export function collectSubtree(task) {
  const ids = new Set()
  const walk = (node) => {
    ids.add(node.id)
    for (const child of node.children) walk(child)
  }
  walk(task)
  return ids
}

/** Hermes dotted id of a `track:1` / `node:1.8.1` ref. */
/** Hermes dotted id of a track:/node: ref. */
export function refIdOf(ref) {
  return String(ref || '').replace(/^(?:node|track):/, '')
}

/** Display id of a row: the ref id when present, else the derived number. */
export function rowNumber(task) {
  return task.ref ? refIdOf(task.ref) : task.number
}

/** Ids of the nodes that must be collapsed to keep only `level` tree depths. */
/** Ids to collapse so only level tree depths stay unexpanded. */
export function collapseForLevel(nodes, level) {
  const ids = new Set()
  const walk = (list, depth) => {
    for (const node of list) {
      if (node.children.length > 0 && depth >= level - 1) ids.add(node.id)
      walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return ids
}
