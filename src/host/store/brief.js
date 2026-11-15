// Read, build, and persist the daily report snapshot.

import { computeDailyBrief as computeDailyReport, parseDailyReport } from '../daily.js'
import { todayIso } from '../tree.js'
import { GanttError } from '../errors.js'
import { BLOCK_COLUMNS } from './plan.js'
import { assertDate } from './tasks.js'

/** @typedef {import('../daily.js').DailyReport} DailyReport */
/** @typedef {import('./gantt.js').GanttStore} GanttStore */
/** @typedef {import('./plan.js').DayKind} DayKind */
/** @typedef {import('./plan.js').PlanBlock} PlanBlock */


/**
 * Read the persisted report for one date, or null when it is missing or corrupt.
 * @param {GanttStore} store
 * @param {string} planDate
 * @returns {DailyReport | null}
 */
export function readDailyBrief(store, planDate) {
  const row = /** @type {{ report: string } | undefined} */ (store.db.prepare('SELECT report FROM daily_briefs WHERE plan_date = ?').get(planDate))
  return row === undefined ? null : parseDailyReport(row.report)
}

/**
 * Read up to thirty persisted reports before one date, newest first.
 * @param {GanttStore} store
 * @param {string} planDate
 * @returns {DailyReport[]}
 */
export function previousDailyBriefs(store, planDate) {
  const rows = /** @type {{ report: string }[]} */ (store.db.prepare('SELECT report FROM daily_briefs WHERE plan_date < ? ORDER BY plan_date DESC LIMIT 30').all(planDate))
  return rows.map(row => parseDailyReport(row.report)).filter(report => report !== null)
}

/**
 * Build one day's report without persisting it.
 * @param {GanttStore} store
 * @param {string} planDate
 * @param {'auto' | 'manual'} source
 * @returns {DailyReport}
 */
export function buildDailyReport(store, planDate, source) {
  const day = /** @type {{ dayKind: string } | undefined} */ (store.db.prepare('SELECT day_kind AS dayKind FROM day_plans WHERE plan_date = ?').get(planDate))
  const blocks = /** @type {PlanBlock[]} */ (store.db.prepare(`SELECT ${BLOCK_COLUMNS} FROM plan_blocks WHERE plan_date = ? ORDER BY sort_order, start_time, id`).all(planDate))
  const dayKind = day === undefined || day.dayKind === '' ? 'unknown' : /** @type {DayKind} */ (day.dayKind)
  const generatedAt = new Date().toISOString()
  const tree = store.tree()
  return computeDailyReport({ date: planDate, generatedAt, source, dayKind, blocks, tree, previous: store.previousDailyBriefs(planDate) })
}

/**
 * Persist one report, replacing the row for its date.
 * @param {GanttStore} store
 * @param {DailyReport} report
 * @returns {void}
 */
export function persistDailyBrief(store, report) {
  const sql = 'INSERT INTO daily_briefs (plan_date, generated_at, source, report) VALUES (?, ?, ?, ?) ON CONFLICT(plan_date) DO UPDATE SET generated_at = excluded.generated_at, source = excluded.source, report = excluded.report'
  store.transaction(() => store.db.prepare(sql).run(report.date, report.generatedAt, report.source, JSON.stringify(report)))
}

/**
 * Read today's brief from the cache, computing and persisting it when missing.
 * @param {GanttStore} store
 * @param {string} [date]
 * @returns {{ report: DailyReport, cached: boolean }}
 */
export function dailyBrief(store, date = todayIso()) {
  const planDate = assertDate(date, 'date')
  const cached = store.readDailyBrief(planDate)
  if (cached !== null) return { report: cached, cached: true }
  const report = store.buildDailyReport(planDate, 'auto')
  if (planDate === todayIso()) store.persistDailyBrief(report)
  return { report, cached: false }
}

/**
 * Force a fresh report and persist it (the manual UI recompute).
 * @param {GanttStore} store
 * @param {string} [date]
 * @param {{ source?: 'auto' | 'manual' }} [options]
 * @returns {DailyReport}
 */
export function computeDailyBrief(store, date = todayIso(), options = {}) {
  const planDate = assertDate(date, 'date')
  const source = options.source === undefined ? 'manual' : options.source
  if (source !== 'auto' && source !== 'manual') throw new GanttError('source must be one of auto, manual')
  const report = store.buildDailyReport(planDate, source)
  store.persistDailyBrief(report)
  return report
}
