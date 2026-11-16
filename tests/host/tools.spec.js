import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GanttStore } from '../../src/host/store.js'
import { TOOL_NAMES, registerTools, resolveTaskId, toolDefinitions } from '../../src/host/tools.js'
import { expectGanttError } from '../helpers/gantt.js'

/** Assert an async tool rejection carries a GanttError status. */
async function expectToolError(promise, message, status = 400) {
  const caught = await promise.then(() => null, error => error)
  expect(caught).toBeInstanceOf(Error)
  expect(caught.message).toBe(message)
  expect(caught.status).toBe(status)
}

/** @typedef {import('../../src/host/tools.js').GanttTool} GanttTool */

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** @param {GanttTool[]} tools @param {string} name @returns {GanttTool} */
function tool(tools, name) {
  const found = tools.find(candidate => candidate.name === name)
  if (found === undefined) throw new Error(`tool ${name} was not defined`)
  return found
}

/** Seed track → node → task and focus the task for one conversation. */
function focusTask() {
  const track = store.create({ title: 'Content platform', kind: 'track', ref: 'T1' })
  const node = store.create({ title: 'Weekly report', parentId: track.id })
  const task = store.create({ title: 'Collect data', parentId: node.id, doneWhen: 'Data table ready' })
  store.setFocus('session-a', task.id)
  return { track, node, task }
}

describe('gantt assistant tools', () => {
  it('defines the five model-facing tools with output schemas', () => {
    const tools = toolDefinitions(store)
    expect(tools.map(entry => entry.name)).toEqual([
      TOOL_NAMES.context, TOOL_NAMES.decompose, TOOL_NAMES.update, TOOL_NAMES.track, TOOL_NAMES.createTask,
    ])
    for (const entry of tools) {
      expect(typeof entry.description).toBe('string')
      expect(entry.output.schema.type).toBe('object')
      expect(typeof entry.output.render).toBe('function')
    }
  })

  it('resolves a task by internal id, ref, or point number', () => {
    const { task, track } = focusTask()
    expect(resolveTaskId(store, task.id)).toBe(task.id)
    expect(resolveTaskId(store, 'T1')).toBe(track.id)
    expect(resolveTaskId(store, ` ${task.number} `)).toBe(task.id)
    expectGanttError(() => resolveTaskId(store, ''), 'id is required', 400)
    expectGanttError(() => resolveTaskId(store, 5), 'id is required', 400)
    expectGanttError(() => resolveTaskId(store, 'missing'), 'task missing was not found', 404)
  })

  it('renders the focused chain and detail for the calling conversation', async () => {
    const { task } = focusTask()
    const tools = toolDefinitions(store)
    const context = tool(tools, TOOL_NAMES.context)
    const value = /** @type {any} */ (await context.execute({}, { agent: { session: { id: 'session-a' } } }))
    expect(value.ok).toBe(true)
    expect(value.markdown).toContain('# 甘特图任务上下文')
    expect(value.markdown).toContain('## 聚焦任务链路')
    expect(value.markdown).toContain(task.title)
    expect(value.markdown).toContain('## 当前聚焦任务（拆解对象）')
    expect(context.output.render({}, value)).toEqual([{ type: 'text', text: value.markdown }])
  })

  it('falls back to the whole tree when the conversation has no focus', async () => {
    store.create({ title: 'Loose task' })
    const context = toolDefinitions(store).find(entry => entry.name === TOOL_NAMES.context)
    const value = /** @type {any} */ (await context.execute({}, { agent: { session: { id: 'session-b' } } }))
    expect(value.markdown).toContain('## 当前会话没有聚焦任务')
    expect(value.markdown).toContain('Loose task')
  })

  it('tolerates a tool run without an agent session', async () => {
    const context = toolDefinitions(store).find(entry => entry.name === TOOL_NAMES.context)
    for (const exec of [undefined, {}, { agent: {} }, { agent: { session: {} } }]) {
      const value = /** @type {any} */ (await context.execute({}, exec))
      expect(value.markdown).toContain('## 当前会话没有聚焦任务')
    }
  })

  it('decomposes a task by point number and reports the created children', async () => {
    const { task } = focusTask()
    const decompose = toolDefinitions(store).find(entry => entry.name === TOOL_NAMES.decompose)
    const value = /** @type {any} */ (await decompose.execute({
      id: task.number,
      children: [
        { title: 'Pull rows', doneWhen: 'Rows exported' },
        { title: 'Check totals', doneWhen: 'Totals match' },
      ],
    }, {}))
    expect(value.ok).toBe(true)
    expect(value.message).toContain('创建 2 个子任务')
    expect(value.message).toContain('Pull rows')
    expect(decompose.output.render({}, value)).toEqual([{ type: 'text', text: value.message }])
    expect(store.getNode(task.id)?.children).toHaveLength(2)
  })

  it('decomposes with a plan date and reports a parent without a ref', async () => {
    const parent = store.create({ title: 'Parent' })
    const decompose = toolDefinitions(store).find(entry => entry.name === TOOL_NAMES.decompose)
    const value = /** @type {any} */ (await decompose.execute({
      id: parent.id,
      planDate: '2024-02-01',
      children: [{ title: 'Child', doneWhen: 'Done' }],
    }, {}))
    expect(value.message).toContain(`已在 ${parent.number} ${parent.title} 下创建 1 个子任务`)
    expect(store.getNode(parent.id)?.children[0].startDate).toBe('2024-02-01')
  })

  it('reports a missing parent through the store error', async () => {
    const decompose = toolDefinitions(store).find(entry => entry.name === TOOL_NAMES.decompose)
    await expectToolError(decompose.execute({ id: 'missing', children: [{ title: 'X', doneWhen: 'Y' }] }, {}), 'task missing was not found', 404)
  })

  it('renders a decompose result whose parent node is gone', async () => {
    const fake = /** @type {any} */ ({
      getRow: () => ({ id: 'x' }),
      tree: () => [],
      decompose: () => ({ parent: null, children: [{ ref: '', number: '1.1', title: 'Child', doneWhen: 'Done' }] }),
    })
    const decompose = toolDefinitions(fake).find(entry => entry.name === TOOL_NAMES.decompose)
    const value = /** @type {any} */ (await decompose.execute({ id: 'x', children: [{ title: 'Child', doneWhen: 'Done' }] }, {}))
    expect(value.message).toContain('已在 x  下创建 1 个子任务')
    expect(value.message).toContain('- 1.1 Child（完成标准：Done）')
  })

  it('updates status, progress, title, and completion standard', async () => {
    const { task } = focusTask()
    const update = toolDefinitions(store).find(entry => entry.name === TOOL_NAMES.update)
    const value = /** @type {any} */ (await update.execute({
      id: task.id,
      status: 'in_progress',
      progress: 40,
      title: 'Collect the data',
      doneWhen: 'Rows exported',
    }, {}))
    expect(value.message).toContain('Collect the data')
    expect(value.message).toContain('进行中')
    expect(value.message).toContain('40%')
    expect(update.output.render({}, value)).toEqual([{ type: 'text', text: value.message }])
    const stored = store.getNode(task.id)
    expect(stored?.status).toBe('in_progress')
    expect(stored?.progress).toBe(40)
    expect(stored?.doneWhen).toBe('Rows exported')
  })

  it('renders refs and an unknown status for a synthetic decompose/update result', async () => {
    const fake = /** @type {any} */ ({
      getRow: () => ({ id: 'x' }),
      tree: () => [],
      decompose: () => ({ parent: { ref: 'P1', number: '9', title: 'Parent' }, children: [{ ref: 'C1', number: '9.1', title: 'Child', doneWhen: 'Done' }] }),
      update: () => ({ ref: 'R1', number: '8', title: 'Task', status: 'odd', progress: 10 }),
    })
    const tools = toolDefinitions(fake)
    const decomposeValue = /** @type {any} */ (await tool(tools, TOOL_NAMES.decompose).execute({ id: 'x', children: [] }, {}))
    const oddChildren = /** @type {any} */ (await tool(tools, TOOL_NAMES.decompose).execute({ id: 'x', children: 'not-an-array' }, {}))
    expect(oddChildren.ok).toBe(true)
    expect(decomposeValue.message).toContain('已在 P1 Parent 下创建 1 个子任务')
    expect(decomposeValue.message).toContain('- C1 Child')
    const updateValue = /** @type {any} */ (await tool(tools, TOOL_NAMES.update).execute({ id: 'x', title: 'Task' }, {}))
    expect(updateValue.message).toContain('已更新 R1 Task：状态 odd')
  })

  it('updates a task addressed by ref and rejects an empty patch', async () => {
    const { track } = focusTask()
    const update = toolDefinitions(store).find(entry => entry.name === TOOL_NAMES.update)
    const refLeaf = store.create({ title: 'Ref leaf', ref: 'R1' })
    const value = /** @type {any} */ (await update.execute({ id: 'R1', status: 'done' }, {}))
    expect(value.message).toContain(refLeaf.title)
    expect(store.getNode(refLeaf.id)?.status).toBe('done')
    await expectToolError(update.execute({ id: track.id }, {}), 'nothing to update', 400)
  })

  it('reports an update whose task disappeared', async () => {
    const fake = /** @type {any} */ ({ getRow: () => ({ id: 'x' }), tree: () => [], update: () => null })
    const update = toolDefinitions(fake).find(entry => entry.name === TOOL_NAMES.update)
    await expectToolError(update.execute({ id: 'x', title: 'New' }, {}), 'task x was not found', 404)
  })

  it('registers every tool and disposes them with the plugin', () => {
    /** @type {GanttTool[]} */
    const registered = []
    const dispose = vi.fn()
    const effect = vi.fn(fn => fn())
    const ctx = {
      get: name => (name === 'tools' ? { register: (definition) => { registered.push(definition); return dispose } } : undefined),
      effect,
    }
    registerTools(ctx, store)
    expect(registered).toHaveLength(5)
    const disposer = /** @type {() => void} */ (effect.mock.calls[0][0]())
    disposer()
    expect(dispose).toHaveBeenCalledTimes(5)
  })

  it('keeps the tools service as the receiver of register', () => {
    /** @type {GanttTool[]} */
    const registered = []
    const service = {
      seen: 0,
      /** @param {GanttTool} definition */
      register(definition) {
        this.seen += 1
        registered.push(definition)
        return () => {}
      },
    }
    registerTools({ get: name => (name === 'tools' ? service : undefined) }, store)
    expect(service.seen).toBe(5)
    expect(registered).toHaveLength(5)
  })

  it('registers without an effect seam and no-ops without a usable tools service', () => {
    /** @type {GanttTool[]} */
    const registered = []
    const tools = { register: (definition) => { registered.push(definition); return () => {} } }
    registerTools({ get: name => (name === 'tools' ? tools : undefined) }, store)
    expect(registered).toHaveLength(5)
    registerTools({}, store)
    registerTools({ get: () => undefined }, store)
    registerTools({ get: () => ({}) }, store)
    registerTools({ get: () => null }, store)
  })

  it('records the calling conversation and turn on update and completion', async () => {
    const { task } = focusTask()
    const update = tool(toolDefinitions(store), TOOL_NAMES.update)
    const exec = { agent: { session: { id: 'session-a', snapshotEvents: () => [{ type: 'user/message', data: {} }, { type: 'turn/start', data: { turn: 4 } }] } } }
    const value = /** @type {any} */ (await update.execute({ id: task.id, status: 'done', summary: '  shipped  ' }, exec))
    expect(value.message).toContain('已自动记录会话与轮次索引。')
    const [event] = store.trajectory({ taskId: task.id })
    expect(event).toMatchObject({ action: 'complete', sessionId: 'session-a', turn: 4, detail: 'shipped' })
  })

  it('records a decompose and its children, and tolerates an unknown turn', async () => {
    const { task } = focusTask()
    const decompose = tool(toolDefinitions(store), TOOL_NAMES.decompose)
    const exec = { agent: { session: { id: 'session-b', snapshotEvents: () => [{ type: 'turn/start' }] } } }
    const value = /** @type {any} */ (await decompose.execute({ id: task.id, children: [{ title: 'Child', doneWhen: 'Done' }] }, exec))
    expect(value.message).toContain('已自动记录会话与轮次索引。')
    const [parentEvent] = store.trajectory({ taskId: task.id })
    expect(parentEvent).toMatchObject({ action: 'decompose', sessionId: 'session-b', turn: null })
    const childId = /** @type {string} */ (store.getNode(task.id)?.children[0].id)
    expect(store.trajectory({ taskId: childId })[0]).toMatchObject({ action: 'create', sessionId: 'session-b', turn: null })
  })

  it('records a null turn without session events and ignores a non-string summary', async () => {
    const { task } = focusTask()
    const update = tool(toolDefinitions(store), TOOL_NAMES.update)
    for (const exec of [
      { agent: { session: { id: 'session-c' } } },
      { agent: { session: { id: 'session-c', snapshotEvents: () => [] } } },
    ]) {
      await update.execute({ id: task.id, status: 'in_progress', progress: 10, summary: 5 }, exec)
    }
    const events = store.trajectory({ taskId: task.id })
    expect(events).toHaveLength(2)
    for (const event of events) {
      expect(event).toMatchObject({ action: 'update', sessionId: 'session-c', turn: null })
      expect(event.detail).toContain('状态 in_progress，进度 10%')
    }
  })

  it('renders the recent trajectory in gantt_context', async () => {
    const { task } = focusTask()
    store.recordEvent({ taskId: task.id, action: 'complete', sessionId: 'session-old', turn: 2, detail: 'shipped' })
    const context = tool(toolDefinitions(store), TOOL_NAMES.context)
    const value = /** @type {any} */ (await context.execute({}, { agent: { session: { id: 'session-a' } } }))
    expect(value.markdown).toContain('## 任务轨迹（会话与轮次）')
    expect(value.markdown).toContain('会话 session-old')
    expect(value.markdown).toContain('第 2 轮')
    expect(value.markdown).toContain('shipped')
  })

  it('renders an empty trajectory for a focused task without events', async () => {
    focusTask()
    const context = tool(toolDefinitions(store), TOOL_NAMES.context)
    const value = /** @type {any} */ (await context.execute({}, { agent: { session: { id: 'session-a' } } }))
    expect(value.markdown).toContain('（暂无会话记录）')
  })
})

describe('round-closing tools', () => {
  const execWithTurn = (turn = 4) => /** @type {any} */ ({
    agent: { session: { id: 'session-a', snapshotEvents: () => [{ type: 'turn/start', data: { turn } }] } },
  })

  it('records a track event against an explicit task', async () => {
    const { task } = focusTask()
    const track = tool(toolDefinitions(store), TOOL_NAMES.track)
    const value = /** @type {any} */ (await track.execute({ id: task.number, summary: '  wrote the docs  ' }, execWithTurn(4)))
    expect(value).toEqual({ ok: true, message: '已记录本轮与 1.1.1 Collect data 的关联（第 4 轮）。' })
    expect(track.output.render({}, value)).toEqual([{ type: 'text', text: value.message }])
    expect(store.trajectory({ taskId: task.id })[0]).toMatchObject({
      action: 'track',
      sessionId: 'session-a',
      turn: 4,
      detail: 'wrote the docs',
    })
  })

  it('defaults to the focused task and reports an unknown turn', async () => {
    const { task } = focusTask()
    const track = tool(toolDefinitions(store), TOOL_NAMES.track)
    const exec = { agent: { session: { id: 'session-a', snapshotEvents: () => [{ type: 'turn/start' }] } } }
    const value = /** @type {any} */ (await track.execute({ summary: 'reviewed the plan' }, exec))
    expect(value.message).toContain('（轮次未知）')
    expect(store.trajectory({ taskId: task.id })[0]).toMatchObject({ action: 'track', turn: null, detail: 'reviewed the plan' })
  })

  it('requires a non-blank summary', async () => {
    const { task } = focusTask()
    const track = tool(toolDefinitions(store), TOOL_NAMES.track)
    await expectToolError(track.execute({ id: task.id }, {}), 'summary is required', 400)
    await expectToolError(track.execute({ id: task.id, summary: '   ' }, {}), 'summary is required', 400)
    await expectToolError(track.execute({ id: task.id, summary: 5 }, {}), 'summary is required', 400)
  })

  it('requires a task when the conversation has no focus', async () => {
    const track = tool(toolDefinitions(store), TOOL_NAMES.track)
    await expectToolError(track.execute({ summary: 'nothing to attach' }, {}), 'id is required when this conversation has no focused task', 400)
    await expectToolError(
      track.execute({ summary: 'nothing to attach' }, { agent: { session: { id: 'session-b' } } }),
      'id is required when this conversation has no focused task',
      400,
    )
  })

  it('reports an unknown task reference', async () => {
    const track = tool(toolDefinitions(store), TOOL_NAMES.track)
    await expectToolError(track.execute({ id: 'missing', summary: 'x' }, {}), 'task missing was not found', 404)
  })

  it('creates a sibling after the focused task with provenance', async () => {
    const { node, task } = focusTask()
    const create = tool(toolDefinitions(store), TOOL_NAMES.createTask)
    const value = /** @type {any} */ (await create.execute({ title: 'Follow up', doneWhen: 'Proof ready' }, execWithTurn(6)))
    expect(value.message).toBe('已在 1.1.1 Collect data 之后创建同级任务 1.1.2 Follow up。\n已自动记录会话与轮次索引。')
    expect(create.output.render({}, value)).toEqual([{ type: 'text', text: value.message }])
    expect(store.getNode(node.id)?.children.map(child => child.title)).toEqual(['Collect data', 'Follow up'])
    const child = store.getNode(node.id)?.children[1]
    expect(child?.doneWhen).toBe('Proof ready')
    expect(store.trajectory({ taskId: child?.id })[0]).toMatchObject({ action: 'create', sessionId: 'session-a', turn: 6, detail: '在 1.1.1 后创建' })
    expect(store.trajectory({ taskId: task.id })[0]).toMatchObject({ action: 'track', sessionId: 'session-a', turn: 6, detail: 'sibling task 1.1.1 Follow up' })
  })

  it('creates a sibling after an explicit reference without a conversation', async () => {
    const root = store.create({ title: 'Track root', kind: 'track', ref: 'T2' })
    const create = tool(toolDefinitions(store), TOOL_NAMES.createTask)
    const value = /** @type {any} */ (await create.execute({
      id: 'T2',
      title: 'New root',
      startDate: '2024-02-01',
      endDate: '2024-02-02',
      status: 'in_progress',
    }, {}))
    expect(value).toEqual({ ok: true, message: '已在 T2 Track root 之后创建同级任务 2 New root。' })
    expect(store.getNode(root.id)?.number).toBe('1')
    expect(store.tree().map(node => node.title)).toEqual(['Track root', 'New root'])
    expect(store.trajectory({ taskId: root.id })).toEqual([])
  })

  it('reports a missing title and an unknown reference', async () => {
    const { task } = focusTask()
    const create = tool(toolDefinitions(store), TOOL_NAMES.createTask)
    await expectToolError(create.execute({ id: task.id }, {}), 'title is required', 400)
    await expectToolError(create.execute({ id: 'missing', title: 'X' }, {}), 'task missing was not found', 404)
    await expectToolError(create.execute({ title: 'X' }, {}), 'id is required when this conversation has no focused task', 400)
  })
})
