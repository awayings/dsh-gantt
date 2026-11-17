// Week-snapped date maths for dragging a Gantt task bar.
//
// The task system plans in whole ISO weeks: a start edge lands on a Monday, an
// end edge on a Sunday, and a body drag keeps the whole-week span. These helpers
// stay free of the DOM so the gesture maths is unit-tested directly; rows.js
// only translates pointers into a mode, a week delta, and the returned range.

import { DAY_MS } from './constants.js'
import { addDays, isoToDay, startOfWeek } from './dates.js'

/** Days in one snapped drag step. */
export const WEEK_DAYS = 7

/** How a bar was grabbed: its body, or one of its two edges.
 * @typedef {'move' | 'start' | 'end'} BarDragMode */

/** A date range produced by one drag gesture.
 * @typedef {{ startDate: string, endDate: string }} BarDragRange */

/** Whole snapped weeks covered by a horizontal pointer delta.
 * @param {number} deltaX Horizontal pointer travel in pixels.
 * @param {number} pxPerDay Timeline scale in pixels per day.
 * @returns {number} */
export function dragWeeks(deltaX, pxPerDay) {
  return Math.round(deltaX / (WEEK_DAYS * pxPerDay))
}

/** The drag mode implied by the element under the pointer: a bar handle carries
 * `data-edge="start"` or `"end"`, anything else moves the whole bar.
 * @param {unknown} target @returns {BarDragMode} */
export function dragMode(target) {
  const closest = /** @type {{ closest?: unknown } | null} */ (target)?.closest
  if (typeof closest !== 'function') return 'move'
  const edge = /** @type {{ getAttribute: (name: string) => string | null } | null} */ (
    closest.call(target, '[data-edge]')
  )
  if (edge === null) return 'move'
  return edge.getAttribute('data-edge') === 'start' ? 'start' : 'end'
}

/** Monday for a week-shifted date. @param {string} iso @param {number} weeks */
function mondayOf(iso, weeks) {
  return startOfWeek(addDays(iso, weeks * WEEK_DAYS))
}

/** Whole weeks between two inclusive dates, never less than one.
 * @param {string} startDate @param {string} endDate @returns {number} */
function wholeWeeks(startDate, endDate) {
  const days = (isoToDay(endDate) - isoToDay(startDate)) / DAY_MS + 1
  return Math.max(1, Math.round(days / WEEK_DAYS))
}

/** The week-snapped dates a drag gesture commits.
 *
 * `move` shifts the bar by whole weeks and keeps its whole-week span; `start`
 * and `end` move one edge by whole weeks, snap the other edge to its own week
 * boundary, and clamp to a minimum span of one week.
 * @param {{ mode: BarDragMode, startDate: string, endDate: string, weeks: number }} gesture
 * @returns {BarDragRange} */
export function dragRange({ mode, startDate, endDate, weeks }) {
  if (mode === 'move') {
    const nextStart = mondayOf(startDate, weeks)
    return {
      startDate: nextStart,
      endDate: addDays(nextStart, wholeWeeks(startDate, endDate) * WEEK_DAYS - 1),
    }
  }
  if (mode === 'start') {
    const nextEnd = addDays(mondayOf(endDate, 0), WEEK_DAYS - 1)
    const earliestStart = addDays(nextEnd, -(WEEK_DAYS - 1))
    const candidate = mondayOf(startDate, weeks)
    return { startDate: candidate > earliestStart ? earliestStart : candidate, endDate: nextEnd }
  }
  const nextStart = mondayOf(startDate, 0)
  const latestEnd = addDays(nextStart, WEEK_DAYS - 1)
  const candidate = addDays(mondayOf(endDate, weeks), WEEK_DAYS - 1)
  return { startDate: nextStart, endDate: candidate < latestEnd ? latestEnd : candidate }
}
