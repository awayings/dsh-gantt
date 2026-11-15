// Parse the single fenced JSON proposal block out of a model reply and validate
// it against the decompose contract.

import { DECOMPOSE_MAX_DEPTH, dayToIso, isoToDay, slotForStart } from '../tree.js'

/** @typedef {'morning' | 'daytime' | 'evening' | 'other'} PlanSlot */

/**
 * One validated child of a decomposition proposal.
 * @typedef {object} ProposalChild
 * @property {string} title
 * @property {string} doneWhen
 * @property {string} [landing]
 * @property {string} [estimate]
 * @property {string} [category]
 * @property {string} [inspiration]
 * @property {string} [startDate]
 * @property {string} [endDate]
 * @property {ProposalPlan} [plan]
 */

/**
 * The plan cell a proposal child asks to reserve.
 * @typedef {object} ProposalPlan
 * @property {string} date
 * @property {string} startTime
 * @property {string} endTime
 * @property {PlanSlot} slot
 */

/**
 * A validated decomposition proposal parsed from the model reply.
 * @typedef {object} Proposal
 * @property {string | null} planDate
 * @property {ProposalChild[]} children
 */

const MAX_PROPOSAL_CHILDREN = 8
const MAX_PROPOSAL_TEXT = 200
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const JSON_FENCE_RE = /```json[ \t]*\r?\n([\s\S]*?)```/gi
/** @type {PlanSlot[]} */
const PLAN_SLOTS = ['morning', 'daytime', 'evening', 'other']
const OPTIONAL_TEXT_FIELDS = /** @type {const} */ (['landing', 'estimate', 'category', 'inspiration'])

/**
 * True for one real `YYYY-MM-DD` calendar date.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const day = isoToDay(value)
  return Number.isFinite(day) && dayToIso(day) === value
}

/** @param {string} value @returns {number} */
export function textLength(value) {
  return [...value].length
}
/**
 * Trim one required proposal text field, or return null when it is unusable.
 * @param {unknown} value
 * @returns {string | null}
 */
function requiredProposalText(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '' || textLength(text) > MAX_PROPOSAL_TEXT) return null
  return text
}
/**
 * Validate one optional plan cell. `plan: null` is a valid "not scheduled";
 * `{ ok: false }` means the whole proposal is invalid.
 * @param {unknown} value
 * @returns {{ ok: true, plan: ProposalPlan | null } | { ok: false }}
 */
function normalizePlan(value) {
  if (value === undefined || value === null) return { ok: true, plan: null }
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false }
  const record = /** @type {Record<string, unknown>} */ (value)
  if (!isDate(record.date)) return { ok: false }
  const startTime = record.startTime === undefined || record.startTime === null ? '' : record.startTime
  const endTime = record.endTime === undefined || record.endTime === null ? '' : record.endTime
  if (typeof startTime !== 'string' || (startTime !== '' && !TIME_RE.test(startTime))) return { ok: false }
  if (typeof endTime !== 'string' || (endTime !== '' && !TIME_RE.test(endTime))) return { ok: false }
  let slot = slotForStart(startTime)
  if (record.slot !== undefined && record.slot !== null) {
    const found = PLAN_SLOTS.find(candidate => candidate === record.slot)
    if (found === undefined) return { ok: false }
    slot = found
  }
  return {
    ok: true,
    plan: { date: /** @type {string} */ (record.date), startTime, endTime, slot },
  }
}
/**
 * Validate one proposal child and strip unknown fields.
 * @param {unknown} value
 * @returns {ProposalChild | null}
 */
function normalizeChild(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = /** @type {Record<string, unknown>} */ (value)
  const title = requiredProposalText(record.title)
  const doneWhen = requiredProposalText(record.doneWhen)
  if (title === null || doneWhen === null) return null
  /** @type {ProposalChild} */
  const child = { title, doneWhen }
  for (const field of OPTIONAL_TEXT_FIELDS) {
    const raw = record[field]
    if (raw === undefined || raw === null) continue
    if (typeof raw !== 'string' || textLength(raw.trim()) > MAX_PROPOSAL_TEXT) return null
    if (raw.trim() !== '') child[field] = raw.trim()
  }
  if (record.startDate !== undefined && record.startDate !== null) {
    if (!isDate(record.startDate)) return null
    child.startDate = /** @type {string} */ (record.startDate)
  }
  if (record.endDate !== undefined && record.endDate !== null) {
    if (!isDate(record.endDate)) return null
    child.endDate = /** @type {string} */ (record.endDate)
  }
  if (child.startDate !== undefined && child.endDate !== undefined && child.startDate > child.endDate) return null
  const plan = normalizePlan(record.plan)
  if (!plan.ok) return null
  if (plan.plan !== null) child.plan = plan.plan
  return child
}
/**
 * Validate a parsed proposal document and strip unknown fields.
 * @param {unknown} value
 * @returns {Proposal | null}
 */
function normalizeProposal(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = /** @type {Record<string, unknown>} */ (value)
  /** @type {string | null} */
  let planDate = null
  if (record.planDate !== undefined && record.planDate !== null) {
    if (!isDate(record.planDate)) return null
    planDate = /** @type {string} */ (record.planDate)
  }
  if (!Array.isArray(record.children) || record.children.length < 1 || record.children.length > MAX_PROPOSAL_CHILDREN) return null
  /** @type {ProposalChild[]} */
  const children = []
  for (const raw of record.children) {
    const child = normalizeChild(raw)
    if (child === null) return null
    children.push(child)
  }
  return { planDate, children }
}
/** One located fenced code block. @typedef {{ start: number, end: number, body: string }} JsonFence */

/**
 * Locate the last fenced json block in the reply.
 * @param {string} text
 * @returns {JsonFence | null}
 */
function lastJsonFence(text) {
  let match
  /** @type {JsonFence | null} */
  let last = null
  while ((match = JSON_FENCE_RE.exec(text)) !== null) {
    last = { start: match.index, end: match.index + match[0].length, body: match[1] }
  }
  return last
}
/** @param {string} reply @param {string} note @returns {string} */
function appendNote(reply, note) {
  return reply === '' ? note : `${reply}\n\n${note}`
}
/**
 * The Chinese note appended when the focused task is already at the depth cap.
 * @param {number} depth @param {number} maxDepth @returns {string}
 */
function depthNote(depth, maxDepth) {
  return `（当前任务已在第 ${depth} 层，达到 ${maxDepth} 层拆解上限，不能再拆；请改拆更上层的任务。）`
}
/**
 * Parse the last fenced JSON proposal block in a model reply and validate it.
 *
 * An invalid block leaves the reply untouched; a valid block is removed from
 * the reply, and a valid block for a task already at the depth cap is removed
 * while a Chinese note is appended.
 * @param {string} text
 * @param {{ depth?: number | null, maxDepth?: number }} [options]
 * @returns {{ reply: string, proposal: Proposal | null }}
 */
export function parseProposal(text, options = {}) {
  const match = lastJsonFence(text)
  if (match === null) return { reply: text.trim(), proposal: null }
  /** @type {unknown} */
  let raw
  try {
    raw = JSON.parse(match.body)
  } catch {
    return { reply: text.trim(), proposal: null }
  }
  const proposal = normalizeProposal(raw)
  if (proposal === null) return { reply: text.trim(), proposal: null }
  const reply = `${text.slice(0, match.start)}${text.slice(match.end)}`.trim()
  const depth = options.depth ?? null
  const maxDepth = options.maxDepth ?? DECOMPOSE_MAX_DEPTH
  if (typeof depth === 'number' && depth >= maxDepth) {
    return { reply: appendNote(reply, depthNote(depth, maxDepth)), proposal: null }
  }
  return { reply, proposal }
}
