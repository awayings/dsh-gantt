// Minimal hand-written MCP (Model Context Protocol) server logic. It speaks
// JSON-RPC 2.0 over newline-delimited stdio or a single POST body, exposes the
// five external-agent tools, and never depends on a protocol SDK.

/** The MCP revision this server implements. */
export const MCP_PROTOCOL_VERSION = '2025-06-18'

/** @typedef {import('./store.js').GanttStore} GanttStore */
/** @typedef {{ name: string, description: string, inputSchema: Record<string, unknown> }} McpTool */
/** @typedef {{ jsonrpc: '2.0', id: unknown, result: unknown }} McpResultResponse */
/** @typedef {{ jsonrpc: '2.0', id: unknown, error: { code: number, message: string } }} McpErrorResponse */
/** @typedef {McpResultResponse | McpErrorResponse} McpResponse */

/** The five tools an external coding tool can call. */
export const MCP_TOOLS = /** @type {McpTool[]} */ ([
  {
    name: 'register_agent',
    description: 'Register or update this coding tool as an operator. Re-registering the same name updates the existing agent; pass the returned id to update by id.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Unique agent name, 1-100 characters.' },
        type: { type: 'string', enum: ['human', 'ai-agent'], description: 'Operator kind.' },
        role: { type: 'string', description: 'Optional role, such as implementer or reviewer.' },
        description: { type: 'string', description: 'Optional one-line description.' },
        details: { type: 'string', description: 'Optional longer notes.' },
        endpoint: { type: 'string', description: 'Optional callback or home endpoint.' },
        id: { type: 'string', description: 'Optional existing agent id; ignored when unknown.' },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'list_agents',
    description: 'List registered operators, optionally filtered by type, role, or a fuzzy text query.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['human', 'ai-agent'] },
        role: { type: 'string' },
        q: { type: 'string', description: 'Fuzzy match over name, role, description, and details.' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'list_ready_tasks',
    description: 'List the tasks an external tool can work on: ready (dependencies met), next (the first executable pick per track), or todo (every pending leaf).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tag: { type: 'string', enum: ['ready', 'next', 'todo'], description: 'Selection vocabulary; defaults to ready.' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'get_task_context',
    description: 'Read one task\'s stable markdown context: fields, ancestor chain, detail, completion report, and recent trajectory.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', description: 'Internal task id.' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'report_completion',
    description: 'Report a task completion back to the store: writes the operator, completer, report, status, and progress, and records one complete event.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', description: 'Internal task id.' },
        agentId: { type: 'string', description: 'Registered agent id reporting the completion.' },
        report: { type: 'string', description: 'What was produced and where it was verified; 1-4000 characters.' },
        status: { type: 'string', enum: ['todo', 'in_progress', 'blocked', 'done', 'cancelled'], description: 'Defaults to done.' },
        progress: { type: 'integer', minimum: 0, maximum: 100 },
      },
      required: ['taskId', 'agentId', 'report'],
    },
  },
])

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} id @param {unknown} result @returns {McpResultResponse} */
function resultResponse(id, result) {
  return { jsonrpc: '2.0', id, result }
}

/** @param {unknown} id @param {number} code @param {string} message @returns {McpErrorResponse} */
function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

/** @param {unknown} id @param {{ content: Array<{ type: 'text', text: string }>, isError?: boolean }} result
 * @returns {McpResultResponse} */
function toolResponse(id, result) {
  return resultResponse(id, result)
}

/** @param {unknown} id @param {string} text @returns {McpResultResponse} */
function toolError(id, text) {
  return toolResponse(id, { content: [{ type: 'text', text }], isError: true })
}

/** @param {unknown} id @param {unknown} value @returns {McpResultResponse} */
function toolSuccess(id, value) {
  return toolResponse(id, { content: [{ type: 'text', text: JSON.stringify(value) }] })
}

/**
 * Run one tool. Store validation failures (GanttError) and unexpected errors
 * are converted to `isError` content by the caller; this function only maps
 * the tool name to the store call.
 * @param {GanttStore} store
 * @param {string} name
 * @param {Record<string, any>} args
 * @returns {Record<string, unknown>}
 */
function callTool(store, name, args) {
  if (name === 'register_agent') {
    return {
      ok: true,
      agent: store.registerAgent({
        id: args.id,
        name: args.name,
        type: args.type,
        role: args.role,
        description: args.description,
        details: args.details,
        endpoint: args.endpoint,
      }),
    }
  }
  if (name === 'list_agents') {
    return { ok: true, agents: store.listAgents({ type: args.type, role: args.role, q: args.q, limit: args.limit }) }
  }
  if (name === 'list_ready_tasks') {
    return { ok: true, ...store.readyTasks({ tag: args.tag, limit: args.limit }) }
  }
  if (name === 'get_task_context') {
    return { ok: true, ...store.taskContext(args.taskId) }
  }
  if (name === 'report_completion') {
    return {
      ok: true,
      ...store.reportCompletion({
        taskId: args.taskId,
        agentId: args.agentId,
        report: args.report,
        status: args.status,
        progress: args.progress,
      }),
    }
  }
  throw new Error(`unknown tool: ${name}`)
}

/**
 * Handle one `tools/call` request. Unknown tools, non-object params, and
 * non-object arguments are tool errors, not JSON-RPC errors.
 * @param {GanttStore} store
 * @param {unknown} id
 * @param {unknown} params
 * @returns {McpResultResponse}
 */
function handleToolCall(store, id, params) {
  if (!isRecord(params)) return toolError(id, 'params must be an object')
  const { name } = params
  if (typeof name !== 'string') return toolError(id, `unknown tool: ${String(name)}`)
  const args = params.arguments === undefined ? {} : params.arguments
  if (!isRecord(args)) return toolError(id, 'arguments must be an object')
  try {
    return toolSuccess(id, callTool(store, name, args))
  } catch (error) {
    return toolError(id, error instanceof Error ? error.message : String(error))
  }
}

/**
 * Build one MCP server bound to a store. `handle` returns the JSON-RPC
 * response object, or `null` for a notification.
 * @param {{ store: GanttStore, version?: string }} options
 * @returns {{ handle: (message: unknown) => McpResponse | null }}
 */
export function createMcpServer({ store, version = '1.5.0' }) {
  return {
    handle(message) {
      if (!isRecord(message)) return errorResponse(null, -32600, 'invalid request')
      const method = message.method
      if (typeof method !== 'string' || method === '') return errorResponse(message.id ?? null, -32600, 'invalid request')
      if (message.id === undefined) return null
      const { id } = message
      if (method === 'initialize') {
        const params = isRecord(message.params) ? message.params : {}
        const protocolVersion = typeof params.protocolVersion === 'string' ? params.protocolVersion : MCP_PROTOCOL_VERSION
        return resultResponse(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'dsh-gantt', version },
        })
      }
      if (method === 'notifications/initialized') return null
      if (method === 'ping') return resultResponse(id, {})
      if (method === 'tools/list') return resultResponse(id, { tools: MCP_TOOLS })
      if (method === 'tools/call') return handleToolCall(store, id, message.params)
      return errorResponse(id, -32601, `method not found: ${method}`)
    },
  }
}
