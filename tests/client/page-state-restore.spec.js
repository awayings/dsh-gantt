// The Gantt page keeps the whole view it last showed across visits: depth,
// filter, folded tasks, pane offsets, timeline scale and window, the
// highlighted task, the in-page work panel and work mode. These cases wire the
// real page to the real page-state module: what a mount restores, what a
// gesture persists, and how hide/refresh/unmount paths keep the record honest.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import {
  buttonByText,
  click,
  dialog,
  fakeSidebarService,
  flush,
  flushMicrotasks,
  installFetch,
  jsonResponse,
  mount,
  q,
  qa,
  row,
  setupApp,
  text,
  unmountAll,
} from './harness.js'
import { treePayload } from './fixtures.js'
import { resetAgentNames } from '../../src/client/agent-labels.js'
import { LEGACY_WORK_MODE_KEY, PAGE_STATE_KEY, PAGE_STATE_VERSION } from '../../src/client/page-state.js'

const TREE = 'api/gantt/tree'
const WORK = 'api/gantt/work'
const SKILLS = 'api/gantt/work/skills'
const TEAM = 'api/gantt/work/team'
const TRAJECTORY = 'api/gantt/trajectory'
const FOCUS = 'api/gantt/focus/set'
const AGENTS = 'api/gantt/agents'
const WORK_CWD = '/data/home/ws-plugin'
const OFFSETS = ['scrollTop', 'scrollLeft']

// jsdom disables the pane's scroll offsets: its scrollTop/scrollLeft are
// getter-only and always read 0, so a write from the page cannot be observed.
// Replace them with patchable accessors on HTMLElement.prototype for each case
// and put the original descriptors back afterwards.
const offsetDescriptors = OFFSETS.map(name => ({
  name,
  descriptor: Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
}))

function installScrollOffsets() {
  for (const name of OFFSETS) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get() {
        return /** @type {any} */ (this).__offsets?.[name] ?? 0
      },
      set(value) {
        const element = /** @type {any} */ (this)
        element.__offsets = { ...element.__offsets, [name]: value }
      },
    })
  }
}

function restoreScrollOffsets() {
  for (const { name, descriptor } of offsetDescriptors) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, name)
  }
}

beforeEach(installScrollOffsets)

afterEach(() => {
  unmountAll()
  restoreScrollOffsets()
})

/** Store a complete record the way an earlier visit would have left it. */
function seed(overrides = {}) {
  localStorage.setItem(PAGE_STATE_KEY, JSON.stringify({
    v: PAGE_STATE_VERSION,
    level: 99,
    filter: 'all',
    collapsed: [],
    scrollTop: 0,
    scrollLeft: 0,
    scale: 'week',
    anchor: null,
    selectedId: null,
    panelTaskId: null,
    panelTab: 'task',
    workMode: false,
    ...overrides,
  }))
}

/** The parsed record currently stored under the page-state key. */
function stored() {
  const raw = localStorage.getItem(PAGE_STATE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

// The task payload the in-page panel fetches; its title is what the panel chip
// renders, so a restored panel is observable without reading client state.
const PANEL_TASK = {
  id: 'c1',
  number: '1.1',
  ref: '1.1',
  title: 'Write spec',
  status: 'done',
  progress: 100,
  doneWhen: 'spec reviewed',
}

const WORK_PAYLOAD = {
  ok: true,
  cwd: WORK_CWD,
  task: PANEL_TASK,
  sessionId: null,
}

const SESSION_LIST = { ids: [], phase: 'ready', byId: {} }

/** The host services work mode and its in-page panel resolve through `ctx.get`. */
function workServices() {
  return {
    sessions: {
      create: async () => 'session-created',
      list: { getSnapshot: () => SESSION_LIST },
      retain: () => ({ ready: Promise.resolve(), release: () => {} }),
      scope: () => ({ get: () => undefined }),
    },
    uiWorkspace: { openSession: () => {} },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', path: WORK_CWD }] }) } },
    betterSidebar: fakeSidebarService(),
  }
}

/** Every endpoint the in-page work panel reads while it renders. */
function workRoutes() {
  return {
    [WORK]: () => jsonResponse(WORK_PAYLOAD),
    [SKILLS]: () => jsonResponse({ ok: true, available: true, skills: [] }),
    [TEAM]: () => jsonResponse({ ok: true, available: true, agents: [] }),
    [TRAJECTORY]: () => jsonResponse({ ok: true, events: [] }),
    [AGENTS]: () => jsonResponse({ ok: true, agents: [] }),
  }
}

/** Mount the registered main page against a stubbed tree and settle it. */
async function renderPage(options = {}) {
  const fetchState = installFetch({ [TREE]: () => jsonResponse(treePayload()), ...(options.routes ?? {}) })
  const app = setupApp({ services: options.services })
  const view = mount(createElement(app.page().component))
  if (options.fakeTimers) await flushMicrotasks()
  else await flush()
  return { ...fetchState, app, view }
}

/** Accessible labels of the rendered rows, in tree order. */
function rowLabels(container) {
  return qa(container, '.gantt-row').map(element => element.getAttribute('aria-label'))
}

/** The scrolling pane that carries both restored offsets. */
function paneOf(view) {
  return q(view.container, '.gantt-main')
}

/** Dispatch a user scroll of the pane at the given offsets. */
function scrollPane(pane, top, left) {
  act(() => {
    pane.scrollTop = top
    pane.scrollLeft = left
    pane.dispatchEvent(new Event('scroll'))
  })
}

/** The in-page task panel, or null when work mode shows none. */
function panel(view) {
  return q(view.container, '.gantt-task-panel')
}

/** One sub-tab button of the in-page work panel. */
function workTab(view, name) {
  return q(view.container, `.gantt-workbench-tabs [data-work-tab="${name}"]`)
}

describe('restoring a saved view', () => {
  it('restores the saved depth, filter, folded task and pane offsets', async () => {
    seed({ level: 2, filter: 'unfinished', collapsed: ['p1'], scrollTop: 180, scrollLeft: 24 })

    const { view } = await renderPage()

    expect(q(view.container, '[data-level="2"]').getAttribute('data-active')).toBe('true')
    expect(q(view.container, '[data-filter="unfinished"]').getAttribute('data-active')).toBe('true')
    expect(rowLabels(view.container)).toEqual([
      '1 Release 2.0',
      '2 Launch',
      '2.1 Announce',
      '3 Later',
    ])
    const chevron = q(view.container, '.gantt-row[data-task-id="p1"] .gantt-chevron')
    expect(chevron.getAttribute('aria-expanded')).toBe('false')
    const pane = paneOf(view)
    expect(pane.scrollTop).toBe(180)
    expect(pane.scrollLeft).toBe(24)
  })

  it('starts at the defaults and stays interactive with no saved view', async () => {
    const { view } = await renderPage()

    expect(q(view.container, '[data-filter="all"]').getAttribute('data-active')).toBe('true')
    expect(q(view.container, '[data-level="99"]').getAttribute('data-active')).toBe('true')
    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
    expect(paneOf(view).scrollTop).toBe(0)

    click(q(view.container, '[data-level="1"]'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(3)
    expect(stored()).toMatchObject({ v: PAGE_STATE_VERSION, level: 1, filter: 'all', collapsed: ['p1', 'p2'] })
  })

  it('starts at the defaults for a corrupted record', async () => {
    localStorage.setItem(PAGE_STATE_KEY, '{not json')

    const { view } = await renderPage()

    expect(q(view.container, '[data-filter="all"]').getAttribute('data-active')).toBe('true')
    expect(q(view.container, '[data-level="99"]').getAttribute('data-active')).toBe('true')
    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
    expect(paneOf(view).scrollTop).toBe(0)
  })

  it('carries a version 1 record into the new record', async () => {
    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify({
      v: 1,
      level: 2,
      filter: 'done',
      collapsed: ['p1'],
      scrollTop: 200,
      scrollLeft: 30,
    }))

    const { view } = await renderPage()

    expect(q(view.container, '[data-level="2"]').getAttribute('data-active')).toBe('true')
    expect(q(view.container, '[data-filter="done"]').getAttribute('data-active')).toBe('true')
    expect(buttonByText(view.container, 'Week').getAttribute('data-active')).toBe('true')
    expect(q(view.container, '.gantt-row[data-task-id="p1"] .gantt-chevron').getAttribute('aria-expanded')).toBe('false')
    expect(paneOf(view).scrollTop).toBe(200)
    expect(paneOf(view).scrollLeft).toBe(30)
    expect(stored()).toMatchObject({
      v: PAGE_STATE_VERSION,
      level: 2,
      filter: 'done',
      collapsed: ['p1'],
      scrollTop: 200,
      scrollLeft: 30,
      scale: 'week',
      anchor: '2026-11-18',
      selectedId: null,
      panelTaskId: null,
      panelTab: 'task',
      workMode: false,
    })
  })

  it('keeps the page usable when storage refuses reads and writes', async () => {
    const denied = () => {
      throw new Error('denied')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied)

    const { view } = await renderPage()

    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
    expect(q(view.container, '[data-filter="all"]').getAttribute('data-active')).toBe('true')
    click(q(view.container, '[data-filter="done"]'))
    expect(rowLabels(view.container)).toEqual(['1 Release 2.0', '1.1 Write spec'])
  })

  it('waits for rows before restoring a saved view that opens empty', async () => {
    seed({ filter: 'today', scrollTop: 90, scrollLeft: 12 })

    const { view } = await renderPage()

    expect(q(view.container, '.gantt-filter-empty')).not.toBeNull()
    expect(paneOf(view)).toBeNull()

    click(q(view.container, '[data-filter="all"]'))
    const pane = paneOf(view)
    expect(pane.scrollTop).toBe(90)
    expect(pane.scrollLeft).toBe(12)
  })
})

describe('restoring the timeline window', () => {
  it('restores the saved monthly scale and window anchor instead of the task day', async () => {
    seed({ scale: 'month', anchor: '2026-01-15' })

    const { view } = await renderPage()

    expect(buttonByText(view.container, 'Month').getAttribute('data-active')).toBe('true')
    expect(text(view.container, '.gantt-window-scale')).toBe('Monthly view')
    // The saved anchor is outside today's window, so the today marker is gone:
    // the task day did not overwrite the restored window.
    expect(text(view.container, '.gantt-window-label')).toBe('Oct 2025 – Sep 2026')
    expect(q(view.container, '.gantt-today-line')).toBeNull()
    expect(stored()).toMatchObject({ scale: 'month', anchor: '2026-01-15' })
  })

  it('restores a saved weekly anchor and keeps the today marker it contains', async () => {
    seed({ scale: 'week', anchor: '2026-11-04' })

    const { view } = await renderPage()

    expect(buttonByText(view.container, 'Week').getAttribute('data-active')).toBe('true')
    expect(text(view.container, '.gantt-window-scale')).toBe('Weekly view')
    expect(text(view.container, '.gantt-window-label')).toBe('Oct 26, 2026 – Nov 22, 2026')
    expect(qa(view.container, '.gantt-today-line')).toHaveLength(1)
    expect(qa(view.container, '.gantt-unit-cell[data-today="true"]')).toHaveLength(1)
    expect(stored()).toMatchObject({ scale: 'week', anchor: '2026-11-04' })
  })

  it('persists the anchor after a window step and after jumping back to today', async () => {
    seed({ scale: 'month', anchor: '2026-01-15' })

    const { view } = await renderPage()

    click(q(view.container, 'button[aria-label="Next window"]'))
    expect(text(view.container, '.gantt-window-label')).toBe('Jan 2026 – Dec 2026')
    expect(stored()).toMatchObject({ scale: 'month', anchor: '2026-04-15' })

    click(q(view.container, 'button[aria-label="Previous window"]'))
    expect(text(view.container, '.gantt-window-label')).toBe('Oct 2025 – Sep 2026')
    expect(stored()).toMatchObject({ scale: 'month', anchor: '2026-01-15' })

    click(buttonByText(view.container, 'Today'))
    expect(text(view.container, '.gantt-window-label')).toBe('Aug 2026 – Jul 2027')
    expect(qa(view.container, '.gantt-today-line')).toHaveLength(1)
    expect(stored()).toMatchObject({ scale: 'month', anchor: '2026-11-18' })
  })
})

describe('restoring the highlight', () => {
  it('restores the saved selected task', async () => {
    seed({ selectedId: 'c1' })

    const { view } = await renderPage()

    expect(row(view.container, '1.1 Write spec').getAttribute('data-selected')).toBe('true')
    expect(qa(view.container, '.gantt-row[data-selected="true"]')).toHaveLength(1)
    expect(stored()).toMatchObject({ selectedId: 'c1' })
  })

  it('drops a saved selection whose task no longer exists', async () => {
    seed({ selectedId: 'ghost' })

    const { view } = await renderPage()

    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
    expect(qa(view.container, '.gantt-row[data-selected="true"]')).toHaveLength(0)
    expect(stored()).toMatchObject({ selectedId: null })
  })

  it('moves the highlight to the task the user activates', async () => {
    seed({ selectedId: 'c1' })

    const { view } = await renderPage()

    click(row(view.container, '1.2 Build UI'))
    await flush()
    expect(dialog(view.container)).not.toBeNull()
    expect(row(view.container, '1.2 Build UI').getAttribute('data-selected')).toBe('true')
    expect(row(view.container, '1.1 Write spec').getAttribute('data-selected')).toBeNull()
    expect(stored()).toMatchObject({ selectedId: 'c2' })
  })

  it('keeps a restored highlight that a fold hides without crashing', async () => {
    seed({ selectedId: 'c1', collapsed: ['p1'] })

    const { view } = await renderPage()

    expect(q(view.container, '.gantt-row[data-task-id="c1"]')).toBeNull()
    expect(qa(view.container, '.gantt-row')).toHaveLength(4)

    click(q(view.container, '.gantt-row[data-task-id="p1"] .gantt-chevron'))
    expect(row(view.container, '1.1 Write spec').getAttribute('data-selected')).toBe('true')
  })

  it('keeps a restored highlight that the filter hides without crashing', async () => {
    seed({ selectedId: 'c1', filter: 'unfinished' })

    const { view } = await renderPage()

    expect(q(view.container, '.gantt-row[data-task-id="c1"]')).toBeNull()
    expect(qa(view.container, '.gantt-row')).toHaveLength(5)
    expect(qa(view.container, '.gantt-row[data-selected="true"]')).toHaveLength(0)
    expect(stored()).toMatchObject({ filter: 'unfinished', selectedId: 'c1' })
  })
})

describe('restoring the work panel', () => {
  beforeEach(resetAgentNames)

  it('restores the panel task and its sub-tab without focusing the conversation', async () => {
    seed({ workMode: true, panelTaskId: 'c1', panelTab: 'skills' })

    const { view, calls } = await renderPage({ services: workServices(), routes: workRoutes() })

    expect(panel(view)).not.toBeNull()
    expect(panel(view).getAttribute('data-panel')).toBe('work-task')
    expect(q(view.container, '.gantt-body[data-panel="work"]')).not.toBeNull()
    expect(text(view.container, '.gantt-workbench-chip-title')).toBe('Write spec')
    expect(workTab(view, 'skills').getAttribute('data-active')).toBe('true')
    expect(workTab(view, 'task').getAttribute('data-active')).toBeNull()
    expect(calls.filter(call => call.path === FOCUS)).toHaveLength(0)
  })

  it('restores no panel while work mode is off and clears the panel task', async () => {
    seed({ workMode: false, panelTaskId: 'c1' })

    const { view } = await renderPage({ services: workServices(), routes: workRoutes() })

    expect(panel(view)).toBeNull()
    expect(stored()).toMatchObject({ workMode: false, panelTaskId: null })
  })

  it('drops a restored panel whose task no longer exists', async () => {
    seed({ workMode: true, panelTaskId: 'ghost' })

    const { view } = await renderPage({ services: workServices(), routes: workRoutes() })

    expect(panel(view)).toBeNull()
    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
    expect(stored()).toMatchObject({ workMode: true, panelTaskId: null })
  })

  it('clears the stored panel task when the panel is closed', async () => {
    seed({ workMode: true, panelTaskId: 'c1', panelTab: 'team' })

    const { view } = await renderPage({ services: workServices(), routes: workRoutes() })
    expect(panel(view)).not.toBeNull()

    click(q(panel(view), 'button[data-action="close-panel"]'))
    expect(panel(view)).toBeNull()
    expect(stored()).toMatchObject({ workMode: true, panelTaskId: null, panelTab: 'team' })
  })

  it('stores the sub-tab the user switches to', async () => {
    seed({ workMode: true, panelTaskId: 'c1' })

    const { view } = await renderPage({ services: workServices(), routes: workRoutes() })
    expect(workTab(view, 'task').getAttribute('data-active')).toBe('true')

    click(workTab(view, 'skills'))
    expect(workTab(view, 'skills').getAttribute('data-active')).toBe('true')
    expect(stored()).toMatchObject({ panelTaskId: 'c1', panelTab: 'skills' })
  })
})

describe('working mode', () => {
  beforeEach(resetAgentNames)

  it('records the toggle and restores it on the next mount', async () => {
    const { view, app, calls } = await renderPage({ services: workServices(), routes: workRoutes() })

    const toggle = q(view.container, 'button[data-action="work-mode"]')
    expect(toggle.disabled).toBe(false)
    click(toggle)
    expect(toggle.getAttribute('data-active')).toBe('true')
    expect(stored()).toMatchObject({ v: PAGE_STATE_VERSION, workMode: true })
    expect(calls.map(call => call.path)).toEqual([TREE])

    view.unmount()
    const remounted = mount(createElement(app.page().component))
    await flush()
    expect(q(remounted.container, 'button[data-action="work-mode"]').getAttribute('data-active')).toBe('true')

    click(q(remounted.container, 'button[data-action="work-mode"]'))
    expect(stored()).toMatchObject({ v: PAGE_STATE_VERSION, workMode: false })
  })

  it('migrates the standalone switch into the record on the first write', async () => {
    localStorage.setItem(LEGACY_WORK_MODE_KEY, '1')

    const { view } = await renderPage({ services: workServices(), routes: workRoutes() })

    expect(q(view.container, 'button[data-action="work-mode"]').getAttribute('data-active')).toBe('true')
    expect(stored()).toMatchObject({ v: PAGE_STATE_VERSION, workMode: true })
    expect(localStorage.getItem(LEGACY_WORK_MODE_KEY)).toBeNull()
  })
})

describe('persisting the view', () => {
  it('writes filter, depth and folded tasks as the view changes', async () => {
    const { view } = await renderPage()

    click(q(view.container, '[data-filter="unfinished"]'))
    expect(stored()).toMatchObject({ v: PAGE_STATE_VERSION, level: 99, filter: 'unfinished', collapsed: [] })

    click(q(view.container, '[data-level="2"]'))
    expect(stored()).toMatchObject({ v: PAGE_STATE_VERSION, level: 2, filter: 'unfinished' })

    click(q(view.container, '.gantt-row[data-task-id="p1"] .gantt-chevron'))
    expect(stored()).toMatchObject({
      v: PAGE_STATE_VERSION,
      level: 2,
      filter: 'unfinished',
      collapsed: ['p1'],
    })
  })

  it('remembers the timeline scale and the stepped window anchor', async () => {
    const { view } = await renderPage()
    expect(stored()).toMatchObject({ scale: 'week', anchor: '2026-11-18' })

    click(buttonByText(view.container, 'Month'))
    expect(stored()).toMatchObject({ scale: 'month', anchor: '2026-11-18' })

    click(q(view.container, 'button[aria-label="Previous window"]'))
    expect(text(view.container, '.gantt-window-label')).toBe('May 2026 – Apr 2027')
    expect(stored()).toMatchObject({ scale: 'month', anchor: '2026-08-18' })
  })

  it('persists pane offsets once a scroll gesture settles', async () => {
    vi.useFakeTimers()
    const { view } = await renderPage({ fakeTimers: true })
    const pane = paneOf(view)
    expect(stored().scrollTop).toBe(0)

    scrollPane(pane, 120, 18)
    scrollPane(pane, 260, 42)
    act(() => {
      vi.advanceTimersByTime(149)
    })
    expect(stored().scrollTop).toBe(0)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(stored()).toMatchObject({ v: PAGE_STATE_VERSION, scrollTop: 260, scrollLeft: 42 })
  })

  it('flushes the latest offsets on pagehide before the debounce fires', async () => {
    vi.useFakeTimers()
    const { view } = await renderPage({ fakeTimers: true })
    const pane = paneOf(view)

    scrollPane(pane, 300, 28)
    expect(vi.getTimerCount()).toBe(1)

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(stored()).toMatchObject({ scrollTop: 300, scrollLeft: 28 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('flushes the latest offsets when the page unmounts and drops the timer', async () => {
    vi.useFakeTimers()
    const { view } = await renderPage({ fakeTimers: true })
    const pane = paneOf(view)

    scrollPane(pane, 55, 6)
    expect(stored().scrollTop).toBe(0)

    view.unmount()
    expect(stored()).toMatchObject({ scrollTop: 55, scrollLeft: 6 })
    expect(vi.getTimerCount()).toBe(0)

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(stored()).toMatchObject({ scrollTop: 55, scrollLeft: 6 })
  })

  it('restores the offsets only once, so a refresh keeps a user scroll', async () => {
    seed({ scrollTop: 120, scrollLeft: 15 })

    const { calls, view } = await renderPage()
    const pane = paneOf(view)
    expect(pane.scrollTop).toBe(120)
    expect(pane.scrollLeft).toBe(15)

    scrollPane(pane, 480, 33)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()

    expect(calls.filter(call => call.path === TREE)).toHaveLength(2)
    expect(paneOf(view)).toBe(pane)
    expect(pane.scrollTop).toBe(480)
    expect(pane.scrollLeft).toBe(33)
  })
})
