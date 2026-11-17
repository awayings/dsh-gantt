// Work mode on the Gantt page: a persisted header toggle that turns a task
// activation (row, task bar, Enter/Space) from "open the edit dialog" into
// "show the task in the in-page work panel", while an explicit row action keeps
// editing reachable. The panel never navigates the Gantt page away.
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
const SKILLS = 'api/gantt/work/skills'
const TEAM = 'api/gantt/work/team'
const TRAJECTORY = 'api/gantt/trajectory'
const FOCUS = 'api/gantt/focus/set'
const AGENTS = 'api/gantt/agents'
const STORAGE_KEY = 'gantt.workMode'
const WORK_CWD = '/data/home/ws-plugin'
const EMPTY_STATUSES = new Map()

const TASK = {
  id: 'c1',
  number: '1.1',
  ref: '1.1',
  title: 'Ship work mode',
  status: 'done',
  progress: 100,
  doneWhen: 'green gates',
}

const WORK_PAYLOAD = {
  ok: true,
  cwd: WORK_CWD,
  task: TASK,
  sessionId: 'session-bound',
}

const WORK_WITHOUT_SESSION = { ...WORK_PAYLOAD, sessionId: null }

const SESSION_LIST = {
  ids: ['session-bound'],
  phase: 'ready',
  byId: {
    'session-bound': {
      id: 'session-bound',
      displayTitle: 'Ship work mode',
      running: false,
      updatedAt: Date.UTC(2026, 10, 16, 6, 30),
    },
  },
}

/** Fake host services work mode needs, recording what the flow did. */
function workServices(options = {}) {
  const created = []
  const opened = []
  const prompts = []
  const sidebar = options.sidebar ?? fakeSidebarService()
  const services = {
    sessions: {
      create: async (request) => {
        created.push(request)
        return 'session-created'
      },
      list: { getSnapshot: () => SESSION_LIST },
      retain: () => ({ ready: Promise.resolve(), release: () => {} }),
      scope: sessionId => ({
        get: name => name === 'conversation'
          ? { send: async (text) => { prompts.push({ sessionId, text }) } }
          : undefined,
      }),
    },
    uiWorkspace: { openSession: (sessionId) => { opened.push(sessionId) } },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', path: WORK_CWD }] }) } },
    betterSidebar: sidebar,
  }
  if (options.sidebar !== null) services.betterSidebar = sidebar
  if (options.mainSession !== null) {
    services.uiSession = {
      adapter: { current: { value: { key: options.mainSession ?? 'session-main' } } },
      sessionStatus: { getSnapshot: () => EMPTY_STATUSES, subscribe: () => () => {} },
    }
  }
  return { services, created, opened, prompts, sidebar }
}

function defaultRoutes(overrides = {}) {
  return {
    [WORK]: () => jsonResponse(overrides.work ?? WORK_PAYLOAD),
    [WORK_SESSION]: () => jsonResponse({ ok: true, taskId: 'c1', sessionId: 'session-created' }),
    [SKILLS]: () => jsonResponse({ ok: true, available: true, skills: [] }),
    [TEAM]: () => jsonResponse({ ok: true, available: true, agents: [] }),
    [TRAJECTORY]: () => jsonResponse({ ok: true, events: [] }),
    [AGENTS]: () => jsonResponse({ ok: true, agents: [] }),
    ...overrides.routes,
  }
}

/** Mount the registered Gantt page; `store` seeds localStorage first. */
async function renderPage({ routes = {}, services = undefined, store = {} } = {}) {
  for (const [key, value] of Object.entries(store)) localStorage.setItem(key, value)
  const fetchState = installFetch({ [TREE]: () => jsonResponse(treePayload()), ...defaultRoutes({ routes }) })
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

function panel(container) {
  return q(container, '.gantt-task-panel')
}

function closePanelButton(container) {
  return q(container, '.gantt-task-panel button[data-action="close-panel"]')
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
  it('renders a disabled toggle when the host exposes no session service', async () => {
    const { view } = await renderPage({ store: { [STORAGE_KEY]: '1' } })
    const toggle = toggleButton(view.container)

    expect(toggle).not.toBeNull()
    expect(toggle.textContent).toBe('Work mode')
    expect(toggle.getAttribute('title')).toBe('Click a task to show its work panel without leaving this page.')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.getAttribute('data-active')).toBeNull()
    expect(toggle.disabled).toBe(true)

    click(row(view.container, '1.1 Write spec'))
    await flush()
    expect(dialog(view.container)).not.toBeNull()
    expect(panel(view.container)).toBeNull()
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
})

describe('work-mode activation', () => {
  it('opens the task in the in-page panel and focuses the on-screen conversation', async () => {
    const { services, opened } = workServices()
    const { view, calls } = await renderPage({
      services,
      store: { [STORAGE_KEY]: '1' },
      routes: { [FOCUS]: () => jsonResponse({ ok: true, taskId: 'c1', sessionId: 'session-main' }) },
    })

    click(row(view.container, '1.1 Write spec'))
    await flush()

    expect(dialog(view.container)).toBeNull()
    expect(row(view.container, '1.1 Write spec').getAttribute('data-selected')).toBe('true')
    expect(panel(view.container)).not.toBeNull()
    expect(text(view.container, '.gantt-workbench-chip-title')).toBe('Ship work mode')
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('Ship work mode（bound）')
    expect(opened).toEqual([])
    expect(calls.map(call => call.path).sort()).toEqual([
      TREE,
      `${WORK}?taskId=c1`,
      FOCUS,
      `${TRAJECTORY}?taskId=c1&limit=20`,
      SKILLS,
      `${TEAM}?sessionId=session-bound`,
      AGENTS,
    ].sort())
    const focusCall = calls.find(call => call.path === FOCUS)
    expect(requestBody(focusCall)).toEqual({ sessionId: 'session-main', taskId: 'c1' })
  })

  it('falls back to the ui-session main binding when the sidebar has no snapshot', async () => {
    const { services } = workServices({ sidebar: null })
    const { view, calls } = await renderPage({
      services,
      store: { [STORAGE_KEY]: '1' },
      routes: { [FOCUS]: () => jsonResponse({ ok: true }) },
    })

    click(row(view.container, '1.1 Write spec'))
    await flush()

    expect(panel(view.container)).not.toBeNull()
    const focusCall = calls.find(call => call.path === FOCUS)
    expect(requestBody(focusCall)).toEqual({ sessionId: 'session-main', taskId: 'c1' })
  })

  it('still opens the panel when the host exposes no on-screen conversation', async () => {
    const { services } = workServices({ sidebar: null, mainSession: null })
    const { view, calls } = await renderPage({ services, store: { [STORAGE_KEY]: '1' } })

    click(row(view.container, '1.1 Write spec'))
    await flush()

    expect(panel(view.container)).not.toBeNull()
    expect(calls.some(call => call.path === FOCUS)).toBe(false)
  })

  it('treats a task-bar click and the row keyboard activation as work activation', async () => {
    const { services } = workServices()
    const { view } = await renderPage({
      services,
      store: { [STORAGE_KEY]: '1' },
      routes: { [FOCUS]: () => jsonResponse({ ok: true }) },
    })

    click(q(row(view.container, '1.1 Write spec'), '.gantt-bar'))
    await flush()
    expect(panel(view.container)).not.toBeNull()
    expect(text(view.container, '.gantt-workbench-chip-title')).toBe('Ship work mode')

    keydown(row(view.container, '1.2 Build UI'), 'Enter')
    await flush()
    expect(text(view.container, '.gantt-workbench-chip-title')).toBe('Ship work mode')

    keydown(row(view.container, '2.1 Announce'), ' ')
    await flush()
    expect(panel(view.container)).not.toBeNull()
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

  it('reports a failed focus in an error toast and keeps the panel open', async () => {
    const { services } = workServices()
    const { view } = await renderPage({
      services,
      store: { [STORAGE_KEY]: '1' },
      routes: { [FOCUS]: () => jsonResponse({ ok: false, error: 'focus write failed' }, 500) },
    })

    click(row(view.container, '1.1 Write spec'))
    await flush()

    expect(panel(view.container)).not.toBeNull()
    expect(text(view.container, '.gantt-toast')).toBe('Could not open the work conversation. focus write failed')
    expect(toast(view.container).getAttribute('data-error')).toBe('true')
  })

  it('reports a non-Error focus failure message verbatim', async () => {
    const { services } = workServices()
    const { view } = await renderPage({
      services,
      store: { [STORAGE_KEY]: '1' },
      routes: { [FOCUS]: () => Promise.reject('session store offline') },
    })

    click(row(view.container, '1.1 Write spec'))
    await flush()

    expect(panel(view.container)).not.toBeNull()
    expect(toast(view.container).textContent).toBe('Could not open the work conversation. session store offline')
  })

  it('closes the panel from its close button and when work mode turns off', async () => {
    const { services } = workServices()
    const { view } = await renderPage({
      services,
      store: { [STORAGE_KEY]: '1' },
      routes: { [FOCUS]: () => jsonResponse({ ok: true }) },
    })

    click(row(view.container, '1.1 Write spec'))
    await flush()
    expect(panel(view.container)).not.toBeNull()

    click(closePanelButton(view.container))
    await flush()
    expect(panel(view.container)).toBeNull()
    expect(row(view.container, '1.1 Write spec').getAttribute('data-selected')).toBe('true')

    click(row(view.container, '1.1 Write spec'))
    await flush()
    expect(panel(view.container)).not.toBeNull()

    click(toggleButton(view.container))
    await flush()
    expect(panel(view.container)).toBeNull()
  })

  it('closes the panel when the task disappears from the tree', async () => {
    const { services } = workServices()
    let payload = treePayload()
    const { view } = await renderPage({
      services,
      store: { [STORAGE_KEY]: '1' },
      routes: {
        [TREE]: () => jsonResponse(payload),
        [FOCUS]: () => jsonResponse({ ok: true }),
      },
    })

    click(row(view.container, '1.1 Write spec'))
    await flush()
    expect(panel(view.container)).not.toBeNull()

    payload = treePayload({
      tasks: treePayload().tasks.filter(task => task.id !== 'p1'),
    })
    click(q(view.container, 'button[title="Refresh"]'))
    await flush()
    expect(panel(view.container)).toBeNull()
  })

  it('shows the execute entry for an unbound task and opens the new conversation in a fresh window', async () => {
    const { services, created, prompts } = workServices()
    const win = {
      name: '',
      closed: false,
      close() {
        this.closed = true
      },
      location: { replaced: '', replace(target) { this.replaced = target } },
    }
    vi.stubGlobal('open', () => win)
    const { view } = await renderPage({
      services,
      store: { [STORAGE_KEY]: '1' },
      routes: { [WORK]: () => jsonResponse(WORK_WITHOUT_SESSION) },
    })

    click(row(view.container, '1.1 Write spec'))
    await flush()
    const execute = q(view.container, '.gantt-task-panel button[data-action="execute"]')
    expect(execute).not.toBeNull()

    click(execute)
    await flush()

    expect(created).toEqual([{ workspaceId: 'ws-1' }])
    expect(prompts).toEqual([{ sessionId: 'session-created', text: 'Complete this task.' }])
    expect(win.location.replaced).toBe(globalThis.location.href)
    expect(JSON.parse(localStorage.getItem('dsh.sessions.current'))).toEqual({ sessionId: 'session-created' })
    expect(win.closed).toBe(false)
  })
})
