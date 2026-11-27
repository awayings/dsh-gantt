import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDelegateBrief, capabilitiesOf, defaultAuditLog, DISPATCH_TOOL_NAMES, dispatchToolDefinitions, registerDispatchTools } from '../../src/host/dispatch.js'
import { dispatchCommandOf, parseSshEndpoint } from '../../src/host/dispatch-ssh.js'
import { GanttStore } from '../../src/host/store.js'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'

/** A fake ssh child: collects stdin, emits data/close/error on demand. */
class FakeChild extends EventEmitter {
  constructor() {
    super()
    this.stdin = { end: vi.fn() }
    this.stdout = Object.assign(new EventEmitter(), { unref: vi.fn() })
    this.stderr = Object.assign(new EventEmitter(), { unref: vi.fn() })
    this.unref = vi.fn()
  }
}

let store
let dir
let previousAuditEnv

beforeEach(() => {
  store = new GanttStore(':memory:')
  dir = makeTempDir('dsh-gantt-dispatch-')
  previousAuditEnv = process.env.REMOTE_AUDIT_LOG
  process.env.REMOTE_AUDIT_LOG = auditPath()
  // A missing identity passes through unchanged, so no unit run ever copies
  // the operator's real key.
  process.env.REMOTE_SSH_IDENTITY = '/nonexistent-dsh-gantt-key'
})

afterEach(() => {
  store?.close()
  store = undefined
  if (previousAuditEnv === undefined) delete process.env.REMOTE_AUDIT_LOG
  else process.env.REMOTE_AUDIT_LOG = previousAuditEnv
  delete process.env.REMOTE_SSH_IDENTITY
  removeTempDir(dir)
})

/** The audit log path the seeded options write to. */
function auditPath() {
  return join(dir, 'audit.jsonl')
}

/** Seed a focused task plus one dispatchable agent and return both. */
function seedAgent() {
  const track = store.create({ title: 'Lab', kind: 'track', ref: 'T1' })
  const task = store.create({ title: 'Run the probe', parentId: track.id, doneWhen: 'Probe output saved', description: '把探针输出存到 /tmp/probe.txt' })
  store.setFocus('session-a', task.id)
  const agent = store.registerAgent({
    name: 'pve-oc',
    type: 'ai-agent',
    role: 'remote coder',
    description: 'oc headless runner',
    details: 'capabilities: coding, decompose\ndispatch: lo -p',
    endpoint: 'ssh://k3s-node',
  })
  return { task, agent }
}

/** The delegation tools over the seeded store, with a fake spawn installed. */
function toolsWith(spawnProcess) {
  return dispatchToolDefinitions(store, { spawnProcess, ackWindowMs: 10 })
}

/** The delegate tool with a child-creating fake spawn. */
function delegateTool(child) {
  return toolIn(toolsWith(() => child), DISPATCH_TOOL_NAMES.delegate)
}

/** @param {import('../../src/host/dispatch.js').GanttTool[]} tools @param {string} name */
function toolIn(tools, name) {
  const found = tools.find(entry => entry.name === name)
  if (found === undefined) throw new Error(`tool ${name} was not defined`)
  return found
}

/** Execute the delegate tool with a session-carrying exec.
 * @param {any} args
 * @param {any} child
 * @param {any} [exec]
 */
async function delegate(args, child, exec = { agent: { session: { id: 'session-a' } } }) {
  const value = await delegateTool(child).execute(args, /** @type {any} */ (exec))
  return /** @type {{ ok: boolean, message: string }} */ (value)
}

/** Read the audit log the seeded options wrote. */
function readAudit() {
  return readFileSync(auditPath(), 'utf8').trim().split('\n').map(line => JSON.parse(line))
}

describe('ssh endpoint and registration parsing', () => {
  it('accepts ssh://user@host and ssh://alias endpoints', () => {
    expect(parseSshEndpoint('ssh://jason@192.168.1.5')).toBe('jason@192.168.1.5')
    expect(parseSshEndpoint(' ssh://k3s-node ')).toBe('k3s-node')
  })

  it('rejects anything that is not a dispatchable ssh target', () => {
    for (const bad of ['', 'k3s-node', 'http://k3s-node', 'ssh://bad host', 'ssh://', undefined, 42, 'ssh://a;b']) {
      expect(parseSshEndpoint(bad)).toBeNull()
    }
  })

  it('reads the dispatch and capabilities lines from details', () => {
    expect(dispatchCommandOf('capabilities: coding\ndispatch: oc -p\nnotes')).toBe('oc -p')
    expect(dispatchCommandOf('dispatch:  lo -p  ')).toBe('lo -p')
    expect(dispatchCommandOf('nothing here')).toBeNull()
    expect(dispatchCommandOf(undefined)).toBeNull()
    expect(capabilitiesOf('capabilities: coding, decompose')).toBe('coding, decompose')
    expect(capabilitiesOf('none')).toBe('')
    expect(capabilitiesOf(42)).toBe('')
  })

  it('resolves the audit log from the env override or beside the database', () => {
    expect(defaultAuditLog()).toBe(auditPath())
    const previousDb = process.env.DSH_GANTT_DB
    const previousLog = process.env.REMOTE_AUDIT_LOG
    process.env.DSH_GANTT_DB = join(dir, 'tasks.db')
    delete process.env.REMOTE_AUDIT_LOG
    try {
      expect(defaultAuditLog()).toBe(join(dir, 'remote-exec.log'))
    } finally {
      process.env.REMOTE_AUDIT_LOG = previousLog
      if (previousDb === undefined) delete process.env.DSH_GANTT_DB
      else process.env.DSH_GANTT_DB = previousDb
    }
  })
})

describe('gantt_agents', () => {
  it('lists nothing when the registry is empty', async () => {
    const value = /** @type {any} */ (await toolIn(dispatchToolDefinitions(store), DISPATCH_TOOL_NAMES.agents).execute({}, {}))
    expect(value.ok).toBe(true)
    expect(value.markdown).toContain('尚无注册 Agent')
  })

  it('renders capabilities, dispatch eligibility, and the free-form aside', async () => {
    seedAgent()
    store.registerAgent({ name: 'plain-human', type: 'human', role: 'reviewer', description: 'reads reports', details: 'lives on the sofa' })
    store.registerAgent({ name: 'terse', type: 'ai-agent', details: 'x'.repeat(300) })
    store.registerAgent({ name: 'half-registered', type: 'ai-agent', endpoint: 'ssh://k3s-node', details: 'capabilities: coding' })
    store.registerAgent({ name: 'future-daemon', type: 'ai-agent', endpoint: 'daemon://pve', details: 'capabilities: coding' })
    store.registerAgent({ name: 'dsh-local', type: 'ai-agent', endpoint: 'local://dsh', details: 'capabilities: coding, shell' })
    const value = /** @type {any} */ (await toolIn(dispatchToolDefinitions(store), DISPATCH_TOOL_NAMES.agents).execute({}, {}))
    expect(value.markdown).toContain('**pve-oc**（ai-agent · remote coder）— oc headless runner')
    expect(value.markdown).toContain('能力：coding, decompose')
    expect(value.markdown).toContain('可远程委派：ssh k3s-node · lo -p')
    expect(value.markdown).toContain('**plain-human**（human · reviewer）— reads reports')
    expect(value.markdown).toContain('不可远程委派（endpoint 无可用投递通道或登记不完整）')
    expect(value.markdown).toContain('可远程委派：ssh k3s-node · lo -p')
    expect(value.markdown).toContain('本机节点：执行走 gantt_execute（标准模式 subagent）。')
    expect(value.markdown).toContain('lives on the sofa')
    expect(value.markdown).toContain('**terse**（ai-agent · 无角色）— （无描述）')
    expect(value.markdown).toContain('…')
  })
})

describe('registerDispatchTools', () => {
  it('registers the pair even without an effect hook', () => {
    const layers = []
    const service = { register: (definition) => { layers.push(definition); return () => {} } }
    registerDispatchTools({ get: name => (name === 'tools' ? service : undefined) }, store)
    expect(layers.map(definition => definition.name)).toEqual([DISPATCH_TOOL_NAMES.agents, DISPATCH_TOOL_NAMES.delegate])
  })

  it('stays silent without a tools service', () => {
    expect(() => registerDispatchTools({ get: () => undefined }, store)).not.toThrow()
    expect(() => registerDispatchTools({}, store)).not.toThrow()
  })
})

describe('gantt_delegate', () => {
  it('forwards the brief over ssh, claims the operator, and records the round', async () => {
    const { task, agent } = seedAgent()
    const child = new FakeChild()
    const value = await delegate({ agent: agent.name }, child)
    expect(value.ok).toBe(true)
    // The brief rides stdin because the command has no {prompt} placeholder.
    const brief = /** @type {string} */ (child.stdin.end.mock.calls[0][0])
    expect(brief).toContain('Run the probe')
    expect(brief).toContain('把探针输出存到 /tmp/probe.txt')
    expect(brief).toContain('agentName="pve-oc"')
    expect(store.requireRow(task.id).operatorId).toBe(agent.id)
    expect(store.trajectory({ taskId: task.id, limit: 8 }).some(event => event.detail.includes('delegated 执行 to pve-oc'))).toBe(true)
    expect(value.message).toContain('已把 1.1 Run the probe 委派给 pve-oc（执行）')
    expect(value.message).toContain('操作人已记为 pve-oc')
  })

  it('substitutes {prompt} inline instead of piping stdin', async () => {
    const { agent } = seedAgent()
    store.registerAgent({ id: agent.id, name: 'pve-oc', details: 'capabilities: coding\ndispatch: co exec --json \'{prompt}\'', endpoint: 'ssh://mac' })
    const child = new FakeChild()
    const value = await delegate({ agent: agent.name, goal: 'decompose' }, child)
    expect(value.ok).toBe(true)
    expect(child.stdin.end).toHaveBeenCalledWith('')
    expect(value.message).toContain('拆解')
    expect(readAudit().some(entry => entry.decision === 'allowed' && entry.command.includes('co exec'))).toBe(true)
  })

  it('reports a fast clean exit with its output excerpt', async () => {
    const { agent } = seedAgent()
    const child = new FakeChild()
    const pending = delegate({ agent: agent.name }, child)
    child.stdout.emit('data', 'launched on the remote')
    child.stderr.emit('data', 'ok: probe saved')
    child.emit('close', 0)
    const value = await pending
    expect(value.ok).toBe(true)
    expect(value.message).toContain('退出码 0')
    expect(value.message).toContain('ok: probe saved')
    expect(value.message).toContain('launched on the remote')
  })

  it('reports a failed remote command without claiming the operator', async () => {
    const { task, agent } = seedAgent()
    const child = new FakeChild()
    const pending = delegate({ agent: agent.name }, child)
    child.stderr.emit('data', 'lo: command not found')
    // A later oversized chunk still lands, bounded by the output cap.
    child.stderr.emit('data', 'x'.repeat(3000))
    // And once the cap is reached, later output is dropped entirely.
    child.stderr.emit('data', 'dropped after the cap')
    child.emit('close', 127)
    const value = await pending
    expect(value.ok).toBe(false)
    expect(value.message).toContain('退出码 127')
    expect(value.message).toContain('lo: command not found')
    expect(value.message).not.toContain('x'.repeat(2000))
    expect(value.message).not.toContain('dropped after the cap')
    expect(store.requireRow(task.id).operatorId).toBe('')
  })

  it('detaches when the remote keeps running past the ack window', async () => {
    vi.useFakeTimers()
    try {
      const { task, agent } = seedAgent()
      const child = new FakeChild()
      const pending = delegate({ agent: agent.name }, child)
      await vi.advanceTimersByTimeAsync(11)
      const value = await pending
      expect(value.ok).toBe(true)
      expect(value.message).toContain('已发出并仍在远端运行')
      expect(child.unref).toHaveBeenCalled()
      expect(child.stdout.unref).toHaveBeenCalled()
      expect(store.requireRow(task.id).operatorId).toBe(agent.id)
      // A later close still audits the finished entry.
      const before = readAudit().filter(entry => entry.decision === 'finished').length
      child.emit('close', 0)
      expect(readAudit().filter(entry => entry.decision === 'finished').length).toBe(before + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves the default identity when no env override is set', async () => {
    seedAgent()
    delete process.env.REMOTE_SSH_IDENTITY
    vi.stubEnv('HOME', '/nonexistent-dsh-gantt-home')
    try {
      const child = new FakeChild()
      const pending = delegate({ agent: 'pve-oc' }, child)
      child.emit('close', 0)
      const value = await pending
      expect(value.ok).toBe(true)
    } finally {
      vi.unstubAllEnvs()
      process.env.REMOTE_SSH_IDENTITY = '/nonexistent-dsh-gantt-key'
    }
  })

  it('uses the transport ack default when no window is given', async () => {
    seedAgent()
    let spawned = /** @type {any} */ (null)
    const tools = dispatchToolDefinitions(store, { spawnProcess: () => { spawned = new FakeChild(); return spawned } })
    const entry = toolIn(tools, DISPATCH_TOOL_NAMES.delegate)
    const pending = entry.execute({ agent: 'pve-oc' }, { agent: { session: { id: 'session-a' } } })
    await Promise.resolve()
    spawned.emit('close', 0)
    const value = /** @type {any} */ (await pending)
    expect(value.ok).toBe(true)
    expect(value.message).toContain('退出码 0')
  })

  it('tolerates a child without pipes and unref handles', async () => {
    const { task, agent } = seedAgent()
    const bare = new EventEmitter()
    const pending = delegate({ agent: agent.name }, /** @type {any} */ (bare))
    await Promise.resolve()
    bare.emit('close', 0)
    const value = await pending
    expect(value.ok).toBe(true)
    expect(store.requireRow(task.id).operatorId).toBe(agent.id)
  })

  it('reports a spawn error of any shape', async () => {
    const { task, agent } = seedAgent()
    const child = new FakeChild()
    const pending = delegate({ agent: agent.name }, child)
    child.emit('error', new Error('spawn ssh ENOENT'))
    const value = await pending
    expect(value.ok).toBe(false)
    expect(value.message).toContain('spawn ssh ENOENT')
    expect(store.requireRow(task.id).operatorId).toBe('')
    const bare = new FakeChild()
    const barePending = delegate({ agent: agent.name }, bare)
    bare.emit('error', 'plain failure')
    const bareValue = await barePending
    expect(bareValue.ok).toBe(false)
    expect(bareValue.message).toContain('plain failure')
  })

  it('reports a failed exit with stdout only, no output, and an unknown code', async () => {
    seedAgent()
    const stdoutOnly = new FakeChild()
    const stdoutPending = delegate({ agent: 'pve-oc' }, stdoutOnly)
    stdoutOnly.stdout.emit('data', 'remote log line')
    stdoutOnly.emit('close', 1)
    const stdoutValue = await stdoutPending
    expect(stdoutValue.ok).toBe(false)
    expect(stdoutValue.message).toContain('remote log line')

    const silent = new FakeChild()
    const silentPending = delegate({ agent: 'pve-oc' }, silent)
    silent.emit('close', 3)
    const silentValue = await silentPending
    expect(silentValue.ok).toBe(false)
    expect(silentValue.message).toContain('退出码 3')
    expect(silentValue.message).not.toContain('远端输出')

    const unknown = new FakeChild()
    const unknownPending = delegate({ agent: 'pve-oc' }, unknown)
    unknown.emit('close', null)
    const unknownValue = await unknownPending
    expect(unknownValue.ok).toBe(false)
    expect(unknownValue.message).toContain('退出码 未知')
  })

  it('reports a synchronous spawn throw of any shape', async () => {
    seedAgent()
    const plain = toolsWith(() => { throw 'boom-string' })
    const plainValue = await /** @type {any} */ (toolIn(plain, DISPATCH_TOOL_NAMES.delegate)).execute({ agent: 'pve-oc' }, { agent: { session: { id: 'session-a' } } })
    expect(plainValue.ok).toBe(false)
    expect(plainValue.message).toContain('boom-string')
    const tools = toolsWith(() => { throw new Error('no ssh binary') })
    const value = /** @type {any} */ (await toolIn(tools, DISPATCH_TOOL_NAMES.delegate).execute({ agent: 'pve-oc' }, { agent: { session: { id: 'session-a' } } }))
    expect(value.ok).toBe(false)
    expect(value.message).toContain('无法启动 ssh')
  })

  it('refuses a destructive registered command before ssh runs', async () => {
    const { task, agent } = seedAgent()
    store.registerAgent({ id: agent.id, name: 'pve-oc', details: 'dispatch: rm -rf /', endpoint: 'ssh://k3s-node' })
    let spawned = false
    const tools = toolsWith(() => { spawned = true; return new FakeChild() })
    const value = /** @type {any} */ (await toolIn(tools, DISPATCH_TOOL_NAMES.delegate).execute({ agent: 'pve-oc' }, { agent: { session: { id: 'session-a' } } }))
    expect(spawned).toBe(false)
    expect(value.ok).toBe(false)
    expect(value.message).toContain('安全守门拒绝')
    expect(readAudit().some(entry => entry.decision === 'refused')).toBe(true)
    expect(store.requireRow(task.id).operatorId).toBe('')
  })

  it('refuses delegation to an agent without endpoint or dispatch registration', async () => {
    const { agent } = seedAgent()
    store.registerAgent({ id: agent.id, name: 'pve-oc', details: 'capabilities: coding', endpoint: '' })
    await expect(delegate({ agent: 'pve-oc' }, new FakeChild())).rejects.toThrow('未登记可接收远程派发的 endpoint')
    store.registerAgent({ id: agent.id, name: 'pve-oc', details: 'capabilities: coding', endpoint: 'ssh://bad host' })
    await expect(delegate({ agent: 'pve-oc' }, new FakeChild())).rejects.toThrow('不是可用的 ssh 目标')
    store.registerAgent({ id: agent.id, name: 'pve-oc', details: 'capabilities: coding', endpoint: 'ssh://k3s-node' })
    await expect(delegate({ agent: 'pve-oc' }, new FakeChild())).rejects.toThrow('dispatch 命令')
  })

  it('redirects a local node registration to gantt_execute', async () => {
    store.create({ title: 'Lonely task' })
    store.registerAgent({ name: 'dsh-local', type: 'ai-agent', details: 'capabilities: coding, shell', endpoint: 'local://dsh' })
    await expect(delegate({ id: '1', agent: 'dsh-local' }, new FakeChild())).rejects.toThrow('是本机节点（local://）；本机执行请用 gantt_execute')
  })

  it('rejects an endpoint scheme with no transport yet', async () => {
    store.create({ title: 'Lonely task' })
    store.registerAgent({ name: 'pve-daemon', type: 'ai-agent', details: 'capabilities: coding', endpoint: 'daemon://pve' })
    await expect(delegate({ id: '1', agent: 'pve-daemon' }, new FakeChild())).rejects.toThrow('endpoint 方案 daemon 暂无投递通道')
    await expect(delegate({ id: '1', agent: 'pve-daemon' }, new FakeChild())).rejects.toThrow('daemon 直连形态在规划中')
  })

  it('names the registered agents when the requested one is unknown', async () => {
    seedAgent()
    await expect(delegate({ agent: 'ghost' }, new FakeChild())).rejects.toThrow('agent ghost was not found; 已注册：pve-oc')
    await expect(delegate({}, new FakeChild())).rejects.toThrow('agent is required')
  })

  it('names an empty registry when nobody has registered', async () => {
    store.create({ title: 'Lonely task' })
    await expect(delegate({ id: '1', agent: 'ghost' }, new FakeChild())).rejects.toThrow('（注册表为空）')
  })

  it('labels a tasked ref in both the brief and the result', async () => {
    store.create({ title: 'Referenced task', kind: 'task', ref: 'R7', doneWhen: 'saved' })
    const agent = store.registerAgent({ name: 'pve-oc', details: 'dispatch: lo -p', endpoint: 'ssh://k3s-node' })
    const child = new FakeChild()
    const pending = delegate({ id: 'R7', agent: agent.name }, child, {})
    child.emit('close', 0)
    const value = await pending
    expect(value.message).toContain('已把 R7 Referenced task 委派给 pve-oc（执行）')
    const brief = /** @type {string} */ (child.stdin.end.mock.calls[0][0])
    expect(brief).toContain('任务：R7 Referenced task')
  })

  it('requires a focused task when no id is given', async () => {
    seedAgent()
    const child = new FakeChild()
    await expect(delegate({ agent: 'pve-oc' }, child, { agent: { session: { id: 'session-z' } } })).rejects.toThrow('id is required')
    // An explicit reference works without focus.
    const pending = delegate({ id: '1.1', agent: 'pve-oc' }, child, { agent: { session: { id: 'session-z' } } })
    child.emit('close', 0)
    await expect(pending).resolves.toMatchObject({ ok: true })
  })

  it('keeps an existing operator instead of stealing the task', async () => {
    const { task, agent } = seedAgent()
    const other = store.registerAgent({ name: 'mac-co', endpoint: 'ssh://mac', details: 'dispatch: co exec -' })
    store.update(task.id, { operatorId: other.id })
    const value = await delegate({ agent: agent.name }, new FakeChild())
    expect(value.ok).toBe(true)
    expect(value.message).toContain('任务已有操作人，未改动')
    expect(store.requireRow(task.id).operatorId).toBe(other.id)
  })

  it('claims the operator even without a calling conversation', async () => {
    const { task, agent } = seedAgent()
    const child = new FakeChild()
    const pending = delegate({ id: '1.1', agent: agent.name }, child, {})
    child.emit('close', 0)
    const value = await pending
    expect(value.ok).toBe(true)
    expect(store.requireRow(task.id).operatorId).toBe(agent.id)
    expect(store.trajectory({ taskId: task.id, limit: 8 }).every(event => !event.detail.includes('delegated'))).toBe(true)
  })

  it('rejects an unknown goal', async () => {
    seedAgent()
    await expect(delegate({ agent: 'pve-oc', goal: 'destroy' }, new FakeChild())).rejects.toThrow('goal must be one of')
  })

  it('renders results as plain text', async () => {
    const tools = toolsWith(() => new FakeChild())
    const agents = /** @type {any} */ (toolIn(tools, DISPATCH_TOOL_NAMES.agents))
    const delegateEntry = /** @type {any} */ (toolIn(tools, DISPATCH_TOOL_NAMES.delegate))
    const agentsValue = await agents.execute({}, {})
    expect(agents.output.render({}, agentsValue)).toEqual([{ type: 'text', text: agentsValue.markdown }])
    const { agent } = seedAgent()
    const child = new FakeChild()
    const pending = delegateEntry.execute({ agent: agent.name }, { agent: { session: { id: 'session-a' } } })
    child.emit('close', 0)
    const value = await pending
    expect(delegateEntry.output.render({}, value)).toEqual([{ type: 'text', text: value.message }])
  })

  it('records allowed and finished audit entries with the redacted command', async () => {
    const { agent } = seedAgent()
    const child = new FakeChild()
    const pending = delegate({ agent: agent.name }, child)
    child.emit('close', 0)
    const value = await pending
    expect(value.ok).toBe(true)
    const entries = readAudit()
    expect(entries.map(entry => entry.decision)).toEqual(['allowed', 'finished'])
    expect(entries[0].agent).toBe(agent.name)
    expect(entries[0].target).toBe('k3s-node')
    expect(entries[0].command).toContain('lo -p')
  })
})

describe('the delegation brief', () => {
  it('ignores a non-string note and bounds a long one', async () => {
    seedAgent()
    const child = new FakeChild()
    const pending = delegate({ agent: 'pve-oc', note: 42 }, child)
    child.emit('close', 0)
    const value = await pending
    expect(value.ok).toBe(true)
    const longNote = new FakeChild()
    const longPending = delegate({ agent: 'pve-oc', note: 'y'.repeat(600) }, longNote)
    longNote.emit('close', 0)
    await longPending
    const brief = /** @type {string} */ (longNote.stdin.end.mock.calls[0][0])
    expect(brief).toContain('y'.repeat(500))
    expect(brief).not.toContain('y'.repeat(501))
  })

  it('carries the task, the goal report instructions, and a bounded note', () => {
    const { task } = seedAgent()
    const agent = store.listAgents({ limit: 100 })[0]
    const brief = buildDelegateBrief(store.getNode(task.id), agent, 'execute', 'keep the logs')
    expect(brief).toContain('补充要求：keep the logs')
    expect(brief).toContain('report_completion')
    expect(brief).toContain('【甘特任务委派 · 执行】')
  })

  it('switches the report instructions for a decompose goal', () => {
    const { task } = seedAgent()
    const agent = store.listAgents({ limit: 100 })[0]
    const brief = buildDelegateBrief(store.getNode(task.id), agent, 'decompose', '')
    expect(brief).toContain('decompose_task')
    expect(brief).toContain('只拆解、不执行')
    expect(brief).not.toContain('补充要求')
  })

  it('marks empty fields instead of leaving them blank', () => {
    const track = store.create({ title: 'Bare', kind: 'track', ref: 'B9' })
    const task = store.create({ title: 'No standards', parentId: track.id })
    const brief = buildDelegateBrief(store.getNode(task.id), /** @type {any} */ ({ name: 'solo' }), 'execute', '')
    expect(brief).toContain('完成标准：（未填写）')
    expect(brief).toContain('说明：\n（无）')
  })
})
