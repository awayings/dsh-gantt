import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore, addDays, todayIso } from '../../src/host/store.js'
import { expectGanttError } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

describe('split', () => {
  it('creates children with inherited dates, defaults, and parent rollups', () => {
    const parent = store.create({
      title: 'Parent',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      status: 'in_progress',
      progress: 40,
    })
    const result = store.split(parent.id, [
      { title: ' First ', description: ' detail ', status: 'done' },
      { title: 'Second', startDate: '2024-01-05', endDate: '2024-01-06', status: 'blocked', progress: 20 },
      { title: 'Third' },
    ])
    expect(result.parent.id).toBe(parent.id)
    expect(result.children.map(child => child.title)).toEqual(['First', 'Second', 'Third'])
    expect(result.children.map(child => child.number)).toEqual(['1.1', '1.2', '1.3'])
    expect(result.children[0].description).toBe('detail')
    expect(result.children[0].status).toBe('done')
    expect(result.children[0].progress).toBe(100)
    expect(result.children[0].startDate).toBe('2024-01-01')
    expect(result.children[0].endDate).toBe('2024-01-31')
    expect(result.children[1].progress).toBe(20)
    expect(result.children[1].startDate).toBe('2024-01-05')
    expect(result.children[2].status).toBe('todo')
    expect(result.children[2].progress).toBe(0)
    expect(result.children[2].startDate).toBe('2024-01-01')
    expect(result.parent.progress).toBe(40)
    expect(result.parent.status).toBe('blocked')
    expect(result.parent.startDate).toBe('2024-01-01')
    expect(result.parent.endDate).toBe('2024-01-31')
    expect(store.count()).toBe(4)
  })

  it('appends children after existing siblings', () => {
    const parent = store.create({ title: 'Parent' })
    const existing = store.create({ title: 'Existing', parentId: parent.id })
    const result = store.split(parent.id, [{ title: 'One' }, { title: 'Two' }])
    expect(result.children.map(child => child.number)).toEqual(['1.2', '1.3'])
    expect(result.children.map(child => child.sortOrder)).toEqual([1, 2])
    expect(store.getNode(existing.id).number).toBe('1.1')
  })

  it('extends the parent range from the split children', () => {
    const parent = store.create({ title: 'Parent', startDate: '2024-01-10', endDate: '2024-01-11' })
    const result = store.split(parent.id, [
      { title: 'Early', startDate: '2024-01-01', endDate: '2024-01-02' },
      { title: 'Late', startDate: '2024-01-20', endDate: '2024-01-21' },
    ])
    expect(result.parent.startDate).toBe('2024-01-01')
    expect(result.parent.endDate).toBe('2024-01-21')
  })

  it('accepts exactly 100 children', () => {
    const parent = store.create({ title: 'Parent' })
    const children = Array.from({ length: 100 }, (unused, index) => ({ title: `Child ${index}` }))
    const result = store.split(parent.id, children)
    expect(result.children).toHaveLength(100)
    expect(result.children[99].number).toBe('1.100')
    expect(store.count()).toBe(101)
  })

  it('rejects a missing, non-array, or empty children list', () => {
    const parent = store.create({ title: 'Parent' })
    expectGanttError(() => store.split(parent.id), 'children must be a non-empty array')
    expectGanttError(() => store.split(parent.id, 'nope'), 'children must be a non-empty array')
    expectGanttError(() => store.split(parent.id, []), 'children must be a non-empty array')
    expect(store.count()).toBe(1)
  })

  it('rejects a split of more than 100 children', () => {
    const parent = store.create({ title: 'Parent' })
    const children = Array.from({ length: 101 }, (unused, index) => ({ title: `Child ${index}` }))
    expectGanttError(() => store.split(parent.id, children), 'a split may create at most 100 children')
    expect(store.count()).toBe(1)
  })

  it('rejects non-object entries', () => {
    const parent = store.create({ title: 'Parent' })
    expectGanttError(() => store.split(parent.id, [null]), 'children[0] must be an object')
    expectGanttError(() => store.split(parent.id, ['text']), 'children[0] must be an object')
    expectGanttError(() => store.split(parent.id, [5]), 'children[0] must be an object')
  })

  it('validates each child field', () => {
    const parent = store.create({ title: 'Parent' })
    expectGanttError(() => store.split(parent.id, [{}]), 'title is required')
    expectGanttError(() => store.split(parent.id, [{ title: '  ' }]), 'title must not be empty')
    expectGanttError(() => store.split(parent.id, [{ title: 'c', description: 5 }]), 'description must be a string')
    expectGanttError(
      () => store.split(parent.id, [{ title: 'c', status: 'nope' }]),
      'status must be one of todo, in_progress, blocked, done, cancelled',
    )
    expectGanttError(
      () => store.split(parent.id, [{ title: 'c', progress: 'x' }]),
      'progress must be a number from 0 to 100',
    )
    expectGanttError(
      () => store.split(parent.id, [{ title: 'c', startDate: 'tomorrow' }]),
      'children[0].startDate must be a YYYY-MM-DD date',
    )
    expectGanttError(
      () => store.split(parent.id, [{ title: 'c', endDate: '2024-02-30' }]),
      'children[0].endDate is not a valid calendar date',
    )
    expectGanttError(
      () => store.split(parent.id, [{ title: 'c', startDate: '2024-01-10', endDate: '2024-01-09' }]),
      'endDate must not be before startDate',
    )
    expect(store.count()).toBe(1)
  })

  it('reports a missing split target', () => {
    expectGanttError(() => store.split('', [{ title: 'c' }]), 'id is required')
    expectGanttError(() => store.split('ghost', [{ title: 'c' }]), 'task ghost was not found', 404)
  })
})

describe('seed', () => {
  it('inserts the demo tree into an empty database', () => {
    const result = store.seed()
    expect(result).toEqual({ seeded: true, taskCount: 13 })
    expect(store.count()).toBe(13)
    const tree = store.tree()
    expect(tree.map(node => node.title)).toEqual(['DSH 插件发布', '个人季度计划'])
    expect(tree.map(node => node.number)).toEqual(['1', '2'])
    expect(tree[0].children.map(node => node.number)).toEqual(['1.1', '1.2', '1.3', '1.4'])
    expect(tree[0].children[1].children.map(node => node.number)).toEqual(['1.2.1', '1.2.2'])
    expect(tree[1].children.map(node => node.number)).toEqual(['2.1', '2.2', '2.3'])
  })

  it('anchors seeded dates on today', () => {
    store.seed()
    const tree = store.tree()
    const today = todayIso()
    expect(tree[0].startDate).toBe(addDays(today, -10))
    expect(tree[0].endDate).toBe(addDays(today, 24))
    expect(tree[1].startDate).toBe(addDays(today, -20))
    expect(tree[1].endDate).toBe(addDays(today, 45))
  })

  it('rolls seeded progress and status up the tree', () => {
    store.seed()
    const tree = store.tree()
    expect(tree[0].progress).toBe(45)
    expect(tree[0].status).toBe('in_progress')
    expect(tree[0].children[1].progress).toBe(80)
    expect(tree[0].children[1].status).toBe('in_progress')
    expect(tree[0].children[2].status).toBe('todo')
    expect(tree[1].progress).toBe(14)
    expect(tree[1].status).toBe('blocked')
    const stats = store.snapshot().stats
    expect(stats.total).toBe(13)
    expect(stats.done).toBe(2)
    expect(stats.blocked).toBeGreaterThanOrEqual(1)
  })

  it('refuses to seed a non-empty database', () => {
    store.seed()
    expect(store.seed()).toEqual({ seeded: false, taskCount: 13 })
    expect(store.count()).toBe(13)
  })

  it('refuses to seed a database with a single task', () => {
    store.create({ title: 'Only task' })
    expect(store.seed()).toEqual({ seeded: false, taskCount: 1 })
    expect(store.count()).toBe(1)
  })
})
