import { afterEach, describe, expect, it } from 'vitest'
import { GanttStore, DEFAULT_WORK_CWD } from '../../src/host/store.js'
import { workSkillsRoute, workTeamRoute } from '../../src/host/routes/work.js'
import { ROUTES, bootPlugin, disposeAll, invoke } from '../helpers/host.js'

let boot

function start(services = {}) {
  boot = bootPlugin({ services })
  return boot
}

afterEach(() => {
  if (boot) disposeAll(boot.disposers)
  boot = undefined
})

/** Create one task through the write route and return it. */
async function createTask(routes, title = 'Work task', extra = {}) {
  const created = await invoke(routes, ROUTES.tasks, { title, ...extra })
  return created.payload.task
}

describe('GET /api/gantt/work', () => {
  it('reports the work directory and the task context by task id', async () => {
    const { routes } = start()
    const task = await createTask(routes)
    const result = await invoke(routes, `${ROUTES.work}?taskId=${task.id}`)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(result.payload).toEqual({
      ok: true,
      cwd: DEFAULT_WORK_CWD,
      task: { id: task.id, number: '1', ref: '', title: 'Work task', status: 'todo', progress: 0, doneWhen: '' },
      sessionId: null,
    })
  })

  it('reports the dedicated conversation once one is bound', async () => {
    const { routes } = start()
    const task = await createTask(routes)
    await invoke(routes, ROUTES.workSession, { taskId: task.id, sessionId: 'session-a' })
    const { payload } = await invoke(routes, `${ROUTES.work}?taskId=${task.id}`)
    expect(payload.sessionId).toBe('session-a')
  })

  it('resolves the focused task of a conversation', async () => {
    const { routes } = start()
    const task = await createTask(routes)
    await invoke(routes, ROUTES.focusSet, { sessionId: 'session-a', taskId: task.id })
    const { status, payload } = await invoke(routes, `${ROUTES.work}?sessionId=session-a`)
    expect(status).toBe(200)
    expect(payload.task).toMatchObject({ id: task.id, number: '1' })
    expect(payload.sessionId).toBeNull()
  })

  it('falls back to the dedicated conversation task when the focus is cleared', async () => {
    const { routes } = start()
    const task = await createTask(routes)
    await invoke(routes, ROUTES.workSession, { taskId: task.id, sessionId: 'session-a' })
    await invoke(routes, ROUTES.focusSet, { sessionId: 'session-a', taskId: null })
    const { payload } = await invoke(routes, `${ROUTES.work}?sessionId=session-a`)
    expect(payload.task).toMatchObject({ id: task.id })
    expect(payload.sessionId).toBe('session-a')
  })

  it('returns a null task for an unbound conversation', async () => {
    const { routes } = start()
    const { status, payload } = await invoke(routes, `${ROUTES.work}?sessionId=session-unknown`)
    expect(status).toBe(200)
    expect(payload).toEqual({ ok: true, cwd: DEFAULT_WORK_CWD, task: null, sessionId: null })
  })

  it('requires a task id or a conversation id', async () => {
    const { routes } = start()
    for (const query of ['', '?taskId=', '?taskId=%20&sessionId=%20']) {
      const { status, payload } = await invoke(routes, `${ROUTES.work}${query}`)
      expect(status).toBe(400)
      expect(payload).toEqual({ ok: false, error: 'taskId or sessionId is required' })
    }
  })

  it('reports an unknown task and an invalid conversation id', async () => {
    const { routes } = start()
    const missing = await invoke(routes, `${ROUTES.work}?taskId=missing`)
    expect(missing.status).toBe(404)
    expect(missing.payload).toEqual({ ok: false, error: 'task missing was not found' })
    const longSession = await invoke(routes, `${ROUTES.work}?sessionId=${'s'.repeat(201)}`)
    expect(longSession.status).toBe(400)
    expect(longSession.payload.error).toBe('sessionId must be at most 200 characters')
  })

  it('prefers the task id over the conversation id', async () => {
    const { routes } = start()
    const first = await createTask(routes, 'First')
    const second = await createTask(routes, 'Second')
    await invoke(routes, ROUTES.workSession, { taskId: first.id, sessionId: 'session-a' })
    const { payload } = await invoke(routes, `${ROUTES.work}?taskId=${second.id}&sessionId=session-a`)
    expect(payload.task.id).toBe(second.id)
    expect(payload.sessionId).toBeNull()
  })
})

describe('POST /api/gantt/work/session', () => {
  it('binds the task, focuses the conversation, and moves a reused session', async () => {
    const { routes } = start()
    const first = await createTask(routes, 'First')
    const second = await createTask(routes, 'Second')
    const bound = await invoke(routes, ROUTES.workSession, { taskId: first.id, sessionId: '  session-a  ' })
    expect(bound.status).toBe(200)
    expect(bound.payload).toEqual({ ok: true, taskId: first.id, sessionId: 'session-a' })
    const focus = await invoke(routes, `${ROUTES.focus}?sessionId=session-a`)
    expect(focus.payload.taskId).toBe(first.id)

    await invoke(routes, ROUTES.workSession, { taskId: second.id, sessionId: 'session-a' })
    const moved = await invoke(routes, `${ROUTES.work}?taskId=${first.id}`)
    expect(moved.payload.sessionId).toBeNull()
    const rebound = await invoke(routes, `${ROUTES.work}?taskId=${second.id}`)
    expect(rebound.payload.sessionId).toBe('session-a')
    const refocused = await invoke(routes, `${ROUTES.focus}?sessionId=session-a`)
    expect(refocused.payload.taskId).toBe(second.id)
  })

  it('validates the task and the conversation before writing', async () => {
    const { routes } = start()
    const task = await createTask(routes)
    const noTask = await invoke(routes, ROUTES.workSession, { sessionId: 'session-a' })
    expect(noTask.status).toBe(400)
    expect(noTask.payload).toEqual({ ok: false, error: 'taskId is required' })
    const numericTask = await invoke(routes, ROUTES.workSession, { taskId: 5, sessionId: 'session-a' })
    expect(numericTask.status).toBe(400)
    expect(numericTask.payload.error).toBe('taskId is required')
    const noSession = await invoke(routes, ROUTES.workSession, { taskId: task.id })
    expect(noSession.status).toBe(400)
    expect(noSession.payload.error).toBe('sessionId is required')
    const unknown = await invoke(routes, ROUTES.workSession, { taskId: 'missing', sessionId: 'session-a' })
    expect(unknown.status).toBe(404)
    expect(unknown.payload.error).toBe('task missing was not found')
    const malformed = await invoke(routes, ROUTES.workSession, '{oops')
    expect(malformed.status).toBe(400)
    expect(malformed.payload.error).toBe('request body must be valid JSON')
  })
})

describe('GET /api/gantt/work/skills', () => {
  it('degrades when the host has no skills service', async () => {
    const { routes } = start()
    const { status, payload } = await invoke(routes, ROUTES.workSkills)
    expect(status).toBe(200)
    expect(payload).toEqual({ ok: true, available: false, skills: [] })
  })

  it('lists the skill summaries of the host service', async () => {
    const { routes } = start({
      skills: {
        list: async () => [
          { name: 'codex-cli-calling', description: 'Call Codex from a terminal', source: 'bundled' },
          { name: 'partial' },
        ],
      },
    })
    const { payload } = await invoke(routes, ROUTES.workSkills)
    expect(payload).toEqual({
      ok: true,
      available: true,
      skills: [
        { name: 'codex-cli-calling', description: 'Call Codex from a terminal', source: 'bundled' },
        { name: 'partial', description: '', source: '' },
      ],
    })
  })

  it('treats a non-list service and a non-array result as empty', async () => {
    const noList = start({ skills: {} })
    const first = await invoke(noList.routes, ROUTES.workSkills)
    expect(first.payload).toEqual({ ok: true, available: false, skills: [] })
    disposeAll(noList.disposers)
    const { routes } = start({ skills: { list: async () => ({ items: [] }) } })
    const second = await invoke(routes, ROUTES.workSkills)
    expect(second.payload).toEqual({ ok: true, available: true, skills: [] })
  })

  it('maps a service rejection to a 500 GanttError', async () => {
    const errorBoot = start({ skills: { list: async () => { throw new Error('skills exploded') } } })
    const first = await invoke(errorBoot.routes, ROUTES.workSkills)
    expect(first.status).toBe(500)
    expect(first.payload).toEqual({ ok: false, error: 'skills exploded' })
    disposeAll(errorBoot.disposers)
    const stringBoot = start({ skills: { list: async () => { throw 'plain failure' } } })
    const second = await invoke(stringBoot.routes, ROUTES.workSkills)
    expect(second.status).toBe(500)
    expect(second.payload).toEqual({ ok: false, error: 'plain failure' })
  })

  it('degrades when the route deps have no get seam', async () => {
    const store = new GanttStore(':memory:')
    try {
      const response = await workSkillsRoute.fetch(new Request('http://localhost/api/gantt/work/skills'), /** @type {any} */ ({ store, endpoints: [] }))
      expect(await response.json()).toEqual({ ok: true, available: false, skills: [] })
    } finally {
      store.close()
    }
  })
})

describe('GET /api/gantt/work/team', () => {
  it('requires the dedicated conversation id', async () => {
    const { routes } = start()
    for (const query of ['', '?sessionId=', '?sessionId=%20']) {
      const { status, payload } = await invoke(routes, `${ROUTES.workTeam}${query}`)
      expect(status).toBe(400)
      expect(payload).toEqual({ ok: false, error: 'sessionId is required' })
    }
  })

  it('degrades when the host has no subagent service', async () => {
    const { routes } = start()
    const { status, payload } = await invoke(routes, `${ROUTES.workTeam}?sessionId=session-a`)
    expect(status).toBe(200)
    expect(payload).toEqual({ ok: true, available: false, agents: [] })
  })

  it('lists the conversation subagents with a normalized mode', async () => {
    const { routes } = start({
      subagents: {
        listChildren: async (sessionId) => {
          expect(sessionId).toBe('session-a')
          return [
            { id: 'child-1', label: 'Researcher', mode: 'continuable', createdAt: 1700000000000 },
            { id: 'child-2', mode: 'one-shot', createdAt: 1700000000001 },
            { id: 'child-3', mode: 'external', createdAt: 1700000000002 },
            { id: 'child-4', label: 7, mode: 'weird' },
            { mode: 'unknown' },
          ]
        },
      },
    })
    const { payload } = await invoke(routes, `${ROUTES.workTeam}?sessionId=session-a`)
    expect(payload).toEqual({
      ok: true,
      available: true,
      agents: [
        { id: 'child-1', label: 'Researcher', mode: 'continuable', createdAt: 1700000000000 },
        { id: 'child-2', label: '', mode: 'one-shot', createdAt: 1700000000001 },
        { id: 'child-3', label: '', mode: 'external', createdAt: 1700000000002 },
        { id: 'child-4', label: '', mode: 'unknown', createdAt: null },
        { id: '', label: '', mode: 'unknown', createdAt: null },
      ],
    })
  })

  it('treats a non-list service and a non-array result as empty', async () => {
    const noList = start({ subagents: {} })
    const first = await invoke(noList.routes, `${ROUTES.workTeam}?sessionId=session-a`)
    expect(first.payload).toEqual({ ok: true, available: false, agents: [] })
    disposeAll(noList.disposers)
    const { routes } = start({ subagents: { listChildren: async () => null } })
    const second = await invoke(routes, `${ROUTES.workTeam}?sessionId=session-a`)
    expect(second.payload).toEqual({ ok: true, available: true, agents: [] })
  })

  it('reports a service rejection without failing the read', async () => {
    const errorBoot = start({ subagents: { listChildren: async () => { throw new Error('team exploded') } } })
    const first = await invoke(errorBoot.routes, `${ROUTES.workTeam}?sessionId=session-a`)
    expect(first.status).toBe(200)
    expect(first.payload).toEqual({ ok: true, available: true, agents: [], error: 'team exploded' })
    disposeAll(errorBoot.disposers)
    const stringBoot = start({ subagents: { listChildren: async () => { throw 'plain failure' } } })
    const second = await invoke(stringBoot.routes, `${ROUTES.workTeam}?sessionId=session-a`)
    expect(second.payload).toEqual({ ok: true, available: true, agents: [], error: 'plain failure' })
  })

  it('degrades when the route deps have no get seam', async () => {
    const store = new GanttStore(':memory:')
    try {
      const response = await workTeamRoute.fetch(new Request('http://localhost/api/gantt/work/team?sessionId=session-a'), /** @type {any} */ ({ store, endpoints: [] }))
      expect(await response.json()).toEqual({ ok: true, available: false, agents: [] })
    } finally {
      store.close()
    }
  })
})
