import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AGENT_TYPES, GanttStore } from '../../src/host/store.js'
import { mergeAgentFields, normalizeAgentFields, normalizeAgentFilter } from '../../src/host/store/agents.js'
import { expectGanttError, expectIsoTimestamp } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

describe('agent field normalization', () => {
  it('defaults the type and trims every text field', () => {
    expect(normalizeAgentFields({
      name: '  Codex   CLI ',
      role: ' implementer ',
      description: ' writes code ',
      details: ' long notes ',
      endpoint: ' http://127.0.0.1:9000 ',
    })).toEqual({
      name: 'Codex CLI',
      type: 'ai-agent',
      role: 'implementer',
      description: 'writes code',
      details: 'long notes',
      endpoint: 'http://127.0.0.1:9000',
    })
    expect(normalizeAgentFields({ name: 'Human', type: 'human' })).toEqual({
      name: 'Human', type: 'human', role: '', description: '', details: '', endpoint: '',
    })
    expect(normalizeAgentFields({ name: 'Nulls', type: null, role: null, description: null, details: null, endpoint: null }))
      .toMatchObject({ type: 'ai-agent', role: '', description: '', details: '', endpoint: '' })
  })

  it('rejects a missing, blank, or over-long name and a non-string field', () => {
    expectGanttError(() => normalizeAgentFields({}), 'name is required')
    expectGanttError(() => normalizeAgentFields({ name: 7 }), 'name is required')
    expectGanttError(() => normalizeAgentFields({ name: '   ' }), 'name is required')
    expectGanttError(() => normalizeAgentFields({ name: 'x'.repeat(101) }), 'name must be at most 100 characters')
    expectGanttError(() => normalizeAgentFields({ name: 'Codex', role: 7 }), 'role must be a string')
    expectGanttError(() => normalizeAgentFields({ name: 'Codex', description: 7 }), 'description must be a string')
    expectGanttError(() => normalizeAgentFields({ name: 'Codex', details: 7 }), 'details must be a string')
    expectGanttError(() => normalizeAgentFields({ name: 'Codex', endpoint: 7 }), 'endpoint must be a string')
    expectGanttError(() => normalizeAgentFields({ name: 'Codex', role: 'r'.repeat(2001) }), 'role must be at most 2000 characters')
    expectGanttError(() => normalizeAgentFields({ name: 'Codex', type: 'robot' }), `type must be one of ${AGENT_TYPES.join(', ')}`)
  })

  it('normalizes list filters and validates the limit', () => {
    expect(normalizeAgentFilter()).toEqual({ type: '', role: '', q: '', limit: 20 })
    expect(normalizeAgentFilter({ type: null, role: null, q: null, limit: null }))
      .toEqual({ type: '', role: '', q: '', limit: 20 })
    expect(normalizeAgentFilter({ type: 'human', role: ' reviewer ', q: ' cli', limit: '5' }))
      .toEqual({ type: 'human', role: 'reviewer', q: 'cli', limit: 5 })
    expectGanttError(() => normalizeAgentFilter({ type: 'robot' }), `type must be one of ${AGENT_TYPES.join(', ')}`)
    expectGanttError(() => normalizeAgentFilter({ role: 7 }), 'role must be a string')
    expectGanttError(() => normalizeAgentFilter({ q: 7 }), 'q must be a string')
    for (const limit of [0, 101, 1.5, 'x']) {
      expectGanttError(() => normalizeAgentFilter({ limit }), 'limit must be an integer from 1 to 100')
    }
  })
})

describe('mergeAgentFields', () => {
  /** @type {import('../../src/host/store/agents.js').AgentRow} */
  const existing = {
    id: 'a1',
    name: 'Codex',
    type: 'human',
    role: 'dev',
    description: 'writes code',
    details: 'capabilities: coding\ndispatch: nohup lo -p',
    endpoint: 'ssh://mac',
    createdAt: '',
    updatedAt: '',
  }

  it('keeps every field the input omits', () => {
    expect(mergeAgentFields(existing, { name: 'Codex', type: null })).toEqual({
      name: 'Codex',
      type: 'human',
      role: 'dev',
      description: 'writes code',
      details: 'capabilities: coding\ndispatch: nohup lo -p',
      endpoint: 'ssh://mac',
    })
  })

  it('overwrites provided fields and keeps null ones', () => {
    expect(mergeAgentFields(existing, {
      name: ' Codex  2 ',
      type: 'ai-agent',
      role: null,
      description: 'reviews code',
      details: '',
      endpoint: ' ssh://mac ',
    })).toEqual({
      name: 'Codex 2',
      type: 'ai-agent',
      role: 'dev',
      description: 'reviews code',
      details: '',
      endpoint: 'ssh://mac',
    })
  })

  it('validates the provided fields exactly like a fresh registration', () => {
    expectGanttError(() => mergeAgentFields(existing, {}), 'name is required')
    expectGanttError(() => mergeAgentFields(existing, { name: 'Codex', role: 7 }), 'role must be a string')
    expectGanttError(() => mergeAgentFields(existing, { name: 'Codex', type: 'robot' }), `type must be one of ${AGENT_TYPES.join(', ')}`)
    expectGanttError(() => mergeAgentFields(existing, { name: 'x'.repeat(101) }), 'name must be at most 100 characters')
  })
})

describe('registerAgent', () => {
  it('inserts by name and ignores an unknown id', () => {
    const agent = store.registerAgent({ id: 'missing', name: 'Codex', type: 'ai-agent', role: 'dev' })
    expect(agent).toMatchObject({ name: 'Codex', type: 'ai-agent', role: 'dev', description: '', details: '', endpoint: '' })
    expect(agent.id).toMatch(/^[0-9a-f-]{36}$/)
    expectIsoTimestamp(agent.createdAt)
    expectIsoTimestamp(agent.updatedAt)
    expect(store.getAgent(agent.id)).toEqual(agent)
  })

  it('updates the same name instead of inserting a duplicate', () => {
    const first = store.registerAgent({ name: 'Codex', type: 'ai-agent', role: 'dev' })
    const second = store.registerAgent({ name: 'Codex', type: 'human', role: 'reviewer', description: 'changed' })
    expect(second).toMatchObject({ id: first.id, type: 'human', role: 'reviewer', description: 'changed', createdAt: first.createdAt })
    expect(store.listAgents()).toHaveLength(1)
  })

  it('keeps the stored dispatch contract a re-registration omits', () => {
    store.registerAgent({
      name: 'claude-code-http',
      type: 'ai-agent',
      role: 'implementer',
      description: 'Claude Code on k3s-node over HTTP MCP via lo',
      details: 'capabilities: coding, shell, linux, k3s\ndispatch: export PATH=$HOME/.local/bin:$PATH; nohup lo -p',
      endpoint: 'ssh://k3s-node',
    })
    // The installer evidence call re-registers identity only; the endpoint and
    // the dispatch details must survive it.
    const kept = store.registerAgent({ name: 'claude-code-http', type: 'ai-agent', role: 'implementer' })
    expect(kept).toMatchObject({
      description: 'Claude Code on k3s-node over HTTP MCP via lo',
      details: 'capabilities: coding, shell, linux, k3s\ndispatch: export PATH=$HOME/.local/bin:$PATH; nohup lo -p',
      endpoint: 'ssh://k3s-node',
    })
    expect(store.listAgents()).toHaveLength(1)
    // A provided field, empty string included, still overwrites.
    const cleared = store.registerAgent({ name: 'claude-code-http', details: '', endpoint: '' })
    expect(cleared).toMatchObject({ details: '', endpoint: '', role: 'implementer' })
    // Null counts as omitted for every field.
    const nulled = store.registerAgent({ name: 'claude-code-http', role: null, description: null, details: null, endpoint: null })
    expect(nulled).toMatchObject({ role: 'implementer', details: '', endpoint: '' })
  })

  it('keeps the stored type and endpoint when the id path omits them', () => {
    const agent = store.registerAgent({ name: 'Human', type: 'human', endpoint: 'ssh://k3s-node' })
    const reregistered = store.registerAgent({ id: agent.id, name: 'Human', role: 'ops' })
    expect(reregistered).toMatchObject({ id: agent.id, type: 'human', role: 'ops', endpoint: 'ssh://k3s-node' })
    expectGanttError(
      () => store.registerAgent({ id: agent.id, name: 'Human', type: 'robot' }),
      `type must be one of ${AGENT_TYPES.join(', ')}`,
    )
    expectGanttError(() => store.registerAgent({ id: agent.id, name: 'Human', role: 7 }), 'role must be a string')
    expect(store.getAgent(agent.id)).toMatchObject({ type: 'human', endpoint: 'ssh://k3s-node' })
  })

  it('updates by id and checks the unique name', () => {
    const codex = store.registerAgent({ name: 'Codex', type: 'ai-agent' })
    const other = store.registerAgent({ name: 'Other', type: 'human' })
    const updated = store.registerAgent({ id: codex.id, name: 'Codex 2', type: 'human', details: 'renamed' })
    expect(updated).toMatchObject({ id: codex.id, name: 'Codex 2', type: 'human', details: 'renamed' })
    expectGanttError(
      () => store.registerAgent({ id: codex.id, name: 'Other', type: 'human' }),
      'agent name Other already exists',
      409,
    )
    expect(store.registerAgent({ id: other.id, name: 'Other', type: 'human', role: 'kept' }))
      .toMatchObject({ id: other.id, name: 'Other', role: 'kept' })
  })

  it('rejects invalid agent input before writing', () => {
    expectGanttError(() => store.registerAgent({ name: '  ' }), 'name is required')
    expect(store.count()).toBe(0)
  })
})

describe('agent lookup and listing', () => {
  it('lists, filters, and caps agents in name order', () => {
    store.registerAgent({ name: 'Zulu', type: 'human', role: 'reviewer', description: 'audits code' })
    store.registerAgent({ name: 'Alpha', type: 'ai-agent', role: 'implementer', details: 'writes tests' })
    store.registerAgent({ name: 'Beta', type: 'ai-agent', role: 'implementer', description: 'deploys' })

    expect(store.listAgents().map(agent => agent.name)).toEqual(['Alpha', 'Beta', 'Zulu'])
    expect(store.listAgents({ type: 'human' }).map(agent => agent.name)).toEqual(['Zulu'])
    expect(store.listAgents({ role: 'implementer' }).map(agent => agent.name)).toEqual(['Alpha', 'Beta'])
    expect(store.listAgents({ q: 'TESTS' }).map(agent => agent.name)).toEqual(['Alpha'])
    expect(store.listAgents({ q: 'audits' }).map(agent => agent.name)).toEqual(['Zulu'])
    expect(store.listAgents({ q: 'implementer' }).map(agent => agent.name)).toEqual(['Alpha', 'Beta'])
    expect(store.listAgents({ q: 'nothing' })).toEqual([])
    expect(store.listAgents({ limit: 1 }).map(agent => agent.name)).toEqual(['Alpha'])
    expect(store.listAgents({ type: 'ai-agent', role: 'implementer', q: 'deploys' }).map(agent => agent.name)).toEqual(['Beta'])
  })

  it('reads one agent and reports a missing id with 404', () => {
    const agent = store.registerAgent({ name: 'Codex' })
    expect(store.getAgent(agent.id)?.name).toBe('Codex')
    expect(store.getAgent('')).toBeNull()
    expect(store.getAgent(7)).toBeNull()
    expect(store.getAgent('missing')).toBeNull()
    expect(store.requireAgent(agent.id).id).toBe(agent.id)
    expectGanttError(() => store.requireAgent('missing'), 'agent missing was not found', 404)
    expectGanttError(() => store.requireAgent(7), 'agent 7 was not found', 404)
  })
})

describe('task agent fields', () => {
  it('stores operator, completer, and report on create and update', () => {
    const created = store.create({
      title: 'Reported task',
      operatorId: '  agent-1 ',
      completedById: 'agent-2',
      report: '  shipped  ',
    })
    expect(created).toMatchObject({ operatorId: 'agent-1', completedById: 'agent-2', report: 'shipped' })
    const updated = store.update(created.id, { operatorId: 'agent-3', completedById: '', report: 'next' })
    expect(updated).toMatchObject({ operatorId: 'agent-3', completedById: '', report: 'next' })
  })

  it('accepts empty and null agent references and validates the types', () => {
    expect(store.create({ title: 'Empty', operatorId: '', completedById: null }))
      .toMatchObject({ operatorId: '', completedById: '', report: '' })
    expectGanttError(() => store.create({ title: 'Bad', operatorId: 7 }), 'operatorId must be a string')
    expectGanttError(() => store.create({ title: 'Bad', completedById: 7 }), 'completedById must be a string')
    expectGanttError(() => store.create({ title: 'Bad', operatorId: 'x'.repeat(101) }), 'operatorId must be at most 100 characters')
    expectGanttError(() => store.create({ title: 'Bad', report: 7 }), 'report must be a string')
    expectGanttError(() => store.create({ title: 'Bad', report: 'x'.repeat(4001) }), 'report must be at most 4000 characters')
  })
})

describe('reportCompletion', () => {
  it('writes the operator, completer, report, status, and one complete event', () => {
    const task = store.create({ title: 'Data table' })
    const agent = store.registerAgent({ name: 'Codex', type: 'ai-agent' })
    const result = store.reportCompletion({ taskId: ` ${task.id} `, agentId: ` ${agent.id} `, report: '  table shipped  ' })
    expect(result.task).toMatchObject({
      id: task.id,
      status: 'done',
      progress: 100,
      operatorId: agent.id,
      completedById: agent.id,
      report: 'table shipped',
    })
    expect(result.event).toMatchObject({ taskId: task.id, action: 'complete', detail: 'table shipped', sessionId: '' })
    expect(store.trajectory({ taskId: task.id })).toHaveLength(1)
  })

  it('keeps the first operator and accepts an explicit status and progress', () => {
    const task = store.create({ title: 'Data table' })
    const first = store.registerAgent({ name: 'First' })
    const second = store.registerAgent({ name: 'Second' })
    store.reportCompletion({ taskId: task.id, agentId: first.id, report: 'first pass' })
    const result = store.reportCompletion({
      taskId: task.id,
      agentId: second.id,
      report: 'second pass',
      status: 'in_progress',
      progress: 40,
    })
    expect(result.task).toMatchObject({
      status: 'in_progress',
      progress: 40,
      operatorId: first.id,
      completedById: second.id,
      report: 'second pass',
    })
    expect(result.event.detail).toBe('second pass')
  })

  it('keeps the full report on the task but truncates the event detail', () => {
    const task = store.create({ title: 'Long report' })
    const agent = store.registerAgent({ name: 'Codex' })
    const result = store.reportCompletion({ taskId: task.id, agentId: agent.id, report: 'x'.repeat(300) })
    expect(result.task?.report).toBe('x'.repeat(300))
    expect(result.event.detail).toBe(`${'x'.repeat(200)}…`)
    expect([...result.event.detail]).toHaveLength(201)
  })

  it('defaults an in-progress report to 50% and a todo report to 0%', () => {
    const task = store.create({ title: 'Data table' })
    const agent = store.registerAgent({ name: 'Codex' })
    expect(store.reportCompletion({ taskId: task.id, agentId: agent.id, report: 'started', status: 'in_progress' }).task)
      .toMatchObject({ status: 'in_progress', progress: 50 })
    expect(store.reportCompletion({ taskId: task.id, agentId: agent.id, report: 'reset', status: 'todo' }).task)
      .toMatchObject({ status: 'todo', progress: 0 })
  })

  it('recomputes ancestor rollups after the write', () => {
    const parent = store.create({ title: 'Parent' })
    const child = store.create({ title: 'Child', parentId: parent.id })
    const agent = store.registerAgent({ name: 'Codex' })
    store.reportCompletion({ taskId: child.id, agentId: agent.id, report: 'done' })
    expect(store.getNode(parent.id)).toMatchObject({ status: 'done', progress: 100 })
  })

  it('rejects a blank report, unknown task or agent, and invalid status or progress', () => {
    const task = store.create({ title: 'Data table' })
    const agent = store.registerAgent({ name: 'Codex' })
    expectGanttError(() => store.reportCompletion({ taskId: task.id, agentId: agent.id, report: '   ' }), 'report is required')
    expectGanttError(() => store.reportCompletion({ taskId: task.id, agentId: agent.id }), 'report is required')
    expectGanttError(() => store.reportCompletion({ taskId: 'missing', agentId: agent.id, report: 'x' }), 'task missing was not found', 404)
    expectGanttError(() => store.reportCompletion({ taskId: task.id, agentId: 'missing', report: 'x' }), 'agent missing was not found', 404)
    expectGanttError(() => store.reportCompletion({ agentId: agent.id, report: 'x' }), 'taskId is required')
    expectGanttError(() => store.reportCompletion({ taskId: task.id, report: 'x' }), 'agentId is required')
    expectGanttError(() => store.reportCompletion({ taskId: 7, agentId: agent.id, report: 'x' }), 'taskId is required')
    expectGanttError(() => store.reportCompletion({ taskId: '   ', agentId: agent.id, report: 'x' }), 'taskId is required')
    expectGanttError(() => store.reportCompletion({ taskId: task.id, agentId: '   ', report: 'x' }), 'agentId is required')
    expectGanttError(
      () => store.reportCompletion({ taskId: task.id, agentId: agent.id, report: 'x', status: 'archived' }),
      'status must be one of todo, in_progress, blocked, done, cancelled',
    )
    expectGanttError(
      () => store.reportCompletion({ taskId: task.id, agentId: agent.id, report: 'x', progress: 'high' }),
      'progress must be a number from 0 to 100',
    )
    expect(store.trajectory({ taskId: task.id })).toEqual([])
  })
})
