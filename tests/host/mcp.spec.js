import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMcpServer, MCP_PROTOCOL_VERSION, MCP_TOOLS } from '../../src/host/mcp.js'
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
  it('publishes the protocol version and five tool schemas', () => {
    expect(MCP_PROTOCOL_VERSION).toBe('2025-06-18')
    expect(MCP_TOOLS.map(tool => tool.name)).toEqual([
      'register_agent', 'list_agents', 'list_ready_tasks', 'get_task_context', 'report_completion',
    ])
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.inputSchema.type).toBe('object')
    }
    expect(MCP_TOOLS[0].inputSchema.required).toEqual(['name', 'type'])
    expect(MCP_TOOLS[4].inputSchema.required).toEqual(['taskId', 'agentId', 'report'])
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
        serverInfo: { name: 'dsh-gantt', version: '1.5.0' },
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
