import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionTitles } from '../../src/host/session-titles.js'

/** A session-query fake recording every observed batch.
 * @param {any[] | ((ids: string[]) => any[])} [results]
 * @param {{ throw?: boolean }} [options]
 */
function fakeQuery(results = [], options = {}) {
  const calls = []
  return {
    calls,
    async readTitleSnapshots(ids, signal) {
      calls.push({ ids: [...ids], signal })
      if (options.throw) throw new Error('cold read failed')
      return typeof results === 'function'
        ? results(ids)
        : ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { title: { title: `Title ${id}` } } }))
    },
  }
}

describe('session titles', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-16T09:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves titles once and reuses the cache for repeated ids', async () => {
    const query = fakeQuery()
    const titles = createSessionTitles(name => (name === 'sessionQuery' ? query : undefined))

    expect(await titles.resolve(/** @type {any} */ (['session-a', 'session-a', '', 5]))).toEqual(new Map([['session-a', 'Title session-a']]))
    expect(await titles.resolve(['session-a'])).toEqual(new Map([['session-a', 'Title session-a']]))
    expect(query.calls).toHaveLength(1)
    expect(query.calls[0].ids).toEqual(['session-a'])
    expect(query.calls[0].signal).toBeInstanceOf(AbortSignal)
  })

  it('re-reads a missing title after the short miss TTL but keeps a resolved one', async () => {
    const query = fakeQuery(ids => ids.map(id => id === 'session-a'
      ? { sessionId: id, status: 'rejected', reason: new Error('gone') }
      : { sessionId: id, status: 'fulfilled', value: { title: { title: `Title ${id}` } } }))
    const titles = createSessionTitles(() => query)

    expect(await titles.resolve(['session-a', 'session-b'])).toEqual(new Map([['session-a', ''], ['session-b', 'Title session-b']]))
    vi.advanceTimersByTime(31_000)
    expect(await titles.resolve(['session-a', 'session-b'])).toEqual(new Map([['session-a', ''], ['session-b', 'Title session-b']]))
    expect(query.calls).toHaveLength(2)
    expect(query.calls[1].ids).toEqual(['session-a'])

    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(await titles.resolve(['session-b'])).toEqual(new Map([['session-b', 'Title session-b']]))
    expect(query.calls[2].ids).toEqual(['session-b'])
  })

  it('returns an empty map without observing when the service is absent', async () => {
    expect(await createSessionTitles().resolve(['session-a'])).toEqual(new Map([['session-a', '']]))
    expect(await createSessionTitles(() => (undefined)).resolve(['session-a'])).toEqual(new Map([['session-a', '']]))
    expect(await createSessionTitles(() => null).resolve(['session-a'])).toEqual(new Map([['session-a', '']]))
    expect(await createSessionTitles(() => ({})).resolve(['session-a'])).toEqual(new Map([['session-a', '']]))
    expect(await createSessionTitles(() => ({ readTitleSnapshots: 'nope' })).resolve(['session-a'])).toEqual(new Map([['session-a', '']]))
  })

  it('keeps the recorded id when the observation fails or has no title', async () => {
    const throwing = fakeQuery([], { throw: true })
    expect(await createSessionTitles(() => throwing).resolve(['session-a'])).toEqual(new Map([['session-a', '']]))

    const sparse = createSessionTitles(() => ({
      async readTitleSnapshots(ids) {
        return ids.map(id => id === 'session-a'
          ? { sessionId: id, status: 'fulfilled', value: { title: undefined } }
          : { sessionId: id, status: 'fulfilled', value: { title: { title: '   ' } } })
      },
    }))
    expect(await sparse.resolve(['session-a', 'session-b'])).toEqual(new Map([['session-a', ''], ['session-b', '']]))

    const malformed = createSessionTitles(() => ({ async readTitleSnapshots() { return null } }))
    expect(await malformed.resolve(['session-a'])).toEqual(new Map([['session-a', '']]))
  })

  it('accepts no arguments and prunes the oldest entries past the cache cap', async () => {
    const query = fakeQuery(ids => ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { title: { title: id } } })))
    const titles = createSessionTitles(() => query)
    expect(await titles.resolve(/** @type {any} */ (undefined))).toEqual(new Map())
    expect(await titles.resolve([])).toEqual(new Map())
    expect(await titles.resolve(/** @type {any} */ ('session-a'))).toEqual(new Map())

    const ids = Array.from({ length: 501 }, (_, index) => `session-${index}`)
    await titles.resolve(ids)
    expect(query.calls).toHaveLength(1)
    const again = await titles.resolve(['session-0'])
    expect(again).toEqual(new Map([['session-0', 'session-0']]))
    expect(query.calls).toHaveLength(2)
  })
})
