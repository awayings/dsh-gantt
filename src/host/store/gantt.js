// The SQLite-backed task store. The class is the single seam over the store's
// per-concern modules: the routes and the tests only ever talk to these methods.

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { GanttError } from '../errors.js'
import { DECOMPOSE_MAX_DEPTH, LINK_TYPES, TASK_KINDS, addDays, buildTree, computeBrief, deriveSummaryStatus, flattenTree, materializeTracker, matchesTagFilter, normalizeTagMode, parseLinks, parseLinksJson, slotForStart, summarize, todayIso } from '../tree.js'
import { collectReadyTasks } from '../tree/ready.js'
import { renderTaskContext } from '../tree/task-context.js'
import { AGENT_SELECT, INSERT_AGENT, UPDATE_AGENT, agentNameMap, mergeAgentFields, normalizeAgentFields, normalizeAgentFilter, normalizeAgentName } from './agents.js'
import { buildDailyReport, computeDailyBrief, dailyBrief, persistDailyBrief, previousDailyBriefs, readDailyBrief } from './brief.js'
import { contextDocument } from './context.js'
import { SCHEMA_VERSION, migrateDatabase, openDatabase, resolveDatabasePath } from './db.js'
import { PLAN_SLOTS, clockValue, getPlanBlock, normalizePlanDraft, readDayPlan, replacePlan, setBlockStatus, upsertPlanBlocks, writeTaskBlock } from './plan.js'
import { startScheduler } from './scheduler.js'
import { searchTasks } from './search.js'
import { INSERT_TASK, SEED_TASKS, STATUSES, TASK_SELECT, TEXT_FIELDS, UPDATE_MATERIALIZED, UPDATE_TASK, EVENT_ACTIONS, EVENT_SELECT, INSERT_EVENT, assertDate, assertRange, defaultProgress, normalizeAgentRef, normalizeDescription, normalizeExtras, normalizeKind, normalizeLimit, normalizeParent, normalizeProgress, normalizeRef, normalizeReport, normalizeStatus, normalizeTags, normalizeTitle, oneOf, parseTagsJson, statusFromProgress, textField, textValue } from './tasks.js'

/** @typedef {import('./agents.js').AgentFilter} AgentFilter */
/** @typedef {import('./agents.js').AgentInput} AgentInput */
/** @typedef {import('./agents.js').AgentRow} AgentRow */
/** @typedef {import('../tree/ready.js').ReadyTag} ReadyTag */

/** @typedef {import('../daily.js').DailyReport} DailyReport */
/** @typedef {import('../tree.js').Brief} Brief */
/** @typedef {import('../tree.js').LinkType} LinkType */
/** @typedef {import('../tree.js').SnapshotNode} SnapshotNode */
/** @typedef {import('../tree.js').SnapshotTrack} SnapshotTrack */
/** @typedef {import('../tree.js').TaskKind} TaskKind */
/** @typedef {import('../tree.js').TaskLink} TaskLink */
/** @typedef {import('../tree.js').TaskNode} TaskNode */
/** @typedef {import('../tree.js').TaskStatus} TaskStatus */
/** @typedef {import('../tree.js').TreeTask} TaskRow */
/** @typedef {import('./context.js').ContextOptions} ContextOptions */
/** @typedef {import('./plan.js').BlockDraft} BlockDraft */
/** @typedef {import('./plan.js').BlockUpsertCounts} BlockUpsertCounts */
/** @typedef {import('./plan.js').DayPlanBundle} DayPlanBundle */
/** @typedef {import('./plan.js').PlanBlock} PlanBlock */
/** @typedef {import('./plan.js').PlanSlot} PlanSlot */
/** @typedef {import('./plan.js').PlanStatus} PlanStatus */
/** @typedef {import('./plan.js').ReplacePlanCounts} ReplacePlanCounts */
/** @typedef {import('./plan.js').ReplacePlanInput} ReplacePlanInput */
/** @typedef {import('./plan.js').ScheduleInput} ScheduleInput */
/** @typedef {import('./plan.js').TaskBlockPlan} TaskBlockPlan */
/** @typedef {import('./tasks.js').DecomposeChildInput} DecomposeChildInput */
/** @typedef {import('./tasks.js').SplitChild} SplitChild */
/** @typedef {import('./tasks.js').TaskInput} TaskInput */
/** @typedef {import('./tasks.js').TaskInsert} TaskInsert */
/** @typedef {import('./tasks.js').TaskPatch} TaskPatch */
/** @typedef {{ status: TaskStatus, progress: number, start_date: string, end_date: string }} ChildSummaryRow */
/** @typedef {{ total: number, done: number, inProgress: number, blocked: number, overdue: number, progress: number }} TaskStats */
/** @typedef {{ today: string, statuses: TaskStatus[], tasks: TaskNode[], stats: TaskStats,
 * brief: Brief, dailyBrief: DailyReport }} GanttSnapshot */
/** @typedef {{ dbPath: string, statuses: TaskStatus[], schemaVersion: number, taskCount: number,
 * engine: string, kinds: TaskKind[], linkTypes: LinkType[] }} GanttMeta */
/** One recorded trajectory event linking a task to the conversation that wrote it.
 * @typedef {{ id: string, taskId: string, sessionId: string, turn: number | null,
 * action: string, detail: string, at: string }} TaskEvent */
/** Where one write came from: the DSH conversation, its turn, and an optional summary.
 * @typedef {{ sessionId?: string, turn?: number | null, summary?: string }} TaskOrigin */
/** Filters accepted by {@link GanttStore.trajectory}.
 * @typedef {{ taskId?: unknown, sessionId?: unknown, limit?: unknown }} TrajectoryQuery */
/** One external completion report: the task, the reporting agent, and the write-back.
 * `session` is the worker's own context key, recorded on the complete event.
 * @typedef {{ taskId?: unknown, agentId?: unknown, session?: unknown, status?: unknown,
 * progress?: unknown, report?: unknown }} ReportCompletionInput */
/** The ready-list query: which vocabulary, which manual-tag filter, and how many rows.
 * @typedef {{ tag?: unknown, limit?: unknown, tags?: unknown, mode?: unknown }} ReadyTasksInput */
/** A compact task row returned by the ready list. @typedef {{ id: string, number: string,
 * ref: string, title: string, status: TaskStatus, description: string, doneWhen: string,
 * tags: string[], trackId: string, trackName: string }} ReadyTask */
/** The whole-tree keyword search query. @typedef {import('./search.js').SearchTasksInput} SearchTasksInput */
/** One keyword-search result row. @typedef {import('./search.js').SearchTask} SearchTask */
/** A compact task row returned beside the task-context markdown. @typedef {{ id: string,
 * number: string, ref: string, title: string, status: TaskStatus, progress: number,
 * doneWhen: string }} ContextTask */

/** Longest completion report kept in the `complete` event detail; the full
 * report stays in `tasks.report`. */
const MAX_EVENT_REPORT = 200

/**
 * SQLite-backed task store. Hierarchical numbers and rollups are derived at
 * read time, so writes never maintain them.
 */
export class GanttStore {
  /** @param {string} [file] */
  constructor(file = resolveDatabasePath()) {
    this.file = file
    this.db = openDatabase(file)
    this.migrate()
  }
  /** Upgrade an older database in one transaction: add columns, index, version, backfill. */
  migrate() {
    migrateDatabase(this.db, fn => this.transaction(fn), (tracks, nodes) => this.syncTrackerTree(tracks, nodes))
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
    const bindings = /** @type {any[]} */ (this.db.prepare('SELECT task_id AS taskId, session_id AS sessionId FROM work_sessions').all())
    const workSessions = new Map(bindings.map(row => [row.taskId, row.sessionId]))
    return rows.map(row => ({
      ...row,
      links: parseLinksJson(row.links),
      tags: parseTagsJson(row.tags),
      workSessionId: workSessions.get(row.id) ?? null,
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
    const brief = computeBrief(tasks)
    return { today: todayIso(), statuses: [...STATUSES], tasks, stats: summarize(tasks), brief, dailyBrief: this.dailyBrief().report }
  }

  /** @returns {GanttMeta} */
  meta() {
    return { dbPath: this.file === ':memory:' ? ':memory:' : path.resolve(this.file), statuses: [...STATUSES], schemaVersion: SCHEMA_VERSION, taskCount: this.count(), engine: 'node:sqlite', kinds: [...TASK_KINDS], linkTypes: [...LINK_TYPES] }
  }

  /** @param {string} planDate @returns {DailyReport | null} */
  readDailyBrief(planDate) {
    return readDailyBrief(this, planDate)
  }

  /** @param {string} planDate @returns {DailyReport[]} */
  previousDailyBriefs(planDate) {
    return previousDailyBriefs(this, planDate)
  }

  /** @param {string} planDate @param {'auto' | 'manual'} source @returns {DailyReport} */
  buildDailyReport(planDate, source) {
    return buildDailyReport(this, planDate, source)
  }

  /** @param {DailyReport} report */
  persistDailyBrief(report) {
    persistDailyBrief(this, report)
  }

  /** Read today's brief from the cache, computing and persisting it when missing.
   * @param {string} [date] @returns {{ report: DailyReport, cached: boolean }} */
  dailyBrief(date = todayIso()) {
    return dailyBrief(this, date)
  }
  /** Force a fresh report and persist it (the manual UI recompute).
   * @param {string} [date] @param {{ source?: 'auto' | 'manual' }} [options] @returns {DailyReport} */
  computeDailyBrief(date = todayIso(), options = {}) {
    return computeDailyBrief(this, date, options)
  }
  /** Recompute today's report every local 08:00; returns an idempotent disposer.
   * @returns {() => void} */
  startScheduler() {
    return startScheduler(this)
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
        // Cancelled children are dropped from the rollup: they neither stretch
        // the parent's dates nor count towards its progress.
        const active = children.filter(child => child.status !== 'cancelled')
        const rollup = active.length > 0 ? active : children
        const startDate = rollup.reduce((min, child) => (child.start_date < min ? child.start_date : min), rollup[0].start_date)
        const endDate = rollup.reduce((max, child) => (child.end_date > max ? child.end_date : max), rollup[0].end_date)
        const progress = active.length === 0 ? 0 : Math.round(active.reduce((sum, child) => sum + child.progress, 0) / active.length)
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
      fields.inspiration, JSON.stringify(fields.links), JSON.stringify(fields.tags), fields.source,
      fields.operatorId, fields.completedById, fields.report, now, now,
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
    const parent = parentId === null ? null : this.requireRow(parentId)
    const kind = normalizeKind(input.kind)
    const ref = normalizeRef(input.ref)
    if (ref !== '') this.assertRefFree(kind, ref)
    const fields = this.normalizeCreateFields(input, parent === null ? null : parent.startDate)
    const id = this.transaction(() => {
      const created = this.insertTask({ parentId, ...fields, sortOrder: this.nextSortOrder(parentId), kind, ref, state: '', source: 'manual' })
      this.recomputeAncestors(parentId)
      return created
    })
    return this.getNode(id)
  }

  /** Validate the task fields shared by {@link create} and {@link createSibling}.
   * @param {TaskInput} input
   * @param {string | null} [parentStartDate] The chosen parent's own start date;
   * an omitted startDate defaults to the later of today and it.
   * @returns {{ title: string, description: string, status: TaskStatus,
   * progress: number, startDate: string, endDate: string, lane: string, dep: string, doneWhen: string,
   * landing: string, estimate: string, category: string, inspiration: string, links: TaskLink[],
   * tags: string[], operatorId: string, completedById: string, report: string }} */
  normalizeCreateFields(input, parentStartDate = null) {
    const title = normalizeTitle(input.title)
    const description = normalizeDescription(input.description)
    const status = normalizeStatus(input.status ?? 'todo')
    const progress = input.progress === undefined ? defaultProgress(status) : normalizeProgress(input.progress)
    const today = todayIso()
    const startDate = assertDate(input.startDate ?? (parentStartDate !== null && parentStartDate > today ? parentStartDate : today), 'startDate')
    const endDate = assertDate(input.endDate ?? addDays(startDate, 3), 'endDate')
    assertRange(startDate, endDate)
    return {
      title,
      description,
      status,
      progress,
      startDate,
      endDate,
      ...normalizeExtras(input),
      links: this.normalizeLinks(input.links),
      tags: normalizeTags(input.tags),
      operatorId: normalizeAgentRef(input.operatorId, 'operatorId'),
      completedById: normalizeAgentRef(input.completedById, 'completedById'),
      report: normalizeReport(input.report),
    }
  }

  /** Create a task as the immediate next sibling of `referenceId`: same parent,
   * inserted right after the reference, with later siblings shifted down. The
   * reference task records a `track` event when the origin carries a session.
   * @param {string} referenceId @param {TaskInput} [input] @param {TaskOrigin} [origin]
   * @returns {TaskNode} */
  createSibling(referenceId, input = {}, origin) {
    const reference = this.requireRow(referenceId)
    const parentId = reference.parentId
    const fields = this.normalizeCreateFields(input, parentId === null ? null : this.requireRow(parentId).startDate)
    const referenceLabel = taskLabel(/** @type {TaskNode} */ (this.getNode(reference.id)))
    const id = this.transaction(() => {
      const sortOrder = reference.sortOrder + 1
      this.db.prepare('UPDATE tasks SET sort_order = sort_order + 1 WHERE parent_id IS ? AND sort_order >= ?').run(parentId, sortOrder)
      const created = this.insertTask({ parentId, ...fields, sortOrder, kind: 'task', ref: '', state: '', source: 'manual' })
      this.recomputeAncestors(parentId)
      this.recordOrigin(created, 'create', origin, `在 ${referenceLabel} 后创建`)
      const sessionId = origin === undefined ? '' : textValue(origin.sessionId)
      if (origin !== undefined && sessionId !== '') {
        this.recordTrack({
          taskId: reference.id,
          sessionId,
          turn: origin.turn,
          detail: `sibling task ${referenceLabel} ${fields.title}`,
        })
      }
      return created
    })
    return /** @type {TaskNode} */ (this.getNode(id))
  }

  /** @param {string} id @param {TaskPatch} [patch] @param {TaskOrigin} [origin] @returns {TaskNode | null} */
  update(id, patch = {}, origin) {
    const row = this.requireRow(id)
    const next = { ...row }
    if (patch.title !== undefined) next.title = normalizeTitle(patch.title)
    if (patch.description !== undefined) next.description = normalizeDescription(patch.description)
    if (patch.startDate !== undefined) next.startDate = assertDate(patch.startDate, 'startDate')
    if (patch.endDate !== undefined) next.endDate = assertDate(patch.endDate, 'endDate')
    assertRange(next.startDate, next.endDate)
    for (const field of TEXT_FIELDS) if (patch[field] !== undefined) next[field] = textField(patch[field], field)
    if (patch.links !== undefined) next.links = this.normalizeLinks(patch.links)
    if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags)
    if (patch.operatorId !== undefined) next.operatorId = normalizeAgentRef(patch.operatorId, 'operatorId')
    if (patch.completedById !== undefined) next.completedById = normalizeAgentRef(patch.completedById, 'completedById')
    if (patch.report !== undefined) next.report = normalizeReport(patch.report)
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
        next.estimate, next.category, next.inspiration, JSON.stringify(next.links), JSON.stringify(next.tags),
        next.source, next.operatorId, next.completedById, next.report, now, id,
      )
      this.recomputeAncestors(row.parentId)
      if (next.parentId !== row.parentId) this.recomputeAncestors(next.parentId)
      this.recordOrigin(id, status === 'done' ? 'complete' : 'update', origin, `状态 ${status}，进度 ${progress}%`)
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
      return { title: normalizeTitle(child.title), description: normalizeDescription(child.description), status, progress: child.progress === undefined ? defaultProgress(status) : normalizeProgress(child.progress), startDate, endDate, ref: '', ...normalizeExtras(child), links: this.normalizeLinks(child.links), tags: normalizeTags(child.tags) }
    })
    /** @type {string[]} */
    const created = []
    this.transaction(() => {
      const base = this.nextSortOrder(id)
      normalized.forEach((child, index) => created.push(this.insertTask({
        parentId: id,
        ...child,
        sortOrder: base + index,
        kind: 'task',
        ref: '',
        state: '',
        source: 'manual',
        operatorId: '',
        completedById: '',
        report: '',
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
        ids.push(this.insertTask({ parentId: parent === null ? null : ids[parent], title, description, status, progress, startDate: addDays(today, startOffset), endDate: addDays(today, endOffset), sortOrder, kind: 'task', ref: '', state: '', lane: '', dep: '', doneWhen: '', landing: '', estimate: '', category: '', inspiration: '', links: [], tags: [], source: 'manual', operatorId: '', completedById: '', report: '' }))
      }
    })
    return { seeded: true, taskCount: ids.length }
  }

  /** Replace the imported tracker tree and day metadata in one transaction.
   * @param {ReplacePlanInput} [input] @returns {ReplacePlanCounts} */
  replacePlan(input = {}) {
    return replacePlan(this, input)
  }
  /** Materialise the tracker snapshot into the unified task tree, in the caller's transaction.
   * @param {SnapshotTrack[]} tracks @param {SnapshotNode[]} nodes @returns {BlockUpsertCounts} */
  syncTrackerTree(tracks, nodes) {
    const now = new Date().toISOString()
    const existing = this.listRows()
    const { inserts, updates, deletes } = materializeTracker({ tracks, nodes, existing, today: todayIso() })
    const rowById = new Map(existing.map(row => [row.id, row]))
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
        draft.estimate, draft.category, draft.inspiration, JSON.stringify(draft.links), '[]', draft.source,
        '', '', '', now, now)
      idByRef.set(draft.ref, id)
    }
    for (const draft of updates) {
      const previous = /** @type {TaskRow} */ (rowById.get(draft.id))
      update.run(draft.parentRef === null ? null : /** @type {string} */ (idByRef.get(draft.parentRef)), draft.title,
        draft.description, draft.status, draft.progress, draft.startDate, draft.endDate, draft.sortOrder,
        draft.state, draft.lane, draft.dep, draft.doneWhen, draft.landing, draft.estimate, draft.category,
        draft.inspiration, JSON.stringify(draft.links), JSON.stringify(previous.tags),
        previous.operatorId, previous.completedById, previous.report, now, draft.id)
    }
    for (const id of deletes) remove.run(id)
    return { inserted: inserts.length, updated: updates.length, removed: deletes.length }
  }

  /** Upsert one day's imported blocks; content is rewritten, status/notes survive.
   * @param {string} planDate @param {BlockDraft[]} drafts @returns {BlockUpsertCounts} */
  upsertPlanBlocks(planDate, drafts) {
    return upsertPlanBlocks(this, planDate, drafts)
  }

  /** Read one day's bundle, including the unified tree's tracks and nodes.
   * @param {string} date @returns {DayPlanBundle} */
  dayPlan(date) {
    const planDate = assertDate(date, 'date')
    return readDayPlan(this, planDate, dailyBrief(this, planDate).report)
  }

  /** Set a block's user status and optional notes (notes capped at 500 characters).
   * @param {string} id @param {PlanStatus} status @param {string | null} [notes] @returns {PlanBlock} */
  setBlockStatus(id, status, notes) {
    return setBlockStatus(this, id, status, notes)
  }

  /** @param {string} id @returns {PlanBlock} */
  getPlanBlock(id) {
    return getPlanBlock(this, id)
  }

  /** Upsert the plan cell of one task on one date; user status and notes survive.
   * @param {string} taskId @param {TaskBlockPlan} plan @returns {string} */
  writeTaskBlock(taskId, plan) {
    return writeTaskBlock(this, taskId, plan)
  }
  /** Decompose one task into child subtasks, optionally scheduling each into a plan cell.
   * `planDate` only sets the default child start/end dates; it never creates a plan
   * cell. A scheduled cell needs an explicit `plan` object on that child.
   * @param {string} id
   * @param {DecomposeChildInput[]} children
   * @param {unknown} [planDate]
   * @param {TaskOrigin} [origin]
   * @returns {{ parent: TaskNode | null, children: TaskNode[], blocks: PlanBlock[] }} */
  decompose(id, children, planDate, origin) {
    const parent = this.requireRow(id)
    const parentNode = /** @type {TaskNode} */ (this.getNode(id))
    const parentRef = parentNode.ref === '' ? parentNode.number : parentNode.ref
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
      return { title: normalizeTitle(child.title), description: normalizeDescription(child.description), status, progress: child.progress === undefined ? defaultProgress(status) : normalizeProgress(child.progress), startDate, endDate, ...normalizeExtras(child, `children[${index}].`), links: this.normalizeLinks(child.links), tags: normalizeTags(child.tags), plan: child.plan === undefined ? null : normalizePlanDraft(child.plan, index) }
    })
    const result = this.transaction(() => {
      const base = this.nextSortOrder(id)
      /** @type {string[]} */
      const blockIds = []
      const childIds = normalized.map((child, index) => {
        const childId = this.insertTask({ parentId: id, title: child.title, description: child.description, status: child.status, progress: child.progress, startDate: child.startDate, endDate: child.endDate, sortOrder: base + index, kind: 'task', ref: '', state: '', lane: child.lane, dep: child.dep, doneWhen: child.doneWhen, landing: child.landing, estimate: child.estimate, category: child.category, inspiration: child.inspiration, links: child.links, tags: child.tags, source: 'manual', operatorId: '', completedById: '', report: '' })
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
      this.recordOrigin(id, 'decompose', origin, `拆解为 ${normalized.length} 个子任务`)
      const childOrigin = origin === undefined ? undefined : { ...origin, summary: '' }
      for (const childId of childIds) this.recordOrigin(childId, 'create', childOrigin, `在 ${parentRef} 下创建`)
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

  /** Persist which task one conversation is focused on (null clears the focus).
   * Focus is per conversation, so the host-side assistant tools can read the
   * chain the user is looking at without asking.
   * @param {string} sessionId @param {string | null} taskId @returns {string | null} */
  setFocus(sessionId, taskId) {
    const session = normalizeSessionId(sessionId)
    if (taskId === null || taskId === '') {
      this.db.prepare('DELETE FROM focus WHERE session_id = ?').run(session)
      return null
    }
    const row = this.requireRow(taskId)
    this.db.prepare(
      `INSERT INTO focus (session_id, task_id, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET task_id = excluded.task_id, updated_at = excluded.updated_at`,
    ).run(session, row.id, new Date().toISOString())
    return row.id
  }

  /** The task one conversation is focused on, or null when it has none.
   * @param {string} sessionId @returns {string | null} */
  focusOf(sessionId) {
    const session = normalizeSessionId(sessionId)
    const row = /** @type {{ taskId?: string } | undefined} */ (
      this.db.prepare('SELECT task_id AS taskId FROM focus WHERE session_id = ?').get(session)
    )
    return row?.taskId ?? null
  }

  /** Bind one task to its content-dedicated main conversation. Rebinding a task
   * replaces its session; binding a session that already belongs to another task
   * moves it. Both happen in one transaction.
   * @param {unknown} taskId @param {unknown} sessionId @returns {{ taskId: string, sessionId: string }} */
  bindWorkSession(taskId, sessionId) {
    return this.transaction(() => this.upsertWorkSession(taskId, sessionId))
  }

  /** Write the task ⇄ conversation mapping inside the caller's transaction.
   * The bind route uses it to set the focus atomically with the mapping.
   * @param {unknown} taskId @param {unknown} sessionId @returns {{ taskId: string, sessionId: string }} */
  upsertWorkSession(taskId, sessionId) {
    const row = this.requireRow(/** @type {string} */ (taskId))
    const session = normalizeSessionId(sessionId)
    const now = new Date().toISOString()
    this.db.prepare('DELETE FROM work_sessions WHERE session_id = ? OR task_id = ?').run(session, row.id)
    this.db.prepare('INSERT INTO work_sessions (task_id, session_id, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(row.id, session, now, now)
    return { taskId: row.id, sessionId: session }
  }

  /** The content-dedicated conversation bound to one task, or null.
   * @param {unknown} taskId @returns {string | null} */
  workSessionOf(taskId) {
    const row = /** @type {{ sessionId?: string } | undefined} */ (
      this.db.prepare('SELECT session_id AS sessionId FROM work_sessions WHERE task_id = ?').get(/** @type {string} */ (taskId))
    )
    return row?.sessionId ?? null
  }

  /** The task one conversation is the content-dedicated conversation for, or null.
   * @param {string} sessionId @returns {string | null} */
  workTaskOf(sessionId) {
    const session = normalizeSessionId(sessionId)
    const row = /** @type {{ taskId?: string } | undefined} */ (
      this.db.prepare('SELECT task_id AS taskId FROM work_sessions WHERE session_id = ?').get(session)
    )
    return row?.taskId ?? null
  }

  /** Record one trajectory event that links a task to a conversation turn.
   * Callers that write the task in the same atomic unit pass their transaction
   * through this method; the event then commits or rolls back with the write.
   * @param {{ taskId: unknown, action: unknown, sessionId?: unknown, turn?: unknown, detail?: unknown }} entry
   * @returns {TaskEvent} */
  recordEvent(entry) {
    const taskId = this.requireRow(/** @type {string} */ (entry.taskId)).id
    const action = oneOf(entry.action, 'action', EVENT_ACTIONS)
    const sessionId = entry.sessionId === undefined || entry.sessionId === null ? '' : textValue(entry.sessionId)
    const detail = entry.detail === undefined || entry.detail === null ? '' : textValue(entry.detail)
    const turn = normalizeTurn(entry.turn)
    const at = new Date().toISOString()
    const id = randomUUID()
    this.db.prepare(INSERT_EVENT).run(id, taskId, sessionId, turn, action, detail, at)
    return { id, taskId, sessionId, turn, action, detail, at }
  }

  /** Record one round-association `track` event (no task write happened this
   * round). A blank session is allowed for manual callers; assistant callers
   * pass the calling conversation.
   * @param {{ taskId: unknown, sessionId?: unknown, turn?: unknown, detail?: unknown }} entry
   * @returns {TaskEvent} */
  recordTrack(entry) {
    return this.recordEvent({ ...entry, action: 'track' })
  }

  /** Record an assistant write; a write without a conversation id is skipped so
   * manual routes never fabricate a session. The summary, when given, replaces
   * the mechanical fallback detail.
   * @param {string} taskId @param {string} action @param {TaskOrigin | undefined} origin
   * @param {string} fallbackDetail @returns {void} */
  recordOrigin(taskId, action, origin, fallbackDetail) {
    if (origin === undefined) return
    const sessionId = origin.sessionId === undefined ? '' : textValue(origin.sessionId)
    if (sessionId === '') return
    const summary = origin.summary === undefined ? '' : textValue(origin.summary)
    this.recordEvent({ taskId, action, sessionId, turn: origin.turn, detail: summary === '' ? fallbackDetail : summary })
  }

  /** Recent trajectory events, newest first, filtered by task and/or conversation.
   * An unknown task id is a 404; an unknown conversation is an empty list.
   * @param {TrajectoryQuery} [query] @returns {TaskEvent[]} */
  trajectory(query = {}) {
    const taskId = typeof query.taskId === 'string' && query.taskId.trim() !== '' ? this.requireRow(query.taskId.trim()).id : null
    const blankSession = query.sessionId === undefined || query.sessionId === null
      || (typeof query.sessionId === 'string' && query.sessionId.trim() === '')
    const sessionId = blankSession ? '' : normalizeSessionId(query.sessionId)
    const limit = normalizeLimit(query.limit)
    /** @type {string[]} */
    const clauses = []
    /** @type {string[]} */
    const params = []
    if (taskId !== null) {
      clauses.push('task_id = ?')
      params.push(taskId)
    }
    if (sessionId !== '') {
      clauses.push('session_id = ?')
      params.push(sessionId)
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    return /** @type {TaskEvent[]} */ (this.db.prepare(`${EVENT_SELECT}${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(...params, limit))
  }

  /** Register or update an external operator. An existing id updates that row;
   * otherwise the name is the upsert key, so re-registering the same tool is
   * idempotent. Fields the call omits keep their stored values, so a minimal
   * identity re-register never wipes the dispatch contract; providing a field,
   * empty string included, overwrites it.
   * @param {AgentInput} [input]
   * @returns {AgentRow} */
  registerAgent(input = {}) {
    const id = typeof input.id === 'string' ? input.id.trim() : ''
    const name = normalizeAgentName(input)
    const now = new Date().toISOString()
    const existing = id === '' ? null : this.getAgent(id)
    if (existing !== null) {
      const fields = mergeAgentFields(existing, input)
      const owner = /** @type {AgentRow | null} */ (this.db.prepare(`${AGENT_SELECT} WHERE name = ?`).get(fields.name) ?? null)
      if (owner !== null && owner.id !== existing.id) throw new GanttError(`agent name ${fields.name} already exists`, 409)
      this.db.prepare(UPDATE_AGENT).run(
        fields.name, fields.type, fields.role, fields.description, fields.details,
        fields.endpoint, now, existing.id,
      )
      return /** @type {AgentRow} */ (this.getAgent(existing.id))
    }
    const byName = /** @type {AgentRow | null} */ (this.db.prepare(`${AGENT_SELECT} WHERE name = ?`).get(name) ?? null)
    if (byName !== null) {
      const fields = mergeAgentFields(byName, input)
      this.db.prepare(UPDATE_AGENT).run(
        fields.name, fields.type, fields.role, fields.description, fields.details,
        fields.endpoint, now, byName.id,
      )
      return /** @type {AgentRow} */ (this.getAgent(byName.id))
    }
    const fields = normalizeAgentFields(input)
    const created = randomUUID()
    this.db.prepare(INSERT_AGENT).run(
      created, fields.name, fields.type, fields.role, fields.description, fields.details,
      fields.endpoint, now, now,
    )
    return /** @type {AgentRow} */ (this.getAgent(created))
  }

  /** @param {AgentFilter} [filter] @returns {AgentRow[]} */
  listAgents(filter = {}) {
    const query = normalizeAgentFilter(filter)
    /** @type {string[]} */
    const clauses = []
    /** @type {import('node:sqlite').SQLInputValue[]} */
    const params = []
    if (query.type !== '') {
      clauses.push('type = ?')
      params.push(query.type)
    }
    if (query.role !== '') {
      clauses.push('role = ?')
      params.push(query.role)
    }
    if (query.q !== '') {
      clauses.push('(name LIKE ? OR role LIKE ? OR description LIKE ? OR details LIKE ?)')
      const pattern = `%${query.q}%`
      params.push(pattern, pattern, pattern, pattern)
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    return /** @type {AgentRow[]} */ (this.db.prepare(`${AGENT_SELECT}${where} ORDER BY name, id LIMIT ?`).all(...params, query.limit))
  }

  /** @param {unknown} id @returns {AgentRow | null} */
  getAgent(id) {
    if (typeof id !== 'string' || id.trim() === '') return null
    return /** @type {AgentRow | null} */ (this.db.prepare(`${AGENT_SELECT} WHERE id = ?`).get(id.trim()) ?? null)
  }

  /** @param {unknown} id @returns {AgentRow} */
  requireAgent(id) {
    const agent = this.getAgent(id)
    if (agent === null) throw new GanttError(`agent ${typeof id === 'string' ? id : String(id)} was not found`, 404)
    return agent
  }

  /** Write back one agent's completion report. The operator is recorded only
   * the first time; the completer and the report always overwrite. Ancestor
   * rollups are refreshed, and one `complete` event captures the report.
   * @param {ReportCompletionInput} input
   * @returns {{ task: TaskNode | null, event: TaskEvent }} */
  reportCompletion(input) {
    if (typeof input.taskId !== 'string' || input.taskId.trim() === '') throw new GanttError('taskId is required')
    const task = this.requireRow(input.taskId.trim())
    if (typeof input.agentId !== 'string' || input.agentId.trim() === '') throw new GanttError('agentId is required')
    const agent = this.requireAgent(input.agentId.trim())
    const report = normalizeReport(input.report)
    if (report === '') throw new GanttError('report is required')
    const status = input.status === undefined ? 'done' : normalizeStatus(input.status)
    const progress = input.progress === undefined ? defaultProgress(status, task.progress) : normalizeProgress(input.progress)
    const sessionId = input.session === undefined || input.session === null ? '' : textValue(input.session)
    const now = new Date().toISOString()
    const event = this.transaction(() => {
      this.db.prepare(
        `UPDATE tasks SET operator_id = CASE WHEN operator_id = '' THEN ? ELSE operator_id END,
         completed_by_id = ?, report = ?, status = ?, progress = ?, updated_at = ? WHERE id = ?`,
      ).run(agent.id, agent.id, report, status, progress, now, task.id)
      this.recomputeAncestors(task.parentId)
      const chars = [...report]
      const summary = chars.length > MAX_EVENT_REPORT ? `${chars.slice(0, MAX_EVENT_REPORT).join('')}…` : report
      return this.recordEvent({ taskId: task.id, sessionId, action: 'complete', detail: summary })
    })
    return { task: this.getNode(task.id), event }
  }

  /** Stable markdown context for one task: fields, ancestor chain, detail,
   * completion report, and recent trajectory. Operator and completer render
   * as registered agent names, falling back to the raw id.
   * @param {unknown} taskId
   * @returns {{ taskId: string, markdown: string, chars: number }} */
  taskContext(taskId) {
    const row = this.requireRow(/** @type {string} */ (taskId))
    const tasks = this.tree()
    const task = /** @type {TaskNode} */ (flattenTree(tasks).find(node => node.id === row.id))
    const events = this.trajectory({ taskId: row.id, limit: 8 })
    const agentNames = agentNameMap(this.listAgents({ limit: 100 }))
    const markdown = renderTaskContext(tasks, task, events, agentNames)
    return { taskId: row.id, markdown, chars: markdown.length }
  }

  /** The ready/next/todo leaves matching an optional manual-tag filter, grouped
   * by track and capped by `limit`. An empty tag list keeps every row; `mode`
   * decides whether one tag (any) or every tag (and) must be present.
   * @param {ReadyTasksInput} [input]
   * @returns {{ tag: ReadyTag, tasks: ReadyTask[] }} */
  readyTasks(input = {}) {
    const tag = input.tag === undefined || input.tag === null || input.tag === '' ? 'ready' : input.tag
    const limit = normalizeLimit(input.limit)
    const tags = normalizeTags(input.tags)
    const mode = normalizeTagMode(input.mode)
    const entries = collectReadyTasks(this.tree(), /** @type {ReadyTag} */ (tag))
      .filter(entry => matchesTagFilter(entry.task.tags, tags, mode))
      .slice(0, limit)
    return {
      tag: /** @type {ReadyTag} */ (tag),
      tasks: entries.map(entry => ({
        id: entry.task.id,
        number: entry.task.number,
        ref: entry.task.ref,
        title: entry.task.title,
        status: entry.task.status,
        description: entry.task.description,
        doneWhen: entry.task.doneWhen,
        tags: entry.task.tags,
        trackId: entry.trackId,
        trackName: entry.trackName,
      })),
    }
  }

  /** The whole-tree keyword search: every task whose title, description, or
   * doneWhen contains the keyword — case-insensitive substring — across every
   * track and depth, completed work included. Rows are grouped by track in
   * rendered order; `total` counts every match while `tasks` honors `limit`.
   * @param {SearchTasksInput} [input]
   * @returns {{ q: string, total: number, tasks: SearchTask[] }} */
  searchTasks(input = {}) {
    return searchTasks(this, input)
  }

  /** Export the unified tree plus one day plan as a stable markdown context document.
   * @param {ContextOptions} [input]
   * @returns {{ ok: boolean, date: string, markdown: string, chars: number, truncated: boolean,
   * counts: { tracks: number, nodes: number, tasks: number, blocks: number } }} */
  contextDocument(input = {}) {
    return contextDocument(this, input)
  }
}

/** Validate a conversation id arriving from the client or a tool call.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeSessionId(value) {
  if (typeof value !== 'string') throw new GanttError('sessionId is required')
  const session = value.trim()
  if (session === '') throw new GanttError('sessionId is required')
  if (session.length > 200) throw new GanttError('sessionId must be at most 200 characters')
  return session
}

/** Validate the durable turn index of a conversation write.
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeTurn(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new GanttError('turn must be a non-negative integer')
  return value
}

/** Rendered label of one task: its external ref, else its point number.
 * @param {TaskNode} node
 * @returns {string}
 */
function taskLabel(node) {
  return node.ref === '' ? node.number : node.ref
}
