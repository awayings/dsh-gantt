import { beforeEach, describe, expect, it } from 'vitest'
import { registerRoutes } from '../../src/host/routes/index.js'
import { createSessionTitles } from '../../src/host/session-titles.js'
import { GanttStore } from '../../src/host/store.js'
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

describe('trajectory conversation titles', () => {
  it('attaches the resolved title and falls back to an empty string', async () => {
    const query = {
      seen: [],
      async readTitleSnapshots(ids) {
        this.seen.push([...ids])
        return ids.map(id => id === 'session-a'
          ? { sessionId: id, status: 'fulfilled', value: { title: { title: 'Polish the plan' } } }
          : { sessionId: id, status: 'rejected', reason: new Error('missing') })
      },
    }
    const store = new GanttStore(':memory:')
    const routes = new Map()
    const ctx = {
      connection: { fetch: { register(definition) { routes.set(definition.path, definition) } } },
      get: name => (name === 'sessionQuery' ? query : undefined),
      effect() {},
    }
    registerRoutes(ctx, store, createSessionTitles(name => (name === 'sessionQuery' ? query : undefined)))
    const task = store.create({ title: 'Data table' })
    store.update(task.id, { status: 'done' }, { sessionId: 'session-a', turn: 4, summary: 'shipped' })
    store.update(task.id, { status: 'in_progress' }, { sessionId: 'session-b', turn: 5, summary: 'again' })

    const response = await invoke(routes, `${ROUTES.trajectory}?taskId=${task.id}`)
    expect(response.status).toBe(200)
    expect(response.payload.events.map(event => [event.sessionId, event.sessionTitle])).toEqual([
      ['session-b', ''],
      ['session-a', 'Polish the plan'],
    ])
    expect(query.seen).toEqual([['session-b', 'session-a']])
    store.close()
  })

  it('falls back to an empty title when the resolver returns no entry', async () => {
    const store = new GanttStore(':memory:')
    const routes = new Map()
    const ctx = {
      connection: { fetch: { register(definition) { routes.set(definition.path, definition) } } },
      get: () => undefined,
      effect() {},
    }
    registerRoutes(ctx, store, { resolve: async () => new Map() })
    const task = store.create({ title: 'Data table' })
    store.update(task.id, { status: 'done' }, { sessionId: 'session-a', turn: 1 })

    const response = await invoke(routes, `${ROUTES.trajectory}?taskId=${task.id}`)
    expect(response.payload.events[0]).toMatchObject({ sessionId: 'session-a', sessionTitle: '' })
    store.close()
  })
})
