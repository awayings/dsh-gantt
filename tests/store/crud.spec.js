import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore, todayIso, addDays } from '../../store.js'
import { expectGanttError, expectIsoTimestamp } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

describe('create defaults and explicit fields', () => {
  it('fills in today..+3, todo, zero progress, and root placement', () => {
    const task = store.create({ title: '  Write   the   tests  ' })
    expect(task.title).toBe('Write the tests')
    expect(task.description).toBe('')
    expect(task.status).toBe('todo')
    expect(task.progress).toBe(0)
    expect(task.startDate).toBe(todayIso())
    expect(task.endDate).toBe(addDays(todayIso(), 3))
    expect(task.parentId).toBeNull()
    expect(task.sortOrder).toBe(0)
    expect(task.number).toBe('1')
    expect(task.hasChildren).toBe(false)
    expect(task.children).toEqual([])
    expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expectIsoTimestamp(task.createdAt)
    expectIsoTimestamp(task.updatedAt)
  })

  it('honors every explicit field and derives progress from status', () => {
    const parent = store.create({
      title: 'Parent',
      description: '  Root task  ',
      status: 'in_progress',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    })
    expect(parent.description).toBe('Root task')
    expect(parent.progress).toBe(50)
    const done = store.create({ title: 'Done', parentId: parent.id, status: 'done' })
    expect(done.progress).toBe(100)
    const todo = store.create({ title: 'Todo', parentId: parent.id, status: 'todo' })
    expect(todo.progress).toBe(0)
    const blocked = store.create({ title: 'Blocked', parentId: parent.id, status: 'blocked' })
    expect(blocked.progress).toBe(0)
    const explicit = store.create({ title: 'Explicit', parentId: parent.id, status: 'in_progress', progress: 33 })
    expect(explicit.progress).toBe(33)
    expect(explicit.number).toBe('1.4')
    expect(store.tree()[0].children.map(child => child.title)).toEqual(['Done', 'Todo', 'Blocked', 'Explicit'])
    expect(store.tree()[0].progress).toBe(33)
    expect(store.tree()[0].status).toBe('blocked')
  })

  it('clamps and rounds progress', () => {
    expect(store.create({ title: 'Low', progress: -20 }).progress).toBe(0)
    expect(store.create({ title: 'High', progress: 160 }).progress).toBe(100)
    expect(store.create({ title: 'Rounded', progress: 33.6 }).progress).toBe(34)
  })

  it('accepts a null or empty parentId as the root', () => {
    expect(store.create({ title: 'Null parent', parentId: null }).parentId).toBeNull()
    expect(store.create({ title: 'Empty parent', parentId: '' }).parentId).toBeNull()
  })
})

describe('create validation', () => {
  it('rejects a missing, non-string, empty, or over-long title', () => {
    expectGanttError(() => store.create({}), 'title is required')
    expectGanttError(() => store.create({ title: 5 }), 'title is required')
    expectGanttError(() => store.create({ title: '   ' }), 'title must not be empty')
    expectGanttError(() => store.create({ title: 'a'.repeat(201) }), 'title must be at most 200 characters')
    expect(store.create({ title: 'a'.repeat(200) }).title).toHaveLength(200)
  })

  it('rejects a non-string or over-long description', () => {
    expectGanttError(() => store.create({ title: 'T', description: 9 }), 'description must be a string')
    expectGanttError(() => store.create({ title: 'T', description: 'd'.repeat(4001) }), 'description must be at most 4000 characters')
    expect(store.create({ title: 'T', description: null }).description).toBe('')
    expect(store.create({ title: 'T', description: 'x'.repeat(4000) }).description).toHaveLength(4000)
  })

  it('rejects an unknown status', () => {
    expectGanttError(
      () => store.create({ title: 'T', status: 'pending' }),
      'status must be one of todo, in_progress, blocked, done',
    )
  })

  it('rejects non-numeric or non-finite progress', () => {
    const message = 'progress must be a number from 0 to 100'
    expectGanttError(() => store.create({ title: 'T', progress: '50' }), message)
    expectGanttError(() => store.create({ title: 'T', progress: Number.NaN }), message)
    expectGanttError(() => store.create({ title: 'T', progress: Number.POSITIVE_INFINITY }), message)
  })

  it('rejects malformed or impossible startDate values', () => {
    expectGanttError(() => store.create({ title: 'T', startDate: 20240101 }), 'startDate must be a YYYY-MM-DD date')
    expectGanttError(() => store.create({ title: 'T', startDate: '2024/01/01' }), 'startDate must be a YYYY-MM-DD date')
    expectGanttError(() => store.create({ title: 'T', startDate: '2024-02-30' }), 'startDate is not a valid calendar date')
  })

  it('rejects malformed or impossible endDate values and inverted ranges', () => {
    expectGanttError(() => store.create({ title: 'T', endDate: 20240101 }), 'endDate must be a YYYY-MM-DD date')
    expectGanttError(() => store.create({ title: 'T', endDate: '2024-13-01' }), 'endDate is not a valid calendar date')
    expectGanttError(
      () => store.create({ title: 'T', startDate: '2024-02-02', endDate: '2024-02-01' }),
      'endDate must not be before startDate',
    )
    expect(store.create({ title: 'T', startDate: '2024-02-02', endDate: '2024-02-02' }).endDate).toBe('2024-02-02')
  })

  it('rejects a non-string parent or a missing parent', () => {
    expectGanttError(() => store.create({ title: 'T', parentId: 12 }), 'parentId must be a task id or null')
    expectGanttError(() => store.create({ title: 'T', parentId: 'ghost' }), 'task ghost was not found', 404)
  })
})

describe('update', () => {
  it('updates title and description', () => {
    const task = store.create({ title: 'Old', description: 'old' })
    const updated = store.update(task.id, { title: '  New   title ', description: ' new text ' })
    expect(updated.title).toBe('New title')
    expect(updated.description).toBe('new text')
  })

  it('validates title and description replacements', () => {
    const task = store.create({ title: 'Title' })
    expectGanttError(() => store.update(task.id, { title: '  ' }), 'title must not be empty')
    expectGanttError(() => store.update(task.id, { title: 3 }), 'title is required')
    expectGanttError(() => store.update(task.id, { description: 3 }), 'description must be a string')
  })

  it('updates dates and enforces the range against the stored counterpart', () => {
    const task = store.create({ title: 'Dates', startDate: '2024-01-01', endDate: '2024-01-10' })
    expect(store.update(task.id, { startDate: '2024-01-02' }).startDate).toBe('2024-01-02')
    expect(store.update(task.id, { endDate: '2024-01-20' }).endDate).toBe('2024-01-20')
    expectGanttError(() => store.update(task.id, { startDate: '2024-02-01' }), 'endDate must not be before startDate')
    expectGanttError(() => store.update(task.id, { endDate: '2023-12-01' }), 'endDate must not be before startDate')
    expectGanttError(() => store.update(task.id, { startDate: 'nope' }), 'startDate must be a YYYY-MM-DD date')
    expectGanttError(() => store.update(task.id, { endDate: '2024-02-31' }), 'endDate is not a valid calendar date')
  })

  it('derives progress from a status-only patch', () => {
    const task = store.create({ title: 'Task', progress: 60 })
    expect(store.update(task.id, { status: 'done' }).progress).toBe(100)
    expect(store.update(task.id, { status: 'todo' }).progress).toBe(0)
    expect(store.update(task.id, { status: 'in_progress' }).progress).toBe(50)
    expect(store.update(task.id, { status: 'blocked' }).progress).toBe(50)
    expect(store.create({ title: 'Blocked from zero', status: 'blocked' }).progress).toBe(0)
  })

  it('keeps the current progress for a blocked status and a partial in_progress value', () => {
    const task = store.create({ title: 'Task', status: 'in_progress', progress: 60 })
    expect(store.update(task.id, { status: 'blocked' }).progress).toBe(60)
    const blocked = store.create({ title: 'Blocked', status: 'blocked' })
    expect(store.update(blocked.id, { status: 'in_progress' }).progress).toBe(50)
    const partial = store.create({ title: 'Partial', progress: 60 })
    expect(store.update(partial.id, { status: 'in_progress' }).progress).toBe(60)
    const finished = store.create({ title: 'Finished' })
    store.update(finished.id, { progress: 100 })
    expect(store.getRow(finished.id).status).toBe('done')
    expect(store.update(finished.id, { status: 'in_progress' }).progress).toBe(50)
  })

  it('derives status from a progress-only patch', () => {
    const task = store.create({ title: 'Task' })
    expect(store.update(task.id, { progress: 100 }).status).toBe('done')
    expect(store.update(task.id, { progress: 0 }).status).toBe('todo')
    expect(store.update(task.id, { progress: 40 }).status).toBe('in_progress')
    const blocked = store.create({ title: 'Blocked', status: 'blocked' })
    expect(store.update(blocked.id, { progress: 40 }).status).toBe('blocked')
    expect(store.update(blocked.id, { progress: 100 }).status).toBe('done')
  })

  it('applies status and progress together when both are supplied', () => {
    const task = store.create({ title: 'Task' })
    const updated = store.update(task.id, { status: 'blocked', progress: 25 })
    expect(updated.status).toBe('blocked')
    expect(updated.progress).toBe(25)
  })

  it('rejects an unknown status or invalid progress', () => {
    const task = store.create({ title: 'Task' })
    expectGanttError(() => store.update(task.id, { status: 'nope' }), 'status must be one of todo, in_progress, blocked, done')
    expectGanttError(() => store.update(task.id, { progress: 'x' }), 'progress must be a number from 0 to 100')
  })

  it('moves a task to another parent and appends it to the new sibling group', () => {
    const alpha = store.create({ title: 'Alpha' })
    const beta = store.create({ title: 'Beta' })
    const alphaChild = store.create({ title: 'Alpha child', parentId: alpha.id })
    const alphaSecond = store.create({ title: 'Alpha second', parentId: alpha.id })
    const betaChild = store.create({ title: 'Beta child', parentId: beta.id })
    const moved = store.update(alphaChild.id, { parentId: beta.id })
    expect(moved.parentId).toBe(beta.id)
    expect(moved.number).toBe('2.2')
    expect(moved.sortOrder).toBe(1)
    expect(store.getNode(alphaSecond.id).number).toBe('1.1')
    const betaNode = store.getNode(beta.id)
    expect(betaNode.children.map(child => child.title)).toEqual(['Beta child', 'Alpha child'])
    expect(store.getNode(alpha.id).children.map(child => child.title)).toEqual(['Alpha second'])
    expect(store.getNode(betaChild.id)).toBeDefined()
  })

  it('moves a task back to the root', () => {
    const root = store.create({ title: 'Root' })
    const child = store.create({ title: 'Child', parentId: root.id })
    const moved = store.update(child.id, { parentId: null })
    expect(moved.parentId).toBeNull()
    expect(moved.number).toBe('2')
    expect(moved.sortOrder).toBe(1)
    expect(store.getNode(root.id).hasChildren).toBe(false)
  })

  it('treats an own parentId of undefined as a move to the root', () => {
    const root = store.create({ title: 'Root' })
    const child = store.create({ title: 'Child', parentId: root.id })
    const moved = store.update(child.id, { parentId: undefined })
    expect(moved.parentId).toBeNull()
  })

  it('keeps the sort order when the parent is unchanged', () => {
    const root = store.create({ title: 'Root' })
    const first = store.create({ title: 'First', parentId: root.id })
    const second = store.create({ title: 'Second', parentId: root.id })
    expect(second.sortOrder).toBe(1)
    const updated = store.update(first.id, { parentId: root.id, title: 'Renamed' })
    expect(updated.sortOrder).toBe(0)
    expect(updated.title).toBe('Renamed')
  })

  it('refuses a self-parent and a descendant cycle', () => {
    const root = store.create({ title: 'Root' })
    const child = store.create({ title: 'Child', parentId: root.id })
    expectGanttError(() => store.update(root.id, { parentId: root.id }), 'a task cannot be its own parent')
    expectGanttError(
      () => store.update(root.id, { parentId: child.id }),
      'a task cannot move under one of its descendants',
    )
  })

  it('validates the new parent id', () => {
    const task = store.create({ title: 'Task' })
    expectGanttError(() => store.update(task.id, { parentId: 42 }), 'parentId must be a task id or null')
    expectGanttError(() => store.update(task.id, { parentId: 'ghost' }), 'task ghost was not found', 404)
  })

  it('reports unknown task ids as 404', () => {
    expectGanttError(() => store.update('ghost', { title: 'X' }), 'task ghost was not found', 404)
    expectGanttError(() => store.update(undefined, {}), 'id is required')
  })

  it('recomputes the new ancestor chain on a move', () => {
    const alpha = store.create({ title: 'Alpha', startDate: '2024-01-01', endDate: '2024-01-02' })
    const beta = store.create({ title: 'Beta', startDate: '2024-03-01', endDate: '2024-03-02' })
    const child = store.create({
      title: 'Child',
      parentId: alpha.id,
      startDate: '2024-02-01',
      endDate: '2024-02-10',
      status: 'done',
    })
    store.update(child.id, { parentId: beta.id })
    expect(store.getRow(beta.id).startDate).toBe('2024-02-01')
    expect(store.getRow(beta.id).endDate).toBe('2024-02-10')
    expect(store.getRow(beta.id).status).toBe('done')
  })

  it('retains the last rolled-up values when the final child moves away', () => {
    const alpha = store.create({ title: 'Alpha', startDate: '2024-01-01', endDate: '2024-01-02' })
    const child = store.create({
      title: 'Child',
      parentId: alpha.id,
      startDate: '2024-02-01',
      endDate: '2024-02-10',
      status: 'done',
    })
    expect(store.getRow(alpha.id).startDate).toBe('2024-02-01')
    store.update(child.id, { parentId: null })
    expect(store.getNode(alpha.id).children).toEqual([])
    expect(store.getRow(alpha.id).startDate).toBe('2024-02-01')
    expect(store.getRow(alpha.id).status).toBe('done')
  })
})

describe('setStatus', () => {
  it('changes only the status and derives progress', () => {
    const task = store.create({ title: 'Task' })
    expect(store.setStatus(task.id, 'done').progress).toBe(100)
    expect(store.setStatus(task.id, 'todo').progress).toBe(0)
    expect(store.setStatus(task.id, 'in_progress').progress).toBe(50)
  })

  it('accepts an explicit progress and validates the status', () => {
    const task = store.create({ title: 'Task' })
    const updated = store.setStatus(task.id, 'blocked', 42)
    expect(updated.status).toBe('blocked')
    expect(updated.progress).toBe(42)
    expectGanttError(() => store.setStatus(task.id, 'later'), 'status must be one of todo, in_progress, blocked, done')
    expectGanttError(() => store.setStatus('ghost', 'done'), 'task ghost was not found', 404)
  })
})

describe('delete', () => {
  it('deletes a leaf and reports its former parent', () => {
    const root = store.create({ title: 'Root' })
    const child = store.create({ title: 'Child', parentId: root.id })
    expect(store.delete(child.id)).toEqual({ id: child.id, parentId: root.id })
    expect(store.count()).toBe(1)
    expect(store.getRow(child.id)).toBeNull()
    expect(store.getRow(root.id).status).toBe('todo')
  })

  it('cascades through descendants', () => {
    const root = store.create({ title: 'Root' })
    const child = store.create({ title: 'Child', parentId: root.id })
    store.create({ title: 'Grandchild', parentId: child.id })
    expect(store.delete(root.id)).toEqual({ id: root.id, parentId: null })
    expect(store.count()).toBe(0)
  })

  it('rejects a missing id or unknown task', () => {
    expectGanttError(() => store.delete(''), 'id is required')
    expectGanttError(() => store.delete('ghost'), 'task ghost was not found', 404)
  })
})
