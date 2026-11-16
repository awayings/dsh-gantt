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

/** One track root with one task under it. */
function seed() {
  const track = store.create({ title: 'Content', kind: 'track', ref: 'T1' })
  const task = store.create({ title: 'Collect data', parentId: track.id })
  return { track, task }
}

describe('task trajectory events', () => {
  it('records an event and lists it newest first', () => {
    const { task } = seed()
    const first = store.recordEvent({ taskId: task.id, action: 'update', sessionId: 'session-a', turn: 2, detail: '  started  ' })
    expect(first).toMatchObject({ taskId: task.id, action: 'update', sessionId: 'session-a', turn: 2, detail: 'started' })
    expect(typeof first.id).toBe('string')
    expect(typeof first.at).toBe('string')
    store.recordEvent({ taskId: task.id, action: 'complete', sessionId: 'session-a', turn: 3, detail: 'shipped' })
    const events = store.trajectory({ taskId: task.id })
    expect(events.map(event => event.action)).toEqual(['complete', 'update'])
    expect(events[0]).toMatchObject({ sessionId: 'session-a', turn: 3, detail: 'shipped' })
  })

  it('keeps a conversation-less event when the session is blank and drops non-string details', () => {
    const { task } = seed()
    const event = store.recordEvent({ taskId: task.id, action: 'create', sessionId: 5, turn: null, detail: 7 })
    expect(event).toMatchObject({ sessionId: '', turn: null, detail: '' })
    expect(store.trajectory({ taskId: task.id, sessionId: 'session-a' })).toEqual([])
  })

  it('rejects an unknown action, task, session, or turn', () => {
    const { task } = seed()
    expectGanttError(() => store.recordEvent({ taskId: task.id, action: 'nope' }), 'action must be one of create, update, complete, decompose, track', 400)
    expectGanttError(() => store.recordEvent({ taskId: 'missing', action: 'update' }), 'task missing was not found', 404)
    expectGanttError(() => store.recordEvent({ taskId: task.id, action: 'update', turn: -1 }), 'turn must be a non-negative integer', 400)
    expectGanttError(() => store.recordEvent({ taskId: task.id, action: 'update', turn: 1.5 }), 'turn must be a non-negative integer', 400)
    expectGanttError(() => store.recordEvent({ taskId: task.id, action: 'update', turn: '3' }), 'turn must be a non-negative integer', 400)
  })

  it('records an assistant update or completion with its session and turn', () => {
    const { task } = seed()
    store.update(task.id, { status: 'in_progress', progress: 40 }, { sessionId: 'session-a', turn: 4 })
    store.update(task.id, { status: 'done' }, { sessionId: 'session-a', turn: 5, summary: '  shipped to the dashboard  ' })
    const events = store.trajectory({ taskId: task.id })
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ action: 'update', sessionId: 'session-a', turn: 4, detail: '状态 in_progress，进度 40%' })
    expect(events[0]).toMatchObject({ action: 'complete', sessionId: 'session-a', turn: 5, detail: 'shipped to the dashboard' })
  })

  it('does not record manual writes or writes without a session', () => {
    const { task } = seed()
    store.update(task.id, { status: 'done' })
    store.update(task.id, { title: 'Renamed' }, { sessionId: '   ', turn: 1 })
    store.update(task.id, { title: 'Still no session' }, { turn: 2 })
    expect(store.trajectory({ taskId: task.id })).toEqual([])
  })

  it('records a decompose event on the parent and create events on the children', () => {
    const { track } = seed()
    const result = store.decompose(track.id, [
      { title: 'Pull rows', doneWhen: 'Rows exported' },
      { title: 'Check totals', doneWhen: 'Totals match' },
    ], undefined, { sessionId: 'session-b', turn: 7, summary: '拆成两步' })
    const parentEvents = store.trajectory({ taskId: track.id })
    expect(parentEvents).toHaveLength(1)
    expect(parentEvents[0]).toMatchObject({ action: 'decompose', sessionId: 'session-b', turn: 7, detail: '拆成两步' })
    for (const child of result.children) {
      expect(store.trajectory({ taskId: child.id })[0]).toMatchObject({ action: 'create', sessionId: 'session-b', turn: 7, detail: '在 T1 下创建' })
    }
    const withoutSummary = store.decompose(track.id, [{ title: 'Third', doneWhen: 'Done' }], undefined, { sessionId: 'session-b', turn: 8 })
    expect(store.trajectory({ taskId: track.id })[0]).toMatchObject({ action: 'decompose', detail: '拆解为 1 个子任务' })
    expect(withoutSummary.children).toHaveLength(1)
  })

  it('filters by task and session, defaults the page size, and validates the limit', () => {
    const { task: first } = seed()
    const second = store.create({ title: 'Second task' })
    store.recordEvent({ taskId: first.id, action: 'update', sessionId: 'session-a' })
    store.recordEvent({ taskId: second.id, action: 'complete', sessionId: 'session-b' })
    expect(store.trajectory().map(event => event.taskId)).toEqual([second.id, first.id])
    expect(store.trajectory({ taskId: first.id, limit: '1' })).toHaveLength(1)
    expect(store.trajectory({ sessionId: 'session-b' }).map(event => event.taskId)).toEqual([second.id])
    expect(store.trajectory({ sessionId: null })).toHaveLength(2)
    expect(store.trajectory({ sessionId: '  ' })).toHaveLength(2)
    expect(store.trajectory({ taskId: '', limit: '' })).toHaveLength(2)
    expect(store.trajectory({ taskId: 5 })).toHaveLength(2)
    for (const limit of [0, 101, 1.5, 'abc']) {
      expectGanttError(() => store.trajectory({ limit }), 'limit must be an integer from 1 to 100', 400)
    }
    expectGanttError(() => store.trajectory({ taskId: 'missing' }), 'task missing was not found', 404)
    expectGanttError(() => store.trajectory({ sessionId: 5 }), 'sessionId is required', 400)
    expectGanttError(() => store.trajectory({ sessionId: 's'.repeat(201) }), 'sessionId must be at most 200 characters', 400)
  })

  it('deletes events with their task', () => {
    const { task } = seed()
    store.recordEvent({ taskId: task.id, action: 'update', sessionId: 'session-a' })
    store.delete(task.id)
    expect(store.trajectory()).toEqual([])
  })
})
