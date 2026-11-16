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
  it('defines the three model-facing tools with output schemas', () => {
    const tools = toolDefinitions(store)
    expect(tools.map(entry => entry.name)).toEqual([TOOL_NAMES.context, TOOL_NAMES.decompose, TOOL_NAMES.update])
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
    expect(registered).toHaveLength(3)
    const disposer = /** @type {() => void} */ (effect.mock.calls[0][0]())
    disposer()
    expect(dispose).toHaveBeenCalledTimes(3)
  })

  it('registers without an effect seam and no-ops without a usable tools service', () => {
    /** @type {GanttTool[]} */
    const registered = []
    const tools = { register: (definition) => { registered.push(definition); return () => {} } }
    registerTools({ get: name => (name === 'tools' ? tools : undefined) }, store)
    expect(registered).toHaveLength(3)
    registerTools({}, store)
    registerTools({ get: () => undefined }, store)
    registerTools({ get: () => ({}) }, store)
    registerTools({ get: () => null }, store)
  })
})
