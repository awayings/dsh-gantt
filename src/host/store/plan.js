// Day-plan blocks and the imported tracker snapshot: validation, upserts, the
// per-day read bundle, and the plan cell one task is scheduled into.

import { PLAN_STATUSES as PLAN_STATUS_WORDS } from '../../shared/vocabulary.js'
import { GanttError } from '../errors.js'
import { addDays, compareRefs, slotForStart } from '../tree.js'
import { assertDate, normalizeList, oneOf, requireText, textValue } from './tasks.js'

/** @typedef {import('../daily.js').DailyReport} DailyReport */
/** @typedef {import('../tree.js').TaskKind} TaskKind */
/** @typedef {import('../tree.js').TaskLink} TaskLink */
/** @typedef {import('../tree.js').TaskNode} TaskNode */
/** @typedef {import('../tree.js').TreeTask} TaskRow */
/** @typedef {import('./gantt.js').GanttStore} GanttStore */

export const PLAN_SLOTS = ['morning', 'daytime', 'evening', 'other']
const DAY_KINDS = ['workday', 'weekend', 'unknown']
export const BLOCK_COLUMNS = 'id, plan_date AS planDate, start_time AS startTime, end_time AS endTime, slot, category, title, detail, landing, estimate, inspiration, status, notes, sort_order AS sortOrder, source, source_ref AS sourceRef'
const MAX_NOTES = 500

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
 * integrity: { code: string, blockId?: string }[], brief: DailyReport,
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

/** All plan block statuses, shared with the browser half. @type {PlanStatus[]} */
export const PLAN_STATUSES = /** @type {PlanStatus[]} */ (PLAN_STATUS_WORDS)

/** @param {unknown} value @param {string} field @returns {string} */
export function clockValue(value, field) {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) throw new GanttError(`${field} must be an HH:MM time`)
  return value
}
/** @param {PlanDraftInput} plan @param {number} index @returns {PlanSlot} */
function planSlot(plan, index) {
  return plan.slot === undefined
    ? slotForStart(plan.startTime)
    : /** @type {PlanSlot} */ (oneOf(plan.slot, `children[${index}].plan.slot`, PLAN_SLOTS))
}
/** @param {unknown} plan @param {number} index @returns {PlanOverride} */
export function normalizePlanDraft(plan, index) {
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
 * Replace the imported tracker tree and day metadata in one transaction.
 * @param {GanttStore} store
 * @param {ReplacePlanInput} [input]
 * @returns {ReplacePlanCounts}
 */
export function replacePlan(store, input = {}) {
  const tracks = normalizeList(input.tracks, 'tracks', (track, index) => ({ ...track, id: requireText(track.id, `tracks[${index}].id`), name: requireText(track.name, `tracks[${index}].name`), sortOrder: index }))
  const nodes = normalizeList(input.nodes, 'nodes', (node, index) => ({ ...node, id: requireText(node.id, `nodes[${index}].id`), title: requireText(node.title, `nodes[${index}].title`), startDate: node.startDate ? assertDate(node.startDate, `nodes[${index}].startDate`) : null, endDate: node.endDate ? assertDate(node.endDate, `nodes[${index}].endDate`) : null }))
  const days = normalizeList(input.days, 'days', (day, index) => ({ date: assertDate(day.date, `days[${index}].date`), weekday: textValue(day.weekday), dayKind: day.dayKind === undefined ? 'unknown' : oneOf(day.dayKind, `days[${index}].dayKind`, DAY_KINDS), marketOpen: day.marketOpen === true, label: textValue(day.label), coreGoal: textValue(day.coreGoal), source: textValue(day.source) || 'schedule' }))
  const now = new Date().toISOString()
  const tasks = store.transaction(() => {
    store.db.exec('DELETE FROM nodes; DELETE FROM tracks')
    const addTrack = store.db.prepare('INSERT INTO tracks (id, name, lane, priority, state, blocker, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const addNode = store.db.prepare('INSERT INTO nodes (id, track_id, title, state, start_date, end_date, dep, done_when) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    const addDay = store.db.prepare('INSERT INTO day_plans (plan_date, weekday, day_kind, market_open, label, core_goal, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(plan_date) DO UPDATE SET weekday = excluded.weekday, day_kind = excluded.day_kind, market_open = excluded.market_open, label = excluded.label, core_goal = excluded.core_goal, source = excluded.source, updated_at = excluded.updated_at')
    for (const track of tracks) addTrack.run(track.id, track.name, textValue(track.lane),
      textValue(track.priority), textValue(track.state), textValue(track.blocker), track.sortOrder)
    for (const node of nodes) addNode.run(node.id, textValue(node.trackId), node.title, textValue(node.state),
      node.startDate, node.endDate, textValue(node.dep), textValue(node.doneWhen))
    for (const day of days) addDay.run(day.date, day.weekday, day.dayKind, day.marketOpen ? 1 : 0,
      day.label, day.coreGoal, day.source, now)
    return store.syncTrackerTree(tracks, nodes)
  })
  return { tracks: tracks.length, nodes: nodes.length, days: days.length, tasks }
}

/**
 * Upsert one day's imported blocks; content is rewritten, status/notes survive.
 * @param {GanttStore} store
 * @param {string} planDate
 * @param {BlockDraft[]} drafts
 * @returns {BlockUpsertCounts}
 */
export function upsertPlanBlocks(store, planDate, drafts) {
  const date = assertDate(planDate, 'date')
  const normalized = normalizeList(drafts, 'blocks', (draft, index) => ({ title: requireText(draft.title, `blocks[${index}].title`), startTime: clockValue(draft.startTime, `blocks[${index}].startTime`), endTime: clockValue(draft.endTime, `blocks[${index}].endTime`), slot: draft.slot === undefined ? 'other' : oneOf(draft.slot, `blocks[${index}].slot`, PLAN_SLOTS), category: textValue(draft.category), detail: textValue(draft.detail), landing: textValue(draft.landing), estimate: textValue(draft.estimate), inspiration: textValue(draft.inspiration), sourceRef: textValue(draft.sourceRef) }))
  const ids = normalized.map((draft, index) => `${date}|${draft.startTime}|${index}`)
  const existing = /** @type {{ id: string }[]} */ (store.db.prepare('SELECT id FROM plan_blocks WHERE plan_date = ? AND source = ?').all(date, 'schedule'))
  const existingIds = new Set(existing.map(row => row.id))
  const now = new Date().toISOString()
  store.transaction(() => {
    const add = store.db.prepare("INSERT INTO plan_blocks (id, plan_date, start_time, end_time, slot, category, title, detail, landing, estimate, inspiration, sort_order, source, source_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'schedule', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time, slot = excluded.slot, category = excluded.category, title = excluded.title, detail = excluded.detail, landing = excluded.landing, estimate = excluded.estimate, inspiration = excluded.inspiration, sort_order = excluded.sort_order, source = excluded.source, source_ref = excluded.source_ref, updated_at = excluded.updated_at")
    normalized.forEach((draft, index) => add.run(ids[index], date, draft.startTime, draft.endTime, draft.slot,
      draft.category, draft.title, draft.detail, draft.landing, draft.estimate, draft.inspiration, index,
      draft.sourceRef, now, now))
    if (ids.length === 0) store.db.prepare('DELETE FROM plan_blocks WHERE plan_date = ? AND source = ?').run(date, 'schedule')
    else store.db.prepare(`DELETE FROM plan_blocks WHERE plan_date = ? AND source = ? AND id NOT IN (${ids.map(() => '?').join(', ')})`).run(date, 'schedule', ...ids)
  })
  return {
    inserted: ids.filter(id => !existingIds.has(id)).length,
    updated: ids.filter(id => existingIds.has(id)).length,
    removed: existing.filter(row => !ids.includes(row.id)).length,
  }
}

/**
 * Read one day's bundle, including the unified tree's tracks and nodes.
 * @param {GanttStore} store
 * @param {string} planDate
 * @param {DailyReport} brief
 * @returns {DayPlanBundle}
 */
export function readDayPlan(store, planDate, brief) {
  const row = /** @type {any} */ (store.db.prepare('SELECT plan_date AS date, weekday, day_kind AS dayKind, market_open, label, core_goal AS coreGoal, source FROM day_plans WHERE plan_date = ?').get(planDate))
  const blocks = /** @type {PlanBlock[]} */ (store.db.prepare(`SELECT ${BLOCK_COLUMNS} FROM plan_blocks WHERE plan_date = ? ORDER BY sort_order, start_time, id`).all(planDate))
  const rows = store.listRows()
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
  return { day, blocks, tracks, nodes, integrity, stats, brief: brief }
}

/**
 * Set a block's user status and optional notes (notes capped at 500 characters).
 * @param {GanttStore} store
 * @param {string} id
 * @param {PlanStatus} status
 * @param {string | null} [notes]
 * @returns {PlanBlock}
 */
export function setBlockStatus(store, id, status, notes) {
  if (typeof id !== 'string' || id === '') throw new GanttError('id is required')
  if (notes !== undefined && notes !== null && typeof notes !== 'string') throw new GanttError('notes must be a string')
  if (typeof notes === 'string' && [...notes].length > MAX_NOTES) throw new GanttError(`notes must be at most ${MAX_NOTES} characters`)
  const nextStatus = oneOf(status, 'status', PLAN_STATUSES)
  const nextNotes = notes === undefined ? undefined : notes === null ? '' : notes
  const found = store.db.prepare('SELECT id FROM plan_blocks WHERE id = ?').get(id)
  if (found === undefined) throw new GanttError(`plan block ${id} was not found`, 404)
  const now = new Date().toISOString()
  store.transaction(() => {
    if (nextNotes === undefined) store.db.prepare('UPDATE plan_blocks SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now, id)
    else store.db.prepare('UPDATE plan_blocks SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(nextStatus, nextNotes, now, id)
  })
  return /** @type {PlanBlock} */ (store.db.prepare(`SELECT ${BLOCK_COLUMNS} FROM plan_blocks WHERE id = ?`).get(id))
}

/**
 * Read one plan block by id.
 * @param {GanttStore} store
 * @param {string} id
 * @returns {PlanBlock}
 */
export function getPlanBlock(store, id) {
  return /** @type {PlanBlock} */ (store.db.prepare(`SELECT ${BLOCK_COLUMNS} FROM plan_blocks WHERE id = ?`).get(id))
}

/**
 * Upsert the plan cell of one task on one date; user status and notes survive.
 * @param {GanttStore} store
 * @param {string} taskId
 * @param {TaskBlockPlan} plan
 * @returns {string}
 */
export function writeTaskBlock(store, taskId, plan) {
  const id = `task|${taskId}|${plan.date}`
  const now = new Date().toISOString()
  const existing = /** @type {{ sortOrder: number } | undefined} */ (store.db.prepare('SELECT sort_order AS sortOrder FROM plan_blocks WHERE id = ?').get(id))
  if (existing === undefined) {
    const next = /** @type {{ value: number }} */ (store.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM plan_blocks WHERE plan_date = ?').get(plan.date))
    store.db.prepare('INSERT INTO plan_blocks (id, plan_date, start_time, end_time, slot, category, title, detail, landing, estimate, inspiration, status, sort_order, source, source_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'todo\', ?, \'task\', ?, ?, ?)')
      .run(id, plan.date, plan.startTime, plan.endTime, plan.slot, plan.category, plan.title, plan.detail, plan.landing, plan.estimate, plan.inspiration, next.value, `task:${taskId}`, now, now)
  } else {
    store.db.prepare('UPDATE plan_blocks SET start_time = ?, end_time = ?, slot = ?, category = ?, title = ?, detail = ?, landing = ?, estimate = ?, inspiration = ?, updated_at = ? WHERE id = ?')
      .run(plan.startTime, plan.endTime, plan.slot, plan.category, plan.title, plan.detail,
        plan.landing, plan.estimate, plan.inspiration, now, id)
  }
  return id
}
