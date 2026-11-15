// The task-day 08:00 recompute timer.

import { nextEightAm, todayIso } from '../clock.js'
import { computeDailyBrief } from './brief.js'

/** @typedef {import('./gantt.js').GanttStore} GanttStore */

/**
 * Recompute today's report every task-day 08:00; returns an idempotent disposer.
 * @param {GanttStore} store
 * @returns {() => void}
 */
export function startScheduler(store) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null
  const schedule = () => {
    timer = setTimeout(() => {
      try { computeDailyBrief(store, todayIso(), { source: 'auto' }) } finally { schedule() }
    }, nextEightAm(new Date()).getTime() - Date.now())
    timer.unref()
  }
  schedule()
  return () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}
