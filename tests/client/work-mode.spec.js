// Work mode on the Gantt page: a persisted header toggle that turns a task
// activation (row, task bar, Enter/Space) from "open the edit dialog" into
// "open the task's dedicated work conversation", while an explicit row action
// keeps editing reachable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import {
  click,
  dialog,
  fakeSidebarService,
  flush,
  installFetch,
  jsonResponse,
  keydown,
  mount,
  q,
  requestBody,
  row,
  setupApp,
  text,
  unmountAll,
} from './harness.js'
import { treePayload } from './fixtures.js'

const TREE = 'api/gantt/tree'
const WORK = 'api/gantt/work'
const WORK_SESSION = 'api/gantt/work/session'
const FOCUS = 'api/gantt/focus/set'
const STORAGE_KEY = 'gantt.workMode'
const WORK_CWD = '/data/home/ws-plugin'

/** Fake host services work mode needs, recording what the flow did. */
function workServices(createdId = 'session-created') {
  const created = []
  const opened = []
  const sidebar = fakeSidebarService()
  const services = {
    sessions: {
      create: async (options) => {
        created.push(options)
        return createdId
      },
    },
    uiWorkspace: { openSession: (sessionId) => { opened.push(sessionId) } },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', path: WORK_CWD }] }) } },
    betterSidebar: sidebar,
  }
  return { services, created, opened, sidebar }
}

/** Mount the registered Gantt page; `store` seeds localStorage first. */
async function renderPage({ routes = {}, services = undefined, store = {} } = {}) {
  for (const [key, value] of Object.entries(store)) localStorage.setItem(key, value)
  const fetchState = installFetch({ [TREE]: () => jsonResponse(treePayload()), ...routes })
  const app = setupApp({ services })
  const view = mount(createElement(app.page().component))
  await flush()
  return { ...fetchState, app, view }
}

function toggleButton(container) {
  return q(container, 'button[data-action="work-mode"]')
}

function editButton(container, label) {
  return q(row(container, label), '.gantt-row-action[data-action="edit"]')
}

function toast(container) {
  return q(container, '.gantt-toast')
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  unmountAll()
  localStorage.clear()
})

describe('work-mode toggle', () => {
  it('renders a disabled toggle when the host exposes no session services', async () => {
    const { view } = await renderPage({ store: { [STORAGE_KEY]: '1' } })
    const toggle = toggleButton(view.container)

    expect(toggle).not.toBeNull()
    expect(toggle.textContent).toBe('Work mode')
    expect(toggle.getAttribute('title')).toBe('Click a task to open its dedicated work conversation.')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.getAttribute('data-active')).toBeNull()
    expect(toggle.disabled).toBe(true)

    click(row(view.container, '1.1 Write spec'))
    await flush()
    expect(dialog(view.container)).not.toBeNull()
    expect(editButton(view.container, '1.1 Write spec')).toBeNull()
  })

  it('persists the switch across a remount and navigates nowhere on toggle', async () => {
    const { services } = workServices()
    const { view, app, calls } = await renderPage({ services })

    expect(toggleButton(view.container).disabled).toBe(false)
    click(toggleButton(view.container))
    expect(toggleButton(view.container).getAttribute('data-active')).toBe('true')
    expect(toggleButton(view.container).getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
    expect(calls.map(call => call.path)).toEqual([TREE])

    view.unmount()
    const remounted = mount(createElement(app.page().component))
    await flush()
    expect(toggleButton(remounted.container).getAttribute('data-active')).toBe('true')

    click(toggleButton(remounted.container))
    expect(toggleButton(remounted.container).getAttribute('data-active')).toBeNull()
    expect(toggleButton(remounted.container).getAttribute('aria-pressed')).toBe('false')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('keeps opening the edit dialog while the switch is off', async () => {
    const { services } = workServices()
    const { view } = await renderPage({ services })

    click(row(view.container, '1.1 Write spec'))
    expect(dialog(view.container)).not.toBeNull()
    expect(text(view.container, '.gantt-dialog-title')).toContain('Edit task')
    expect(editButton(view.container, '1.1 Write spec')).toBeNull()
  })

  it('keeps the switch usable when the browser storage throws', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const { services } = workServices()
    const { view } = await renderPage({ services })

    expect(toggleButton(view.container).getAttribute('data-active')).toBeNull()
    click(toggleButton(view.container))
    expect(toggleButton(view.container).getAttribute('data-active')).toBe('true')
    expect(getItem).toHaveBeenCalled()
    expect(setItem).toHaveBeenCalled()
  })
})

describe('work-mode activation', () => {
  it('creates, binds, and opens the dedicated conversation on a row click', async () => {
    const { services, created, opened, sidebar } = workServices('session-created')
    const { view, calls } = await renderPage({
      services,
      store: { [STORAGE_KEY]: '1' },
      routes: {
        [WORK]: () => jsonResponse({ ok: true, cwd: WORK_CWD, task: null, sessionId: null }),
        [WORK_SESSION]: () => jsonResponse({ ok: true, taskId: 'c1', sessionId: 'session-created' }),
      },
    })

    click(row(view.container, '1.1 Write spec'))
    await flush()

    expect(dialog(view.container)).toBeNull()
    expect(row(view.container, '1.1 Write spec').getAttribute('data-selected')).toBe('true')
    expect(text(view.container, '.gantt-toast')).toBe('Created the work conversation.')
    expect(toast(view.container).getAttribute('data-error')).toBeNull()
    expect(created).toEqual([{ workspaceId: 'ws-1' }])
    expect(opened).toEqual(['session-created'])
    expect(sidebar.opens).toEqual([{ seed: { type: 'gantt-work' }, scope: { sessionId: 'session-created' } }])
    expect(calls.map(call => call.path)).toEqual([TREE, `${WORK}?taskId=c1`, WORK_SESSION])
    expect(requestBody(calls[2])).toEqual({ taskId: 'c1', sessionId: 'session-created' })
  })

  it('reuses the bound conversation and refreshes its focus', async () => {
    const { services, created, opened, sidebar } = workServices()
    const { view, calls } = await renderPage({
      services,
      store: { [STORAGE_KEY]: '1' },
      routes: {
        [WORK]: () => jsonResponse({ ok: true, cwd: WORK_CWD, task: null, sessionId: 'session-bound' }),
        [FOCUS]: () => jsonResponse({ ok: true, taskId: 'c1', sessionId: 'session-bound' }),
      },
    })

    click(row(view.container, '1.1 Write spec'))
    await flush()

    expect(dialog(view.container)).toBeNull()
    expect(text(view.container, '.gantt-toast')).toBe('Opened the work conversation.')
    expect(created).toEqual([])
    expect(opened).toEqual(['session-bound'])
    expect(sidebar.opens).toEqual([{ seed: { type: 'gantt-work' }, scope: { sessionId: 'session-bound' } }])
    const focusCall = calls.find(call => call.path === FOCUS)
    expect(requestBody(focusCall)).toEqual({ sessionId: 'session-bound', taskId: 'c1' })
  })

  it('treats a task-bar click and the row keyboard activation as work activation', async () => {
    const { services, opened } = workServices()
    const { view } = await renderPage({
      services,
      store: { [STORAGE_KEY]: '1' },
      routes: {
        [WORK]: () => jsonResponse({ ok: true, cwd: WORK_CWD, task: null, sessionId: 'session-bound' }),
        [FOCUS]: () => jsonResponse({ ok: true }),
      },
    })

    click(q(row(view.container, '1.1 Write spec'), '.gantt-bar'))
    await flush()
    expect(opened).toEqual(['session-bound'])
    expect(dialog(view.container)).toBeNull()

    keydown(row(view.container, '1.2 Build UI'), 'Enter')
    await flush()
    keydown(row(view.container, '2.1 Announce'), ' ')
    await flush()
    expect(opened).toEqual(['session-bound', 'session-bound', 'session-bound'])
    expect(dialog(view.container)).toBeNull()
  })

  it('keeps task editing reachable from the row action in work mode', async () => {
    const { services } = workServices()
    const { view, calls } = await renderPage({ services, store: { [STORAGE_KEY]: '1' } })

    const edit = editButton(view.container, '1.1 Write spec')
    expect(edit).not.toBeNull()
    expect(edit.getAttribute('title')).toBe('Edit task')
    expect(edit.getAttribute('aria-label')).toBe('Edit task')

    click(edit)
    await flush()
    expect(dialog(view.container)).not.toBeNull()
    expect(text(view.container, '.gantt-dialog-title')).toContain('Edit task · 1.1')
    expect(calls.map(call => call.path)).toEqual([TREE])
  })

  it('reports a failed activation in an error toast', async () => {
    const { services, opened } = workServices()
    const { view } = await renderPage({
      services,
      store: { [STORAGE_KEY]: '1' },
      routes: { [WORK]: () => jsonResponse({ ok: false, error: 'no work directory' }, 500) },
    })

    click(row(view.container, '1.1 Write spec'))
    await flush()

    expect(dialog(view.container)).toBeNull()
    expect(toast(view.container).textContent).toBe('Could not open the work conversation. no work directory')
    expect(toast(view.container).getAttribute('data-error')).toBe('true')
    expect(opened).toEqual([])
  })

  it('reports a non-Error failure message verbatim', async () => {
    const services = {
      sessions: { create: () => Promise.reject('session store offline') },
      uiWorkspace: { openSession: () => {} },
    }
    const { view } = await renderPage({
      services,
      store: { [STORAGE_KEY]: '1' },
      routes: { [WORK]: () => jsonResponse({ ok: true, cwd: WORK_CWD, sessionId: null }) },
    })

    click(row(view.container, '1.1 Write spec'))
    await flush()

    expect(toast(view.container).textContent).toBe('Could not open the work conversation. session store offline')
    expect(toast(view.container).getAttribute('data-error')).toBe('true')
  })
})
