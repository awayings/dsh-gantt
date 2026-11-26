// Remote delegation tools for the gantt-long-run preset. The MCP worker
// surface already lets an external agent register itself with its
// capabilities; this pair gives the dispatcher the other direction. The
// dispatcher lists the registry (`gantt_agents`) to decide who can take a
// task, then `gantt_delegate` claims the task's operator field, builds a
// self-contained brief, and forwards the agent's registered headless launch
// command over SSH through the same guard and audit trail the manual
// `scripts/remote-exec.mjs` CLI uses. The tool returns after the launch ack:
// the remote worker reports results itself through the MCP surface, so the
// dispatch conversation stays thin and never babysits the connection.

import { spawn } from 'node:child_process'
import { GanttError } from './errors.js'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveDatabasePath } from './store.js'
import { resolveTarget, sessionOriginOf } from './tools.js'
import { inspectCommand, redactCommand } from './remote-guard.js'
import { SSH_TARGET_PATTERN, appendAudit, defaultSshConfigFile, shellQuote, sshForwardArgs, usableIdentityFile } from './remote.js'

/** @typedef {import('./store.js').GanttStore} GanttStore */
/** @typedef {import('./tools.js').GanttTool} GanttTool */
/** @typedef {import('./store/agents.js').AgentRow} AgentRow */

/** Model-facing tool names. */
export const DISPATCH_TOOL_NAMES = {
  agents: 'gantt_agents',
  delegate: 'gantt_delegate',
}

/** How long a dispatch waits for an early exit before it detaches. Just above
 * the ssh connect timeout, so an unreachable host or a refused key surfaces in
 * the tool result instead of surfacing later in the audit log only. */
const ACK_WINDOW_MS = 12_000

/** Characters of remote output/stderr kept for the tool result. */
const OUTPUT_CAP = 2000

/** Characters of one agent's free-form details rendered in the registry list. */
const DETAILS_EXCERPT_CHARS = 240

/** Longest instruction a dispatcher may attach to a delegation. */
const MAX_NOTE_CHARS = 500

/** Goals a delegation can carry. @type {Array<'execute' | 'decompose'>} */
export const DELEGATE_GOALS = ['execute', 'decompose']

/** Goal wording for the brief and the trajectory. @type {Record<string, string>} */
const GOAL_LABELS = { execute: '执行', decompose: '拆解' }

/**
 * The ssh target an agent's registered endpoint spells: `ssh://user@host` or
 * `ssh://<alias>`. Anything else cannot receive a remote dispatch.
 * @param {unknown} endpoint
 * @returns {string | null}
 */
export function parseSshEndpoint(endpoint) {
  if (typeof endpoint !== 'string') return null
  const trimmed = endpoint.trim()
  if (!trimmed.startsWith('ssh://')) return null
  const target = trimmed.slice('ssh://'.length)
  return SSH_TARGET_PATTERN.test(target) ? target : null
}

/**
 * The first `dispatch:` line of an agent's details: the headless command that
 * starts one run of it on its own host.
 * @param {unknown} details
 * @returns {string | null}
 */
export function dispatchCommandOf(details) {
  if (typeof details !== 'string') return null
  const match = details.match(/^dispatch:[ \t]*(\S.*?)[ \t]*$/m)
  return match === null ? null : match[1]
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
  const found = store.listAgents({ limit: 100 }).find(agent => agent.name === name)
  if (found !== undefined) return found
  const known = store.listAgents({ limit: 100 }).map(agent => agent.name)
  const hint = known.length === 0 ? '（注册表为空）' : `已注册：${known.join('、')}`
  throw new GanttError(`agent ${name} was not found; ${hint}`)
}

/**
 * The self-contained brief handed to the remote worker: the task with its
 * verbatim execution notes, the goal, and how to report back. The worker
 * cannot see the store's context, so the brief stands alone.
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
 * Cut remote output to the result cap.
 * @param {string} current
 * @param {unknown} chunk
 * @returns {string}
 */
function appendCapped(current, chunk) {
  if (current.length >= OUTPUT_CAP) return current
  return (current + String(chunk)).slice(0, OUTPUT_CAP)
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

/**
 * One dispatch attempt through ssh: guard, audit, ack window, detach.
 * @param {{ target: string, command: string, brief: string, inline: boolean, agent: string,
 *   taskId: string, auditLog: string, spawnProcess: typeof spawn, ackWindowMs: number }} input
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
async function launchRemote(input) {
  const { target, command, brief, inline, agent, taskId, auditLog, spawnProcess, ackWindowMs } = input
  const refusal = inspectCommand(command)
  const redacted = redactCommand(command)
  const sha256 = createHash('sha256').update(command).digest('hex')
  /** Append one audit entry pre-filled with the dispatch identity.
   * @param {Record<string, unknown>} entry
   * @returns {void} */
  const audit = entry => appendAudit(auditLog, { ts: new Date().toISOString(), target, agent, taskId, sha256, command: redacted, ...entry })
  if (refusal !== null) {
    audit({ decision: 'refused', rule: refusal.rule })
    return { ok: false, message: `委派命令被安全守门拒绝（${refusal.rule}）：${refusal.reason}。命令未发出；请让该 Agent 修正其 dispatch 登记后重试。` }
  }
  const identity = usableIdentityFile(process.env.REMOTE_SSH_IDENTITY || '')
  const knownHosts = process.env.REMOTE_KNOWN_HOSTS || join(homedir(), '.ssh', 'known_hosts')
  audit({ decision: 'allowed', rule: '' })
  /** @type {any} */
  let child
  try {
    child = spawnProcess('ssh', sshForwardArgs({ target, command, identity, knownHosts, configFile: defaultSshConfigFile() }), { stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) {
    return { ok: false, message: `委派失败：无法启动 ssh（${String( /** @type {any} */ (error)?.message ?? error)}）。` }
  }
  child.stdin?.end(inline ? '' : brief)
  /** @type {string} */
  let out = ''
  /** @type {string} */
  let errOut = ''
  child.stdout?.on('data', (/** @type {unknown} */ chunk) => { out = appendCapped(out, chunk) })
  child.stderr?.on('data', (/** @type {unknown} */ chunk) => { errOut = appendCapped(errOut, chunk) })
  const started = Date.now()
  const ack = await new Promise((/** @param {(value: any) => void} */ resolve) => {
    let settled = false
    const finish = (/** @type {any} */ value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish({ state: 'running' }), ackWindowMs)
    child.on('error', (/** @type {any} */ error) => finish({ state: 'spawn-error', message: String(error?.message ?? error) }))
    child.on('close', (/** @type {number | null} */ code) => finish({ state: 'closed', code }))
  })
  if (ack.state === 'running') {
    // Detach: the remote keeps running and reports through the store, so the
    // dispatcher's process must not hold a live handle to it.
    child.on('close', (/** @type {number | null} */ code) => {
      audit({ decision: 'finished', rule: '', exit: code, duration_ms: Date.now() - started })
    })
    child.unref?.()
    child.stdout?.unref?.()
    child.stderr?.unref?.()
    return { ok: true, message: '已发出并仍在远端运行；结果由该 Agent 经 MCP 自上报，稍后用 gantt_context 查看任务轨迹。' }
  }
  audit({ decision: 'finished', rule: '', exit: ack.state === 'closed' ? ack.code : null, duration_ms: Date.now() - started })
  if (ack.state === 'spawn-error') return { ok: false, message: `委派失败：无法连接（${ack.message}）。` }
  if (ack.code === 0) {
    const excerpt = `${out}${errOut}`.trim()
    return { ok: true, message: `远端命令已返回（退出码 0）。${excerpt === '' ? '' : `输出片段：${excerpt.slice(0, OUTPUT_CAP)}`}` }
  }
  const excerpt = errOut.trim() === '' ? out.trim() : errOut.trim()
  return {
    ok: false,
    message: `委派失败：远端命令退出码 ${ack.code === null ? '未知' : String(ack.code)}。${excerpt === '' ? '' : `远端输出：${excerpt.slice(0, OUTPUT_CAP)}`}请检查该 Agent 的 dispatch 登记与目标可达性。`,
  }
}

/** Options that let host tests drive the delegate tool without a live ssh.
 * @typedef {{ spawnProcess?: typeof spawn, ackWindowMs?: number, auditLog?: string }} DispatchOptions */

/**
 * Build the delegation tools. Kept pure so host tests can call each tool
 * with a stubbed spawn instead of a live ssh. The process spawn, the ack
 * window, and the audit log resolve once here, at build time.
 * @param {GanttStore} store
 * @param {DispatchOptions} [options]
 * @returns {GanttTool[]}
 */
export function dispatchToolDefinitions(store, options = {}) {
  const spawnProcess = options.spawnProcess ?? spawn
  const ackWindowMs = options.ackWindowMs ?? ACK_WINDOW_MS
  const auditLog = options.auditLog ?? defaultAuditLog()
  return [
    {
      name: DISPATCH_TOOL_NAMES.agents,
      description: '列出 MCP 注册的外部 Agent 及其能力（capabilities）、ssh endpoint 与无头启动命令（dispatch）。委派前先看它：任务归属于哪个 Agent 的能力、谁能接，由这里判断。',
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
        if (agents.length === 0) return { ok: true, markdown: '（尚无注册 Agent；远端 Agent 需先经 gantt MCP 的 register_agent 登记能力与 dispatch 命令。）' }
        const lines = [`# 注册 Agent（${agents.length} 个）`]
        for (const agent of agents) {
          const role = agent.role === '' ? '无角色' : agent.role
          const description = agent.description === '' ? '（无描述）' : agent.description
          lines.push(`- **${agent.name}**（${agent.type} · ${role}）— ${description}`)
          const capabilities = capabilitiesOf(agent.details)
          if (capabilities !== '') lines.push(`  能力：${capabilities}`)
          const target = parseSshEndpoint(agent.endpoint)
          const dispatch = dispatchCommandOf(agent.details)
          if (target !== null && dispatch !== null) lines.push(`  可远程委派：ssh ${target} · ${dispatch}`)
          else lines.push('  不可远程委派（缺 ssh endpoint 或 dispatch 登记）')
          const aside = detailsAside(agent.details)
          if (aside !== '') lines.push(`  ${aside.split(/\r?\n/).join('\n  ')}`)
        }
        return { ok: true, markdown: lines.join('\n') }
      },
    },
    {
      name: DISPATCH_TOOL_NAMES.delegate,
      description: '把一个甘特任务委派给注册的远程 Agent：以其登记的无头命令经 SSH 启动它，任务简报（点号编号、标题、完成标准、执行说明、补充要求）自包含发出。goal=execute 让它执行并自上报，goal=decompose 让它拆解（领域知识在它那边时用这个）。操作人会记为该 Agent；派发不等结果，远端完成后经 MCP 写回任务树。',
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
        const target = parseSshEndpoint(agent.endpoint)
        if (target === null) {
          throw new GanttError(`agent ${agent.name} 未登记可用的 ssh endpoint（register_agent 的 endpoint 需为 ssh://user@host 或 ssh://别名），无法远程委派；请改用 gantt_execute 或让该 Agent 补登记。`)
        }
        const registered = dispatchCommandOf(agent.details)
        if (registered === null) {
          throw new GanttError(`agent ${agent.name} 未登记 dispatch 命令（register_agent 的 details 里需要一行 dispatch: <无头启动命令>），无法远程委派；请改用 gantt_execute 或让该 Agent 补登记。`)
        }
        const brief = buildDelegateBrief(task, agent, goal, note)
        const inline = registered.includes('{prompt}')
        const command = inline ? registered.replaceAll('{prompt}', shellQuote(brief)) : registered
        const origin = sessionOriginOf(exec)
        const label = task.ref === '' ? task.number : task.ref
        const result = await launchRemote({
          target,
          command,
          brief,
          inline,
          agent: agent.name,
          taskId,
          auditLog,
          spawnProcess,
          ackWindowMs,
        })
        if (!result.ok) return result
        // The dispatch reached the remote; record the claim and the round.
        const row = store.requireRow(taskId)
        const claimed = row.operatorId === ''
        if (claimed) store.update(taskId, { operatorId: agent.id }, origin === undefined ? undefined : { ...origin, summary: `委派给 ${agent.name}（${GOAL_LABELS[goal]}）` })
        if (origin !== undefined) {
          store.recordTrack({ taskId, sessionId: origin.sessionId, turn: origin.turn, detail: `delegated ${GOAL_LABELS[goal]} to ${agent.name} via ssh ${target}` })
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
