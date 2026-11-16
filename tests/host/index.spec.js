import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../../src/host/index.js'
import { ROUTES, createContext, invoke } from '../helpers/host.js'

const saved = process.env.DSH_GANTT_DB

afterEach(() => {
  if (saved === undefined) delete process.env.DSH_GANTT_DB
  else process.env.DSH_GANTT_DB = saved
})

/** Boot the plugin with an in-memory store and the supplied services. */
function boot(services) {
  process.env.DSH_GANTT_DB = ':memory:'
  const { ctx, routes, disposers } = createContext(services)
  apply(ctx)
  return { routes, disposers }
}

/** Fake tools service recording the definitions registered on it. */
function fakeTools() {
  const definitions = []
  return {
    definitions,
    register(definition) {
      definitions.push(definition)
      return () => {}
    },
  }
}

describe('plugin entry', () => {
  it('resolves trajectory titles through the host service getter', async () => {
    const tools = fakeTools()
    const query = {
      async readTitleSnapshots(ids) {
        return ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { title: { title: `Title ${id}` } } }))
      },
    }
    const { routes, disposers } = boot({ tools, sessionQuery: query })

    const update = tools.definitions.find(definition => definition.name === 'gantt_update_task')
    const created = await invoke(routes, ROUTES.tasks, { title: 'Trajectory task' })
    await update.execute(
      { id: created.payload.task.id, status: 'done' },
      { agent: { session: { id: 'session-a' } } },
    )
    const trajectory = await invoke(routes, `${ROUTES.trajectory}?taskId=${created.payload.task.id}`)
    expect(trajectory.payload.events[0]).toMatchObject({ sessionId: 'session-a', sessionTitle: 'Title session-a' })
    for (const dispose of disposers) dispose()
  })

  it('keeps working when the context has no service getter', async () => {
    process.env.DSH_GANTT_DB = ':memory:'
    const routes = new Map()
    const effects = []
    const definitions = []
    const tools = {
      register(definition) {
        definitions.push(definition)
        return () => {}
      },
    }
    const base = {
      effect(fn) {
        const dispose = fn()
        effects.push(dispose)
        return dispose
      },
      connection: { fetch: { register(definition) { routes.set(definition.path, definition) } } },
    }
    const ctx = {
      ...base,
      inject(names, callback) {
        const systemPrompt = { section: () => () => {}, context: () => () => {} }
        const get = name => (name === 'tools' ? tools : name === 'systemPrompt' ? systemPrompt : undefined)
        const result = callback({ ...base, tools, systemPrompt, get })
        return typeof result === 'function' ? result : () => {}
      },
    }
    apply(ctx)

    const update = definitions.find(definition => definition.name === 'gantt_update_task')
    const created = await invoke(routes, ROUTES.tasks, { title: 'No getter' })
    await update.execute(
      { id: created.payload.task.id, status: 'done' },
      { agent: { session: { id: 'session-a' } } },
    )
    const trajectory = await invoke(routes, `${ROUTES.trajectory}?taskId=${created.payload.task.id}`)
    expect(trajectory.payload.events[0]).toMatchObject({ sessionId: 'session-a', sessionTitle: '' })
    // The scheduler started by apply owns a timer; dispose it through the effect.
    for (const dispose of effects) dispose()
  })
})
