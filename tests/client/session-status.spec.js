// Live Session activity mapping for the Gantt views: the React subscription and
// the pure task/conversation state helpers used by the rows, the filter, and the
// workbench.
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { h } from '../../src/client/dom.js'
import { mount, text, unmountAll } from './harness.js'
import {
  EMPTY_STATUSES,
  conversationState,
  taskActivity,
  useSessionStatuses,
} from '../../src/client/session-status.js'

function fakeUiSession(entries = {}) {
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
    update(next) {
      snapshot = new Map(Object.entries(next))
      for (const listener of [...listeners]) listener()
    },
  }
}

function Host({ ctx }) {
  const statuses = useSessionStatuses(ctx)
  return h('span', null, `${statuses.size}:${statuses.get('session-1')?.running ?? 'none'}`)
}

afterEach(unmountAll)

describe('useSessionStatuses', () => {
  it('reads and follows the host snapshot', () => {
    const service = fakeUiSession({ 'session-1': { running: true } })
    const view = mount(createElement(Host, { ctx: { get: () => service } }))
    expect(text(view.container, 'span')).toBe('1:true')

    act(() => service.update({ 'session-1': { running: false } }))
    expect(text(view.container, 'span')).toBe('1:false')
  })

  it('falls back to the shared empty snapshot without the service', () => {
    const first = mount(createElement(Host, { ctx: undefined }))
    expect(text(first.container, 'span')).toBe('0:none')
    expect(EMPTY_STATUSES.size).toBe(0)
    first.unmount()

    const second = mount(createElement(Host, { ctx: { get: () => ({}) } }))
    expect(text(second.container, 'span')).toBe('0:none')
    second.unmount()

    const third = mount(createElement(Host, { ctx: { get: () => ({ sessionStatus: {} }) } }))
    expect(text(third.container, 'span')).toBe('0:none')
  })
})

describe('taskActivity', () => {
  const statuses = new Map([
    ['run', { running: true }],
    ['wait', { running: true, pendingInteraction: 'approval' }],
    ['idle', { running: false }],
  ])

  it('maps the bound conversation activity', () => {
    expect(taskActivity(statuses, { workSessionId: 'run' })).toBe('running')
    expect(taskActivity(statuses, { workSessionId: 'wait' })).toBe('waiting')
    expect(taskActivity(statuses, { workSessionId: 'idle' })).toBeNull()
  })

  it('returns null for unbound or unknown tasks', () => {
    expect(taskActivity(statuses, null)).toBeNull()
    expect(taskActivity(statuses, {})).toBeNull()
    expect(taskActivity(statuses, { workSessionId: null })).toBeNull()
    expect(taskActivity(statuses, { workSessionId: '' })).toBeNull()
    expect(taskActivity(statuses, { workSessionId: 'missing' })).toBeNull()
    expect(taskActivity(undefined, { workSessionId: 'run' })).toBeNull()
  })
})

describe('conversationState', () => {
  const statuses = new Map([
    ['run', { running: true }],
    ['wait', { pendingInteraction: 'approval' }],
    ['idle', { running: false }],
  ])

  it('prefers waiting, then running, then idle', () => {
    expect(conversationState(statuses, 'wait')).toBe('waiting')
    expect(conversationState(statuses, 'run')).toBe('running')
    expect(conversationState(statuses, 'idle')).toBe('idle')
  })

  it('uses the fallback running flag and tolerates missing ids', () => {
    expect(conversationState(statuses, 'missing', true)).toBe('running')
    expect(conversationState(statuses, 'missing', false)).toBe('idle')
    expect(conversationState(statuses, '', true)).toBe('running')
    expect(conversationState(statuses, null)).toBe('idle')
    expect(conversationState(undefined, 'run')).toBe('idle')
  })
})
