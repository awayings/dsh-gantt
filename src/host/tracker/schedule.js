// The `## 四、未来 7 天` board: window inference, day headings, block rows, and
// the parsed days the importer writes into the plan.

import { SCHEDULE_FILE } from './files.js'
import { isRealDate, sectionLines, splitCells, cellText, isSeparatorRow, stripMarkdown, weekdayFor } from './markdown.js'

/** @typedef {import('../store.js').BlockDraft} BlockDraft */

/**
 * One parsed day of the future-7-day board.
 * @typedef {object} ParsedDay
 * @property {string} date
 * @property {string} weekday
 * @property {'workday' | 'weekend' | 'unknown'} dayKind
 * @property {boolean} marketOpen
 * @property {string} label
 * @property {BlockDraft[]} blocks
 */

/**
 * The `窗口 = MM/DD-MM/DD` note that anchors the board's year.
 * @typedef {object} TrackerWindow
 * @property {number} startMonth
 * @property {number} startDay
 * @property {number} endMonth
 * @property {number} endDay
 */

/**
 * A parsed `### MM/DD 周X —— label` heading.
 * @typedef {object} DayHeading
 * @property {number} month
 * @property {number} day
 * @property {string} weekday
 * @property {string} label
 */

const CLOCK_RE = /^(\d{1,2}):(\d{2})$/
const CLOCK_TOKEN_RE = /(\d{1,2}):(\d{2})/g
const SCHEDULE_SECTION = '四、未来 7 天'
const HALF_YEAR_MS = 183 * 86_400_000
const MAX_SPLIT_TITLE = 120

/**
 * Normalize a clock value to `HH:MM`, or `''` when it is not a real time.
 * @param {string} value
 * @returns {string}
 */
function parseClock(value) {
  const match = CLOCK_RE.exec(value.trim())
  if (match === null) return ''
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return ''
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * The span of a time cell: the first time is the start and the last one the end,
 * so `09:30-12:00 / 14:00-17:00` becomes `09:30`-`17:00`.
 * @param {string} cell
 * @returns {{ startTime: string, endTime: string }}
 */
function extractTimes(cell) {
  /** @type {string[]} */
  const times = []
  for (const match of cell.matchAll(CLOCK_TOKEN_RE)) {
    const clock = parseClock(`${match[1]}:${match[2]}`)
    if (clock !== '') times.push(clock)
  }
  const first = times[0]
  if (first === undefined) return { startTime: '', endTime: '' }
  return { startTime: first, endTime: times.length > 1 ? times[times.length - 1] : '' }
}

/**
 * Split a content cell into a short title and the full detail text.
 * @param {string} text
 * @returns {{ title: string, detail: string }}
 */
function splitTitle(text) {
  const index = text.lastIndexOf('——')
  if (index > 0) {
    const head = text.slice(0, index).trim()
    const length = [...head].length
    if (length > 0 && length <= MAX_SPLIT_TITLE) return { title: head, detail: text }
  }
  return { title: text, detail: text }
}

/**
 * The first `#NN[.N]` idea-store token in a block, or `''`.
 * @param {string} text
 * @returns {string}
 */
function findInspiration(text) {
  const match = /#(\d+(?:\.\d+)?)/.exec(text)
  return match === null ? '' : `#${match[1]}`
}

/**
 * @param {string} label
 * @returns {'workday' | 'weekend' | 'unknown'}
 */
function dayKindFromLabel(label) {
  if (label.includes('周末')) return 'weekend'
  if (label.includes('上班') || label.includes('工作日')) return 'workday'
  return 'unknown'
}

/**
 * @param {string} label
 * @returns {boolean}
 */
function marketOpenFromLabel(label) {
  if (label.includes('休市')) return false
  return label.includes('交易日')
}

/**
 * @param {string} text
 * @returns {TrackerWindow | null}
 */
function readWindow(text) {
  const match = /窗口\s*=\s*\**\s*(\d{1,2})\/(\d{1,2})\s*[-–—]\s*(\d{1,2})\/(\d{1,2})/.exec(text)
  if (match === null) return null
  /** @type {TrackerWindow} */
  const window = {
    startMonth: Number(match[1]),
    startDay: Number(match[2]),
    endMonth: Number(match[3]),
    endDay: Number(match[4]),
  }
  if (window.startMonth > 12 || window.endMonth > 12) return null
  if (window.startDay > 31 || window.endDay > 31) return null
  return window
}

/**
 * Pick the board's starting year. Without an explicit option, a window that is
 * almost a year away from today means the board belongs to the adjacent year.
 * @param {TrackerWindow | null} window
 * @param {number | undefined} yearOption
 * @param {Date} now
 * @returns {number}
 */
function inferBaseYear(window, yearOption, now) {
  if (yearOption !== undefined) return yearOption
  const baseYear = now.getFullYear()
  if (window === null) return baseYear
  const reference = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const candidate = Date.UTC(baseYear, window.startMonth - 1, window.startDay)
  if (candidate - reference > HALF_YEAR_MS) return baseYear - 1
  if (reference - candidate > HALF_YEAR_MS) return baseYear + 1
  return baseYear
}

/**
 * The year of one month inside the window; a window that crosses New Year puts
 * its January days in the following year.
 * @param {number} month
 * @param {TrackerWindow | null} window
 * @param {number} baseYear
 * @returns {number}
 */
function yearForMonth(month, window, baseYear) {
  if (window === null || window.endMonth >= window.startMonth) return baseYear
  if (month >= window.startMonth) return baseYear
  if (month <= window.endMonth) return baseYear + 1
  return baseYear
}

/**
 * @param {string} line
 * @returns {DayHeading | null}
 */
function parseDayHeading(line) {
  const match = /^###\s+(\d{1,2})\/(\d{1,2})(?:\s+(?:周)?([一二三四五六日天]))?(?:\s+——\s*(.*))?$/.exec(line.trim())
  if (match === null) return null
  const month = Number(match[1])
  const day = Number(match[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const character = match[3]
  const weekday = character === undefined ? '' : `周${character === '天' ? '日' : character}`
  const label = match[4] === undefined ? '' : stripMarkdown(match[4])
  return { month, day, weekday, label }
}

/**
 * @param {string} line
 * @param {number} ordinal
 * @returns {BlockDraft | null}
 */
function parseBlockRow(line, ordinal) {
  const cells = splitCells(line)
  if (cells.length === 0 || isSeparatorRow(cells)) return null
  const timeCell = cellText(cells[0])
  const category = cellText(cells[1])
  const content = cellText(cells[2])
  if (content === '' || timeCell === '时段' || (timeCell === '' && content === '内容')) return null
  /** @type {BlockDraft} */
  const draft = {
    startTime: '',
    endTime: '',
    slot: 'other',
    category,
    title: content,
    detail: content,
    landing: cellText(cells[3]),
    estimate: cellText(cells[4]),
    inspiration: '',
    sortOrder: ordinal,
    sourceRef: SCHEDULE_FILE,
  }
  const times = extractTimes(timeCell)
  const split = splitTitle(content)
  draft.startTime = times.startTime
  draft.endTime = times.endTime
  draft.slot = slotForTime(times.startTime, times.endTime)
  draft.title = split.title
  draft.detail = split.detail
  draft.inspiration = findInspiration(`${category} ${split.title} ${split.detail}`)
  return draft
}

/**
 * The slot a block belongs to. Clock time only: the day kind lives on the day plan,
 * so a weekend 09:00 block is `morning` like a weekday's.
 * @param {string} start
 * @param {string} [_end] Accepted for call-site symmetry; the slot depends on the start time only.
 * @returns {'morning' | 'daytime' | 'evening' | 'other'}
 */
export function slotForTime(start, _end) {
  const clock = parseClock(start)
  if (clock === '') return 'other'
  if (clock < '10:00') return 'morning'
  if (clock < '19:30') return 'daytime'
  return 'evening'
}

/**
 * Parse the `## 四、未来 7 天` board.
 * @param {string} text
 * @param {{ year?: number }} [options]
 * @returns {{ days: ParsedDay[] }}
 */
export function parseSchedule(text, options = {}) {
  const source = typeof text === 'string' ? text : ''
  const lines = source.split(/\r?\n/)
  const section = sectionLines(lines, SCHEDULE_SECTION)
  const window = readWindow(section.join('\n'))
  const yearOption = Number.isInteger(options.year) ? options.year : undefined
  const baseYear = inferBaseYear(window, yearOption, new Date())
  /** @type {ParsedDay[]} */
  const days = []
  /** @type {ParsedDay | null} */
  let current = null
  let accepting = false
  for (const line of section) {
    const heading = parseDayHeading(line)
    if (heading !== null) {
      const year = yearForMonth(heading.month, window, baseYear)
      const date = `${year}-${String(heading.month).padStart(2, '0')}-${String(heading.day).padStart(2, '0')}`
      if (isRealDate(date)) {
        current = {
          date,
          weekday: heading.weekday === '' ? weekdayFor(date) : heading.weekday,
          dayKind: dayKindFromLabel(heading.label),
          marketOpen: marketOpenFromLabel(heading.label),
          label: heading.label,
          blocks: [],
        }
        days.push(current)
        accepting = true
      } else {
        current = null
        accepting = false
      }
      continue
    }
    if (current === null) continue
    const trimmed = line.trim()
    if (trimmed === '') {
      if (current.blocks.length > 0) accepting = false
      continue
    }
    if (trimmed.startsWith('>')) continue
    if (!accepting) continue
    if (!trimmed.startsWith('|')) {
      if (current.blocks.length > 0) accepting = false
      continue
    }
    const draft = parseBlockRow(trimmed, current.blocks.length)
    if (draft !== null) current.blocks.push(draft)
  }
  return { days }
}
