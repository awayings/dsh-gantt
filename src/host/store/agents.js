// Agent-row validation and the SQL the store runs on the `agents` table. An
// agent is an external operator: a human or an AI coding tool that registers
// itself, reads task context, and reports completion back.

import { GanttError } from '../errors.js'

/** Allowed `agents.type` values. @type {Array<'human' | 'ai-agent'>} */
export const AGENT_TYPES = ['human', 'ai-agent']
export const MAX_AGENT_NAME = 100
export const MAX_AGENT_TEXT = 2000

const AGENT_COLUMNS = 'id, name, type, role, description, details, endpoint, created_at AS createdAt, updated_at AS updatedAt'
export const AGENT_SELECT = `SELECT ${AGENT_COLUMNS} FROM agents`
export const INSERT_AGENT = 'INSERT INTO agents (id, name, type, role, description, details, endpoint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
export const UPDATE_AGENT = 'UPDATE agents SET name = ?, type = ?, role = ?, description = ?, details = ?, endpoint = ?, updated_at = ? WHERE id = ?'

/** One stored agent, camel-cased for the API. @typedef {{ id: string, name: string,
 * type: 'human' | 'ai-agent', role: string, description: string, details: string,
 * endpoint: string, createdAt: string, updatedAt: string }} AgentRow */

/** Raw registration input accepted by the store and the routes. @typedef {{ id?: unknown,
 * name?: unknown, type?: unknown, role?: unknown, description?: unknown, details?: unknown,
 * endpoint?: unknown }} AgentInput */

/** The normalized fields of one agent. @typedef {{ name: string, type: 'human' | 'ai-agent',
 * role: string, description: string, details: string, endpoint: string }} AgentFields */

/** Filters accepted by listAgents(). @typedef {{ type?: unknown, role?: unknown, q?: unknown,
 * limit?: unknown }} AgentFilter */

/** A normalized list query. @typedef {{ type: string, role: string, q: string, limit: number }} AgentQuery */

/**
 * One text field: undefined/null becomes ''; anything else must be a string
 * within the agent text cap.
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function textField(value, field) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new GanttError(`${field} must be a string`)
  const text = value.trim()
  if ([...text].length > MAX_AGENT_TEXT) throw new GanttError(`${field} must be at most ${MAX_AGENT_TEXT} characters`)
  return text
}

/**
 * The registration name, shared by insert and update: required, trimmed,
 * whitespace-collapsed, at most {@link MAX_AGENT_NAME} characters.
 * @param {AgentInput} input
 * @returns {string}
 */
export function normalizeAgentName(input) {
  if (typeof input.name !== 'string') throw new GanttError('name is required')
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (name === '') throw new GanttError('name is required')
  if ([...name].length > MAX_AGENT_NAME) throw new GanttError(`name must be at most ${MAX_AGENT_NAME} characters`)
  return name
}

/**
 * The registration type: the `ai-agent` default when the call omits it, else
 * one of {@link AGENT_TYPES}.
 * @param {unknown} value
 * @returns {'human' | 'ai-agent'}
 */
function normalizeType(value) {
  if (value === undefined || value === null) return 'ai-agent'
  const type = AGENT_TYPES.find(candidate => candidate === value)
  if (type === undefined) throw new GanttError(`type must be one of ${AGENT_TYPES.join(', ')}`)
  return type
}

/**
 * Validate and normalize one agent registration. The name is required and
 * unique within the store; the type defaults to `ai-agent`.
 * @param {AgentInput} [input]
 * @returns {AgentFields}
 */
export function normalizeAgentFields(input = {}) {
  return {
    name: normalizeAgentName(input),
    type: normalizeType(input.type),
    role: textField(input.role, 'role'),
    description: textField(input.description, 'description'),
    details: textField(input.details, 'details'),
    endpoint: textField(input.endpoint, 'endpoint'),
  }
}

/**
 * The fields of one agent re-registration: a field the call omits (undefined
 * or null) keeps its stored value, so an identity-only re-register — an
 * installer's evidence call passes just name/type/role/description — cannot
 * wipe the dispatch contract (details, endpoint) an earlier fuller
 * registration recorded. Providing a field, empty string included, still
 * overwrites, so intentionally clearing a field keeps working.
 * @param {AgentRow} existing
 * @param {AgentInput} [input]
 * @returns {AgentFields}
 */
export function mergeAgentFields(existing, input = {}) {
  /**
   * One stored-text field: the fallback when the call omits it, validated and
   * trimmed when it provides one.
   * @param {unknown} value @param {string} field @param {string} fallback
   * @returns {string}
   */
  const pick = (value, field, fallback) => (value === undefined || value === null ? fallback : textField(value, field))
  return {
    name: normalizeAgentName(input),
    type: input.type === undefined || input.type === null ? existing.type : normalizeType(input.type),
    role: pick(input.role, 'role', existing.role),
    description: pick(input.description, 'description', existing.description),
    details: pick(input.details, 'details', existing.details),
    endpoint: pick(input.endpoint, 'endpoint', existing.endpoint),
  }
}

/**
 * Validate a list query. `limit` defaults to 20 and is capped at 100; blank
 * optional strings mean "no filter".
 * @param {AgentFilter} [input]
 * @returns {AgentQuery}
 */
export function normalizeAgentFilter(input = {}) {
  const type = input.type === undefined || input.type === null || input.type === '' ? '' : input.type
  if (type !== '' && !AGENT_TYPES.some(candidate => candidate === type)) throw new GanttError(`type must be one of ${AGENT_TYPES.join(', ')}`)
  const role = optionalText(input.role, 'role')
  const q = optionalText(input.q, 'q')
  let limit = 20
  if (input.limit !== undefined && input.limit !== null && input.limit !== '') {
    const candidate = typeof input.limit === 'string' ? Number(input.limit) : input.limit
    if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate < 1 || candidate > 100) {
      throw new GanttError('limit must be an integer from 1 to 100')
    }
    limit = candidate
  }
  return { type: /** @type {string} */ (type), role, q, limit }
}

/**
 * A blank-tolerant optional string; non-strings are rejected.
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function optionalText(value, field) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new GanttError(`${field} must be a string`)
  return value.trim()
}

/**
 * The display-name lookup over registered agents: operator and completer ids
 * render as names wherever a task's context is shown.
 * @param {AgentRow[]} agents
 * @returns {Map<string, string>}
 */
export function agentNameMap(agents) {
  return new Map(agents.map(agent => [agent.id, agent.name]))
}
