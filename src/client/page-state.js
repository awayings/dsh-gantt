// Remember how the Gantt page looked across visits, not just across reloads.
//
// The Gantt page is a global main panel: the shell creates it from this plugin's
// entry and unmounts it whenever the entry is replaced (a client rebuild or a
// full browser reload). DSH keeps no per-page view state, so without this module
// the page comes back at the default tree depth, status filter and scroll offset
// every time. `panel-session.js` restores which page was on screen; this module
// restores its view: depth, filter, folded tasks and scroll offsets.
//
// The record lives in localStorage because it must survive a full browser
// reload and a tab restore, not only a bundle swap. Storage is shared with the
// rest of the app, can be edited by hand and can be disabled (private mode), so
// reads are deliberately tolerant: unknown versions, malformed JSON and
// out-of-range values fall back to the defaults instead of breaking the page.

/** localStorage key carrying the last view state of the Gantt page. */
export const PAGE_STATE_KEY = 'gantt.pageState'

/** Schema version of the stored record; bump it when the shape changes. */
export const PAGE_STATE_VERSION = 1

/** The status filters the page offers. */
export const FILTERS = ['all', 'unfinished', 'active', 'frontier', 'next', 'today', 'done']

/** The tree depths the page can show: every level, two levels, one level. */
export const LEVELS = [99, 2, 1]

/** The most collapsed task ids a stored record may restore. */
const MAX_COLLAPSED_IDS = 2000

/** The longest task id a stored record may carry. */
const MAX_ID_LENGTH = 200

/** The largest scroll offset a stored record may restore. */
const MAX_SCROLL = 10_000_000

/**
 * One persisted view of the Gantt page.
 * @typedef {object} PageState
 * @property {number} level tree depth, one of LEVELS
 * @property {string} filter status filter, one of FILTERS
 * @property {string[]} collapsed ids of the tasks whose children are folded
 * @property {number} scrollTop vertical scroll offset in pixels
 * @property {number} scrollLeft horizontal scroll offset in pixels
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
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) continue
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
    level: LEVELS.includes(raw.level) ? raw.level : 99,
    filter: FILTERS.includes(raw.filter) ? raw.filter : 'all',
    collapsed: sanitizeCollapsed(raw.collapsed),
    scrollTop: sanitizeScroll(raw.scrollTop),
    scrollLeft: sanitizeScroll(raw.scrollLeft),
  }
}

/**
 * The page state left by a previous visit, or null when there is no usable one
 * (first visit, storage disabled, or a corrupted/older record).
 * @returns {PageState | null}
 */
export function readPageState() {
  try {
    const raw = globalThis.localStorage.getItem(PAGE_STATE_KEY)
    return typeof raw === 'string' ? sanitizePageState(JSON.parse(raw)) : null
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
      filter: state.filter,
      collapsed: state.collapsed,
      scrollTop: state.scrollTop,
      scrollLeft: state.scrollLeft,
    }))
  } catch {
    // Private-mode browsers refuse reads and writes; remembering is best effort.
  }
}
