import { describe, expect, it } from 'vitest'
import { addDays, dayToIso, isoToDay, todayIso } from '../../store.js'

const DAY = 86_400_000

describe('todayIso', () => {
  it('formats the local calendar day with two-digit month and day', () => {
    expect(todayIso(new Date(2024, 0, 5, 12))).toBe('2024-01-05')
    expect(todayIso(new Date(2024, 8, 9, 0))).toBe('2024-09-09')
    expect(todayIso(new Date(2024, 11, 31, 23))).toBe('2024-12-31')
  })

  it('defaults to the current clock', () => {
    expect(todayIso()).toBe(todayIso(new Date()))
  })
})

describe('isoToDay', () => {
  it('maps an ISO date to UTC midnight milliseconds', () => {
    expect(isoToDay('1970-01-01')).toBe(0)
    expect(isoToDay('2024-01-01')).toBe(Date.UTC(2024, 0, 1))
    expect(isoToDay('2024-03-01')).toBe(Date.UTC(2024, 2, 1))
    expect(isoToDay('2024-02-29')).toBe(Date.UTC(2024, 1, 29))
  })
})

describe('dayToIso', () => {
  it('formats UTC milliseconds as an ISO date', () => {
    expect(dayToIso(0)).toBe('1970-01-01')
    expect(dayToIso(Date.UTC(2024, 0, 1))).toBe('2024-01-01')
    expect(dayToIso(Date.UTC(2024, 1, 29))).toBe('2024-02-29')
    expect(dayToIso(Date.UTC(2024, 11, 31))).toBe('2024-12-31')
  })
})

describe('addDays', () => {
  it('adds and subtracts whole days across month and year boundaries', () => {
    expect(addDays('2024-01-01', 0)).toBe('2024-01-01')
    expect(addDays('2024-01-01', 3)).toBe('2024-01-04')
    expect(addDays('2024-01-01', -1)).toBe('2023-12-31')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2023-12-31', 2)).toBe('2024-01-02')
    expect(addDays('2024-03-01', -2)).toBe('2024-02-28')
  })

  it('uses a whole UTC day per unit', () => {
    expect(addDays('2024-01-01', 30)).toBe(dayToIso(isoToDay('2024-01-01') + 30 * DAY))
  })

  it('round-trips with isoToDay and dayToIso', () => {
    for (const iso of ['2024-01-01', '2024-02-29', '1999-12-31', '2100-06-15']) {
      expect(dayToIso(isoToDay(iso))).toBe(iso)
      expect(addDays(iso, 0)).toBe(iso)
    }
  })
})
