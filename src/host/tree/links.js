// The `links` JSON column vocabulary and its validation.

/** @typedef {'memory' | 'file' | 'url' | 'task' | 'note'} LinkType */

/**
 * A validated task link.
 * @typedef {object} TaskLink
 * @property {LinkType} type
 * @property {string} ref
 * @property {string} [label]
 */

/** Allowed `TaskLink.type` values. @type {LinkType[]} */
export const LINK_TYPES = ['memory', 'file', 'url', 'task', 'note']
/** Maximum number of links on one task. */
export const MAX_LINKS = 20
const MAX_LINK_REF = 500
const MAX_LINK_LABEL = 120

/**
 * Parse the stored JSON links column, degrading corrupt or legacy values to `[]`.
 * @param {unknown} raw
 * @returns {TaskLink[]}
 */
export function parseLinksJson(raw) {
  if (typeof raw !== 'string' || raw === '') return []
  try {
    return parseLinks(JSON.parse(raw)).links
  } catch {
    return []
  }
}

/**
 * Validate a `links` input array. Returns the normalized links or the first
 * validation error; it never throws so the store can map the error to `400`.
 * @param {unknown} value
 * @returns {{ links: TaskLink[], error: string | null }}
 */
export function parseLinks(value) {
  if (value === undefined || value === null) return { links: [], error: null }
  if (!Array.isArray(value)) return { links: [], error: 'links must be an array' }
  if (value.length > MAX_LINKS) return { links: [], error: `links must have at most ${MAX_LINKS} entries` }
  /** @type {TaskLink[]} */
  const links = []
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return { links: [], error: `links[${index}] must be an object` }
    }
    const record = /** @type {Record<string, unknown>} */ (item)
    const type = LINK_TYPES.find(candidate => candidate === record.type)
    if (type === undefined) {
      return { links: [], error: `links[${index}].type must be one of ${LINK_TYPES.join(', ')}` }
    }
    if (typeof record.ref !== 'string') return { links: [], error: `links[${index}].ref must be a string` }
    const ref = record.ref.trim()
    if (ref === '') return { links: [], error: `links[${index}].ref is required` }
    if ([...ref].length > MAX_LINK_REF) {
      return { links: [], error: `links[${index}].ref must be at most ${MAX_LINK_REF} characters` }
    }
    if (record.label !== undefined && record.label !== null && typeof record.label !== 'string') {
      return { links: [], error: `links[${index}].label must be a string` }
    }
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    if ([...label].length > MAX_LINK_LABEL) {
      return { links: [], error: `links[${index}].label must be at most ${MAX_LINK_LABEL} characters` }
    }
    links.push(label === '' ? { type, ref } : { type, ref, label })
  }
  return { links, error: null }
}
