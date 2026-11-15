import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore } from '../../store.js'

let store

/**
 * @param {string} title
 * @param {Partial<import('../../store.js').BlockDraft>} [overrides]
 */
function draft(title, overrides = {}) {
  return { title, startTime: '09:00', endTime: '10:00', slot: 'morning', landing: 'x.md', estimate: '1h', ...overrides }
}

/**
 * @param {string} id
 * @param {Partial<{ id: string, trackId: string, title: string, state: string, startDate: string | null,
 * endDate: string | null, dep: string, doneWhen: string }>} [overrides]
 */
function node(id, overrides = {}) {
  return { id, trackId: '1', title: id, state: '进行', ...overrides }
}

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

describe('dayPlan integrity', () => {
  it('reports an unplanned empty day', () => {
    const bundle = store.dayPlan('2026-11-15')
    expect(bundle.day).toBeNull()
    expect(bundle.blocks).toEqual([])
    expect(bundle.integrity).toEqual([{ code: 'evening-missing' }, { code: 'unplanned-day' }])
    expect(bundle.stats).toEqual({ total: 0, done: 0, inProgress: 0, skipped: 0, remaining: 0 })
  })

  it('reports landing-missing per block', () => {
    store.replacePlan({ days: [{ date: '2026-11-15' }] })
    store.upsertPlanBlocks('2026-11-15', [draft('没有落点', { landing: '' }), draft('有落点')])
    expect(store.dayPlan('2026-11-15').integrity).toEqual([
      { code: 'landing-missing', blockId: '2026-11-15|09:00|0' },
      { code: 'evening-missing' },
    ])
  })

  it('reports a missing evening slot and a missing inspiration id only for evening blocks', () => {
    store.replacePlan({ days: [{ date: '2026-11-15' }] })
    store.upsertPlanBlocks('2026-11-15', [draft('上午', { startTime: '09:00', slot: 'morning' })])
    expect(store.dayPlan('2026-11-15').integrity).toEqual([{ code: 'evening-missing' }])
    store.upsertPlanBlocks('2026-11-15', [
      draft('上午', { startTime: '09:00', slot: 'morning' }),
      draft('晚格', { startTime: '21:00', endTime: '22:00', slot: 'evening' }),
    ])
    expect(store.dayPlan('2026-11-15').integrity).toEqual([{ code: 'inspiration-missing', blockId: '2026-11-15|21:00|1' }])
    store.upsertPlanBlocks('2026-11-15', [
      draft('上午', { startTime: '09:00', slot: 'morning' }),
      draft('晚格', { startTime: '21:00', endTime: '22:00', slot: 'evening', inspiration: '#21' }),
    ])
    expect(store.dayPlan('2026-11-15').integrity).toEqual([])
  })

  it('keeps warning order deterministic', () => {
    store.upsertPlanBlocks('2026-11-15', [
      draft('没有落点', { landing: '' }),
      draft('晚格', { startTime: '21:00', endTime: '22:00', slot: 'evening', landing: '' }),
    ])
    expect(store.dayPlan('2026-11-15').integrity).toEqual([
      { code: 'landing-missing', blockId: '2026-11-15|09:00|0' },
      { code: 'landing-missing', blockId: '2026-11-15|21:00|1' },
      { code: 'inspiration-missing', blockId: '2026-11-15|21:00|1' },
      { code: 'unplanned-day' },
    ])
  })
})

describe('dayPlan stats', () => {
  it('counts statuses and leaves done/skipped out of remaining', () => {
    store.upsertPlanBlocks('2026-11-15', [
      draft('done', { startTime: '09:00' }),
      draft('in progress', { startTime: '10:00' }),
      draft('skipped', { startTime: '11:00' }),
      draft('todo', { startTime: '12:00' }),
    ])
    store.setBlockStatus('2026-11-15|09:00|0', 'done')
    store.setBlockStatus('2026-11-15|10:00|1', 'in_progress')
    store.setBlockStatus('2026-11-15|11:00|2', 'skipped')
    expect(store.dayPlan('2026-11-15').stats).toEqual({ total: 4, done: 1, inProgress: 1, skipped: 1, remaining: 2 })
  })

  it('sorts blocks by order, start time, then id', () => {
    store.upsertPlanBlocks('2026-11-15', [
      draft('later', { startTime: '12:00' }),
      draft('earlier', { startTime: '08:00' }),
    ])
    expect(store.dayPlan('2026-11-15').blocks.map(block => block.title)).toEqual(['later', 'earlier'])
  })

  it('rejects an invalid date', () => {
    expect(() => store.dayPlan('2026-11-15x')).toThrow('date must be a YYYY-MM-DD date')
  })
})

describe('dayPlan node window', () => {
  it('returns active nodes overlapping the next seven days, newest first by id tie-break', () => {
    store.replacePlan({
      tracks: [{ id: '1', name: '投资系统' }],
      nodes: [
        node('1.1', { state: '已过', startDate: '2026-11-15', endDate: '2026-11-20' }),
        node('1.2', { state: '撤销', startDate: '2026-11-15', endDate: '2026-11-20' }),
        node('1.3', { startDate: null, endDate: null }),
        node('1.4', { startDate: '2026-11-22', endDate: '2026-11-30' }),
        node('1.5', { startDate: '2026-10-01', endDate: '2026-11-14' }),
        node('1.6', { startDate: '2026-11-09', endDate: '2026-11-15' }),
        node('1.7', { startDate: '2026-11-21', endDate: null }),
        node('1.8', { startDate: '2026-11-10', endDate: null }),
        node('1.9', { startDate: '2026-11-16', endDate: '2026-11-22' }),
      ],
    })
    const bundle = store.dayPlan('2026-11-15')
    expect(bundle.nodes.map(item => item.id)).toEqual(['1.6', '1.8', '1.9', '1.7'])
    expect(bundle.tracks).toHaveLength(1)
  })

  it('caps the node window at twelve rows', () => {
    store.replacePlan({
      nodes: Array.from({ length: 13 }, (unused, index) => node(`1.${String(index).padStart(2, '0')}`, {
        startDate: '2026-11-16',
        endDate: '2026-11-16',
      })),
    })
    expect(store.dayPlan('2026-11-16').nodes).toHaveLength(12)
  })
})
