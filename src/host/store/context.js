// The markdown context document over the unified tree and one day plan.

import { appendBriefSection } from '../daily.js'
import { GanttError } from '../errors.js'
import { CONTEXT_DEFAULT_LIMIT, CONTEXT_MAX_LIMIT, CONTEXT_MIN_LIMIT, flattenTree, renderContextDocument, todayIso } from '../tree.js'
import { assertDate } from './tasks.js'

/** @typedef {import('../tree.js').TaskNode} TaskNode */
/** @typedef {import('./gantt.js').GanttStore} GanttStore */
/** @typedef {{ date?: string, root?: string, limit?: number }} ContextOptions */

/**
 * Export the unified tree plus one day plan as a stable markdown context document.
 * @param {GanttStore} store
 * @param {ContextOptions} [input]
 * @returns {{ ok: boolean, date: string, markdown: string, chars: number, truncated: boolean,
 * counts: { tracks: number, nodes: number, tasks: number, blocks: number } }}
 */
export function contextDocument(store, input = {}) {
  const date = input.date === undefined || input.date === null || input.date === '' ? todayIso() : assertDate(input.date, 'date')
  const limit = input.limit === undefined ? CONTEXT_DEFAULT_LIMIT : input.limit
  if (!Number.isInteger(limit) || limit < CONTEXT_MIN_LIMIT || limit > CONTEXT_MAX_LIMIT) {
    throw new GanttError(`limit must be an integer from ${CONTEXT_MIN_LIMIT} to ${CONTEXT_MAX_LIMIT}`)
  }
  let trees = store.tree()
  if (input.root !== undefined && input.root !== null && input.root !== '') {
    store.requireRow(input.root)
    trees = [/** @type {TaskNode} */ (store.getNode(input.root))]
  }
  const bundle = store.dayPlan(date)
  const counts = { tracks: 0, nodes: 0, tasks: 0, blocks: bundle.blocks.length }
  for (const task of flattenTree(trees)) {
    if (task.kind === 'track') counts.tracks += 1
    else if (task.kind === 'node') counts.nodes += 1
    else counts.tasks += 1
  }
  const document = renderContextDocument({
    date,
    day: bundle.day,
    trees,
    blocks: bundle.blocks,
    integrity: bundle.integrity,
    counts,
  }, limit)
  return { ok: true, date, ...appendBriefSection(document, bundle.brief, limit), counts }
}
