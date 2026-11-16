// One AI decompose chat turn: validate the request, stream the model reply, and
// hand the parsed proposal back to the route.

import { DECOMPOSE_MAX_DEPTH } from '../tree.js'
import { ChatError } from '../errors.js'
import { buildChatMessages, buildSystemPrompt, depthOf, findFocus } from './prompt.js'
import { parseProposal, textLength } from './proposal.js'

/** @typedef {import('./prompt.js').ChatContext} ChatContext */
/** @typedef {import('./prompt.js').ChatHistoryTurn} ChatHistoryTurn */
/** @typedef {import('./prompt.js').ChatMessage} ChatMessage */

/**
 * The model route chosen by the caller (`agentDefaultModel.currentSelection()`).
 * @typedef {object} ChatSelection
 * @property {string} provider
 * @property {string} model
 * @property {string} [reasoningEffort]
 */

/**
 * Model streaming options for the harness `llm.stream` call; deliberately has no
 * `tools` key.
 * @typedef {object} ChatStreamOptions
 * @property {string} provider
 * @property {string} model
 * @property {string} [reasoningEffort]
 * @property {string} system
 * @property {import('./prompt.js').ChatMessage[]} messages
 * @property {number} maxTokens
 * @property {AbortSignal} signal
 */

/**
 * The harness llm service surface this module relies on.
 * @typedef {object} LlmLike
 * @property {(options: ChatStreamOptions) => AsyncIterable<StreamChunk>} stream
 */

/**
 * The terminal reason of one model stream: the harness kind (`stop`,
 * `max-tokens`, `tool-calls`, `error`, `aborted`) and the upstream failure when
 * the adapter reported one.
 * @typedef {{ kind?: string, failure?: { code?: string, message?: string } }} StreamFinish
 */

/**
 * One chunk of the harness stream vocabulary (only these shapes are read).
 * @typedef {{ type: 'text-delta', text: string } |
 * { type: 'reasoning-delta', text: string } |
 * { type: 'finish', reason: StreamFinish } |
 * { type: 'block-start' | 'block-end' | 'tool-call-delta' | 'usage' }} StreamChunk
 */

/**
 * Inputs of `runChat`.
 * @typedef {object} RunChatInput
 * @property {LlmLike | null} [llm]
 * @property {ChatSelection | null} [selection]
 * @property {string} message
 * @property {import('./prompt.js').ChatHistoryTurn[] | null} [history]
 * @property {string | null} [taskId]
 * @property {import('./prompt.js').ChatContext | null} [context]
 * @property {import('./prompt.js').DailyBriefLike | null} [dailyBrief]
 * @property {AbortSignal} [signal]
 */

/**
 * Result of `runChat`.
 * @typedef {object} ChatResult
 * @property {string} reply
 * @property {import('./proposal.js').Proposal | null} proposal
 * @property {{ provider: string, model: string }} model
 */

const MAX_MESSAGE_CHARS = 2000
const MAX_HISTORY_TURNS = 8
// Thinking models bill their reasoning to the same output budget, and the
// provider reports only reasoning blocks when it runs out first. 1500 tokens
// was enough to end a turn with no visible text and an empty chat bubble.
const MAX_TOKENS = 8000
const CHAT_TIMEOUT_MS = 60_000

/**
 * @param {unknown} selection
 * @returns {boolean}
 */
function validSelection(selection) {
  if (selection === null || typeof selection !== 'object') return false
  const record = /** @type {Record<string, unknown>} */ (selection)
  return typeof record.provider === 'string' && record.provider !== ''
    && typeof record.model === 'string' && record.model !== ''
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeMessage(value) {
  if (typeof value !== 'string') throw new ChatError('message is required', 400)
  const message = value.trim()
  if (message === '') throw new ChatError('message is required', 400)
  if (textLength(message) > MAX_MESSAGE_CHARS) throw new ChatError(`message must be at most ${MAX_MESSAGE_CHARS} characters`, 400)
  return message
}

/**
 * @param {unknown} value
 * @returns {ChatHistoryTurn[]}
 */
function normalizeHistory(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ChatError('history must be an array', 400)
  if (value.length > MAX_HISTORY_TURNS) throw new ChatError(`history must be at most ${MAX_HISTORY_TURNS} turns`, 400)
  return value.map((turn, index) => {
    if (turn === null || typeof turn !== 'object' || Array.isArray(turn)) throw new ChatError(`history[${index}] must be an object`, 400)
    const record = /** @type {Record<string, unknown>} */ (turn)
    if (record.role !== 'user' && record.role !== 'assistant') throw new ChatError(`history[${index}].role must be user or assistant`, 400)
    if (typeof record.content !== 'string') throw new ChatError(`history[${index}].content must be a string`, 400)
    if (textLength(record.content) > MAX_MESSAGE_CHARS) throw new ChatError(`history[${index}].content must be at most ${MAX_MESSAGE_CHARS} characters`, 400)
    return { role: record.role, content: record.content.trim() }
  })
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeTaskId(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new ChatError('taskId must be a string', 400)
  return value === '' ? null : value
}

/**
 * @param {unknown} value
 * @returns {ChatContext}
 */
function normalizeContext(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ChatError('context must be an object', 400)
  const record = /** @type {Record<string, unknown>} */ (value)
  if (typeof record.markdown !== 'string') throw new ChatError('context.markdown must be a string', 400)
  if (!Array.isArray(record.tasks)) throw new ChatError('context.tasks must be an array', 400)
  return /** @type {ChatContext} */ (record)
}
/**
 * Join only `text-delta` chunks and keep the terminal finish reason. A broken
 * stream or a failed finish is a 502; an empty reply is judged by the caller.
 * @param {AsyncIterable<StreamChunk>} stream
 * @returns {Promise<{ reply: string, finish: StreamFinish | null }>}
 */
async function consumeStream(stream) {
  let reply = ''
  /** @type {StreamFinish | null} */
  let finish = null
  try {
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') reply += chunk.text
      else if (chunk.type === 'finish') finish = chunk.reason ?? null
    }
  } catch {
    throw new ChatError('model request failed', 502)
  }
  if (finish !== null && (finish.kind === 'error' || finish.kind === 'aborted')) {
    const code = finish.failure?.code
    throw new ChatError(code === undefined ? 'model request failed' : `model request failed: ${code}`, 502)
  }
  return { reply, finish }
}

/**
 * Run one streamed model call, capping it at 60 s and forwarding the caller's
 * abort signal. Every upstream failure maps to a 502 `ChatError`.
 * @param {{ llm: LlmLike, selection: ChatSelection, system: string, messages: ChatMessage[],
 * reasoningEffort?: string, signal?: AbortSignal }} input
 * @returns {Promise<{ reply: string, finish: StreamFinish | null }>}
 */
async function requestReply({ llm, selection, system, messages, reasoningEffort, signal }) {
  if (signal !== undefined && signal.aborted) throw new ChatError('model request aborted', 502)
  const controller = new AbortController()
  let timedOut = false
  const forwardAbort = () => controller.abort()
  if (signal !== undefined) signal.addEventListener('abort', forwardAbort, { once: true })
  /** @type {Promise<never>} */
  const aborted = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => {
      reject(new ChatError(timedOut ? 'model request timed out' : 'model request aborted', 502))
    }, { once: true })
  })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, CHAT_TIMEOUT_MS)
  /** @type {ChatStreamOptions} */
  const options = {
    provider: selection.provider,
    model: selection.model,
    system,
    messages,
    maxTokens: MAX_TOKENS,
    signal: controller.signal,
  }
  const effort = reasoningEffort ?? selection.reasoningEffort
  if (effort !== undefined) options.reasoningEffort = effort
  try {
    return await Promise.race([consumeStream(llm.stream(options)), aborted])
  } catch (error) {
    if (error instanceof ChatError) throw error
    throw new ChatError('model request failed', 502)
  } finally {
    clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener('abort', forwardAbort)
  }
}

/**
 * Run one AI decompose chat turn: validate the request, call the model, and
 * parse the optional fenced JSON proposal.
 * @param {RunChatInput} input
 * @returns {Promise<ChatResult>}
 */
export async function runChat({ llm, selection, message, history, taskId, context, dailyBrief, signal }) {
  if (llm === undefined || llm === null || typeof llm.stream !== 'function') throw new ChatError('model unavailable', 503)
  if (!validSelection(selection)) throw new ChatError('model unavailable', 503)
  const text = normalizeMessage(message)
  const turns = normalizeHistory(history)
  const focusId = normalizeTaskId(taskId)
  const safeContext = normalizeContext(context)
  const focus = findFocus(safeContext.tasks, focusId)
  if (focusId !== null && focus === null) throw new ChatError(`task ${focusId} was not found`, 400)
  const system = buildSystemPrompt({ context: safeContext, dailyBrief: dailyBrief ?? null, taskId: focusId })
  const messages = buildChatMessages({ message: text, history: turns })
  const chosen = /** @type {ChatSelection} */ (selection)
  const model = { provider: chosen.provider, model: chosen.model }
  const call = /** @type {LlmLike} */ (llm)
  let outcome = await requestReply({ llm: call, selection: chosen, system, messages, signal })
  if (outcome.reply === '' && chosen.reasoningEffort === undefined) {
    // A thinking model can end at `max-tokens` on reasoning alone; retry the
    // same turn with thinking disabled so the user gets text, not a blank box.
    outcome = await requestReply({ llm: call, selection: chosen, system, messages, reasoningEffort: 'off', signal })
  }
  if (outcome.reply === '') {
    throw new ChatError(
      outcome.finish?.kind === 'max-tokens'
        ? 'model stopped at max-tokens before writing a reply'
        : 'model returned an empty reply',
      502,
    )
  }
  const depth = focusId === null ? null : depthOf(safeContext.tasks, focusId)
  const parsed = parseProposal(outcome.reply, { depth, maxDepth: DECOMPOSE_MAX_DEPTH })
  return { reply: parsed.reply, proposal: parsed.proposal, model }
}
