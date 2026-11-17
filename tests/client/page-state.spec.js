// The Gantt page is a global main panel that the shell remounts on a client
// rebuild or a browser reload. These cases pin the localStorage record that
// gives the page back with the same depth, filter, folded tasks, scroll
// offsets, timeline window, highlighted task, work panel and work mode,
// including every hostile shape a stored record can take.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FILTERS,
  LEGACY_WORK_MODE_KEY,
  LEVELS,
  PAGE_STATE_KEY,
  PAGE_STATE_VERSION,
  PANEL_TABS,
  SCALES,
  readPageState,
  sanitizePageState,
  writePageState,
} from '../../src/client/page-state.js'

/** A complete record as writePageState stores it. */
function record(overrides = {}) {
  return {
    v: PAGE_STATE_VERSION,
    level: 2,
    filter: 'active',
    collapsed: ['1.1'],
    scrollTop: 40,
    scrollLeft: 8,
    scale: 'month',
    anchor: '2026-03-09',
    selectedId: 'task-9',
    panelTaskId: 'task-7',
    panelTab: 'skills',
    workMode: true,
    ...overrides,
  }
}

/** The view a record with no usable field reads back as. */
function defaults(overrides = {}) {
  return {
    level: 99,
    filter: 'all',
    collapsed: [],
    scrollTop: 0,
    scrollLeft: 0,
    scale: 'week',
    anchor: null,
    selectedId: null,
    panelTaskId: null,
    panelTab: 'task',
    workMode: false,
    ...overrides,
  }
}

/** The parsed record currently stored, or null. */
function stored() {
  const raw = localStorage.getItem(PAGE_STATE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

/** @type {(() => void)[]} */
let restores = []

/**
 * Replace globalThis.localStorage for one case and hand back the undo.
 * @param {PropertyDescriptor} descriptor
 * @returns {() => void}
 */
function replaceStorage(descriptor) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor })
  return () => {
    if (original === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
    else Object.defineProperty(globalThis, 'localStorage', original)
  }
}

beforeEach(() => {
  restores = []
})

afterEach(() => {
  for (const restore of restores.splice(0)) restore()
  try {
    localStorage.clear()
  } catch {
    // A case that leaves storage absent has nothing to clear.
  }
})

describe('page-state constants', () => {
  it('pins the keys, schema version, filters, levels, scales and panel tabs', () => {
    expect(PAGE_STATE_KEY).toBe('gantt.pageState')
    expect(PAGE_STATE_VERSION).toBe(2)
    expect(LEGACY_WORK_MODE_KEY).toBe('gantt.workMode')
    expect(FILTERS).toEqual(['all', 'unfinished', 'active', 'frontier', 'next', 'today', 'done'])
    expect(LEVELS).toEqual([99, 2, 1])
    expect(SCALES).toEqual(['week', 'month'])
    expect(PANEL_TABS).toEqual(['task', 'skills', 'team'])
  })
})

describe('sanitizePageState', () => {
  it('round-trips a complete record', () => {
    expect(sanitizePageState(record())).toEqual({
      level: 2,
      filter: 'active',
      collapsed: ['1.1'],
      scrollTop: 40,
      scrollLeft: 8,
      scale: 'month',
      anchor: '2026-03-09',
      selectedId: 'task-9',
      panelTaskId: 'task-7',
      panelTab: 'skills',
      workMode: true,
    })
  })

  it('rejects anything that is not a version-2 plain object', () => {
    const rejected = [
      null,
      undefined,
      42,
      '00',
      true,
      [],
      [record()],
      {},
      record({ v: 1 }),
      { v: 3 },
      { v: '2' },
      { v: 0, level: 1 },
    ]
    for (const raw of rejected) expect(sanitizePageState(raw)).toBeNull()
  })

  it('fills every missing field with the page defaults', () => {
    expect(sanitizePageState({ v: PAGE_STATE_VERSION })).toEqual(defaults())
  })

  it('keeps every supported level and drops the rest', () => {
    for (const level of LEVELS) expect(sanitizePageState(record({ level })).level).toBe(level)
    for (const level of [0, 3, 98, '2', null, undefined, {}, []]) {
      expect(sanitizePageState(record({ level })).level).toBe(99)
    }
  })

  it('keeps every supported filter and drops the rest', () => {
    for (const filter of FILTERS) expect(sanitizePageState(record({ filter })).filter).toBe(filter)
    for (const filter of ['bogus', '', null, 7, undefined]) {
      expect(sanitizePageState(record({ filter })).filter).toBe('all')
    }
  })

  it('treats a non-array collapsed value as nothing folded', () => {
    for (const collapsed of ['1.1', 42, null, undefined, { 1: '1.1' }]) {
      expect(sanitizePageState(record({ collapsed })).collapsed).toEqual([])
    }
  })

  it('drops unusable ids but keeps one- and 200-character ids', () => {
    const longest = 'y'.repeat(200)
    const collapsed = ['ok', 42, null, '', 'x'.repeat(201), longest, 'second']
    expect(sanitizePageState(record({ collapsed })).collapsed).toEqual(['ok', longest, 'second'])
  })

  it('deduplicates ids in first-seen order', () => {
    const collapsed = ['a', 'b', 'a', 'c', 'b', 'a']
    expect(sanitizePageState(record({ collapsed })).collapsed).toEqual(['a', 'b', 'c'])
  })

  it('caps a huge collapsed list at 2000 ids', () => {
    const collapsed = Array.from({ length: 2001 }, (_value, index) => `task-${index}`)
    const result = sanitizePageState(record({ collapsed })).collapsed
    expect(result).toHaveLength(2000)
    expect(result[0]).toBe('task-0')
    expect(result.at(-1)).toBe('task-1999')
  })

  it('rounds positive finite scroll offsets', () => {
    expect(sanitizePageState(record({ scrollTop: 12.4, scrollLeft: 12.5 }))).toMatchObject({
      scrollTop: 12,
      scrollLeft: 13,
    })
    expect(sanitizePageState(record({ scrollTop: 0.6, scrollLeft: 0.4 }))).toMatchObject({
      scrollTop: 1,
      scrollLeft: 0,
    })
  })

  it('treats unusable scroll offsets as the start', () => {
    const unusable = [0, -1, -0.5, NaN, Infinity, -Infinity, '12', null, undefined, {}, []]
    for (const offset of unusable) {
      expect(sanitizePageState(record({ scrollTop: offset, scrollLeft: offset }))).toMatchObject({
        scrollTop: 0,
        scrollLeft: 0,
      })
    }
  })

  it('clamps scroll offsets to ten million pixels', () => {
    expect(sanitizePageState(record({ scrollTop: 10_000_000, scrollLeft: 10_000_000 }))).toMatchObject({
      scrollTop: 10_000_000,
      scrollLeft: 10_000_000,
    })
    expect(sanitizePageState(record({ scrollTop: 10_000_001, scrollLeft: 1e12 }))).toMatchObject({
      scrollTop: 10_000_000,
      scrollLeft: 10_000_000,
    })
  })

  it('keeps every supported timeline scale and drops the rest', () => {
    for (const scale of SCALES) expect(sanitizePageState(record({ scale })).scale).toBe(scale)
    for (const scale of ['day', 'Week', '', null, 2, undefined, {}, []]) {
      expect(sanitizePageState(record({ scale })).scale).toBe('week')
    }
  })

  it('keeps a real calendar anchor day', () => {
    for (const anchor of ['2026-03-09', '2024-02-29', '2000-01-01']) {
      expect(sanitizePageState(record({ anchor })).anchor).toBe(anchor)
    }
  })

  it('drops anchors that are not a real calendar day', () => {
    const hostile = [
      '2026-02-30',
      '2025-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-01-32',
      '26-01-01',
      '2026-1-01',
      '2026-01-01T00:00:00Z',
      '',
      42,
      null,
      undefined,
      {},
      [],
    ]
    for (const anchor of hostile) {
      expect(sanitizePageState(record({ anchor })).anchor).toBeNull()
    }
  })

  it('keeps short non-empty selected and panel task ids', () => {
    const longest = 'z'.repeat(200)
    const result = sanitizePageState(record({ selectedId: longest, panelTaskId: 'task-1' }))
    expect(result.selectedId).toBe(longest)
    expect(result.panelTaskId).toBe('task-1')
  })

  it('drops unusable selected and panel task ids', () => {
    for (const id of ['', 42, null, undefined, {}, [], 'z'.repeat(201)]) {
      const result = sanitizePageState(record({ selectedId: id, panelTaskId: id }))
      expect(result.selectedId).toBeNull()
      expect(result.panelTaskId).toBeNull()
    }
  })

  it('keeps every supported panel tab and drops the rest', () => {
    for (const panelTab of PANEL_TABS) {
      expect(sanitizePageState(record({ panelTab })).panelTab).toBe(panelTab)
    }
    for (const panelTab of ['bogus', '', null, 2, undefined, {}]) {
      expect(sanitizePageState(record({ panelTab })).panelTab).toBe('task')
    }
  })

  it('only trusts a literal work-mode true', () => {
    expect(sanitizePageState(record()).workMode).toBe(true)
    for (const workMode of [false, 'true', '1', 1, {}, [], null, undefined]) {
      expect(sanitizePageState(record({ workMode })).workMode).toBe(false)
    }
  })

  it('drops unknown keys instead of restoring them', () => {
    const result = sanitizePageState({ ...record(), extra: 'x', nested: { v: 1 } })
    expect(Object.keys(result)).toEqual([
      'level',
      'filter',
      'collapsed',
      'scrollTop',
      'scrollLeft',
      'scale',
      'anchor',
      'selectedId',
      'panelTaskId',
      'panelTab',
      'workMode',
    ])
    expect(result).not.toHaveProperty('v')
    expect(result).not.toHaveProperty('extra')
  })
})

describe('readPageState', () => {
  it('reads and normalizes a stored record', () => {
    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify(record({
      level: 1,
      filter: 'today',
      scale: 'week',
      anchor: null,
    })))
    expect(readPageState()).toEqual({
      level: 1,
      filter: 'today',
      collapsed: ['1.1'],
      scrollTop: 40,
      scrollLeft: 8,
      scale: 'week',
      anchor: null,
      selectedId: 'task-9',
      panelTaskId: 'task-7',
      panelTab: 'skills',
      workMode: true,
    })
  })

  it('falls back to defaults for a valid record with unusable fields', () => {
    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify(record({
      level: 0,
      filter: 'nope',
      collapsed: 'nope',
      scrollTop: -1,
      scrollLeft: 'x',
      scale: 'day',
      anchor: '2026-02-30',
      selectedId: 42,
      panelTaskId: 'x'.repeat(201),
      panelTab: 'bogus',
      workMode: 'true',
    })))
    expect(readPageState()).toEqual(defaults())
  })

  it('has no state before the first visit', () => {
    expect(readPageState()).toBeNull()
  })

  it('ignores malformed JSON even when a legacy switch is on', () => {
    localStorage.setItem(PAGE_STATE_KEY, '{not json')
    localStorage.setItem(LEGACY_WORK_MODE_KEY, '1')
    expect(readPageState()).toBeNull()
  })

  it('ignores JSON values that are not records', () => {
    for (const raw of ['null', '"x"', '[]', '42', 'true', '{}']) {
      localStorage.setItem(PAGE_STATE_KEY, raw)
      expect(readPageState()).toBeNull()
    }
  })

  it('ignores records written by another schema version', () => {
    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify(record({ v: 3 })))
    expect(readPageState()).toBeNull()

    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify(record({ v: 0 })))
    expect(readPageState()).toBeNull()
  })

  it('restores the defaults plus work mode from the standalone switch', () => {
    localStorage.setItem(LEGACY_WORK_MODE_KEY, '1')
    expect(readPageState()).toEqual(defaults({ workMode: true }))
  })

  it('carries a version 1 record forward with the defaults for the new fields', () => {
    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify({
      v: 1,
      level: 1,
      filter: 'done',
      collapsed: ['1.1', '2.1'],
      scrollTop: 400,
      scrollLeft: 30,
    }))
    expect(readPageState()).toEqual(defaults({
      level: 1,
      filter: 'done',
      collapsed: ['1.1', '2.1'],
      scrollTop: 400,
      scrollLeft: 30,
    }))
  })

  it('normalizes the fields of the version 1 record it carries forward', () => {
    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify({
      v: 1,
      level: 7,
      filter: 'bogus',
      collapsed: [null, '1.1', '1.1'],
      scrollTop: -4,
      scrollLeft: 2.6,
    }))
    expect(readPageState()).toEqual(defaults({ collapsed: ['1.1'], scrollLeft: 3 }))
  })

  it('treats an empty version 1 record as the default view', () => {
    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify({ v: 1 }))
    expect(readPageState()).toEqual(defaults())
  })

  it('migrates the version 1 view and the standalone work-mode switch', () => {
    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify({
      v: 1,
      level: 2,
      filter: 'unfinished',
      collapsed: ['1.1'],
      scrollTop: 120,
      scrollLeft: 6,
    }))
    localStorage.setItem(LEGACY_WORK_MODE_KEY, '1')
    expect(readPageState()).toEqual(defaults({
      level: 2,
      filter: 'unfinished',
      collapsed: ['1.1'],
      scrollTop: 120,
      scrollLeft: 6,
      workMode: true,
    }))
  })

  it('prefers a version-2 record over the standalone switch', () => {
    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify(record({ workMode: false })))
    localStorage.setItem(LEGACY_WORK_MODE_KEY, '1')
    expect(readPageState()).toEqual({
      level: 2,
      filter: 'active',
      collapsed: ['1.1'],
      scrollTop: 40,
      scrollLeft: 8,
      scale: 'month',
      anchor: '2026-03-09',
      selectedId: 'task-9',
      panelTaskId: 'task-7',
      panelTab: 'skills',
      workMode: false,
    })
  })

  it('ignores a standalone switch that is not on', () => {
    for (const value of ['0', '', 'true', 'yes', 'false']) {
      localStorage.setItem(LEGACY_WORK_MODE_KEY, value)
      expect(readPageState()).toBeNull()
    }
  })

  it('treats a storage getter that throws as no state', () => {
    restores.push(replaceStorage({
      get() {
        throw new Error('denied')
      },
    }))
    expect(() => readPageState()).not.toThrow()
    expect(readPageState()).toBeNull()
  })

  it('treats absent storage as no state', () => {
    restores.push(replaceStorage({ value: undefined }))
    expect(() => readPageState()).not.toThrow()
    expect(readPageState()).toBeNull()
  })

  it('treats a failing getItem as no state', () => {
    restores.push(replaceStorage({
      value: {
        getItem() {
          throw new Error('denied')
        },
      },
    }))
    expect(readPageState()).toBeNull()
  })
})

describe('writePageState', () => {
  const state = {
    level: 1,
    filter: 'today',
    collapsed: ['2', '3'],
    scrollTop: 120,
    scrollLeft: 4,
    scale: 'month',
    anchor: '2026-03-09',
    selectedId: 'task-2',
    panelTaskId: 'task-3',
    panelTab: 'team',
    workMode: true,
  }

  it('stores the exact versioned record under PAGE_STATE_KEY', () => {
    writePageState(state)

    const raw = stored()
    expect(raw.v).toBe(PAGE_STATE_VERSION)
    expect(Object.keys(raw)).toEqual([
      'v',
      'level',
      'filter',
      'collapsed',
      'scrollTop',
      'scrollLeft',
      'scale',
      'anchor',
      'selectedId',
      'panelTaskId',
      'panelTab',
      'workMode',
    ])
    expect(raw).toEqual({ v: PAGE_STATE_VERSION, ...state })
  })

  it('round-trips the state through readPageState', () => {
    writePageState(state)
    expect(readPageState()).toEqual(state)
  })

  it('writes the record and then clears the standalone switch', () => {
    const calls = []
    restores.push(replaceStorage({
      value: {
        getItem: () => null,
        setItem(key) {
          calls.push(['set', key])
        },
        removeItem(key) {
          calls.push(['remove', key])
        },
      },
    }))

    writePageState(state)
    expect(calls).toEqual([['set', PAGE_STATE_KEY], ['remove', LEGACY_WORK_MODE_KEY]])
  })

  it('leaves a stale standalone switch when the record cannot be written', () => {
    localStorage.setItem(LEGACY_WORK_MODE_KEY, '1')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(() => writePageState(state)).not.toThrow()
    expect(localStorage.getItem(LEGACY_WORK_MODE_KEY)).toBe('1')
  })

  it('swallows a storage that refuses the write', () => {
    restores.push(replaceStorage({
      value: {
        getItem: () => null,
        setItem() {
          throw new Error('denied')
        },
        removeItem() {
          throw new Error('denied')
        },
      },
    }))
    expect(() => writePageState(state)).not.toThrow()
  })

  it('swallows a storage that refuses to clear the standalone switch', () => {
    restores.push(replaceStorage({
      value: {
        getItem: () => null,
        setItem() {},
        removeItem() {
          throw new Error('denied')
        },
      },
    }))
    expect(() => writePageState(state)).not.toThrow()
  })

  it('swallows absent storage', () => {
    restores.push(replaceStorage({ value: undefined }))
    expect(() => writePageState(state)).not.toThrow()
  })

  it('swallows a storage getter that throws', () => {
    restores.push(replaceStorage({
      get() {
        throw new Error('denied')
      },
    }))
    expect(() => writePageState(state)).not.toThrow()
  })
})
