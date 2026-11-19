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

/** Create a linear chain and return every task in it. */
function chain() {
  const root = store.create({ title: 'Track', kind: 'track', startDate: '2024-01-01', endDate: '2024-01-31' })
  const second = store.create({ title: 'Node', parentId: root.id, startDate: '2024-01-01', endDate: '2024-01-31' })
  const third = store.create({ title: 'Sub node', parentId: second.id, startDate: '2024-01-01', endDate: '2024-01-31' })
  const fourth = store.create({ title: 'Leaf', parentId: third.id, startDate: '2024-01-01', endDate: '2024-01-31' })
  return { root, second, third, fourth }
}

describe('decompose', () => {
  it('creates child tasks and appends them after existing siblings', () => {
    const parent = store.create({ title: 'Parent', startDate: '2024-01-01', endDate: '2024-01-31', status: 'in_progress', progress: 40 })
    store.create({ title: 'Existing', parentId: parent.id, startDate: '2024-01-01', endDate: '2024-01-31' })
    const result = store.decompose(parent.id, [
      { title: ' First ', description: ' detail ', doneWhen: 'DW', dep: '1.1', land: 'ignored' },
      { title: 'Second', status: 'done' },
    ])
    expect(result.children.map(child => child.title)).toEqual(['First', 'Second'])
    expect(result.children.map(child => child.number)).toEqual(['1.2', '1.3'])
    expect(result.children[0]).toMatchObject({ kind: 'task', ref: '', state: '', source: 'manual', parentId: parent.id, description: 'detail', doneWhen: 'DW', dep: '1.1', status: 'todo', progress: 0, startDate: '2024-01-01', endDate: '2024-01-31', links: [] })
    expect(result.children[1]).toMatchObject({ status: 'done', progress: 100 })
    expect(result.blocks).toEqual([])
    expect(result.parent?.hasChildren).toBe(true)
    expect(store.count()).toBe(4)
  })

  it('defaults child dates to planDate or to the parent range', () => {
    const planned = store.create({ title: 'Planned parent', startDate: '2024-01-01', endDate: '2024-01-31' })
    expect(store.decompose(planned.id, [{ title: 'Planned' }], '2024-02-10').children[0])
      .toMatchObject({ startDate: '2024-02-10', endDate: '2024-02-13' })
    const inherited = store.create({ title: 'Inherited parent', startDate: '2024-01-01', endDate: '2024-01-31' })
    expect(store.decompose(inherited.id, [{ title: 'Inherited' }]).children[0])
      .toMatchObject({ startDate: '2024-01-01', endDate: '2024-01-31' })
    const explicit = store.create({ title: 'Explicit parent', startDate: '2024-01-01', endDate: '2024-01-31' })
    expect(store.decompose(explicit.id, [{ title: 'Explicit', startDate: '2024-03-01', endDate: '2024-03-02', progress: 33 }], '2024-02-10').children[0])
      .toMatchObject({ startDate: '2024-03-01', endDate: '2024-03-02', progress: 33 })
  })

  it('creates one plan cell per scheduled child with inherited content', () => {
    const parent = store.create({ title: 'Parent', startDate: '2024-01-01', endDate: '2024-01-31' })
    store.upsertPlanBlocks('2024-02-10', [{ title: 'Existing block', startTime: '08:00' }])
    const result = store.decompose(parent.id, [
      {
        title: 'Morning child',
        description: 'description wins',
        plan: { date: '2024-02-10', startTime: '09:00', endTime: '10:00', category: 'A', landing: 'a.md', estimate: '1h', inspiration: '#21' },
      },
      { title: 'Late child', doneWhen: 'done when', plan: { date: '2024-02-10', startTime: '20:00', endTime: '21:00' } },
    ])
    expect(result.blocks).toHaveLength(2)
    const [morning, late] = result.blocks
    expect(morning).toMatchObject({ id: `task|${result.children[0].id}|2024-02-10`, planDate: '2024-02-10', startTime: '09:00', endTime: '10:00', slot: 'morning', category: 'A', title: 'Morning child', detail: 'description wins', landing: 'a.md', estimate: '1h', inspiration: '#21', status: 'todo', source: 'task', sourceRef: `task:${result.children[0].id}`, sortOrder: 1 })
    expect(late).toMatchObject({ slot: 'evening', title: 'Late child', detail: 'done when', sortOrder: 2, category: '' })
    expect(store.dayPlan('2024-02-10').blocks.map(block => block.id)).toEqual([
      '2024-02-10|08:00|0', morning.id, late.id,
    ])
  })

  it('inherits the child metadata into its plan cell unless the plan overrides it', () => {
    const parent = store.create({ title: 'Parent', startDate: '2024-01-01', endDate: '2024-01-31' })
    const result = store.decompose(parent.id, [
      { title: 'Inherited', doneWhen: 'DW', landing: 'invest/a.md', estimate: '2h', category: 'A', inspiration: '#21', plan: { date: '2024-02-10' } },
      { title: 'Overridden', doneWhen: 'DW2', landing: 'child.md', estimate: '1h', category: 'B', inspiration: '#3', plan: { date: '2024-02-10', landing: '', estimate: '30min', category: '', inspiration: '#9' } },
    ], '2024-02-10')
    expect(result.blocks[0]).toMatchObject({
      title: 'Inherited', detail: 'DW', landing: 'invest/a.md', estimate: '2h', category: 'A', inspiration: '#21',
    })
    expect(result.blocks[1]).toMatchObject({
      title: 'Overridden', detail: 'DW2', landing: '', estimate: '30min', category: '', inspiration: '#9',
    })
    const integrity = store.dayPlan('2024-02-10').integrity.filter(item => item.code === 'landing-missing')
    expect(integrity).toEqual([{ code: 'landing-missing', blockId: result.blocks[1].id }])
  })

  it('derives the plan slot from the start time and accepts an explicit slot', () => {
    const parent = store.create({ title: 'Parent' })
    const result = store.decompose(parent.id, [
      { title: 'No clock', plan: { date: '2024-02-10' } },
      { title: 'Explicit', plan: { date: '2024-02-10', startTime: '09:00', slot: 'evening' } },
    ])
    expect(result.blocks[0].slot).toBe('other')
    expect(result.blocks[1].slot).toBe('evening')
  })

  it('allows three levels below the track root and rejects a fourth', () => {
    const { root, second, third, fourth } = chain()
    expect(() => store.decompose(root.id, [{ title: 'depth 2' }])).not.toThrow()
    expect(() => store.decompose(second.id, [{ title: 'depth 3' }])).not.toThrow()
    expect(() => store.decompose(third.id, [{ title: 'depth 4' }])).not.toThrow()
    expectGanttError(() => store.decompose(fourth.id, [{ title: 'depth 5' }]), 'decompose would exceed 4 levels')
    expect(store.getNode(third.id).children).toHaveLength(2)
  })

  it('accepts 100 children and rejects 101', () => {
    const parent = store.create({ title: 'Parent' })
    const children = Array.from({ length: 100 }, (unused, index) => ({ title: `Child ${index}` }))
    expect(store.decompose(parent.id, children).children).toHaveLength(100)
    expectGanttError(
      () => store.decompose(parent.id, [...children, { title: 'One more' }]),
      'a decompose may create at most 100 children',
    )
    expect(store.count()).toBe(101)
  })

  it('validates every child and rolls the whole call back', () => {
    const parent = store.create({ title: 'Parent' })
    expectGanttError(() => store.decompose(parent.id), 'children must be a non-empty array')
    expectGanttError(() => store.decompose(parent.id, /** @type {any} */ ('nope')), 'children must be a non-empty array')
    expectGanttError(() => store.decompose(parent.id, []), 'children must be a non-empty array')
    expectGanttError(() => store.decompose(parent.id, [/** @type {any} */ (null)]), 'children[0] must be an object')
    expectGanttError(() => store.decompose(parent.id, [{}]), 'title is required')
    expectGanttError(() => store.decompose(parent.id, [{ title: 'c', status: 'nope' }]), 'status must be one of todo, in_progress, blocked, done, cancelled')
    expectGanttError(() => store.decompose(parent.id, [{ title: 'c', progress: 'x' }]), 'progress must be a number from 0 to 100')
    expectGanttError(() => store.decompose(parent.id, [{ title: 'c', startDate: 'nope' }]), 'children[0].startDate must be a YYYY-MM-DD date')
    expectGanttError(
      () => store.decompose(parent.id, [{ title: 'c', startDate: '2024-02-02', endDate: '2024-02-01' }]),
      'endDate must not be before startDate',
    )
    expectGanttError(() => store.decompose(parent.id, [{ title: 'c', lane: 7 }]), 'children[0].lane must be a string')
    expectGanttError(() => store.decompose(parent.id, [{ title: 'c', links: 'x' }]), 'links must be an array')
    expectGanttError(
      () => store.decompose(parent.id, [{ title: 'ok' }, { title: 'bad', startDate: 'tomorrow' }]),
      'children[1].startDate must be a YYYY-MM-DD date',
    )
    expect(store.count()).toBe(1)
    expectGanttError(() => store.decompose('ghost', [{ title: 'c' }]), 'task ghost was not found', 404)
    expectGanttError(() => store.decompose('', [{ title: 'c' }]), 'id is required')
  })

  it('validates the optional plan date, clock, slot, and range', () => {
    const parent = store.create({ title: 'Parent' })
    expectGanttError(() => store.decompose(parent.id, [{ title: 'c' }], '2024-02-30'), 'planDate is not a valid calendar date')
    expectGanttError(() => store.decompose(parent.id, [{ title: 'c', plan: /** @type {any} */ (null) }]), 'children[0].plan must be an object')
    expectGanttError(() => store.decompose(parent.id, [{ title: 'c', plan: /** @type {any} */ ([]) }]), 'children[0].plan must be an object')
    expectGanttError(
      () => store.decompose(parent.id, [{ title: 'c', plan: { date: '2024-02-30' } }]),
      'children[0].plan.date is not a valid calendar date',
    )
    expectGanttError(
      () => store.decompose(parent.id, [{ title: 'c', plan: { date: '2024-02-10', startTime: '9:00' } }]),
      'children[0].plan.startTime must be an HH:MM time',
    )
    expectGanttError(
      () => store.decompose(parent.id, [{ title: 'c', plan: { date: '2024-02-10', endTime: '25:00' } }]),
      'children[0].plan.endTime must be an HH:MM time',
    )
    expectGanttError(
      () => store.decompose(parent.id, [{ title: 'c', plan: { date: '2024-02-10', slot: 'night' } }]),
      'children[0].plan.slot must be one of morning, daytime, evening, other',
    )
    expect(store.count()).toBe(1)
  })

  it('passes tags to the decomposed children and validates them', () => {
    const parent = store.create({ title: 'Parent' })
    const result = store.decompose(parent.id, [
      { title: 'Tagged', tags: ['alpha', ' alpha '] },
      { title: 'Plain' },
    ])
    expect(result.children[0].tags).toEqual(['alpha'])
    expect(result.children[1].tags).toEqual([])
    expectGanttError(() => store.decompose(parent.id, [{ title: 'c', tags: ['ok', 7] }]), 'tags[1] must be a string')
  })

  it('rolls parent and ancestor rollups up after the children are created', () => {
    const parent = store.create({ title: 'Parent', startDate: '2024-01-01', endDate: '2024-01-31', status: 'in_progress', progress: 40, kind: 'track' })
    store.decompose(parent.id, [
      { title: 'Early', startDate: '2023-12-01', endDate: '2023-12-02', status: 'done' },
      { title: 'Late', startDate: '2024-02-01', endDate: '2024-02-02' },
    ])
    const node = store.getNode(parent.id)
    expect(node.startDate).toBe('2023-12-01')
    expect(node.endDate).toBe('2024-02-02')
    expect(node.progress).toBe(50)
    expect(node.status).toBe('in_progress')
  })
})
