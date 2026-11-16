// Dotted tracker ids, calendar-day arithmetic, and the slot vocabulary shared by
// the tree helpers, the store, and the importer.

/** @typedef {'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled'} TaskStatus */
/** @typedef {'track' | 'node' | 'task'} TaskKind */
/** Allowed `tasks.kind` values. @type {TaskKind[]} */
export const TASK_KINDS = ['track', 'node', 'task']
const DAY_MS = 86_400_000

/**
 * @param {number} value
 * @returns {string}
 */
function pad(value) {
  return String(value).padStart(2, '0')
}

/**
 * @param {string} iso
 * @returns {number}
 */
export function isoToDay(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/**
 * @param {number} day
 * @returns {string}
 */
export function dayToIso(day) {
  const date = new Date(day)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * @param {string} iso
 * @param {number} days
 * @returns {string}
 */
export function addDays(iso, days) {
  return dayToIso(isoToDay(iso) + days * DAY_MS)
}

/**
 * Compare two dotted tracker ids (`1.8.4`, `1.9.3`) segment by segment as numbers.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareDotIds(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * @param {string} ref
 * @returns {string}
 */
export function dotIdOf(ref) {
  const separator = ref.indexOf(':')
  return separator === -1 ? ref : ref.slice(separator + 1)
}

/**
 * Order task refs by their dotted id; manual tasks (empty ref) sort last.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareRefs(left, right) {
  const leftId = dotIdOf(left)
  const rightId = dotIdOf(right)
  if (leftId === '') return rightId === '' ? 0 : 1
  if (rightId === '') return -1
  return compareDotIds(leftId, rightId)
}

/**
 * The slot a block belongs to, derived from its start clock time only.
 * @param {unknown} start
 * @returns {'morning' | 'daytime' | 'evening' | 'other'}
 */
export function slotForStart(start) {
  if (typeof start !== 'string' || start === '') return 'other'
  if (start < '10:00') return 'morning'
  if (start < '19:30') return 'daytime'
  return 'evening'
}
