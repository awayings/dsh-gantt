// The whole-tree keyword search: validation, row mapping, and paging for the
// MCP `search_tasks` tool. Collection is pure (tree/search.js); this module
// owns the input contract and the documented result rows.

import { GanttError } from '../errors.js'
import { collectSearchMatches } from '../tree/search.js'
import { normalizeLimit } from './tasks.js'

/** @typedef {import('./gantt.js').GanttStore} GanttStore */

/** The search query: one keyword and an optional result page size.
 * @typedef {{ q?: unknown, limit?: unknown }} SearchTasksInput */

/** One result row: the located task, the fields that matched, its owning
 * track, and its ancestor chain.
 * @typedef {{ id: string, number: string, ref: string, title: string, kind: string,
 * status: import('../tree/refs.js').TaskStatus, description: string, doneWhen: string,
 * matchedFields: string[], chain: Array<{ number: string, title: string }>,
 * trackId: string, trackName: string }} SearchTask */

/** Longest keyword accepted; a longer query is rejected instead of scanned. */
const MAX_QUERY = 200

/**
 * Search the whole rendered tree for one keyword: every task whose title,
 * description, or doneWhen contains it (case-insensitive substring), across
 * every track and depth, completed work included. Rows follow rendered
 * document order; `total` counts every match while `tasks` honors `limit`, so
 * a capped page still reports how much of the tree matched.
 * @param {GanttStore} store
 * @param {SearchTasksInput} [input]
 * @returns {{ q: string, total: number, tasks: SearchTask[] }}
 */
export function searchTasks(store, input = {}) {
  const q = typeof input.q === 'string' ? input.q.trim() : ''
  if (q === '') throw new GanttError('q is required')
  if ([...q].length > MAX_QUERY) throw new GanttError(`q must be at most ${MAX_QUERY} characters`)
  const limit = normalizeLimit(input.limit)
  const entries = collectSearchMatches(store.tree(), q)
  return {
    q,
    total: entries.length,
    tasks: entries.slice(0, limit).map(entry => ({
      id: entry.task.id,
      number: entry.task.number,
      ref: entry.task.ref,
      title: entry.task.title,
      kind: entry.task.kind,
      status: entry.task.status,
      description: entry.task.description,
      doneWhen: entry.task.doneWhen,
      matchedFields: entry.matchedFields,
      chain: entry.chain,
      trackId: entry.trackId,
      trackName: entry.trackName,
    })),
  }
}
