// The task-day clock: the host runs in UTC while the tracker's dates and the
// 08:00 recompute are the user's wall clock (Asia/Shanghai by default).
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_TIME_ZONE, nextEightAm, taskTimeZone, todayIso, zonedParts } from '../../clock.js'

const saved = process.env.DSH_GANTT_TZ

afterEach(() => {
  if (saved === undefined) delete process.env.DSH_GANTT_TZ
  else process.env.DSH_GANTT_TZ = saved
})

describe('todayIso', () => {
  it('resolves the date in the task-day zone rather than the host zone', () => {
    expect(todayIso(new Date('2026-11-15T15:30:00.000Z'))).toBe('2026-11-15')
    expect(todayIso(new Date('2026-11-15T16:30:00.000Z'))).toBe('2026-11-16')
    expect(todayIso(new Date('2026-11-15T16:30:00.000Z'), 'UTC')).toBe('2026-11-15')
  })

  it('honours the DSH_GANTT_TZ override and ignores unusable values', () => {
    process.env.DSH_GANTT_TZ = 'UTC'
    expect(taskTimeZone()).toBe('UTC')
    expect(todayIso(new Date('2026-11-15T23:30:00.000Z'))).toBe('2026-11-15')

    process.env.DSH_GANTT_TZ = '  Europe/Berlin  '
    expect(taskTimeZone()).toBe('Europe/Berlin')

    process.env.DSH_GANTT_TZ = 'Not/AZone'
    expect(taskTimeZone()).toBe(DEFAULT_TIME_ZONE)

    process.env.DSH_GANTT_TZ = '   '
    expect(taskTimeZone()).toBe(DEFAULT_TIME_ZONE)
  })
})

describe('zonedParts', () => {
  it('reads wall-clock fields in the requested zone', () => {
    expect(zonedParts(new Date('2026-11-15T16:05:07.000Z'), 'UTC')).toEqual({
      year: 2026, month: 11, day: 15, hour: 16, minute: 5, second: 7,
    })
    expect(zonedParts(new Date('2026-11-15T16:05:07.000Z'), 'Asia/Shanghai')).toEqual({
      year: 2026, month: 11, day: 16, hour: 0, minute: 5, second: 7,
    })
  })
})

describe('nextEightAm', () => {
  it('returns the upcoming 08:00 in the task-day zone', () => {
    expect(nextEightAm(new Date('2026-11-15T23:59:00.000Z')).toISOString()).toBe('2026-11-16T00:00:00.000Z')
    expect(nextEightAm(new Date('2026-11-16T00:00:00.000Z')).toISOString()).toBe('2026-11-17T00:00:00.000Z')
    expect(nextEightAm(new Date('2026-11-16T01:30:00.000Z')).toISOString()).toBe('2026-11-17T00:00:00.000Z')
  })

  it('resolves a wall-clock time through the zone offset, including DST jumps', () => {
    expect(nextEightAm(new Date('2026-11-15T07:59:00.000Z'), 'UTC').toISOString()).toBe('2026-11-15T08:00:00.000Z')
    expect(nextEightAm(new Date('2026-03-07T20:00:00.000Z'), 'America/New_York').toISOString())
      .toBe('2026-03-08T12:00:00.000Z')
  })
})
