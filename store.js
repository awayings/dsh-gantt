import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** @type {TaskStatus[]} */
export const STATUSES = ['todo', 'in_progress', 'blocked', 'done']
export const SCHEMA_VERSION = 2
/** @type {PlanStatus[]} */
export const PLAN_STATUSES = ['todo', 'in_progress', 'done', 'skipped']
const PLAN_SLOTS = ['morning', 'daytime', 'evening', 'other']
const DAY_KINDS = ['workday', 'weekend', 'unknown']
const DAY_MS = 86_400_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_TITLE = 200
const MAX_NOTES = 500
const MAX_DESCRIPTION = 4000
const BLOCK_COLUMNS = 'id, plan_date AS planDate, start_time AS startTime, end_time AS endTime, slot, category, title, detail, landing, estimate, inspiration, status, notes, sort_order AS sortOrder, source, source_ref AS sourceRef'

/** @typedef {'todo' | 'in_progress' | 'blocked' | 'done'} TaskStatus */

/**
 * A task row with camelCase field names, as exposed by the API.
 * @typedef {object} TaskRow
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
 */

/**
 * A row placed in the nested tree, with its hierarchical number and rollups.
 * @typedef {TaskRow & { number: string, hasChildren: boolean, children: TaskNode[] }} TaskNode
 */

/**
 * Task fields accepted by create().
 * @typedef {object} TaskInput
 * @property {string} [title]
 * @property {string | null} [description]
 * @property {string | null} [parentId]
 * @property {TaskStatus} [status]
 * @property {number} [progress]
 * @property {string} [startDate]
 * @property {string} [endDate]
 */

/**
 * Task fields accepted by update().
 * @typedef {object} TaskPatch
 * @property {string} [title]
 * @property {string | null} [description]
 * @property {string | null} [parentId]
 * @property {TaskStatus} [status]
 * @property {number} [progress]
 * @property {string} [startDate]
 * @property {string} [endDate]
 */

/**
 * One child task accepted by split().
 * @typedef {object} SplitChild
 * @property {string} title
 * @property {string | null} [description]
 * @property {TaskStatus} [status]
 * @property {number} [progress]
 * @property {string} [startDate]
 * @property {string} [endDate]
 */

/**
 * @typedef {object} TaskStats
 * @property {number} total
 * @property {number} done
 * @property {number} inProgress
 * @property {number} blocked
 * @property {number} overdue
 * @property {number} progress
 */

/**
 * @typedef {object} GanttSnapshot
 * @property {string} today
 * @property {TaskStatus[]} statuses
 * @property {TaskNode[]} tasks
 * @property {TaskStats} stats
 */

/**
 * @typedef {object} GanttMeta
 * @property {string} dbPath
 * @property {TaskStatus[]} statuses
 * @property {number} schemaVersion
 * @property {number} taskCount
 * @property {string} engine
 */

/**
 * A raw SQLite row from the tasks table.
 * @typedef {object} TaskSqlRow
 * @property {string} id
 * @property {string | null} parent_id
 * @property {string} title
 * @property {string} description
 * @property {TaskStatus} status
 * @property {number} progress
 * @property {string} start_date
 * @property {string} end_date
 * @property {number} sort_order
 * @property {string} created_at
 * @property {string} updated_at
 */

/** @typedef {{ status: TaskStatus, progress: number, start_date: string, end_date: string }} ChildSummaryRow */
/** @typedef {'todo' | 'in_progress' | 'done' | 'skipped'} PlanStatus */
/** @typedef {'morning' | 'daytime' | 'evening' | 'other'} PlanSlot */
/** @typedef {'workday' | 'weekend' | 'unknown'} DayKind */
/** @typedef {{ id: string, name: string, lane: string, priority: string, state: string, blocker: string,
 * sortOrder: number }} TrackRow */
/** @typedef {{ id: string, trackId: string, title: string, state: string, startDate: string | null,
 * endDate: string | null, dep: string, doneWhen: string }} NodeRow */
/** @typedef {{ date: string, weekday: string, dayKind: DayKind, marketOpen: boolean, label: string,
 * coreGoal: string, source: string }} DayPlanRow */
/** @typedef {{ title: string, startTime?: string, endTime?: string, slot?: PlanSlot, category?: string,
 * detail?: string, landing?: string, estimate?: string, inspiration?: string,
 * sortOrder?: number, sourceRef?: string }} BlockDraft */
/** @typedef {{ id: string, planDate: string, startTime: string, endTime: string, slot: PlanSlot,
 * category: string, title: string, detail: string, landing: string, estimate: string, inspiration: string,
 * status: PlanStatus, notes: string, sortOrder: number, source: string, sourceRef: string }} PlanBlock */
/** @typedef {{ day: DayPlanRow | null, blocks: PlanBlock[], nodes: NodeRow[], tracks: TrackRow[],
 * integrity: { code: string, blockId?: string }[],
 * stats: { total: number, done: number, inProgress: number, skipped: number, remaining: number } }} DayPlanBundle */
/** Inputs are validated field by field, so partial parsed shapes are accepted.
 * @typedef {{ tracks?: any[], nodes?: any[], days?: any[] }} ReplacePlanInput */
/**
 * @typedef {{ tracks: number, nodes: number, days: number }} ReplacePlanCounts
 * @typedef {{ inserted: number, updated: number, removed: number }} BlockUpsertCounts
 */

/** A validation or lookup failure with an HTTP-friendly status. */
export class GanttError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   */
  constructor(message, status = 400) {
    super(message)
    this.name = 'GanttError'
    this.status = status
  }
}

/**
 * @param {number} value
 * @returns {string}
 */
function pad(value) {
  return String(value).padStart(2, '0')
}

/**
 * @param {Date} [now]
 * @returns {string}
 */
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * @param {string} iso
 * @returns {number}
 */
export function isoToDay(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/**
 * @param {number} day
 * @returns {string}
 */
export function dayToIso(day) {
  const date = new Date(day)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * @param {string} iso
 * @param {number} days
 * @returns {string}
 */
export function addDays(iso, days) {
  return dayToIso(isoToDay(iso) + days * DAY_MS)
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function assertDate(value, field) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new GanttError(`${field} must be a YYYY-MM-DD date`)
  }
  const day = isoToDay(value)
  if (!Number.isFinite(day) || dayToIso(day) !== value) {
    throw new GanttError(`${field} is not a valid calendar date`)
  }
  return value
}

/**
 * @param {string} startDate
 * @param {string} endDate
 * @returns {void}
 */
function assertRange(startDate, endDate) {
  if (startDate > endDate) throw new GanttError('endDate must not be before startDate')
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTitle(value) {
  if (typeof value !== 'string') throw new GanttError('title is required')
  const title = value.trim().replace(/\s+/g, ' ')
  if (title.length === 0) throw new GanttError('title must not be empty')
  if ([...title].length > MAX_TITLE) throw new GanttError(`title must be at most ${MAX_TITLE} characters`)
  return title
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeDescription(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new GanttError('description must be a string')
  if ([...value].length > MAX_DESCRIPTION) throw new GanttError(`description must be at most ${MAX_DESCRIPTION} characters`)
  return value.trim()
}

/**
 * @param {unknown} value
 * @returns {TaskStatus}
 */
function normalizeStatus(value) {
  const status = STATUSES.find(candidate => candidate === value)
  if (status === undefined) {
    throw new GanttError(`status must be one of ${STATUSES.join(', ')}`)
  }
  return status
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeProgress(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GanttError('progress must be a number from 0 to 100')
  }
  return Math.max(0, Math.min(100, Math.round(value)))
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeParent(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new GanttError('parentId must be a task id or null')
  return value
}

/**
 * @param {TaskStatus} status
 * @param {number} [current]
 * @returns {number}
 */
function defaultProgress(status, current = 0) {
  if (status === 'done') return 100
  if (status === 'todo') return 0
  if (status === 'blocked') return current
  return current > 0 && current < 100 ? current : 50
}

/**
 * @param {number} progress
 * @param {TaskStatus} current
 * @returns {TaskStatus}
 */
function statusFromProgress(progress, current) {
  if (progress >= 100) return 'done'
  if (progress <= 0) return 'todo'
  return current === 'blocked' ? 'blocked' : 'in_progress'
}

/** @param {unknown} value @returns {string} */
function textValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}
/** @param {unknown} value @param {string} field @returns {string} */
function requireText(value, field) {
  const text = textValue(value)
  if (text === '') throw new GanttError(`${field} is required`)
  return text
}
/** @param {unknown} value @param {string} field @param {readonly string[]} allowed @returns {string} */
function oneOf(value, field, allowed) {
  const found = allowed.find(candidate => candidate === value)
  if (found === undefined) throw new GanttError(`${field} must be one of ${allowed.join(', ')}`)
  return found
}
/** @param {unknown} value @param {string} field @returns {string} */
function clockValue(value, field) {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) throw new GanttError(`${field} must be an HH:MM time`)
  return value
}
/** @param {unknown} value @param {string} field @param {(item: any, index: number) => object} normalize
 * @returns {any[]} */
function normalizeList(value, field, normalize) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new GanttError(`${field} must be an array`)
  return value.map((item, index) => {
    if (item === null || typeof item !== 'object') throw new GanttError(`${field}[${index}] must be an object`)
    return normalize(item, index)
  })
}

/**
 * Derive the read-time status of a task that owns children.
 * @param {{ status: TaskStatus }[]} children
 * @param {number} progress
 * @returns {TaskStatus}
 */
export function deriveSummaryStatus(children, progress) {
  if (children.length > 0 && children.every(child => child.status === 'done')) return 'done'
  if (children.some(child => child.status === 'blocked')) return 'blocked'
  if (children.some(child => child.status === 'in_progress') || progress > 0) return 'in_progress'
  return 'todo'
}

/**
 * Build the nested tree, assigning hierarchical numbers and rollup fields.
 * @param {TaskRow[]} rows
 * @returns {TaskNode[]}
 */
export function buildTree(rows) {
  const ids = new Set(rows.map(row => row.id))
  /** @type {Map<string | null, TaskRow[]>} */
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
   * @returns {TaskNode[]}
   */
  const build = (parentId, prefix) => (byParent.get(parentId) ?? []).map((row, index) => {
    const number = prefix ? `${prefix}.${index + 1}` : String(index + 1)
    const children = build(row.id, number)
    const node = { ...row, number, hasChildren: children.length > 0, children }
    if (children.length > 0) {
      node.startDate = children.reduce((min, child) => (child.startDate < min ? child.startDate : min), children[0].startDate)
      node.endDate = children.reduce((max, child) => (child.endDate > max ? child.endDate : max), children[0].endDate)
      node.progress = Math.round(children.reduce((sum, child) => sum + child.progress, 0) / children.length)
      node.status = deriveSummaryStatus(children, node.progress)
    }
    return node
  })

  return build(null, '')
}

/**
 * @param {TaskNode[]} nodes
 * @param {TaskNode[]} [output]
 * @returns {TaskNode[]}
 */
function flatten(nodes, output = []) {
  for (const node of nodes) {
    output.push(node)
    flatten(node.children, output)
  }
  return output
}

/**
 * @param {TaskNode[]} nodes
 * @returns {TaskStats}
 */
export function summarize(nodes) {
  const flat = flatten(nodes)
  const today = todayIso()
  let done = 0
  let inProgress = 0
  let blocked = 0
  let overdue = 0
  for (const task of flat) {
    if (task.status === 'done') done += 1
    else {
      if (task.status === 'in_progress') inProgress += 1
      if (task.status === 'blocked') blocked += 1
      if (task.endDate < today) overdue += 1
    }
  }
  return {
    total: flat.length,
    done,
    inProgress,
    blocked,
    overdue,
    progress: flat.length === 0 ? 0 : Math.round((done / flat.length) * 100),
  }
}

/**
 * Resolve the durable database location; override with DSH_GANTT_DB.
 * @returns {string}
 */
export function resolveDatabasePath() {
  if (process.env.DSH_GANTT_DB) return process.env.DSH_GANTT_DB
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'gantt', 'tasks.db')
}

/**
 * SQLite-backed task store. Hierarchical numbers and rollups are derived at
 * read time, so writes never maintain them.
 */
export class GanttStore {
  /** @param {string} [file] */
  constructor(file = resolveDatabasePath()) {
    this.file = file
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    if (file !== ':memory:') {
      try {
        fs.chmodSync(file, 0o600)
      } catch {
        // best effort; the database may live on a filesystem without POSIX modes
      }
    }
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id, sort_order, created_at);
      CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, name TEXT NOT NULL, lane TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', blocker TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, track_id TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL DEFAULT '', start_date TEXT, end_date TEXT, dep TEXT NOT NULL DEFAULT '', done_when TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS plan_blocks (id TEXT PRIMARY KEY, plan_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '', end_time TEXT NOT NULL DEFAULT '', slot TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', landing TEXT NOT NULL DEFAULT '', estimate TEXT NOT NULL DEFAULT '', inspiration TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'skipped')), notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'schedule', source_ref TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_plan_blocks_date ON plan_blocks(plan_date, sort_order, start_time);
      CREATE TABLE IF NOT EXISTS day_plans (plan_date TEXT PRIMARY KEY, weekday TEXT NOT NULL DEFAULT '', day_kind TEXT NOT NULL DEFAULT '', market_open INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '', core_goal TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
      PRAGMA user_version = ${SCHEMA_VERSION};
    `)
  }

  /** Close the database handle; safe to call more than once. */
  close() {
    try {
      this.db.close()
    } catch {
      // already closed
    }
  }

  /**
   * @template T
   * @param {() => T} fn
   * @returns {T}
   */
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // keep the original error
      }
      throw error
    }
  }

  /** @returns {TaskRow[]} */
  listRows() {
    const rows = /** @type {TaskSqlRow[]} */ (this.db.prepare(`
      SELECT id, parent_id, title, description, status, progress,
             start_date, end_date, sort_order, created_at, updated_at
      FROM tasks
    `).all())
    return rows.map(row => ({
      id: row.id,
      parentId: row.parent_id ?? null,
      title: row.title,
      description: row.description,
      status: row.status,
      progress: row.progress,
      startDate: row.start_date,
      endDate: row.end_date,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  /** @returns {number} */
  count() {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM tasks').get()
    return /** @type {number} */ (row?.count ?? 0)
  }

  /** @returns {TaskNode[]} */
  tree() {
    return buildTree(this.listRows())
  }

  /** @returns {GanttSnapshot} */
  snapshot() {
    const tasks = this.tree()
    return {
      today: todayIso(),
      statuses: [...STATUSES],
      tasks,
      stats: summarize(tasks),
    }
  }

  /** @returns {GanttMeta} */
  meta() {
    return {
      dbPath: this.file === ':memory:' ? ':memory:' : path.resolve(this.file),
      statuses: [...STATUSES],
      schemaVersion: SCHEMA_VERSION,
      taskCount: this.count(),
      engine: 'node:sqlite',
    }
  }

  /**
   * @param {string} id
   * @returns {TaskRow | null}
   */
  getRow(id) {
    return this.listRows().find(row => row.id === id) ?? null
  }

  /**
   * @param {string} id
   * @returns {TaskNode | null}
   */
  getNode(id) {
    return flatten(this.tree()).find(node => node.id === id) ?? null
  }

  /**
   * @param {unknown} id
   * @returns {TaskRow}
   */
  requireRow(id) {
    if (typeof id !== 'string' || id.length === 0) throw new GanttError('id is required')
    const row = this.getRow(id)
    if (row === null) throw new GanttError(`task ${id} was not found`, 404)
    return row
  }

  /**
   * @param {string | null} parentId
   * @returns {number}
   */
  nextSortOrder(parentId) {
    const row = parentId === null
      ? this.db.prepare('SELECT MAX(sort_order) AS value FROM tasks WHERE parent_id IS NULL').get()
      : this.db.prepare('SELECT MAX(sort_order) AS value FROM tasks WHERE parent_id = ?').get(parentId)
    const value = /** @type {number | null} */ (row?.value ?? null)
    return (value ?? -1) + 1
  }

  /**
   * @param {string} candidateId
   * @param {string} ancestorId
   * @returns {boolean}
   */
  isDescendant(candidateId, ancestorId) {
    /** @type {string | null} */
    let current = candidateId
    /** @type {Set<string>} */
    const seen = new Set()
    while (current) {
      if (current === ancestorId) return true
      if (seen.has(current)) return true
      seen.add(current)
      const row = /** @type {{ parent_id: string | null } | undefined} */ (
        this.db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(current)
      )
      current = row?.parent_id ?? null
    }
    return false
  }

  /** @param {string | null} parentId */
  recomputeAncestors(parentId) {
    const now = new Date().toISOString()
    /** @type {string | null} */
    let current = parentId
    /** @type {Set<string>} */
    const seen = new Set()
    while (current) {
      if (seen.has(current)) break
      seen.add(current)
      const row = /** @type {{ parent_id: string | null } | undefined} */ (
        this.db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(current)
      )
      if (!row) break
      const children = /** @type {ChildSummaryRow[]} */ (this.db.prepare(`
        SELECT status, progress, start_date, end_date
        FROM tasks WHERE parent_id = ?
      `).all(current))
      if (children.length > 0) {
        const startDate = children.reduce((min, child) => (child.start_date < min ? child.start_date : min), children[0].start_date)
        const endDate = children.reduce((max, child) => (child.end_date > max ? child.end_date : max), children[0].end_date)
        const progress = Math.round(children.reduce((sum, child) => sum + child.progress, 0) / children.length)
        const status = deriveSummaryStatus(children, progress)
        this.db.prepare(`
          UPDATE tasks
          SET start_date = ?, end_date = ?, progress = ?, status = ?, updated_at = ?
          WHERE id = ?
        `).run(startDate, endDate, progress, status, now, current)
      }
      current = row.parent_id ?? null
    }
  }

  /**
   * @param {TaskInput} [input]
   * @returns {TaskNode | null}
   */
  create(input = {}) {
    const parentId = normalizeParent(input.parentId)
    if (parentId !== null) this.requireRow(parentId)
    const title = normalizeTitle(input.title)
    const description = normalizeDescription(input.description)
    const status = normalizeStatus(input.status ?? 'todo')
    const progress = input.progress === undefined
      ? defaultProgress(status)
      : normalizeProgress(input.progress)
    const startDate = assertDate(input.startDate ?? todayIso(), 'startDate')
    const endDate = assertDate(input.endDate ?? addDays(startDate, 3), 'endDate')
    assertRange(startDate, endDate)
    const now = new Date().toISOString()
    const id = randomUUID()

    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO tasks (id, parent_id, title, description, status, progress,
                           start_date, end_date, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, parentId, title, description, status, progress,
        startDate, endDate, this.nextSortOrder(parentId), now, now,
      )
      this.recomputeAncestors(parentId)
    })

    return this.getNode(id)
  }

  /**
   * @param {string} id
   * @param {TaskPatch} [patch]
   * @returns {TaskNode | null}
   */
  update(id, patch = {}) {
    const row = this.requireRow(id)
    const next = { ...row }

    if (patch.title !== undefined) next.title = normalizeTitle(patch.title)
    if (patch.description !== undefined) next.description = normalizeDescription(patch.description)
    if (patch.startDate !== undefined) next.startDate = assertDate(patch.startDate, 'startDate')
    if (patch.endDate !== undefined) next.endDate = assertDate(patch.endDate, 'endDate')
    assertRange(next.startDate, next.endDate)

    let parentChanged = false
    if (Object.prototype.hasOwnProperty.call(patch, 'parentId')) {
      const parentId = normalizeParent(patch.parentId)
      if (parentId !== null) {
        this.requireRow(parentId)
        if (parentId === id) throw new GanttError('a task cannot be its own parent')
        if (this.isDescendant(parentId, id)) throw new GanttError('a task cannot move under one of its descendants')
      }
      parentChanged = parentId !== row.parentId
      next.parentId = parentId
    }

    let status = patch.status !== undefined ? normalizeStatus(patch.status) : row.status
    let progress = patch.progress !== undefined ? normalizeProgress(patch.progress) : row.progress
    if (patch.status !== undefined && patch.progress === undefined) {
      progress = defaultProgress(status, row.progress)
    }
    if (patch.progress !== undefined && patch.status === undefined) {
      status = statusFromProgress(progress, row.status)
    }
    next.status = status
    next.progress = progress
    if (parentChanged) next.sortOrder = this.nextSortOrder(next.parentId)

    const now = new Date().toISOString()
    this.transaction(() => {
      this.db.prepare(`
        UPDATE tasks
        SET parent_id = ?, title = ?, description = ?, status = ?, progress = ?,
            start_date = ?, end_date = ?, sort_order = ?, updated_at = ?
        WHERE id = ?
      `).run(
        next.parentId, next.title, next.description, next.status, next.progress,
        next.startDate, next.endDate, next.sortOrder, now, id,
      )
      this.recomputeAncestors(row.parentId)
      if (next.parentId !== row.parentId) this.recomputeAncestors(next.parentId)
    })

    return this.getNode(id)
  }

  /**
   * @param {string} id
   * @param {TaskStatus} status
   * @param {number} [progress]
   * @returns {TaskNode | null}
   */
  setStatus(id, status, progress) {
    /** @type {TaskPatch} */
    const patch = { status }
    if (progress !== undefined) patch.progress = progress
    return this.update(id, patch)
  }

  /**
   * @param {string} id
   * @param {SplitChild[]} children
   * @returns {{ parent: TaskNode | null, children: TaskNode[] }}
   */
  split(id, children) {
    const parent = this.requireRow(id)
    if (!Array.isArray(children) || children.length === 0) {
      throw new GanttError('children must be a non-empty array')
    }
    if (children.length > 100) throw new GanttError('a split may create at most 100 children')
    const normalized = children.map((child, index) => {
      if (child === null || typeof child !== 'object') throw new GanttError(`children[${index}] must be an object`)
      const status = normalizeStatus(child.status ?? 'todo')
      const progress = child.progress === undefined ? defaultProgress(status) : normalizeProgress(child.progress)
      const startDate = assertDate(child.startDate ?? parent.startDate, `children[${index}].startDate`)
      const endDate = assertDate(child.endDate ?? parent.endDate, `children[${index}].endDate`)
      assertRange(startDate, endDate)
      return {
        title: normalizeTitle(child.title),
        description: normalizeDescription(child.description),
        status,
        progress,
        startDate,
        endDate,
      }
    })
    const now = new Date().toISOString()
    /** @type {string[]} */
    const created = []
    this.transaction(() => {
      const base = this.nextSortOrder(id)
      normalized.forEach((child, index) => {
        const childId = randomUUID()
        this.db.prepare(`
          INSERT INTO tasks (id, parent_id, title, description, status, progress,
                             start_date, end_date, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          childId, id, child.title, child.description, child.status, child.progress,
          child.startDate, child.endDate, base + index, now, now,
        )
        created.push(childId)
      })
      this.recomputeAncestors(id)
    })
    return {
      parent: this.getNode(id),
      children: /** @type {TaskNode[]} */ (created.map(childId => this.getNode(childId)).filter(Boolean)),
    }
  }

  /**
   * @param {string} id
   * @returns {{ id: string, parentId: string | null }}
   */
  delete(id) {
    const row = this.requireRow(id)
    this.transaction(() => {
      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
      this.recomputeAncestors(row.parentId)
    })
    return { id, parentId: row.parentId }
  }

  /** @returns {{ seeded: boolean, taskCount: number }} */
  seed() {
    if (this.count() > 0) {
      return { seeded: false, taskCount: this.count() }
    }
    const today = todayIso()
    const now = new Date().toISOString()
    let created = 0

    /**
     * @param {string | null} parentId
     * @param {string} title
     * @param {string} description
     * @param {TaskStatus} status
     * @param {number} progress
     * @param {string} startDate
     * @param {string} endDate
     * @param {number} sortOrder
     * @returns {string}
     */
    const insert = (parentId, title, description, status, progress, startDate, endDate, sortOrder) => {
      const id = randomUUID()
      this.db.prepare(`
        INSERT INTO tasks (id, parent_id, title, description, status, progress,
                           start_date, end_date, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, parentId, title, description, status, progress,
        startDate, endDate, sortOrder, now, now,
      )
      created += 1
      return id
    }

    this.transaction(() => {
      const project = insert(
        null,
        'DSH 插件发布',
        '从数据层到界面的端到端交付。',
        'in_progress', 45,
        addDays(today, -10), addDays(today, 24), 0,
      )
      insert(project, '需求梳理', '确认甘特图、拆分和跟踪的范围。', 'done', 100, addDays(today, -10), addDays(today, -8), 0)
      const host = insert(project, 'Host 数据层', 'SQLite 表结构与 JSON 接口。', 'in_progress', 55, addDays(today, -7), addDays(today, 1), 1)
      insert(host, 'SQLite 表结构', '任务树、状态与层级编号。', 'done', 100, addDays(today, -7), addDays(today, -5), 0)
      insert(host, 'HTTP 接口', '创建、更新、拆分与状态流转。', 'in_progress', 60, addDays(today, -4), addDays(today, 1), 1)
      const view = insert(project, '前端甘特视图', '任务树、时间轴与周/月切换。', 'todo', 0, addDays(today, 2), addDays(today, 14), 2)
      insert(view, '周/月维度切换', '按天与按月的两种时间刻度。', 'todo', 0, addDays(today, 2), addDays(today, 7), 0)
      insert(view, '任务树与编号', '1.1.1 形式的层级标号。', 'todo', 0, addDays(today, 8), addDays(today, 14), 1)
      insert(project, '验收与发布', '回归、截图与安装验证。', 'todo', 0, addDays(today, 16), addDays(today, 24), 3)

      const plan = insert(
        null,
        '个人季度计划',
        '把长期目标拆成可以每周推进的小任务。',
        'in_progress', 30,
        addDays(today, -20), addDays(today, 45), 1,
      )
      insert(plan, '阅读 6 本书', '每周至少读完一本。', 'in_progress', 33, addDays(today, -20), addDays(today, 20), 0)
      insert(plan, '每周三次运动', '保持节奏比单次强度更重要。', 'todo', 10, addDays(today, -14), addDays(today, 45), 1)
      insert(plan, '季度复盘', '整理完成项和下一季度重点。', 'blocked', 0, addDays(today, 38), addDays(today, 45), 2)
    })

    return { seeded: true, taskCount: created }
  }

  /** Replace the imported tracker tree and day metadata in one transaction.
   * @param {ReplacePlanInput} [input] @returns {ReplacePlanCounts} */
  replacePlan(input = {}) {
    const tracks = normalizeList(input.tracks, 'tracks', (track, index) => ({ ...track, id: requireText(track.id, `tracks[${index}].id`), name: requireText(track.name, `tracks[${index}].name`), sortOrder: index }))
    const nodes = normalizeList(input.nodes, 'nodes', (node, index) => ({ ...node, id: requireText(node.id, `nodes[${index}].id`), title: requireText(node.title, `nodes[${index}].title`), startDate: node.startDate ? assertDate(node.startDate, `nodes[${index}].startDate`) : null, endDate: node.endDate ? assertDate(node.endDate, `nodes[${index}].endDate`) : null }))
    const days = normalizeList(input.days, 'days', (day, index) => ({ date: assertDate(day.date, `days[${index}].date`), weekday: textValue(day.weekday), dayKind: day.dayKind === undefined ? 'unknown' : oneOf(day.dayKind, `days[${index}].dayKind`, DAY_KINDS), marketOpen: day.marketOpen === true, label: textValue(day.label), coreGoal: textValue(day.coreGoal), source: textValue(day.source) || 'schedule' }))
    const now = new Date().toISOString()
    this.transaction(() => {
      this.db.exec('DELETE FROM nodes; DELETE FROM tracks')
      const addTrack = this.db.prepare('INSERT INTO tracks (id, name, lane, priority, state, blocker, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
      const addNode = this.db.prepare('INSERT INTO nodes (id, track_id, title, state, start_date, end_date, dep, done_when) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      const addDay = this.db.prepare('INSERT INTO day_plans (plan_date, weekday, day_kind, market_open, label, core_goal, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(plan_date) DO UPDATE SET weekday = excluded.weekday, day_kind = excluded.day_kind, market_open = excluded.market_open, label = excluded.label, core_goal = excluded.core_goal, source = excluded.source, updated_at = excluded.updated_at')
      for (const track of tracks) addTrack.run(track.id, track.name, textValue(track.lane), textValue(track.priority),
        textValue(track.state), textValue(track.blocker), track.sortOrder)
      for (const node of nodes) addNode.run(node.id, textValue(node.trackId), node.title, textValue(node.state),
        node.startDate, node.endDate, textValue(node.dep), textValue(node.doneWhen))
      for (const day of days) addDay.run(day.date, day.weekday, day.dayKind, day.marketOpen ? 1 : 0,
        day.label, day.coreGoal, day.source, now)
    })
    return { tracks: tracks.length, nodes: nodes.length, days: days.length }
  }
  /** Upsert one day's imported blocks; content is rewritten, status/notes survive.
   * @param {string} planDate @param {BlockDraft[]} drafts @returns {BlockUpsertCounts} */
  upsertPlanBlocks(planDate, drafts) {
    const date = assertDate(planDate, 'date')
    const normalized = normalizeList(drafts, 'blocks', (draft, index) => ({ title: requireText(draft.title, `blocks[${index}].title`), startTime: clockValue(draft.startTime, `blocks[${index}].startTime`), endTime: clockValue(draft.endTime, `blocks[${index}].endTime`), slot: draft.slot === undefined ? 'other' : oneOf(draft.slot, `blocks[${index}].slot`, PLAN_SLOTS), category: textValue(draft.category), detail: textValue(draft.detail), landing: textValue(draft.landing), estimate: textValue(draft.estimate), inspiration: textValue(draft.inspiration), sourceRef: textValue(draft.sourceRef) }))
    const ids = normalized.map((draft, index) => `${date}|${draft.startTime}|${index}`)
    const existing = /** @type {{ id: string }[]} */ (this.db.prepare('SELECT id FROM plan_blocks WHERE plan_date = ? AND source = ?').all(date, 'schedule'))
    const existingIds = new Set(existing.map(row => row.id))
    const now = new Date().toISOString()
    this.transaction(() => {
      const add = this.db.prepare("INSERT INTO plan_blocks (id, plan_date, start_time, end_time, slot, category, title, detail, landing, estimate, inspiration, sort_order, source, source_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'schedule', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time, slot = excluded.slot, category = excluded.category, title = excluded.title, detail = excluded.detail, landing = excluded.landing, estimate = excluded.estimate, inspiration = excluded.inspiration, sort_order = excluded.sort_order, source = excluded.source, source_ref = excluded.source_ref, updated_at = excluded.updated_at")
      normalized.forEach((draft, index) => add.run(ids[index], date, draft.startTime, draft.endTime, draft.slot,
        draft.category, draft.title, draft.detail, draft.landing, draft.estimate, draft.inspiration, index,
        draft.sourceRef, now, now))
      if (ids.length === 0) this.db.prepare('DELETE FROM plan_blocks WHERE plan_date = ? AND source = ?').run(date, 'schedule')
      else this.db.prepare(`DELETE FROM plan_blocks WHERE plan_date = ? AND source = ? AND id NOT IN (${ids.map(() => '?').join(', ')})`).run(date, 'schedule', ...ids)
    })
    return {
      inserted: ids.filter(id => !existingIds.has(id)).length,
      updated: ids.filter(id => existingIds.has(id)).length,
      removed: existing.filter(row => !ids.includes(row.id)).length,
    }
  }
  /** Read one day's bundle, including derived integrity warnings and stats.
   * @param {string} date @returns {DayPlanBundle} */
  dayPlan(date) {
    const planDate = assertDate(date, 'date')
    const row = /** @type {any} */ (this.db.prepare('SELECT plan_date AS date, weekday, day_kind AS dayKind, market_open, label, core_goal AS coreGoal, source FROM day_plans WHERE plan_date = ?').get(planDate))
    const blocks = /** @type {PlanBlock[]} */ (this.db.prepare(`SELECT ${BLOCK_COLUMNS} FROM plan_blocks WHERE plan_date = ? ORDER BY sort_order, start_time, id`).all(planDate))
    const tracks = /** @type {TrackRow[]} */ (this.db.prepare('SELECT id, name, lane, priority, state, blocker, sort_order AS sortOrder FROM tracks ORDER BY sort_order, id').all())
    const nodes = /** @type {NodeRow[]} */ (this.db.prepare('SELECT id, track_id AS trackId, title, state, start_date AS startDate, end_date AS endDate, dep, done_when AS doneWhen FROM nodes WHERE state NOT IN (?, ?) AND (start_date IS NOT NULL OR end_date IS NOT NULL) AND (start_date IS NULL OR start_date <= ?) AND (end_date IS NULL OR end_date >= ?) ORDER BY COALESCE(start_date, end_date), id LIMIT 12').all('已过', '撤销', addDays(planDate, 6), planDate))
    const { market_open, ...rest } = row ?? { market_open: 0 }
    const day = row === undefined ? null : { ...rest, marketOpen: market_open === 1 }
    /** @type {{ code: string, blockId?: string }[]} */
    const integrity = []
    for (const block of blocks) if (block.landing === '') integrity.push({ code: 'landing-missing', blockId: block.id })
    const evening = blocks.filter(block => block.slot === 'evening')
    if (evening.length === 0) integrity.push({ code: 'evening-missing' })
    for (const block of evening) if (block.inspiration === '') integrity.push({ code: 'inspiration-missing', blockId: block.id })
    if (day === null) integrity.push({ code: 'unplanned-day' })
    const done = blocks.filter(block => block.status === 'done').length
    const skipped = blocks.filter(block => block.status === 'skipped').length
    const inProgress = blocks.filter(block => block.status === 'in_progress').length
    const stats = { total: blocks.length, done, inProgress, skipped, remaining: blocks.length - done - skipped }
    return { day, blocks, tracks, nodes, integrity, stats }
  }
  /** Set a block's user status and optional notes (notes capped at 500 characters).
   * @param {string} id @param {PlanStatus} status @param {string | null} [notes] @returns {PlanBlock} */
  setBlockStatus(id, status, notes) {
    if (typeof id !== 'string' || id === '') throw new GanttError('id is required')
    if (notes !== undefined && notes !== null && typeof notes !== 'string') throw new GanttError('notes must be a string')
    if (typeof notes === 'string' && [...notes].length > MAX_NOTES) throw new GanttError(`notes must be at most ${MAX_NOTES} characters`)
    const nextStatus = oneOf(status, 'status', PLAN_STATUSES)
    const nextNotes = notes === undefined ? undefined : notes === null ? '' : notes
    const found = this.db.prepare('SELECT id FROM plan_blocks WHERE id = ?').get(id)
    if (found === undefined) throw new GanttError(`plan block ${id} was not found`, 404)
    const now = new Date().toISOString()
    this.transaction(() => {
      if (nextNotes === undefined) this.db.prepare('UPDATE plan_blocks SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now, id)
      else this.db.prepare('UPDATE plan_blocks SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(nextStatus, nextNotes, now, id)
    })
    return /** @type {PlanBlock} */ (this.db.prepare(`SELECT ${BLOCK_COLUMNS} FROM plan_blocks WHERE id = ?`).get(id))
  }
}

