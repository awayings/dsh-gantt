// Host-side AI decompose chat: builds the model request (system prompt with the
// Hermes decomposition discipline plus the caller-supplied task context),
// streams the reply, and parses the single fenced JSON proposal block.
//
// `runChat` is the only entry point index.js needs; every other export is a
// pure helper so the prompt and parsing rules are testable in isolation. No
// tool schemas are passed to the model.

import {
  DECOMPOSE_MAX_DEPTH,
  dayToIso,
  flattenTree,
  isoToDay,
  slotForStart,
  todayIso,
} from './tree.js'

/** @typedef {import('./tree.js').TreeTaskNode} TreeTaskNode */

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

/**
 * The model route chosen by the caller (`agentDefaultModel.currentSelection()`).
 * @typedef {object} ChatSelection
 * @property {string} provider
 * @property {string} model
 * @property {string} [reasoningEffort]
 */

/**
 * One prior chat turn accepted from the client.
 * @typedef {object} ChatHistoryTurn
 * @property {'user' | 'assistant'} role
 * @property {string} content
 */

/**
 * One request message in the harness wire shape.
 * @typedef {object} ChatMessage
 * @property {'user' | 'assistant'} role
 * @property {{ type: 'text', text: string }[]} content
 */

/**
 * One window of the daily brief report (§1.1).
 * @typedef {object} DailyWindow
 * @property {string} slot
 * @property {string} startTime
 * @property {string} endTime
 * @property {string} kind
 * @property {string} blockId
 */

/**
 * One picked task of the daily brief report (§1.1).
 * @typedef {object} DailyPick
 * @property {string} slot
 * @property {string} startTime
 * @property {string} endTime
 * @property {string} blockId
 * @property {string} ref
 * @property {string} title
 * @property {string} trackName
 * @property {string} role
 */

/**
 * The caller-supplied context: the full tree context markdown and the rendered
 * tree nodes used to describe the focused task.
 * @typedef {object} ChatContext
 * @property {string} markdown
 * @property {TreeTaskNode[]} tasks
 */

/**
 * The daily brief report needed for the prompt; only the date, windows, and
 * picks are read.
 * @typedef {object} DailyBriefLike
 * @property {string} [date]
 * @property {DailyWindow[]} [slots]
 * @property {DailyPick[]} [items]
 */

/**
 * Model streaming options for the harness `llm.stream` call; deliberately has no
 * `tools` key.
 * @typedef {object} ChatStreamOptions
 * @property {string} provider
 * @property {string} model
 * @property {string} [reasoningEffort]
 * @property {string} system
 * @property {ChatMessage[]} messages
 * @property {number} maxTokens
 * @property {AbortSignal} signal
 */

/**
 * The harness llm service surface this module relies on.
 * @typedef {object} LlmLike
 * @property {(options: ChatStreamOptions) => AsyncIterable<StreamChunk>} stream
 */

/**
 * One chunk of the harness stream vocabulary (only these shapes are read).
 * @typedef {{ type: 'text-delta', text: string } |
 * { type: 'reasoning-delta', text: string } |
 * { type: 'finish', reason: { kind?: string } } |
 * { type: 'block-start' | 'block-end' | 'tool-call-delta' | 'usage' }} StreamChunk
 */

/**
 * Inputs of `runChat`.
 * @typedef {object} RunChatInput
 * @property {LlmLike | null} [llm]
 * @property {ChatSelection | null} [selection]
 * @property {string} message
 * @property {ChatHistoryTurn[] | null} [history]
 * @property {string | null} [taskId]
 * @property {ChatContext | null} [context]
 * @property {DailyBriefLike | null} [dailyBrief]
 * @property {AbortSignal} [signal]
 */

/**
 * Result of `runChat`.
 * @typedef {object} ChatResult
 * @property {string} reply
 * @property {Proposal | null} proposal
 * @property {{ provider: string, model: string }} model
 */

/** A chat failure with an HTTP-friendly status: 400 invalid input, 502 upstream, 503 unavailable. */
export class ChatError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 400) {
    super(message)
    this.name = 'ChatError'
    this.status = status
  }
}

const MAX_MESSAGE_CHARS = 2000
const MAX_HISTORY_TURNS = 8
const MAX_PROPOSAL_CHILDREN = 8
const MAX_PROPOSAL_TEXT = 200
const MAX_CONTEXT_CHARS = 9000
const MAX_TOKENS = 1500
const CHAT_TIMEOUT_MS = 60_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const JSON_FENCE_RE = /```json[ \t]*\r?\n([\s\S]*?)```/gi
/** @type {PlanSlot[]} */
const PLAN_SLOTS = ['morning', 'daytime', 'evening', 'other']
/** @type {Record<string, string>} */
const ROLE_LABELS = { core: '核心', rotation: '轮换', definition: '定义' }
const OPTIONAL_TEXT_FIELDS = /** @type {const} */ (['landing', 'estimate', 'category', 'inspiration'])

const SYSTEM_PROMPT = [
  '你是 dsh-gantt 的 AI 拆解助手，帮助用户把任务拆成今天就能执行的小任务。用简体中文回答。',
  '',
  '## 拆解纪律（Hermes 任务拆解规范）',
  '1. 层级上限 4 层（含支线根）：支线是第 1 层，所以只有第 1–3 层的任务可以继续拆；第 4 层是叶子，不能再加子任务。达到上限时直接说明不能继续拆。',
  '2. 每个子任务必须有完成标准（done_when），写成可以用两个问题验证的一句话：做完了吗？怎么证明？没有可验证完成标准的任务不许出现。',
  '3. 每个子任务要么是 ≤ 30 分钟可执行的 A 类任务，要么本身就是 B 类「定义/拆解」任务——只产出下一层拆解结果，并且会占用一个时间窗。不要把超过 30 分钟的任务当成一个可执行子任务。',
  '4. 兄弟任务默认并行；只有确实存在先后依赖时，才给且只给一个依赖（dep），写成前置任务的点号 id。',
  '5. 任务 id 一律用点号数字表示（如 1、1.8、1.8.1），不要发明其它 id 形式。',
  '6. 不要编造上下文里没有的任务；信息不足时，先拆出一个 B 类「定义」任务去澄清。',
  '',
  '## 输出格式',
  '用户要求拆解、或当前有聚焦任务时：先用简体中文写一小段说明，然后输出且只输出一个 ```json 代码块：',
  '{"planDate":"YYYY-MM-DD"|null,"children":[{"title":"子任务标题","doneWhen":"可验证的完成标准","landing":"落点","estimate":"30min","category":"A","inspiration":"灵感来源","startDate":null,"endDate":null,"plan":{"date":"YYYY-MM-DD","startTime":"21:00","endTime":"21:30","slot":"evening"}|null}]}',
  '- children 必须有 1–8 项；title 与 doneWhen 必填，其余可省略；plan 为 null 或省略表示暂不排期。',
  '- slot 只能是 morning / daytime / evening / other；时间用 HH:MM。',
  '- 只是聊天或回答问题，不要输出 json 代码块。',
].join('\n')

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const day = isoToDay(value)
  return Number.isFinite(day) && dayToIso(day) === value
}

/** @param {string} value @returns {number} */
function textLength(value) {
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
 * @param {TreeTaskNode[]} tasks
 * @param {string | null} taskId
 * @returns {TreeTaskNode | null}
 */
function findFocus(tasks, taskId) {
  if (taskId === null || taskId === '') return null
  return flattenTree(tasks).find(task => task.id === taskId) ?? null
}

/**
 * Depth of one task in the rendered tree, counting the root as depth 1.
 * @param {TreeTaskNode[]} tasks
 * @param {string} taskId
 * @returns {number}
 */
function depthOf(tasks, taskId) {
  const byId = new Map(flattenTree(tasks).map(task => [task.id, task]))
  let depth = 1
  let parentId = byId.get(taskId)?.parentId ?? null
  while (typeof parentId === 'string' && parentId !== '') {
    depth += 1
    parentId = byId.get(parentId)?.parentId ?? null
  }
  return depth
}

/**
 * @param {DailyBriefLike | null} dailyBrief
 * @returns {string}
 */
function briefDate(dailyBrief) {
  if (dailyBrief !== null && typeof dailyBrief.date === 'string' && isDate(dailyBrief.date)) return dailyBrief.date
  return todayIso()
}

/**
 * @param {string} role
 * @returns {string}
 */
function roleLabel(role) {
  return ROLE_LABELS[role] ?? '任务'
}

/**
 * Render today's windows as prompt lines, with 未填 for windows without a pick.
 * @param {DailyBriefLike | null} dailyBrief
 * @returns {string[]}
 */
function renderWindows(dailyBrief) {
  const slots = dailyBrief?.slots
  if (!Array.isArray(slots) || slots.length === 0) return ['（今天没有可用的窗口）']
  const items = dailyBrief !== null && Array.isArray(dailyBrief.items) ? dailyBrief.items : []
  return slots.map((slot) => {
    const item = items.find(candidate => candidate.blockId === slot.blockId && candidate.slot === slot.slot) ?? null
    const time = slot.startTime !== '' && slot.endTime !== '' ? `${slot.startTime}-${slot.endTime}` : '时间未定'
    const label = roleLabel(item === null ? slot.kind : item.role)
    if (item === null) return `- ${time} ${label}：未填`
    const task = [item.trackName, item.ref, item.title].filter(part => typeof part === 'string' && part !== '').join(' ')
    return `- ${time} ${label}：${task}`
  })
}

/**
 * @param {string} markdown
 * @returns {string}
 */
function clampMarkdown(markdown) {
  if (markdown === '') return '（暂无任务树）'
  if (markdown.length <= MAX_CONTEXT_CHARS) return markdown
  return `${markdown.slice(0, MAX_CONTEXT_CHARS)}\n…（任务树上下文过长，已截断）`
}

/**
 * @param {TreeTaskNode[]} tasks
 * @param {TreeTaskNode} focus
 * @returns {string[]}
 */
function renderFocus(tasks, focus) {
  const depth = depthOf(tasks, focus.id)
  const ref = focus.ref === '' ? focus.number : focus.ref
  const lines = [
    '',
    '## 当前聚焦任务（拆解对象）',
    `- 点号 id：${ref}`,
    `- 标题：${focus.title}`,
    `- 层级：第 ${depth} 层（上限 ${DECOMPOSE_MAX_DEPTH} 层）`,
    `- 完成标准：${focus.doneWhen === '' ? '（未填写）' : focus.doneWhen}`,
    depth >= DECOMPOSE_MAX_DEPTH ? '- 已达层级上限，不能再拆解。' : '- 可以继续拆解。',
  ]
  if (focus.children.length === 0) {
    lines.push('- 直接子任务：无')
  } else {
    lines.push('- 直接子任务：')
    for (const child of focus.children) {
      const childRef = child.ref === '' ? child.number : child.ref
      const standard = child.doneWhen === '' ? '' : `（完成标准：${child.doneWhen}）`
      lines.push(`  - ${childRef} ${child.title}${standard}`)
    }
  }
  return lines
}

/**
 * Build the system prompt: the decomposition discipline, today's date and
 * windows, the truncated tree context markdown, and the focused task.
 * @param {{ context: ChatContext, dailyBrief?: DailyBriefLike | null, taskId?: string | null }} input
 * @returns {string}
 */
export function buildSystemPrompt({ context, dailyBrief = null, taskId = null }) {
  const focus = findFocus(context.tasks, taskId)
  const lines = [
    SYSTEM_PROMPT,
    '',
    '## 当前上下文',
    `- 今天：${briefDate(dailyBrief)}`,
    '',
    '## 今日窗口',
    ...renderWindows(dailyBrief),
    '',
    '## 任务树上下文',
    clampMarkdown(context.markdown),
  ]
  if (focus !== null) lines.push(...renderFocus(context.tasks, focus))
  return lines.join('\n')
}

/**
 * Map the validated history plus the new user message to request messages.
 * @param {{ message: string, history?: ChatHistoryTurn[] }} input
 * @returns {ChatMessage[]}
 */
export function buildChatMessages({ message, history = [] }) {
  /** @type {ChatMessage[]} */
  const messages = history.map(turn => ({ role: turn.role, content: [{ type: 'text', text: turn.content }] }))
  messages.push({ role: 'user', content: [{ type: 'text', text: message }] })
  return messages
}

/**
 * @param {{ kind?: string }} reason
 * @returns {boolean}
 */
function finishFailed(reason) {
  return reason.kind === 'error' || reason.kind === 'aborted'
}

/**
 * Join only `text-delta` chunks; a failure finish or a broken stream is a 502.
 * @param {AsyncIterable<StreamChunk>} stream
 * @returns {Promise<string>}
 */
async function consumeStream(stream) {
  let reply = ''
  let failed = false
  try {
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') reply += chunk.text
      else if (chunk.type === 'finish' && finishFailed(chunk.reason)) failed = true
    }
  } catch {
    throw new ChatError('model request failed', 502)
  }
  if (failed) throw new ChatError('model request failed', 502)
  return reply
}

/**
 * Run one streamed model call, capping it at 60 s and forwarding the caller's
 * abort signal. Every upstream failure maps to a 502 `ChatError`.
 * @param {{ llm: LlmLike, selection: ChatSelection, system: string, messages: ChatMessage[],
 * signal?: AbortSignal }} input
 * @returns {Promise<string>}
 */
async function requestReply({ llm, selection, system, messages, signal }) {
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
  if (selection.reasoningEffort !== undefined) options.reasoningEffort = selection.reasoningEffort
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
  const model = { provider: /** @type {ChatSelection} */ (selection).provider, model: /** @type {ChatSelection} */ (selection).model }
  const reply = await requestReply({
    llm: /** @type {LlmLike} */ (llm),
    selection: /** @type {ChatSelection} */ (selection),
    system,
    messages,
    signal,
  })
  const depth = focusId === null ? null : depthOf(safeContext.tasks, focusId)
  const parsed = parseProposal(reply, { depth, maxDepth: DECOMPOSE_MAX_DEPTH })
  return { reply: parsed.reply, proposal: parsed.proposal, model }
}
