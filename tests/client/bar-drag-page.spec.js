// Dragging and resizing task bars on the Gantt page: cell snapping, the live
// preview, the single write on release, and the click/drag split.
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import {
  buttonByText,
  click,
  dialog,
  flush,
  installFetch,
  jsonResponse,
  mount,
  pointerEvent,
  q,
  qa,
  requestBody,
  row,
  setupApp,
  text,
  unmountAll,
} from './harness.js'
import { treePayload } from './fixtures.js'

const TREE = 'api/gantt/tree'
const UPDATE = 'api/gantt/task/update'
// The weekly timeline draws 36 px per one-day cell.
const DAY = 36
// The monthly window is Aug 2026 – Jul 2027: 365 days at 3.2 px per day, so one
// month cell averages 1168 / 12 px.
const MONTH = 1168 / 12

afterEach(unmountAll)

async function renderPage(routes = {}) {
  const fetchState = installFetch({
    [TREE]: () => jsonResponse(treePayload()),
    [UPDATE]: () => jsonResponse({ ok: true, task: {} }),
    ...routes,
  })
  const app = setupApp()
  const view = mount(createElement(app.page().component))
  await flush()
  return { ...fetchState, app, view }
}

function barOf(view, label) {
  return q(row(view.container, label), '.gantt-bar')
}

function handleOf(view, label, edge) {
  return q(row(view.container, label), `.gantt-bar-handle[data-edge="${edge}"]`)
}

function press(element, clientX = 100, button = 0) {
  pointerEvent(element, 'pointerdown', { clientX, button })
}

function moveTo(clientX) {
  pointerEvent(window, 'pointermove', { clientX })
}

function releaseTo(clientX) {
  pointerEvent(window, 'pointerup', { clientX })
}

function updateBodies(calls) {
  return calls.filter(call => call.path === UPDATE).map(requestBody)
}

describe('bar drag', () => {
  it('moves a leaf bar by whole days, previews the range, and persists it once', async () => {
    const { calls, view } = await renderPage()
    const bar = barOf(view, '1.1 Write spec')
    expect(bar.getAttribute('data-editable')).toBe('true')
    expect(bar.getAttribute('title')).toContain('Drag to move one cell')
    expect(handleOf(view, '1.1 Write spec', 'start')).not.toBeNull()
    expect(handleOf(view, '1.1 Write spec', 'end')).not.toBeNull()

    press(bar)
    moveTo(100 + 7 * DAY)
    const preview = barOf(view, '1.1 Write spec')
    expect(preview.getAttribute('data-dragging')).toBe('true')
    expect(preview.getAttribute('data-range')).toBe('2026-11-16 → 2026-11-19')
    expect(preview.getAttribute('title')).toContain('2026-11-16 → 2026-11-19')
    expect(calls.filter(call => call.path === UPDATE)).toHaveLength(0)

    releaseTo(100 + 7 * DAY)
    await flush()

    expect(updateBodies(calls)).toEqual([{ id: 'c1', startDate: '2026-11-16', endDate: '2026-11-19' }])
    expect(text(view.container, '.gantt-toast')).toBe('Dates updated')
    expect(calls.filter(call => call.path === TREE)).toHaveLength(2)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-dragging')).toBeNull()
  })

  it('treats a jiggle shorter than half a cell as a click', async () => {
    const { calls, view } = await renderPage()
    const bar = barOf(view, '1.1 Write spec')

    press(bar)
    moveTo(102)
    releaseTo(102)
    await flush()

    expect(updateBodies(calls)).toHaveLength(0)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-dragging')).toBeNull()
    click(barOf(view, '1.1 Write spec'))
    await flush()
    expect(text(view.container, '.gantt-dialog-title')).toBe('Edit task · 1.1')
  })

  it('clears the preview when the pointer returns within the original cell', async () => {
    const { calls, view } = await renderPage()

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + DAY)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-dragging')).toBe('true')
    moveTo(90)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-dragging')).toBeNull()
    releaseTo(90)
    await flush()

    expect(updateBodies(calls)).toHaveLength(0)
    expect(text(view.container, '.gantt-toast')).toBeNull()
  })

  it('keeps a press as one gesture and ignores a second pointerdown', async () => {
    const { calls, view } = await renderPage()
    const bar = barOf(view, '1.1 Write spec')

    press(bar)
    press(bar)
    moveTo(100 + 2 * DAY)
    releaseTo(100 + 2 * DAY)
    await flush()

    expect(updateBodies(calls)).toEqual([{ id: 'c1', startDate: '2026-11-11', endDate: '2026-11-14' }])
  })

  it('ignores a non-primary mouse button', async () => {
    const { calls, view } = await renderPage()

    press(barOf(view, '1.1 Write spec'), 100, 2)
    moveTo(100 + DAY)
    releaseTo(100 + DAY)
    await flush()

    expect(updateBodies(calls)).toHaveLength(0)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-dragging')).toBeNull()
  })

  it('drops the preview on pointercancel and writes nothing', async () => {
    const { calls, view } = await renderPage()

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + DAY)
    pointerEvent(window, 'pointercancel', { clientX: 100 + DAY })

    expect(barOf(view, '1.1 Write spec').getAttribute('data-dragging')).toBeNull()
    await flush()
    expect(updateBodies(calls)).toHaveLength(0)
  })

  it('drops the gesture when the page unmounts mid-drag', async () => {
    const { calls, view } = await renderPage()

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + DAY)
    expect(() => view.unmount()).not.toThrow()
    releaseTo(100 + DAY)
    await flush()

    expect(updateBodies(calls)).toHaveLength(0)
  })

  it('moves by whole months on the monthly scale', async () => {
    const { calls, view } = await renderPage()
    click(buttonByText(view.container, 'Month'))

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + MONTH)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-range')).toBe('2026-12-09 → 2026-12-12')
    releaseTo(100 + MONTH)
    await flush()

    expect(updateBodies(calls)).toEqual([{ id: 'c1', startDate: '2026-12-09', endDate: '2026-12-12' }])
  })
})

describe('bar resize', () => {
  it('resizes the start edge by days and keeps the end', async () => {
    const { calls, view } = await renderPage()

    press(handleOf(view, '1.1 Write spec', 'start'))
    moveTo(100 - DAY)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-range')).toBe('2026-11-08 → 2026-11-12')
    releaseTo(100 - DAY)
    await flush()

    expect(updateBodies(calls)).toEqual([{ id: 'c1', startDate: '2026-11-08', endDate: '2026-11-12' }])
  })

  it('resizes the end edge by days and keeps the start', async () => {
    const { calls, view } = await renderPage()

    press(handleOf(view, '1.1 Write spec', 'end'))
    moveTo(100 + DAY)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-range')).toBe('2026-11-09 → 2026-11-13')
    releaseTo(100 + DAY)
    await flush()

    expect(updateBodies(calls)).toEqual([{ id: 'c1', startDate: '2026-11-09', endDate: '2026-11-13' }])
  })

  it('resizes the end edge by months on the monthly scale', async () => {
    const { calls, view } = await renderPage()
    click(buttonByText(view.container, 'Month'))

    press(handleOf(view, '1.1 Write spec', 'end'))
    moveTo(100 + MONTH)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-range')).toBe('2026-11-09 → 2026-12-12')
    releaseTo(100 + MONTH)
    await flush()

    expect(updateBodies(calls)).toEqual([{ id: 'c1', startDate: '2026-11-09', endDate: '2026-12-12' }])
  })

  it('skips the write when a resize clamps back to the current range', async () => {
    const { calls, view } = await renderPage()

    press(handleOf(view, '2.1 Announce', 'start'))
    moveTo(100 + DAY)
    releaseTo(100 + DAY)
    await flush()

    expect(updateBodies(calls)).toHaveLength(0)
    expect(text(view.container, '.gantt-toast')).toBeNull()
  })
})

describe('drag limits and failures', () => {
  it('leaves summary bars roll-up only: no handles, no drag, no write', async () => {
    const { calls, view } = await renderPage()
    const summary = barOf(view, '1 Release 2.0')

    expect(summary.getAttribute('data-editable')).toBeNull()
    expect(summary.getAttribute('title')).not.toContain('Drag to move one cell')
    expect(qa(row(view.container, '1 Release 2.0'), '.gantt-bar-handle')).toHaveLength(0)

    press(summary)
    moveTo(100 + DAY)
    releaseTo(100 + DAY)
    await flush()

    expect(updateBodies(calls)).toHaveLength(0)
    expect(barOf(view, '1 Release 2.0').getAttribute('data-dragging')).toBeNull()
  })

  it('reports a failed date write in an error toast and refetches', async () => {
    const { calls, view } = await renderPage({
      [UPDATE]: () => jsonResponse({ ok: false, error: 'dates are locked' }, 409),
    })

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + 7 * DAY)
    releaseTo(100 + 7 * DAY)
    await flush()

    const toast = q(view.container, '.gantt-toast')
    expect(toast.textContent).toBe('dates are locked')
    expect(toast.getAttribute('data-error')).toBe('true')
    expect(calls.filter(call => call.path === TREE)).toHaveLength(2)
  })

  it('stringifies a non-Error date write failure', async () => {
    const { view } = await renderPage({ [UPDATE]: () => Promise.reject('update exploded') })

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + DAY)
    releaseTo(100 + DAY)
    await flush()

    expect(text(view.container, '.gantt-toast')).toBe('update exploded')
  })
})

describe('bar drag click split', () => {
  it('swallows the click that ends a drag, then opens the editor on the next click', async () => {
    const { view } = await renderPage()

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + DAY)
    releaseTo(100 + DAY)
    await flush()

    click(barOf(view, '1.1 Write spec'))
    expect(dialog(view.container)).toBeNull()

    click(barOf(view, '1.1 Write spec'))
    await flush()
    expect(text(view.container, '.gantt-dialog-title')).toBe('Edit task · 1.1')
  })

  it('opens the editor from a plain press without movement', async () => {
    const { view } = await renderPage()
    const bar = barOf(view, '1.1 Write spec')

    press(bar)
    releaseTo(100)
    await flush()
    click(barOf(view, '1.1 Write spec'))
    await flush()

    expect(text(view.container, '.gantt-dialog-title')).toBe('Edit task · 1.1')
  })
})
