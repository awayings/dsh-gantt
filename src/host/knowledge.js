// Knowledge tools for the gantt-long-run preset. Unlike the six task tools in
// tools.js, which the host plugin registers for every conversation, these two
// register only inside the preset's tools layer: a long-run dispatcher saves
// and queries its task-location judgments here, and standard conversations
// never see the pair. The tools write through the store facade (no sandboxed
// file or shell work), so they need no approval.

import { flattenTree } from './tree.js'
import { resolveTaskId, sessionOriginOf } from './tools.js'
import { KNOWLEDGE_KINDS, queryKnowledge, saveKnowledge } from './store/knowledge.js'

/** @typedef {import('./store.js').GanttStore} GanttStore */
/** @typedef {import('./tools.js').GanttTool} GanttTool */
/** @typedef {import('./store/knowledge.js').KnowledgeEntry} KnowledgeEntry */

/** Model-facing tool names. */
export const KNOWLEDGE_TOOL_NAMES = {
  save: 'gantt_knowledge_save',
  query: 'gantt_knowledge_query',
}

/** Content characters one query result renders per entry. */
const EXCERPT_CHARS = 240

/** Rendered label of one task: its external ref, else its point number.
 * @param {any} node
 * @returns {string}
 */
function taskLabel(node) {
  return node.ref === '' ? node.number : node.ref
}

/**
 * Cut one entry's content to {@link EXCERPT_CHARS} code points.
 * @param {string} content
 * @returns {string}
 */
function excerpt(content) {
  const chars = [...content]
  return chars.length <= EXCERPT_CHARS ? content : `${chars.slice(0, EXCERPT_CHARS).join('')}…`
}

/**
 * Render the query result as markdown: one header line, then id, linked task,
 * date, and tags per entry beside a bounded content excerpt.
 * @param {GanttStore} store
 * @param {KnowledgeEntry[]} entries
 * @returns {string}
 */
function renderEntries(store, entries) {
  if (entries.length === 0) return '（知识库暂无匹配条目。）'
  const labels = new Map(flattenTree(store.tree()).map(node => [node.id, taskLabel(node)]))
  const lines = [`# 知识库查询结果（${entries.length} 条）`]
  for (const entry of entries) {
    const linked = entry.taskId === null ? '未关联任务' : `任务 ${/** @type {string} */ (labels.get(entry.taskId))}`
    const meta = [entry.id, linked, entry.createdAt.slice(0, 10)]
    if (entry.tags.length > 0) meta.push(entry.tags.join('/'))
    lines.push(`- [${entry.kind}] ${entry.title}（${meta.join(' · ')}）`)
    lines.push(`  ${excerpt(entry.content)}`)
  }
  return lines.join('\n')
}

/**
 * Build the knowledge tool definitions. Kept pure so the host tests can call
 * each tool without a live tools service.
 * @param {GanttStore} store
 * @returns {GanttTool[]}
 */
export function knowledgeToolDefinitions(store) {
  return [
    {
      name: KNOWLEDGE_TOOL_NAMES.save,
      description: '把一条任务判定知识写入甘特图知识库：为什么落在某个任务、对这次判定的评价与反馈、可复用的经验教训。任务定位后收尾前调用；taskId 指向落点任务。知识存进库表，不留在对话里。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: '可选，整体替换已有条目的 id；省略则新建一条。' },
          kind: { type: 'string', enum: [...KNOWLEDGE_KINDS], description: '可选，默认 lesson：lesson=经验教训、feedback=对一次判定的评价反馈、note=一般笔记。' },
          title: { type: 'string', description: '一句话标题。' },
          content: { type: 'string', description: '正文：判定依据、评价、经验或教训（最多 4000 字符）。' },
          taskId: { type: 'string', description: '可选，关联的落点任务：内部 id、点号 id 或编号（如 1.8.1）。' },
          tags: { type: 'array', items: { type: 'string' }, description: '可选，标签，最多 20 个。' },
        },
        required: ['title', 'content'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
          required: ['ok', 'message'],
        },
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args, exec) {
        const taskId = typeof args.taskId === 'string' && args.taskId.trim() !== '' ? resolveTaskId(store, args.taskId) : null
        const origin = sessionOriginOf(exec)
        const entry = saveKnowledge(store, {
          id: args.id,
          kind: args.kind,
          title: args.title,
          content: args.content,
          taskId,
          tags: args.tags,
        }, origin)
        const linked = entry.taskId === null ? '未关联任务' : `关联 ${taskLabel(/** @type {any} */ (store.getNode(entry.taskId)))}`
        const recorded = origin === undefined ? '' : '\n已自动记录会话与轮次索引。'
        return { ok: true, message: `已保存知识「${entry.title}」（${entry.kind}，${linked}）。${recorded}` }
      },
    },
    {
      name: KNOWLEDGE_TOOL_NAMES.query,
      description: '查询甘特图知识库里过往的任务判定与经验：按关键词、关联任务、类型或标签过滤，默认返回最近的 8 条。定位任务前先查一次同类请求的历史判定，避免重复踩坑。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: '可选，关键词，匹配标题或正文。' },
          taskId: { type: 'string', description: '可选，只看关联到该任务的知识：内部 id、点号 id 或编号。' },
          kind: { type: 'string', enum: [...KNOWLEDGE_KINDS], description: '可选，按类型过滤。' },
          tag: { type: 'string', description: '可选，按标签过滤。' },
          limit: { type: 'integer', description: '可选，返回条数，默认 8，最大 50。' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, markdown: { type: 'string' } },
          required: ['ok', 'markdown'],
        },
        render: (_args, value) => [{ type: 'text', text: value.markdown }],
      },
      async execute(args) {
        const taskId = typeof args.taskId === 'string' && args.taskId.trim() !== '' ? resolveTaskId(store, args.taskId) : null
        const entries = queryKnowledge(store, {
          query: args.query,
          taskId,
          kind: args.kind,
          tag: args.tag,
          limit: args.limit,
        })
        return { ok: true, markdown: renderEntries(store, entries) }
      },
    },
  ]
}

/**
 * Register the knowledge tools on the calling scope's tools service. The
 * preset keeps working without that service (unit harnesses, headless
 * profiles), so a missing service is not an error.
 * @param {{ get?: (name: string) => unknown, effect?: (fn: () => () => void, hint?: string) => unknown }} ctx
 * @param {GanttStore} store
 * @returns {void}
 */
export function registerKnowledgeTools(ctx, store) {
  const tools = /** @type {{ register?: (definition: GanttTool) => () => void } | undefined} */ (
    typeof ctx.get === 'function' ? ctx.get('tools') : undefined
  )
  if (tools === undefined || tools === null || typeof tools.register !== 'function') return
  // ToolsService.register reads its own registry (`this.layers`), so keep the
  // service as the receiver instead of detaching the method.
  const register = tools.register.bind(tools)
  /** @type {Array<() => void>} */
  const disposers = knowledgeToolDefinitions(store).map(definition => register(definition))
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const dispose of disposers) dispose()
    }, 'gantt long-run: knowledge tools')
  }
}
