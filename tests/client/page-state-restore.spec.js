// The Gantt page keeps its depth, filter, folded tasks and pane offsets across
// visits. These cases wire the real page to the real page-state module: what a
// mount restores, what a gesture persists, and how hide/refresh/unmount paths
// keep the record honest.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import {
  buttonByText,
  click,
  flush,
  flushMicrotasks,
  installFetch,
  jsonResponse,
  mount,
  q,
  qa,
  setupApp,
  unmountAll,
} from './harness.js'
import { treePayload } from './fixtures.js'
import { PAGE_STATE_KEY, PAGE_STATE_VERSION } from '../../src/client/page-state.js'

const TREE = 'api/gantt/tree'
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
    ...overrides,
  }))
}

/** The parsed record currently stored under the page-state key. */
function stored() {
  const raw = localStorage.getItem(PAGE_STATE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

/** Mount the registered main page against a stubbed tree and settle it. */
async function renderPage(options = {}) {
  const fetchState = installFetch({ [TREE]: () => jsonResponse(treePayload()) })
  const app = setupApp()
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

  it('does not remember the timeline window', async () => {
    const { view } = await renderPage()
    const before = stored()

    click(buttonByText(view.container, 'Month'))
    click(q(view.container, '[aria-label="Previous window"]'))

    expect(stored()).toEqual(before)
    expect(stored()).not.toHaveProperty('scale')
    expect(stored()).not.toHaveProperty('anchor')
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
