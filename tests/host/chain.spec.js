import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore } from '../../src/host/store.js'
import { findFocus, depthOf, renderFocusChain, renderFocusDetail, renderTrajectory } from '../../src/host/tree/chain.js'

/** @typedef {import('../../src/host/tree.js').TreeTaskNode} TreeTaskNode */

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** Build a track → node → task chain in the store and return the tree. */
function seededTree() {
  const track = store.create({ title: 'Content platform', kind: 'track', ref: 'T1' })
  const node = store.create({ title: 'Weekly report', parentId: track.id })
  const task = store.create({ title: 'Collect data', parentId: node.id, doneWhen: 'Data table ready' })
  return { track, node, task, tasks: /** @type {TreeTaskNode[]} */ (store.tree()) }
}

describe('focus chain helpers', () => {
  it('finds a task by id and returns null for an empty or unknown id', () => {
    const { task, tasks } = seededTree()
    expect(findFocus(tasks, task.id)?.title).toBe('Collect data')
    expect(findFocus(tasks, null)).toBeNull()
    expect(findFocus(tasks, '')).toBeNull()
    expect(findFocus(tasks, 'missing')).toBeNull()
  })

  it('counts depth from the root and treats an unknown task as depth 1', () => {
    const { task, tasks } = seededTree()
    expect(depthOf(tasks, task.id)).toBe(3)
    expect(depthOf(tasks, 'missing')).toBe(1)
  })

  it('renders the chain from the track root down to the focus', () => {
    const { track, node, task, tasks } = seededTree()
    const focus = /** @type {TreeTaskNode} */ (findFocus(tasks, task.id))
    const lines = renderFocusChain(tasks, focus)
    expect(lines[0]).toBe('## 聚焦任务链路（从支线根到聚焦任务）')
    expect(lines[1]).toBe(`- T1 ${track.title}（支线 · 待办）`)
    expect(lines[2]).toBe(`  - ${node.number} ${node.title}（任务 · 待办）`)
    expect(lines[3]).toBe(`    - ${task.number} ${task.title}（任务 · 待办 · 当前聚焦）`)
    expect(lines[4]).toBe(`      完成标准：${task.doneWhen}`)
  })

  it('falls back to the raw kind and status for unknown vocabulary', () => {
    const fake = /** @type {any} */ ({
      id: 'x',
      title: 'Weird',
      kind: 'weird',
      status: 'odd',
      ref: '',
      number: '9',
      doneWhen: '',
      parentId: null,
      children: [],
    })
    const lines = renderFocusChain([fake], fake)
    expect(lines[1]).toBe('- 9 Weird（任务 · odd · 当前聚焦）')
    expect(lines).toHaveLength(2)
  })

  it('stops on a parent cycle instead of looping forever', () => {
    const first = /** @type {any} */ ({ id: 'a', title: 'A', kind: 'task', status: 'todo', ref: '', number: '1', doneWhen: '', parentId: 'b', children: [] })
    const second = /** @type {any} */ ({ id: 'b', title: 'B', kind: 'task', status: 'todo', ref: '', number: '2', doneWhen: '', parentId: 'a', children: [] })
    const lines = renderFocusChain([first, second], first)
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('- 2 B（任务 · 待办）')
    expect(lines[2]).toBe('  - 1 A（任务 · 待办 · 当前聚焦）')
  })

  it('renders the focus detail without children', () => {
    const { task, tasks } = seededTree()
    const focus = /** @type {TreeTaskNode} */ (findFocus(tasks, task.id))
    const lines = renderFocusDetail(tasks, focus)
    expect(lines).toContain('## 当前聚焦任务（拆解对象）')
    expect(lines).toContain(`- 内部 id：${task.id}`)
    expect(lines).toContain(`- 完成标准：${task.doneWhen}`)
    expect(lines).toContain('- 可以继续拆解。')
    expect(lines).toContain('- 直接子任务：无')
  })

  it('renders the operator as a registered agent name when given', () => {
    const { task } = seededTree()
    const agent = store.registerAgent({ name: 'pve-oc', type: 'ai-agent' })
    store.update(task.id, { operatorId: agent.id })
    const grown = /** @type {TreeTaskNode[]} */ (store.tree())
    const named = renderFocusDetail(grown, /** @type {TreeTaskNode} */ (findFocus(grown, task.id)), new Map([[agent.id, 'pve-oc']]))
    expect(named).toContain('- 操作人：pve-oc')
    const raw = renderFocusDetail(grown, /** @type {TreeTaskNode} */ (findFocus(grown, task.id)))
    expect(raw).toContain(`- 操作人：${agent.id}`)
    // A task without an operator adds no line at all.
    const plain = store.create({ title: 'Unowned task' })
    const full = /** @type {TreeTaskNode[]} */ (store.tree())
    const plainLines = renderFocusDetail(full, /** @type {TreeTaskNode} */ (findFocus(full, plain.id)))
    expect(plainLines.some(line => line.startsWith('- 操作人'))).toBe(false)
  })

  it('renders the focus description and skips the line when it is empty', () => {
    const described = store.create({ title: 'Explained task', description: 'First line\nSecond line' })
    const tasks = /** @type {TreeTaskNode[]} */ (store.tree())
    const lines = renderFocusDetail(tasks, /** @type {TreeTaskNode} */ (findFocus(tasks, described.id)))
    expect(lines).toContain('- 描述：First line\n  Second line')
    expect(lines.filter(line => line === '')).toHaveLength(1)

    const plain = store.create({ title: 'Unexplained task' })
    const grown = /** @type {TreeTaskNode[]} */ (store.tree())
    const plainLines = renderFocusDetail(grown, /** @type {TreeTaskNode} */ (findFocus(grown, plain.id)))
    expect(plainLines.some(line => line.startsWith('- 描述'))).toBe(false)
    expect(plainLines.filter(line => line === '')).toHaveLength(1)
  })

  it('renders children with their standards and marks the depth cap', () => {
    store.create({ title: 'Root', kind: 'track' })
    const level2 = store.create({ title: 'Node', parentId: store.tree()[0].id })
    const level3 = store.create({ title: 'Task', parentId: level2.id })
    const leaf = store.create({ title: 'Leaf', parentId: level3.id })
    store.create({ title: 'Child with standard', parentId: leaf.id, doneWhen: 'Proof' })
    const tasks = /** @type {TreeTaskNode[]} */ (store.tree())
    const focus = /** @type {TreeTaskNode} */ (findFocus(tasks, leaf.id))
    const lines = renderFocusDetail(tasks, focus)
    expect(lines).toContain('- 已达层级上限，不能再拆解。')
    expect(lines).toContain('- 直接子任务：')
    expect(lines).toContain('  - 1.1.1.1.1 Child with standard（完成标准：Proof）')
    const fake = /** @type {any} */ ({ id: 'y', title: 'Empty', kind: 'task', status: 'odd', ref: '', number: '7', doneWhen: '', parentId: null, children: [{ id: 'z', title: 'No ref child', ref: '', number: '7.1', doneWhen: '', kind: 'task', status: 'todo', parentId: 'y', children: [] }, { id: 'w', title: 'Ref child', ref: 'C1', number: '7.2', doneWhen: '', kind: 'task', status: 'todo', parentId: 'y', children: [] }] })
    expect(renderFocusDetail([fake], fake)).toContain('  - 7.1 No ref child')
    expect(renderFocusDetail([fake], fake)).toContain('  - C1 Ref child')
    expect(renderFocusDetail([fake], fake)).toContain('- 状态：odd')
    const withRef = /** @type {any} */ ({ id: 'r', title: 'With ref', kind: 'task', status: 'todo', ref: 'F1', number: '5', doneWhen: '', parentId: null, children: [] })
    expect(renderFocusDetail([withRef], withRef)).toContain('- 点号 id：F1')
  })

  it('renders trajectory events with their conversation, turn, and detail', () => {
    const lines = renderTrajectory([
      { action: 'complete', sessionId: 'session-a', turn: 4, detail: 'shipped', at: '2026-11-16T07:00:00.000Z' },
      { action: 'update', sessionId: '', turn: null, detail: '', at: '2026-11-16T06:00:00.000Z' },
      { action: 'odd', sessionId: 'session-b', turn: 1, detail: 'x', at: '2026-11-16T05:00:00.000Z' },
    ])
    expect(lines[0]).toBe('- 完成 · 会话 a · 第 4 轮 · 2026-11-16T07:00:00.000Z：shipped')
    expect(lines[1]).toBe('- 更新 · 由手动接口写入 · 轮次未知 · 2026-11-16T06:00:00.000Z')
    expect(lines[2]).toBe('- odd · 会话 b · 第 1 轮 · 2026-11-16T05:00:00.000Z：x')
    expect(renderTrajectory([])).toEqual([])
  })
})
