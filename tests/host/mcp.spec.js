import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertHttpBinding, createMcpServer, MCP_INSTRUCTIONS, MCP_PROTOCOL_VERSION, MCP_TOOLS, WORKER_GUIDE,
} from '../../src/host/mcp.js'
import { GanttStore } from '../../src/host/store.js'

let store
let server

beforeEach(() => {
  store = new GanttStore(':memory:')
  server = createMcpServer({ store })
})

afterEach(() => {
  store?.close()
  store = undefined
  server = undefined
})

/** JSON-RPC handle with the test's loose response typing. */
function rpc(message) {
  return /** @type {any} */ (server.handle(message))
}

/** The JSON value one successful tool result carries. */
function toolJson(response) {
  return JSON.parse(response.result.content[0].text)
}

describe('MCP metadata', () => {
  it('publishes the protocol version and every tool schema', () => {
    expect(MCP_PROTOCOL_VERSION).toBe('2025-06-18')
    expect(MCP_TOOLS.map(tool => tool.name)).toEqual([
      'register_agent', 'list_agents', 'list_ready_tasks', 'get_task_context', 'create_task',
      'decompose_task', 'update_task', 'track_task', 'report_completion', 'get_worker_guide',
    ])
    expect(new Set(MCP_TOOLS.map(tool => tool.name)).size).toBe(MCP_TOOLS.length)
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.inputSchema.type).toBe('object')
    }
    expect(MCP_TOOLS[0].inputSchema.required).toEqual(['name', 'type'])
    expect(MCP_TOOLS[8].inputSchema.required).toEqual(['taskId', 'report'])
    const ready = /** @type {any} */ (MCP_TOOLS.find(tool => tool.name === 'list_ready_tasks'))
    expect(ready.description).toMatch(/manual task tags/)
    expect(ready.inputSchema.properties.tag).toMatchObject({ enum: ['ready', 'next', 'todo'] })
    expect(ready.inputSchema.properties.tags).toMatchObject({ type: 'array', items: { type: 'string' } })
    expect(ready.inputSchema.properties.mode).toMatchObject({ type: 'string', enum: ['any', 'and'] })
    expect(MCP_INSTRUCTIONS).toMatch(/register_agent/)
    expect(MCP_INSTRUCTIONS).toMatch(/dispatch:/)
    expect(MCP_INSTRUCTIONS.length).toBeLessThan(2048)
    expect(WORKER_GUIDE).toMatch(/## Loop/)
    expect(WORKER_GUIDE).toMatch(/## Registration doubles as the dispatch contract/)
    expect(WORKER_GUIDE).toMatch(/\{prompt\}/)
  })
})

describe('JSON-RPC envelope', () => {
  it('treats a message without an id as a notification', () => {
    expect(rpc({ jsonrpc: '2.0', method: 'initialize' })).toBeNull()
    expect(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    expect(rpc({ jsonrpc: '2.0', method: 'ping' })).toBeNull()
    expect(rpc({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'list_agents' } })).toBeNull()
  })

  it('rejects a non-object message and a missing method with -32600', () => {
    for (const message of [null, [], 'text', 7, undefined]) {
      expect(rpc(message)).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'invalid request' },
      })
    }
    expect(rpc({ jsonrpc: '2.0', id: 7 })).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32600, message: 'invalid request' },
    })
    expect(rpc({ jsonrpc: '2.0' })).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'invalid request' },
    })
    expect(rpc({ jsonrpc: '2.0', id: 8, method: 5 })).toMatchObject({ id: 8, error: { code: -32600 } })
    expect(rpc({ jsonrpc: '2.0', id: 9, method: '' })).toMatchObject({ id: 9, error: { code: -32600 } })
  })

  it('answers initialize with the default or echoed protocol version', () => {
    expect(rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'dsh-gantt', version: '1.6.0' },
        instructions: MCP_INSTRUCTIONS,
      },
    })
    expect(rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: null }).result.protocolVersion)
      .toBe(MCP_PROTOCOL_VERSION)
    expect(rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    }).result.protocolVersion).toBe('2024-11-05')
    const custom = createMcpServer({ store, version: '9.9.9' })
    expect(/** @type {any} */ (custom.handle({ jsonrpc: '2.0', id: 4, method: 'initialize' })).result.serverInfo.version).toBe('9.9.9')
  })

  it('answers ping, tools/list, and notifications/initialized with an id', () => {
    expect(rpc({ jsonrpc: '2.0', id: 'p', method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 'p', result: {} })
    expect(rpc({ jsonrpc: '2.0', id: 'l', method: 'tools/list' }))
      .toEqual({ jsonrpc: '2.0', id: 'l', result: { tools: MCP_TOOLS } })
    expect(rpc({ jsonrpc: '2.0', id: 'n', method: 'notifications/initialized' })).toBeNull()
  })

  it('reports an unknown method with -32601', () => {
    expect(rpc({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).toEqual({
      jsonrpc: '2.0',
      id: 5,
      error: { code: -32601, message: 'method not found: resources/list' },
    })
  })
})

describe('tools/call', () => {
  it('rejects non-object params, unknown tools, and non-object arguments', () => {
    expect(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call' })).toMatchObject({
      result: { content: [{ type: 'text', text: 'params must be an object' }], isError: true },
    })
    expect(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: [] })).toMatchObject({
      result: { content: [{ type: 'text', text: 'params must be an object' }], isError: true },
    })
    expect(rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope' } })).toMatchObject({
      result: { content: [{ type: 'text', text: 'unknown tool: nope' }], isError: true },
    })
    expect(rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 7 } })).toMatchObject({
      result: { content: [{ type: 'text', text: 'unknown tool: 7' }], isError: true },
    })
    expect(rpc({
      jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_agents', arguments: [] },
    })).toMatchObject({
      result: { content: [{ type: 'text', text: 'arguments must be an object' }], isError: true },
    })
  })

  it('registers and lists agents', () => {
    const registered = rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'register_agent',
        arguments: { name: 'Codex', type: 'ai-agent', role: 'dev', description: 'writes code', details: 'd', endpoint: 'e' },
      },
    })
    expect(registered.result.isError).toBeUndefined()
    const agent = toolJson(registered).agent
    expect(agent).toMatchObject({ name: 'Codex', type: 'ai-agent', role: 'dev' })

    const listed = toolJson(rpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_agents', arguments: { q: 'codex' } },
    }))
    expect(listed.agents.map(row => row.id)).toEqual([agent.id])
  })

  it('lists ready tasks and returns task context', () => {
    const task = store.create({ title: 'Ready task' })
    const ready = toolJson(rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_ready_tasks', arguments: {} },
    }))
    expect(ready.tag).toBe('ready')
    expect(ready.tasks.map(row => row.id)).toEqual([task.id])

    const context = toolJson(rpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_task_context', arguments: { taskId: task.id } },
    }))
    expect(context.taskId).toBe(task.id)
    expect(context.markdown).toContain('# 任务上下文：1 Ready task（任务）')
    expect(context.chars).toBe(context.markdown.length)
  })

  it('filters ready tasks by manual tags and validates the filter', () => {
    store.create({ title: 'Ops', tags: ['ops'] })
    store.create({ title: 'UI', tags: ['ui'] })
    store.create({ title: 'Both', tags: ['ops', 'ui'] })
    const call = args => rpc({
      jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'list_ready_tasks', arguments: args },
    })

    const any = toolJson(call({ tags: ['ops'] }))
    expect(any.tag).toBe('ready')
    expect(any.tasks.map(task => task.title)).toEqual(['Ops', 'Both'])
    expect(any.tasks.map(task => task.tags)).toEqual([['ops'], ['ops', 'ui']])
    const and = toolJson(call({ tags: ['ops', 'ui'], mode: 'and' }))
    expect(and.tasks.map(task => task.title)).toEqual(['Both'])
    expect(toolJson(call({ tags: ['ops'], limit: 1 })).tasks).toHaveLength(1)
    expect(toolJson(call({ tags: [] })).tasks).toHaveLength(3)

    for (const [args, message] of [
      [{ tags: 'ops' }, 'tags must be an array'],
      [{ tags: [''] }, 'tags[0] must not be empty'],
      [{ mode: 'all' }, 'mode must be one of any, and'],
    ]) {
      expect(call(args).result).toEqual({ content: [{ type: 'text', text: message }], isError: true })
    }
  })

  it('converts a thrown non-Error value into isError text', () => {
    const throwing = /** @type {any} */ ({ registerAgent() { throw 'boom' } })
    const fake = createMcpServer({ store: throwing })
    expect(/** @type {any} */ (fake.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'register_agent', arguments: { name: 'Codex' } },
    })).result).toEqual({ content: [{ type: 'text', text: 'boom' }], isError: true })
  })

  it('reports a completion and surfaces store errors as isError', () => {
    const task = store.create({ title: 'Ready task' })
    const agent = store.registerAgent({ name: 'Codex' })
    const completed = toolJson(rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'report_completion',
        arguments: { taskId: task.id, agentId: agent.id, report: 'done', status: 'done', progress: 100 },
      },
    }))
    expect(completed.task).toMatchObject({ status: 'done', completedById: agent.id })
    expect(completed.event.action).toBe('complete')

    const failure = rpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'report_completion', arguments: { taskId: 'missing', agentId: agent.id, report: 'done' } },
    })
    expect(failure.result).toEqual({ content: [{ type: 'text', text: 'task missing was not found' }], isError: true })

    const validation = rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'register_agent', arguments: { name: ' ' } },
    })
    expect(validation.result.isError).toBe(true)
    expect(validation.result.content[0].text).toBe('name is required')
  })
})


describe('write tools', () => {
  /** Register one worker through the protocol and return its row. */
  function registerWorker(name = 'worker') {
    return toolJson(rpc({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'register_agent', arguments: { name, type: 'ai-agent' } },
    })).agent
  }

  /** Call one tool with explicit arguments. */
  function call(name, args) {
    return rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })
  }

  it('creates a child task with the agent as operator and a session-keyed event', () => {
    const agent = registerWorker()
    const parent = store.create({ title: 'Parent' })
    const created = call('create_task', {
      title: 'Child', parentId: parent.id, doneWhen: 'tests pass', agentName: agent.name, session: 'run-1',
    })
    expect(created.result.isError).toBeUndefined()
    const task = toolJson(created).task
    expect(task).toMatchObject({ parentId: parent.id, title: 'Child', doneWhen: 'tests pass', operatorId: agent.id })
    expect(store.trajectory({ taskId: task.id })[0]).toMatchObject({ action: 'create', sessionId: 'run-1' })
  })

  it('creates the next sibling through afterTaskId and keeps the order', () => {
    const agent = registerWorker()
    const first = store.create({ title: 'First' })
    const second = store.create({ title: 'Second' })
    const created = toolJson(call('create_task', {
      title: 'Middle', afterTaskId: first.number, agentName: agent.name,
    })).task
    expect(created.parentId).toBe(first.parentId)
    expect(store.getRow(created.id).sortOrder).toBe(first.sortOrder + 1)
    expect(store.getRow(second.id).sortOrder).toBe(second.sortOrder + 1)
    const referenceEvents = store.trajectory({ taskId: first.id })
    expect(referenceEvents[0]).toMatchObject({ action: 'track', sessionId: `agent:${agent.name}` })
  })

  it('requires exactly one reference and writes anonymous rounds as mcp:manual', () => {
    const parent = store.create({ title: 'Parent' })
    const message = 'exactly one of parentId or afterTaskId is required'
    for (const args of [{ title: 'Nowhere' }, { title: 'Both', parentId: parent.id, afterTaskId: parent.id }]) {
      expect(call('create_task', args).result).toEqual({ content: [{ type: 'text', text: message }], isError: true })
    }
    const anonymous = toolJson(call('create_task', { title: 'Anonymous', parentId: parent.number })).task
    expect(anonymous).toMatchObject({ parentId: parent.id, operatorId: '' })
    expect(store.trajectory({ taskId: anonymous.id })[0]).toMatchObject({ action: 'create', sessionId: 'mcp:manual' })
  })

  it('creates a captured child carrying inspiration and category', () => {
    const parent = store.create({ title: 'Parent' })
    const task = toolJson(call('create_task', {
      title: 'Idea', parentId: parent.id, inspiration: '#21 用户原话', category: 'invest', status: 'todo',
    })).task
    expect(task).toMatchObject({
      parentId: parent.id,
      title: 'Idea',
      inspiration: '#21 用户原话',
      category: 'invest',
      doneWhen: '',
      status: 'todo',
    })
  })

  it('decomposes a task and records the parent trajectory', () => {
    const agent = registerWorker()
    const parent = store.create({ title: 'Parent' })
    const result = toolJson(call('decompose_task', {
      parentId: parent.number,
      children: [{ title: 'A', doneWhen: 'a done' }, { title: 'B', doneWhen: 'b done', estimate: '30min' }],
      summary: 'split it',
      agentName: agent.name,
    }))
    expect(result.children.map(child => child.title)).toEqual(['A', 'B'])
    expect(result.children[0]).toMatchObject({ parentId: parent.id, doneWhen: 'a done' })
    expect(store.trajectory({ taskId: parent.id })[0]).toMatchObject({ action: 'decompose', detail: 'split it' })
    expect(call('decompose_task', { parentId: parent.id, children: 'nope' }).result).toEqual({
      content: [{ type: 'text', text: 'children must be a non-empty array' }], isError: true,
    })
  })

  it('updates a task, claims an unowned task, and never steals another operator', () => {
    const agent = registerWorker('worker')
    const other = registerWorker('other')
    const task = store.create({ title: 'Task' })
    const updated = toolJson(call('update_task', {
      taskId: task.number, status: 'in_progress', progress: 40, summary: 'started', agentName: agent.name,
    }))
    expect(updated.task).toMatchObject({ status: 'in_progress', progress: 40, operatorId: agent.id })
    expect(store.trajectory({ taskId: task.id })[0]).toMatchObject({ action: 'update', detail: 'started' })

    const again = toolJson(call('update_task', { taskId: task.id, progress: 60, agentName: other.name }))
    expect(again.task).toMatchObject({ progress: 60, operatorId: agent.id })

    expect(call('update_task', { taskId: task.id }).result).toEqual({
      content: [{ type: 'text', text: 'nothing to update' }], isError: true,
    })
    expect(call('update_task', { taskId: 'missing', status: 'done' }).result.isError).toBe(true)
  })

  it('tracks a round without writing the tree and validates the summary', () => {
    const agent = registerWorker()
    const task = store.create({ title: 'Task' })
    const event = toolJson(call('track_task', { taskId: task.id, summary: 'looked around', agentName: agent.name })).event
    expect(event).toMatchObject({ action: 'track', sessionId: `agent:${agent.name}`, detail: 'looked around' })
    for (const summary of [' ', 7]) {
      expect(call('track_task', { taskId: task.id, summary }).result).toEqual({
        content: [{ type: 'text', text: 'summary is required' }], isError: true,
      })
    }
    expect(call('track_task', { taskId: 'missing', summary: 'x' }).result.isError).toBe(true)
  })

  it('reports a completion by agent name and by agent id', () => {
    const agent = registerWorker()
    const task = store.create({ title: 'Task' })
    const byName = toolJson(call('report_completion', {
      taskId: task.number, agentName: agent.name, report: 'done and verified', session: 'run-9',
    }))
    expect(byName.task).toMatchObject({ status: 'done', completedById: agent.id })
    expect(byName.event).toMatchObject({ action: 'complete', sessionId: 'run-9' })

    const task2 = store.create({ title: 'Task 2' })
    const byId = toolJson(call('report_completion', {
      taskId: task2.id, agentId: agent.id, report: 'done again', status: 'in_progress', progress: 10,
    }))
    expect(byId.task).toMatchObject({ status: 'in_progress', progress: 10 })
    expect(byId.event).toMatchObject({ sessionId: `agent:${agent.name}` })
  })

  it('refuses an unknown agent name and an anonymous completion', () => {
    const task = store.create({ title: 'Task' })
    expect(call('report_completion', { taskId: task.id, report: 'x' }).result).toEqual({
      content: [{ type: 'text', text: 'agentId or agentName is required' }], isError: true,
    })
    expect(call('report_completion', { taskId: task.id, agentName: 'ghost', report: 'x' }).result).toEqual({
      content: [{ type: 'text', text: 'agent ghost was not found; call register_agent first' }], isError: true,
    })
  })

  it('serves the worker guide and resolves a task by point number', () => {
    const guide = toolJson(call('get_worker_guide', {}))
    expect(guide.markdown).toBe(WORKER_GUIDE)

    const task = store.create({ title: 'Numbered' })
    const context = toolJson(call('get_task_context', { taskId: '1' }))
    expect(context.taskId).toBe(task.id)
    expect(context.markdown).toContain('Numbered')
  })
})

describe('HTTP binding guard', () => {
  it('allows a loopback host without a token', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      expect(() => assertHttpBinding(host, '')).not.toThrow()
    }
  })

  it('refuses a network bind without a token', () => {
    for (const host of ['0.0.0.0', '192.168.1.20', '::']) {
      expect(() => assertHttpBinding(host, '')).toThrow(/without a bearer token/)
    }
    expect(() => assertHttpBinding('', '')).toThrow(/all interfaces/)
  })

  it('accepts a network bind once a token is configured', () => {
    expect(() => assertHttpBinding('0.0.0.0', 's3cret')).not.toThrow()
    expect(() => assertHttpBinding('127.0.0.1', 's3cret')).not.toThrow()
  })
})
