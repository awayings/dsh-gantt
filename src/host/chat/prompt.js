// The model system prompt: the decomposition discipline plus today's context,
// the tree markdown, and the focused task.

import { DECOMPOSE_MAX_DEPTH, flattenTree, todayIso } from '../tree.js'
import { isDate } from './proposal.js'

/** @typedef {import('../tree.js').TreeTaskNode} TreeTaskNode */

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

const MAX_CONTEXT_CHARS = 9000
/** @type {Record<string, string>} */
const ROLE_LABELS = { core: '核心', rotation: '轮换', definition: '定义' }

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
 * @param {TreeTaskNode[]} tasks
 * @param {string | null} taskId
 * @returns {TreeTaskNode | null}
 */
export function findFocus(tasks, taskId) {
  if (taskId === null || taskId === '') return null
  return flattenTree(tasks).find(task => task.id === taskId) ?? null
}
/**
 * Depth of one task in the rendered tree, counting the root as depth 1.
 * @param {TreeTaskNode[]} tasks
 * @param {string} taskId
 * @returns {number}
 */
export function depthOf(tasks, taskId) {
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
