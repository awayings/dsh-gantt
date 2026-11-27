// The SSH dispatch transport: how a delegation brief reaches a registered
// agent today. The agent's registration carries the whole contract — the
// `ssh://` endpoint and the `dispatch:` headless command — and this module
// forwards one brief through that command over SSH, behind the same guard and
// audit trail the manual `scripts/remote-exec.mjs` CLI uses. It is an entry in
// dispatch.js's transport table, not a special case in the tool: the planned
// daemon transport (an agent-side daemon holding its own outbound connection
// to the gantt server) will sit beside it as a second entry.

import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { GanttError } from './errors.js'
import { inspectCommand, redactCommand } from './remote-guard.js'
import { appendAudit, defaultSshConfigFile, shellQuote, sshForwardArgs, SSH_TARGET_PATTERN, usableIdentityFile } from './remote.js'

/** @typedef {import('./store/agents.js').AgentRow} AgentRow */

/** How long a dispatch waits for an early exit before it detaches. Just above
 * the ssh connect timeout, so an unreachable host or a refused key surfaces in
 * the tool result instead of surfacing later in the audit log only. */
export const ACK_WINDOW_MS = 12_000

/** Characters of remote output/stderr kept for the tool result. */
const OUTPUT_CAP = 2000

/**
 * The ssh target an agent's registered endpoint spells: `ssh://user@host` or
 * `ssh://<alias>`. Anything else cannot ride this transport.
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
 * Forward one brief through the registered command over SSH: guard, audit, ack
 * window, detach. The `{prompt}` placeholder substitutes the brief, safely
 * quoted, into the command line; without it the brief rides the command's
 * stdin. The launch returns after the ack — the remote worker reports results
 * itself through the MCP surface.
 * @typedef {{ target: string, registered: string, brief: string, agent: string,
 *   taskId: string, auditLog: string,
 *   spawnProcess: (command: string, args: string[], options: Record<string, unknown>) => any,
 *   ackWindowMs?: number }} SshDispatchInput
 * @param {SshDispatchInput} input
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
async function launchSshDispatch(input) {
  const { target, registered, brief, agent, taskId, auditLog, spawnProcess } = input
  const inline = registered.includes('{prompt}')
  const command = inline ? registered.replaceAll('{prompt}', shellQuote(brief)) : registered
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
  const ackWindowMs = input.ackWindowMs ?? ACK_WINDOW_MS
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

/**
 * Resolve one registration into what this transport needs: the ssh target and
 * the registered headless command. Registration gaps throw with the fix in the
 * message, so the model can route elsewhere without guessing.
 * @param {AgentRow} agent
 * @returns {{ target: string, registered: string }}
 */
function resolveSsh(agent) {
  const target = parseSshEndpoint(agent.endpoint)
  if (target === null) {
    throw new GanttError(`agent ${agent.name} 的 endpoint 不是可用的 ssh 目标（register_agent 的 endpoint 需为 ssh://user@host 或 ssh://别名）；请改用 gantt_execute 或让该 Agent 补登记。`)
  }
  const registered = dispatchCommandOf(agent.details)
  if (registered === null) {
    throw new GanttError(`agent ${agent.name} 未登记 dispatch 命令（register_agent 的 details 里需要一行 dispatch: <无头启动命令>），无法远程委派；请改用 gantt_execute 或让该 Agent 补登记。`)
  }
  return { target, registered }
}

/** The SSH entry of dispatch.js's transport table: resolve a registration into
 * launch inputs, describe what would run, and forward one brief.
 * @typedef {{ id: string, resolve: (agent: AgentRow) => Record<string, unknown>,
 *   describe: (agent: AgentRow) => string,
 *   launch: (input: Record<string, unknown>) => Promise<{ ok: boolean, message: string }> }} DispatchTransport */
export const sshTransport = /** @type {DispatchTransport} */ ({
  id: 'ssh',
  resolve: resolveSsh,
  /** @param {AgentRow} agent @returns {string} */
  describe(agent) {
    const { target, registered } = resolveSsh(agent)
    return `ssh ${target} · ${registered}`
  },
  /** @param {Record<string, unknown>} input @returns {Promise<{ ok: boolean, message: string }>} */
  launch: input => launchSshDispatch(/** @type {import('./dispatch-ssh.js').SshDispatchInput} */ (input)),
})
