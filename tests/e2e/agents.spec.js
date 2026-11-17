// End-to-end external-agent flow: the real HTTP channel (where GET and POST
// share /api/gantt/agents) registers an operator, reports a completion, and
// reads the task context back.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startServer } from './server.js'

let dir
let server

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-gantt-e2e-agents-'))
  server = await startServer({ dbPath: path.join(dir, 'tasks.db') })
})

afterEach(async () => {
  if (server) await server.close()
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  server = undefined
  dir = undefined
})

/** POST one JSON body and decode the response. */
async function post(apiPath, body) {
  const response = await fetch(`${server.origin}${apiPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: await response.json() }
}

describe('external agent round trip', () => {
  it('registers an agent, reports a completion, and reads the context', async () => {
    const registered = await post('/api/gantt/agents', { name: 'Codex', type: 'ai-agent', role: 'implementer' })
    expect(registered.status).toBe(200)
    expect(registered.payload.agent).toMatchObject({ name: 'Codex', type: 'ai-agent', role: 'implementer' })
    const agentId = registered.payload.agent.id

    const listed = await fetch(`${server.origin}/api/gantt/agents?type=ai-agent`).then(response => response.json())
    expect(listed.agents.map(agent => agent.id)).toEqual([agentId])

    const created = await post('/api/gantt/tasks', { title: 'Agent task' })
    const taskId = created.payload.task.id
    const reported = await post('/api/gantt/task/report', {
      taskId,
      agentId,
      report: 'shipped and verified',
    })
    expect(reported.status).toBe(200)
    expect(reported.payload.task).toMatchObject({
      id: taskId,
      status: 'done',
      progress: 100,
      operatorId: agentId,
      completedById: agentId,
      report: 'shipped and verified',
    })
    expect(reported.payload.event).toMatchObject({ action: 'complete', detail: 'shipped and verified' })

    const context = await fetch(`${server.origin}/api/gantt/task/context?taskId=${taskId}`).then(response => response.json())
    expect(context.task).toEqual({
      id: taskId,
      number: '1',
      ref: '',
      title: 'Agent task',
      status: 'done',
      progress: 100,
      doneWhen: '',
    })
    expect(context.markdown).toContain('## 汇报结果\n\nshipped and verified')
    expect(context.markdown).toContain('shipped and verified')
  })
})
