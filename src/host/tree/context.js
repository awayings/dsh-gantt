// The stable markdown context document: the tree, one day plan, and integrity notes.

/** @typedef {import('./build.js').TreeTaskNode} TreeTaskNode */
/** Default `GET /context` character budget. */
const DEFAULT_CONTEXT_LIMIT = 12_000
/** Default `GET /context` character budget. */
export const CONTEXT_DEFAULT_LIMIT = DEFAULT_CONTEXT_LIMIT
/** Minimum and maximum `GET /context` character budget. */
export const CONTEXT_MIN_LIMIT = 1_000
export const CONTEXT_MAX_LIMIT = 60_000

/**
 * The day row rendered in the context document.
 * @typedef {object} ContextDay
 * @property {string} weekday
 * @property {string} dayKind
 * @property {boolean} marketOpen
 * @property {string} coreGoal
 */

/**
 * One plan block rendered in the context document.
 * @typedef {object} ContextBlock
 * @property {string} status
 * @property {string} startTime
 * @property {string} endTime
 * @property {string} slot
 * @property {string} category
 * @property {string} title
 * @property {string} landing
 * @property {string} estimate
 * @property {string} inspiration
 */

/**
 * Inputs of the markdown context document.
 * @typedef {object} ContextInput
 * @property {string} date
 * @property {ContextDay | null} day
 * @property {TreeTaskNode[]} trees
 * @property {ContextBlock[]} blocks
 * @property {{ code: string, blockId?: string }[]} integrity
 * @property {{ tracks: number, nodes: number, tasks: number, blocks: number }} counts
 */

/**
 * One rendered document line, carrying the information truncation needs.
 * @typedef {object} ContextLine
 * @property {string} text
 * @property {number} [depth]
 * @property {string} [date]
 */

/** @typedef {{ markdown: string, chars: number, truncated: boolean }} ContextDocument */

/**
 * The label a task shows in the context document: its tracker dotted id when it
 * has one, else its derived hierarchy number.
 * @param {TreeTaskNode} task
 * @returns {string}
 */
function displayNumber(task) {
  const separator = task.ref.indexOf(':')
  return separator === -1 ? task.number : task.ref.slice(separator + 1)
}

/**
 * @param {TreeTaskNode} track
 * @returns {string}
 */
function trackHeadingMeta(track) {
  const parts = []
  if (track.lane !== '') parts.push(track.lane)
  if (track.state !== '') parts.push(track.state)
  if (track.description !== '') parts.push(`卡住：${track.description}`)
  return parts.length === 0 ? '' : `（${parts.join(' · ')}）`
}

/**
 * @param {TreeTaskNode} node
 * @returns {string}
 */
function nodeLine(node) {
  const state = node.state === '' ? '' : ` ${node.state}`
  const parts = [`${displayNumber(node)} ${node.title} [${node.status}${state}] ${node.startDate}→${node.endDate}`]
  if (node.landing !== '') parts.push(`落点 ${node.landing}`)
  if (node.doneWhen !== '') parts.push(`完成标准 ${node.doneWhen}`)
  if (node.dep !== '') parts.push(`依赖 ${node.dep}`)
  if (node.estimate !== '') parts.push(`预估 ${node.estimate}`)
  if (node.category !== '') parts.push(`类 ${node.category}`)
  if (node.inspiration !== '') parts.push(`灵感 ${node.inspiration}`)
  if (node.links.length > 0) parts.push(`链接 ${node.links.map(link => `${link.type}:${link.ref}`).join(', ')}`)
  return parts.join(' · ')
}

/**
 * @param {TreeTaskNode[]} nodes
 * @param {number} depth
 * @param {ContextLine[]} lines
 * @returns {void}
 */
function appendNodeLines(nodes, depth, lines) {
  for (const node of nodes) {
    lines.push({ text: `${'  '.repeat(depth - 2)}- ${nodeLine(node)}`, depth })
    appendNodeLines(node.children, depth + 1, lines)
  }
}

/**
 * @param {ContextDay | null} day
 * @returns {string}
 */
function dayHeading(day) {
  if (day === null) return ''
  const parts = []
  if (day.weekday !== '') parts.push(day.weekday)
  if (day.dayKind === 'weekend') parts.push('周末')
  else if (day.dayKind === 'workday') parts.push('工作日')
  parts.push(day.marketOpen ? '交易日' : '休市')
  return `（${parts.join(' · ')}）`
}

/**
 * @param {ContextBlock} block
 * @returns {string}
 */
function blockLine(block) {
  const time = block.startTime === '' || block.endTime === '' ? (block.startTime || block.slot) : `${block.startTime}-${block.endTime}`
  const title = block.category === '' ? block.title : `${block.category} · ${block.title}`
  const parts = [`[${block.status}] ${time} ${title}`]
  if (block.landing !== '') parts.push(`落点 ${block.landing}`)
  if (block.estimate !== '') parts.push(`预估 ${block.estimate}`)
  if (block.inspiration !== '') parts.push(`灵感 ${block.inspiration}`)
  return parts.join(' · ')
}

/**
 * @param {ContextInput} input
 * @returns {ContextLine[]}
 */
function contextLines(input) {
  /** @type {ContextLine[]} */
  const lines = []
  const { counts } = input
  const headerParts = []
  if (counts.tracks > 0) headerParts.push(`${counts.tracks} 条支线`)
  if (counts.nodes > 0) headerParts.push(`${counts.nodes} 个节点`)
  if (counts.tasks > 0) headerParts.push(`${counts.tasks} 个任务`)
  lines.push({ text: headerParts.length === 0 ? '# 个人任务树' : `# 个人任务树（${headerParts.join(' · ')}）` })
  for (const root of input.trees) {
    lines.push({ text: '' })
    if (root.kind === 'track') {
      lines.push({ text: `## ${displayNumber(root)}. ${root.title}${trackHeadingMeta(root)}` })
      appendNodeLines(root.children, 2, lines)
    } else {
      appendNodeLines([root], 2, lines)
    }
  }
  lines.push({ text: '' })
  lines.push({ text: `## 今日 ${input.date}${dayHeading(input.day)}` })
  if (input.day !== null && input.day.coreGoal !== '') lines.push({ text: `- 核心目标：${input.day.coreGoal}` })
  for (const block of input.blocks) lines.push({ text: `- ${blockLine(block)}`, date: input.date })
  if (input.integrity.length > 0) {
    lines.push({ text: '' })
    lines.push({ text: '## 完整性提示' })
    for (const item of input.integrity) {
      lines.push({ text: `- ${item.code}${item.blockId === undefined ? '' : `: ${item.blockId}`}` })
    }
  }
  return lines
}

/**
 * @param {ContextLine[]} lines
 * @returns {string}
 */
function joinContextLines(lines) {
  return `${lines.map(line => line.text).join('\n')}\n`
}

/**
 * @param {ContextLine[]} lines
 * @returns {number | null}
 */
function deepestDepth(lines) {
  let depth = null
  for (const line of lines) {
    if (line.depth !== undefined && (depth === null || line.depth > depth)) depth = line.depth
  }
  return depth
}

/**
 * @param {ContextLine[]} lines
 * @returns {string | null}
 */
function oldestDate(lines) {
  let date = null
  for (const line of lines) {
    if (line.date !== undefined && (date === null || line.date < date)) date = line.date
  }
  return date
}

/**
 * Render the stable markdown context document and trim it to `limit` characters.
 *
 * Trimming removes the deepest node lines first and then the oldest dated lines;
 * only a document whose headers alone exceed the limit is hard-cut.
 * @param {ContextInput} input
 * @param {number} limit
 * @returns {ContextDocument}
 */
export function renderContextDocument(input, limit) {
  const lines = contextLines(input)
  let markdown = joinContextLines(lines)
  let truncated = false
  while (markdown.length > limit) {
    truncated = true
    const depth = deepestDepth(lines)
    if (depth !== null) {
      lines.splice(lines.map(line => line.depth).lastIndexOf(depth), 1)
      markdown = joinContextLines(lines)
      continue
    }
    const date = oldestDate(lines)
    if (date !== null) {
      lines.splice(lines.map(line => line.date).lastIndexOf(date), 1)
      markdown = joinContextLines(lines)
      continue
    }
    markdown = markdown.slice(0, limit)
    break
  }
  return { markdown, chars: markdown.length, truncated }
}
