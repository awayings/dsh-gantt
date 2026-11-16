// Focus-chain rendering for the assistant: the path from the track root down to
// the task a conversation is focused on, plus that task's own detail. The
// assistant tools read the same lines the old chat prompt used, so the model
// sees exactly the context the user selected in the sidebar panel.

import { sessionDisplay } from '../../shared/session.js'
import { DECOMPOSE_MAX_DEPTH, flattenTree } from '../tree.js'

/** @typedef {import('../tree.js').TreeTaskNode} TreeTaskNode */

/** Human labels for the task status vocabulary. @type {Record<string, string>} */
export const STATUS_LABELS = { todo: '待办', in_progress: '进行中', blocked: '阻塞', done: '已完成', cancelled: '已废弃' }

/** Human labels for the task-kind vocabulary. @type {Record<string, string>} */
export const KIND_LABELS = { track: '支线', node: '节点', task: '任务' }

/** Human labels for the recorded trajectory actions. @type {Record<string, string>} */
export const ACTION_LABELS = { create: '创建', update: '更新', complete: '完成', decompose: '拆解', track: '记录' }

/** Render recorded trajectory events as markdown lines, newest first. `titles`
 * optionally maps a session id to the conversation title the host resolved;
 * without it the line keeps the compact id so a UUID never dominates the text.
 * @param {{ action: string, sessionId: string, turn: number | null, detail: string, at: string }[]} events
 * @param {Map<string, string> | null} [titles]
 * @returns {string[]} */
export function renderTrajectory(events, titles = null) {
  return events.map((event) => {
    const action = ACTION_LABELS[event.action] ?? event.action
    const session = event.sessionId === ''
      ? '由手动接口写入'
      : `会话 ${sessionDisplay(event.sessionId, titles?.get(event.sessionId))}`
    const turn = event.turn === null ? '轮次未知' : `第 ${event.turn} 轮`
    const detail = event.detail === '' ? '' : `：${event.detail}`
    return `- ${action} · ${session} · ${turn} · ${event.at}${detail}`
  })
}

/** Resolve one task in the rendered tree by id.
 * @param {TreeTaskNode[]} tasks @param {string | null} taskId
 * @returns {TreeTaskNode | null} */
export function findFocus(tasks, taskId) {
  if (taskId === null || taskId === '') return null
  return flattenTree(tasks).find(task => task.id === taskId) ?? null
}

/** Depth of one task in the rendered tree, counting the root as depth 1.
 * @param {TreeTaskNode[]} tasks @param {string} taskId
 * @returns {number} */
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

/** Render the focused task's chain from its track root down to the task itself.
 * @param {TreeTaskNode[]} tasks @param {TreeTaskNode} focus
 * @returns {string[]} */
export function renderFocusChain(tasks, focus) {
  const byId = new Map(flattenTree(tasks).map(task => [task.id, task]))
  /** @type {TreeTaskNode[]} */
  const chain = []
  const seen = new Set()
  /** @type {TreeTaskNode | undefined} */
  let current = focus
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id)
    chain.unshift(current)
    /** @type {string | null} */
    const parentId = current.parentId
    current = typeof parentId === 'string' && parentId !== '' ? byId.get(parentId) : undefined
  }
  const lines = ['## 聚焦任务链路（从支线根到聚焦任务）']
  for (const [index, task] of chain.entries()) {
    const ref = task.ref === '' ? task.number : task.ref
    const kind = KIND_LABELS[task.kind] ?? '任务'
    const status = STATUS_LABELS[task.status] ?? task.status
    const current = task.id === focus.id ? ' · 当前聚焦' : ''
    lines.push(`${'  '.repeat(index)}- ${ref} ${task.title}（${kind} · ${status}${current}）`)
    if (task.doneWhen !== '') lines.push(`${'  '.repeat(index + 1)}完成标准：${task.doneWhen}`)
  }
  return lines
}

/** Render the focused task's own fields and its direct children.
 * @param {TreeTaskNode[]} tasks @param {TreeTaskNode} focus
 * @returns {string[]} */
export function renderFocusDetail(tasks, focus) {
  const depth = depthOf(tasks, focus.id)
  const ref = focus.ref === '' ? focus.number : focus.ref
  // The description is optional user text; a multi-line value keeps its line
  // breaks under one list item, and an absent value adds no line at all (an
  // empty field must not leave a blank line in the rendered context).
  const description = typeof focus.description === 'string' ? focus.description : ''
  const lines = [
    '',
    '## 当前聚焦任务（拆解对象）',
    `- 点号 id：${ref}`,
    `- 内部 id：${focus.id}`,
    `- 标题：${focus.title}`,
    ...(description === '' ? [] : [`- 描述：${description.split(/\r?\n/).join('\n  ')}`]),
    `- 层级：第 ${depth} 层（上限 ${DECOMPOSE_MAX_DEPTH} 层）`,
    `- 状态：${STATUS_LABELS[focus.status] ?? focus.status}`,
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
