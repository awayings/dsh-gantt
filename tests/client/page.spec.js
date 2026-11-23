// Page-level behavior of the Gantt client: loading/empty/error states, tree
// rendering, the timeline window controls, status cycling, and toasts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import {
  buttonByText,
  click,
  deferred,
  dialog,
  flush,
  flushMicrotasks,
  installFetch,
  jsonResponse,
  keydown,
  mount,
  mouseEvent,
  q,
  qa,
  requestBody,
  row,
  setupApp,
  text,
  unmountAll,
  unparsableResponse,
} from './harness.js'
import { emptyTreePayload, makeTree, treePayload } from './fixtures.js'

const TREE = 'api/gantt/tree'
const STATUS = 'api/gantt/task/status'
const SEED = 'api/gantt/seed'
const AGENTS = 'api/gantt/agents'

afterEach(unmountAll)

/** Fake uiSession service exposing one mutable activity snapshot. */
/** Mount the registered main page against a stubbed fetch table and settle it. */
async function renderPage(routes) {
  const fetchState = installFetch({
    [TREE]: () => jsonResponse(treePayload()),
    [STATUS]: () => jsonResponse({ ok: true, task: {} }),
    [AGENTS]: () => jsonResponse({ ok: true, agents: [] }),
    ...routes,
  })
  const app = setupApp()
  const view = mount(createElement(app.page().component))
  await flush()
  return { ...fetchState, app, view }
}

function statusPostBodies(calls) {
  return calls.filter(call => call.path === STATUS).map(requestBody)
}

describe('initial states', () => {
  it('shows the loading spinner until the tree response arrives', async () => {
    const gate = deferred()
    installFetch({ [TREE]: () => gate.promise })
    const app = setupApp()
    const view = mount(createElement(app.page().component))

    expect(text(view.container, '.gantt-center')).toContain('Loading tasks…')
    expect(q(view.container, '.gantt-spinner')).not.toBeNull()
    expect(qa(view.container, '.gantt-row')).toHaveLength(0)

    gate.resolve(jsonResponse(treePayload()))
    await flush()

    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
    expect(q(view.container, '.gantt-spinner')).toBeNull()
  })

  it('renders the empty state and loads demo data from the seed button', async () => {
    let seeded = false
    const { calls, view } = await renderPage({
      [TREE]: () => jsonResponse(seeded ? treePayload() : emptyTreePayload()),
      [SEED]: () => {
        seeded = true
        return jsonResponse({ ok: true, seeded: true })
      },
    })

    expect(text(view.container, '.gantt-empty-title')).toBe('No tasks yet')
    expect(text(view.container, '.gantt-empty-body')).toContain('demo tree')
    expect(qa(view.container, '.gantt-row')).toHaveLength(0)
    expect(text(view.container, '.gantt-stat b')).toBe('0')

    click(buttonByText(view.container, 'Load demo data'))
    await flush()

    const seedCall = calls.find(call => call.path === SEED)
    expect(seedCall.options.method).toBe('POST')
    expect(seedCall.options.body).toBe('{}')
    expect(seedCall.options.headers['content-type']).toBe('application/json')
    expect(text(view.container, '.gantt-toast')).toBe('Demo data loaded')
    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
    expect(text(view.container, '.gantt-window-label')).toContain('Nov')
  })

  it('falls back to zero stats, an empty tree, and today when the payload omits them', async () => {
    const { view } = await renderPage({ [TREE]: () => jsonResponse({ ok: true }) })

    expect(text(view.container, '.gantt-empty-title')).toBe('No tasks yet')
    expect(text(view.container, '.gantt-window-label')).not.toBe('')
    expect(qa(view.container, '.gantt-row')).toHaveLength(0)

    click(buttonByText(view.container, 'Create a task'))
    expect(dialog(view.container)).not.toBeNull()
  })

  it('reports a non-Error seed failure in an error toast', async () => {
    const { view } = await renderPage({
      [TREE]: () => jsonResponse(emptyTreePayload()),
      [SEED]: () => Promise.reject('seed exploded'),
    })

    click(buttonByText(view.container, 'Load demo data'))
    await flush()

    expect(text(view.container, '.gantt-toast')).toBe('seed exploded')
  })

  it('reports a failed seed in an error toast', async () => {
    const { view } = await renderPage({
      [TREE]: () => jsonResponse(emptyTreePayload()),
      [SEED]: () => jsonResponse({ ok: false, error: 'seed refused' }, 409),
    })

    click(buttonByText(view.container, 'Load demo data'))
    await flush()

    const toast = q(view.container, '.gantt-toast')
    expect(toast.textContent).toBe('seed refused')
    expect(toast.getAttribute('data-error')).toBe('true')
  })
})

describe('page info popover', () => {
  it('hides the subtitle behind a closed info button', async () => {
    const { view } = await renderPage({})

    expect(q(view.container, '.gantt-subtitle')).toBeNull()
    const button = q(view.container, 'button.gantt-info-btn')
    expect(button.getAttribute('title')).toBe('About this page')
    expect(button.getAttribute('aria-label')).toBe('About this page')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(q(view.container, '.gantt-info-pop')).toBeNull()
  })

  it('toggles the intro popover from the info button', async () => {
    const { view } = await renderPage({})

    click(q(view.container, 'button[aria-label="About this page"]'))
    expect(text(view.container, '.gantt-info-pop')).toContain('Plan, split, and track')
    expect(q(view.container, 'button[aria-label="About this page"]').getAttribute('aria-expanded')).toBe('true')

    click(q(view.container, 'button[aria-label="About this page"]'))
    expect(q(view.container, '.gantt-info-pop')).toBeNull()
    expect(q(view.container, 'button[aria-label="About this page"]').getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on an outside pointerdown but keeps the popover on an inside one', async () => {
    const { view } = await renderPage({})
    click(q(view.container, '.gantt-info-btn'))

    mouseEvent(q(view.container, '.gantt-info-pop'), 'pointerdown')
    expect(q(view.container, '.gantt-info-pop')).not.toBeNull()

    mouseEvent(document.body, 'pointerdown')
    expect(q(view.container, '.gantt-info-pop')).toBeNull()
  })

  it('closes when a pointerdown does not land on an element', async () => {
    const { view } = await renderPage({})
    click(q(view.container, '.gantt-info-btn'))
    expect(q(view.container, '.gantt-info-pop')).not.toBeNull()

    mouseEvent(document, 'pointerdown')
    expect(q(view.container, '.gantt-info-pop')).toBeNull()
  })

  it('stays open on other keys and closes on Escape', async () => {
    const { view } = await renderPage({})
    click(q(view.container, '.gantt-info-btn'))

    keydown(document, 'a')
    expect(q(view.container, '.gantt-info-pop')).not.toBeNull()

    keydown(document, 'Escape')
    expect(q(view.container, '.gantt-info-pop')).toBeNull()
  })

  it('unmounts cleanly while the popover is open', async () => {
    const { view } = await renderPage({})
    click(q(view.container, '.gantt-info-btn'))
    expect(q(view.container, '.gantt-info-pop')).not.toBeNull()

    expect(() => view.unmount()).not.toThrow()
  })
})

describe('load failures', () => {
  it('shows the error screen and recovers through retry', async () => {
    let attempt = 0
    const { view } = await renderPage({
      [TREE]: () => {
        attempt += 1
        if (attempt === 1) return Promise.reject(new Error('offline'))
        return jsonResponse(treePayload())
      },
    })
    await flush()

    expect(text(view.container, '.gantt-center')).toContain('Could not load tasks')
    expect(text(view.container, '.gantt-center')).toContain('offline')

    click(buttonByText(view.container, 'Retry'))
    await flush()

    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
  })

  it.each([
    ['an error payload', () => jsonResponse({ ok: false, error: 'boom' }, 500), 'boom'],
    ['an unparsable body', () => unparsableResponse(503), 'HTTP 503'],
    ['a missing error message', () => jsonResponse({ ok: false }, 500), 'HTTP 500'],
    ['a non-ok payload with an ok status', () => jsonResponse({ ok: false }, 200), 'HTTP 200'],
  ])('surfaces %s on the error screen', async (_label, makeResponse, message) => {
    const { view } = await renderPage({ [TREE]: makeResponse })
    await flush()

    expect(text(view.container, '.gantt-center')).toContain(message)
  })

  it('ignores an abort error and stays on the loading spinner', async () => {
    const abort = new Error('The operation was aborted.')
    abort.name = 'AbortError'
    const { view } = await renderPage({ [TREE]: () => Promise.reject(abort) })

    expect(text(view.container, '.gantt-center')).toContain('Loading tasks…')
    expect(q(view.container, '.gantt-spinner')).not.toBeNull()
  })

  it('stringifies a non-Error tree rejection', async () => {
    const { view } = await renderPage({ [TREE]: () => Promise.reject('offline') })
    expect(text(view.container, '.gantt-center')).toContain('offline')
  })

  it('ignores a stale tree response that lands after a newer request started', async () => {
    const gate = deferred()
    let attempt = 0
    installFetch({
      [TREE]: () => {
        attempt += 1
        return attempt === 1 ? gate.promise : jsonResponse(treePayload())
      },
    })
    const app = setupApp()
    const view = mount(createElement(app.page().component))

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(qa(view.container, '.gantt-row')).toHaveLength(6)

    gate.resolve(jsonResponse(emptyTreePayload()))
    await flush()
    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
  })

  it('keeps the last tree and shows a banner when a refresh fails', async () => {
    let attempt = 0
    const { view } = await renderPage({
      [TREE]: () => {
        attempt += 1
        if (attempt === 2) return jsonResponse({ ok: false, error: 'refresh failed' }, 500)
        return jsonResponse(treePayload())
      },
    })

    click(q(view.container, 'button[aria-label="Refresh"]'))
    await flush()

    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
    expect(text(view.container, '.gantt-banner')).toContain('refresh failed')

    click(buttonByText(view.container, 'Retry'))
    await flush()

    expect(q(view.container, '.gantt-banner')).toBeNull()
    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
  })
})

describe('tree rendering', () => {
  it('renders hierarchical numbers, status pills, bars, and the overdue marker', async () => {
    const { view } = await renderPage({})

    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
    expect(qa(view.container, '.gantt-number').map(element => element.textContent))
      .toEqual(['1', '1.1', '1.2', '2', '2.1', '3'])
    expect(text(view.container, '.gantt-title')).toBe('Task Gantt')
    expect(text(view.container, '.gantt-corner-sub')).toBe('6 tasks')

    const summaryPill = q(row(view.container, '1 Release 2.0'), '.gantt-status')
    expect(summaryPill.getAttribute('data-interactive')).toBeNull()
    expect(summaryPill.getAttribute('title')).toBe('Status is rolled up from subtasks')

    const leafPill = q(row(view.container, '1.1 Write spec'), '.gantt-status')
    expect(leafPill.getAttribute('data-interactive')).toBe('true')
    expect(leafPill.getAttribute('title')).toBe('Click to cycle status')
    expect(leafPill.textContent).toContain('Done')
    expect(q(row(view.container, '1.2 Build UI'), '.gantt-status').textContent).toContain('Blocked')

    const overdueBar = q(row(view.container, '1.2 Build UI'), '.gantt-bar')
    expect(overdueBar.getAttribute('data-overdue')).toBe('true')
    expect(q(row(view.container, '1.1 Write spec'), '.gantt-bar').getAttribute('data-overdue')).toBeNull()
    expect(q(row(view.container, '1 Release 2.0'), '.gantt-bar').getAttribute('data-summary')).toBe('true')
    expect(qa(view.container, '.gantt-bar')).toHaveLength(5)
    expect(text(row(view.container, '1.1 Write spec'), '.gantt-bar-label')).toBe('Write spec')

    expect(qa(view.container, '.gantt-stat b').map(element => element.textContent)).toEqual(['6', '2', '1', '1'])
    expect(text(view.container, '.gantt-stat-progress')).toContain('Completion 45%')
  })

  it('renders task tags as #chips in the metadata row and tolerates a malformed value', async () => {
    const { view } = await renderPage({})
    const chips = qa(row(view.container, '1.1 Write spec'), '.gantt-row-tag')

    expect(chips.map(chip => chip.textContent)).toEqual(['#docs', '#urgent'])
    expect(chips[0].className).toContain('gantt-row-chip')
    expect(chips[0].getAttribute('title')).toBe('Tags: docs')
    expect(qa(row(view.container, '1 Release 2.0'), '.gantt-row-tag')).toHaveLength(0)

    const malformed = treePayload()
    malformed.tasks[0].children[0].tags = 'docs'
    const { view: broken } = await renderPage({ [TREE]: () => jsonResponse(malformed) })
    expect(qa(broken.container, '.gantt-row-tag')).toHaveLength(0)
  })

  it('never renders rows for tasks hidden by the window (bar range null)', async () => {
    const { view } = await renderPage({})
    expect(row(view.container, '3 Later')).not.toBeNull()
    expect(q(row(view.container, '3 Later'), '.gantt-bar')).toBeNull()
  })

  it('collapses and expands summary rows from the chevron', async () => {
    const { view } = await renderPage({})

    click(q(row(view.container, '1 Release 2.0'), '.gantt-chevron'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(4)
    expect(row(view.container, '1.1 Write spec')).toBeNull()
    expect(q(row(view.container, '1 Release 2.0'), '.gantt-chevron').getAttribute('aria-expanded')).toBe('false')
    expect(q(row(view.container, '1 Release 2.0'), '.gantt-chevron').textContent).toBe('▸')

    click(q(row(view.container, '1 Release 2.0'), '.gantt-chevron'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
    expect(q(row(view.container, '1 Release 2.0'), '.gantt-chevron').textContent).toBe('▾')
  })

  it('selects rows with the mouse, Enter, and the bar, but ignores bubbled key events', async () => {
    const { view } = await renderPage({})

    click(row(view.container, '1.1 Write spec'))
    expect(text(view.container, '.gantt-dialog-title')).toBe('Edit task · 1.1')
    expect(row(view.container, '1.1 Write spec').getAttribute('data-selected')).toBe('true')
    click(q(view.container, 'button[aria-label="Close"]'))

    keydown(row(view.container, '3 Later'), 'Enter')
    expect(text(view.container, '.gantt-dialog-title')).toBe('Edit task · 3')
    click(q(view.container, 'button[aria-label="Close"]'))

    keydown(q(row(view.container, '2 Launch'), '.gantt-task-title'), 'Enter')
    expect(dialog(view.container)).toBeNull()

    keydown(row(view.container, '2 Launch'), ' ')
    expect(text(view.container, '.gantt-dialog-title')).toBe('Edit task · 2')
    click(q(view.container, 'button[aria-label="Close"]'))

    keydown(row(view.container, '2 Launch'), 'x')
    expect(dialog(view.container)).toBeNull()

    click(q(row(view.container, '2.1 Announce'), '.gantt-bar'))
    expect(text(view.container, '.gantt-dialog-title')).toBe('Edit task · 2.1')
    await flush()
  })

  it('cycles leaf status through the pill and refreshes the tree', async () => {
    const { calls, view } = await renderPage({})

    click(q(row(view.container, '2.1 Announce'), '.gantt-status'))
    await flush()
    expect(text(view.container, '.gantt-toast')).toBe('Status updated')
    expect(dialog(view.container)).toBeNull()

    click(q(row(view.container, '1.1 Write spec'), '.gantt-status'))
    await flush()
    click(q(row(view.container, '1.2 Build UI'), '.gantt-status'))
    await flush()
    click(q(row(view.container, '3 Later'), '.gantt-status'))
    await flush()

    expect(statusPostBodies(calls)).toEqual([
      { id: 'c3', status: 'in_progress' },
      { id: 'c1', status: 'todo' },
      { id: 'c2', status: 'in_progress' },
      { id: 'p3', status: 'done' },
    ])
    expect(calls.filter(call => call.path === TREE)).toHaveLength(5)
  })

  it('renders unknown statuses with the fallback color and cycles them to todo', async () => {
    const payload = treePayload()
    payload.tasks = [{
      id: 'x1',
      number: '1',
      title: 'Odd',
      status: 'weird',
      progress: 20,
      startDate: '2026-11-10',
      endDate: '2026-11-14',
      hasChildren: false,
      children: [],
      parentId: null,
    }]
    const { calls, view } = await renderPage({ [TREE]: () => jsonResponse(payload) })

    expect(q(view.container, '.gantt-status[data-status="weird"]')).not.toBeNull()
    expect(q(view.container, '.gantt-bar[data-status="weird"]')).not.toBeNull()

    click(q(row(view.container, '1 Odd'), '.gantt-status'))
    await flush()
    expect(statusPostBodies(calls)).toEqual([{ id: 'x1', status: 'todo' }])
  })

  it('reports a non-Error status failure in an error toast', async () => {
    const { view } = await renderPage({ [STATUS]: () => Promise.reject('status exploded') })
    click(q(row(view.container, '2.1 Announce'), '.gantt-status'))
    await flush()
    expect(text(view.container, '.gantt-toast')).toBe('status exploded')
  })

  it('reports a failed status cycle in an error toast', async () => {
    const { view } = await renderPage({
      [STATUS]: () => jsonResponse({ ok: false, error: 'status is locked' }, 409),
    })

    click(q(row(view.container, '2.1 Announce'), '.gantt-status'))
    await flush()

    const toast = q(view.container, '.gantt-toast')
    expect(toast.textContent).toBe('status is locked')
    expect(toast.getAttribute('data-error')).toBe('true')
  })

  it('dismisses a toast after its timeout', async () => {
    const timers = []
    const { view } = await renderPage({})
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay) => {
      timers.push({ callback, delay })
      return /** @type {any} */ (0)
    })

    click(q(row(view.container, '2.1 Announce'), '.gantt-status'))
    await flushMicrotasks()
    expect(text(view.container, '.gantt-toast')).toBe('Status updated')
    expect(timers.at(-1).delay).toBe(2800)

    act(() => {
      timers.at(-1).callback()
    })
    expect(q(view.container, '.gantt-toast')).toBeNull()
  })

  it('marks unshaped idea rows and keeps plain, shaped, or rolled-up rows solid', async () => {
    const tasks = makeTree()
    tasks[1].children[0].inspiration = '#9'
    tasks[0].children[1].status = 'todo'
    tasks[0].children[1].progress = 0
    tasks[2].status = 'todo'
    tasks[2].progress = 0
    tasks[2].inspiration = '#7'
    tasks[2].doneWhen = 'Shipped'
    const { view } = await renderPage({ [TREE]: () => jsonResponse(treePayload({ tasks })) })

    const unshaped = row(view.container, '2.1 Announce')
    expect(unshaped.getAttribute('data-unformed')).toBe('true')
    expect(text(unshaped, '.gantt-row-unformed')).toBe('Unshaped')
    expect(q(unshaped, '.gantt-row-unformed').getAttribute('title'))
      .toBe('A captured idea, not shaped yet: no completion standard. Fill one in to shape the row.')
    expect(q(unshaped, '.gantt-bar').getAttribute('data-unformed')).toBe('true')

    // A plain todo without doneWhen or inspiration and an already-shaped idea
    // both stay solid: doneWhen emptiness alone never marks a row.
    for (const label of ['1.2 Build UI', '3 Later']) {
      const plain = row(view.container, label)
      expect(plain.getAttribute('data-unformed')).toBeNull()
      expect(q(plain, '.gantt-row-unformed')).toBeNull()
    }
    for (const label of ['1 Release 2.0', '1.1 Write spec', '2 Launch']) {
      const shaped = row(view.container, label)
      expect(shaped.getAttribute('data-unformed')).toBeNull()
      expect(q(shaped, '.gantt-row-unformed')).toBeNull()
      // A row outside the timeline window renders no bar at all.
      expect(q(shaped, '.gantt-bar')?.getAttribute('data-unformed') ?? null).toBeNull()
    }
  })
})

describe('timeline window', () => {
  it('renders the weekly window with units, groups, weekends, and the today marker', async () => {
    const { view } = await renderPage({})

    expect(text(view.container, '.gantt-window-scale')).toBe('Weekly view')
    expect(qa(view.container, '.gantt-unit-cell')).toHaveLength(28)
    expect(qa(view.container, '.gantt-group-cell')).toHaveLength(2)
    expect(qa(view.container, '.gantt-unit-cell[data-weekend="true"]')).toHaveLength(8)
    expect(qa(view.container, '.gantt-unit-cell[data-today="true"]')).toHaveLength(1)
    expect(qa(view.container, '.gantt-today-line')).toHaveLength(1)
    expect(qa(view.container, '.gantt-vline[data-strong="true"]').length).toBeGreaterThan(0)
    expect(qa(view.container, '.gantt-vline').length).toBe(27)
  })

  it('switches to the monthly window and steps the anchor', async () => {
    const { view } = await renderPage({})
    const initialLabel = text(view.container, '.gantt-window-label')

    click(buttonByText(view.container, 'Month'))
    expect(text(view.container, '.gantt-window-scale')).toBe('Monthly view')
    expect(qa(view.container, '.gantt-unit-cell')).toHaveLength(12)
    expect(qa(view.container, '.gantt-group-cell')).toHaveLength(2)
    expect(qa(view.container, '.gantt-today-line')).toHaveLength(1)
    const monthLabel = text(view.container, '.gantt-window-label')
    expect(monthLabel).not.toBe(initialLabel)

    click(q(view.container, 'button[aria-label="Next window"]'))
    expect(text(view.container, '.gantt-window-label')).not.toBe(monthLabel)
    click(q(view.container, 'button[aria-label="Previous window"]'))
    expect(text(view.container, '.gantt-window-label')).toBe(monthLabel)

    click(buttonByText(view.container, 'Week'))
    expect(text(view.container, '.gantt-window-scale')).toBe('Weekly view')
    expect(text(view.container, '.gantt-window-label')).toBe(initialLabel)

    click(q(view.container, 'button[aria-label="Previous window"]'))
    const previousLabel = text(view.container, '.gantt-window-label')
    expect(previousLabel).not.toBe(initialLabel)
    click(buttonByText(view.container, 'Today'))
    expect(text(view.container, '.gantt-window-label')).toBe(initialLabel)
  })

  it('drops the today marker once the window scrolls past it', async () => {
    const { view } = await renderPage({})
    expect(qa(view.container, '.gantt-today-line')).toHaveLength(1)

    click(q(view.container, 'button[aria-label="Previous window"]'))
    click(q(view.container, 'button[aria-label="Previous window"]'))
    expect(q(view.container, '.gantt-today-line')).toBeNull()

    click(buttonByText(view.container, 'Today'))
    expect(qa(view.container, '.gantt-today-line')).toHaveLength(1)

    click(buttonByText(view.container, 'Month'))
    click(q(view.container, 'button[aria-label="Previous window"]'))
    click(q(view.container, 'button[aria-label="Previous window"]'))
    click(q(view.container, 'button[aria-label="Previous window"]'))
    expect(q(view.container, '.gantt-today-line')).toBeNull()
  })

  it('clamps month navigation when the anchor day does not exist in the target month', async () => {
    const { view } = await renderPage({ [TREE]: () => jsonResponse(treePayload({ today: '2026-01-31' })) })
    click(buttonByText(view.container, 'Month'))
    click(q(view.container, 'button[aria-label="Next window"]'))
    expect(text(view.container, '.gantt-window-label')).toBe('Jan 2026 – Dec 2026')
  })

  it('refreshes on the refresh button and on window focus', async () => {
    const gate = deferred()
    let attempt = 0
    const { calls, view } = await renderPage({
      [TREE]: () => {
        attempt += 1
        return attempt === 2 ? gate.promise : jsonResponse(treePayload())
      },
    })

    const refreshButton = q(view.container, 'button[aria-label="Refresh"]')
    click(refreshButton)
    expect(refreshButton.disabled).toBe(true)
    expect(refreshButton.textContent).toBe('…')

    gate.resolve(jsonResponse(treePayload()))
    await flush()
    expect(q(view.container, 'button[aria-label="Refresh"]').disabled).toBe(false)

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()

    expect(calls.filter(call => call.path === TREE)).toHaveLength(3)
    expect(qa(view.container, '.gantt-row')).toHaveLength(6)
    expect(q(view.container, '.gantt-banner')).toBeNull()
  })
})

