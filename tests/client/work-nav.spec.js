// Work-mode navigation: service resolution, workspace lookup, and the
// reuse-or-create flow that binds a task to its dedicated conversation.
import { describe, expect, it } from 'vitest'
import {
  activeSessionId,
  canOpenWorkTask,
  loadWork,
  noteWorkFocus,
  openWorkTask,
  openWorkbenchTab,
  subscribeWorkFocus,
  workFocusRevisionSnapshot,
  workServices,
  workspaceIdFor,
  WORK_TAB_ID,
} from '../../src/client/work-nav.js'
import { callsTo, installFetch, jsonResponse, requestBody } from './harness.js'

function fakeCtx(services = {}) {
  return { get: name => services[name] }
}

function fakeSessions(createdId = 'session-new') {
  const created = []
  return {
    created,
    create: async (options) => {
      created.push(options)
      return createdId
    },
  }
}

function fakeWorkspaceService(opened = []) {
  return {
    opened,
    openSession(sessionId) {
      opened.push(sessionId)
    },
  }
}

function workspacesWith(path, workspaceId = 'ws-1') {
  return {
    list: {
      getSnapshot: () => ({ items: [{ workspaceId, path }] }),
    },
  }
}

describe('workServices', () => {
  it('resolves every optional service and rejects unusable shapes', () => {
    expect(workServices(undefined)).toEqual({ sessions: null, uiWorkspace: null, workspaces: null, betterSidebar: null })
    expect(workServices({})).toEqual({ sessions: null, uiWorkspace: null, workspaces: null, betterSidebar: null })

    const sessions = { create: async () => 's1' }
    const uiWorkspace = { openSession: () => {} }
    const workspaces = workspacesWith('/work')
    const betterSidebar = { openTab: () => {} }
    const services = workServices(fakeCtx({ sessions, uiWorkspace, workspaces, betterSidebar }))
    expect(services).toEqual({ sessions, uiWorkspace, workspaces, betterSidebar })

    const broken = workServices(fakeCtx({ sessions: {}, uiWorkspace: {} }))
    expect(broken.sessions).toBeNull()
    expect(broken.uiWorkspace).toBeNull()
    expect(broken.workspaces).toBeNull()
    expect(broken.betterSidebar).toBeNull()
  })

  it('reports availability only when both session services work', () => {
    expect(canOpenWorkTask(undefined)).toBe(false)
    expect(canOpenWorkTask(fakeCtx({ sessions: { create: async () => 's1' } }))).toBe(false)
    expect(canOpenWorkTask(fakeCtx({ uiWorkspace: { openSession: () => {} } }))).toBe(false)
    expect(canOpenWorkTask(fakeCtx({
      sessions: { create: async () => 's1' },
      uiWorkspace: { openSession: () => {} },
    }))).toBe(true)
  })
})

describe('activeSessionId', () => {
  it('reads the session on screen from the sidebar snapshot', () => {
    const betterSidebar = { getSnapshot: () => ({ sessionId: 'session-main' }) }
    expect(activeSessionId(fakeCtx({ betterSidebar }))).toBe('session-main')
  })

  it('returns null without a usable sidebar snapshot', () => {
    expect(activeSessionId(undefined)).toBeNull()
    expect(activeSessionId(fakeCtx({ betterSidebar: { getSnapshot: () => ({}) } }))).toBeNull()
    expect(activeSessionId(fakeCtx({ betterSidebar: { getSnapshot: () => ({ sessionId: '' }) } }))).toBeNull()
    expect(activeSessionId(fakeCtx({ betterSidebar: {} }))).toBeNull()
  })
})

describe('work focus revisions', () => {
  it('notifies subscribers once per focus change', () => {
    const seen = []
    const dispose = subscribeWorkFocus(() => seen.push(workFocusRevisionSnapshot()))
    const before = workFocusRevisionSnapshot()
    noteWorkFocus()
    expect(seen).toEqual([before + 1])
    dispose()
    noteWorkFocus()
    expect(seen).toHaveLength(1)
    expect(workFocusRevisionSnapshot()).toBe(before + 2)
  })
})

describe('workspaceIdFor', () => {
  const cwd = '/data/home/ws-plugin'

  it('matches the registered workspace by canonical path', () => {
    expect(workspaceIdFor(workspacesWith(cwd), cwd)).toBe('ws-1')
    expect(workspaceIdFor(workspacesWith('/elsewhere'), cwd)).toBeNull()
  })

  it('returns null for unusable inputs instead of throwing', () => {
    expect(workspaceIdFor(null, cwd)).toBeNull()
    expect(workspaceIdFor({}, cwd)).toBeNull()
    expect(workspaceIdFor({ list: {} }, cwd)).toBeNull()
    expect(workspaceIdFor(workspacesWith(cwd), '')).toBeNull()
    expect(workspaceIdFor(workspacesWith(cwd), undefined)).toBeNull()
    expect(workspaceIdFor({ list: { getSnapshot: () => ({ items: null }) } }, cwd)).toBeNull()
    expect(workspaceIdFor({ list: { getSnapshot: () => ({}) } }, cwd)).toBeNull()
    expect(workspaceIdFor({ list: { getSnapshot: () => ({ items: [{ path: cwd }] }) } }, cwd)).toBeNull()
    expect(workspaceIdFor({ list: { getSnapshot: () => ({ items: [{ path: cwd, workspaceId: '' }] }) } }, cwd)).toBeNull()
  })
})

describe('loadWork', () => {
  it('builds the query from the target it is given', async () => {
    const { calls } = installFetch({ 'api/gantt/work': () => jsonResponse({ ok: true, cwd: '/work', task: null, sessionId: null }) })
    await loadWork()
    await loadWork({ taskId: 't1' })
    await loadWork({ taskId: '', sessionId: 's1' })
    expect(calls.map(call => call.path)).toEqual([
      'api/gantt/work',
      'api/gantt/work?taskId=t1',
      'api/gantt/work?sessionId=s1',
    ])
  })
})

describe('workbench tab', () => {
  it('opens the workbench tab for one session, and no-ops without a sidebar', () => {
    const opens = []
    openWorkbenchTab({ openTab: (seed, scope) => opens.push({ seed, scope }) }, 'session-1')
    expect(opens).toEqual([{ seed: { type: WORK_TAB_ID }, scope: { sessionId: 'session-1' } }])
    expect(WORK_TAB_ID).toBe('gantt-work')
    expect(() => openWorkbenchTab(null, 'session-1')).not.toThrow()
    expect(() => openWorkbenchTab({}, 'session-1')).not.toThrow()
  })
})

describe('openWorkTask', () => {
  const task = { id: 'task-1' }

  it('fails loudly when the host cannot open sessions', async () => {
    await expect(openWorkTask(undefined, task)).rejects.toThrow(/session and workspace services/)
    await expect(openWorkTask(fakeCtx({ sessions: { create: async () => 's' } }), task)).rejects.toThrow(/session and workspace services/)
  })

  it('reopens the bound conversation and refreshes its focus', async () => {
    const sessions = fakeSessions()
    const opened = []
    const seeds = []
    const ctx = fakeCtx({
      sessions,
      uiWorkspace: fakeWorkspaceService(opened),
      betterSidebar: { openTab: seed => seeds.push(seed) },
    })
    const { calls } = installFetch({
      'api/gantt/work': () => jsonResponse({ ok: true, cwd: '/work', task: null, sessionId: 'session-bound' }),
      'api/gantt/focus/set': () => jsonResponse({ ok: true, taskId: 'task-1' }),
    })
    const result = await openWorkTask(ctx, task)
    expect(result).toEqual({ sessionId: 'session-bound', created: false })
    expect(sessions.created).toEqual([])
    expect(opened).toEqual(['session-bound'])
    expect(seeds).toEqual([{ type: WORK_TAB_ID }])
    const focusCall = callsTo(calls, 'api/gantt/focus/set')[0]
    expect(requestBody(focusCall)).toEqual({ sessionId: 'session-bound', taskId: 'task-1' })
  })

  it('creates a conversation in the registered workspace and binds it', async () => {
    const sessions = fakeSessions('session-created')
    const opened = []
    const ctx = fakeCtx({
      sessions,
      uiWorkspace: fakeWorkspaceService(opened),
      workspaces: workspacesWith('/work'),
    })
    const { calls } = installFetch({
      'api/gantt/work': () => jsonResponse({ ok: true, cwd: '/work', task: null, sessionId: null }),
      'api/gantt/work/session': () => jsonResponse({ ok: true, taskId: 'task-1', sessionId: 'session-created' }),
    })
    const result = await openWorkTask(ctx, task)
    expect(result).toEqual({ sessionId: 'session-created', created: true })
    expect(sessions.created).toEqual([{ workspaceId: 'ws-1' }])
    expect(opened).toEqual(['session-created'])
    expect(requestBody(callsTo(calls, 'api/gantt/work/session')[0])).toEqual({ taskId: 'task-1', sessionId: 'session-created' })
  })

  it('binds without navigating when the caller opens the window itself', async () => {
    const sessions = fakeSessions()
    const opened = []
    const seeds = []
    const ctx = fakeCtx({
      sessions,
      uiWorkspace: fakeWorkspaceService(opened),
      betterSidebar: { openTab: seed => seeds.push(seed) },
    })
    installFetch({
      'api/gantt/work': () => jsonResponse({ ok: true, cwd: '/work', task: null, sessionId: 'session-bound' }),
      'api/gantt/focus/set': () => jsonResponse({ ok: true }),
    })
    await expect(openWorkTask(ctx, task, { open: false }))
      .resolves.toEqual({ sessionId: 'session-bound', created: false })
    expect(opened).toEqual([])
    expect(seeds).toEqual([])
    expect(sessions.created).toEqual([])
  })

  it('creates and binds without a workspace navigation service', async () => {
    const sessions = fakeSessions('session-created')
    const ctx = fakeCtx({ sessions, workspaces: workspacesWith('/work') })
    installFetch({
      'api/gantt/work': () => jsonResponse({ ok: true, cwd: '/work', task: null, sessionId: null }),
      'api/gantt/work/session': () => jsonResponse({ ok: true }),
    })
    await expect(openWorkTask(ctx, task, { open: false }))
      .resolves.toEqual({ sessionId: 'session-created', created: true })
    expect(sessions.created).toEqual([{ workspaceId: 'ws-1' }])
  })

  it('creates the conversation from the directory when no workspace is registered', async () => {
    const sessions = fakeSessions('session-dir')
    const ctx = fakeCtx({ sessions, uiWorkspace: fakeWorkspaceService() })
    installFetch({
      'api/gantt/work': () => jsonResponse({ ok: true, cwd: '/work', task: null, sessionId: null }),
      'api/gantt/work/session': () => jsonResponse({ ok: true }),
    })
    const result = await openWorkTask(ctx, task)
    expect(result).toEqual({ sessionId: 'session-dir', created: true })
    expect(sessions.created).toEqual([{ cwd: '/work' }])
  })

  it('refuses to create a conversation without any directory', async () => {
    const sessions = fakeSessions()
    const ctx = fakeCtx({ sessions, uiWorkspace: fakeWorkspaceService() })
    installFetch({ 'api/gantt/work': () => jsonResponse({ ok: true, cwd: '', sessionId: null }) })
    await expect(openWorkTask(ctx, task)).rejects.toThrow(/no work directory/)
    expect(sessions.created).toEqual([])
  })
})
