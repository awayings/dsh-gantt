import { afterEach, describe, expect, it } from 'vitest'
import { ROUTES, bootPlugin, disposeAll, invoke } from '../helpers/host.js'

let boot

function start() {
  boot = bootPlugin()
  return boot
}

afterEach(() => {
  if (boot) disposeAll(boot.disposers)
  boot = undefined
})

/** Create one task through the write route and return it. */
async function createTask(routes, title = 'Agent task', extra = {}) {
  const created = await invoke(routes, ROUTES.tasks, { title, ...extra })
  return created.payload.task
}

/** Register one agent through the route and return it. */
async function registerAgent(routes, body) {
  const created = await invoke(routes, ROUTES.registerAgent, { type: 'ai-agent', ...body })
  return created.payload.agent
}

describe('GET /api/gantt/agents', () => {
  it('returns an empty agent list and the cache headers', async () => {
    const { routes } = start()
    const result = await invoke(routes, ROUTES.agents)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(result.payload).toEqual({ ok: true, agents: [] })
  })

  it('lists and filters registered agents', async () => {
    const { routes } = start()
    const codex = await registerAgent(routes, { name: 'Codex', role: 'implementer', description: 'writes code' })
    await registerAgent(routes, { name: 'Claude', type: 'human', role: 'reviewer', details: 'audits code' })
    expect((await invoke(routes, `${ROUTES.agents}?type=human`)).payload.agents.map(agent => agent.name))
      .toEqual(['Claude'])
    expect((await invoke(routes, `${ROUTES.agents}?role=implementer`)).payload.agents.map(agent => agent.name))
      .toEqual(['Codex'])
    expect((await invoke(routes, `${ROUTES.agents}?q=audits`)).payload.agents.map(agent => agent.name))
      .toEqual(['Claude'])
    expect((await invoke(routes, `${ROUTES.agents}?limit=1`)).payload.agents.map(agent => agent.name))
      .toEqual(['Claude'])
    expect((await invoke(routes, `${ROUTES.agents}?type=ai-agent&q=codex`)).payload.agents.map(agent => agent.id))
      .toEqual([codex.id])
  })

  it('rejects an invalid type and limit', async () => {
    const { routes } = start()
    const badType = await invoke(routes, `${ROUTES.agents}?type=robot`)
    expect(badType.status).toBe(400)
    expect(badType.payload).toEqual({ ok: false, error: 'type must be one of human, ai-agent' })
    const badLimit = await invoke(routes, `${ROUTES.agents}?limit=0`)
    expect(badLimit.status).toBe(400)
    expect(badLimit.payload.error).toBe('limit must be an integer from 1 to 100')
  })
})

describe('POST /api/gantt/agents', () => {
  it('registers an agent and is idempotent by name', async () => {
    const { routes } = start()
    const first = await invoke(routes, ROUTES.registerAgent, {
      name: 'Codex',
      type: 'ai-agent',
      role: 'implementer',
      description: 'writes code',
      details: 'details',
      endpoint: 'http://127.0.0.1:9000',
    })
    expect(first.status).toBe(200)
    expect(first.payload).toMatchObject({
      ok: true,
      agent: {
        name: 'Codex',
        type: 'ai-agent',
        role: 'implementer',
        description: 'writes code',
        details: 'details',
        endpoint: 'http://127.0.0.1:9000',
      },
    })
    const id = first.payload.agent.id
    const second = await invoke(routes, ROUTES.registerAgent, { name: 'Codex', type: 'human', role: 'reviewer' })
    expect(second.payload.agent).toMatchObject({ id, type: 'human', role: 'reviewer' })
    // Fields the body omits keep their stored values.
    expect(second.payload.agent).toMatchObject({
      description: 'writes code', details: 'details', endpoint: 'http://127.0.0.1:9000',
    })
    expect((await invoke(routes, ROUTES.agents)).payload.agents).toHaveLength(1)
  })

  it('validates the body and maps a duplicate name', async () => {
    const { routes } = start()
    const malformed = await invoke(routes, ROUTES.registerAgent, '{oops')
    expect(malformed.status).toBe(400)
    expect(malformed.payload.error).toBe('request body must be valid JSON')
    const array = await invoke(routes, ROUTES.registerAgent, '[]')
    expect(array.status).toBe(400)
    expect(array.payload.error).toBe('request body must be a JSON object')
    const missing = await invoke(routes, ROUTES.registerAgent, { type: 'ai-agent' })
    expect(missing.status).toBe(400)
    expect(missing.payload.error).toBe('name is required')
    const badType = await invoke(routes, ROUTES.registerAgent, { name: 'Codex', type: 'robot' })
    expect(badType.status).toBe(400)
    expect(badType.payload.error).toBe('type must be one of human, ai-agent')

    const first = await registerAgent(routes, { name: 'Codex' })
    await registerAgent(routes, { name: 'Other' })
    const conflict = await invoke(routes, ROUTES.registerAgent, { id: first.id, name: 'Other', type: 'human' })
    expect(conflict.status).toBe(409)
    expect(conflict.payload.error).toBe('agent name Other already exists')
  })
})

describe('GET /api/gantt/task/context', () => {
  it('renders the context markdown plus the compact task', async () => {
    const { routes } = start()
    const task = await createTask(routes, 'Context task', {
      description: 'a note',
      doneWhen: 'verified',
      operatorId: 'agent-1',
    })
    const result = await invoke(routes, `${ROUTES.taskContext}?taskId=${task.id}`)
    expect(result.status).toBe(200)
    expect(result.payload.ok).toBe(true)
    expect(result.payload.taskId).toBe(task.id)
    expect(result.payload.chars).toBe(result.payload.markdown.length)
    expect(result.payload.markdown).toContain('# 任务上下文：1 Context task（任务）')
    expect(result.payload.task).toEqual({
      id: task.id,
      number: '1',
      ref: '',
      title: 'Context task',
      status: 'todo',
      progress: 0,
      doneWhen: 'verified',
    })
  })

  it('requires a task id and reports an unknown task', async () => {
    const { routes } = start()
    const missing = await invoke(routes, ROUTES.taskContext)
    expect(missing.status).toBe(400)
    expect(missing.payload.error).toBe('taskId is required')
    const blank = await invoke(routes, `${ROUTES.taskContext}?taskId=%20`)
    expect(blank.status).toBe(400)
    expect(blank.payload.error).toBe('taskId is required')
    const unknown = await invoke(routes, `${ROUTES.taskContext}?taskId=missing`)
    expect(unknown.status).toBe(404)
    expect(unknown.payload.error).toBe('task missing was not found')
  })
})

describe('GET /api/gantt/ready', () => {
  it('defaults to ready and supports next, todo, and a limit', async () => {
    const { routes } = start()
    await createTask(routes, 'First')
    await createTask(routes, 'Second')
    const ready = await invoke(routes, ROUTES.ready)
    expect(ready.status).toBe(200)
    expect(ready.payload.tag).toBe('ready')
    expect(ready.payload.tasks.map(task => task.title)).toEqual(['First', 'Second'])
    const limited = await invoke(routes, `${ROUTES.ready}?limit=1`)
    expect(limited.payload.tasks.map(task => task.title)).toEqual(['First'])
    const todo = await invoke(routes, `${ROUTES.ready}?tag=todo`)
    expect(todo.payload.tag).toBe('todo')
    expect(todo.payload.tasks).toHaveLength(2)
    const next = await invoke(routes, `${ROUTES.ready}?tag=next`)
    expect(next.payload).toEqual({ ok: true, tag: 'next', tasks: [] })
  })

  it('validates the tag and limit', async () => {
    const { routes } = start()
    const tag = await invoke(routes, `${ROUTES.ready}?tag=later`)
    expect(tag.status).toBe(400)
    expect(tag.payload.error).toBe('tag must be one of ready, next, todo')
    const limit = await invoke(routes, `${ROUTES.ready}?limit=101`)
    expect(limit.status).toBe(400)
    expect(limit.payload.error).toBe('limit must be an integer from 1 to 100')
  })

  it('filters by manual tags in any and and mode and returns the tags', async () => {
    const { routes } = start()
    await createTask(routes, 'Ops one', { tags: ['ops'] })
    await createTask(routes, 'Ops db', { tags: ['ops', 'db'] })
    await createTask(routes, 'Db one', { tags: ['db'] })
    await createTask(routes, 'Plain')

    const all = await invoke(routes, ROUTES.ready)
    expect(all.payload.tasks.map(task => task.title)).toEqual(['Ops one', 'Ops db', 'Db one', 'Plain'])
    expect(all.payload.tasks.map(task => task.tags)).toEqual([['ops'], ['ops', 'db'], ['db'], []])

    const any = await invoke(routes, `${ROUTES.ready}?tags=ops`)
    expect(any.payload.tasks.map(task => task.title)).toEqual(['Ops one', 'Ops db'])
    const and = await invoke(routes, `${ROUTES.ready}?tags=ops,db&mode=and`)
    expect(and.payload.tasks.map(task => task.title)).toEqual(['Ops db'])
    const repeated = await invoke(routes, `${ROUTES.ready}?tags=ops&tags=db`)
    expect(repeated.payload.tasks.map(task => task.title)).toEqual(['Ops one', 'Ops db', 'Db one'])
    const limited = await invoke(routes, `${ROUTES.ready}?tags=db&limit=1`)
    expect(limited.payload.tasks.map(task => task.title)).toEqual(['Ops db'])
    const explicitMode = await invoke(routes, `${ROUTES.ready}?mode=and`)
    expect(explicitMode.payload.tasks).toEqual(all.payload.tasks)
  })

  it('validates the tag list and mode', async () => {
    const { routes } = start()
    for (const [query, error] of [
      ['tags=', 'tags[0] must not be empty'],
      ['tags=ops,,db', 'tags[1] must not be empty'],
      [`tags=${'x'.repeat(41)}`, 'tags[0] must be at most 40 characters'],
      ['mode=all', 'mode must be one of any, and'],
    ]) {
      const invalid = await invoke(routes, `${ROUTES.ready}?${query}`)
      expect(invalid.status).toBe(400)
      expect(invalid.payload).toEqual({ ok: false, error })
    }
  })
})

describe('POST /api/gantt/task/report', () => {
  it('writes back a completion report and its event', async () => {
    const { routes } = start()
    const task = await createTask(routes, 'Reported task')
    const agent = await registerAgent(routes, { name: 'Codex' })
    const result = await invoke(routes, ROUTES.reportCompletion, {
      taskId: task.id,
      agentId: agent.id,
      report: 'shipped in tests/report.spec.js',
      status: 'done',
      progress: 100,
    })
    expect(result.status).toBe(200)
    expect(result.payload.ok).toBe(true)
    expect(result.payload.task).toMatchObject({
      id: task.id,
      status: 'done',
      progress: 100,
      operatorId: agent.id,
      completedById: agent.id,
      report: 'shipped in tests/report.spec.js',
    })
    expect(result.payload.event).toMatchObject({ action: 'complete', detail: 'shipped in tests/report.spec.js' })
    const trajectory = await invoke(routes, `${ROUTES.trajectory}?taskId=${task.id}`)
    expect(trajectory.payload.events).toHaveLength(1)
  })

  it('validates the report, the task, and the agent', async () => {
    const { routes } = start()
    const task = await createTask(routes)
    const agent = await registerAgent(routes, { name: 'Codex' })
    const malformed = await invoke(routes, ROUTES.reportCompletion, '{oops')
    expect(malformed.status).toBe(400)
    expect(malformed.payload.error).toBe('request body must be valid JSON')
    const blank = await invoke(routes, ROUTES.reportCompletion, { taskId: task.id, agentId: agent.id, report: '   ' })
    expect(blank.status).toBe(400)
    expect(blank.payload.error).toBe('report is required')
    const missingTask = await invoke(routes, ROUTES.reportCompletion, { taskId: 'missing', agentId: agent.id, report: 'x' })
    expect(missingTask.status).toBe(404)
    expect(missingTask.payload.error).toBe('task missing was not found')
    const missingAgent = await invoke(routes, ROUTES.reportCompletion, { taskId: task.id, agentId: 'missing', report: 'x' })
    expect(missingAgent.status).toBe(404)
    expect(missingAgent.payload.error).toBe('agent missing was not found')
    const badStatus = await invoke(routes, ROUTES.reportCompletion, {
      taskId: task.id, agentId: agent.id, report: 'x', status: 'archived',
    })
    expect(badStatus.status).toBe(400)
  })
})
