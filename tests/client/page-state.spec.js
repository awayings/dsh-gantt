// The Gantt page is a global main panel that the shell remounts on a client
// rebuild or a browser reload. These cases pin the localStorage record that
// gives the page back with the same depth, filter, folded tasks and scroll
// offsets, including every hostile shape a stored record can take.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FILTERS,
  LEVELS,
  PAGE_STATE_KEY,
  PAGE_STATE_VERSION,
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
  it('pins the storage key, schema version, filters and levels', () => {
    expect(PAGE_STATE_KEY).toBe('gantt.pageState')
    expect(PAGE_STATE_VERSION).toBe(1)
    expect(FILTERS).toEqual(['all', 'unfinished', 'active', 'frontier', 'next', 'today', 'done'])
    expect(LEVELS).toEqual([99, 2, 1])
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
    })
  })

  it('rejects anything that is not a versioned plain object', () => {
    const rejected = [
      null,
      undefined,
      42,
      '00',
      true,
      [],
      [record()],
      {},
      { v: 2 },
      { v: '1' },
      { v: 0, level: 1 },
    ]
    for (const raw of rejected) expect(sanitizePageState(raw)).toBeNull()
  })

  it('fills every missing field with the page defaults', () => {
    expect(sanitizePageState({ v: PAGE_STATE_VERSION })).toEqual({
      level: 99,
      filter: 'all',
      collapsed: [],
      scrollTop: 0,
      scrollLeft: 0,
    })
  })

  it('keeps every supported level and drops the rest', () => {
    for (const level of LEVELS) expect(sanitizePageState(record({ level })).level).toBe(level)
    for (const level of [0, 3, 98, '2', null, undefined]) {
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

  it('drops unknown keys instead of restoring them', () => {
    const result = sanitizePageState({ ...record(), extra: 'x', nested: { v: 1 } })
    expect(Object.keys(result)).toEqual(['level', 'filter', 'collapsed', 'scrollTop', 'scrollLeft'])
    expect(result).not.toHaveProperty('v')
    expect(result).not.toHaveProperty('extra')
  })
})

describe('readPageState', () => {
  it('reads and normalizes a stored record', () => {
    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify(record({ level: 1, filter: 'today' })))
    expect(readPageState()).toEqual({
      level: 1,
      filter: 'today',
      collapsed: ['1.1'],
      scrollTop: 40,
      scrollLeft: 8,
    })
  })

  it('falls back to defaults for a valid record with unusable fields', () => {
    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify({
      v: PAGE_STATE_VERSION,
      level: 0,
      filter: 'nope',
      collapsed: 'nope',
      scrollTop: -1,
      scrollLeft: 'x',
    }))
    expect(readPageState()).toEqual({
      level: 99,
      filter: 'all',
      collapsed: [],
      scrollTop: 0,
      scrollLeft: 0,
    })
  })

  it('has no state before the first visit', () => {
    expect(readPageState()).toBeNull()
  })

  it('ignores malformed JSON', () => {
    localStorage.setItem(PAGE_STATE_KEY, '{not json')
    expect(readPageState()).toBeNull()
  })

  it('ignores JSON values that are not records', () => {
    for (const raw of ['null', '"x"', '[]', '42', 'true', '{}']) {
      localStorage.setItem(PAGE_STATE_KEY, raw)
      expect(readPageState()).toBeNull()
    }
  })

  it('ignores records written by another schema version', () => {
    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify({ ...record(), v: 2 }))
    expect(readPageState()).toBeNull()

    localStorage.setItem(PAGE_STATE_KEY, JSON.stringify({ ...record(), v: undefined }))
    expect(readPageState()).toBeNull()
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
  const state = { level: 1, filter: 'today', collapsed: ['2', '3'], scrollTop: 120, scrollLeft: 4 }

  it('stores the versioned six-key record under PAGE_STATE_KEY', () => {
    writePageState(state)

    const raw = stored()
    expect(raw.v).toBe(PAGE_STATE_VERSION)
    expect(Object.keys(raw)).toEqual(['v', 'level', 'filter', 'collapsed', 'scrollTop', 'scrollLeft'])
    expect(raw).toEqual({ v: PAGE_STATE_VERSION, ...state })
  })

  it('round-trips the state through readPageState', () => {
    writePageState(state)
    expect(readPageState()).toEqual(state)
  })

  it('swallows a storage that refuses the write', () => {
    restores.push(replaceStorage({
      value: {
        getItem: () => null,
        setItem() {
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
