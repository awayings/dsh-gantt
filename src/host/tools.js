// Host-side assistant tools. A DSH conversation gets gantt_context,
// gantt_decompose, and gantt_update_task on the host tools service, so the
// model can read the chain the user focused in the sidebar panel and write
// decomposition results straight into the task tree. The tools write through
// the store (no sandboxed file or shell work), so they need no approval.

import { GanttError } from './errors.js'
import { flattenTree } from './tree.js'
import { STATUS_LABELS, findFocus, renderFocusChain, renderFocusDetail } from './tree/chain.js'

/** @typedef {import('./store.js').GanttStore} GanttStore */
/** @typedef {{ name: string, description: string, parameters: Record<string, unknown>,
 * output: { schema: Record<string, unknown>, render: (args: unknown, value: any) => any[] },
 * execute: (args: any, exec: any) => Promise<unknown> }} GanttTool */

/** Model-facing tool names. */
export const TOOL_NAMES = {
  context: 'gantt_context',
  decompose: 'gantt_decompose',
  update: 'gantt_update_task',
}

const MAX_CONTEXT_CHARS = 6000

/**
 * Resolve a model-supplied task reference to the internal id: the exact id, a
 * track/node ref, or the rendered point number (1.1.1) all work.
 * @param {GanttStore} store
 * @param {unknown} value
 * @returns {string}
 */
export function resolveTaskId(store, value) {
  if (typeof value !== 'string' || value.trim() === '') throw new GanttError('id is required')
  const input = value.trim()
  if (store.getRow(input) !== null) return input
  const match = flattenTree(store.tree()).find(node => (node.ref !== '' && node.ref === input) || node.number === input)
  if (match === undefined) throw new GanttError(`task ${input} was not found`, 404)
  return match.id
}

/**
 * @param {GanttStore} store
 * @param {unknown} sessionId
 * @returns {string}
 */
function contextMarkdown(store, sessionId) {
  const snapshot = store.snapshot()
  const tasks = snapshot.tasks
  const focus = findFocus(tasks, typeof sessionId === 'string' ? store.focusOf(sessionId) : null)
  const stats = snapshot.stats
  const lines = [
    `# 甘特图任务上下文（今天 ${snapshot.today}）`,
    `- 任务总数：${stats.total}，进行中 ${stats.inProgress}，已完成 ${stats.done}，逾期 ${stats.overdue}`,
  ]
  if (focus !== null) {
    lines.push('', ...renderFocusChain(tasks, focus), ...renderFocusDetail(tasks, focus))
  } else {
    lines.push(
      '',
      '## 当前会话没有聚焦任务',
      '用户可以在右侧甘特图面板点选一个任务来聚焦，也可以直接说出任务标题或点号 id。下面是整棵树的上下文：',
      '',
      store.contextDocument({ limit: MAX_CONTEXT_CHARS }).markdown,
    )
  }
  return lines.join('\n')
}

/**
 * @param {GanttStore} store
 * @param {any} args
 * @returns {{ ok: boolean, message: string }}
 */
function decompose(store, args) {
  const parentId = resolveTaskId(store, args.id)
  const result = store.decompose(parentId, Array.isArray(args.children) ? args.children : [], args.planDate)
  const parent = result.parent
  const parentRef = parent === null ? args.id : (parent.ref === '' ? parent.number : parent.ref)
  const created = result.children.map(node => `- ${node.ref === '' ? node.number : node.ref} ${node.title}（完成标准：${node.doneWhen}）`)
  return {
    ok: true,
    message: [`已在 ${parentRef} ${parent === null ? '' : parent.title} 下创建 ${result.children.length} 个子任务：`, ...created].join('\n'),
  }
}

/**
 * @param {GanttStore} store
 * @param {any} args
 * @returns {{ ok: boolean, message: string }}
 */
function updateTask(store, args) {
  const id = resolveTaskId(store, args.id)
  /** @type {Record<string, unknown>} */
  const patch = {}
  for (const field of ['title', 'status', 'progress', 'doneWhen']) {
    if (args[field] !== undefined) patch[field] = args[field]
  }
  if (Object.keys(patch).length === 0) throw new GanttError('nothing to update')
  const task = store.update(id, patch)
  if (task === null) throw new GanttError(`task ${id} was not found`, 404)
  return { ok: true, message: `已更新 ${task.ref === '' ? task.number : task.ref} ${task.title}：状态 ${STATUS_LABELS[task.status] ?? task.status}，进度 ${task.progress}%。` }
}

/**
 * Build the tool definitions. Kept pure so the host tests can call each tool
 * without a live tools service.
 * @param {GanttStore} store
 * @returns {GanttTool[]}
 */
export function toolDefinitions(store) {
  return [
    {
      name: TOOL_NAMES.context,
      description: '读取用户的甘特图任务树，以及本会话当前聚焦的任务：该任务到支线根的链路、完成标准、直接子任务，或（未聚焦时）整棵树。拆解任务或回答任务问题前先调用它。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, markdown: { type: 'string' } },
          required: ['ok', 'markdown'],
        },
        render: (_args, value) => [{ type: 'text', text: value.markdown }],
      },
      async execute(_args, exec) {
        return { ok: true, markdown: contextMarkdown(store, exec?.agent?.session?.id) }
      },
    },
    {
      name: TOOL_NAMES.decompose,
      description: '把一个甘特图任务拆成子任务并写入任务树。父任务用 gantt_context 返回的聚焦任务；每个子任务必须有可验证的完成标准（doneWhen），最多 4 层、单次最多 100 个。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: '父任务：内部 id、点号 id 或编号（如 1.1.1）。' },
          planDate: { type: 'string', description: '可选，YYYY-MM-DD，只作为子任务默认起止日期。' },
          children: {
            type: 'array',
            description: '要创建的子任务（1–100 个）。',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', description: '子任务标题。' },
                doneWhen: { type: 'string', description: '可验证的完成标准：做完了吗？怎么证明？' },
                estimate: { type: 'string', description: '可选，预计耗时，如 30min。' },
                category: { type: 'string', description: '可选，A/B 类或自定义分类。' },
                landing: { type: 'string', description: '可选，落点。' },
                inspiration: { type: 'string', description: '可选，灵感来源。' },
                status: { type: 'string', enum: ['todo', 'in_progress', 'blocked', 'done'], description: '可选，默认 todo。' },
              },
              required: ['title', 'doneWhen'],
            },
          },
        },
        required: ['id', 'children'],
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
      async execute(args) {
        return decompose(store, args)
      },
    },
    {
      name: TOOL_NAMES.update,
      description: '更新一个甘特图任务的状态、进度、标题或完成标准。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: '任务：内部 id、点号 id 或编号（如 1.1.1）。' },
          status: { type: 'string', enum: ['todo', 'in_progress', 'blocked', 'done'], description: '可选，新状态。' },
          progress: { type: 'integer', description: '可选，0–100 的进度。' },
          title: { type: 'string', description: '可选，新标题。' },
          doneWhen: { type: 'string', description: '可选，新的完成标准。' },
        },
        required: ['id'],
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
      async execute(args) {
        return updateTask(store, args)
      },
    },
  ]
}

/**
 * Register the assistant tools on the host tools service. The plugin keeps
 * working without that service (unit harnesses, headless profiles), so a
 * missing service is not an error.
 * @param {{ get?: (name: string) => unknown, effect?: (fn: () => () => void, hint?: string) => unknown }} ctx
 * @param {GanttStore} store
 * @returns {void}
 */
export function registerTools(ctx, store) {
  const tools = /** @type {{ register?: (definition: GanttTool) => () => void } | undefined} */ (
    typeof ctx.get === 'function' ? ctx.get('tools') : undefined
  )
  if (tools === undefined || tools === null || typeof tools.register !== 'function') return
  const register = tools.register
  /** @type {Array<() => void>} */
  const disposers = toolDefinitions(store).map(definition => register(definition))
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const dispose of disposers) dispose()
    }, 'gantt: assistant tools')
  }
}
