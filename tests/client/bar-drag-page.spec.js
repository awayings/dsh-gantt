// Dragging and resizing task bars on the Gantt page: week snapping, the live
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
// The weekly timeline draws 36 px per day, so one snapped week is 252 px.
const WEEK = 7 * 36

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
  it('moves a leaf bar by whole weeks, previews the range, and persists it once', async () => {
    const { calls, view } = await renderPage()
    const bar = barOf(view, '1.1 Write spec')
    expect(bar.getAttribute('data-editable')).toBe('true')
    expect(bar.getAttribute('title')).toContain('Drag to move by weeks')
    expect(handleOf(view, '1.1 Write spec', 'start')).not.toBeNull()
    expect(handleOf(view, '1.1 Write spec', 'end')).not.toBeNull()

    press(bar)
    moveTo(100 + WEEK)
    const preview = barOf(view, '1.1 Write spec')
    expect(preview.getAttribute('data-dragging')).toBe('true')
    expect(preview.getAttribute('data-range')).toBe('2026-11-16 → 2026-11-22')
    expect(preview.getAttribute('title')).toContain('2026-11-16 → 2026-11-22')
    expect(calls.filter(call => call.path === UPDATE)).toHaveLength(0)

    releaseTo(100 + WEEK)
    await flush()

    expect(updateBodies(calls)).toEqual([{ id: 'c1', startDate: '2026-11-16', endDate: '2026-11-22' }])
    expect(text(view.container, '.gantt-toast')).toBe('Dates updated')
    expect(calls.filter(call => call.path === TREE)).toHaveLength(2)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-dragging')).toBeNull()
  })

  it('treats a jiggle shorter than half a week as a click', async () => {
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

  it('clears the preview when the pointer returns within the original week', async () => {
    const { calls, view } = await renderPage()

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + WEEK)
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
    moveTo(100 + 2 * WEEK)
    releaseTo(100 + 2 * WEEK)
    await flush()

    expect(updateBodies(calls)).toEqual([{ id: 'c1', startDate: '2026-11-23', endDate: '2026-11-29' }])
  })

  it('ignores a non-primary mouse button', async () => {
    const { calls, view } = await renderPage()

    press(barOf(view, '1.1 Write spec'), 100, 2)
    moveTo(100 + WEEK)
    releaseTo(100 + WEEK)
    await flush()

    expect(updateBodies(calls)).toHaveLength(0)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-dragging')).toBeNull()
  })

  it('drops the preview on pointercancel and writes nothing', async () => {
    const { calls, view } = await renderPage()

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + WEEK)
    pointerEvent(window, 'pointercancel', { clientX: 100 + WEEK })

    expect(barOf(view, '1.1 Write spec').getAttribute('data-dragging')).toBeNull()
    await flush()
    expect(updateBodies(calls)).toHaveLength(0)
  })

  it('drops the gesture when the page unmounts mid-drag', async () => {
    const { calls, view } = await renderPage()

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + WEEK)
    expect(() => view.unmount()).not.toThrow()
    releaseTo(100 + WEEK)
    await flush()

    expect(updateBodies(calls)).toHaveLength(0)
  })

  it('drags by whole weeks on the monthly scale as well', async () => {
    const { calls, view } = await renderPage()
    click(buttonByText(view.container, 'Month'))
    const weekPx = 7 * 3.2

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + weekPx)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-range')).toBe('2026-11-16 → 2026-11-22')
    releaseTo(100 + weekPx)
    await flush()

    expect(updateBodies(calls)).toEqual([{ id: 'c1', startDate: '2026-11-16', endDate: '2026-11-22' }])
  })
})

describe('bar resize', () => {
  it('resizes the start edge from its handle and snaps the end to a Sunday', async () => {
    const { calls, view } = await renderPage()

    press(handleOf(view, '1.1 Write spec', 'start'))
    moveTo(100 - WEEK)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-range')).toBe('2026-11-02 → 2026-11-15')
    releaseTo(100 - WEEK)
    await flush()

    expect(updateBodies(calls)).toEqual([{ id: 'c1', startDate: '2026-11-02', endDate: '2026-11-15' }])
  })

  it('resizes the end edge from its handle and snaps the start to a Monday', async () => {
    const { calls, view } = await renderPage()

    press(handleOf(view, '1.1 Write spec', 'end'))
    moveTo(100 + WEEK)
    expect(barOf(view, '1.1 Write spec').getAttribute('data-range')).toBe('2026-11-09 → 2026-11-22')
    releaseTo(100 + WEEK)
    await flush()

    expect(updateBodies(calls)).toEqual([{ id: 'c1', startDate: '2026-11-09', endDate: '2026-11-22' }])
  })

  it('skips the write when a resize clamps back to the current range', async () => {
    const payload = treePayload()
    const parent = payload.tasks[1]
    parent.startDate = '2026-11-16'
    parent.endDate = '2026-11-22'
    parent.children[0].startDate = '2026-11-16'
    parent.children[0].endDate = '2026-11-22'
    const { calls, view } = await renderPage({ [TREE]: () => jsonResponse(payload) })

    press(handleOf(view, '2.1 Announce', 'start'))
    moveTo(100 + WEEK)
    releaseTo(100 + WEEK)
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
    expect(summary.getAttribute('title')).not.toContain('Drag to move by weeks')
    expect(qa(row(view.container, '1 Release 2.0'), '.gantt-bar-handle')).toHaveLength(0)

    press(summary)
    moveTo(100 + WEEK)
    releaseTo(100 + WEEK)
    await flush()

    expect(updateBodies(calls)).toHaveLength(0)
    expect(barOf(view, '1 Release 2.0').getAttribute('data-dragging')).toBeNull()
  })

  it('reports a failed date write in an error toast and refetches', async () => {
    const { calls, view } = await renderPage({
      [UPDATE]: () => jsonResponse({ ok: false, error: 'dates are locked' }, 409),
    })

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + WEEK)
    releaseTo(100 + WEEK)
    await flush()

    const toast = q(view.container, '.gantt-toast')
    expect(toast.textContent).toBe('dates are locked')
    expect(toast.getAttribute('data-error')).toBe('true')
    expect(calls.filter(call => call.path === TREE)).toHaveLength(2)
  })

  it('stringifies a non-Error date write failure', async () => {
    const { view } = await renderPage({ [UPDATE]: () => Promise.reject('update exploded') })

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + WEEK)
    releaseTo(100 + WEEK)
    await flush()

    expect(text(view.container, '.gantt-toast')).toBe('update exploded')
  })
})

describe('bar drag click split', () => {
  it('swallows the click that ends a drag, then opens the editor on the next click', async () => {
    const { view } = await renderPage()

    press(barOf(view, '1.1 Write spec'))
    moveTo(100 + WEEK)
    releaseTo(100 + WEEK)
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
