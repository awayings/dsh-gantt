/**
 * SQLite-backed task store for the Gantt plugin.
 *
 * The database is the single source of truth for the task tree. Hierarchical
 * numbers (1, 1.1, 1.1.1, ...) are derived from sibling order at read time, so
 * inserting, moving, or deleting a branch renumbers the tree without any extra
 * bookkeeping.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const STATUSES = ['todo', 'in_progress', 'blocked', 'done']
export const SCHEMA_VERSION = 1

const DAY_MS = 86_400_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_TITLE = 200
const MAX_DESCRIPTION = 4000

/** A validation or lookup failure with an HTTP-friendly status. */
export class GanttError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'GanttError'
    this.status = status
  }
}

function pad(value) {
  return String(value).padStart(2, '0')
}

export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function isoToDay(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

export function dayToIso(day) {
  const date = new Date(day)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function addDays(iso, days) {
  return dayToIso(isoToDay(iso) + days * DAY_MS)
}

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

function assertRange(startDate, endDate) {
  if (startDate > endDate) throw new GanttError('endDate must not be before startDate')
}

function normalizeTitle(value) {
  if (typeof value !== 'string') throw new GanttError('title is required')
  const title = value.trim().replace(/\s+/g, ' ')
  if (title.length === 0) throw new GanttError('title must not be empty')
  if ([...title].length > MAX_TITLE) throw new GanttError(`title must be at most ${MAX_TITLE} characters`)
  return title
}

function normalizeDescription(value) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new GanttError('description must be a string')
  if ([...value].length > MAX_DESCRIPTION) throw new GanttError(`description must be at most ${MAX_DESCRIPTION} characters`)
  return value.trim()
}

function normalizeStatus(value) {
  if (!STATUSES.includes(value)) {
    throw new GanttError(`status must be one of ${STATUSES.join(', ')}`)
  }
  return value
}

function normalizeProgress(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GanttError('progress must be a number from 0 to 100')
  }
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeParent(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new GanttError('parentId must be a task id or null')
  return value
}

function defaultProgress(status, current = 0) {
  if (status === 'done') return 100
  if (status === 'todo') return 0
  if (status === 'blocked') return current
  return current > 0 && current < 100 ? current : 50
}

function statusFromProgress(progress, current) {
  if (progress >= 100) return 'done'
  if (progress <= 0) return 'todo'
  return current === 'blocked' ? 'blocked' : 'in_progress'
}

/** Derive the read-time status of a task that owns children. */
export function deriveSummaryStatus(children, progress) {
  if (children.length > 0 && children.every((child) => child.status === 'done')) return 'done'
  if (children.some((child) => child.status === 'blocked')) return 'blocked'
  if (children.some((child) => child.status === 'in_progress') || progress > 0) return 'in_progress'
  return 'todo'
}

/** Build the nested tree, assigning hierarchical numbers and rollup fields. */
export function buildTree(rows) {
  const ids = new Set(rows.map((row) => row.id))
  const byParent = new Map()
  for (const row of rows) {
    const parentId = row.parentId && ids.has(row.parentId) ? row.parentId : null
    if (!byParent.has(parentId)) byParent.set(parentId, [])
    byParent.get(parentId).push({ ...row, parentId })
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => (
      left.sortOrder - right.sortOrder
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
    ))
  }

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

function flatten(nodes, output = []) {
  for (const node of nodes) {
    output.push(node)
    flatten(node.children, output)
  }
  return output
}

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

/** Resolve the durable database location; override with DSH_GANTT_DB. */
export function resolveDatabasePath() {
  if (process.env.DSH_GANTT_DB) return process.env.DSH_GANTT_DB
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'gantt', 'tasks.db')
}

export class GanttStore {
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
      PRAGMA user_version = ${SCHEMA_VERSION};
    `)
  }

  close() {
    try {
      this.db.close()
    } catch {
      // already closed
    }
  }

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

  listRows() {
    return this.db.prepare(`
      SELECT id, parent_id, title, description, status, progress,
             start_date, end_date, sort_order, created_at, updated_at
      FROM tasks
    `).all().map((row) => ({
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

  count() {
    return this.db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count
  }

  tree() {
    return buildTree(this.listRows())
  }

  snapshot() {
    const tasks = this.tree()
    return {
      today: todayIso(),
      statuses: [...STATUSES],
      tasks,
      stats: summarize(tasks),
    }
  }

  meta() {
    return {
      dbPath: this.file === ':memory:' ? ':memory:' : path.resolve(this.file),
      statuses: [...STATUSES],
      schemaVersion: SCHEMA_VERSION,
      taskCount: this.count(),
      engine: 'node:sqlite',
    }
  }

  getRow(id) {
    return this.listRows().find((row) => row.id === id) ?? null
  }

  getNode(id) {
    return flatten(this.tree()).find((node) => node.id === id) ?? null
  }

  requireRow(id) {
    if (typeof id !== 'string' || id.length === 0) throw new GanttError('id is required')
    const row = this.getRow(id)
    if (row === null) throw new GanttError(`task ${id} was not found`, 404)
    return row
  }

  nextSortOrder(parentId) {
    const row = parentId === null
      ? this.db.prepare('SELECT MAX(sort_order) AS value FROM tasks WHERE parent_id IS NULL').get()
      : this.db.prepare('SELECT MAX(sort_order) AS value FROM tasks WHERE parent_id = ?').get(parentId)
    return (row?.value ?? -1) + 1
  }

  isDescendant(candidateId, ancestorId) {
    let current = candidateId
    const seen = new Set()
    while (current) {
      if (current === ancestorId) return true
      if (seen.has(current)) return true
      seen.add(current)
      const row = this.db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(current)
      current = row?.parent_id ?? null
    }
    return false
  }

  recomputeAncestors(parentId) {
    const now = new Date().toISOString()
    let current = parentId
    const seen = new Set()
    while (current) {
      if (seen.has(current)) break
      seen.add(current)
      const row = this.db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(current)
      if (!row) break
      const children = this.db.prepare(`
        SELECT status, progress, start_date, end_date
        FROM tasks WHERE parent_id = ?
      `).all(current)
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

  setStatus(id, status, progress) {
    const patch = { status }
    if (progress !== undefined) patch.progress = progress
    return this.update(id, patch)
  }

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
      children: created.map((childId) => this.getNode(childId)).filter(Boolean),
    }
  }

  delete(id) {
    const row = this.requireRow(id)
    this.transaction(() => {
      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
      this.recomputeAncestors(row.parentId)
    })
    return { id, parentId: row.parentId }
  }

  seed() {
    if (this.count() > 0) {
      return { seeded: false, taskCount: this.count() }
    }
    const today = todayIso()
    const now = new Date().toISOString()
    let created = 0

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
}
