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

describe('work sessions', () => {
  it('binds a task to its content-dedicated conversation', () => {
    const task = store.create({ title: 'Work task' })
    expect(store.bindWorkSession(task.id, '  session-a  ')).toEqual({ taskId: task.id, sessionId: 'session-a' })
    expect(store.workSessionOf(task.id)).toBe('session-a')
    expect(store.workTaskOf('session-a')).toBe(task.id)
  })

  it('reports null for unknown tasks and conversations', () => {
    const task = store.create({ title: 'Unbound task' })
    expect(store.workSessionOf(task.id)).toBeNull()
    expect(store.workSessionOf('missing')).toBeNull()
    expect(store.workTaskOf('session-missing')).toBeNull()
  })

  it('replaces the session when a task is rebound', () => {
    const task = store.create({ title: 'Task' })
    store.bindWorkSession(task.id, 'session-a')
    store.bindWorkSession(task.id, 'session-b')
    expect(store.workSessionOf(task.id)).toBe('session-b')
    expect(store.workTaskOf('session-a')).toBeNull()
    expect(store.workTaskOf('session-b')).toBe(task.id)
  })

  it('moves a session from its old task to the new one', () => {
    const first = store.create({ title: 'First' })
    const second = store.create({ title: 'Second' })
    store.bindWorkSession(first.id, 'session-a')
    store.bindWorkSession(second.id, 'session-a')
    expect(store.workSessionOf(first.id)).toBeNull()
    expect(store.workSessionOf(second.id)).toBe('session-a')
    expect(store.workTaskOf('session-a')).toBe(second.id)
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM work_sessions').get()).toEqual({ count: 1 })
  })

  it('validates the task and the conversation before writing', () => {
    const task = store.create({ title: 'Task' })
    expectGanttError(() => store.bindWorkSession('', 'session-a'), 'id is required', 400)
    expectGanttError(() => store.bindWorkSession(5, 'session-a'), 'id is required', 400)
    expectGanttError(() => store.bindWorkSession('missing', 'session-a'), 'task missing was not found', 404)
    expectGanttError(() => store.bindWorkSession(task.id, undefined), 'sessionId is required', 400)
    expectGanttError(() => store.bindWorkSession(task.id, '   '), 'sessionId is required', 400)
    expectGanttError(() => store.bindWorkSession(task.id, 5), 'sessionId is required', 400)
    expectGanttError(() => store.bindWorkSession(task.id, 's'.repeat(201)), 'sessionId must be at most 200 characters', 400)
    expect(store.workSessionOf(task.id)).toBeNull()
  })

  it('exposes the bound conversation on tree rows', () => {
    const parent = store.create({ title: 'Parent' })
    const child = store.create({ title: 'Child', parentId: parent.id })
    store.bindWorkSession(child.id, 'session-a')
    const tree = store.snapshot().tasks
    expect(tree[0].workSessionId).toBeNull()
    expect(tree[0].children[0].workSessionId).toBe('session-a')
    expect(store.getRow(child.id).workSessionId).toBe('session-a')
  })

  it('joins the caller transaction through upsertWorkSession', () => {
    const task = store.create({ title: 'Task' })
    expect(() => store.transaction(() => {
      store.upsertWorkSession(task.id, 'session-a')
      throw new Error('rollback')
    })).toThrow('rollback')
    expect(store.workSessionOf(task.id)).toBeNull()
    expect(store.transaction(() => {
      store.upsertWorkSession(task.id, 'session-a')
      return store.workTaskOf('session-a')
    })).toBe(task.id)
  })
})
