import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  CONTEXT_DEFAULT_LIMIT,
  CONTEXT_MAX_LIMIT,
  CONTEXT_MIN_LIMIT,
  DECOMPOSE_MAX_DEPTH,
  LINK_TYPES,
  TASK_KINDS,
  addDays,
  buildTree,
  compareRefs,
  computeBrief,
  dayToIso,
  deriveSummaryStatus,
  flattenTree,
  isoToDay,
  materializeTracker,
  parseLinks,
  parseLinksJson,
  renderContextDocument,
  slotForStart,
  summarize,
  todayIso,
} from './tree.js'

/** @typedef {import('./tree.js').TaskStatus} TaskStatus */
/** @typedef {import('./tree.js').TaskKind} TaskKind */
/** @typedef {import('./tree.js').TaskLink} TaskLink */
/** @typedef {import('./tree.js').LinkType} LinkType */
/** @typedef {import('./tree.js').TreeTask} TaskRow */
/** @typedef {import('./tree.js').TreeTaskNode} TaskNode */
/** @typedef {import('./tree.js').Brief} Brief */
/** @typedef {import('./tree.js').SnapshotTrack} SnapshotTrack */
/** @typedef {import('./tree.js').SnapshotNode} SnapshotNode */

/** @type {TaskStatus[]} */
export const STATUSES = ['todo', 'in_progress', 'blocked', 'done']
export const SCHEMA_VERSION = 3
/** @type {PlanStatus[]} */
export const PLAN_STATUSES = ['todo', 'in_progress', 'done', 'skipped']
const PLAN_SLOTS = ['morning', 'daytime', 'evening', 'other']
const DAY_KINDS = ['workday', 'weekend', 'unknown']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_TITLE = 200
const MAX_NOTES = 500
const MAX_DESCRIPTION = 4000
const BLOCK_COLUMNS = 'id, plan_date AS planDate, start_time AS startTime, end_time AS endTime, slot, category, title, detail, landing, estimate, inspiration, status, notes, sort_order AS sortOrder, source, source_ref AS sourceRef'
const TASK_COLUMNS = 'id, parent_id AS parentId, title, description, status, progress, start_date AS startDate, end_date AS endDate, sort_order AS sortOrder, created_at AS createdAt, updated_at AS updatedAt, kind, ref, state, lane, dep, done_when AS doneWhen, landing, estimate, category, inspiration, links, source'
const TASK_SELECT = `SELECT ${TASK_COLUMNS} FROM tasks`
const INSERT_TASK = 'INSERT INTO tasks (id, parent_id, title, description, status, progress, start_date, end_date, sort_order, kind, ref, state, lane, dep, done_when, landing, estimate, category, inspiration, links, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
const UPDATE_TASK = 'UPDATE tasks SET parent_id = ?, title = ?, description = ?, status = ?, progress = ?, start_date = ?, end_date = ?, sort_order = ?, kind = ?, ref = ?, state = ?, lane = ?, dep = ?, done_when = ?, landing = ?, estimate = ?, category = ?, inspiration = ?, links = ?, source = ?, updated_at = ? WHERE id = ?'
const UPDATE_MATERIALIZED = 'UPDATE tasks SET parent_id = ?, title = ?, description = ?, status = ?, progress = ?, start_date = ?, end_date = ?, sort_order = ?, state = ?, lane = ?, dep = ?, done_when = ?, landing = ?, estimate = ?, category = ?, inspiration = ?, links = ?, updated_at = ? WHERE id = ?'
/** @type {Record<string, string>} */
const TASK_EXTRA_COLUMNS = {
  kind: "TEXT NOT NULL DEFAULT 'task'",
  ref: "TEXT NOT NULL DEFAULT ''",
  state: "TEXT NOT NULL DEFAULT ''",
  lane: "TEXT NOT NULL DEFAULT ''",
  dep: "TEXT NOT NULL DEFAULT ''",
  done_when: "TEXT NOT NULL DEFAULT ''",
  landing: "TEXT NOT NULL DEFAULT ''",
  estimate: "TEXT NOT NULL DEFAULT ''",
  category: "TEXT NOT NULL DEFAULT ''",
  inspiration: "TEXT NOT NULL DEFAULT ''",
  links: "TEXT NOT NULL DEFAULT '[]'",
  source: "TEXT NOT NULL DEFAULT 'manual'",
}
const CREATE_SCHEMA = `
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
    updated_at TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'task',
    ref TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    lane TEXT NOT NULL DEFAULT '',
    dep TEXT NOT NULL DEFAULT '',
    done_when TEXT NOT NULL DEFAULT '',
    landing TEXT NOT NULL DEFAULT '',
    estimate TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    inspiration TEXT NOT NULL DEFAULT '',
    links TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'manual'
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id, sort_order, created_at);
  CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, name TEXT NOT NULL, lane TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', blocker TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, track_id TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL DEFAULT '', start_date TEXT, end_date TEXT, dep TEXT NOT NULL DEFAULT '', done_when TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS plan_blocks (id TEXT PRIMARY KEY, plan_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '', end_time TEXT NOT NULL DEFAULT '', slot TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', landing TEXT NOT NULL DEFAULT '', estimate TEXT NOT NULL DEFAULT '', inspiration TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'skipped')), notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'schedule', source_ref TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_plan_blocks_date ON plan_blocks(plan_date, sort_order, start_time);
  CREATE TABLE IF NOT EXISTS day_plans (plan_date TEXT PRIMARY KEY, weekday TEXT NOT NULL DEFAULT '', day_kind TEXT NOT NULL DEFAULT '', market_open INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '', core_goal TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
`

/**
 * Demo tasks inserted by `seed()`: parent index, title, description, status,
 * progress, start offset (days from today), end offset, sibling order.
 * @type {[number | null, string, string, TaskStatus, number, number, number, number][]}
 */
const SEED_TASKS = [
  [null, 'DSH 插件发布', '从数据层到界面的端到端交付。', 'in_progress', 45, -10, 24, 0],
  [0, '需求梳理', '确认甘特图、拆分和跟踪的范围。', 'done', 100, -10, -8, 0],
  [0, 'Host 数据层', 'SQLite 表结构与 JSON 接口。', 'in_progress', 55, -7, 1, 1],
  [2, 'SQLite 表结构', '任务树、状态与层级编号。', 'done', 100, -7, -5, 0],
  [2, 'HTTP 接口', '创建、更新、拆分与状态流转。', 'in_progress', 60, -4, 1, 1],
  [0, '前端甘特视图', '任务树、时间轴与周/月切换。', 'todo', 0, 2, 14, 2],
  [5, '周/月维度切换', '按天与按月的两种时间刻度。', 'todo', 0, 2, 7, 0],
  [5, '任务树与编号', '1.1.1 形式的层级标号。', 'todo', 0, 8, 14, 1],
  [0, '验收与发布', '回归、截图与安装验证。', 'todo', 0, 16, 24, 3],
  [null, '个人季度计划', '把长期目标拆成可以每周推进的小任务。', 'in_progress', 30, -20, 45, 1],
  [9, '阅读 6 本书', '每周至少读完一本。', 'in_progress', 33, -20, 20, 0],
  [9, '每周三次运动', '保持节奏比单次强度更重要。', 'todo', 10, -14, 45, 1],
  [9, '季度复盘', '整理完成项和下一季度重点。', 'blocked', 0, 38, 45, 2],
]

/** @typedef {{ status: TaskStatus, progress: number, start_date: string, end_date: string }} ChildSummaryRow */
/** @typedef {'todo' | 'in_progress' | 'done' | 'skipped'} PlanStatus */
/** @typedef {'morning' | 'daytime' | 'evening' | 'other'} PlanSlot */
/** @typedef {'workday' | 'weekend' | 'unknown'} DayKind */
/** @typedef {{ id: string, ref: string, name: string, lane: string, priority: string, state: string,
 * blocker: string, sortOrder: number }} TrackRow */
/** @typedef {{ id: string, ref: string, kind: TaskKind, trackId: string, title: string, state: string,
 * startDate: string, endDate: string, dep: string, doneWhen: string, landing: string, estimate: string,
 * category: string, inspiration: string, links: TaskLink[] }} NodeRow */
/** @typedef {{ date: string, weekday: string, dayKind: DayKind, marketOpen: boolean, label: string,
 * coreGoal: string, source: string }} DayPlanRow */
/** @typedef {{ title: string, startTime?: string, endTime?: string, slot?: PlanSlot, category?: string,
 * detail?: string, landing?: string, estimate?: string, inspiration?: string, sortOrder?: number,
 * sourceRef?: string }} BlockDraft */
/** @typedef {{ id: string, planDate: string, startTime: string, endTime: string, slot: PlanSlot,
 * category: string, title: string, detail: string, landing: string, estimate: string, inspiration: string,
 * status: PlanStatus, notes: string, sortOrder: number, source: string, sourceRef: string }} PlanBlock */
/** @typedef {{ day: DayPlanRow | null, blocks: PlanBlock[], nodes: NodeRow[], tracks: TrackRow[],
 * integrity: { code: string, blockId?: string }[],
 * stats: { total: number, done: number, inProgress: number, skipped: number, remaining: number } }} DayPlanBundle */
/** Inputs are validated field by field, so partial parsed shapes are accepted.
 * @typedef {{ tracks?: any[], nodes?: any[], days?: any[] }} ReplacePlanInput */
/** @typedef {{ tracks: number, nodes: number, days: number, tasks: BlockUpsertCounts }} ReplacePlanCounts */
/** @typedef {{ inserted: number, updated: number, removed: number }} BlockUpsertCounts */
/** @typedef {{ date: string, startTime: string, endTime: string, slot: PlanSlot, category: string,
 * landing: string, estimate: string, inspiration: string, title: string, detail: string }} TaskBlockPlan */
/** Plan fields a decompose child may override; omitted fields inherit the child. @typedef {{ date: string,
 * startTime: string, endTime: string, slot: PlanSlot, category?: string, landing?: string,
 * estimate?: string, inspiration?: string }} PlanOverride */
/** @typedef {{ date: unknown, startTime?: unknown, endTime?: unknown, slot?: unknown, category?: unknown,
 * landing?: unknown, estimate?: unknown, inspiration?: unknown }} PlanDraftInput */
/** @typedef {{ date?: unknown, startTime?: unknown, endTime?: unknown, slot?: unknown, category?: unknown,
 * landing?: unknown, estimate?: unknown, inspiration?: unknown, detail?: unknown }} ScheduleInput */
/** @typedef {{ title?: unknown, description?: unknown, startDate?: unknown, endDate?: unknown,
 * status?: unknown, progress?: unknown, lane?: unknown, dep?: unknown, doneWhen?: unknown,
 * landing?: unknown, estimate?: unknown, category?: unknown, inspiration?: unknown, links?: unknown,
 * plan?: PlanDraftInput }} DecomposeChildInput */
/** @typedef {{ date?: string, root?: string, limit?: number }} ContextOptions */
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
/** @typedef {{ total: number, done: number, inProgress: number, blocked: number, overdue: number,
 * progress: number }} TaskStats */
/** @typedef {{ today: string, statuses: TaskStatus[], tasks: TaskNode[], stats: TaskStats,
 * brief: Brief }} GanttSnapshot */
/** @typedef {{ dbPath: string, statuses: TaskStatus[], schemaVersion: number, taskCount: number,
 * engine: string, kinds: TaskKind[], linkTypes: LinkType[] }} GanttMeta */

/** A validation or lookup failure with an HTTP-friendly status. */
export class GanttError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 400) {
    super(message)
    this.name = 'GanttError'
    this.status = status
  }
}

/** @param {unknown} value @param {string} field @returns {string} */
function assertDate(value, field) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) throw new GanttError(`${field} must be a YYYY-MM-DD date`)
  const day = isoToDay(value)
  if (!Number.isFinite(day) || dayToIso(day) !== value) throw new GanttError(`${field} is not a valid calendar date`)
  return value
}

/** @param {string} startDate @param {string} endDate @returns {void} */
function assertRange(startDate, endDate) {
  if (startDate > endDate) throw new GanttError('endDate must not be before startDate')
}

/** @param {unknown} value @returns {string} */
function normalizeTitle(value) {
  if (typeof value !== 'string') throw new GanttError('title is required')
  const title = value.trim().replace(/\s+/g, ' ')
  if (title.length === 0) throw new GanttError('title must not be empty')
  if ([...title].length > MAX_TITLE) throw new GanttError(`title must be at most ${MAX_TITLE} characters`)
  return title
}

/** @param {unknown} value @returns {string} */
function normalizeDescription(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new GanttError('description must be a string')
  if ([...value].length > MAX_DESCRIPTION) throw new GanttError(`description must be at most ${MAX_DESCRIPTION} characters`)
  return value.trim()
}

/** @param {unknown} value @returns {TaskStatus} */
function normalizeStatus(value) {
  const status = STATUSES.find(candidate => candidate === value)
  if (status === undefined) throw new GanttError(`status must be one of ${STATUSES.join(', ')}`)
  return status
}

/** @param {unknown} value @returns {number} */
function normalizeProgress(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new GanttError('progress must be a number from 0 to 100')
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** @param {unknown} value @returns {string | null} */
function normalizeParent(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new GanttError('parentId must be a task id or null')
  return value
}

/** @param {TaskStatus} status @param {number} [current] @returns {number} */
function defaultProgress(status, current = 0) {
  if (status === 'done') return 100
  if (status === 'todo') return 0
  if (status === 'blocked') return current
  return current > 0 && current < 100 ? current : 50
}

/** @param {number} progress @param {TaskStatus} current @returns {TaskStatus} */
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
/** @param {unknown} value @param {string} field @param {(item: any, index: number) => object} normalize @returns {any[]} */
function normalizeList(value, field, normalize) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new GanttError(`${field} must be an array`)
  return value.map((item, index) => {
    if (item === null || typeof item !== 'object') throw new GanttError(`${field}[${index}] must be an object`)
    return normalize(item, index)
  })
}

const TEXT_FIELDS = /** @type {const} */ (['lane', 'dep', 'doneWhen', 'landing', 'estimate', 'category', 'inspiration'])
/** @param {unknown} value @param {string} field @returns {string} */
function textField(value, field) {
  if (typeof value !== 'string') throw new GanttError(`${field} must be a string`)
  return value.trim()
}
/** @typedef {{ lane: string, dep: string, doneWhen: string, landing: string, estimate: string,
 * category: string, inspiration: string }} TaskExtras */
/** @param {Record<string, any>} source @param {string} [prefix] @returns {TaskExtras} */
function normalizeExtras(source, prefix = '') {
  /** @type {TaskExtras} */
  const extras = { lane: '', dep: '', doneWhen: '', landing: '', estimate: '', category: '', inspiration: '' }
  for (const field of TEXT_FIELDS) extras[field] = source[field] === undefined ? '' : textField(source[field], `${prefix}${field}`)
  return extras
}
/** @param {unknown} value @returns {TaskKind} */
function normalizeKind(value) {
  if (value === undefined) return 'task'
  return /** @type {TaskKind} */ (oneOf(value, 'kind', TASK_KINDS))
}
/** @param {unknown} value @returns {string} */
function normalizeRef(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new GanttError('ref must be a string')
  return value.trim()
}
/** @param {PlanDraftInput} plan @param {number} index @returns {PlanSlot} */
function planSlot(plan, index) {
  return plan.slot === undefined
    ? slotForStart(plan.startTime)
    : /** @type {PlanSlot} */ (oneOf(plan.slot, `children[${index}].plan.slot`, PLAN_SLOTS))
}
/** @param {unknown} plan @param {number} index @returns {PlanOverride} */
function normalizePlanDraft(plan, index) {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) throw new GanttError(`children[${index}].plan must be an object`)
  const record = /** @type {PlanDraftInput} */ (plan)
  /** @type {PlanOverride} */
  const draft = {
    date: assertDate(record.date, `children[${index}].plan.date`),
    startTime: clockValue(record.startTime, `children[${index}].plan.startTime`),
    endTime: clockValue(record.endTime, `children[${index}].plan.endTime`),
    slot: planSlot(record, index),
  }
  if (record.category !== undefined) draft.category = textValue(record.category)
  if (record.landing !== undefined) draft.landing = textValue(record.landing)
  if (record.estimate !== undefined) draft.estimate = textValue(record.estimate)
  if (record.inspiration !== undefined) draft.inspiration = textValue(record.inspiration)
  return draft
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
    this.db.exec(CREATE_SCHEMA)
    this.migrate()
  }

  /** Upgrade an older database in one transaction: add columns, index, version, backfill. */
  migrate() {
    const version = /** @type {{ user_version: number }} */ (this.db.prepare('PRAGMA user_version').get()).user_version
    const columns = new Set(/** @type {{ name: string }[]} */ (this.db.prepare('PRAGMA table_info(tasks)').all()).map(row => row.name))
    const missing = Object.keys(TASK_EXTRA_COLUMNS).filter(name => !columns.has(name))
    this.transaction(() => {
      for (const name of missing) this.db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${TASK_EXTRA_COLUMNS[name]}`)
      this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_ref ON tasks(kind, ref) WHERE ref <> ''")
      if (version < SCHEMA_VERSION) {
        const tracks = /** @type {SnapshotTrack[]} */ (this.db.prepare('SELECT id, name, lane, state, blocker, sort_order AS sortOrder FROM tracks ORDER BY sort_order, id').all())
        const nodes = /** @type {SnapshotNode[]} */ (this.db.prepare('SELECT id, track_id AS trackId, title, state, start_date AS startDate, end_date AS endDate, dep, done_when AS doneWhen FROM nodes ORDER BY id').all())
        this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
        this.syncTrackerTree(tracks, nodes)
      }
    })
  }

  /** Close the database handle; safe to call more than once. */
  close() {
    try {
      this.db.close()
    } catch {
      // already closed
    }
  }

  /** @template T @param {() => T} fn @returns {T} */
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
    const rows = /** @type {any[]} */ (this.db.prepare(TASK_SELECT).all())
    return rows.map(row => ({ ...row, links: parseLinksJson(row.links) }))
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
    return { today: todayIso(), statuses: [...STATUSES], tasks, stats: summarize(tasks), brief: computeBrief(tasks) }
  }

  /** @returns {GanttMeta} */
  meta() {
    return {
      dbPath: this.file === ':memory:' ? ':memory:' : path.resolve(this.file),
      statuses: [...STATUSES],
      schemaVersion: SCHEMA_VERSION,
      taskCount: this.count(),
      engine: 'node:sqlite',
      kinds: [...TASK_KINDS],
      linkTypes: [...LINK_TYPES],
    }
  }

  /** @param {string} id @returns {TaskRow | null} */
  getRow(id) {
    return this.listRows().find(row => row.id === id) ?? null
  }

  /** @param {string} id @returns {TaskNode | null} */
  getNode(id) {
    return flattenTree(this.tree()).find(node => node.id === id) ?? null
  }

  /** @param {unknown} id @returns {TaskRow} */
  requireRow(id) {
    if (typeof id !== 'string' || id.length === 0) throw new GanttError('id is required')
    const row = this.getRow(id)
    if (row === null) throw new GanttError(`task ${id} was not found`, 404)
    return row
  }

  /** @param {string | null} parentId @returns {number} */
  nextSortOrder(parentId) {
    const row = parentId === null
      ? this.db.prepare('SELECT MAX(sort_order) AS value FROM tasks WHERE parent_id IS NULL').get()
      : this.db.prepare('SELECT MAX(sort_order) AS value FROM tasks WHERE parent_id = ?').get(parentId)
    const value = /** @type {number | null} */ (row?.value ?? null)
    return (value ?? -1) + 1
  }

  /** @param {string} candidateId @param {string} ancestorId @returns {boolean} */
  isDescendant(candidateId, ancestorId) {
    /** @type {string | null} */
    let current = candidateId
    /** @type {Set<string>} */
    const seen = new Set()
    while (current) {
      if (current === ancestorId) return true
      if (seen.has(current)) return true
      seen.add(current)
      const row = /** @type {{ parent_id: string | null } | undefined} */ (this.db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(current))
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
      const row = /** @type {{ parent_id: string | null, state: string } | undefined} */ (this.db.prepare('SELECT parent_id, state FROM tasks WHERE id = ?').get(current))
      if (!row) break
      const children = /** @type {ChildSummaryRow[]} */ (this.db.prepare('SELECT status, progress, start_date, end_date FROM tasks WHERE parent_id = ?').all(current))
      if (children.length > 0) {
        const startDate = children.reduce((min, child) => (child.start_date < min ? child.start_date : min), children[0].start_date)
        const endDate = children.reduce((max, child) => (child.end_date > max ? child.end_date : max), children[0].end_date)
        const progress = Math.round(children.reduce((sum, child) => sum + child.progress, 0) / children.length)
        this.db.prepare('UPDATE tasks SET start_date = ?, end_date = ?, progress = ?, status = ?, updated_at = ? WHERE id = ?')
          .run(startDate, endDate, progress, deriveSummaryStatus(children, progress, row.state), now, current)
      }
      current = row.parent_id ?? null
    }
  }

  /** @param {TaskInsert} fields @returns {string} */
  insertTask(fields) {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(INSERT_TASK).run(
      id, fields.parentId, fields.title, fields.description, fields.status, fields.progress,
      fields.startDate, fields.endDate, fields.sortOrder, fields.kind, fields.ref, fields.state,
      fields.lane, fields.dep, fields.doneWhen, fields.landing, fields.estimate, fields.category,
      fields.inspiration, JSON.stringify(fields.links), fields.source, now, now,
    )
    return id
  }

  /** @param {unknown} value @returns {TaskLink[]} */
  normalizeLinks(value) {
    const parsed = parseLinks(value)
    if (parsed.error !== null) throw new GanttError(parsed.error)
    return parsed.links
  }

  /** @param {TaskKind} kind @param {string} ref */
  assertRefFree(kind, ref) {
    const found = this.db.prepare('SELECT id FROM tasks WHERE kind = ? AND ref = ?').get(kind, ref)
    if (found !== undefined) throw new GanttError(`task with kind ${kind} and ref ${ref} already exists`, 409)
  }

  /** @param {TaskInput} [input] @returns {TaskNode | null} */
  create(input = {}) {
    const parentId = normalizeParent(input.parentId)
    if (parentId !== null) this.requireRow(parentId)
    const title = normalizeTitle(input.title)
    const description = normalizeDescription(input.description)
    const status = normalizeStatus(input.status ?? 'todo')
    const progress = input.progress === undefined ? defaultProgress(status) : normalizeProgress(input.progress)
    const startDate = assertDate(input.startDate ?? todayIso(), 'startDate')
    const endDate = assertDate(input.endDate ?? addDays(startDate, 3), 'endDate')
    assertRange(startDate, endDate)
    const kind = normalizeKind(input.kind)
    const ref = normalizeRef(input.ref)
    if (ref !== '') this.assertRefFree(kind, ref)
    const links = this.normalizeLinks(input.links)
    const id = this.transaction(() => {
      const created = this.insertTask({ parentId, title, description, status, progress, startDate, endDate, sortOrder: this.nextSortOrder(parentId), kind, ref, state: '', ...normalizeExtras(input), links, source: 'manual' })
      this.recomputeAncestors(parentId)
      return created
    })
    return this.getNode(id)
  }

  /** @param {string} id @param {TaskPatch} [patch] @returns {TaskNode | null} */
  update(id, patch = {}) {
    const row = this.requireRow(id)
    const next = { ...row }
    if (patch.title !== undefined) next.title = normalizeTitle(patch.title)
    if (patch.description !== undefined) next.description = normalizeDescription(patch.description)
    if (patch.startDate !== undefined) next.startDate = assertDate(patch.startDate, 'startDate')
    if (patch.endDate !== undefined) next.endDate = assertDate(patch.endDate, 'endDate')
    assertRange(next.startDate, next.endDate)
    for (const field of TEXT_FIELDS) if (patch[field] !== undefined) next[field] = textField(patch[field], field)
    if (patch.links !== undefined) next.links = this.normalizeLinks(patch.links)
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
    if (patch.status !== undefined && patch.progress === undefined) progress = defaultProgress(status, row.progress)
    if (patch.progress !== undefined && patch.status === undefined) status = statusFromProgress(progress, row.status)
    next.status = status
    next.progress = progress
    if (parentChanged) next.sortOrder = this.nextSortOrder(next.parentId)
    const now = new Date().toISOString()
    this.transaction(() => {
      this.db.prepare(UPDATE_TASK).run(
        next.parentId, next.title, next.description, next.status, next.progress, next.startDate, next.endDate,
        next.sortOrder, next.kind, next.ref, next.state, next.lane, next.dep, next.doneWhen, next.landing,
        next.estimate, next.category, next.inspiration, JSON.stringify(next.links), next.source, now, id,
      )
      this.recomputeAncestors(row.parentId)
      if (next.parentId !== row.parentId) this.recomputeAncestors(next.parentId)
    })
    return this.getNode(id)
  }

  /** @param {string} id @param {TaskStatus} status @param {number} [progress] @returns {TaskNode | null} */
  setStatus(id, status, progress) {
    /** @type {TaskPatch} */
    const patch = { status }
    if (progress !== undefined) patch.progress = progress
    return this.update(id, patch)
  }

  /** @param {string} id @param {SplitChild[]} children @returns {{ parent: TaskNode | null, children: TaskNode[] }} */
  split(id, children) {
    const parent = this.requireRow(id)
    if (!Array.isArray(children) || children.length === 0) throw new GanttError('children must be a non-empty array')
    if (children.length > 100) throw new GanttError('a split may create at most 100 children')
    const normalized = children.map((child, index) => {
      if (child === null || typeof child !== 'object') throw new GanttError(`children[${index}] must be an object`)
      const status = normalizeStatus(child.status ?? 'todo')
      const startDate = assertDate(child.startDate ?? parent.startDate, `children[${index}].startDate`)
      const endDate = assertDate(child.endDate ?? parent.endDate, `children[${index}].endDate`)
      assertRange(startDate, endDate)
      return { title: normalizeTitle(child.title), description: normalizeDescription(child.description), status, progress: child.progress === undefined ? defaultProgress(status) : normalizeProgress(child.progress), startDate, endDate, ref: '', ...normalizeExtras(child), links: this.normalizeLinks(child.links) }
    })
    /** @type {string[]} */
    const created = []
    this.transaction(() => {
      const base = this.nextSortOrder(id)
      normalized.forEach((child, index) => created.push(this.insertTask({
        parentId: id, ...child, sortOrder: base + index, kind: 'task', ref: '', state: '', source: 'manual',
      })))
      this.recomputeAncestors(id)
    })
    return { parent: this.getNode(id), children: /** @type {TaskNode[]} */ (created.map(childId => this.getNode(childId)).filter(Boolean)) }
  }

  /** @param {string} id @returns {{ id: string, parentId: string | null }} */
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
    if (this.count() > 0) return { seeded: false, taskCount: this.count() }
    const today = todayIso()
    /** @type {string[]} */
    const ids = []
    this.transaction(() => {
      for (const [parent, title, description, status, progress, startOffset, endOffset, sortOrder] of SEED_TASKS) {
        ids.push(this.insertTask({ parentId: parent === null ? null : ids[parent], title, description, status, progress, startDate: addDays(today, startOffset), endDate: addDays(today, endOffset), sortOrder, kind: 'task', ref: '', state: '', lane: '', dep: '', doneWhen: '', landing: '', estimate: '', category: '', inspiration: '', links: [], source: 'manual' }))
      }
    })
    return { seeded: true, taskCount: ids.length }
  }

  /** Replace the imported tracker tree and day metadata in one transaction.
   * @param {ReplacePlanInput} [input] @returns {ReplacePlanCounts} */
  replacePlan(input = {}) {
    const tracks = normalizeList(input.tracks, 'tracks', (track, index) => ({ ...track, id: requireText(track.id, `tracks[${index}].id`), name: requireText(track.name, `tracks[${index}].name`), sortOrder: index }))
    const nodes = normalizeList(input.nodes, 'nodes', (node, index) => ({ ...node, id: requireText(node.id, `nodes[${index}].id`), title: requireText(node.title, `nodes[${index}].title`), startDate: node.startDate ? assertDate(node.startDate, `nodes[${index}].startDate`) : null, endDate: node.endDate ? assertDate(node.endDate, `nodes[${index}].endDate`) : null }))
    const days = normalizeList(input.days, 'days', (day, index) => ({ date: assertDate(day.date, `days[${index}].date`), weekday: textValue(day.weekday), dayKind: day.dayKind === undefined ? 'unknown' : oneOf(day.dayKind, `days[${index}].dayKind`, DAY_KINDS), marketOpen: day.marketOpen === true, label: textValue(day.label), coreGoal: textValue(day.coreGoal), source: textValue(day.source) || 'schedule' }))
    const now = new Date().toISOString()
    const tasks = this.transaction(() => {
      this.db.exec('DELETE FROM nodes; DELETE FROM tracks')
      const addTrack = this.db.prepare('INSERT INTO tracks (id, name, lane, priority, state, blocker, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
      const addNode = this.db.prepare('INSERT INTO nodes (id, track_id, title, state, start_date, end_date, dep, done_when) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      const addDay = this.db.prepare('INSERT INTO day_plans (plan_date, weekday, day_kind, market_open, label, core_goal, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(plan_date) DO UPDATE SET weekday = excluded.weekday, day_kind = excluded.day_kind, market_open = excluded.market_open, label = excluded.label, core_goal = excluded.core_goal, source = excluded.source, updated_at = excluded.updated_at')
      for (const track of tracks) addTrack.run(track.id, track.name, textValue(track.lane),
        textValue(track.priority), textValue(track.state), textValue(track.blocker), track.sortOrder)
      for (const node of nodes) addNode.run(node.id, textValue(node.trackId), node.title, textValue(node.state),
        node.startDate, node.endDate, textValue(node.dep), textValue(node.doneWhen))
      for (const day of days) addDay.run(day.date, day.weekday, day.dayKind, day.marketOpen ? 1 : 0,
        day.label, day.coreGoal, day.source, now)
      return this.syncTrackerTree(tracks, nodes)
    })
    return { tracks: tracks.length, nodes: nodes.length, days: days.length, tasks }
  }

  /** Materialise the tracker snapshot into the unified task tree, in the caller's transaction.
   * @param {SnapshotTrack[]} tracks @param {SnapshotNode[]} nodes @returns {BlockUpsertCounts} */
  syncTrackerTree(tracks, nodes) {
    const now = new Date().toISOString()
    const existing = this.listRows()
    const { inserts, updates, deletes } = materializeTracker({ tracks, nodes, existing, today: todayIso() })
    /** @type {Map<string, string>} */
    const idByRef = new Map()
    for (const row of existing) if (row.ref !== '') idByRef.set(row.ref, row.id)
    const insert = this.db.prepare(INSERT_TASK)
    const update = this.db.prepare(UPDATE_MATERIALIZED)
    const remove = this.db.prepare('DELETE FROM tasks WHERE id = ?')
    for (const draft of inserts) {
      const id = randomUUID()
      insert.run(id, draft.parentRef === null ? null : /** @type {string} */ (idByRef.get(draft.parentRef)), draft.title,
        draft.description, draft.status, draft.progress, draft.startDate, draft.endDate, draft.sortOrder,
        draft.kind, draft.ref, draft.state, draft.lane, draft.dep, draft.doneWhen, draft.landing,
        draft.estimate, draft.category, draft.inspiration, JSON.stringify(draft.links), draft.source, now, now)
      idByRef.set(draft.ref, id)
    }
    for (const draft of updates) {
      update.run(draft.parentRef === null ? null : /** @type {string} */ (idByRef.get(draft.parentRef)), draft.title,
        draft.description, draft.status, draft.progress, draft.startDate, draft.endDate, draft.sortOrder,
        draft.state, draft.lane, draft.dep, draft.doneWhen, draft.landing, draft.estimate, draft.category,
        draft.inspiration, JSON.stringify(draft.links), now, draft.id)
    }
    for (const id of deletes) remove.run(id)
    return { inserted: inserts.length, updated: updates.length, removed: deletes.length }
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

  /** Read one day's bundle, including the unified tree's tracks and nodes.
   * @param {string} date @returns {DayPlanBundle} */
  dayPlan(date) {
    const planDate = assertDate(date, 'date')
    const row = /** @type {any} */ (this.db.prepare('SELECT plan_date AS date, weekday, day_kind AS dayKind, market_open, label, core_goal AS coreGoal, source FROM day_plans WHERE plan_date = ?').get(planDate))
    const blocks = /** @type {PlanBlock[]} */ (this.db.prepare(`SELECT ${BLOCK_COLUMNS} FROM plan_blocks WHERE plan_date = ? ORDER BY sort_order, start_time, id`).all(planDate))
    const rows = this.listRows()
    const byId = new Map(rows.map(task => [task.id, task]))
    /** @param {TaskRow} task @returns {string} */
    const trackIdOf = (task) => {
      /** @type {TaskRow | undefined} */
      let current = task
      while (current !== undefined && current.kind !== 'track') current = byId.get(current.parentId ?? '')
      return current === undefined ? '' : current.id
    }
    const tracks = rows
      .filter(task => task.kind === 'track')
      .sort((left, right) => left.sortOrder - right.sortOrder || compareRefs(left.ref, right.ref))
      .map(task => ({ id: task.id, ref: task.ref, name: task.title, lane: task.lane, priority: '', state: task.state, blocker: task.description, sortOrder: task.sortOrder }))
    const windowEnd = addDays(planDate, 6)
    const nodes = rows
      .filter(task => task.kind === 'node'
        && task.state !== '已过'
        && task.state !== '撤销'
        && task.startDate <= windowEnd
        && task.endDate >= planDate)
      .sort((left, right) => left.startDate.localeCompare(right.startDate)
        || compareRefs(left.ref, right.ref)
        || left.id.localeCompare(right.id))
      .slice(0, 12)
      .map(task => ({
        id: task.id,
        ref: task.ref,
        kind: task.kind,
        trackId: trackIdOf(task),
        title: task.title,
        state: task.state,
        startDate: task.startDate,
        endDate: task.endDate,
        dep: task.dep,
        doneWhen: task.doneWhen,
        landing: task.landing,
        estimate: task.estimate,
        category: task.category,
        inspiration: task.inspiration,
        links: task.links,
      }))
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

  /** @param {string} id @returns {PlanBlock} */
  getPlanBlock(id) {
    return /** @type {PlanBlock} */ (this.db.prepare(`SELECT ${BLOCK_COLUMNS} FROM plan_blocks WHERE id = ?`).get(id))
  }

  /** Upsert the plan cell of one task on one date; user status and notes survive.
   * @param {string} taskId @param {TaskBlockPlan} plan @returns {string} */
  writeTaskBlock(taskId, plan) {
    const id = `task|${taskId}|${plan.date}`
    const now = new Date().toISOString()
    const existing = /** @type {{ sortOrder: number } | undefined} */ (this.db.prepare('SELECT sort_order AS sortOrder FROM plan_blocks WHERE id = ?').get(id))
    if (existing === undefined) {
      const next = /** @type {{ value: number }} */ (this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM plan_blocks WHERE plan_date = ?').get(plan.date))
      this.db.prepare('INSERT INTO plan_blocks (id, plan_date, start_time, end_time, slot, category, title, detail, landing, estimate, inspiration, status, sort_order, source, source_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'todo\', ?, \'task\', ?, ?, ?)')
        .run(id, plan.date, plan.startTime, plan.endTime, plan.slot, plan.category, plan.title, plan.detail, plan.landing, plan.estimate, plan.inspiration, next.value, `task:${taskId}`, now, now)
    } else {
      this.db.prepare('UPDATE plan_blocks SET start_time = ?, end_time = ?, slot = ?, category = ?, title = ?, detail = ?, landing = ?, estimate = ?, inspiration = ?, updated_at = ? WHERE id = ?')
        .run(plan.startTime, plan.endTime, plan.slot, plan.category, plan.title, plan.detail,
          plan.landing, plan.estimate, plan.inspiration, now, id)
    }
    return id
  }

  /** Decompose one task into child subtasks, optionally scheduling each into a plan cell.
   * `planDate` only sets the default child start/end dates; it never creates a plan
   * cell. A scheduled cell needs an explicit `plan` object on that child.
   * @param {string} id
   * @param {DecomposeChildInput[]} children
   * @param {unknown} [planDate]
   * @returns {{ parent: TaskNode | null, children: TaskNode[], blocks: PlanBlock[] }} */
  decompose(id, children, planDate) {
    const parent = this.requireRow(id)
    const parentNode = /** @type {TaskNode} */ (this.getNode(id))
    if (parentNode.number.split('.').length >= DECOMPOSE_MAX_DEPTH) throw new GanttError('decompose would exceed 4 levels')
    if (!Array.isArray(children) || children.length === 0) throw new GanttError('children must be a non-empty array')
    if (children.length > 100) throw new GanttError('a decompose may create at most 100 children')
    const fallbackDate = planDate === undefined || planDate === null || planDate === '' ? null : assertDate(planDate, 'planDate')
    const normalized = children.map((child, index) => {
      if (child === null || typeof child !== 'object') throw new GanttError(`children[${index}] must be an object`)
      const status = normalizeStatus(child.status ?? 'todo')
      const startDate = assertDate(child.startDate ?? fallbackDate ?? parent.startDate, `children[${index}].startDate`)
      const endDate = assertDate(child.endDate ?? (fallbackDate === null ? parent.endDate : addDays(startDate, 3)), `children[${index}].endDate`)
      assertRange(startDate, endDate)
      return { title: normalizeTitle(child.title), description: normalizeDescription(child.description), status, progress: child.progress === undefined ? defaultProgress(status) : normalizeProgress(child.progress), startDate, endDate, ...normalizeExtras(child, `children[${index}].`), links: this.normalizeLinks(child.links), plan: child.plan === undefined ? null : normalizePlanDraft(child.plan, index) }
    })
    const result = this.transaction(() => {
      const base = this.nextSortOrder(id)
      /** @type {string[]} */
      const blockIds = []
      const childIds = normalized.map((child, index) => {
        const childId = this.insertTask({ parentId: id, title: child.title, description: child.description, status: child.status, progress: child.progress, startDate: child.startDate, endDate: child.endDate, sortOrder: base + index, kind: 'task', ref: '', state: '', lane: child.lane, dep: child.dep, doneWhen: child.doneWhen, landing: child.landing, estimate: child.estimate, category: child.category, inspiration: child.inspiration, links: child.links, source: 'manual' })
        if (child.plan !== null) {
          blockIds.push(this.writeTaskBlock(childId, {
            date: child.plan.date,
            startTime: child.plan.startTime,
            endTime: child.plan.endTime,
            slot: child.plan.slot,
            category: child.plan.category ?? child.category,
            landing: child.plan.landing ?? child.landing,
            estimate: child.plan.estimate ?? child.estimate,
            inspiration: child.plan.inspiration ?? child.inspiration,
            title: child.title,
            detail: child.description || child.doneWhen,
          }))
        }
        return childId
      })
      this.recomputeAncestors(id)
      return { childIds, blockIds }
    })
    return {
      parent: this.getNode(id),
      children: /** @type {TaskNode[]} */ (result.childIds.map(childId => this.getNode(childId)).filter(Boolean)),
      blocks: result.blockIds.map(blockId => this.getPlanBlock(blockId)),
    }
  }

  /** Schedule one existing task into a day's plan grid, idempotently.
   * @param {string} id
   * @param {ScheduleInput} [input]
   * @returns {{ task: TaskNode | null, block: PlanBlock }} */
  scheduleTask(id, input = {}) {
    const row = this.requireRow(id)
    const date = assertDate(input.date, 'date')
    const startTime = clockValue(input.startTime, 'startTime')
    const endTime = clockValue(input.endTime, 'endTime')
    const slot = input.slot === undefined ? slotForStart(startTime) : /** @type {PlanSlot} */ (oneOf(input.slot, 'slot', PLAN_SLOTS))
    const blockId = this.transaction(() => this.writeTaskBlock(id, {
      date,
      startTime,
      endTime,
      slot,
      title: row.title,
      category: input.category === undefined ? row.category : textValue(input.category),
      landing: input.landing === undefined ? row.landing : textValue(input.landing),
      estimate: input.estimate === undefined ? row.estimate : textValue(input.estimate),
      inspiration: input.inspiration === undefined ? row.inspiration : textValue(input.inspiration),
      detail: input.detail === undefined ? row.doneWhen : textValue(input.detail),
    }))
    return { task: this.getNode(id), block: this.getPlanBlock(blockId) }
  }

  /** Export the unified tree plus one day plan as a stable markdown context document.
   * @param {ContextOptions} [input]
   * @returns {{ ok: boolean, date: string, markdown: string, chars: number, truncated: boolean,
   * counts: { tracks: number, nodes: number, tasks: number, blocks: number } }} */
  contextDocument(input = {}) {
    const date = input.date === undefined || input.date === null || input.date === '' ? todayIso() : assertDate(input.date, 'date')
    const limit = input.limit === undefined ? CONTEXT_DEFAULT_LIMIT : input.limit
    if (!Number.isInteger(limit) || limit < CONTEXT_MIN_LIMIT || limit > CONTEXT_MAX_LIMIT) {
      throw new GanttError(`limit must be an integer from ${CONTEXT_MIN_LIMIT} to ${CONTEXT_MAX_LIMIT}`)
    }
    let trees = this.tree()
    if (input.root !== undefined && input.root !== null && input.root !== '') {
      this.requireRow(input.root)
      trees = [/** @type {TaskNode} */ (this.getNode(input.root))]
    }
    const bundle = this.dayPlan(date)
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
    return { ok: true, date, ...document, counts }
  }
}

export { addDays, buildTree, dayToIso, deriveSummaryStatus, isoToDay, summarize, todayIso }
