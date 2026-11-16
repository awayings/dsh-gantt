// Compact task-tree panel of the native conversation sidebar: better-sidebar
// registration, tree rendering, focus restore/write/clear, refresh, visibility
// pause, and the loading/error/empty states.
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import {
  applyPlugin,
  buttonByText,
  click,
  createPlugin,
  deferred,
  fakeSidebarService,
  flush,
  installFetch,
  jsonResponse,
  mount,
  q,
  qa,
  requestBody,
  setupApp,
  text,
  unmountAll,
} from './harness.js'
import { emptyTreePayload, unifiedTreePayload } from './fixtures.js'

const TREE = 'api/gantt/tree'
const FOCUS = 'api/gantt/focus'
const FOCUS_SET = 'api/gantt/focus/set'
const TRAJECTORY = 'api/gantt/trajectory'

const TRAJECTORY_EVENTS = [
  {
    id: 'e6',
    taskId: 'n1',
    action: 'complete',
    sessionId: 'session-abcdef-long',
    sessionTitle: 'Merged PR',
    turn: 12,
    detail: 'merged to main',
    at: '2026-11-16T06:05:00.000Z',
  },
  {
    id: 'e5',
    taskId: 'n1',
    action: 'update',
    sessionId: 'session-1',
    turn: null,
    detail: '',
    at: '2026-11-16T05:30:00.000Z',
  },
  {
    id: 'e4',
    taskId: 'n1',
    action: 'decompose',
    sessionId: 'session-2',
    turn: 3,
    detail: 'split into 3',
    at: '2026-11-16T04:15:00.000Z',
  },
  {
    id: 'e3',
    taskId: 'n1',
    action: 'create',
    sessionId: 'session-3',
    turn: 1,
    detail: '',
    at: '2026-11-15T22:00:00.000Z',
  },
  {
    id: 'e2',
    taskId: 'n1',
    action: 'update',
    sessionId: 'session-4',
    turn: 2,
    detail: '',
    at: '2026-11-15T21:00:00.000Z',
  },
  {
    id: 'e1',
    taskId: 'n1',
    action: 'create',
    sessionId: 'session-5',
    turn: 0,
    detail: '',
    at: '2026-11-15T20:00:00.000Z',
  },
]

afterEach(unmountAll)

function panelApp(options = {}) {
  const app = setupApp({ services: { betterSidebar: fakeSidebarService() }, ...options })
  return { app, tab: app.sidebarTabs().find(tab => tab.id === 'gantt') }
}

function panelElement(tab, app, visible = true) {
  return createElement(tab.component, { ctx: app.ctx, scope: { sessionId: 's1' }, visible })
}

async function renderPanel(routes = {}, options = {}) {
  const fetchState = installFetch({
    [TREE]: () => jsonResponse(unifiedTreePayload()),
    [FOCUS]: () => jsonResponse({ ok: true, taskId: null }),
    [FOCUS_SET]: call => jsonResponse({ ok: true, taskId: requestBody(call).taskId }),
    [TRAJECTORY]: () => jsonResponse({ ok: true, events: [] }),
    ...routes,
  })
  const { app, tab } = panelApp(options)
  const view = mount(panelElement(tab, app))
  await flush()
  return { ...fetchState, app, tab, view }
}

function panelRow(view, id) {
  return q(view.container, `.gantt-panel-row[data-task-id="${id}"]`)
}

function treeCalls(calls) {
  return calls.filter(call => call.path === TREE)
}

function focusGetCalls(calls) {
  return calls.filter(call => call.path.startsWith(`${FOCUS}?`))
}

function focusPostCalls(calls) {
  return calls.filter(call => call.path === FOCUS_SET)
}

function trajectoryCalls(calls) {
  return calls.filter(call => call.path.startsWith(`${TRAJECTORY}?`))
}

describe('better-sidebar registration', () => {
  it('registers the Gantt tab and the workbench tab with the sidebar service', () => {
    const { app, tab } = panelApp()

    expect(app.sidebarTabs()).toHaveLength(2)
    expect(app.sidebarTabs().map(entry => entry.id)).toEqual(['gantt', 'gantt-work'])
    expect(tab).toMatchObject({ id: 'gantt', order: 22, single: true })
    expect(tab.title()).toBe('Task Gantt')
    expect(tab.description()).toBe(
      'Focus a task for this conversation; the compact tree tracks status at a glance.',
    )
    expect(typeof tab.component).toBe('function')

    const workbench = app.sidebarTabs().find(entry => entry.id === 'gantt-work')
    expect(workbench).toMatchObject({ id: 'gantt-work', order: 23, single: true })
    expect(workbench.title()).toBe('Workbench')
    expect(workbench.description()).toBe(
      'The focused task: its work conversation, trajectory, skills, and agent team.',
    )
    expect(typeof workbench.component).toBe('function')

    app.dispose()
    expect(app.sidebarTabs()).toHaveLength(0)
  })

  it('mounts the registered workbench tab body', async () => {
    const { app } = panelApp()
    const workbench = app.sidebarTabs().find(entry => entry.id === 'gantt-work')

    const view = mount(createElement(workbench.component, {
      ctx: app.ctx,
      scope: { sessionId: 's1' },
      visible: false,
    }))
    await flush()

    expect(q(view.container, '.gantt-workbench')).not.toBeNull()
    expect(text(view.container, '.gantt-workbench-none')).toBe('No focused task')
    expect(qa(view.container, '.gantt-workbench-tab')).toHaveLength(4)
  })

  it('localizes the tab title and description', () => {
    const { app, tab } = panelApp({ locale: 'zh' })

    expect(tab.title()).toBe('任务甘特图')
    expect(tab.description()).toBe('为当前对话聚焦任务；紧凑任务树随时显示状态。')
    const workbench = app.sidebarTabs().find(entry => entry.id === 'gantt-work')
    expect(workbench.title()).toBe('工作台')
    expect(workbench.description()).toBe('聚焦任务：它的专属工作对话、轨迹、技能与编队。')
  })

  it('does nothing when the sidebar service is absent or injection is unavailable', () => {
    const app = setupApp()
    expect(app.sidebarTabs()).toEqual([])
    expect(app.page()).not.toBeUndefined()

    expect(() => applyPlugin(createPlugin(), { withoutInject: true })).not.toThrow()
    const bare = applyPlugin(createPlugin(), { withoutInject: true })
    expect(bare.page()).not.toBeUndefined()
    expect(bare.sidebarTabs()).toEqual([])
  })
})

describe('panel rendering', () => {
  it('restores the focused task and renders the indented tree with status and kind', async () => {
    const { calls, view } = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
    })

    expect(treeCalls(calls)).toHaveLength(1)
    expect(focusGetCalls(calls)).toHaveLength(1)
    expect(focusGetCalls(calls)[0].path).toBe('api/gantt/focus?sessionId=s1')
    expect(qa(view.container, '.gantt-panel-row')).toHaveLength(5)

    const track = panelRow(view, 't1')
    expect(track.getAttribute('data-kind')).toBe('track')
    expect(text(track, '.gantt-panel-ref')).toBe('1')
    expect(text(track, '.gantt-panel-title')).toBe('投资系统')
    expect(text(track, '.gantt-panel-kind')).toBe('Track')
    expect(text(track, '.gantt-panel-dot')).toBe('')
    expect(q(track, '.gantt-panel-dot').getAttribute('style')).toContain('--st')

    const nested = panelRow(view, 'n21')
    expect(nested.getAttribute('style')).toContain('padding-left: 38px')
    expect(text(nested, '.gantt-panel-ref')).toBe('1.8.4')

    expect(text(view.container, '.gantt-panel-chip-ref')).toBe('1.1')
    expect(text(view.container, '.gantt-panel-chip-title')).toBe('数据底座')
    expect(text(view.container, '.gantt-panel-focus-label')).toBe('Focused task')
    expect(panelRow(view, 'n1').getAttribute('data-focused')).toBe('true')
    expect(panelRow(view, 'n2').getAttribute('data-focused')).toBeNull()
  })

  it('writes the focused task when a row is clicked and clears it again', async () => {
    const { calls, view } = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
      [FOCUS_SET]: call => jsonResponse({ ok: true, taskId: requestBody(call).taskId }),
    })

    click(panelRow(view, 'n2'))
    await flush()

    expect(focusPostCalls(calls)).toHaveLength(1)
    expect(requestBody(focusPostCalls(calls)[0])).toEqual({ sessionId: 's1', taskId: 'n2' })
    expect(text(view.container, '.gantt-panel-chip-ref')).toBe('1.8')
    expect(panelRow(view, 'n2').getAttribute('data-focused')).toBe('true')
    expect(panelRow(view, 'n1').getAttribute('data-focused')).toBeNull()

    click(buttonByText(view.container, 'Clear focus'))
    await flush()

    expect(focusPostCalls(calls)).toHaveLength(2)
    expect(requestBody(focusPostCalls(calls)[1])).toEqual({ sessionId: 's1', taskId: null })
    expect(view.container.querySelector('.gantt-panel-chip')).toBeNull()
    expect(text(view.container, '.gantt-panel-focus-none')).toBe('No focused task')
    expect(q(view.container, '.gantt-panel-row[data-focused="true"]')).toBeNull()
  })

  it('shows no breadcrumb when the persisted focus left the tree', async () => {
    const { view } = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'ghost' }),
    })

    expect(text(view.container, '.gantt-panel-focus-none')).toBe('No focused task')
    expect(qa(view.container, '.gantt-panel-row')).toHaveLength(5)

    click(panelRow(view, 'n1'))
    await flush()
    expect(text(view.container, '.gantt-panel-chip-ref')).toBe('1.1')
  })

  it('refreshes the tree from the toolbar and shows its busy state', async () => {
    const gate = deferred()
    let attempt = 0
    const { calls, view } = await renderPanel({
      [TREE]: () => {
        attempt += 1
        return attempt === 1 ? jsonResponse(unifiedTreePayload()) : gate.promise
      },
    })
    const button = q(view.container, 'button[aria-label="Refresh tree"]')

    click(button)
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('…')

    gate.resolve(jsonResponse(unifiedTreePayload()))
    await flush()

    expect(treeCalls(calls)).toHaveLength(2)
    expect(q(view.container, 'button[aria-label="Refresh tree"]').disabled).toBe(false)
    expect(qa(view.container, '.gantt-panel-row')).toHaveLength(5)
  })

  it('tolerates a missing session scope without focus traffic', async () => {
    const fetchState = installFetch({ [TREE]: () => jsonResponse(unifiedTreePayload()) })
    const { app, tab } = panelApp()
    const view = mount(createElement(tab.component, { ctx: app.ctx, visible: true }))
    await flush()

    expect(focusGetCalls(fetchState.calls)).toHaveLength(0)
    click(panelRow(view, 'n1'))
    await flush()
    expect(focusPostCalls(fetchState.calls)).toHaveLength(0)
    expect(qa(view.container, '.gantt-panel-row')).toHaveLength(5)
    expect(q(view.container, '.gantt-panel-chip')).toBeNull()
  })

  it('falls back for an unknown status colour and a missing kind', async () => {
    const tasks = unifiedTreePayload().tasks
    tasks[0].status = 'weird'
    tasks[0].kind = undefined
    const { view } = await renderPanel({
      [TREE]: () => jsonResponse(unifiedTreePayload({ tasks })),
    })
    const rowElement = panelRow(view, 't1')

    expect(q(rowElement, '.gantt-panel-dot').getAttribute('style')).toContain('--dsw-alias-state-idle-primary')
    expect(text(rowElement, '.gantt-panel-kind')).toBe('Task')
  })

  it('drops focus responses and failures that land after unmount', async () => {
    const resolved = deferred()
    const first = installFetch({
      [TREE]: () => jsonResponse(emptyTreePayload()),
      [FOCUS]: () => resolved.promise,
    })
    const { app, tab } = panelApp()
    const view = mount(panelElement(tab, app))
    view.unmount()

    resolved.resolve(jsonResponse({ ok: true, taskId: 'n1' }))
    await flush()
    expect(focusGetCalls(first.calls)).toHaveLength(1)

    const rejected = deferred()
    const second = installFetch({
      [TREE]: () => jsonResponse(emptyTreePayload()),
      [FOCUS]: () => rejected.promise,
    })
    const next = panelApp()
    const nextView = mount(panelElement(next.tab, next.app))
    nextView.unmount()

    rejected.reject(new Error('late focus'))
    await flush()
    expect(focusGetCalls(second.calls)).toHaveLength(1)
  })
})

describe('visibility pause', () => {
  it('loads nothing until the tab becomes visible', async () => {
    const fetchState = installFetch({
      [TREE]: () => jsonResponse(unifiedTreePayload()),
      [FOCUS]: () => jsonResponse({ ok: true, taskId: null }),
    })
    const { app, tab } = panelApp()
    const view = mount(panelElement(tab, app, false))
    await flush()

    expect(treeCalls(fetchState.calls)).toHaveLength(0)
    expect(focusGetCalls(fetchState.calls)).toHaveLength(0)

    view.rerender(panelElement(tab, app, true))
    await flush()

    expect(treeCalls(fetchState.calls)).toHaveLength(1)
    expect(focusGetCalls(fetchState.calls)).toHaveLength(1)
    expect(qa(view.container, '.gantt-panel-row')).toHaveLength(5)
  })

  it('stops auto-refresh while hidden and refreshes when shown again', async () => {
    const { app, tab, calls, view } = await renderPanel()
    expect(treeCalls(calls)).toHaveLength(1)

    view.rerender(panelElement(tab, app, false))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(treeCalls(calls)).toHaveLength(1)

    view.rerender(panelElement(tab, app, true))
    await flush()
    expect(treeCalls(calls)).toHaveLength(2)

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(treeCalls(calls)).toHaveLength(3)
  })
})

describe('loading, empty, and error states', () => {
  it('renders the loading state until the tree arrives', async () => {
    const gate = deferred()
    installFetch({
      [TREE]: () => gate.promise,
      [FOCUS]: () => jsonResponse({ ok: true, taskId: null }),
    })
    const { app, tab } = panelApp()
    const view = mount(panelElement(tab, app))

    expect(q(view.container, '.gantt-panel-spinner')).not.toBeNull()
    expect(text(view.container, '.gantt-panel-center')).toContain('Loading tasks')

    gate.resolve(jsonResponse(unifiedTreePayload()))
    await flush()
    expect(qa(view.container, '.gantt-panel-row')).toHaveLength(5)
  })

  it('shows the empty-tree message', async () => {
    const { view } = await renderPanel({ [TREE]: () => jsonResponse(emptyTreePayload()) })
    expect(text(view.container, '.gantt-panel-message')).toBe('No tasks yet.')
    expect(qa(view.container, '.gantt-panel-row')).toHaveLength(0)
  })

  it('shows a load error and recovers through retry', async () => {
    let attempt = 0
    const { calls, view } = await renderPanel({
      [TREE]: () => {
        attempt += 1
        if (attempt === 1) return Promise.reject(new Error('offline'))
        return jsonResponse(unifiedTreePayload())
      },
    })

    expect(text(view.container, '.gantt-panel-center')).toContain('Could not load the task tree.')
    expect(text(view.container, '.gantt-panel-center')).toContain('offline')

    click(buttonByText(view.container, 'Retry'))
    await flush()

    expect(treeCalls(calls)).toHaveLength(2)
    expect(qa(view.container, '.gantt-panel-row')).toHaveLength(5)
  })

  it('reports focus write failures and keeps the previous focus', async () => {
    const { view } = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
      [FOCUS_SET]: () => jsonResponse({ ok: false, error: 'focus is locked' }, 409),
    })

    click(panelRow(view, 'n2'))
    await flush()

    expect(text(view.container, '.gantt-panel-error')).toBe('Could not update the focus. focus is locked')
    expect(text(view.container, '.gantt-panel-chip-ref')).toBe('1.1')

    view.unmount()
    const exploding = await renderPanel({
      [FOCUS_SET]: () => Promise.reject('focus exploded'),
    })
    click(panelRow(exploding.view, 'n1'))
    await flush()
    expect(text(exploding.view.container, '.gantt-panel-error')).toBe('Could not update the focus. focus exploded')
  })

  it('reports a focus restore failure without hiding the tree', async () => {
    const { view } = await renderPanel({
      [FOCUS]: () => Promise.reject('focus offline'),
    })

    expect(text(view.container, '.gantt-panel-error')).toBe('Could not update the focus. focus offline')
    expect(qa(view.container, '.gantt-panel-row')).toHaveLength(5)
  })

  it('renders the Chinese dictionary and hides no row content', async () => {
    const { view } = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
      [TRAJECTORY]: () => jsonResponse({
        ok: true,
        events: [{
          id: 'zh-1',
          taskId: 'n1',
          action: 'create',
          sessionId: 'session-zh',
          turn: 3,
          detail: '从复盘里拆出来',
          at: '2026-11-16T06:05:00.000Z',
        }],
      }),
    }, { locale: 'zh' })
    await flush()

    expect(text(view.container, '.gantt-panel-focus-label')).toBe('聚焦任务')
    expect(text(view.container, '.gantt-panel-kind')).toBe('支线')
    expect(q(view.container, 'button[aria-label="刷新任务树"]')).not.toBeNull()
    expect(buttonByText(view.container, '取消聚焦')).not.toBeNull()
    expect(text(view.container, '.gantt-panel-trajectory-title')).toBe('推进轨迹')
    expect(text(view.container, '.gantt-panel-trajectory-action')).toBe('创建')
    expect(text(view.container, '.gantt-panel-trajectory-turn')).toBe('轮次 3')
  })
})

describe('focused task trajectory', () => {
  it('loads the trajectory for the focused task and renders at most five events', async () => {
    const { calls, view } = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
      [TRAJECTORY]: () => jsonResponse({ ok: true, events: TRAJECTORY_EVENTS }),
    })
    await flush()

    expect(trajectoryCalls(calls)).toHaveLength(1)
    expect(trajectoryCalls(calls)[0].path).toBe('api/gantt/trajectory?taskId=n1&limit=5')
    const section = q(view.container, '.gantt-panel-trajectory')
    expect(section).not.toBeNull()
    expect(text(section, '.gantt-panel-trajectory-title')).toBe('Trajectory')

    const panel = q(view.container, '.gantt-panel')
    const children = [...panel.children]
    expect(children.indexOf(section)).toBeGreaterThan(children.indexOf(q(panel, 'header')))
    expect(children.indexOf(section)).toBeLessThan(children.indexOf(q(panel, '.gantt-panel-body')))

    const rows = qa(section, '.gantt-panel-trajectory-row')
    expect(rows).toHaveLength(5)
    expect(rows.map(rowElement => rowElement.getAttribute('data-action')))
      .toEqual(['complete', 'update', 'decompose', 'create', 'update'])
    expect(qa(section, '.gantt-panel-trajectory-action').map(element => element.textContent))
      .toEqual(['Completed', 'Updated', 'Decomposed', 'Created', 'Updated'])
    expect(text(rows[0], '.gantt-panel-trajectory-turn')).toBe('Turn 12')
    expect(text(rows[1], '.gantt-panel-trajectory-turn')).toBeNull()
    expect(text(rows[2], '.gantt-panel-trajectory-turn')).toBe('Turn 3')
    expect(text(rows[0], '.gantt-panel-trajectory-time')).toBe('06:05')
    expect(text(rows[0], '.gantt-panel-trajectory-detail')).toBe('merged to main')
    expect(text(rows[2], '.gantt-panel-trajectory-detail')).toBe('split into 3')
    expect(rows[0].getAttribute('title')).toBe('session-abcdef-long')
    expect(text(rows[3], '.gantt-panel-trajectory-time')).toBe('22:00')
    expect(text(rows[0], '.gantt-panel-trajectory-session')).toBe('Merged PR（abcdef-l）')
    expect(text(rows[1], '.gantt-panel-trajectory-session')).toBe('1')
  })

  it('opens the recorded conversation from a trajectory row', async () => {
    const opened = []
    const { view } = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
      [TRAJECTORY]: () => jsonResponse({ ok: true, events: TRAJECTORY_EVENTS }),
    }, {
      services: {
        betterSidebar: fakeSidebarService(),
        uiWorkspace: { openSession: sessionId => opened.push(sessionId) },
      },
    })
    await flush()

    const buttons = qa(view.container, 'button.gantt-panel-trajectory-session')
    expect(buttons).toHaveLength(5)
    expect(buttons[0].getAttribute('aria-label')).toBe('Open conversation')
    click(buttons[0])
    expect(opened).toEqual(['session-abcdef-long'])
  })

  it('hides the section when the focused task has no events', async () => {
    const empty = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
    })
    await flush()
    expect(q(empty.view.container, '.gantt-panel-trajectory')).toBeNull()
    empty.view.unmount()

    const missing = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
      [TRAJECTORY]: () => jsonResponse({ ok: true }),
    })
    await flush()
    expect(q(missing.view.container, '.gantt-panel-trajectory')).toBeNull()
  })

  it('shows a non-blocking error line when the trajectory fails', async () => {
    const failing = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
      [TRAJECTORY]: () => jsonResponse({ ok: false, error: 'task not found' }, 404),
    })
    await flush()

    expect(text(failing.view.container, '.gantt-panel-trajectory-error'))
      .toBe('Could not load the trajectory. task not found')
    expect(qa(failing.view.container, '.gantt-panel-trajectory-row')).toHaveLength(0)
    expect(qa(failing.view.container, '.gantt-panel-row')).toHaveLength(5)
    failing.view.unmount()

    const exploding = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
      [TRAJECTORY]: () => Promise.reject('trajectory exploded'),
    })
    await flush()
    expect(text(exploding.view.container, '.gantt-panel-trajectory-error'))
      .toBe('Could not load the trajectory. trajectory exploded')
  })

  it('refetches on refresh, window focus, and becoming visible, but never while hidden', async () => {
    const { app, tab, calls, view } = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
      [TRAJECTORY]: () => jsonResponse({ ok: true, events: [TRAJECTORY_EVENTS[0]] }),
    })
    await flush()
    expect(trajectoryCalls(calls)).toHaveLength(1)

    click(q(view.container, 'button[aria-label="Refresh tree"]'))
    await flush()
    expect(treeCalls(calls)).toHaveLength(2)
    expect(trajectoryCalls(calls)).toHaveLength(2)

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(trajectoryCalls(calls)).toHaveLength(3)

    view.rerender(panelElement(tab, app, false))
    await flush()
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(trajectoryCalls(calls)).toHaveLength(3)

    view.rerender(panelElement(tab, app, true))
    await flush()
    expect(trajectoryCalls(calls)).toHaveLength(4)

    // No polling timer: the count stays put when nothing changes.
    await flush()
    expect(trajectoryCalls(calls)).toHaveLength(4)
  })

  it('ignores a stale trajectory result after the focus changes', async () => {
    const first = deferred()
    let requests = 0
    const { calls, view } = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
      [TRAJECTORY]: () => {
        requests += 1
        if (requests === 1) return first.promise
        return jsonResponse({
          ok: true,
          events: [{
            id: 'e9',
            taskId: 'n2',
            action: 'update',
            sessionId: 'session-9',
            turn: 4,
            detail: 'moved ahead',
            at: '2026-11-16T07:00:00.000Z',
          }],
        })
      },
    })
    await flush()
    expect(trajectoryCalls(calls)).toHaveLength(1)

    click(panelRow(view, 'n2'))
    await flush()
    expect(trajectoryCalls(calls)).toHaveLength(2)
    expect(text(view.container, '.gantt-panel-trajectory-action')).toBe('Updated')

    first.resolve(jsonResponse({ ok: true, events: [TRAJECTORY_EVENTS[0]] }))
    await flush()
    expect(text(view.container, '.gantt-panel-trajectory-action')).toBe('Updated')
    expect(text(view.container, '.gantt-panel-trajectory-detail')).toBe('moved ahead')
  })

  it('drops a late trajectory failure after unmount', async () => {
    const late = deferred()
    const fetchState = installFetch({
      [TREE]: () => jsonResponse(unifiedTreePayload()),
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
      [TRAJECTORY]: () => late.promise,
    })
    const { app, tab } = panelApp()
    const view = mount(panelElement(tab, app))
    await flush()

    view.unmount()
    late.reject(new Error('late trajectory'))
    await flush()

    expect(trajectoryCalls(fetchState.calls)).toHaveLength(1)
  })

  it('tolerates missing timestamps and hides the trajectory when the focus clears', async () => {
    const { view } = await renderPanel({
      [FOCUS]: () => jsonResponse({ ok: true, taskId: 'n1' }),
      [TRAJECTORY]: () => jsonResponse({
        ok: true,
        events: [
          { id: 't1', taskId: 'n1', action: 'update', sessionId: 's-a', turn: null, detail: '', at: '' },
          { id: 't2', taskId: 'n1', action: 'update', sessionId: 's-b', turn: null, detail: '', at: 'not-a-date' },
        ],
      }),
    })
    await flush()

    const rows = qa(view.container, '.gantt-panel-trajectory-row')
    expect(rows).toHaveLength(2)
    expect(text(rows[0], '.gantt-panel-trajectory-time')).toBe('')
    expect(text(rows[1], '.gantt-panel-trajectory-time')).toBe('')

    click(buttonByText(view.container, 'Clear focus'))
    await flush()
    expect(q(view.container, '.gantt-panel-trajectory')).toBeNull()
  })
})
