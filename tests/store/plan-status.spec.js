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
    landing: 'invest/premarket.sh',
    estimate: '2h',
    ...overrides,
  }
}

beforeEach(() => {
  store = new GanttStore(':memory:')
  store.upsertPlanBlocks('2026-11-16', [draft()])
})

afterEach(() => {
  store?.close()
  store = undefined
})

describe('setBlockStatus', () => {
  it('updates the status and returns the block', () => {
    const block = store.setBlockStatus('2026-11-16|08:00|0', 'done')
    expect(block).toMatchObject({ id: '2026-11-16|08:00|0', status: 'done', notes: '' })
    expect(store.dayPlan('2026-11-16').blocks[0].status).toBe('done')
    for (const status of ['todo', 'in_progress', 'done', 'skipped']) {
      expect(store.setBlockStatus('2026-11-16|08:00|0', /** @type {any} */ (status)).status).toBe(status)
    }
  })

  it('stores, keeps, and clears notes', () => {
    expect(store.setBlockStatus('2026-11-16|08:00|0', 'in_progress', 'halfway').notes).toBe('halfway')
    expect(store.setBlockStatus('2026-11-16|08:00|0', 'done').notes).toBe('halfway')
    expect(store.setBlockStatus('2026-11-16|08:00|0', 'todo', null).notes).toBe('')
    expect(store.setBlockStatus('2026-11-16|08:00|0', 'todo', 'x'.repeat(500)).notes).toHaveLength(500)
  })

  it('rejects an unknown id with 404', () => {
    expectGanttError(() => store.setBlockStatus('2026-11-16|99:99|9', 'done'), 'plan block 2026-11-16|99:99|9 was not found', 404)
  })

  it('validates the id, status vocabulary, and notes before writing', () => {
    expectGanttError(() => store.setBlockStatus(/** @type {any} */ (undefined), 'done'), 'id is required')
    expectGanttError(() => store.setBlockStatus('', 'done'), 'id is required')
    expectGanttError(() => store.setBlockStatus('2026-11-16|08:00|0', /** @type {any} */ ('blocked')), 'status must be one of todo, in_progress, done, skipped')
    expectGanttError(() => store.setBlockStatus('2026-11-16|08:00|0', 'done', /** @type {any} */ (7)), 'notes must be a string')
    expectGanttError(() => store.setBlockStatus('2026-11-16|08:00|0', 'done', 'x'.repeat(501)), 'notes must be at most 500 characters')
    expect(store.dayPlan('2026-11-16').blocks[0]).toMatchObject({ status: 'todo', notes: '' })
  })
})
