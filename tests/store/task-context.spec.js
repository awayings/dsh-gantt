import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore } from '../../src/host/store.js'
import { renderTaskContext } from '../../src/host/tree/task-context.js'
import { expectGanttError } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** Create a tracker-shaped track root with one node below it. */
function makeNode(extra = {}) {
  const track = store.create({ title: '投资系统', kind: 'track', ref: 'track:1' })
  return store.create({ title: '读数收口', parentId: track.id, kind: 'node', ref: 'node:1.8.1', ...extra })
}

describe('task context rendering', () => {
  it('resolves the operator and completer through the agent name map', () => {
    const agent = store.registerAgent({ name: 'pve-oc', type: 'ai-agent' })
    const completer = store.registerAgent({ name: 'mac-co', type: 'ai-agent' })
    const task = makeNode({ operatorId: agent.id, completedById: completer.id })
    const tasks = /** @type {any} */ (store.tree())
    const node = tasks[0].children.find(/** @returns {boolean} */ (/** @type {any} */ child) => child.id === task.id)
    const names = new Map([[agent.id, 'pve-oc'], [completer.id, 'mac-co']])
    const named = renderTaskContext(tasks, node, [], names)
    expect(named).toContain('- 操作人：pve-oc')
    expect(named).toContain('- 完成人：mac-co')
    // The store-level context resolves the registered names on its own.
    const fromStore = store.taskContext(task.id)
    expect(fromStore.markdown).toContain('- 操作人：pve-oc')
    expect(fromStore.markdown).toContain('- 完成人：mac-co')
  })

  it('renders every populated field, the chain, the detail, the report, and the links', () => {
    const task = makeNode({
      description: 'first line\nsecond line',
      doneWhen: 'table shipped',
      category: 'A 主攻片',
      estimate: '2h',
      landing: 'invest/strategy-ledger.md',
      inspiration: '#21',
      dep: '1.8',
      operatorId: 'agent-1',
      completedById: 'agent-2',
      report: 'verified in tests/report.spec.js',
      links: [
        { type: 'memory', ref: 'key/plan', label: 'plan memory' },
        { type: 'url', ref: 'https://example.com' },
      ],
    })
    const result = store.taskContext(task.id)
    expect(result.taskId).toBe(task.id)
    expect(result.chars).toBe(result.markdown.length)
    const markdown = result.markdown
    expect(markdown).toContain('# 任务上下文：node:1.8.1 读数收口（节点）')
    expect(markdown).toContain('- 状态：待办（todo）')
    expect(markdown).toContain('- 进度：0%')
    expect(markdown).toContain('- 操作人：agent-1')
    expect(markdown).toContain('- 完成人：agent-2')
    expect(markdown).toContain('- 描述：first line\n  second line')
    expect(markdown).toContain('- 完成标准：table shipped')
    expect(markdown).toContain('- 起止：')
    expect(markdown).toContain('- 分类：A 主攻片')
    expect(markdown).toContain('- 预估：2h')
    expect(markdown).toContain('- 落地：invest/strategy-ledger.md')
    expect(markdown).toContain('- 灵感：#21')
    expect(markdown).toContain('- 依赖：1.8')
    expect(markdown).toContain('- 链接：\n  - memory：key/plan（plan memory）\n  - url：https://example.com')
    expect(markdown).toContain('## 任务链路（从支线根到当前任务）')
    expect(markdown).toContain('## 当前任务')
    expect(markdown).toContain('## 汇报结果\n\nverified in tests/report.spec.js')
    expect(markdown).toContain('## 任务轨迹\n（暂无会话记录）')
    expect(markdown.endsWith('\n')).toBe(true)
    expect(store.taskContext(task.id).markdown).toBe(markdown)
  })

  it('omits empty optional fields and renders the trajectory after a completion', () => {
    const task = makeNode({ doneWhen: 'table shipped' })
    const agent = store.registerAgent({ name: 'Codex' })
    const minimal = store.taskContext(task.id).markdown
    expect(minimal).not.toContain('- 操作人：')
    expect(minimal).not.toContain('- 完成人：')
    expect(minimal).not.toContain('- 描述：')
    expect(minimal).not.toContain('- 分类：')
    expect(minimal).not.toContain('- 预估：')
    expect(minimal).not.toContain('- 落地：')
    expect(minimal).not.toContain('- 灵感：')
    expect(minimal).not.toContain('- 依赖：')
    expect(minimal).not.toContain('- 链接：')
    expect(minimal).not.toContain('## 汇报结果')

    store.reportCompletion({ taskId: task.id, agentId: agent.id, report: 'finished and tested' })
    const context = store.taskContext(task.id).markdown
    expect(context).toContain('## 汇报结果\n\nfinished and tested')
    expect(context).toContain('## 任务轨迹\n- 完成 · 由手动接口写入 · 轮次未知')
    expect(context).toContain('finished and tested')
  })

  it('labels a manual task by its dotted number', () => {
    const task = store.create({ title: 'Manual task' })
    expect(store.taskContext(task.id).markdown).toContain('# 任务上下文：1 Manual task（任务）')
  })

  it('falls back to raw status and kind labels and renders an empty link label', () => {
    const task = store.create({ title: 'Edge task' })
    const tree = store.tree()
    const node = /** @type {any} */ ({
      ...tree[0],
      status: 'mystery',
      kind: 'epic',
      links: [{ type: 'note', ref: 'n1', label: '' }],
    })
    const markdown = renderTaskContext(tree, node, [])
    expect(markdown).toContain('# 任务上下文：1 Edge task（epic）')
    expect(markdown).toContain('- 状态：mystery（mystery）')
    expect(markdown).toContain('- 链接：\n  - note：n1')
    expect(store.getRow(task.id).status).toBe('todo')
  })

  it('rejects a missing id and an unknown task', () => {
    expectGanttError(() => store.taskContext(undefined), 'id is required')
    expectGanttError(() => store.taskContext('missing'), 'task missing was not found', 404)
  })
})
