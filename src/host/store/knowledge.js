// Knowledge facade for the gantt-long-run dispatch preset: the judgments a
// dispatcher records after locating work, the feedback on those judgments, and
// the lessons distilled from them. Entries live beside the task tree in the
// same SQLite database, so the dispatch conversation stays lean — it pulls
// what it needs through gantt_knowledge_query instead of carrying a growing
// wiki in context. A deleted task unlinks its entries rather than deleting
// them: a lesson outlives the task it was learned on.

import { randomUUID } from 'node:crypto'
import { GanttError } from '../errors.js'
import { MAX_DESCRIPTION, normalizeTags, normalizeTitle, oneOf, parseTagsJson } from './tasks.js'

/** @typedef {import('./gantt.js').GanttStore} GanttStore */

/** Entry kinds: a distilled lesson, feedback on one judgment, or a loose note. */
export const KNOWLEDGE_KINDS = ['lesson', 'feedback', 'note']

/** Rows one query returns by default, and the most it ever returns. */
export const DEFAULT_QUERY_LIMIT = 8
export const MAX_QUERY_LIMIT = 50

/** Column names one knowledge row carries, snake_case in storage, camelCase out. */
const KNOWLEDGE_SELECT = 'SELECT id, kind, title, content, task_id AS taskId, tags, session_id AS sessionId, turn, created_at AS createdAt, updated_at AS updatedAt FROM knowledge_entries'

/** One saved knowledge entry.
 * @typedef {{ id: string, kind: string, title: string, content: string,
 * taskId: string | null, tags: string[], sessionId: string, turn: number | null,
 * createdAt: string, updatedAt: string }} KnowledgeEntry */

/** Fields {@link saveKnowledge} accepts; `id` replaces an existing entry.
 * @typedef {{ id?: unknown, kind?: unknown, title: unknown, content: unknown,
 * taskId?: unknown, tags?: unknown }} KnowledgeInput */

/** Filters {@link queryKnowledge} accepts; every field is optional.
 * @typedef {{ query?: unknown, taskId?: unknown, kind?: unknown,
 * tag?: unknown, limit?: unknown }} KnowledgeQuery */

/** Which conversation and turn wrote an entry; omitted for manual writes.
 * @typedef {{ sessionId: string, turn: number | null }} KnowledgeProvenance */

/**
 * Normalize one entry kind for a write: the default is a lesson.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeKind(value) {
  if (value === undefined || value === null) return 'lesson'
  return oneOf(value, 'kind', KNOWLEDGE_KINDS)
}

/**
 * Resolve the linked task for a write or a query: the internal id of a row that
 * exists, or null when no task is linked. The model-facing reference forms
 * (point numbers, refs) are resolved before this layer.
 * @param {GanttStore} store
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeTaskId(store, value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new GanttError('taskId must be a string')
  const id = value.trim()
  if (store.getRow(id) === null) throw new GanttError(`task ${id} was not found`, 404)
  return id
}

/**
 * Escape the LIKE wildcards in a keyword so user text matches literally.
 * @param {string} keyword
 * @returns {string}
 */
function escapeLike(keyword) {
  return keyword.replace(/([%_\\])/g, '\\$1')
}

/**
 * Normalize one knowledge search keyword: '' when absent.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeKeyword(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new GanttError('query must be a string')
  return value.trim()
}

/**
 * Read one stored row in its camelCase form, or null when the id is unknown.
 * @param {GanttStore} store
 * @param {string} id
 * @returns {KnowledgeEntry | null}
 */
function knowledgeRow(store, id) {
  const row = /** @type {any} */ (store.db.prepare(`${KNOWLEDGE_SELECT} WHERE id = ?`).get(id))
  return row === undefined ? null : { ...row, tags: parseTagsJson(row.tags) }
}

/**
 * Normalize one entry body: required non-empty text within the shared
 * description cap.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeContent(value) {
  if (typeof value !== 'string') throw new GanttError('content is required')
  if ([...value].length > MAX_DESCRIPTION) throw new GanttError(`content must be at most ${MAX_DESCRIPTION} characters`)
  const content = value.trim()
  if (content === '') throw new GanttError('content must not be empty')
  return content
}

/**
 * Save one knowledge entry: a fresh row, or the full replacement of an
 * existing id. The linked task must exist; a deleted task later unlinks the
 * entry in its place, never removes the lesson.
 * @param {GanttStore} store
 * @param {KnowledgeInput} input
 * @param {KnowledgeProvenance} [origin]
 * @returns {KnowledgeEntry}
 */
export function saveKnowledge(store, input, origin) {
  const kind = normalizeKind(input.kind)
  const title = normalizeTitle(input.title)
  const content = normalizeContent(input.content)
  const taskId = normalizeTaskId(store, input.taskId)
  const tags = JSON.stringify(normalizeTags(input.tags))
  const sessionId = typeof origin?.sessionId === 'string' ? origin.sessionId : ''
  const turn = origin !== undefined && Number.isInteger(origin.turn) ? origin.turn : null
  const now = new Date().toISOString()
  const replaceId = typeof input.id === 'string' && input.id.trim() !== '' ? input.id.trim() : null
  if (replaceId !== null && knowledgeRow(store, replaceId) === null) {
    throw new GanttError(`knowledge ${replaceId} was not found`, 404)
  }
  const id = replaceId === null ? randomUUID() : replaceId
  if (replaceId === null) {
    store.db
      .prepare('INSERT INTO knowledge_entries (id, kind, title, content, task_id, tags, session_id, turn, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, kind, title, content, taskId, tags, sessionId, turn, now, now)
  } else {
    store.db
      .prepare('UPDATE knowledge_entries SET kind = ?, title = ?, content = ?, task_id = ?, tags = ?, session_id = ?, turn = ?, updated_at = ? WHERE id = ?')
      .run(kind, title, content, taskId, tags, sessionId, turn, now, id)
  }
  return /** @type {KnowledgeEntry} */ (knowledgeRow(store, id))
}

/**
 * Query saved knowledge, newest first: an optional keyword over title and
 * content, an optional linked task, kind, or tag, bounded by a limit.
 * @param {GanttStore} store
 * @param {KnowledgeQuery} query
 * @returns {KnowledgeEntry[]}
 */
export function queryKnowledge(store, query) {
  const keyword = normalizeKeyword(query.query)
  const taskId = normalizeTaskId(store, query.taskId)
  /** @type {string | undefined} */
  let kind
  if (query.kind !== undefined && query.kind !== null) kind = oneOf(query.kind, 'kind', KNOWLEDGE_KINDS)
  /** @type {string | undefined} */
  let tag
  if (query.tag !== undefined && query.tag !== null) {
    if (typeof query.tag !== 'string') throw new GanttError('tag must be a string')
    tag = query.tag.trim()
    if (tag === '') throw new GanttError('tag must not be empty')
  }
  let limit = DEFAULT_QUERY_LIMIT
  const rawLimit = query.limit
  if (rawLimit !== undefined && rawLimit !== null) {
    if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_QUERY_LIMIT) {
      throw new GanttError(`limit must be an integer between 1 and ${MAX_QUERY_LIMIT}`)
    }
    limit = rawLimit
  }
  const parts = []
  /** @type {Array<string | number>} */
  const bindings = []
  if (keyword !== '') {
    const like = `%${escapeLike(keyword)}%`
    parts.push("(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')")
    bindings.push(like, like)
  }
  if (taskId !== null) {
    parts.push('task_id = ?')
    bindings.push(taskId)
  }
  if (kind !== undefined) {
    parts.push('kind = ?')
    bindings.push(kind)
  }
  const where = parts.length === 0 ? '' : ` WHERE ${parts.join(' AND ')}`
  const rows = /** @type {any[]} */ (store.db
    .prepare(`${KNOWLEDGE_SELECT}${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...bindings, limit))
  const entries = rows.map(row => ({ ...row, tags: parseTagsJson(row.tags) }))
  return tag === undefined ? entries : entries.filter(entry => entry.tags.includes(tag))
}
