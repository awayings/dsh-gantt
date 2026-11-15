// The daily report: deterministic picks from the tree, persisted-row parsing, and
// the context document's window section.

import { compareRefs, computeBrief, flattenTree } from '../tree.js'
import { buildWindows, trackRole } from './windows.js'

/** @typedef {import('../tree.js').BriefEntry} BriefEntry */
/** @typedef {import('../tree.js').BriefLane} BriefLane */
/** @typedef {import('../tree.js').TreeTaskNode} TreeTaskNode */
/** @typedef {import('./windows.js').BriefBlock} BriefBlock */
/** @typedef {import('./windows.js').BriefDayKind} BriefDayKind */
/** @typedef {import('./windows.js').BriefRole} BriefRole */
/** @typedef {import('./windows.js').BriefSlot} BriefSlot */
/** @typedef {import('./windows.js').BriefWindow} BriefWindow */
/** @typedef {import('./windows.js').TierRole} TierRole */

/** The part of a previously persisted report rotation fairness reads.
 * @typedef {{ date: string, items: Array<{ trackId: string }> }} PreviousReport */

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

/** Item-role → track tiers, first tier that has a candidate wins. @type {Record<BriefRole, TierRole[]>} */
const ROLE_CHAINS = {
  core: ['core', 'rotation', 'blocked'],
  rotation: ['rotation', 'core', 'blocked'],
  definition: ['rotation', 'core', 'blocked'],
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
    const next = /** @type {import('../tree.js').BriefLane} */ (laneById.get(track.id)).next
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
    const lane = /** @type {import('../tree.js').BriefLane} */ (laneById.get(track.id))
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
