// Workbench tab body: the task view (bound conversation plus trajectory), the
// execute entry point for an unbound task (new browser window), the skills and
// agent-team panels, and the refetch rules (visible, window focus, refresh,
// focus revision, after a conversation action).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import {
  click,
  deferred,
  flush,
  installFetch,
  jsonResponse,
  mount,
  q,
  qa,
  text,
  unmountAll,
} from './harness.js'
import { GanttWorkbench } from '../../src/client/pages/workbench.js'
import { DICTS } from '../../src/client/i18n/index.js'
import { noteWorkFocus } from '../../src/client/work-nav.js'
import { HANDOFF_KEY } from '../../src/client/session-window.js'

const WORK = 'api/gantt/work'
const WORK_SESSION = 'api/gantt/work/session'
const SKILLS = 'api/gantt/work/skills'
const TEAM = 'api/gantt/work/team'
const TRAJECTORY = 'api/gantt/trajectory'
const FOCUS_SET = 'api/gantt/focus/set'

const TASK = {
  id: 'task-1',
  number: '1.8.1',
  ref: '1.8.1',
  title: 'Ship work mode',
  status: 'in_progress',
  progress: 40,
  doneWhen: 'green gates',
}

const WORK_BY_SESSION = {
  ok: true,
  cwd: '/data/home/ws-plugin',
  task: TASK,
  sessionId: 'session-work',
}

const WORK_WITHOUT_SESSION = { ...WORK_BY_SESSION, sessionId: null }

const WORK_FOCUS_NONE = {
  ok: true,
  cwd: '/data/home/ws-plugin',
  task: null,
  sessionId: null,
}

const TRAJECTORY_EVENTS = [
  {
    id: 'e3',
    taskId: 'task-1',
    action: 'track',
    sessionId: 'session-work',
    sessionTitle: 'Bench work',
    turn: 4,
    detail: 'wired the panels',
    at: '2026-11-16T06:30:00.000Z',
  },
  {
    id: 'e2',
    taskId: 'task-1',
    action: 'complete',
    sessionId: 'session-work',
    turn: null,
    detail: '',
    at: 'not-a-date',
  },
  {
    id: 'e1',
    taskId: 'task-1',
    action: 'create',
    sessionId: 'session-work',
    turn: 0,
    detail: '',
    at: null,
  },
  {
    id: 'e0',
    taskId: 'task-1',
    action: 'update',
    sessionId: '',
    turn: 'ignored',
    detail: '',
    at: '',
  },
]

const SKILLS_AVAILABLE = [
  { name: 'codex-cli-calling', description: 'Run Codex from a terminal.', source: 'workspace' },
  { name: 'quiet-skill', description: '', source: '' },
]

const AGENTS = [
  { id: 'agent-1', label: 'reviewer', mode: 'continuable', createdAt: '2026-11-16T06:00:00.000Z' },
  { id: 'agent-2', label: '', mode: 'one-shot', createdAt: '2026-11-16T05:00:00.000Z' },
  { id: 'agent-3', label: 'outsider', mode: 'external', createdAt: '2026-11-16T04:00:00.000Z' },
]

const SESSION_LIST = {
  ids: ['session-work'],
  phase: 'ready',
  byId: {
    'session-work': {
      id: 'session-work',
      displayTitle: 'Ship work mode',
      running: true,
      updatedAt: Date.UTC(2026, 10, 16, 6, 30),
    },
  },
}

function dictionary(locale) {
  return String(locale).toLowerCase().startsWith('zh') ? DICTS.zh : DICTS.en
}

function fakeUiSession(entries = {}) {
  let snapshot = new Map(Object.entries(entries))
  const listeners = new Set()
  return {
    sessionStatus: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    refresh(next) {
      snapshot = new Map(Object.entries(next))
      for (const listener of [...listeners]) listener()
    },
  }
}

function buildCtx(options = {}) {
  const services = { ...(options.services ?? {}) }
  const locale = options.locale ?? 'en'
  const snapshot = { revision: 1, locale }
  const ctx = {
    locale: {
      register: () => () => {},
      bind: () => key => dictionary(locale)[key] ?? key,
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    },
    get: name => services[name],
  }
  if (options.withoutGet) delete ctx.get
  if (options.sessions !== undefined) ctx.sessions = options.sessions
  if (options.uiWorkspace !== undefined) ctx.uiWorkspace = options.uiWorkspace
  return ctx
}

function fakeServices(options = {}) {
  const opened = []
  const created = []
  const opens = []
  const sessions = {
    created,
    create: async (request) => {
      created.push(request)
      return 'session-created'
    },
    list: { getSnapshot: () => options.sessionsList ?? SESSION_LIST },
  }
  const services = {
    sessions,
    uiWorkspace: { opened, openSession: sessionId => opened.push(sessionId) },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', path: '/data/home/ws-plugin' }] }) } },
    betterSidebar: { opens, openTab: (seed, scope) => opens.push({ seed, scope }) },
    opened,
    created,
    opens,
  }
  if (options.uiSession !== undefined) services.uiSession = options.uiSession
  return services
}

function defaultRoutes(overrides = {}) {
  return {
    [WORK]: () => jsonResponse(overrides.work ?? WORK_BY_SESSION),
    [TRAJECTORY]: () => jsonResponse({ ok: true, events: TRAJECTORY_EVENTS }),
    [SKILLS]: () => jsonResponse({ ok: true, available: true, skills: SKILLS_AVAILABLE }),
    [TEAM]: () => jsonResponse({ ok: true, available: true, agents: AGENTS }),
    [FOCUS_SET]: () => jsonResponse({ ok: true, taskId: 'task-1' }),
    [WORK_SESSION]: () => jsonResponse({ ok: true, taskId: 'task-1', sessionId: 'session-created' }),
    ...overrides.routes,
  }
}

function renderWorkbench(options = {}) {
  const services = options.services ?? fakeServices(options.serviceOptions)
  const ctx = options.ctx === undefined
    ? buildCtx({ services, locale: options.locale, ...(options.ctxOptions ?? {}) })
    : options.ctx
  const scope = options.scope === undefined ? { sessionId: options.sessionId ?? 's1' } : options.scope
  const props = { ctx, scope, visible: options.visible ?? true }
  const view = mount(createElement(GanttWorkbench, props))
  return { view, ctx, services, props }
}

function rerender(view, props, visible) {
  view.rerender(createElement(GanttWorkbench, { ...props, visible }))
}

function rowElements(container) {
  return qa(container, '.gantt-workbench-row')
}

function tab(container, name) {
  return q(container, `[data-work-tab="${name}"]`)
}

function fakeWindow() {
  return {
    closed: false,
    close() {
      this.closed = true
    },
    location: {
      replaced: '',
      replace(target) {
        this.replaced = target
      },
    },
  }
}

function stubOpen(result) {
  const calls = []
  vi.stubGlobal('open', (...args) => {
    calls.push(args)
    return result
  })
  return calls
}

function handoff() {
  const raw = localStorage.getItem(HANDOFF_KEY)
  return raw === null ? null : JSON.parse(raw)
}

afterEach(() => {
  unmountAll()
  localStorage.clear()
})

describe('task view', () => {
  it('renders the focused task, the conversation, and the trajectory in one view', async () => {
    const { calls } = installFetch(defaultRoutes())
    const { view, services } = renderWorkbench()
    await flush()

    expect(calls.map(call => call.path)).toEqual([
      `${WORK}?sessionId=s1`,
      `${TRAJECTORY}?taskId=task-1&limit=20`,
      SKILLS,
      `${TEAM}?sessionId=session-work`,
    ])
    expect(services.sessions.created).toEqual([])

    expect(q(view.container, '.gantt-workbench-chip').getAttribute('title')).toBe('Ship work mode')
    expect(text(view.container, '.gantt-workbench-chip-ref')).toBe('1.8.1')
    expect(text(view.container, '.gantt-workbench-chip-title')).toBe('Ship work mode')

    const tabs = qa(view.container, 'nav[role="tablist"] button.gantt-workbench-tab')
    expect(tabs.map(element => element.dataset.workTab)).toEqual(['task', 'skills', 'team'])
    expect(tabs.map(element => element.textContent)).toEqual(['Task', 'Skills', 'Team'])
    expect(tab(view.container, 'task').getAttribute('data-active')).toBe('true')

    expect(q(view.container, 'section[data-panel="task"]')).not.toBeNull()
    expect(text(view.container, '[data-block="conversation"] .gantt-workbench-chat-title')).toBe('Work conversation')
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('Ship work mode（work）')
    expect(text(view.container, '.gantt-workbench-chat-state')).toBe('Running')
    expect(q(view.container, '.gantt-workbench-chat-state').getAttribute('data-running')).toBe('true')
    expect(text(view.container, '.gantt-workbench-chat-updated')).toMatch(/^Last active \d{2}:\d{2}$/)
    expect(q(view.container, '[data-action="open-conversation"]')).not.toBeNull()
    expect(q(view.container, '[data-action="open-window"]')).not.toBeNull()
    expect(q(view.container, '[data-action="execute"]')).toBeNull()

    const rows = rowElements(view.container)
    expect(rows).toHaveLength(4)
    expect(rows[0].getAttribute('data-action')).toBe('track')
    expect(rows[0].getAttribute('title')).toBe('session-work')
    expect(text(rows[0], '.gantt-workbench-row-action')).toBe('Tracked')
    expect(text(rows[0], '.gantt-workbench-row-turn')).toBe('Turn 4')
    expect(text(rows[0], '.gantt-workbench-row-time')).toMatch(/^\d{2}:\d{2}$/)
    expect(text(rows[0], '.gantt-workbench-row-session')).toBe('Bench work（work）')
    expect(text(rows[0], '.gantt-workbench-row-detail')).toBe('wired the panels')
    expect(text(rows[1], '.gantt-workbench-row-action')).toBe('Completed')
    expect(q(rows[1], '.gantt-workbench-row-turn')).toBeNull()
    expect(q(rows[1], '.gantt-workbench-row-time').textContent).toBe('')
    expect(q(rows[1], '.gantt-workbench-row-detail')).toBeNull()
    expect(q(rows[2], '.gantt-workbench-row-time').textContent).toBe('')
    expect(q(rows[3], '.gantt-workbench-row-session')).toBeNull()
    expect(q(rows[3], '.gantt-workbench-row-turn')).toBeNull()
  })

  it('localizes the tab labels and the task view through the host dictionary', async () => {
    installFetch(defaultRoutes())
    const { view } = renderWorkbench({ locale: 'zh' })
    await flush()
    const tabs = qa(view.container, 'nav[role="tablist"] button.gantt-workbench-tab')
    expect(tabs.map(element => element.textContent)).toEqual(['任务', '技能', '编队'])
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('Ship work mode（work）')
    expect(text(view.container, '[data-block="conversation"] .gantt-workbench-chat-title')).toBe('关联对话')
  })

  it('opens the bound conversation from the task view', async () => {
    installFetch(defaultRoutes())
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    click(q(view.container, '[data-action="open-conversation"]'))
    expect(services.opened).toEqual(['session-work'])
    expect(services.opens).toEqual([])
  })

  it('opens a trajectory session row in place', async () => {
    installFetch(defaultRoutes())
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    click(rowElements(view.container)[2].querySelector('.gantt-workbench-row-session'))
    expect(services.opened).toEqual(['session-work'])
  })
})

describe('conversation state', () => {
  it('shows the waiting state for a pending interaction', async () => {
    const uiSession = fakeUiSession({ 'session-work': { pendingInteraction: 'approval', running: true } })
    installFetch(defaultRoutes())
    const { view } = renderWorkbench({ serviceOptions: { uiSession } })
    await flush()

    expect(text(view.container, '.gantt-workbench-chat-state')).toBe('Waiting for your choice')
    expect(q(view.container, '.gantt-workbench-chat-state').getAttribute('data-waiting')).toBe('true')
  })

  it('shows the running state from the live snapshot and the idle fallback', async () => {
    const uiSession = fakeUiSession({ 'session-work': { running: true } })
    installFetch(defaultRoutes())
    const first = renderWorkbench({ serviceOptions: { uiSession } })
    await flush()
    expect(text(first.view.container, '.gantt-workbench-chat-state')).toBe('Running')
    first.view.unmount()

    const idle = fakeUiSession({ 'session-work': { running: false } })
    const services = fakeServices({ uiSession: idle })
    services.sessions.list = {
      getSnapshot: () => ({
        ids: ['session-work'],
        byId: { 'session-work': { id: 'session-work', displayTitle: 'Bench', running: false } },
      }),
    }
    installFetch(defaultRoutes())
    const second = renderWorkbench({ services })
    await flush()
    expect(text(second.view.container, '.gantt-workbench-chat-state')).toBe('Idle')
    expect(q(second.view.container, '.gantt-workbench-chat-state').getAttribute('data-running')).toBe('false')
    expect(text(second.view.container, '.gantt-workbench-chat-updated')).toBe('Last active ')
  })

  it('reacts to a live status update', async () => {
    const uiSession = fakeUiSession({ 'session-work': { running: true } })
    installFetch(defaultRoutes())
    const { view } = renderWorkbench({ serviceOptions: { uiSession } })
    await flush()
    expect(text(view.container, '.gantt-workbench-chat-state')).toBe('Running')

    act(() => uiSession.refresh({ 'session-work': { pendingInteraction: 'question' } }))
    expect(text(view.container, '.gantt-workbench-chat-state')).toBe('Waiting for your choice')
  })
})

describe('execute entry', () => {
  it('creates the conversation and opens it in a new browser window', async () => {
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
    expect(services.opened).toEqual([])
    expect(handoff()).toMatchObject({ sessionId: 'session-created' })
    expect(win.location.replaced).toBe(globalThis.location.href)
    expect(win.opener).toBeNull()
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
    expect(text(view.container, '[data-action="execute"]')).toBe('Creating…')
    expect(q(view.container, '[data-action="execute"]').disabled).toBe(true)

    pending.resolve(jsonResponse({ ok: true, taskId: 'task-1', sessionId: 'session-created' }))
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
    const { view } = renderWorkbench()
    await flush()

    click(q(view.container, '[data-action="execute"]'))
    await flush()

    expect(text(view.container, '.gantt-workbench-error')).toBe('Could not open the work conversation. bind failed')
    expect(win.closed).toBe(true)
    expect(handoff()).toBeNull()
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

describe('open in a new window', () => {
  it('hands the bound conversation to a new window', async () => {
    const win = fakeWindow()
    const opens = stubOpen(win)
    installFetch(defaultRoutes())
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    click(q(view.container, '[data-action="open-window"]'))
    expect(opens).toHaveLength(1)
    expect(handoff()).toMatchObject({ sessionId: 'session-work' })
    expect(win.location.replaced).toBe(globalThis.location.href)
    expect(services.opened).toEqual([])
  })

  it('opens in place when the handoff cannot be stored', async () => {
    const win = fakeWindow()
    stubOpen(win)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    installFetch(defaultRoutes())
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    click(q(view.container, '[data-action="open-window"]'))
    expect(win.closed).toBe(true)
    expect(services.opened).toEqual(['session-work'])
  })

  it('opens in place when the window is refused', async () => {
    stubOpen(null)
    installFetch(defaultRoutes())
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    click(q(view.container, '[data-action="open-window"]'))
    expect(services.opened).toEqual(['session-work'])
    expect(handoff()).toBeNull()
  })
})

describe('skills and team panels', () => {
  it('switches to the skills and team panels', async () => {
    installFetch(defaultRoutes())
    const { view, services } = renderWorkbench()
    await flush()

    click(tab(view.container, 'skills'))
    expect(q(view.container, 'section[data-panel="skills"]')).not.toBeNull()
    const skills = qa(view.container, 'li[data-skill-name]')
    expect(skills.map(element => element.dataset.skillName)).toEqual(['codex-cli-calling', 'quiet-skill'])
    expect(text(skills[0], '.gantt-workbench-item-name')).toBe('codex-cli-calling')
    expect(text(skills[0], '.gantt-workbench-item-source')).toBe('workspace')
    expect(text(skills[0], '.gantt-workbench-item-description')).toBe('Run Codex from a terminal.')
    expect(q(skills[1], '.gantt-workbench-item-source')).toBeNull()
    expect(q(skills[1], '.gantt-workbench-item-description')).toBeNull()

    click(tab(view.container, 'team'))
    expect(q(view.container, 'section[data-panel="team"]')).not.toBeNull()
    const agents = qa(view.container, 'li[data-agent-id]')
    expect(agents.map(element => element.dataset.agentId)).toEqual(['agent-1', 'agent-2', 'agent-3'])
    expect(text(agents[0], '.gantt-workbench-item-name')).toBe('reviewer')
    expect(text(agents[0], '.gantt-workbench-item-mode')).toBe('Continuable')
    expect(text(agents[1], '.gantt-workbench-item-name')).toBe('agent-2')
    expect(text(agents[1], '.gantt-workbench-item-mode')).toBe('One-shot')
    expect(text(agents[2], '.gantt-workbench-item-mode')).toBe('External')
    const openButtons = qa(view.container, 'button[data-action="open-agent"]')
    expect(openButtons).toHaveLength(3)
    expect(openButtons[0].textContent).toBe('Open')
    click(openButtons[1])
    expect(services.opened).toEqual(['agent-2'])
  })

  it('hides the agent open action when the host has no workspace service', async () => {
    installFetch(defaultRoutes())
    const services = fakeServices()
    delete services.uiWorkspace
    const { view } = renderWorkbench({ services })
    await flush()
    click(tab(view.container, 'team'))
    expect(qa(view.container, 'li[data-agent-id]')).toHaveLength(3)
    expect(qa(view.container, 'button[data-action="open-agent"]')).toHaveLength(0)
  })
})

describe('empty, unavailable, and error states', () => {
  it('shows the focus-none header and the empty task/skills/team panels', async () => {
    const { calls } = installFetch(defaultRoutes({
      work: WORK_FOCUS_NONE,
      routes: {
        [SKILLS]: () => jsonResponse({ ok: true, available: true, skills: [] }),
        [TEAM]: () => jsonResponse({ ok: true, available: true, agents: [] }),
      },
    }))
    const { view } = renderWorkbench()
    await flush()

    expect(text(view.container, '.gantt-workbench-none')).toBe('No focused task')
    expect(q(view.container, '.gantt-workbench-chip')).toBeNull()
    expect(text(view.container, 'section[data-panel="task"]')).toBe('No focused task')
    expect(calls.some(call => call.path.startsWith(TRAJECTORY))).toBe(false)
    expect(calls).toContainEqual(expect.objectContaining({ path: `${TEAM}?sessionId=s1` }))

    click(tab(view.container, 'skills'))
    expect(text(view.container, 'section[data-panel="skills"]')).toBe('No skills available.')

    click(tab(view.container, 'team'))
    expect(text(view.container, 'section[data-panel="team"]')).toBe('No subagents yet.')
  })

  it('reports unavailable skills and team services', async () => {
    installFetch(defaultRoutes({
      routes: {
        [SKILLS]: () => jsonResponse({ ok: true, available: false, skills: [] }),
        [TEAM]: () => jsonResponse({ ok: true, available: false, agents: [] }),
      },
    }))
    const { view } = renderWorkbench()
    await flush()

    click(tab(view.container, 'skills'))
    expect(text(view.container, 'section[data-panel="skills"]')).toBe('This host has no skills service.')
    click(tab(view.container, 'team'))
    expect(text(view.container, 'section[data-panel="team"]')).toBe('This host has no subagent service.')
  })

  it('reports a service-side team listing error', async () => {
    installFetch(defaultRoutes({
      routes: {
        [TEAM]: () => jsonResponse({ ok: true, available: true, agents: [], error: 'list children failed' }),
      },
    }))
    const { view } = renderWorkbench()
    await flush()
    click(tab(view.container, 'team'))
    expect(text(view.container, 'section[data-panel="team"]')).toBe('Could not load the agent team.')
  })

  it('reports trajectory, skills, and team fetch failures', async () => {
    installFetch(defaultRoutes({
      routes: { [TRAJECTORY]: () => jsonResponse({ ok: false, error: 'no trajectory' }, 500) },
    }))
    const first = renderWorkbench()
    await flush()
    expect(text(first.view.container, '[data-block="trajectory"] .gantt-workbench-error')).toBe('Could not load the trajectory.')
    first.view.unmount()

    installFetch(defaultRoutes({
      routes: { [SKILLS]: () => jsonResponse({ ok: false, error: 'no skills' }, 500) },
    }))
    const second = renderWorkbench()
    await flush()
    click(tab(second.view.container, 'skills'))
    expect(text(second.view.container, 'section[data-panel="skills"]')).toBe('Could not load the skills.')
    second.view.unmount()

    installFetch(defaultRoutes({
      routes: { [TEAM]: () => jsonResponse({ ok: false, error: 'no team' }, 500) },
    }))
    const third = renderWorkbench()
    await flush()
    click(tab(third.view.container, 'team'))
    expect(text(third.view.container, 'section[data-panel="team"]')).toBe('Could not load the agent team.')
  })
})

describe('refetching', () => {
  it('refetches on the refresh button, on window focus, and on a focus revision', async () => {
    const { calls } = installFetch(defaultRoutes())
    const { view } = renderWorkbench()
    await flush()
    const workCalls = () => calls.filter(call => call.path === `${WORK}?sessionId=s1`).length
    const panelCalls = () => calls.filter(call => call.path.startsWith(TRAJECTORY)).length
    expect(workCalls()).toBe(1)
    expect(panelCalls()).toBe(1)

    click(q(view.container, '[data-action="refresh"]'))
    await flush()
    expect(workCalls()).toBe(2)
    expect(panelCalls()).toBe(2)

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(workCalls()).toBe(3)

    act(() => noteWorkFocus())
    await flush()
    expect(workCalls()).toBe(4)
  })

  it('pauses while hidden and refetches when it becomes visible', async () => {
    const { calls } = installFetch(defaultRoutes())
    const { view, props } = renderWorkbench({ visible: false })
    await flush()
    expect(calls).toHaveLength(0)

    rerender(view, props, true)
    await flush()
    expect(calls.filter(call => call.path === `${WORK}?sessionId=s1`)).toHaveLength(1)

    rerender(view, props, false)
    await flush()
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(calls.filter(call => call.path === `${WORK}?sessionId=s1`)).toHaveLength(1)

    rerender(view, props, true)
    await flush()
    expect(calls.filter(call => call.path === `${WORK}?sessionId=s1`)).toHaveLength(2)
  })
})

describe('loading and failure of the work payload', () => {
  it('shows the loading message until the work payload arrives', async () => {
    const pending = deferred()
    installFetch({ ...defaultRoutes(), [WORK]: () => pending.promise })
    const { view } = renderWorkbench()
    await flush()
    expect(text(view.container, '.gantt-workbench-message')).toBe('Loading the workbench…')
    expect(q(view.container, '.gantt-workbench-chip')).toBeNull()

    pending.resolve(jsonResponse(WORK_BY_SESSION))
    await flush()
    expect(text(view.container, '.gantt-workbench-chip-title')).toBe('Ship work mode')
  })

  it('surfaces a work payload failure and retries', async () => {
    let attempts = 0
    installFetch({
      ...defaultRoutes(),
      [WORK]: () => {
        attempts += 1
        return attempts === 1
          ? jsonResponse({ ok: false, error: 'store offline' }, 500)
          : jsonResponse(WORK_BY_SESSION)
      },
    })
    const { view } = renderWorkbench()
    await flush()

    expect(text(view.container, '.gantt-workbench-message')).toBe('Could not load the workbench.')
    expect(text(view.container, '.gantt-workbench-error')).toBe('store offline')
    click(q(view.container, '[data-action="retry"]'))
    await flush()
    expect(text(view.container, '.gantt-workbench-chip-title')).toBe('Ship work mode')
  })
})

describe('stale async results', () => {
  it('ignores the work payload when it resolves after unmount', async () => {
    const pending = deferred()
    installFetch({ ...defaultRoutes(), [WORK]: () => pending.promise })
    const { view } = renderWorkbench()
    view.unmount()
    pending.resolve(jsonResponse(WORK_BY_SESSION))
    await flush()
    expect(view.container.isConnected).toBe(false)
  })

  it('ignores panel payloads when they resolve after unmount', async () => {
    const pending = deferred()
    installFetch({ ...defaultRoutes(), [SKILLS]: () => pending.promise })
    const { view } = renderWorkbench()
    await flush()
    view.unmount()
    pending.resolve(jsonResponse({ ok: true, available: true, skills: SKILLS_AVAILABLE }))
    await flush()
    expect(view.container.isConnected).toBe(false)
  })

  it('ignores a failed work payload that rejects after unmount', async () => {
    const pending = deferred()
    installFetch({ ...defaultRoutes(), [WORK]: () => pending.promise })
    const { view } = renderWorkbench()
    view.unmount()
    pending.reject(new Error('late work failure'))
    await flush()
    expect(view.container.isConnected).toBe(false)
  })

  it('ignores a successful execute that finishes after unmount', async () => {
    const pending = deferred()
    stubOpen(fakeWindow())
    const { calls } = installFetch({
      ...defaultRoutes({ work: WORK_WITHOUT_SESSION }),
      [WORK_SESSION]: () => pending.promise,
    })
    const { view } = renderWorkbench()
    await flush()
    click(q(view.container, '[data-action="execute"]'))
    view.unmount()
    pending.resolve(jsonResponse({ ok: true, taskId: 'task-1', sessionId: 'session-created' }))
    await flush()
    expect(handoff()).toMatchObject({ sessionId: 'session-created' })
    expect(calls.filter(call => call.path.startsWith(`${WORK}?sessionId`))).toHaveLength(1)
  })

  it('ignores an execute that finishes after unmount', async () => {
    const pending = deferred()
    stubOpen(fakeWindow())
    installFetch({
      ...defaultRoutes({ work: WORK_WITHOUT_SESSION }),
      [WORK_SESSION]: () => pending.promise,
    })
    const { view } = renderWorkbench()
    await flush()
    click(q(view.container, '[data-action="execute"]'))
    view.unmount()
    pending.reject(new Error('late bind failure'))
    await flush()
    expect(handoff()).toBeNull()
  })
})

describe('host context', () => {
  it('renders through the key fallback without a host context', async () => {
    installFetch(defaultRoutes())
    const { view } = renderWorkbench({ ctx: null })
    await flush()
    expect(text(view.container, 'nav[role="tablist"] button[data-work-tab="task"]'))
      .toBe('workbench.tab.task')
    expect(text(view.container, '.gantt-workbench-chip-title')).toBe('Ship work mode')
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('work')
    expect(text(view.container, '.gantt-workbench-chat-state')).toBe('workbench.task.state.idle')
    expect(q(view.container, 'button[data-action="open-agent"]')).toBeNull()
  })

  it('reads services from ctx properties when ctx.get is absent', async () => {
    installFetch(defaultRoutes())
    const services = fakeServices({
      sessionsList: { ids: ['session-work'], byId: { 'session-work': {} } },
    })
    const { view } = renderWorkbench({
      ctx: buildCtx({ withoutGet: true, sessions: services.sessions }),
    })
    await flush()
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('work')
    expect(text(view.container, '.gantt-workbench-chat-state')).toBe('Idle')
    click(tab(view.container, 'team'))
    expect(qa(view.container, 'button[data-action="open-agent"]')).toHaveLength(0)
  })
})

describe('robustness', () => {
  it('works without a scope binding', async () => {
    const { calls } = installFetch(defaultRoutes())
    const { view } = renderWorkbench({ scope: null })
    await flush()
    expect(calls[0].path).toBe(WORK)
    expect(text(view.container, '.gantt-workbench-chip-title')).toBe('Ship work mode')
    expect(calls).toContainEqual(expect.objectContaining({ path: `${TEAM}?sessionId=session-work` }))
  })

  it('handles a blank session binding', async () => {
    const { calls } = installFetch(defaultRoutes({ work: { ...WORK_BY_SESSION, sessionId: '' } }))
    const { view } = renderWorkbench()
    await flush()
    expect(calls).toContainEqual(expect.objectContaining({ path: `${TEAM}?sessionId=` }))
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('')
    expect(q(view.container, '[data-action="open-conversation"]')).not.toBeNull()
  })

  it('renders the short id when the session row is missing', async () => {
    const services = fakeServices({ sessionsList: { ids: [], byId: {} } })
    installFetch(defaultRoutes())
    const { view } = renderWorkbench({ services })
    await flush()
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('work')
    expect(text(view.container, '.gantt-workbench-chat-state')).toBe('Idle')
    expect(text(view.container, '.gantt-workbench-chat-updated')).toBe('Last active ')
  })

  it('falls back through the focused task reference', async () => {
    installFetch(defaultRoutes({
      work: { ...WORK_BY_SESSION, task: { ...TASK, number: null, ref: '7.2.1' } },
    }))
    const first = renderWorkbench()
    await flush()
    expect(text(first.view.container, '.gantt-workbench-chip-ref')).toBe('7.2.1')
    first.view.unmount()

    installFetch(defaultRoutes({
      work: { ...WORK_BY_SESSION, task: { ...TASK, number: null, ref: null } },
    }))
    const second = renderWorkbench()
    await flush()
    expect(text(second.view.container, '.gantt-workbench-chip-ref')).toBe('')
  })

  it('renders empty states for malformed payloads', async () => {
    installFetch(defaultRoutes({
      routes: { [TRAJECTORY]: () => jsonResponse({ ok: true, events: null }) },
    }))
    const first = renderWorkbench()
    await flush()
    expect(text(first.view.container, '[data-block="trajectory"] .gantt-workbench-empty')).toBe('No trajectory yet.')
    first.view.unmount()

    installFetch(defaultRoutes({
      routes: { [SKILLS]: () => jsonResponse({ ok: true, available: true, skills: null }) },
    }))
    const second = renderWorkbench()
    await flush()
    click(tab(second.view.container, 'skills'))
    expect(text(second.view.container, 'section[data-panel="skills"]')).toBe('No skills available.')
    second.view.unmount()

    installFetch(defaultRoutes({
      routes: { [TEAM]: () => jsonResponse({ ok: true, available: true, agents: null }) },
    }))
    const third = renderWorkbench()
    await flush()
    click(tab(third.view.container, 'team'))
    expect(text(third.view.container, 'section[data-panel="team"]')).toBe('No subagents yet.')
  })

  it('survives a non-Error work failure', async () => {
    installFetch({
      ...defaultRoutes(),
      [WORK]: () => {
        throw 'offline'
      },
    })
    const { view } = renderWorkbench()
    await flush()
    expect(text(view.container, '.gantt-workbench-message')).toBe('Could not load the workbench.')
    expect(text(view.container, '.gantt-workbench-error')).toBe('offline')
  })
})
