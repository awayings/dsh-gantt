import { beforeEach, describe, expect, it } from 'vitest'
import { ROUTES, bootPlugin, invoke } from '../helpers/host.js'

let routes

beforeEach(() => {
  ;({ routes } = bootPlugin())
})

describe('focus routes', () => {
  it('reads, sets, and clears the focus of one conversation', async () => {
    const created = await invoke(routes, ROUTES.tasks, { title: 'Data table' })
    const taskId = created.payload.task.id
    const empty = await invoke(routes, `${ROUTES.focus}?sessionId=session-a`)
    expect(empty.status).toBe(200)
    expect(empty.payload).toEqual({ ok: true, taskId: null })
    const set = await invoke(routes, ROUTES.focusSet, { sessionId: 'session-a', taskId })
    expect(set.status).toBe(200)
    expect(set.payload).toEqual({ ok: true, taskId })
    const read = await invoke(routes, `${ROUTES.focus}?sessionId=session-a`)
    expect(read.payload).toEqual({ ok: true, taskId })
    const cleared = await invoke(routes, ROUTES.focusSet, { sessionId: 'session-a', taskId: null })
    expect(cleared.payload).toEqual({ ok: true, taskId: null })
    const missingTask = await invoke(routes, ROUTES.focusSet, { sessionId: 'session-a', taskId: undefined })
    expect(missingTask.payload).toEqual({ ok: true, taskId: null })
  })

  it('rejects a missing session id and an unknown task', async () => {
    const get = await invoke(routes, ROUTES.focus)
    expect(get.status).toBe(400)
    expect(get.payload).toEqual({ ok: false, error: 'sessionId is required' })
    const post = await invoke(routes, ROUTES.focusSet, { taskId: null })
    expect(post.status).toBe(400)
    expect(post.payload).toEqual({ ok: false, error: 'sessionId is required' })
    const unknown = await invoke(routes, ROUTES.focusSet, { sessionId: 'session-a', taskId: 'missing' })
    expect(unknown.status).toBe(404)
    expect(unknown.payload).toEqual({ ok: false, error: 'task missing was not found' })
  })

  it('lists task trajectory events and validates the query', async () => {
    const created = await invoke(routes, ROUTES.tasks, { title: 'Data table' })
    const taskId = created.payload.task.id
    const empty = await invoke(routes, `${ROUTES.trajectory}?taskId=${taskId}`)
    expect(empty.status).toBe(200)
    expect(empty.payload).toEqual({ ok: true, events: [] })
    const all = await invoke(routes, ROUTES.trajectory)
    expect(all.payload).toEqual({ ok: true, events: [] })
    const bySession = await invoke(routes, `${ROUTES.trajectory}?sessionId=session-a&limit=5`)
    expect(bySession.payload).toEqual({ ok: true, events: [] })
    const badLimit = await invoke(routes, `${ROUTES.trajectory}?limit=0`)
    expect(badLimit.status).toBe(400)
    expect(badLimit.payload).toEqual({ ok: false, error: 'limit must be an integer from 1 to 100' })
    const unknown = await invoke(routes, `${ROUTES.trajectory}?taskId=missing`)
    expect(unknown.status).toBe(404)
    expect(unknown.payload).toEqual({ ok: false, error: 'task missing was not found' })
  })
})
