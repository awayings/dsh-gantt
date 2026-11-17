// Cell-snapped date maths for dragging a Gantt task bar.
//
// The timeline draws one cell per scale unit — a day on the weekly scale, a
// month on the monthly scale — so a drag moves in those units: a body drag
// shifts both dates by the same number of cells and keeps the task's span, and
// an edge drag moves one date and clamps to a one-day minimum. These helpers
// stay free of the DOM so the gesture maths is unit-tested directly; rows.js
// only translates pointers into a mode, a step count, and the returned range.

import { addDays, addMonths } from './dates.js'

/** Timeline scale a drag runs on; one unit of the scale is one drag step.
 * @typedef {'week' | 'month'} DragScale */

/** How a bar was grabbed: its body, or one of its two edges.
 * @typedef {'move' | 'start' | 'end'} BarDragMode */

/** A date range produced by one drag gesture.
 * @typedef {{ startDate: string, endDate: string }} BarDragRange */

/** Pixels one drag step covers on the given timeline: 36 px for the weekly
 * scale's one-day cell, the average month width for the monthly scale.
 * @param {{ totalWidth: number, units: ArrayLike<unknown> }} timeline
 * @returns {number} */
export function cellWidth(timeline) {
  return timeline.totalWidth / timeline.units.length
}

/** Whole drag steps covered by a horizontal pointer delta.
 * @param {number} deltaX Horizontal pointer travel in pixels.
 * @param {number} cellWidthPx Pixels per drag step on the current timeline.
 * @returns {number} */
export function dragSteps(deltaX, cellWidthPx) {
  return Math.round(deltaX / cellWidthPx)
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

/** Shift an ISO date by whole steps of the timeline scale. @param {string} iso
 * @param {number} steps @param {DragScale} scale @returns {string} */
function shiftDate(iso, steps, scale) {
  return scale === 'week' ? addDays(iso, steps) : addMonths(iso, steps)
}

/** The dates a drag gesture commits.
 *
 * `move` shifts both dates by the same cell count and keeps the span; `start`
 * and `end` move one date by whole cells and clamp to a minimum one-day span.
 * @param {{ mode: BarDragMode, startDate: string, endDate: string, steps: number, scale: DragScale }} gesture
 * @returns {BarDragRange} */
export function dragRange({ mode, startDate, endDate, steps, scale }) {
  if (mode === 'move') {
    return {
      startDate: shiftDate(startDate, steps, scale),
      endDate: shiftDate(endDate, steps, scale),
    }
  }
  if (mode === 'start') {
    const candidate = shiftDate(startDate, steps, scale)
    return { startDate: candidate > endDate ? endDate : candidate, endDate }
  }
  const candidate = shiftDate(endDate, steps, scale)
  return { startDate, endDate: candidate < startDate ? startDate : candidate }
}
