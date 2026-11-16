// Model-facing task protocol and per-conversation background context.
//
// The static protocol section teaches every conversation how a Gantt task is
// finished: complete it, partially complete it and decompose the rest, or only
// decompose it. The dynamic context registers the focused task's ancestor chain
// and its recent trajectory for the calling conversation; DSH materializes a
// new runtime-context snapshot only when the rendered text changes, so the
// cache prefix stays stable while the focus moves.

import { findFocus, renderFocusChain, renderFocusDetail, renderTrajectory } from './tree/chain.js'

/** @typedef {import('./store.js').GanttStore} GanttStore */

/** Static protocol section injected into every system prompt. */
export const PROTOCOL_SECTION = `## 甘特图任务协议

本部署把会话的工作单元挂在甘特图上：用户在右侧甘特 tab 选中的「聚焦任务」及其全部祖先链路会作为运行时上下文注入本会话；推进任务的过程由插件自动记录为任务轨迹（会话 id + 轮次索引）。会话本身就是不断完成甘特图任务的过程。

工作方式：
- 开始工作前先阅读注入的聚焦链路；需要子任务、完成标准或最近轨迹时调用 \`gantt_context\`。
- 任务写入一律通过工具完成，校验在 store 层；插件不会调用模型，也不会替你自动改任务。
- 每次写入都会自动带上本会话 id 与当前轮次，不要把这些值写进标题、描述或完成标准。

输出要求（任务收尾时按情况选一种）：
1. 任务已直接完成：调用 \`gantt_update_task\` 把 status 设为 \`done\`（progress 自动 100），并用 \`summary\` 记录完成证据（产出了什么、在哪里验证）。
2. 只完成了一部分：先用 \`gantt_update_task\` 把已完成部分更新为 \`in_progress\` 与相应进度，并用 \`summary\` 说明已完成什么；剩余工作必须用 \`gantt_decompose\` 拆成可独立验证的子任务（每个都要有 \`doneWhen\`），不要留下模糊的“剩余工作”。
3. 纯任务拆解（本轮不动手实施）：不要改状态，只调用 \`gantt_decompose\` 创建子任务。
4. 任务被阻塞：用 \`gantt_update_task\` 设为 \`blocked\`，并在 \`summary\` 写明阻塞条件。

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
