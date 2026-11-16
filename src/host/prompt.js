// Model-facing task protocol and per-conversation background context.
//
// The static protocol section teaches every conversation how a Gantt task is
// finished: close each round with exactly one of gantt_track, gantt_update_task,
// gantt_decompose, or gantt_create_task — complete the task, advance it, open
// subtasks, open a sibling, or record the round without a tree write. The
// dynamic context registers the focused task's ancestor chain and its recent
// trajectory for the calling conversation; DSH materializes a new
// runtime-context snapshot only when the rendered text changes, so the cache
// prefix stays stable while the focus moves.

import { findFocus, renderFocusChain, renderFocusDetail, renderTrajectory } from './tree/chain.js'

/** @typedef {import('./store.js').GanttStore} GanttStore */

/** Static protocol section injected into every system prompt. */
export const PROTOCOL_SECTION = `## 甘特图任务协议

本部署把会话的工作单元挂在甘特图上：用户在右侧甘特 tab 或「工作台」tab 聚焦的任务及其全部祖先链路会作为运行时上下文注入本会话；推进任务的过程由插件自动记录为任务轨迹（会话 id + 轮次索引）。工作模式为任务打开的专属会话就是该任务的内容专用主会话，是这个任务的工作现场，不是旁路聊天；会话本身就是不断完成甘特图任务的过程。

工作方式：
- 开始工作前先阅读注入的聚焦链路；需要子任务、完成标准或最近轨迹时调用 \`gantt_context\`。
- 任务写入一律通过工具完成，校验在 store 层；插件不会调用模型，也不会替你自动改任务。
- 每次写入都会自动带上本会话 id 与当前轮次，不要把这些值写进标题、描述或完成标准。
- 「工作台」tab 按会话与轮次列出这些记录：轨迹、专属对话、可用技能、该会话的编队（子 Agent）。

适用范围：下面的强制收尾只针对有聚焦任务的会话（工作模式打开的专属会话一定有聚焦任务）；\`gantt_context\` 显示没有聚焦任务、也没有任务映射的会话不适用，不要为了满足格式去编造任务关联。

收尾硬性要求（memory-evolve 式）：每一轮都必须以下面四个工具调用之一收尾，且只能有一个——先做事，再用一个工具调用落账；只回复文字、不以这四个工具之一收尾是不允许的。
1. 本轮没有写任务树：调用 \`gantt_track\`，用 \`summary\` 写清本轮做了什么，把这一轮与聚焦任务关联起来。
2. 任务有推进、完成或阻塞：调用 \`gantt_update_task\`，更新 status/progress，并用 \`summary\` 写完成证据或阻塞条件。
3. 本轮拆出了新子任务：调用 \`gantt_decompose\`，父任务用当前聚焦任务，每个子任务必须有可验证的 \`doneWhen\`（最多 4 层、单次最多 100 个）。
4. 本轮开了一个新的同级节点：调用 \`gantt_create_task\`，在聚焦任务之后插入，写清 title 与 \`doneWhen\`。

任务收尾时按情况选一种并落账：
- 任务已直接完成：\`gantt_update_task\` 把 status 设为 \`done\`（progress 自动 100），\`summary\` 记录产出了什么、在哪里验证。
- 只完成了一部分：\`gantt_update_task\` 把已完成部分更新为 \`in_progress\` 与相应进度，并用 \`summary\` 说明已完成什么；剩余工作必须用 \`gantt_decompose\` 拆成可独立验证的子任务，不要留下模糊的“剩余工作”。
- 纯任务拆解（本轮不动手实施）：不要改状态，只调用 \`gantt_decompose\` 创建子任务。
- 任务被阻塞：\`gantt_update_task\` 设为 \`blocked\`，并在 \`summary\` 写明阻塞条件。

收尾回复用点号编号（如 1.2.1）引用任务，说明状态变化与新增子任务；需要回看历史时使用 \`gantt_context\` 里的任务轨迹（会话 id + 轮次）。`

/** Render the automatic background context for one conversation: the focused
 * task's ancestor chain, its own detail, and its recent trajectory. Returns ''
 * when the conversation has no focus, so DSH materializes no snapshot.
 * @param {GanttStore} store
 * @param {unknown} sessionId
 * @returns {string}
 */
export function renderFocusContext(store, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return ''
  /** @type {string | null} */
  let focusId
  try {
    focusId = store.focusOf(sessionId)
  } catch {
    // A malformed session id must not fail prompt assembly for the request.
    return ''
  }
  const tasks = store.tree()
  const focus = findFocus(tasks, focusId)
  if (focus === null) return ''
  const events = store.trajectory({ taskId: focus.id, limit: 5 })
  return [
    '# 甘特图聚焦上下文',
    ...renderFocusChain(tasks, focus),
    ...renderFocusDetail(tasks, focus),
    '',
    '## 任务轨迹（会话与轮次）',
    ...(events.length === 0 ? ['（暂无会话记录）'] : renderTrajectory(events)),
  ].join('\n')
}

/** Register the static protocol section and the dynamic focus context on the
 * host's system-prompt service. Interpolation is disabled because task titles
 * are user data and may contain brace sequences the renderer would reject.
 * @param {import('./routes/http.js').GanttContext} ctx
 * @param {GanttStore} store
 * @returns {void}
 */
export function installPrompt(ctx, store) {
  const prompt = /** @type {{ section: (section: unknown) => () => void, context: (context: unknown) => () => void }} */ (ctx.systemPrompt)
  ctx.effect(() => prompt.section({
    name: 'gantt:protocol',
    order: 700,
    text: PROTOCOL_SECTION,
    interpolate: false,
  }), 'gantt: task protocol section')
  ctx.effect(() => prompt.context({
    name: 'gantt:focus',
    order: 530,
    text: /** @param {any} context */ context => renderFocusContext(store, context?.agent?.session?.id),
    interpolate: false,
  }), 'gantt: focused task context')
}
