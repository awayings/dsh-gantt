// Parsers and importer for the external task-tracker markdown workspace.
//
// The tracker is maintained by hand and by cron jobs, so its formatting drifts:
// tables gain or lose cells, headings carry bold/emoji decoration, and a file can
// be truncated mid-write. The parsers therefore accept any string and return empty
// results instead of throwing; only a missing directory is a hard error, because
// importing nothing from nowhere would silently look like an empty day.
import fs from 'node:fs'
import path from 'node:path'
import { GanttError } from './store.js'

/**
 * @typedef {import('./store.js').BlockDraft} BlockDraft
 * @typedef {import('./store.js').GanttStore} GanttStore
 */

/** @typedef {{ id: string, name: string, lane: string, priority: string, state: string, blocker: string }} TrackInput */
/** @typedef {{ id: string, trackId: string, title: string, state: string, startDate: string | null,
 * endDate: string | null, dep: string, doneWhen: string }} NodeInput */

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CLOCK_RE = /^(\d{1,2}):(\d{2})$/
const CLOCK_TOKEN_RE = /(\d{1,2}):(\d{2})/g
const DAILY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/
const MAX_DAILY_CARDS = 31
const SCHEDULE_SECTION = '四、未来 7 天'
const TRACKS_SECTION = '三、六条支线'
const NODES_SECTION = '四、节点表'
const SCHEDULE_FILE = 'SCHEDULE.md'
const TREE_FILE = 'TREE.md'
const DAILY_DIR = 'daily'
const DEFAULT_TRACKER_DIR = '/data/home/clawd/projects/task-tracker'
const HALF_YEAR_MS = 183 * 86_400_000
const MAX_SPLIT_TITLE = 120

/** @type {string[]} */
const WEEKDAY_CHARS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * Resolve the tracker directory: the environment override or the documented default.
 * @returns {string}
 */
export function resolveTrackerDir() {
  return process.env.DSH_GANTT_TRACKER_DIR || DEFAULT_TRACKER_DIR
}

/**
 * Strip the inline markdown the tracker writes inside table cells.
 * @param {string} value
 * @returns {string}
 */
function stripMarkdown(value) {
  return value
    .replaceAll('**', '')
    .replaceAll('`', '')
    .replaceAll('⭐', '')
    .replaceAll('⚠️', '')
    .replaceAll('✅', '')
    .replaceAll('❌', '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
function cellText(value) {
  return value === undefined ? '' : stripMarkdown(value)
}

/**
 * Split one table row into cells, tolerating the leading `||` the tracker uses.
 * @param {string} line
 * @returns {string[]}
 */
function splitCells(line) {
  const trimmed = line.trim()
  const lead = trimmed.startsWith('||') ? 2 : 1
  const tail = trimmed.endsWith('|') ? 1 : 0
  return trimmed.slice(lead, trimmed.length - tail).split('|')
}

/**
 * @param {string[]} cells
 * @returns {boolean}
 */
function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()))
}

/**
 * Collect the lines of one `## ` section, stopping at the next `## ` heading.
 * @param {string[]} lines
 * @param {string} marker
 * @returns {string[]}
 */
function sectionLines(lines, marker) {
  const start = lines.findIndex(line => /^##\s/.test(line) && line.includes(marker))
  if (start === -1) return []
  /** @type {string[]} */
  const section = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) break
    section.push(lines[index])
  }
  return section
}

/**
 * Read the table rows of a section, ignoring notes, separators, and prose.
 * @param {string[]} lines
 * @returns {string[][]}
 */
function tableRows(lines) {
  /** @type {string[][]} */
  const rows = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('>')) continue
    if (!trimmed.startsWith('|')) {
      if (rows.length > 0) break
      continue
    }
    const cells = splitCells(trimmed)
    if (cells.length === 0 || isSeparatorRow(cells)) continue
    rows.push(cells)
  }
  return rows
}

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
 * @param {string} value
 * @returns {boolean}
 */
function isRealDate(value) {
  if (!DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/**
 * @param {string} date
 * @returns {string}
 */
function weekdayFor(date) {
  const [year, month, day] = date.split('-').map(Number)
  return `周${WEEKDAY_CHARS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}`
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

/**
 * @param {string[]} lines
 * @returns {TrackInput[]}
 */
function parseTracks(lines) {
  /** @type {TrackInput[]} */
  const tracks = []
  /** @type {Set<string>} */
  const seen = new Set()
  for (const cells of tableRows(lines)) {
    const id = cellText(cells[0])
    const name = cellText(cells[1])
    if (id === 'id' || id === '' || name === '' || seen.has(id)) continue
    seen.add(id)
    tracks.push({
      id,
      name,
      lane: cellText(cells[2]),
      priority: cellText(cells[3]),
      state: cellText(cells[4]),
      blocker: cellText(cells[5]),
    })
  }
  return tracks
}

/**
 * @param {string | undefined} value
 * @returns {string | null}
 */
function parseDateCell(value) {
  const text = cellText(value)
  if (text === '' || text === '持续' || text === '—' || text === '-') return null
  return isRealDate(text) ? text : null
}

/**
 * @param {string[]} lines
 * @returns {NodeInput[]}
 */
function parseNodes(lines) {
  /** @type {NodeInput[]} */
  const nodes = []
  /** @type {Set<string>} */
  const seen = new Set()
  for (const cells of tableRows(lines)) {
    const id = cellText(cells[0])
    const title = cellText(cells[2])
    if (id === 'id' || id === '' || title === '' || seen.has(id)) continue
    seen.add(id)
    nodes.push({
      id,
      trackId: cellText(cells[1]),
      title,
      state: cellText(cells[3]),
      startDate: parseDateCell(cells[4]),
      endDate: parseDateCell(cells[5]),
      dep: cellText(cells[6]),
      doneWhen: cellText(cells[7]),
    })
  }
  return nodes
}

/**
 * Parse the `TREE.md` track and node tables.
 * @param {string} text
 * @returns {{ tracks: TrackInput[], nodes: NodeInput[] }}
 */
export function parseTree(text) {
  const source = typeof text === 'string' ? text : ''
  const lines = source.split(/\r?\n/)
  return {
    tracks: parseTracks(sectionLines(lines, TRACKS_SECTION)),
    nodes: parseNodes(sectionLines(lines, NODES_SECTION)),
  }
}

/**
 * Parse one daily card: its frontmatter date and the first core-goal quote.
 * @param {string} text
 * @returns {{ date: string, coreGoal: string }}
 */
export function parseDaily(text) {
  const source = typeof text === 'string' ? text : ''
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  let date = ''
  if (frontmatter !== null) {
    const match = /^date:\s*(\S+)/m.exec(frontmatter[1])
    if (match !== null && isRealDate(match[1])) date = match[1]
  }
  const lines = source.split(/\r?\n/)
  const heading = lines.findIndex(line => /^##\s+(?:🎯\s*)?今天核心目标\s*$/.test(line.trim()))
  let coreGoal = ''
  if (heading !== -1) {
    for (let index = heading + 1; index < lines.length; index += 1) {
      const line = lines[index].trim()
      if (line === '') continue
      if (!line.startsWith('>')) break
      coreGoal = stripMarkdown(line.replace(/^>\s*/, '')).replace(/^一句话[:：]\s*/, '')
      break
    }
  }
  return { date, coreGoal }
}

/**
 * @param {string} file
 * @returns {string}
 */
function readFileOrEmpty(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Read every dated daily card, keeping the 31 newest file names.
 * @param {string} dir
 * @returns {Map<string, string>}
 */
function readDailies(dir) {
  /** @type {string[]} */
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return new Map()
  }
  const dated = names.filter(name => DAILY_FILE_RE.test(name)).sort().slice(-MAX_DAILY_CARDS)
  return new Map(dated.map(name => [name.slice(0, 10), readFileOrEmpty(path.join(dir, name))]))
}

/**
 * Read the tracker sources. A missing directory is a `400`; a missing individual
 * file degrades to an empty string, and `daily` maps each date to its card text.
 * @param {string} dir
 * @returns {{ schedule: string, tree: string, daily: Map<string, string> }}
 */
export function readTracker(dir) {
  if (typeof dir !== 'string' || dir === '') throw new GanttError('tracker directory is required')
  /** @type {import('node:fs').Stats} */
  let stats
  try {
    stats = fs.statSync(dir)
  } catch {
    throw new GanttError(`tracker directory ${dir} was not found`, 400)
  }
  if (!stats.isDirectory()) throw new GanttError(`tracker path ${dir} is not a directory`, 400)
  return {
    schedule: readFileOrEmpty(path.join(dir, SCHEDULE_FILE)),
    tree: readFileOrEmpty(path.join(dir, TREE_FILE)),
    daily: readDailies(path.join(dir, DAILY_DIR)),
  }
}

/**
 * Read, parse, and import the whole tracker. Idempotent: re-importing rewrites
 * content fields and keeps user status/notes.
 * @param {GanttStore} store
 * @param {{ dir?: string, year?: number }} [options]
 * @returns {{ dir: string, tracks: number, nodes: number, days: number, blocks: number }}
 */
export function importTaskTracker(store, options = {}) {
  const dir = options.dir || ''
  const { schedule, tree, daily } = readTracker(dir)
  const { days } = parseSchedule(schedule, { year: options.year })
  const { tracks, nodes } = parseTree(tree)
  const plans = days.map((day) => {
    const card = daily.get(day.date)
    return { ...day, coreGoal: card === undefined ? '' : parseDaily(card).coreGoal }
  })
  store.replacePlan({ tracks, nodes, days: plans })
  let blocks = 0
  for (const plan of plans) {
    store.upsertPlanBlocks(plan.date, plan.blocks)
    blocks += plan.blocks.length
  }
  return { dir, tracks: tracks.length, nodes: nodes.length, days: plans.length, blocks }
}
