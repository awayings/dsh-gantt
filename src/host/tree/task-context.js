// Stable markdown task context for an external agent: the task's fields, its
// ancestor chain, the detail block, the completion report, and the trajectory.

import { KIND_LABELS, STATUS_LABELS, renderFocusChain, renderFocusDetail, renderTrajectory } from './chain.js'

/** @typedef {import('./build.js').TreeTaskNode} TreeTaskNode */
/** @typedef {{ action: string, sessionId: string, turn: number | null, detail: string, at: string }} ContextEvent */

/** The stable external label of a task: its ref when it has one, else its number.
 * @param {TreeTaskNode} task @returns {string} */
function labelOf(task) {
  return task.ref === '' ? task.number : task.ref
}

/** @param {string} value @returns {string} */
function oneLine(value) {
  return value.split(/\r?\n/).join('\n  ')
}

/**
 * Render the field block of one task; empty optional fields add no line.
 * @param {TreeTaskNode} task
 * @param {Map<string, string>} [agentNames] agent id → display name
 * @returns {string[]}
 */
function fieldLines(task, agentNames = new Map()) {
  const lines = [
    `- 状态：${STATUS_LABELS[task.status] ?? task.status}（${task.status}）`,
    `- 进度：${task.progress}%`,
  ]
  if (task.operatorId !== '') lines.push(`- 操作人：${agentNames.get(task.operatorId) ?? task.operatorId}`)
  if (task.completedById !== '') lines.push(`- 完成人：${agentNames.get(task.completedById) ?? task.completedById}`)
  if (task.description !== '') lines.push(`- 描述：${oneLine(task.description)}`)
  if (task.doneWhen !== '') lines.push(`- 完成标准：${task.doneWhen}`)
  lines.push(`- 起止：${task.startDate} → ${task.endDate}`)
  if (task.category !== '') lines.push(`- 分类：${task.category}`)
  if (task.estimate !== '') lines.push(`- 预估：${task.estimate}`)
  if (task.landing !== '') lines.push(`- 落地：${task.landing}`)
  if (task.inspiration !== '') lines.push(`- 灵感：${task.inspiration}`)
  if (task.dep !== '') lines.push(`- 依赖：${task.dep}`)
  if (task.links.length > 0) {
    lines.push('- 链接：')
    for (const link of task.links) {
      const label = link.label === undefined || link.label === '' ? '' : `（${link.label}）`
      lines.push(`  - ${link.type}：${link.ref}${label}`)
    }
  }
  return lines
}

/**
 * Render the task context an external agent pulls by task id. Pure and
 * deterministic: it never reads the clock and never reorders events.
 * @param {TreeTaskNode[]} tasks
 * @param {TreeTaskNode} task
 * @param {ContextEvent[]} events
 * @param {Map<string, string>} [agentNames] agent id → display name
 * @returns {string}
 */
export function renderTaskContext(tasks, task, events, agentNames = new Map()) {
  const kind = KIND_LABELS[task.kind] ?? task.kind
  const lines = [
    `# 任务上下文：${labelOf(task)} ${task.title}（${kind}）`,
    ...fieldLines(task, agentNames),
    '',
    ...renderFocusChain(tasks, task).map((line, index) => (
      index === 0 ? '## 任务链路（从支线根到当前任务）' : line
    )),
  ]
  const detail = renderFocusDetail(tasks, task, agentNames)
  lines.push(...detail.map((line, index) => (index === 1 ? '## 当前任务' : line)))
  if (task.report !== '') lines.push('', '## 汇报结果', '', task.report)
  lines.push('', '## 任务轨迹')
  if (events.length === 0) lines.push('（暂无会话记录）')
  else lines.push(...renderTrajectory(events))
  return `${lines.join('\n')}\n`
}
