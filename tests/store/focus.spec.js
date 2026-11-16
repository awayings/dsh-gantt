import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore } from '../../src/host/store.js'
import { expectGanttError } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

describe('conversation focus', () => {
  it('stores one task per session and returns it', () => {
    const task = store.create({ title: 'Data table' })
    expect(store.setFocus('session-a', task.id)).toBe(task.id)
    expect(store.focusOf('session-a')).toBe(task.id)
    expect(store.focusOf('session-b')).toBeNull()
  })

  it('trims the session id and replaces an existing focus', () => {
    const first = store.create({ title: 'First' })
    const second = store.create({ title: 'Second' })
    store.setFocus('  session-a  ', first.id)
    expect(store.setFocus('session-a', second.id)).toBe(second.id)
    expect(store.focusOf('session-a')).toBe(second.id)
    expect(store.focusOf('session-b')).toBeNull()
  })

  it('clears the focus with null and with an empty string', () => {
    const task = store.create({ title: 'Data table' })
    store.setFocus('session-a', task.id)
    expect(store.setFocus('session-a', null)).toBeNull()
    expect(store.focusOf('session-a')).toBeNull()
    store.setFocus('session-a', task.id)
    expect(store.setFocus('session-a', '')).toBeNull()
    expect(store.focusOf('session-a')).toBeNull()
  })

  it('rejects an unknown task and a missing session id', () => {
    expectGanttError(() => store.setFocus('session-a', 'missing'), 'task missing was not found', 404)
    expectGanttError(() => store.setFocus(/** @type {any} */ (undefined), null), 'sessionId is required', 400)
    expectGanttError(() => store.setFocus(/** @type {any} */ (5), null), 'sessionId is required', 400)
    expectGanttError(() => store.setFocus('   ', null), 'sessionId is required', 400)
    expectGanttError(() => store.focusOf(/** @type {any} */ (null)), 'sessionId is required', 400)
    expectGanttError(() => store.focusOf('x'.repeat(201)), 'sessionId must be at most 200 characters', 400)
  })

  it('drops the focus when the focused task is deleted', () => {
    const task = store.create({ title: 'Data table' })
    store.setFocus('session-a', task.id)
    store.delete(task.id)
    expect(store.focusOf('session-a')).toBeNull()
  })
})
