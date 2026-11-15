import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore } from '../../store.js'
import { expectGanttError } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** Create one task carrying every schedulable field. */
function schedulableTask() {
  return store.create({ title: 'S2 daily reading', doneWhen: 'one reading a day', landing: 'invest/board.md', estimate: '2h', category: 'A', inspiration: '#21' })
}

describe('scheduleTask', () => {
  it('creates a task-sourced plan cell and inherits task fields', () => {
    const task = store.create({ title: 'S2 daily reading', doneWhen: 'one reading a day', landing: 'invest/board.md', estimate: '2h', category: 'A', inspiration: '#21' })
    store.upsertPlanBlocks('2024-02-10', [{ title: 'Existing', startTime: '08:00' }])
    const { block, task: refreshed } = store.scheduleTask(task.id, {
      date: '2024-02-10',
      startTime: '21:00',
      endTime: '22:00',
    })
    expect(refreshed?.id).toBe(task.id)
    expect(block).toMatchObject({ id: `task|${task.id}|2024-02-10`, planDate: '2024-02-10', startTime: '21:00', endTime: '22:00', slot: 'evening', category: 'A', title: 'S2 daily reading', detail: 'one reading a day', landing: 'invest/board.md', estimate: '2h', inspiration: '#21', status: 'todo', notes: '', sortOrder: 1, source: 'task', sourceRef: `task:${task.id}` })
    expect(store.dayPlan('2024-02-10').blocks.map(item => item.id)).toEqual(['2024-02-10|08:00|0', block.id])
  })

  it('lets every optional input override the inherited value', () => {
    const task = schedulableTask()
    const { block } = store.scheduleTask(task.id, {
      date: '2024-02-10',
      startTime: '09:00',
      endTime: '10:00',
      slot: 'daytime',
      category: 'B',
      landing: 'other.md',
      estimate: '30min',
      inspiration: '#8',
      detail: 'explicit detail',
    })
    expect(block).toMatchObject({ startTime: '09:00', endTime: '10:00', slot: 'daytime', category: 'B', landing: 'other.md', estimate: '30min', inspiration: '#8', detail: 'explicit detail' })
    const bare = store.create({ title: 'Bare' })
    expect(store.scheduleTask(bare.id, { date: '2024-02-10' }).block).toMatchObject({ startTime: '', endTime: '', slot: 'other', category: '', detail: '', sortOrder: 1 })
  })

  it('derives the slot from the clock when none is supplied', () => {
    const task = schedulableTask()
    expect(store.scheduleTask(task.id, { date: '2024-02-10', startTime: '09:59' }).block.slot).toBe('morning')
    expect(store.scheduleTask(task.id, { date: '2024-02-10', startTime: '12:00' }).block.slot).toBe('daytime')
    expect(store.scheduleTask(task.id, { date: '2024-02-10', startTime: '19:30' }).block.slot).toBe('evening')
  })

  it('is idempotent per task and date and preserves user status and notes', () => {
    const task = schedulableTask()
    const first = store.scheduleTask(task.id, { date: '2024-02-10', startTime: '09:00' }).block
    store.setBlockStatus(first.id, 'done', 'shipped')
    const second = store.scheduleTask(task.id, { date: '2024-02-10', startTime: '10:00', detail: 'changed' }).block
    expect(second).toMatchObject({ id: first.id, startTime: '10:00', detail: 'changed', status: 'done', notes: 'shipped', sortOrder: first.sortOrder })
    expect(store.dayPlan('2024-02-10').blocks).toHaveLength(1)
    const otherDay = store.scheduleTask(task.id, { date: '2024-02-11', startTime: '09:00' }).block
    expect(otherDay.id).toBe(`task|${task.id}|2024-02-11`)
    expect(store.dayPlan('2024-02-10').blocks).toHaveLength(1)
  })

  it('validates the id, date, clock, and slot', () => {
    const task = schedulableTask()
    expectGanttError(() => store.scheduleTask('', { date: '2024-02-10' }), 'id is required')
    expectGanttError(() => store.scheduleTask('ghost', { date: '2024-02-10' }), 'task ghost was not found', 404)
    expectGanttError(() => store.scheduleTask(task.id, {}), 'date must be a YYYY-MM-DD date')
    expectGanttError(() => store.scheduleTask(task.id, { date: '2024-02-30' }), 'date is not a valid calendar date')
    expectGanttError(() => store.scheduleTask(task.id, { date: '2024-02-10', startTime: '9:00' }), 'startTime must be an HH:MM time')
    expectGanttError(() => store.scheduleTask(task.id, { date: '2024-02-10', endTime: '25:00' }), 'endTime must be an HH:MM time')
    expectGanttError(() => store.scheduleTask(task.id, { date: '2024-02-10', slot: 'night' }), 'slot must be one of morning, daytime, evening, other')
    expect(store.dayPlan('2024-02-10').blocks).toEqual([])
  })
})
