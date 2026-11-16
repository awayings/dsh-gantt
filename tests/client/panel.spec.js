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

afterEach(unmountAll)

function panelApp(options = {}) {
  const app = setupApp({ services: { betterSidebar: fakeSidebarService() }, ...options })
  return { app, tab: app.sidebarTabs()[0] }
}

function panelElement(tab, app, visible = true) {
  return createElement(tab.component, { ctx: app.ctx, scope: { sessionId: 's1' }, visible })
}

async function renderPanel(routes = {}, options = {}) {
  const fetchState = installFetch({
    [TREE]: () => jsonResponse(unifiedTreePayload()),
    [FOCUS]: () => jsonResponse({ ok: true, taskId: null }),
    [FOCUS_SET]: call => jsonResponse({ ok: true, taskId: requestBody(call).taskId }),
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

describe('better-sidebar registration', () => {
  it('registers the Gantt tab with the sidebar service', () => {
    const { app, tab } = panelApp()

    expect(app.sidebarTabs()).toHaveLength(1)
    expect(tab).toMatchObject({ id: 'gantt', order: 22, single: true })
    expect(tab.title()).toBe('Task Gantt')
    expect(tab.description()).toBe(
      'Focus a task for this conversation; the compact tree tracks status at a glance.',
    )
    expect(typeof tab.component).toBe('function')

    app.dispose()
    expect(app.sidebarTabs()).toHaveLength(0)
  })

  it('localizes the tab title and description', () => {
    const { tab } = panelApp({ locale: 'zh' })

    expect(tab.title()).toBe('任务甘特图')
    expect(tab.description()).toBe('为当前对话聚焦任务；紧凑任务树随时显示状态。')
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
    }, { locale: 'zh' })

    expect(text(view.container, '.gantt-panel-focus-label')).toBe('聚焦任务')
    expect(text(view.container, '.gantt-panel-kind')).toBe('支线')
    expect(q(view.container, 'button[aria-label="刷新任务树"]')).not.toBeNull()
    expect(buttonByText(view.container, '取消聚焦')).not.toBeNull()
  })
})
