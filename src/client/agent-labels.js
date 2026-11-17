// Display labels for the agent registry: the operator and completer names plus
// the completion report shown by the workbench task view and the task dialog.
// The registry is fetched once per page; a failed lookup is not cached, so a
// later refresh retries while the views keep the raw agent id visible.

import { requestJson } from './hooks.js'

/** @typedef {Map<string, string>} AgentNames */

/** @type {Promise<AgentNames> | null} */
let pending = null

/** Drop the cached agent list so the next lookup refetches. @returns {void} */
export function resetAgentNames() {
  pending = null
}

/**
 * Turn one agent list payload into an id → display-name map. A missing or blank
 * name falls back to the id, and malformed entries are skipped.
 * @param {unknown} body
 * @returns {AgentNames}
 */
function namesFrom(body) {
  const payload = /** @type {{ agents?: unknown }} */ (body)
  const agents = Array.isArray(payload?.agents) ? payload.agents : []
  const names = new Map()
  for (const agent of agents) {
    const row = /** @type {{ id?: unknown, name?: unknown }} */ (agent)
    const id = typeof row?.id === 'string' ? row.id : ''
    if (id === '') continue
    names.set(id, typeof row.name === 'string' && row.name !== '' ? row.name : id)
  }
  return names
}

/**
 * Read and parse the registry once; a failed read resolves to an empty map and
 * leaves the cache empty so the next call retries.
 * @returns {Promise<AgentNames>}
 */
async function fetchNames() {
  try {
    return namesFrom(await requestJson('api/gantt/agents'))
  } catch {
    pending = null
    return new Map()
  }
}

/**
 * The registered agents' display names, fetched once per page. Concurrent
 * callers share the in-flight request; a failure is not cached.
 * @returns {Promise<AgentNames>}
 */
export function loadAgentNames() {
  if (pending === null) pending = fetchNames()
  return pending
}

/**
 * The display name for an agent id, or the localized "unassigned" label for an
 * empty id. An unknown id (including one from a failed lookup) stays visible.
 * @param {AgentNames | null} names
 * @param {string} id
 * @param {(key: string) => string} t
 * @returns {string}
 */
export function agentLabel(names, id, t) {
  if (typeof id !== 'string' || id === '') return t('agent.unassigned')
  return names?.get(id) ?? id
}

/**
 * The full completion report, or the localized "no report" label.
 * @param {string} report
 * @param {(key: string) => string} t
 * @returns {string}
 */
export function reportText(report, t) {
  return typeof report === 'string' && report !== '' ? report : t('agent.noReport')
}

/**
 * The first non-blank line of a text, trimmed and cut to `max` code points.
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function reportPreview(text, max = 160) {
  if (typeof text !== 'string') return ''
  const line = text.split('\n').map(value => value.trim()).find(value => value !== '') ?? ''
  const points = [...line]
  return points.length <= max ? line : `${points.slice(0, max).join('')}…`
}
