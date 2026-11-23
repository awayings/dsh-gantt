// Host-side assistant tools. A DSH conversation gets gantt_context,
// gantt_decompose, gantt_update_task, gantt_track, gantt_create_task, and
// gantt_capture on the host tools service, so the model can read the chain the
// user focused in the sidebar panel and write track associations, siblings,
// decomposition results, and captured ideas straight into the task tree. The
// tools write through the store (no sandboxed file or shell work), so they
// need no approval.

import { GanttError } from './errors.js'
import { flattenTree } from './tree.js'
import { STATUS_LABELS, findFocus, renderFocusChain, renderFocusDetail, renderTrajectory } from './tree/chain.js'

/** @typedef {import('./store.js').GanttStore} GanttStore */
/** @typedef {{ name: string, description: string, parameters: Record<string, unknown>,
 * output: { schema: Record<string, unknown>, render: (args: unknown, value: any) => any[] },
 * execute: (args: any, exec: any) => Promise<unknown> }} GanttTool */

/** Model-facing tool names. */
export const TOOL_NAMES = {
  context: 'gantt_context',
  decompose: 'gantt_decompose',
  update: 'gantt_update_task',
  track: 'gantt_track',
  createTask: 'gantt_create_task',
  capture: 'gantt_capture',
}

const MAX_CONTEXT_CHARS = 6000

/**
 * Session id of the conversation driving one tool call, or '' when the call has
 * no agent session (unit harness, direct invocation).
 * @param {any} exec
 * @returns {string}
 */
function sessionIdOf(exec) {
  const id = exec?.agent?.session?.id
  return typeof id === 'string' ? id : ''
}

/** Turn index that owns the current tool call, read from the durable log so it
 * survives a resume; null when the session is unavailable.
 * @param {any} exec
 * @returns {number | null}
 */
function currentTurn(exec) {
  const session = exec?.agent?.session
  if (typeof session?.snapshotEvents !== 'function') return null
  const start = session.snapshotEvents().findLast(/** @param {any} event */ event => event?.type === 'turn/start')
  return start?.data?.turn ?? null
}

/** Provenance for one assistant write: the calling conversation and turn plus
 * the model-supplied summary. Undefined when there is no conversation, so the
 * manual routes never fabricate a session.
 * @param {any} exec
 * @param {unknown} [summary]
 * @returns {{ sessionId: string, turn: number | null, summary: string } | undefined}
 */
function originOf(exec, summary) {
  const sessionId = sessionIdOf(exec)
  if (sessionId === '') return undefined
  return { sessionId, turn: currentTurn(exec), summary: typeof summary === 'string' ? summary : '' }
}

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
 * @param {import('./session-titles.js').SessionTitles | null} titles
 * @returns {Promise<string>}
 */
async function contextMarkdown(store, sessionId, titles) {
  const snapshot = store.snapshot()
  const tasks = snapshot.tasks
  const focus = findFocus(tasks, typeof sessionId === 'string' ? store.focusOf(sessionId) : null)
  const stats = snapshot.stats
  const lines = [
    `# 甘特图任务上下文（今天 ${snapshot.today}）`,
    `- 任务总数：${stats.total}，进行中 ${stats.inProgress}，已完成 ${stats.done}，逾期 ${stats.overdue}`,
  ]
  if (focus !== null) {
    lines.push('', ...renderFocusChain(tasks, focus), ...renderFocusDetail(tasks, focus), '', '## 任务轨迹（会话与轮次）')
    const events = store.trajectory({ taskId: focus.id, limit: 8 })
    const resolved = titles === null ? new Map() : await titles.resolve(events.map(event => event.sessionId))
    lines.push(...(events.length === 0 ? ['（暂无会话记录）'] : renderTrajectory(events, resolved)))
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
 * @param {any} exec
 * @returns {{ ok: boolean, message: string }}
 */
function decompose(store, args, exec) {
  const parentId = resolveTaskId(store, args.id)
  const origin = originOf(exec, args.summary)
  const result = store.decompose(parentId, Array.isArray(args.children) ? args.children : [], args.planDate, origin)
  const parent = result.parent
  const parentRef = parent === null ? args.id : (parent.ref === '' ? parent.number : parent.ref)
  const created = result.children.map(node => `- ${node.ref === '' ? node.number : node.ref} ${node.title}（完成标准：${node.doneWhen}）`)
  const recorded = origin === undefined ? '' : '\n已自动记录会话与轮次索引。'
  return {
    ok: true,
    message: [`已在 ${parentRef} ${parent === null ? '' : parent.title} 下创建 ${result.children.length} 个子任务：`, ...created].join('\n') + recorded,
  }
}

/**
 * @param {GanttStore} store
 * @param {any} args
 * @param {any} exec
 * @returns {{ ok: boolean, message: string }}
 */
function updateTask(store, args, exec) {
  const id = resolveTaskId(store, args.id)
  /** @type {Record<string, unknown>} */
  const patch = {}
  for (const field of ['title', 'description', 'status', 'progress', 'doneWhen']) {
    if (args[field] !== undefined) patch[field] = args[field]
  }
  if (Object.keys(patch).length === 0) throw new GanttError('nothing to update')
  const origin = originOf(exec, args.summary)
  const task = store.update(id, patch, origin)
  if (task === null) throw new GanttError(`task ${id} was not found`, 404)
  const recorded = origin === undefined ? '' : ' 已自动记录会话与轮次索引。'
  return { ok: true, message: `已更新 ${task.ref === '' ? task.number : task.ref} ${task.title}：状态 ${STATUS_LABELS[task.status] ?? task.status}，进度 ${task.progress}%。${recorded}` }
}

/**
 * Resolve the task a round-closing tool acts on: the explicit reference when
 * given, else the task the calling conversation is focused on.
 * @param {GanttStore} store
 * @param {any} args
 * @param {any} exec
 * @returns {string}
 */
function resolveTarget(store, args, exec) {
  if (typeof args.id === 'string' && args.id.trim() !== '') return resolveTaskId(store, args.id)
  const sessionId = sessionIdOf(exec)
  const focus = sessionId === '' ? null : store.focusOf(sessionId)
  if (focus === null) throw new GanttError('id is required when this conversation has no focused task')
  return focus
}

/**
 * Rendered label of one task: its external ref, else its point number.
 * @param {any} node
 * @returns {string}
 */
function taskLabel(node) {
  return node.ref === '' ? node.number : node.ref
}

/**
 * Record the current round against a task without writing the task tree.
 * @param {GanttStore} store
 * @param {any} args
 * @param {any} exec
 * @returns {{ ok: boolean, message: string }}
 */
function track(store, args, exec) {
  const taskId = resolveTarget(store, args, exec)
  const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
  if (summary === '') throw new GanttError('summary is required')
  const event = store.recordTrack({ taskId, sessionId: sessionIdOf(exec), turn: currentTurn(exec), detail: summary })
  const task = /** @type {any} */ (store.getNode(event.taskId))
  const recorded = event.turn === null ? '轮次未知' : `第 ${event.turn} 轮`
  return { ok: true, message: `已记录本轮与 ${taskLabel(task)} ${task.title} 的关联（${recorded}）。` }
}

/**
 * Capture an unshaped idea as a new child of the reference/focused task: no
 * completion standard, no schedule — just a title plus the words that sparked
 * it, kept verbatim in `inspiration`. Shaping (a doneWhen, real dates) happens
 * later, when the idea is picked up.
 * @param {GanttStore} store
 * @param {any} args
 * @param {any} exec
 * @returns {{ ok: boolean, message: string }}
 */
function capture(store, args, exec) {
  const containerId = resolveTarget(store, args, exec)
  const container = /** @type {any} */ (store.getNode(containerId))
  const origin = originOf(exec)
  const created = /** @type {import('./tree.js').TaskNode} */ (store.create({
    parentId: containerId,
    title: args.title,
    description: args.description,
    inspiration: args.inspiration,
    category: args.category,
    status: 'todo',
  }))
  // create() records no origin of its own; write the trajectory explicitly and
  // leave a track event on the container so its workbench shows the capture.
  store.recordOrigin(created.id, 'create', origin, `在 ${taskLabel(container)} 下捕捉灵感`)
  if (origin !== undefined) {
    store.recordTrack({
      taskId: containerId,
      sessionId: origin.sessionId,
      turn: origin.turn,
      detail: `captured idea ${taskLabel(created)} ${created.title}`,
    })
  }
  const recorded = origin === undefined ? '' : '\n已自动记录会话与轮次索引。'
  return {
    ok: true,
    message: `已在 ${taskLabel(container)} ${container.title} 下捕捉灵感 ${taskLabel(created)} ${created.title}（未定型：无完成标准，日期为占位）。${recorded}`,
  }
}

/**
 * Create a task right after the reference/focused task as its next sibling.
 * @param {GanttStore} store
 * @param {any} args
 * @param {any} exec
 * @returns {{ ok: boolean, message: string }}
 */
function createTask(store, args, exec) {
  const referenceId = resolveTarget(store, args, exec)
  const origin = originOf(exec)
  const created = store.createSibling(referenceId, {
    title: args.title,
    doneWhen: args.doneWhen,
    description: args.description,
    status: args.status,
    startDate: args.startDate,
    endDate: args.endDate,
  }, origin)
  const reference = /** @type {any} */ (store.getNode(referenceId))
  const recorded = origin === undefined ? '' : '\n已自动记录会话与轮次索引。'
  return {
    ok: true,
    message: `已在 ${taskLabel(reference)} ${reference.title} 之后创建同级任务 ${taskLabel(created)} ${created.title}。${recorded}`,
  }
}

/**
 * Build the tool definitions. Kept pure so the host tests can call each tool
 * without a live tools service.
 * @param {GanttStore} store
 * @param {import('./session-titles.js').SessionTitles | null} [titles]
 * @returns {GanttTool[]}
 */
export function toolDefinitions(store, titles = null) {
  return [
    {
      name: TOOL_NAMES.context,
      description: '读取用户的甘特图任务树，以及本会话当前聚焦的任务：该任务到支线根的链路、完成标准、直接子任务、最近的会话与轮次轨迹，或（未聚焦时）整棵树。拆解任务或回答任务问题前先调用它。',
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
        return { ok: true, markdown: await contextMarkdown(store, exec?.agent?.session?.id, titles) }
      },
    },
    {
      name: TOOL_NAMES.decompose,
      description: '把一个甘特图任务拆成子任务并写入任务树。父任务用 gantt_context 返回的聚焦任务；每个子任务必须有可验证的完成标准（doneWhen），最多 4 层、单次最多 100 个。写入会自动记录本会话 id 与轮次索引。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: '父任务：内部 id、点号 id 或编号（如 1.1.1）。' },
          planDate: { type: 'string', description: '可选，YYYY-MM-DD，只作为子任务默认起止日期。' },
          summary: { type: 'string', description: '可选，这次拆解的说明（写入任务轨迹）。' },
          children: {
            type: 'array',
            description: '要创建的子任务（1–100 个）。',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', description: '子任务标题。' },
                doneWhen: { type: 'string', description: '可验证的完成标准：做完了吗？怎么证明？' },
                description: { type: 'string', description: '可选，子任务描述（纯文本或 markdown，最多 4000 字符）。' },
                estimate: { type: 'string', description: '可选，预计耗时，如 30min。' },
                category: { type: 'string', description: '可选，A/B 类或自定义分类。' },
                landing: { type: 'string', description: '可选，落点。' },
                inspiration: { type: 'string', description: '可选，灵感来源。' },
                status: { type: 'string', enum: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'], description: '可选，默认 todo。' },
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
      async execute(args, exec) {
        return decompose(store, args, exec)
      },
    },
    {
      name: TOOL_NAMES.update,
      description: '更新一个甘特图任务的状态、进度、标题、描述或完成标准。标记 done 会自动记录完成它的会话与轮次；用 summary 写完成证据或更新说明。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: '任务：内部 id、点号 id 或编号（如 1.1.1）。' },
          status: { type: 'string', enum: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'], description: '可选，新状态；cancelled 表示废弃，不计入父任务进度。' },
          progress: { type: 'integer', description: '可选，0–100 的进度。' },
          title: { type: 'string', description: '可选，新标题。' },
          description: { type: 'string', description: '可选，新描述（纯文本或 markdown，最多 4000 字符；传空字符串清空）。' },
          doneWhen: { type: 'string', description: '可选，新的完成标准。' },
          summary: { type: 'string', description: '可选，完成证据或更新说明（写入任务轨迹）。' },
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
      async execute(args, exec) {
        return updateTask(store, args, exec)
      },
    },
    {
      name: TOOL_NAMES.track,
      description: '记录本轮到甘特图任务的轨迹关联：本轮没有任务树写入时用它收尾。不传 id 时默认使用本会话的聚焦任务；summary 写清本轮做了什么。写入会自动记录本会话 id 与轮次索引。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: '任务：内部 id、点号 id 或编号（如 1.1.1）；省略时使用本会话的聚焦任务。' },
          summary: { type: 'string', description: '本轮做了什么（写入任务轨迹）。' },
        },
        required: ['summary'],
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
        return track(store, args, exec)
      },
    },
    {
      name: TOOL_NAMES.createTask,
      description: '在当前聚焦任务之后创建一个同级任务并写入任务树。不传 id 时默认使用本会话的聚焦任务；至少给出 title，建议同时给出可验证的 doneWhen。写入会自动记录本会话 id 与轮次索引。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: '参照任务：内部 id、点号 id 或编号（如 1.1.1）；省略时使用本会话的聚焦任务。' },
          title: { type: 'string', description: '新同级任务的标题。' },
          doneWhen: { type: 'string', description: '可选，可验证的完成标准：做完了吗？怎么证明？' },
          description: { type: 'string', description: '可选，说明或备注。' },
          status: { type: 'string', enum: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'], description: '可选，默认 todo。' },
          startDate: { type: 'string', description: '可选，YYYY-MM-DD。' },
          endDate: { type: 'string', description: '可选，YYYY-MM-DD。' },
        },
        required: ['title'],
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
        return createTask(store, args, exec)
      },
    },
    {
      name: TOOL_NAMES.capture,
      description: '把一条未定型的灵感捕捉进任务树：在 id 所指的支线或任务下创建子任务，不写完成标准、不排期（日期为占位），灵感原话放进 inspiration 字段，之后由人挑时间定型。与 gantt_create_task 的分工：create_task 是已定型任务（建议带 doneWhen），capture 是先落账后定型。不传 id 时默认捕捉到本会话聚焦任务之下。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: '捕捉到哪条支线或任务下：内部 id、点号 id 或编号（如 1 或 1.4）；省略时使用本会话的聚焦任务。' },
          title: { type: 'string', description: '一句话标题。' },
          inspiration: { type: 'string', description: '灵感原话或来源，尽量原样保留。' },
          description: { type: 'string', description: '可选，补充说明（最多 4000 字符）。' },
          category: { type: 'string', description: '可选，类别。' },
        },
        required: ['title'],
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
        return capture(store, args, exec)
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
 * @param {import('./session-titles.js').SessionTitles | null} [titles]
 * @returns {void}
 */
export function registerTools(ctx, store, titles = null) {
  const tools = /** @type {{ register?: (definition: GanttTool) => () => void } | undefined} */ (
    typeof ctx.get === 'function' ? ctx.get('tools') : undefined
  )
  if (tools === undefined || tools === null || typeof tools.register !== 'function') return
  // ToolsService.register reads its own registry (`this.layers`), so keep the
  // service as the receiver instead of detaching the method.
  const register = tools.register.bind(tools)
  /** @type {Array<() => void>} */
  const disposers = toolDefinitions(store, titles).map(definition => register(definition))
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const dispose of disposers) dispose()
    }, 'gantt: assistant tools')
  }
}
