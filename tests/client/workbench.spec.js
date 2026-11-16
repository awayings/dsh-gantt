// Workbench tab body: the focused-task header, four sub-tabs, the trajectory /
// conversation / skills / team panels, every empty/unavailable/error state, and
// the refetch rules (visible, window focus, refresh, after a conversation action).
import { afterEach, describe, expect, it } from 'vitest'
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
    sessionId: 'session-work',
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
  return {
    sessions,
    uiWorkspace: { opened, openSession: sessionId => opened.push(sessionId) },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', path: '/data/home/ws-plugin' }] }) } },
    betterSidebar: { opens, openTab: (seed, scope) => opens.push({ seed, scope }) },
    opened,
    created,
    opens,
  }
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

afterEach(unmountAll)

describe('default trajectory tab', () => {
  it('renders the focused task, tab list, and trajectory rows', async () => {
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
    expect(q(view.container, '.gantt-workbench-none')).toBeNull()

    const tabs = qa(view.container, 'nav[role="tablist"] button.gantt-workbench-tab')
    expect(tabs.map(element => element.dataset.workTab)).toEqual(['trajectory', 'chat', 'skills', 'team'])
    expect(tabs.map(element => element.textContent)).toEqual(['Trajectory', 'Conversation', 'Skills', 'Team'])
    expect(tab(view.container, 'trajectory').getAttribute('data-active')).toBe('true')
    expect(tab(view.container, 'chat').hasAttribute('data-active')).toBe(false)

    expect(q(view.container, 'section[data-panel="trajectory"]')).not.toBeNull()
    expect(q(view.container, 'section[data-panel="chat"]')).toBeNull()

    const rows = rowElements(view.container)
    expect(rows).toHaveLength(4)
    expect(rows[0].getAttribute('data-action')).toBe('track')
    expect(rows[0].getAttribute('title')).toBe('session-work')
    expect(text(rows[0], '.gantt-workbench-row-action')).toBe('Tracked')
    expect(text(rows[0], '.gantt-workbench-row-turn')).toBe('Turn 4')
    expect(text(rows[0], '.gantt-workbench-row-time')).toMatch(/^\d{2}:\d{2}$/)
    expect(text(rows[0], '.gantt-workbench-row-detail')).toBe('wired the panels')
    expect(text(rows[1], '.gantt-workbench-row-action')).toBe('Completed')
    expect(q(rows[1], '.gantt-workbench-row-turn')).toBeNull()
    expect(q(rows[1], '.gantt-workbench-row-time').textContent).toBe('')
    expect(q(rows[1], '.gantt-workbench-row-detail')).toBeNull()
    expect(q(rows[2], '.gantt-workbench-row-time').textContent).toBe('')
    expect(q(rows[3], '.gantt-workbench-row-time').textContent).toBe('')
    expect(q(rows[3], '.gantt-workbench-row-turn')).toBeNull()
  })
})

describe('sub-tabs', () => {
  it('switches to the conversation, skills, and team panels', async () => {
    installFetch(defaultRoutes())
    const { view, services } = renderWorkbench()
    await flush()

    click(tab(view.container, 'chat'))
    expect(tab(view.container, 'chat').getAttribute('data-active')).toBe('true')
    expect(tab(view.container, 'trajectory').hasAttribute('data-active')).toBe(false)
    expect(q(view.container, 'section[data-panel="chat"]')).not.toBeNull()
    expect(q(view.container, 'section[data-panel="trajectory"]')).toBeNull()
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('Ship work mode')
    expect(text(view.container, '.gantt-workbench-chat-state')).toBe('Running')
    expect(q(view.container, '.gantt-workbench-chat-state').getAttribute('data-running')).toBe('true')
    expect(text(view.container, '.gantt-workbench-chat-updated')).toMatch(/^Last active \d{2}:\d{2}$/)
    expect(q(view.container, '.gantt-workbench-chat-title')).not.toBeNull()
    expect(q(view.container, '[data-action="open-conversation"]')).not.toBeNull()
    expect(q(view.container, '[data-action="create-conversation"]')).toBeNull()

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

  it('localizes the tab labels through the host dictionary', async () => {
    installFetch(defaultRoutes())
    const { view } = renderWorkbench({ locale: 'zh' })
    await flush()
    const tabs = qa(view.container, 'nav[role="tablist"] button.gantt-workbench-tab')
    expect(tabs.map(element => element.textContent)).toEqual(['轨迹', '对话', '技能', '编队'])
  })
})

describe('conversation panel', () => {
  it('opens the bound conversation and refreshes the workbench', async () => {
    const sessionsList = {
      ids: ['session-work'],
      byId: { 'session-work': { id: 'session-work', title: 'Legacy title', running: false, updatedAt: undefined } },
    }
    const { calls } = installFetch(defaultRoutes())
    const services = fakeServices({ sessionsList })
    const { view } = renderWorkbench({ services })
    await flush()

    click(tab(view.container, 'chat'))
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('Legacy title')
    expect(text(view.container, '.gantt-workbench-chat-state')).toBe('Idle')
    expect(q(view.container, '.gantt-workbench-chat-state').getAttribute('data-running')).toBe('false')

    const before = calls.length
    click(q(view.container, '[data-action="open-conversation"]'))
    await flush()

    expect(services.opened).toEqual(['session-work'])
    expect(services.opens).toEqual([{ seed: { type: 'gantt-work' }, scope: { sessionId: 'session-work' } }])
    const openedCalls = calls.slice(before).map(call => call.path)
    expect(openedCalls).toContain(`${WORK}?taskId=task-1`)
    expect(openedCalls).toContain(FOCUS_SET)
    expect(calls.filter(call => call.path === `${WORK}?sessionId=s1`).length).toBe(2)
  })

  it('creates the conversation when the task has none bound', async () => {
    const { calls } = installFetch(defaultRoutes({ work: WORK_WITHOUT_SESSION }))
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    click(tab(view.container, 'chat'))
    expect(q(view.container, '[data-action="create-conversation"]')).not.toBeNull()
    expect(q(view.container, '[data-action="open-conversation"]')).toBeNull()
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('')
    expect(text(view.container, '.gantt-workbench-chat-state')).toBe('Idle')

    click(q(view.container, '[data-action="create-conversation"]'))
    await flush()

    expect(services.created).toEqual([{ workspaceId: 'ws-1' }])
    expect(services.opened).toEqual(['session-created'])
    const bind = calls.filter(call => call.path === WORK_SESSION)[0]
    expect(JSON.parse(bind.options.body)).toEqual({ taskId: 'task-1', sessionId: 'session-created' })
  })

  it('surfaces a failed conversation action inside the chat panel', async () => {
    const { calls } = installFetch(defaultRoutes({
      routes: { [FOCUS_SET]: () => jsonResponse({ ok: false, error: 'focus write failed' }, 500) },
    }))
    const { view } = renderWorkbench()
    await flush()

    click(tab(view.container, 'chat'))
    click(q(view.container, '[data-action="open-conversation"]'))
    await flush()

    expect(text(view.container, '.gantt-workbench-error'))
      .toBe('Could not open the work conversation. focus write failed')
    expect(calls.filter(call => call.path === `${WORK}?sessionId=s1`).length).toBe(1)
    expect(q(view.container, '[data-action="open-conversation"]')).not.toBeNull()
  })
})

describe('empty, unavailable, and error states', () => {
  it('shows the focus-none header and the empty panels', async () => {
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
    expect(text(view.container, 'section[data-panel="trajectory"]')).toBe('No trajectory yet.')
    expect(calls.some(call => call.path.startsWith(TRAJECTORY))).toBe(false)
    expect(calls).toContainEqual(expect.objectContaining({ path: `${TEAM}?sessionId=s1` }))

    click(tab(view.container, 'chat'))
    expect(text(view.container, 'section[data-panel="chat"]')).toBe('No work conversation yet.')
    expect(q(view.container, '[data-action="open-conversation"]')).toBeNull()
    expect(q(view.container, '[data-action="create-conversation"]')).toBeNull()

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
      routes: {
        [TRAJECTORY]: () => jsonResponse({ ok: false, error: 'no trajectory' }, 500),
      },
    }))
    const first = renderWorkbench()
    await flush()
    expect(text(first.view.container, 'section[data-panel="trajectory"]')).toBe('Could not load the trajectory.')
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

describe('refetching', () => {
  it('refetches on the refresh button and on window focus', async () => {
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

  it('ignores a failed conversation action that rejects after unmount', async () => {
    const pending = deferred()
    installFetch({ ...defaultRoutes(), [FOCUS_SET]: () => pending.promise })
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()
    click(tab(view.container, 'chat'))
    click(q(view.container, '[data-action="open-conversation"]'))
    view.unmount()
    pending.reject(new Error('late focus failure'))
    await flush()
    expect(services.opened).toEqual([])
  })

  it('ignores a conversation action that finishes after unmount', async () => {
    const pending = deferred()
    installFetch({ ...defaultRoutes(), [FOCUS_SET]: () => pending.promise })
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()
    click(tab(view.container, 'chat'))
    click(q(view.container, '[data-action="open-conversation"]'))
    view.unmount()
    pending.resolve(jsonResponse({ ok: true, taskId: 'task-1' }))
    await flush()
    expect(services.opened).toEqual(['session-work'])
  })
})

describe('host context', () => {
  it('renders through the key fallback without a host context', async () => {
    installFetch(defaultRoutes())
    const { view } = renderWorkbench({ ctx: null })
    await flush()
    expect(text(view.container, 'nav[role="tablist"] button[data-work-tab="trajectory"]'))
      .toBe('workbench.tab.trajectory')
    expect(text(view.container, '.gantt-workbench-chip-title')).toBe('Ship work mode')
    click(tab(view.container, 'chat'))
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('')
    expect(text(view.container, '.gantt-workbench-chat-state')).toBe('workbench.chat.idle')
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
    click(tab(view.container, 'chat'))
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('')
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
    click(tab(view.container, 'chat'))
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('')
    expect(q(view.container, '[data-action="open-conversation"]')).not.toBeNull()
  })

  it('renders an empty identity when the session row is missing', async () => {
    const services = fakeServices({ sessionsList: { ids: [], byId: {} } })
    installFetch(defaultRoutes())
    const { view } = renderWorkbench({ services })
    await flush()
    click(tab(view.container, 'chat'))
    expect(text(view.container, '.gantt-workbench-chat-block .gantt-workbench-chat-title')).toBe('')
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
    expect(text(first.view.container, 'section[data-panel="trajectory"]')).toBe('No trajectory yet.')
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
