// Task-row validation, normalization, seed data, and the SQL the store runs on
// the `tasks` table.

import { STATUSES as STATUS_WORDS } from '../../shared/vocabulary.js'
import { GanttError } from '../errors.js'
import { TASK_KINDS, dayToIso, isoToDay } from '../tree.js'

/** @typedef {import('../tree.js').TaskKind} TaskKind */
/** @typedef {import('../tree.js').TaskStatus} TaskStatus */
/** @typedef {import('../tree.js').TaskLink} TaskLink */
/** @typedef {import('./plan.js').PlanDraftInput} PlanDraftInput */
/** All task statuses, shared with the browser half. @type {TaskStatus[]} */
export const STATUSES = /** @type {TaskStatus[]} */ (STATUS_WORDS)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_TITLE = 200
const MAX_DESCRIPTION = 4000

const TASK_COLUMNS = 'id, parent_id AS parentId, title, description, status, progress, start_date AS startDate, end_date AS endDate, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt, kind, ref, state, lane, dep, done_when AS doneWhen, landing, estimate, category, inspiration, links, source'
export const TASK_SELECT = `SELECT ${TASK_COLUMNS} FROM tasks`
export const INSERT_TASK = 'INSERT INTO tasks (id, parent_id, title, description, status, progress, start_date, end_date, sort_order, kind, ref, state, lane, dep, done_when, landing, estimate, category, inspiration, links, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
export const UPDATE_TASK = 'UPDATE tasks SET parent_id = ?, title = ?, description = ?, status = ?, progress = ?, start_date = ?, end_date = ?, sort_order = ?, kind = ?, ref = ?, state = ?, lane = ?, dep = ?, done_when = ?, landing = ?, estimate = ?, category = ?, inspiration = ?, links = ?, source = ?, updated_at = ? WHERE id = ?'
export const UPDATE_MATERIALIZED = 'UPDATE tasks SET parent_id = ?, title = ?, description = ?, status = ?, progress = ?, start_date = ?, end_date = ?, sort_order = ?, state = ?, lane = ?, dep = ?, done_when = ?, landing = ?, estimate = ?, category = ?, inspiration = ?, links = ?, updated_at = ? WHERE id = ?'

/** Demo tasks for `seed()`: parent index, title, description, status, progress, start offset, end offset, sibling order.
 * @type {[number | null, string, string, TaskStatus, number, number, number, number][]} */
export const SEED_TASKS = [
  [null, 'DSH 插件发布', '从数据层到界面的端到端交付。', 'in_progress', 45, -10, 24, 0], [0, '需求梳理', '确认甘特图、拆分和跟踪的范围。', 'done', 100, -10, -8, 0],
  [0, 'Host 数据层', 'SQLite 表结构与 JSON 接口。', 'in_progress', 55, -7, 1, 1], [2, 'SQLite 表结构', '任务树、状态与层级编号。', 'done', 100, -7, -5, 0],
  [2, 'HTTP 接口', '创建、更新、拆分与状态流转。', 'in_progress', 60, -4, 1, 1], [0, '前端甘特视图', '任务树、时间轴与周/月切换。', 'todo', 0, 2, 14, 2],
  [5, '周/月维度切换', '按天与按月的两种时间刻度。', 'todo', 0, 2, 7, 0], [5, '任务树与编号', '1.1.1 形式的层级标号。', 'todo', 0, 8, 14, 1],
  [0, '验收与发布', '回归、截图与安装验证。', 'todo', 0, 16, 24, 3], [null, '个人季度计划', '把长期目标拆成可以每周推进的小任务。', 'in_progress', 30, -20, 45, 1],
  [9, '阅读 6 本书', '每周至少读完一本。', 'in_progress', 33, -20, 20, 0], [9, '每周三次运动', '保持节奏比单次强度更重要。', 'todo', 10, -14, 45, 1],
  [9, '季度复盘', '整理完成项和下一季度重点。', 'blocked', 0, 38, 45, 2],
]

/** @typedef {{ status: TaskStatus, progress: number, start_date: string, end_date: string }} ChildSummaryRow */
/** @typedef {{ title?: unknown, description?: unknown, startDate?: unknown, endDate?: unknown,
 * status?: unknown, progress?: unknown, lane?: unknown, dep?: unknown, doneWhen?: unknown,
 * landing?: unknown, estimate?: unknown, category?: unknown, inspiration?: unknown, links?: unknown,
 * plan?: PlanDraftInput }} DecomposeChildInput */
/** @typedef {{ parentId: string | null, title: string, description: string, status: TaskStatus,
 * progress: number, startDate: string, endDate: string, sortOrder: number, kind: TaskKind, ref: string,
 * state: string, lane: string, dep: string, doneWhen: string, landing: string, estimate: string,
 * category: string, inspiration: string, links: TaskLink[], source: string }} TaskInsert */
/** Task fields accepted by create(). @typedef {{ title?: unknown, description?: unknown,
 * parentId?: unknown, status?: unknown, progress?: unknown, startDate?: unknown, endDate?: unknown,
 * kind?: unknown, ref?: unknown, lane?: unknown, dep?: unknown, doneWhen?: unknown, landing?: unknown,
 * estimate?: unknown, category?: unknown, inspiration?: unknown, links?: unknown }} TaskInput */
/** Task fields accepted by update(); kind and ref are ignored. @typedef {{ title?: unknown,
 * description?: unknown, parentId?: unknown, status?: unknown, progress?: unknown, startDate?: unknown,
 * endDate?: unknown, lane?: unknown, dep?: unknown, doneWhen?: unknown, landing?: unknown,
 * estimate?: unknown, category?: unknown, inspiration?: unknown, links?: unknown }} TaskPatch */
/** One child task accepted by split(). @typedef {{ title: unknown, description?: unknown,
 * status?: unknown, progress?: unknown, startDate?: unknown, endDate?: unknown, lane?: unknown,
 * dep?: unknown, doneWhen?: unknown, landing?: unknown, estimate?: unknown, category?: unknown,
 * inspiration?: unknown, links?: unknown }} SplitChild */

/** @param {unknown} value @param {string} field @returns {string} */
export function assertDate(value, field) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) throw new GanttError(`${field} must be a YYYY-MM-DD date`)
  const day = isoToDay(value)
  if (!Number.isFinite(day) || dayToIso(day) !== value) throw new GanttError(`${field} is not a valid calendar date`)
  return value
}
/** @param {string} startDate @param {string} endDate @returns {void} */
export function assertRange(startDate, endDate) {
  if (startDate > endDate) throw new GanttError('endDate must not be before startDate')
}
/** @param {unknown} value @returns {string} */
export function normalizeTitle(value) {
  if (typeof value !== 'string') throw new GanttError('title is required')
  const title = value.trim().replace(/\s+/g, ' ')
  if (title.length === 0) throw new GanttError('title must not be empty')
  if ([...title].length > MAX_TITLE) throw new GanttError(`title must be at most ${MAX_TITLE} characters`)
  return title
}
/** @param {unknown} value @returns {string} */
export function normalizeDescription(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new GanttError('description must be a string')
  if ([...value].length > MAX_DESCRIPTION) throw new GanttError(`description must be at most ${MAX_DESCRIPTION} characters`)
  return value.trim()
}
/** @param {unknown} value @returns {TaskStatus} */
export function normalizeStatus(value) {
  const status = STATUSES.find(candidate => candidate === value)
  if (status === undefined) throw new GanttError(`status must be one of ${STATUSES.join(', ')}`)
  return status
}
/** @param {unknown} value @returns {number} */
export function normalizeProgress(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new GanttError('progress must be a number from 0 to 100')
  return Math.max(0, Math.min(100, Math.round(value)))
}
/** @param {unknown} value @returns {string | null} */
export function normalizeParent(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new GanttError('parentId must be a task id or null')
  return value
}
/** @param {TaskStatus} status @param {number} [current] @returns {number} */
export function defaultProgress(status, current = 0) {
  if (status === 'done') return 100
  if (status === 'todo') return 0
  if (status === 'blocked') return current
  return current > 0 && current < 100 ? current : 50
}
/** @param {number} progress @param {TaskStatus} current @returns {TaskStatus} */
export function statusFromProgress(progress, current) {
  if (progress >= 100) return 'done'
  if (progress <= 0) return 'todo'
  return current === 'blocked' ? 'blocked' : 'in_progress'
}
/** @param {unknown} value @returns {string} */
export function textValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}
/** @param {unknown} value @param {string} field @returns {string} */
export function requireText(value, field) {
  const text = textValue(value)
  if (text === '') throw new GanttError(`${field} is required`)
  return text
}
/** @param {unknown} value @param {string} field @param {readonly string[]} allowed @returns {string} */
export function oneOf(value, field, allowed) {
  const found = allowed.find(candidate => candidate === value)
  if (found === undefined) throw new GanttError(`${field} must be one of ${allowed.join(', ')}`)
  return found
}
/** @param {unknown} value @param {string} field @param {(item: any, index: number) => object} normalize @returns {any[]} */
export function normalizeList(value, field, normalize) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new GanttError(`${field} must be an array`)
  return value.map((item, index) => {
    if (item === null || typeof item !== 'object') throw new GanttError(`${field}[${index}] must be an object`)
    return normalize(item, index)
  })
}
export const TEXT_FIELDS = /** @type {const} */ (['lane', 'dep', 'doneWhen', 'landing', 'estimate', 'category', 'inspiration'])
/** @param {unknown} value @param {string} field @returns {string} */
export function textField(value, field) {
  if (typeof value !== 'string') throw new GanttError(`${field} must be a string`)
  return value.trim()
}
/** @typedef {{ lane: string, dep: string, doneWhen: string, landing: string, estimate: string,
 * category: string, inspiration: string }} TaskExtras */
/** @param {Record<string, any>} source @param {string} [prefix] @returns {TaskExtras} */
export function normalizeExtras(source, prefix = '') {
  /** @type {TaskExtras} */
  const extras = { lane: '', dep: '', doneWhen: '', landing: '', estimate: '', category: '', inspiration: '' }
  for (const field of TEXT_FIELDS) extras[field] = source[field] === undefined ? '' : textField(source[field], `${prefix}${field}`)
  return extras
}
/** @param {unknown} value @returns {TaskKind} */
export function normalizeKind(value) {
  if (value === undefined) return 'task'
  return /** @type {TaskKind} */ (oneOf(value, 'kind', TASK_KINDS))
}
/** @param {unknown} value @returns {string} */
export function normalizeRef(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new GanttError('ref must be a string')
  return value.trim()
}
