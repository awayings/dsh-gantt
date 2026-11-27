// Remote delegation tools for the gantt-long-run preset. The MCP worker
// surface already lets an external agent register itself with its
// capabilities; this pair gives the dispatcher the other direction. The
// dispatcher lists the registry (`gantt_agents`) to decide who can take a
// task, then `gantt_delegate` claims the task's operator field, builds a
// self-contained brief, and hands it to the transport the agent's endpoint
// scheme selects — today SSH through the agent's registered headless command
// (`dispatch-ssh.js`); a daemon transport, where an agent-side daemon holds
// its own outbound connection to the gantt server, is planned as a second
// table entry. The tool returns after the transport's launch ack: the remote
// worker reports results itself through the MCP surface, so the dispatch
// conversation stays thin and never babysits a connection.

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { GanttError } from './errors.js'
import { sshTransport } from './dispatch-ssh.js'
import { resolveDatabasePath } from './store.js'
import { resolveTarget, sessionOriginOf } from './tools.js'

/** @typedef {import('./store.js').GanttStore} GanttStore */
/** @typedef {import('./tools.js').GanttTool} GanttTool */
/** @typedef {import('./store/agents.js').AgentRow} AgentRow */

/** Model-facing tool names. */
export const DISPATCH_TOOL_NAMES = {
  agents: 'gantt_agents',
  delegate: 'gantt_delegate',
}

/** Characters of one agent's free-form details rendered in the registry list. */
const DETAILS_EXCERPT_CHARS = 240

/** Longest instruction a dispatcher may attach to a delegation. */
const MAX_NOTE_CHARS = 500

/** Goals a delegation can carry. @type {Array<'execute' | 'decompose'>} */
export const DELEGATE_GOALS = ['execute', 'decompose']

/** Goal wording for the brief and the trajectory. @type {Record<string, string>} */
const GOAL_LABELS = { execute: '执行', decompose: '拆解' }

/**
 * The dispatch transports, keyed by the endpoint scheme a registered agent
 * spells. A transport resolves one registration into launch inputs and
 * forwards one brief; the delegate tool never talks to ssh directly, so the
 * planned daemon transport lands here without touching the tool.
 * @type {Record<string, import('./dispatch-ssh.js').DispatchTransport>}
 */
const DISPATCH_TRANSPORTS = { ssh: sshTransport }

/**
 * The endpoint scheme a registration spells: `ssh`, `daemon`, …; '' when the
 * endpoint names no scheme at all. The store guarantees endpoint is a string.
 * @param {string} endpoint
 * @returns {string}
 */
function schemeOf(endpoint) {
  const match = endpoint.trim().match(/^([a-z][a-z0-9+.-]*):\/\//)
  return match === null ? '' : match[1]
}

/**
 * Resolve one registration into its transport and launch inputs. A scheme
 * with no transport yet names what exists today, so the model can route
 * elsewhere instead of guessing.
 * @param {AgentRow} agent
 * @returns {{ transport: import('./dispatch-ssh.js').DispatchTransport, input: Record<string, unknown> }}
 */
function resolveDispatch(agent) {
  const scheme = schemeOf(agent.endpoint)
  const transport = DISPATCH_TRANSPORTS[scheme]
  if (transport === undefined) {
    const known = Object.keys(DISPATCH_TRANSPORTS).join('、')
    const hint = scheme === ''
      ? `agent ${agent.name} 未登记可接收远程派发的 endpoint（当前支持 ${Object.keys(DISPATCH_TRANSPORTS).map(key => `${key}://`).join(' 或 ')}）；请改用 gantt_execute 或让该 Agent 补登记。`
      : `agent ${agent.name} 的 endpoint 方案 ${scheme} 暂无投递通道（当前支持 ${known}；daemon 直连形态在规划中）；请改用 gantt_execute 或让该 Agent 换用 ${known}://。`
    throw new GanttError(hint)
  }
  return { transport, input: /** @type {Record<string, unknown>} */ (transport.resolve(agent)) }
}

/**
 * The dispatch eligibility line for one registration: what the transport that
 * claims its scheme would launch, or why it cannot.
 * @param {AgentRow} agent
 * @returns {string}
 */
function dispatchSummary(agent) {
  const transport = DISPATCH_TRANSPORTS[schemeOf(agent.endpoint)]
  if (transport === undefined) return '不可远程委派（endpoint 无可用投递通道或登记不完整）'
  try {
    return `可远程委派：${transport.describe(agent)}`
  } catch {
    return '不可远程委派（endpoint 无可用投递通道或登记不完整）'
  }
}

/**
 * The first `capabilities:` line of an agent's details: the comma-separated
 * abilities the dispatcher routes by.
 * @param {unknown} details
 * @returns {string}
 */
export function capabilitiesOf(details) {
  if (typeof details !== 'string') return ''
  const match = details.match(/^capabilities:[ \t]*(\S.*?)[ \t]*$/m)
  return match === null ? '' : match[1]
}

/**
 * The free-form remainder of an agent's details once the structured
 * `capabilities:` / `dispatch:` lines are taken out. The store guarantees the
 * details field is a string.
 * @param {string} details
 * @returns {string}
 */
function detailsAside(details) {
  const rest = details
    .split(/\r?\n/)
    .filter(/** @param {string} */ line => !/^(capabilities|dispatch):/.test(line.trim()))
    .join('\n')
    .trim()
  const chars = [...rest]
  return chars.length <= DETAILS_EXCERPT_CHARS ? rest : `${chars.slice(0, DETAILS_EXCERPT_CHARS).join('')}…`
}

/**
 * Resolve one registered agent by its exact name, the identity it re-registers
 * under. A name that was never registered lists the known names so the model
 * can retry without another round trip.
 * @param {GanttStore} store
 * @param {unknown} value
 * @returns {AgentRow}
 */
function requireAgentByName(store, value) {
  if (typeof value !== 'string' || value.trim() === '') throw new GanttError('agent is required')
  const name = value.trim()
  const registered = store.listAgents({ limit: 100 })
  const found = registered.find(agent => agent.name === name)
  if (found !== undefined) return found
  const hint = registered.length === 0 ? '（注册表为空）' : `已注册：${registered.map(agent => agent.name).join('、')}`
  throw new GanttError(`agent ${name} was not found; ${hint}`)
}

/**
 * The self-contained brief handed to the remote worker: the task with its
 * verbatim execution notes, the goal, and how to report back. The worker
 * cannot see the store's context, so the brief stands alone — and it stays
 * transport-agnostic: ssh substitutes it into a command line, a daemon will
 * carry it over its own connection.
 * @param {any} task
 * @param {AgentRow} agent
 * @param {'execute' | 'decompose'} goal
 * @param {string} note
 * @returns {string}
 */
export function buildDelegateBrief(task, agent, goal, note) {
  const label = task.ref === '' ? task.number : task.ref
  const lines = [
    `【甘特任务委派 · ${GOAL_LABELS[goal]}】你被甘特分发者委派此任务；完成后自行把结果写回甘特库（gantt MCP 工具已在你这边），不要等待派发方。`,
    '',
    `任务：${label} ${task.title}`,
    `完成标准：${task.doneWhen === '' ? '（未填写）' : task.doneWhen}`,
    '说明：',
    task.description === '' ? '（无）' : task.description,
  ]
  if (note !== '') lines.push('', `补充要求：${note}`)
  const report = goal === 'decompose'
    ? `先 get_task_context 读链路；用 decompose_task 在 ${label} 下拆出可验证子任务（每个带 doneWhen，写清怎么证明），只拆解、不执行；最后 track_task 记录一次。`
    : `用 update_task 推进状态（blocked 时把具体条件写进 summary）；完成时 report_completion 带证据（产出了什么、在哪里验证）；提交代码则 commit subject 末尾带 (${label})。`
  lines.push('', `写回方式（一律以 agentName="${agent.name}" 调用）：`, `- ${report}`)
  return lines.join('\n')
}

/**
 * The audit log a dispatch appends to: the env override, else beside the task
 * database so the trail persists with the store instead of the checkout.
 * @returns {string}
 */
export function defaultAuditLog() {
  if (process.env.REMOTE_AUDIT_LOG) return process.env.REMOTE_AUDIT_LOG
  return join(dirname(resolveDatabasePath()), 'remote-exec.log')
}

/** Options that let host tests drive the delegate tool without a live ssh.
 * @typedef {{ spawnProcess?: typeof spawn, ackWindowMs?: number, auditLog?: string }} DispatchOptions */

/**
 * Build the delegation tools. Kept pure so host tests can call each tool
 * with a stubbed spawn instead of a live ssh. The process spawn and the audit
 * log resolve once here, at build time; the ack window keeps its default
 * inside the ssh transport.
 * @param {GanttStore} store
 * @param {DispatchOptions} [options]
 * @returns {GanttTool[]}
 */
export function dispatchToolDefinitions(store, options = {}) {
  const spawnProcess = options.spawnProcess ?? spawn
  const auditLog = options.auditLog ?? defaultAuditLog()
  return [
    {
      name: DISPATCH_TOOL_NAMES.agents,
      description: '列出 MCP 注册的外部 Agent 及其能力（capabilities）、可远程委派的投递登记（endpoint 方案 + dispatch 命令）。委派前先看它：任务归属于哪个 Agent 的能力、谁能接，由这里判断。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          q: { type: 'string', description: '可选，关键词，模糊匹配名称、角色、描述与详情。' },
          limit: { type: 'integer', description: '可选，返回条数，默认 20，最大 100。' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, markdown: { type: 'string' } },
          required: ['ok', 'markdown'],
        },
        render: (_args, value) => [{ type: 'text', text: value.markdown }],
      },
      async execute(args) {
        const agents = store.listAgents({ q: args.q, limit: args.limit })
        if (agents.length === 0) return { ok: true, markdown: '（尚无注册 Agent；远端 Agent 需先经 gantt MCP 的 register_agent 登记能力与投递登记。）' }
        const lines = [`# 注册 Agent（${agents.length} 个）`]
        for (const agent of agents) {
          const role = agent.role === '' ? '无角色' : agent.role
          const description = agent.description === '' ? '（无描述）' : agent.description
          lines.push(`- **${agent.name}**（${agent.type} · ${role}）— ${description}`)
          const capabilities = capabilitiesOf(agent.details)
          if (capabilities !== '') lines.push(`  能力：${capabilities}`)
          lines.push(`  ${dispatchSummary(agent)}`)
          const aside = detailsAside(agent.details)
          if (aside !== '') lines.push(`  ${aside.split(/\r?\n/).join('\n  ')}`)
        }
        return { ok: true, markdown: lines.join('\n') }
      },
    },
    {
      name: DISPATCH_TOOL_NAMES.delegate,
      description: '把一个甘特任务委派给注册的远程 Agent：按其 endpoint 方案选择投递通道（当前为 SSH——以它登记的无头命令在远端启动它），任务简报（点号编号、标题、完成标准、执行说明、补充要求）自包含发出。goal=execute 让它执行并自上报，goal=decompose 让它拆解（领域知识在它那边时用这个）。操作人会记为该 Agent；派发不等结果，远端完成后经 MCP 写回任务树。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: '任务：内部 id、点号 id 或编号（如 1.8.1）；省略时使用本会话的聚焦任务。' },
          agent: { type: 'string', description: '注册 Agent 名称（gantt_agents 里列出的 name）。' },
          goal: { type: 'string', enum: [...DELEGATE_GOALS], description: '可选，默认 execute：execute=执行任务并自上报，decompose=只拆解任务不执行。' },
          note: { type: 'string', description: `可选，附加给执行者的补充要求，最多 ${MAX_NOTE_CHARS} 字。` },
        },
        required: ['agent'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
          required: ['ok', 'message'],
        },
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      async execute(args, exec) {
        const taskId = resolveTarget(store, args, exec)
        const task = /** @type {any} */ (store.getNode(taskId))
        const agent = requireAgentByName(store, args.agent)
        const goal = args.goal === undefined || args.goal === null ? 'execute' : /** @type {'execute' | 'decompose'} */ (args.goal)
        if (!DELEGATE_GOALS.includes(goal)) throw new GanttError(`goal must be one of ${DELEGATE_GOALS.join(', ')}`)
        const note = typeof args.note === 'string' ? args.note.trim().slice(0, MAX_NOTE_CHARS) : ''
        const { transport, input } = resolveDispatch(agent)
        const brief = buildDelegateBrief(task, agent, goal, note)
        const origin = sessionOriginOf(exec)
        const label = task.ref === '' ? task.number : task.ref
        const result = await transport.launch({
          ...input,
          brief,
          agent: agent.name,
          taskId,
          auditLog,
          spawnProcess,
          ackWindowMs: options.ackWindowMs,
        })
        if (!result.ok) return result
        // The dispatch reached the remote; record the claim and the round.
        const row = store.requireRow(taskId)
        const claimed = row.operatorId === ''
        if (claimed) store.update(taskId, { operatorId: agent.id }, origin === undefined ? undefined : { ...origin, summary: `委派给 ${agent.name}（${GOAL_LABELS[goal]}）` })
        if (origin !== undefined) {
          store.recordTrack({ taskId, sessionId: origin.sessionId, turn: origin.turn, detail: `delegated ${GOAL_LABELS[goal]} to ${agent.name} over ${transport.id}` })
        }
        const claimNote = claimed ? `操作人已记为 ${agent.name}。` : '任务已有操作人，未改动。'
        return { ok: true, message: `已把 ${label} ${task.title} 委派给 ${agent.name}（${GOAL_LABELS[goal]}）：${result.message}${claimNote}` }
      },
    },
  ]
}

/**
 * Register the delegation tools on the calling scope's tools service. The
 * preset keeps working without that service (unit harnesses, headless
 * profiles), so a missing service is not an error.
 * @param {{ get?: (name: string) => unknown, effect?: (fn: () => () => void, hint?: string) => unknown }} ctx
 * @param {GanttStore} store
 * @param {DispatchOptions} [options]
 * @returns {void}
 */
export function registerDispatchTools(ctx, store, options = {}) {
  const tools = /** @type {{ register?: (definition: GanttTool) => () => void } | undefined} */ (
    typeof ctx.get === 'function' ? ctx.get('tools') : undefined
  )
  if (tools === undefined || tools === null || typeof tools.register !== 'function') return
  // ToolsService.register reads its own registry (`this.layers`), so keep the
  // service as the receiver instead of detaching the method.
  const register = tools.register.bind(tools)
  /** @type {Array<() => void>} */
  const disposers = dispatchToolDefinitions(store, options).map(definition => register(definition))
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const dispose of disposers) dispose()
    }, 'gantt long-run: dispatch tools')
  }
}
