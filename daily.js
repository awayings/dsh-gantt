// The daily 该动 ("what to move today") engine: window templates, role budgets,
// deterministic task selection, rotation fairness, and the persisted report shape.
//
// Everything here is pure except the type definitions; store.js owns persistence
// and the 08:00 scheduler. The tracker wording mirrors Hermes RULES.md / TREE.md.
import { compareRefs, computeBrief, flattenTree, slotForStart } from './tree.js'
import { nextEightAm } from './clock.js'

/** @typedef {import('./tree.js').BriefEntry} BriefEntry */
/** @typedef {import('./tree.js').TreeTaskNode} TreeTaskNode */
/** @typedef {'core' | 'rotation' | 'definition'} BriefRole */
/** @typedef {'core' | 'rotation' | 'blocked'} TierRole */
/** @typedef {'morning' | 'daytime' | 'evening' | 'other'} BriefSlot */
/** @typedef {'workday' | 'weekend' | 'unknown'} BriefDayKind */
/** The part of a previously persisted report rotation fairness reads.
 * @typedef {{ date: string, items: Array<{ trackId: string }> }} PreviousReport */

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
 * One picked task per filled window.
 * @typedef {object} BriefItem
 * @property {BriefSlot} slot
 * @property {string} startTime
 * @property {string} endTime
 * @property {number} minutes
 * @property {string} blockId
 * @property {string} taskId
 * @property {string} ref
 * @property {string} title
 * @property {string} trackId
 * @property {string} trackName
 * @property {BriefRole} role
 */

/**
 * Per-track summary row of the report.
 * @typedef {object} BriefTrack
 * @property {string} trackId
 * @property {string} ref
 * @property {string} name
 * @property {string} state
 * @property {'core' | 'rotation' | 'blocked' | 'done'} role
 * @property {number} picks
 * @property {BriefEntry | null} frontier
 * @property {BriefEntry | null} next
 */

/**
 * The persisted daily brief report, returned verbatim by the API.
 * @typedef {object} DailyReport
 * @property {string} date
 * @property {string} generatedAt
 * @property {'auto' | 'manual'} source
 * @property {BriefDayKind} dayKind
 * @property {BriefWindow[]} slots
 * @property {BriefItem[]} items
 * @property {BriefTrack[]} tracks
 * @property {number[]} unfilled
 * @property {string[]} notes
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
/** Item-role → track tiers, first tier that has a candidate wins. @type {Record<BriefRole, TierRole[]>} */
const ROLE_CHAINS = {
  core: ['core', 'rotation', 'blocked'],
  rotation: ['rotation', 'core', 'blocked'],
  definition: ['rotation', 'core', 'blocked'],
}
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

/** Report keys that must be arrays for a persisted row to be usable. */
const REPORT_ARRAYS = ['slots', 'items', 'tracks', 'unfilled', 'notes']

/**
 * Parse one persisted report row; returns `null` for corrupt JSON or a shape the
 * report contract cannot describe, so a bad row reads as a cache miss.
 * @param {unknown} raw
 * @returns {DailyReport | null}
 */
export function parseDailyReport(raw) {
  if (typeof raw !== 'string' || raw === '') return null
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const report = /** @type {Record<string, unknown>} */ (value)
  if (typeof report.date !== 'string') return null
  for (const field of REPORT_ARRAYS) if (!Array.isArray(report[field])) return null
  return /** @type {DailyReport} */ (report)
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

export { nextEightAm }

/**
 * @param {TreeTaskNode} left
 * @param {TreeTaskNode} right
 * @returns {number}
 */
function baseOrder(left, right) {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
}

/**
 * A pending leaf whose single dependency is empty or points at a done node.
 * @param {TreeTaskNode} task
 * @param {Map<string, string>} depStatus
 * @returns {boolean}
 */
function isReadyLeaf(task, depStatus) {
  if (task.children.length > 0) return false
  if (task.status !== 'todo' && task.status !== 'blocked') return false
  return task.dep === '' || depStatus.get(task.dep) === 'done'
}

/**
 * Order the rotation tier by fairness: never-picked tracks first (sortOrder,
 * then id), then least-recently-picked tracks from the persisted reports.
 * @param {TreeTaskNode[]} tracks
 * @param {PreviousReport[]} previous
 * @returns {TreeTaskNode[]}
 */
function rotationOrder(tracks, previous) {
  /** @type {Map<string, string>} */
  const lastPicked = new Map()
  for (const report of previous) {
    for (const item of report.items) {
      const current = lastPicked.get(item.trackId)
      if (current === undefined || report.date > current) lastPicked.set(item.trackId, report.date)
    }
  }
  return tracks.slice().sort((left, right) => {
    const leftDate = lastPicked.get(left.id)
    const rightDate = lastPicked.get(right.id)
    if (leftDate === undefined && rightDate !== undefined) return -1
    if (leftDate !== undefined && rightDate === undefined) return 1
    if (leftDate !== undefined && rightDate !== undefined && leftDate !== rightDate) return leftDate < rightDate ? -1 : 1
    return baseOrder(left, right)
  })
}

/**
 * One candidate tier: its tracks in pick order plus a shared round-robin cursor.
 * @typedef {{ tracks: TreeTaskNode[], cursor: number }} PickTier
 */

/**
 * Pick one task from the first chain tier that still has a ready leaf, round-robin
 * across that tier's tracks and consuming each track's ordered leaf list.
 * @param {BriefRole} itemRole
 * @param {{ core: PickTier, rotation: PickTier, blocked: PickTier }} tiers
 * @param {Map<string, TreeTaskNode[]>} queues
 * @returns {{ track: TreeTaskNode, task: TreeTaskNode } | null}
 */
function pickForRole(itemRole, tiers, queues) {
  for (const tierName of ROLE_CHAINS[itemRole]) {
    const tier = tiers[tierName]
    if (tier.tracks.length === 0) continue
    for (let attempt = 0; attempt < tier.tracks.length; attempt += 1) {
      const index = (tier.cursor + attempt) % tier.tracks.length
      const track = tier.tracks[index]
      const task = /** @type {TreeTaskNode[]} */ (queues.get(track.id)).shift()
      if (task === undefined) continue
      tier.cursor = (index + 1) % tier.tracks.length
      return { track, task }
    }
  }
  return null
}

/**
 * @param {BriefRole} itemRole
 * @param {BriefDayKind} dayKind
 * @param {number} windows
 * @returns {string}
 */
function noteForWindow(itemRole, dayKind, windows) {
  return `no candidate for ${itemRole} window ${windows} (${dayKind})`
}

/**
 * Compute the deterministic daily brief from the tree, the day's plan blocks,
 * and the previously persisted reports.
 * @param {{ date: string, generatedAt: string, source?: 'auto' | 'manual',
 * dayKind?: BriefDayKind, blocks?: BriefBlock[], tree?: TreeTaskNode[], previous?: PreviousReport[] }} input
 * @returns {DailyReport}
 */
export function computeDailyBrief({
  date,
  generatedAt,
  source = 'auto',
  dayKind = 'unknown',
  blocks = [],
  tree = [],
  previous = [],
}) {
  const slots = buildWindows(blocks, dayKind)
  const notes = []
  if (slots.length === 0) {
    notes.push(`no plan blocks; no template for ${dayKind} day kind`)
  } else if (blocks.length === 0) {
    notes.push(`no plan blocks; ${dayKind} template used`)
  }
  const brief = computeBrief(tree)
  const laneById = new Map(brief.lanes.map(lane => [lane.id, lane]))
  const tracks = tree.filter(node => node.kind === 'track').slice().sort(baseOrder)
  /** @type {Map<string, string>} */
  const depStatus = new Map()
  for (const node of flattenTree(tree)) {
    if (node.kind === 'node' && node.ref.startsWith('node:')) depStatus.set(node.ref.slice(5), node.status)
  }
  /** @type {Map<string, TreeTaskNode[]>} */
  const queues = new Map()
  for (const track of tracks) {
    const ready = flattenTree(track.children)
      .filter(task => isReadyLeaf(task, depStatus))
      .sort((left, right) => compareRefs(left.ref, right.ref))
    const next = /** @type {import('./tree.js').BriefLane} */ (laneById.get(track.id)).next
    /** @type {TreeTaskNode[]} */
    const ordered = next === null ? [] : ready.filter(task => task.id === next.id)
    for (const task of ready) if (!ordered.includes(task)) ordered.push(task)
    queues.set(track.id, ordered)
    if (ordered.length === 0) notes.push(`no ready leaves for ${track.title}`)
  }

  const windowCount = slots.length
  const coreBudget = windowCount === 0 ? 0 : Math.max(1, Math.round(0.7 * windowCount))
  const rotationBudget = windowCount === 0 ? 0 : Math.max(0, Math.round(0.2 * windowCount))
  const definitionBudget = Math.max(0, windowCount - coreBudget - rotationBudget)
  let coreLeft = coreBudget
  let definitionLeft = definitionBudget

  const roleOf = trackRole
  /** @type {{ core: PickTier, rotation: PickTier, blocked: PickTier }} */
  const tiers = {
    core: { tracks: tracks.filter(track => roleOf(track) === 'core'), cursor: 0 },
    rotation: { tracks: rotationOrder(tracks.filter(track => roleOf(track) === 'rotation'), previous), cursor: 0 },
    blocked: { tracks: tracks.filter(track => roleOf(track) === 'blocked'), cursor: 0 },
  }

  /** @type {Map<string, number>} */
  const picks = new Map()
  /** @type {BriefItem[]} */
  const items = []
  /** @type {number[]} */
  const unfilled = []
  slots.forEach((window, index) => {
    let itemRole = 'rotation'
    if (window.kind === 'core' && coreLeft > 0) {
      itemRole = 'core'
      coreLeft -= 1
    } else if (window.kind === 'definition' && definitionLeft > 0) {
      itemRole = 'definition'
      definitionLeft -= 1
    }
    const picked = pickForRole(/** @type {BriefRole} */ (itemRole), tiers, queues)
    if (picked === null) {
      unfilled.push(index)
      notes.push(noteForWindow(/** @type {BriefRole} */ (itemRole), dayKind, index))
      return
    }
    picks.set(picked.track.id, (picks.get(picked.track.id) ?? 0) + 1)
    items.push({
      slot: window.slot,
      startTime: window.startTime,
      endTime: window.endTime,
      minutes: window.minutes,
      blockId: window.blockId,
      taskId: picked.task.id,
      ref: picked.task.ref,
      title: picked.task.title,
      trackId: picked.track.id,
      trackName: picked.track.title,
      role: /** @type {BriefRole} */ (itemRole),
    })
  })

  const summary = tracks.map((track) => {
    const lane = /** @type {import('./tree.js').BriefLane} */ (laneById.get(track.id))
    return {
      trackId: track.id,
      ref: track.ref,
      name: track.title,
      state: track.state,
      role: trackRole(track),
      picks: picks.get(track.id) ?? 0,
      frontier: lane.frontier,
      next: lane.next,
    }
  })
  return { date, generatedAt, source, dayKind, slots, items, tracks: summary, unfilled, notes }
}

/**
 * @param {BriefWindow} window
 * @returns {string}
 */
function windowTime(window) {
  return window.startTime === '' || window.endTime === '' ? '--:--' : `${window.startTime}-${window.endTime}`
}

/**
 * Append the `## 今日窗口` section to a rendered context document, keeping the
 * caller's character limit; a line that no longer fits marks the document
 * truncated.
 * @param {{ markdown: string, chars: number, truncated: boolean }} document
 * @param {DailyReport} report
 * @param {number} limit
 * @returns {{ markdown: string, chars: number, truncated: boolean }}
 */
export function appendBriefSection(document, report, limit) {
  const section = ['', `## 今日窗口 · ${report.date}`]
  let itemIndex = 0
  report.slots.forEach((window, index) => {
    const time = windowTime(window)
    if (report.unfilled.includes(index)) {
      section.push(`- ${time} 未填`)
      return
    }
    const item = report.items[itemIndex]
    itemIndex += 1
    if (item === undefined) {
      section.push(`- ${time} 未填`)
      return
    }
    const detail = [item.trackName, item.ref, item.title].filter(part => part !== '').join(' ')
    section.push(`- ${time} ${item.role}：${detail}`)
  })
  let markdown = document.markdown
  let truncated = document.truncated
  for (const line of section) {
    if (markdown.length + line.length + 1 > limit) {
      truncated = true
      break
    }
    markdown += `${line}\n`
  }
  return { markdown, chars: markdown.length, truncated }
}
