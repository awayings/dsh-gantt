// The day's windows: slot vocabulary, window kinds, track roles, and estimate parsing.

import { slotForStart } from '../tree.js'

/** @typedef {'core' | 'rotation' | 'definition'} BriefRole */
/** @typedef {'core' | 'rotation' | 'blocked'} TierRole */
/** @typedef {'morning' | 'daytime' | 'evening' | 'other'} BriefSlot */
/** @typedef {'workday' | 'weekend' | 'unknown'} BriefDayKind */

/**
 * One filled or template window of the day.
 * @typedef {object} BriefWindow
 * @property {BriefSlot} slot
 * @property {string} startTime
 * @property {string} endTime
 * @property {number} minutes
 * @property {BriefRole} kind
 * @property {string} blockId
 */

/**
 * A structural plan block the windows are derived from.
 * @typedef {object} BriefBlock
 * @property {string} id
 * @property {string} startTime
 * @property {string} endTime
 * @property {string} slot
 */

/** @type {Array<{ slot: BriefSlot, startTime: string, endTime: string }>} */
const WORKDAY_TEMPLATE = [{ slot: 'evening', startTime: '21:00', endTime: '22:00' }]

/** @type {Array<{ slot: BriefSlot, startTime: string, endTime: string }>} */
const WEEKEND_TEMPLATE = [
  { slot: 'morning', startTime: '09:00', endTime: '12:00' },
  { slot: 'daytime', startTime: '14:00', endTime: '18:00' },
  { slot: 'evening', startTime: '19:00', endTime: '21:30' },
]
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Minutes of a `HH:MM` clock value, or `null` when it is not a valid time.
 * @param {string} value
 * @returns {number | null}
 */
function clockMinutes(value) {
  const match = CLOCK_RE.exec(value)
  return match === null ? null : Number(match[1]) * 60 + Number(match[2])
}

/**
 * Duration of a start/end pair in minutes; `0` when either side is unknown or
 * the range is inverted.
 * @param {string} startTime
 * @param {string} endTime
 * @returns {number}
 */
function minutesOf(startTime, endTime) {
  if (startTime === '' || endTime === '') return 0
  const start = clockMinutes(startTime)
  const end = clockMinutes(endTime)
  if (start === null || end === null || end < start) return 0
  return end - start
}

/**
 * The target role of one window: `core` for two hours or more, `definition` for
 * anything under 90 minutes or unknown times, `rotation` in between.
 * @param {string} startTime
 * @param {string} endTime
 * @returns {BriefRole}
 */
export function windowKindOf(startTime, endTime) {
  if (startTime === '' || endTime === '') return 'definition'
  const minutes = minutesOf(startTime, endTime)
  if (minutes >= 120) return 'core'
  if (minutes < 90) return 'definition'
  return 'rotation'
}

/**
 * The role of a track: `core` when it is running, `blocked` when it is stuck,
 * `done` when it is finished, otherwise (cold-start) `rotation`.
 * @param {{ state: string, status: string }} track
 * @returns {'core' | 'rotation' | 'blocked' | 'done'}
 */
export function trackRole(track) {
  if (track.state === '进行' || track.state === '进行中' || track.status === 'in_progress') return 'core'
  if (track.state === '卡住' || track.status === 'blocked') return 'blocked'
  if (track.state === '已过' || track.state === '撤销' || track.status === 'done') return 'done'
  return 'rotation'
}

/**
 * @param {BriefWindow} left
 * @param {BriefWindow} right
 * @returns {number}
 */
function compareWindows(left, right) {
  const leftStart = left.startTime === '' ? '99:99' : left.startTime
  const rightStart = right.startTime === '' ? '99:99' : right.startTime
  const leftEnd = left.endTime === '' ? '99:99' : left.endTime
  const rightEnd = right.endTime === '' ? '99:99' : right.endTime
  return leftStart.localeCompare(rightStart)
    || leftEnd.localeCompare(rightEnd)
    || left.blockId.localeCompare(right.blockId)
}

/**
 * @param {BriefBlock} block
 * @returns {BriefWindow}
 */
function windowOf(block) {
  const startTime = typeof block.startTime === 'string' ? block.startTime : ''
  const endTime = typeof block.endTime === 'string' ? block.endTime : ''
  const storedSlot = typeof block.slot === 'string' ? block.slot : ''
  const slot = /** @type {BriefSlot} */ (storedSlot === '' ? slotForStart(startTime) : storedSlot)
  return {
    slot,
    startTime,
    endTime,
    minutes: minutesOf(startTime, endTime),
    kind: windowKindOf(startTime, endTime),
    blockId: typeof block.id === 'string' ? block.id : '',
  }
}

/**
 * @param {BriefDayKind} dayKind
 * @returns {Array<{ slot: BriefSlot, startTime: string, endTime: string }>}
 */
function templateOf(dayKind) {
  if (dayKind === 'workday') return WORKDAY_TEMPLATE
  if (dayKind === 'weekend') return WEEKEND_TEMPLATE
  return []
}

/**
 * Build the day's windows: the plan blocks when the day has any, otherwise the
 * day-kind template (workday: one evening window; weekend: three windows; an
 * unknown day kind has no template). Chronological, with unknown times last.
 * @param {BriefBlock[]} blocks
 * @param {BriefDayKind} dayKind
 * @returns {BriefWindow[]}
 */
export function buildWindows(blocks, dayKind) {
  const list = Array.isArray(blocks) ? blocks : []
  if (list.length > 0) return list.map(windowOf).sort(compareWindows)
  return templateOf(dayKind).map(template => ({
    ...template,
    minutes: minutesOf(template.startTime, template.endTime),
    kind: windowKindOf(template.startTime, template.endTime),
    blockId: '',
  }))
}

/**
 * Parse a tracker estimate such as `2h`, `≥4h`, `30min`, `1.5h`, or `90m`.
 * @param {unknown} value
 * @returns {number} minutes; `0` when the estimate is absent or unrecognised
 */
export function parseEstimate(value) {
  if (typeof value !== 'string') return 0
  const match = /(\d+(?:\.\d+)?)\s*(h|hr|hour|hours|m|min|mins|minute|minutes)\b/i.exec(value.trim())
  if (match === null) return 0
  const amount = Number(match[1])
  return Math.round(match[2].toLowerCase().startsWith('h') ? amount * 60 : amount)
}
