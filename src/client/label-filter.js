// Encoded labels behind the single filter row of the Gantt page.
//
// The row mixes two kinds of filter in one multi-select: predefined labels
// (the status/perspective views the page can derive itself) and the artificial
// tags users put on tasks. Both are stored as plain strings so page-state can
// persist them and the page can compare them without keeping objects around:
//
//   preset:<unfinished|active|frontier|next|today|done|inspiration>
//   tag:<trimmed tag name>
//
// An empty selection means "show everything"; several labels are OR-ed
// together. This module owns the encoding, the decoding and the defensive
// cleaning of values that come back from localStorage.

/** The status/perspective labels the page offers; "all" is the empty selection.
 * `inspiration` keeps every task whose inspiration field is non-empty, so the
 * captured ideas form one pool regardless of branch. */
export const PRESET_LABELS = ['unfinished', 'active', 'frontier', 'next', 'today', 'done', 'inspiration']

/** The most artificial tags one stored selection may carry. */
export const MAX_TAGS = 20

/** The longest tag a stored selection may carry, after trimming. */
export const MAX_TAG_LENGTH = 40

/** The most labels a stored selection may carry, presets plus tags. */
export const MAX_LABELS = PRESET_LABELS.length + MAX_TAGS

const PRESET_PREFIX = 'preset:'
const TAG_PREFIX = 'tag:'

/**
 * One decoded label.
 * @typedef {{ kind: 'preset', preset: string } | { kind: 'tag', tag: string }} ParsedLabel
 */

/**
 * The stored form of a predefined label.
 * @param {string} preset one of PRESET_LABELS
 * @returns {string}
 */
export function presetLabel(preset) {
  return `${PRESET_PREFIX}${preset}`
}

/**
 * The stored form of an artificial tag label, with the tag trimmed.
 * @param {string} name tag name
 * @returns {string}
 */
export function tagLabel(name) {
  return `${TAG_PREFIX}${name.trim()}`
}

/**
 * Decode a stored label into its kind and value, or null when it is not a
 * label this client understands (unknown preset, blank or over-long tag,
 * another prefix, a non-string).
 * @param {any} value
 * @returns {ParsedLabel | null}
 */
export function parseLabel(value) {
  if (typeof value !== 'string') return null
  if (value.startsWith(PRESET_PREFIX)) {
    const preset = value.slice(PRESET_PREFIX.length)
    return PRESET_LABELS.includes(preset) ? { kind: 'preset', preset } : null
  }
  if (value.startsWith(TAG_PREFIX)) {
    const tag = value.slice(TAG_PREFIX.length).trim()
    if (tag.length === 0 || tag.length > MAX_TAG_LENGTH) return null
    return { kind: 'tag', tag }
  }
  return null
}

/**
 * The labels that can still be trusted: recognized, deduplicated in
 * first-seen order, at most 20 tags and a bounded total count so a hand-edited
 * record cannot ask for an unbounded filter.
 * @param {any} value
 * @returns {string[]}
 */
export function sanitizeLabels(value) {
  if (!Array.isArray(value)) return []
  /** @type {string[]} */
  const labels = []
  const seen = new Set()
  let tags = 0
  for (const item of value) {
    const parsed = parseLabel(item)
    if (parsed === null) continue
    const label = parsed.kind === 'preset' ? presetLabel(parsed.preset) : tagLabel(parsed.tag)
    if (seen.has(label)) continue
    if (parsed.kind === 'tag') {
      if (tags === MAX_TAGS) continue
      tags += 1
    }
    seen.add(label)
    labels.push(label)
    if (labels.length === MAX_LABELS) break
  }
  return labels
}
