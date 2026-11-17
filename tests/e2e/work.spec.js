// End-to-end: work mode's task ⇄ conversation mapping over real HTTP and a real
// SQLite file. The unit suites cover validation and service seams; this suite
// proves the mapping survives a host restart, which is the whole point of the
// durable work session.
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'
import { startServer } from './server.js'

const TASKS = '/api/gantt/tasks'
const TREE = '/api/gantt/tree'
const WORK = '/api/gantt/work'
const WORK_SESSION = '/api/gantt/work/session'
const FOCUS_SET = '/api/gantt/focus/set'

let dir
let dbPath
let server

beforeEach(async () => {
  dir = makeTempDir('dsh-gantt-e2e-work-')
  dbPath = path.join(dir, 'tasks.db')
  server = await startServer({ dbPath })
})

afterEach(async () => {
  if (server) await server.close()
  if (dir) removeTempDir(dir)
  server = undefined
  dir = undefined
})

/** POST one JSON body and return the parsed response. */
async function post(origin, pathname, body) {
  const response = await fetch(`${origin}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: await response.json() }
}

/** GET one path and return the parsed response. */
async function get(origin, pathname) {
  const response = await fetch(`${origin}${pathname}`)
  return { status: response.status, payload: await response.json() }
}

/** Create one task through the shipped write route. */
async function createTask(origin, title) {
  const { payload } = await post(origin, TASKS, { title })
  return payload.task
}

/** Restart the host on the same SQLite file, as a new DSH process would. */
async function restart() {
  await server.close()
  server = await startServer({ dbPath })
}

describe('work mode over HTTP', () => {
  it('binds a task to a work conversation and keeps the mapping after a restart', async () => {
    const task = await createTask(server.origin, 'Dedicated task')
    const before = await get(server.origin, `${WORK}?taskId=${task.id}`)
    expect(before.status).toBe(200)
    expect(before.payload.task).toEqual({
      id: task.id,
      number: '1',
      ref: '',
      title: 'Dedicated task',
      status: 'todo',
      progress: 0,
      doneWhen: '',
      operatorId: '',
      completedById: '',
      report: '',
    })
    expect(before.payload.sessionId).toBeNull()
    expect(typeof before.payload.cwd).toBe('string')
    expect(before.payload.cwd.length).toBeGreaterThan(0)

    const bound = await post(server.origin, WORK_SESSION, { taskId: task.id, sessionId: 'session-e2e' })
    expect(bound.status).toBe(200)
    expect(bound.payload).toEqual({ ok: true, taskId: task.id, sessionId: 'session-e2e' })
    const tree = await get(server.origin, TREE)
    expect(tree.payload.tasks[0].id).toBe(task.id)
    expect(tree.payload.tasks[0].workSessionId).toBe('session-e2e')

    await restart()
    const rebuilt = await get(server.origin, `${WORK}?taskId=${task.id}`)
    expect(rebuilt.payload.sessionId).toBe('session-e2e')
    expect(rebuilt.payload.task.id).toBe(task.id)
    const bySession = await get(server.origin, `${WORK}?sessionId=session-e2e`)
    expect(bySession.payload.task.id).toBe(task.id)
    expect(bySession.payload.sessionId).toBe('session-e2e')
  })

  it('moves a conversation to a new task and leaves the old task unbound', async () => {
    const first = await createTask(server.origin, 'First task')
    const second = await createTask(server.origin, 'Second task')
    await post(server.origin, WORK_SESSION, { taskId: first.id, sessionId: 'session-e2e' })
    await post(server.origin, WORK_SESSION, { taskId: second.id, sessionId: 'session-e2e' })
    await restart()
    expect((await get(server.origin, `${WORK}?taskId=${first.id}`)).payload.sessionId).toBeNull()
    expect((await get(server.origin, `${WORK}?taskId=${second.id}`)).payload.sessionId).toBe('session-e2e')
    const focus = await get(server.origin, '/api/gantt/focus?sessionId=session-e2e')
    expect(focus.payload.taskId).toBe(second.id)
  })

  it('serves the dedicated mapping when the conversation focus is cleared', async () => {
    const task = await createTask(server.origin, 'Task')
    await post(server.origin, WORK_SESSION, { taskId: task.id, sessionId: 'session-e2e' })
    await post(server.origin, FOCUS_SET, { sessionId: 'session-e2e', taskId: null })
    await restart()
    const result = await get(server.origin, `${WORK}?sessionId=session-e2e`)
    expect(result.payload.task.id).toBe(task.id)
    expect(result.payload.sessionId).toBe('session-e2e')
  })

  it('degrades the optional workbench services and validates the work routes', async () => {
    const task = await createTask(server.origin, 'Task')
    expect(await get(server.origin, '/api/gantt/work/skills')).toEqual({ status: 200, payload: { ok: true, available: false, skills: [] } })
    expect(await get(server.origin, '/api/gantt/work/team?sessionId=session-e2e')).toEqual({
      status: 200,
      payload: { ok: true, available: false, agents: [] },
    })
    expect((await get(server.origin, '/api/gantt/work/team')).status).toBe(400)
    expect((await get(server.origin, WORK)).status).toBe(400)
    expect((await get(server.origin, `${WORK}?taskId=missing`)).status).toBe(404)
    expect((await post(server.origin, WORK_SESSION, { taskId: task.id })).status).toBe(400)
    const rebound = await get(server.origin, `${WORK}?taskId=${task.id}`)
    expect(rebound.payload.sessionId).toBeNull()
  })
})
