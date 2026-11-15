import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore, addDays, todayIso } from '../../src/host/store.js'

let store

/**
 * @param {string} title
 * @param {Partial<import('../../src/host/store.js').BlockDraft>} [overrides]
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
  it('returns active unified-tree nodes overlapping the day and the next six days', () => {
    const today = todayIso()
    store.replacePlan({
      tracks: [{ id: '1', name: '投资系统' }],
      nodes: [
        node('1.1', { state: '已过', startDate: addDays(today, -1), endDate: addDays(today, 1) }),
        node('1.2', { state: '撤销', startDate: addDays(today, -1), endDate: addDays(today, 1) }),
        node('1.3', { startDate: null, endDate: null }),
        node('1.4', { startDate: addDays(today, 7), endDate: addDays(today, 9) }),
        node('1.5', { startDate: addDays(today, -30), endDate: addDays(today, -2) }),
        node('1.6', { startDate: addDays(today, -1), endDate: addDays(today, 1) }),
        node('1.7', { startDate: addDays(today, 6), endDate: null }),
        node('1.8', { startDate: addDays(today, -5), endDate: null }),
        node('1.9', { startDate: addDays(today, 1), endDate: addDays(today, 8) }),
      ],
    })
    const bundle = store.dayPlan(today)
    expect(bundle.nodes.map(item => item.ref)).toEqual(['node:1.8', 'node:1.6', 'node:1.3', 'node:1.9', 'node:1.7'])
    expect(bundle.nodes[0]).toMatchObject({ kind: 'node', trackId: bundle.tracks[0].id, state: '进行', links: [] })
    expect(bundle.tracks).toHaveLength(1)
    expect(bundle.tracks[0]).toMatchObject({ ref: 'track:1', name: '投资系统', lane: '', priority: '', state: '' })
  })

  it('derives track ids from manual tracks and tolerates equal ordering keys', () => {
    const today = todayIso()
    const track = store.create({ title: 'Manual track', kind: 'track', startDate: today, endDate: today })
    const secondTrack = store.create({ title: 'Manual track two', kind: 'track', startDate: today, endDate: today })
    store.create({ title: 'Node A', kind: 'node', parentId: track.id, startDate: today, endDate: today })
    store.create({ title: 'Node B', kind: 'node', parentId: track.id, startDate: today, endDate: today })
    store.db.prepare('UPDATE tasks SET sort_order = 0 WHERE id IN (?, ?)').run(track.id, secondTrack.id)
    const bundle = store.dayPlan(today)
    expect(bundle.tracks.map(item => item.name).sort()).toEqual(['Manual track', 'Manual track two'])
    expect(bundle.nodes.map(item => item.title).sort()).toEqual(['Node A', 'Node B'])
    expect(bundle.nodes.every(item => item.trackId === track.id)).toBe(true)
  })

  it('caps the node window at twelve rows', () => {
    const today = todayIso()
    store.replacePlan({
      nodes: Array.from({ length: 13 }, (unused, index) => node(`1.${String(index).padStart(2, '0')}`, {
        startDate: today,
        endDate: today,
      })),
    })
    const nodes = store.dayPlan(today).nodes
    expect(nodes).toHaveLength(12)
    expect(nodes.map(item => item.ref)).toEqual([
      'node:1.00', 'node:1.01', 'node:1.02', 'node:1.03', 'node:1.04', 'node:1.05',
      'node:1.06', 'node:1.07', 'node:1.08', 'node:1.09', 'node:1.10', 'node:1.11',
    ])
  })
})
