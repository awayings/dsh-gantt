import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore } from '../../store.js'
import { expectGanttError } from '../helpers/gantt.js'

let store

/** @param {Partial<import('../../store.js').BlockDraft>} [overrides] */
function draft(overrides = {}) {
  return {
    title: '盘前决策流程',
    startTime: '08:00',
    endTime: '10:00',
    slot: 'morning',
    category: '固定',
    detail: '盘前决策流程 —— 固定程序',
    landing: 'invest/premarket.sh',
    estimate: '2h',
    inspiration: '',
    sourceRef: 'SCHEDULE.md',
    ...overrides,
  }
}

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

describe('upsertPlanBlocks', () => {
  it('inserts deterministic ids and maps every content field', () => {
    const counts = store.upsertPlanBlocks('2026-11-15', [
      draft(),
      draft({ title: '认知输出补回', startTime: '21:00', endTime: '22:00', slot: 'evening', inspiration: '#21', estimate: '≤1h' }),
    ])
    expect(counts).toEqual({ inserted: 2, updated: 0, removed: 0 })
    const { blocks } = store.dayPlan('2026-11-15')
    expect(blocks.map(block => block.id)).toEqual(['2026-11-15|08:00|0', '2026-11-15|21:00|1'])
    expect(blocks[0]).toEqual({
      id: '2026-11-15|08:00|0',
      planDate: '2026-11-15',
      startTime: '08:00',
      endTime: '10:00',
      slot: 'morning',
      category: '固定',
      title: '盘前决策流程',
      detail: '盘前决策流程 —— 固定程序',
      landing: 'invest/premarket.sh',
      estimate: '2h',
      inspiration: '',
      status: 'todo',
      notes: '',
      sortOrder: 0,
      source: 'schedule',
      sourceRef: 'SCHEDULE.md',
    })
    expect(blocks[1]).toMatchObject({ sortOrder: 1, slot: 'evening', inspiration: '#21' })
  })

  it('defaults optional draft fields', () => {
    store.upsertPlanBlocks('2026-11-15', [{ title: '只有标题' }])
    expect(store.dayPlan('2026-11-15').blocks[0]).toMatchObject({
      startTime: '',
      endTime: '',
      slot: 'other',
      category: '',
      detail: '',
      landing: '',
      estimate: '',
      inspiration: '',
      sourceRef: '',
    })
  })

  it('keeps ids stable and preserves user status and notes on re-import', () => {
    store.upsertPlanBlocks('2026-11-15', [draft()])
    store.setBlockStatus('2026-11-15|08:00|0', 'in_progress', 'halfway')
    const counts = store.upsertPlanBlocks('2026-11-15', [draft({ title: '改名后的标题', detail: '新细节', landing: 'new.md' })])
    expect(counts).toEqual({ inserted: 0, updated: 1, removed: 0 })
    const block = store.dayPlan('2026-11-15').blocks[0]
    expect(block).toMatchObject({ id: '2026-11-15|08:00|0', title: '改名后的标题', detail: '新细节', landing: 'new.md', status: 'in_progress', notes: 'halfway' })
  })

  it('removes schedule rows that disappeared and leaves manual rows alone', () => {
    store.upsertPlanBlocks('2026-11-15', [draft(), draft({ title: '第二条', startTime: '10:00', endTime: '12:00', slot: 'daytime' })])
    store.db.prepare(`INSERT INTO plan_blocks (id, plan_date, start_time, end_time, slot, title, source, created_at, updated_at)
      VALUES ('manual|1', '2026-11-15', '12:00', '13:00', 'daytime', '手工块', 'manual', 'now', 'now')`).run()
    const counts = store.upsertPlanBlocks('2026-11-15', [draft({ title: '只留这条' })])
    expect(counts).toEqual({ inserted: 0, updated: 1, removed: 1 })
    const ids = store.dayPlan('2026-11-15').blocks.map(block => block.id)
    expect(ids).toEqual(['2026-11-15|08:00|0', 'manual|1'])
  })

  it('removes every schedule row when the day loses its table', () => {
    store.upsertPlanBlocks('2026-11-15', [draft()])
    store.db.prepare(`INSERT INTO plan_blocks (id, plan_date, start_time, end_time, slot, title, source, created_at, updated_at)
      VALUES ('manual|1', '2026-11-15', '12:00', '13:00', 'daytime', '手工块', 'manual', 'now', 'now')`).run()
    expect(store.upsertPlanBlocks('2026-11-15', [])).toEqual({ inserted: 0, updated: 0, removed: 1 })
    expect(store.dayPlan('2026-11-15').blocks.map(block => block.id)).toEqual(['manual|1'])
    expect(store.upsertPlanBlocks('2026-11-15', /** @type {any} */ (undefined))).toEqual({ inserted: 0, updated: 0, removed: 0 })
  })

  it('leaves other dates untouched', () => {
    store.upsertPlanBlocks('2026-11-15', [draft()])
    store.upsertPlanBlocks('2026-11-16', [draft()])
    store.upsertPlanBlocks('2026-11-15', [])
    expect(store.dayPlan('2026-11-16').blocks).toHaveLength(1)
  })

  it('validates dates, drafts, times, slots, and titles before writing', () => {
    store.upsertPlanBlocks('2026-11-15', [draft()])
    expectGanttError(() => store.upsertPlanBlocks('2026-02-30', [draft()]), 'date is not a valid calendar date')
    expectGanttError(() => store.upsertPlanBlocks('2026-11-15', /** @type {any} */ ('nope')), 'blocks must be an array')
    expectGanttError(() => store.upsertPlanBlocks('2026-11-15', /** @type {any} */ ([null])), 'blocks[0] must be an object')
    expectGanttError(() => store.upsertPlanBlocks('2026-11-15', [/** @type {any} */ ({})]), 'blocks[0].title is required')
    expectGanttError(() => store.upsertPlanBlocks('2026-11-15', [draft({ startTime: '9:00' })]), 'blocks[0].startTime must be an HH:MM time')
    expectGanttError(() => store.upsertPlanBlocks('2026-11-15', [draft({ endTime: '25:00' })]), 'blocks[0].endTime must be an HH:MM time')
    expectGanttError(() => store.upsertPlanBlocks('2026-11-15', [draft({ slot: /** @type {any} */ ('night') })]), 'blocks[0].slot must be one of morning, daytime, evening, other')
    expect(store.dayPlan('2026-11-15').blocks).toHaveLength(1)
  })
})
