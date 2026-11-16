// Workbench task view's execute and decompose entries: ensure the dedicated
// conversation, queue the localized prompt through the session scope, then
// hand the conversation to a new browser window.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { click, deferred, flush, installFetch, jsonResponse, q, text, unmountAll } from './harness.js'
import {
  WORK_SESSION,
  WORK_WITHOUT_SESSION,
  defaultRoutes,
  fakeServices,
  fakeWindow,
  handoff,
  renderWorkbench,
  stubOpen,
} from './workbench-fixtures.js'

describe('execute and decompose entries', () => {
  it('creates the conversation, starts the task, and opens it in a new browser window', async () => {
    const win = fakeWindow()
    const opens = stubOpen(win)
    installFetch(defaultRoutes({ work: WORK_WITHOUT_SESSION }))
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    expect(text(view.container, '[data-action="execute"]')).toBe('Execute')
    click(q(view.container, '[data-action="execute"]'))
    await flush()

    expect(opens).toHaveLength(1)
    expect(services.created).toEqual([{ workspaceId: 'ws-1' }])
    expect(services.prompts).toEqual([{ sessionId: 'session-created', text: 'Complete this task.' }])
    expect(services.retained).toEqual([{ sessionId: 'session-created', source: 'ganttWork' }])
    expect(services.released).toEqual(['session-created'])
    expect(services.opened).toEqual([])
    expect(handoff()).toMatchObject({ sessionId: 'session-created' })
    expect(win.location.replaced).toBe(globalThis.location.href)
    expect(win.opener).toBeNull()
  })

  it('starts a bound conversation without creating another one', async () => {
    const win = fakeWindow()
    stubOpen(win)
    installFetch(defaultRoutes())
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    click(q(view.container, '[data-action="execute"]'))
    await flush()

    expect(services.created).toEqual([])
    expect(services.prompts).toEqual([{ sessionId: 'session-work', text: 'Complete this task.' }])
    expect(handoff()).toMatchObject({ sessionId: 'session-work' })
  })

  it('decomposes the task through the same conversation', async () => {
    const win = fakeWindow()
    stubOpen(win)
    installFetch(defaultRoutes())
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    click(q(view.container, '[data-action="decompose"]'))
    await flush()

    expect(services.created).toEqual([])
    expect(services.prompts).toEqual([{ sessionId: 'session-work', text: 'Decompose this task into subtasks.' }])
    expect(handoff()).toMatchObject({ sessionId: 'session-work' })
  })

  it('creates the conversation before decomposing an unbound task', async () => {
    stubOpen(fakeWindow())
    installFetch(defaultRoutes({ work: WORK_WITHOUT_SESSION }))
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    click(q(view.container, '[data-action="decompose"]'))
    await flush()

    expect(services.created).toEqual([{ workspaceId: 'ws-1' }])
    expect(services.prompts).toEqual([{ sessionId: 'session-created', text: 'Decompose this task into subtasks.' }])
    expect(handoff()).toMatchObject({ sessionId: 'session-created' })
  })

  it('falls back to the current window when the browser blocks the popup', async () => {
    stubOpen(null)
    installFetch(defaultRoutes({ work: WORK_WITHOUT_SESSION }))
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    click(q(view.container, '[data-action="execute"]'))
    await flush()

    expect(services.created).toEqual([{ workspaceId: 'ws-1' }])
    expect(services.prompts).toHaveLength(1)
    expect(services.opened).toEqual(['session-created'])
  })

  it('shows the busy state while the conversation is being created', async () => {
    const pending = deferred()
    stubOpen(fakeWindow())
    installFetch({
      ...defaultRoutes({ work: WORK_WITHOUT_SESSION }),
      [WORK_SESSION]: () => pending.promise,
    })
    const { view } = renderWorkbench()
    await flush()

    click(q(view.container, '[data-action="execute"]'))
    await flush()
    expect(text(view.container, '[data-action="execute"]')).toBe('Starting…')
    expect(q(view.container, '[data-action="execute"]').disabled).toBe(true)
    expect(q(view.container, '[data-action="decompose"]').disabled).toBe(true)

    pending.resolve(jsonResponse({ ok: true, taskId: 'task-1', sessionId: 'session-created' }))
    await flush()
    expect(text(view.container, '[data-action="execute"]')).toBe('Execute')
  })

  it('keeps the buttons busy while the prompt is being queued', async () => {
    const pending = deferred()
    stubOpen(fakeWindow())
    installFetch(defaultRoutes())
    const services = fakeServices({ send: () => pending.promise })
    const { view } = renderWorkbench({ services })
    await flush()

    click(q(view.container, '[data-action="execute"]'))
    await flush()
    expect(text(view.container, '[data-action="execute"]')).toBe('Starting…')
    expect(q(view.container, '[data-action="decompose"]').disabled).toBe(true)

    pending.resolve()
    await flush()
    expect(text(view.container, '[data-action="execute"]')).toBe('Execute')
  })

  it('reports a failed execute and closes the blank window', async () => {
    const win = fakeWindow()
    stubOpen(win)
    installFetch(defaultRoutes({
      work: WORK_WITHOUT_SESSION,
      routes: { [WORK_SESSION]: () => jsonResponse({ ok: false, error: 'bind failed' }, 500) },
    }))
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    click(q(view.container, '[data-action="execute"]'))
    await flush()

    expect(text(view.container, '.gantt-workbench-error')).toBe('Could not open the work conversation. bind failed')
    expect(services.prompts).toEqual([])
    expect(win.closed).toBe(true)
    expect(handoff()).toBeNull()
  })

  it('reports a failed prompt and closes the blank window', async () => {
    const win = fakeWindow()
    stubOpen(win)
    installFetch(defaultRoutes())
    const services = fakeServices({
      send: async () => {
        throw new Error('prompt rejected')
      },
    })
    const { view } = renderWorkbench({ services })
    await flush()

    click(q(view.container, '[data-action="execute"]'))
    await flush()

    expect(text(view.container, '.gantt-workbench-error')).toBe('Could not start the conversation. prompt rejected')
    expect(win.closed).toBe(true)
    expect(handoff()).toBeNull()
    expect(services.released).toEqual(['session-work'])
  })

  it('falls back in place when the handoff cannot be stored', async () => {
    const win = fakeWindow()
    stubOpen(win)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    installFetch(defaultRoutes({ work: WORK_WITHOUT_SESSION }))
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    click(q(view.container, '[data-action="execute"]'))
    await flush()

    expect(win.closed).toBe(true)
    expect(services.prompts).toHaveLength(1)
    expect(services.opened).toEqual(['session-created'])
  })

  it('reports the missing navigation service when no window can be opened', async () => {
    stubOpen(null)
    installFetch(defaultRoutes({ work: WORK_WITHOUT_SESSION }))
    const services = fakeServices()
    delete services.uiWorkspace
    const { view } = renderWorkbench({ services })
    await flush()

    click(q(view.container, '[data-action="execute"]'))
    await flush()

    expect(text(view.container, '.gantt-workbench-error')).toBe('Could not open the work conversation. This host cannot open the conversation in a new window.')
  })
})


afterEach(() => {
  unmountAll()
  localStorage.clear()
})
