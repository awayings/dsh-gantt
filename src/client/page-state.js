// Remember how the Gantt page looked across visits, not just across reloads.
//
// The Gantt page is a global main panel: the shell creates it from this plugin's
// entry and unmounts it whenever the entry is replaced (a client rebuild or a
// full browser reload). DSH keeps no per-page view state, so without this module
// the page comes back at the default tree depth, label filter and scroll offset
// every time. `panel-session.js` restores which page was on screen; this module
// restores its view: depth, selected labels, folded tasks, scroll offsets,
// timeline window, highlighted task, work panel and work mode.
//
// The record lives in localStorage because it must survive a full browser
// reload and a tab restore, not only a bundle swap. Storage is shared with the
// rest of the app, can be edited by hand and can be disabled (private mode), so
// reads are deliberately tolerant: unknown versions, malformed JSON and
// out-of-range values fall back to the defaults instead of breaking the page.

import { PRESET_LABELS, presetLabel, sanitizeLabels, tagLabel } from './label-filter.js'

/** localStorage key carrying the last view state of the Gantt page. */
export const PAGE_STATE_KEY = 'gantt.pageState'

/** Schema version of the stored record; bump it when the shape changes. */
export const PAGE_STATE_VERSION = 4

/** localStorage key an older client used for the standalone work-mode switch. */
export const LEGACY_WORK_MODE_KEY = 'gantt.workMode'

/** The tree depths the page can show: every level, two levels, one level. */
export const LEVELS = [99, 2, 1]

/** The timeline scales the page can show. */
export const SCALES = ['week', 'month']

/** The right-rail work-panel tabs the page can show. */
export const PANEL_TABS = ['task', 'skills', 'team']

// The view a record falls back to when it carries no usable value for a field;
// also the view a migrated legacy record starts from.
const DEFAULT_LEVEL = 99
const DEFAULT_SCALE = 'week'
const DEFAULT_PANEL_TAB = 'task'

/** The most collapsed task ids a stored record may restore. */
const MAX_COLLAPSED_IDS = 2000

/** The longest task id a stored record may carry. */
const MAX_ID_LENGTH = 200

/** The largest scroll offset a stored record may restore. */
const MAX_SCROLL = 10_000_000

/** The exact shape of a timeline anchor day. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * One persisted view of the Gantt page.
 * @typedef {object} PageState
 * @property {number} level tree depth, one of LEVELS
 * @property {string[]} labels encoded label filter, see label-filter.js; empty
 * means no filter
 * @property {string[]} collapsed ids of the tasks whose children are folded
 * @property {number} scrollTop vertical scroll offset in pixels
 * @property {number} scrollLeft horizontal scroll offset in pixels
 * @property {string} scale timeline scale, one of SCALES
 * @property {string | null} anchor first day of the timeline window, YYYY-MM-DD
 * @property {string | null} selectedId id of the highlighted task
 * @property {string | null} panelTaskId id of the task the work panel shows
 * @property {string} panelTab work-panel tab, one of PANEL_TABS
 * @property {boolean} workMode whether the page drives the workbench
 */

/**
 * A rounded, usable scroll offset; anything else reads as "at the start".
 * @param {any} value
 * @returns {number}
 */
function sanitizeScroll(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.min(Math.round(value), MAX_SCROLL)
}

/**
 * A usable task id, or null when the value is not a short non-empty string.
 * @param {any} value
 * @returns {string | null}
 */
function sanitizeId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) return null
  return value
}

/**
 * A calendar day in the one format the timeline accepts, or null. The UTC
 * round-trip rejects dates such as 2026-02-30 that the format cannot.
 * @param {any} value
 * @returns {string | null}
 */
function sanitizeAnchor(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== value) return null
  return value
}

/**
 * The view a record starts from when it carries no usable value; also the view
 * a migrated legacy record starts from.
 * @param {boolean} [workMode]
 * @returns {PageState}
 */
function defaultPageState(workMode = false) {
  return {
    level: DEFAULT_LEVEL,
    labels: [],
    collapsed: [],
    scrollTop: 0,
    scrollLeft: 0,
    scale: DEFAULT_SCALE,
    anchor: null,
    selectedId: null,
    panelTaskId: null,
    panelTab: DEFAULT_PANEL_TAB,
    workMode,
  }
}

/**
 * The timeline window, highlighted task, work panel and work mode of a stored
 * value, normalized. Every record version stores them under the same names.
 * @param {any} raw
 * @returns {Pick<PageState, 'scale' | 'anchor' | 'selectedId' | 'panelTaskId' | 'panelTab' | 'workMode'>}
 */
function normalizeExtras(raw) {
  return {
    scale: SCALES.includes(raw.scale) ? raw.scale : DEFAULT_SCALE,
    anchor: sanitizeAnchor(raw.anchor),
    selectedId: sanitizeId(raw.selectedId),
    panelTaskId: sanitizeId(raw.panelTaskId),
    panelTab: PANEL_TABS.includes(raw.panelTab) ? raw.panelTab : DEFAULT_PANEL_TAB,
    workMode: raw.workMode === true,
  }
}

/**
 * The depth, labels, folded ids and scroll offsets of a stored value, normalized.
 * Every record version stores these fields under the same names, so the
 * readers share this normalization.
 * @param {any} raw
 * @returns {Pick<PageState, 'level' | 'labels' | 'collapsed' | 'scrollTop' | 'scrollLeft'>}
 */
function normalizeView(raw) {
  return {
    level: LEVELS.includes(raw.level) ? raw.level : DEFAULT_LEVEL,
    labels: sanitizeLabels(raw.labels),
    collapsed: sanitizeCollapsed(raw.collapsed),
    scrollTop: sanitizeScroll(raw.scrollTop),
    scrollLeft: sanitizeScroll(raw.scrollLeft),
  }
}

/**
 * The collapsed task ids that can still be trusted: non-empty short strings,
 * deduplicated in first-seen order and capped so a corrupted record cannot make
 * the page fold thousands of branches at once.
 * @param {any} value
 * @returns {string[]}
 */
function sanitizeCollapsed(value) {
  if (!Array.isArray(value)) return []
  /** @type {string[]} */
  const collapsed = []
  const seen = new Set()
  for (const id of value) {
    if (sanitizeId(id) === null) continue
    if (seen.has(id)) continue
    seen.add(id)
    collapsed.push(id)
    if (collapsed.length === MAX_COLLAPSED_IDS) break
  }
  return collapsed
}

/**
 * Normalize an untrusted stored value into a page state, or null when it is not
 * a record this version wrote.
 * @param {any} raw
 * @returns {PageState | null}
 */
export function sanitizePageState(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.v !== PAGE_STATE_VERSION) return null
  return {
    ...normalizeView(raw),
    ...normalizeExtras(raw),
  }
}

/**
 * The standalone work-mode switch an older client wrote, or false when storage
 * is absent or refuses the read. Called inside `readPageState`'s guard.
 * @returns {boolean}
 */
function readLegacyWorkMode() {
  return globalThis.localStorage.getItem(LEGACY_WORK_MODE_KEY) === '1'
}

/**
 * Carry a pre-v4 record forward: v1-v3 store the view fields under the same
 * names, so those transfer, and `legacyLabels` converts whatever filter fields
 * the record has into the label selection. Version 1 has no extras yet;
 * `normalizeExtras` seeds them from their defaults, which equals the v1 shape.
 * @param {any} raw a parsed version 1-3 record
 * @returns {PageState}
 */
function migrateLegacyView(raw) {
  return {
    ...defaultPageState(),
    ...normalizeView(raw),
    labels: legacyLabels(raw),
    ...normalizeExtras(raw),
  }
}

/**
 * The labels a pre-v4 record asks for: its single status filter (unless it is
 * "all") becomes one predefined label, and a tag filter becomes tag labels.
 * Versions up to 3 AND-ed the two, but the unified row is a union; migrating
 * what the user had selected is the closest honest reading.
 * @param {any} raw a parsed pre-v4 record
 * @returns {string[]}
 */
function legacyLabels(raw) {
  const labels = []
  if (PRESET_LABELS.includes(raw.filter)) labels.push(presetLabel(raw.filter))
  if (Array.isArray(raw.tagFilter)) {
    for (const tag of raw.tagFilter) {
      if (typeof tag === 'string') labels.push(tagLabel(tag))
    }
  }
  return sanitizeLabels(labels)
}


/**
 * The page state left by a previous visit, or null when there is no usable one
 * (first visit, storage disabled, or a corrupted/unknown-version record).
 * @returns {PageState | null}
 */
export function readPageState() {
  try {
    const raw = globalThis.localStorage.getItem(PAGE_STATE_KEY)
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.v === 1) {
        return { ...migrateLegacyView(parsed), workMode: readLegacyWorkMode() }
      }
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.v === 2) {
        return migrateLegacyView(parsed)
      }
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.v === 3) {
        return migrateLegacyView(parsed)
      }
      const state = sanitizePageState(parsed)
      if (state !== null) return state
    }
    // Work mode was its own switch before version 2; an install with no usable
    // record still keeps the switch it had.
    return readLegacyWorkMode() ? defaultPageState(true) : null
  } catch {
    // Missing or refusing storage, and malformed JSON, all read as "no state".
    return null
  }
}

/**
 * Persist the current page state for the next visit. Storage failures are
 * swallowed: the page still works, it just will not remember.
 * @param {PageState} state
 * @returns {void}
 */
export function writePageState(state) {
  try {
    globalThis.localStorage.setItem(PAGE_STATE_KEY, JSON.stringify({
      v: PAGE_STATE_VERSION,
      level: state.level,
      labels: state.labels,
      collapsed: state.collapsed,
      scrollTop: state.scrollTop,
      scrollLeft: state.scrollLeft,
      scale: state.scale,
      anchor: state.anchor,
      selectedId: state.selectedId,
      panelTaskId: state.panelTaskId,
      panelTab: state.panelTab,
      workMode: state.workMode,
    }))
    // The standalone switch is folded into this record now; clearing it in the
    // same attempt keeps the migration one-shot instead of leaving a stale key
    // that a later read could resurrect.
    globalThis.localStorage.removeItem(LEGACY_WORK_MODE_KEY)
  } catch {
    // Private-mode browsers refuse reads and writes; remembering is best effort.
  }
}
