// Shared fixtures for the workbench specs: fake host services, default API
// routes, and the mount helpers used by the task-view and execute specs.
import { vi } from 'vitest'
import { createElement } from 'react'
import { jsonResponse, mount, q, qa } from './harness.js'
import { GanttWorkbench } from '../../src/client/pages/workbench.js'
import { DICTS } from '../../src/client/i18n/index.js'
import { HANDOFF_KEY } from '../../src/client/session-window.js'

export const WORK = 'api/gantt/work'
export const WORK_SESSION = 'api/gantt/work/session'
export const SKILLS = 'api/gantt/work/skills'
export const TEAM = 'api/gantt/work/team'
export const TRAJECTORY = 'api/gantt/trajectory'
export const FOCUS_SET = 'api/gantt/focus/set'
export const AGENTS = 'api/gantt/agents'

export const TASK = {
  id: 'task-1',
  number: '1.8.1',
  ref: '1.8.1',
  title: 'Ship work mode',
  description: [
    '# Ship the workbench',
    '',
    'Wire **markdown** with `renderMarkdown`.',
    '',
    '- conversation',
    '- description',
    '',
    '[Spec](https://example.com/spec)',
  ].join('\n'),
  status: 'in_progress',
  progress: 40,
  doneWhen: 'green gates',
  operatorId: 'agent-1',
  completedById: 'agent-2',
  report: 'Wired the write-back rows.\nVerified with the workbench specs.',
}

export const WORK_BY_SESSION = {
  ok: true,
  cwd: '/data/home/ws-plugin',
  task: TASK,
  sessionId: 'session-work',
}

export const WORK_WITHOUT_SESSION = { ...WORK_BY_SESSION, sessionId: null }

export const WORK_FOCUS_NONE = {
  ok: true,
  cwd: '/data/home/ws-plugin',
  task: null,
  sessionId: null,
}

export const TRAJECTORY_EVENTS = [
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

export const SKILLS_AVAILABLE = [
  { name: 'codex-cli-calling', description: 'Run Codex from a terminal.', source: 'workspace' },
  { name: 'quiet-skill', description: '', source: '' },
]

export const TEAM_AGENTS = [
  { id: 'agent-1', label: 'reviewer', mode: 'continuable', createdAt: '2026-11-16T06:00:00.000Z' },
  { id: 'agent-2', label: '', mode: 'one-shot', createdAt: '2026-11-16T05:00:00.000Z' },
  { id: 'agent-3', label: 'outsider', mode: 'external', createdAt: '2026-11-16T04:00:00.000Z' },
]

export const AGENT_REGISTRY = [{ id: 'agent-1', name: 'reviewer' }]

export const SESSION_LIST = {
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

export function dictionary(locale) {
  return String(locale).toLowerCase().startsWith('zh') ? DICTS.zh : DICTS.en
}

export function fakeUiSession(entries = {}) {
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

export function buildCtx(options = {}) {
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

export function fakeServices(options = {}) {
  const opened = []
  const created = []
  const opens = []
  const retained = []
  const released = []
  const prompts = []
  let send = options.send ?? (async (sessionId, text) => {
    prompts.push({ sessionId, text })
  })
  const sessions = {
    created,
    create: async (request) => {
      created.push(request)
      return 'session-created'
    },
    list: { getSnapshot: () => options.sessionsList ?? SESSION_LIST },
    retain: (sessionId, request) => {
      retained.push({ sessionId, ...request })
      return {
        ready: Promise.resolve(),
        release: () => released.push(sessionId),
      }
    },
    scope: sessionId => ({
      get: name => name === 'conversation'
        ? { send: text => send(sessionId, text) }
        : undefined,
    }),
  }
  const services = {
    sessions,
    uiWorkspace: { opened, openSession: sessionId => opened.push(sessionId) },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', path: '/data/home/ws-plugin' }] }) } },
    betterSidebar: { opens, openTab: (seed, scope) => opens.push({ seed, scope }) },
    opened,
    created,
    opens,
    retained,
    released,
    prompts,
    setSend: (next) => {
      send = next
    },
  }
  if (options.uiSession !== undefined) services.uiSession = options.uiSession
  return services
}

export function defaultRoutes(overrides = {}) {
  return {
    [WORK]: () => jsonResponse(overrides.work ?? WORK_BY_SESSION),
    [TRAJECTORY]: () => jsonResponse({ ok: true, events: TRAJECTORY_EVENTS }),
    [SKILLS]: () => jsonResponse({ ok: true, available: true, skills: SKILLS_AVAILABLE }),
    [TEAM]: () => jsonResponse({ ok: true, available: true, agents: TEAM_AGENTS }),
    [AGENTS]: () => jsonResponse({ ok: true, agents: AGENT_REGISTRY }),
    [FOCUS_SET]: () => jsonResponse({ ok: true, taskId: 'task-1' }),
    [WORK_SESSION]: () => jsonResponse({ ok: true, taskId: 'task-1', sessionId: 'session-created' }),
    ...overrides.routes,
  }
}

export function renderWorkbench(options = {}) {
  const services = options.services ?? fakeServices(options.serviceOptions)
  const ctx = options.ctx === undefined
    ? buildCtx({ services, locale: options.locale, ...(options.ctxOptions ?? {}) })
    : options.ctx
  const scope = options.scope === undefined ? { sessionId: options.sessionId ?? 's1' } : options.scope
  const props = {
    ctx,
    scope,
    visible: options.visible ?? true,
    ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
    ...(options.onClose === undefined ? {} : { onClose: options.onClose }),
  }
  const view = mount(createElement(GanttWorkbench, props))
  return { view, ctx, services, props }
}

export function rerender(view, props, visible) {
  view.rerender(createElement(GanttWorkbench, { ...props, visible }))
}

export function rowElements(container) {
  return qa(container, '.gantt-workbench-row')
}

export function tab(container, name) {
  return q(container, `[data-work-tab="${name}"]`)
}

export function fakeWindow() {
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

export function stubOpen(result) {
  const calls = []
  vi.stubGlobal('open', (...args) => {
    calls.push(args)
    return result
  })
  return calls
}

export function handoff() {
  const raw = localStorage.getItem(HANDOFF_KEY)
  return raw === null ? null : JSON.parse(raw)
}
