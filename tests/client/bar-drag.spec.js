// Cell-snapped maths for the drag-and-resize gesture on Gantt bars.
import { describe, expect, it } from 'vitest'
import { cellWidth, dragMode, dragRange, dragSteps } from '../../src/client/bar-drag.js'

function edge(attribute) {
  const bar = document.createElement('div')
  const handle = document.createElement('span')
  handle.setAttribute('data-edge', attribute)
  bar.append(handle)
  return handle
}

// The weekly window is 28 one-day cells of 36 px; the monthly window is 12
// months of 365 days at 3.2 px per day.
const WEEKLY = { totalWidth: 1008, units: Array.from({ length: 28 }) }
const MONTHLY = { totalWidth: 1168, units: Array.from({ length: 12 }) }

describe('cellWidth', () => {
  it('returns one day cell on the weekly timeline', () => {
    expect(cellWidth(WEEKLY)).toBe(36)
  })

  it('returns the average month width on the monthly timeline', () => {
    expect(cellWidth(MONTHLY)).toBeCloseTo(97.33, 1)
  })
})

describe('dragSteps', () => {
  it('rounds a pixel delta to whole day cells on the weekly scale', () => {
    expect(dragSteps(0, 36)).toBe(0)
    expect(dragSteps(17, 36)).toBe(0)
    expect(dragSteps(18, 36)).toBe(1)
    expect(dragSteps(35, 36)).toBe(1)
    expect(dragSteps(252, 36)).toBe(7)
    expect(dragSteps(-252, 36)).toBe(-7)
  })

  it('rounds a pixel delta to whole month cells on the monthly scale', () => {
    expect(dragSteps(40, 97.5)).toBe(0)
    expect(dragSteps(60, 97.5)).toBe(1)
    expect(dragSteps(195, 97.5)).toBe(2)
    expect(dragSteps(-195, 97.5)).toBe(-2)
  })
})

describe('dragMode', () => {
  it('reads the edge handle under the pointer', () => {
    expect(dragMode(edge('start'))).toBe('start')
    expect(dragMode(edge('end'))).toBe('end')
  })

  it('treats the bar body and any foreign target as a move', () => {
    const bar = document.createElement('div')
    expect(dragMode(bar)).toBe('move')
    expect(dragMode(null)).toBe('move')
    expect(dragMode({ closest: 'not callable' })).toBe('move')
  })
})

describe('dragRange', () => {
  it('moves a task by whole days and keeps its span', () => {
    expect(dragRange({ mode: 'move', startDate: '2026-11-09', endDate: '2026-11-12', steps: 1, scale: 'week' }))
      .toEqual({ startDate: '2026-11-10', endDate: '2026-11-13' })
    expect(dragRange({ mode: 'move', startDate: '2026-11-09', endDate: '2026-11-12', steps: -2, scale: 'week' }))
      .toEqual({ startDate: '2026-11-07', endDate: '2026-11-10' })
  })

  it('moves a task by whole months on the monthly scale', () => {
    expect(dragRange({ mode: 'move', startDate: '2026-11-09', endDate: '2026-11-12', steps: 1, scale: 'month' }))
      .toEqual({ startDate: '2026-12-09', endDate: '2026-12-12' })
  })

  it('does not re-align a mid-week range when it moves', () => {
    expect(dragRange({ mode: 'move', startDate: '2026-07-01', endDate: '2026-11-20', steps: 1, scale: 'month' }))
      .toEqual({ startDate: '2026-08-01', endDate: '2026-12-20' })
  })

  it('clamps a month shift to the end of the target month', () => {
    expect(dragRange({ mode: 'move', startDate: '2027-01-31', endDate: '2027-01-31', steps: 1, scale: 'month' }))
      .toEqual({ startDate: '2027-02-28', endDate: '2027-02-28' })
  })

  it('resizes the start edge by whole days and keeps the end', () => {
    expect(dragRange({ mode: 'start', startDate: '2026-11-09', endDate: '2026-11-12', steps: -2, scale: 'week' }))
      .toEqual({ startDate: '2026-11-07', endDate: '2026-11-12' })
  })

  it('resizes the start edge by whole months and keeps the end', () => {
    expect(dragRange({ mode: 'start', startDate: '2026-11-02', endDate: '2026-12-12', steps: 1, scale: 'month' }))
      .toEqual({ startDate: '2026-12-02', endDate: '2026-12-12' })
  })

  it('clamps the start edge to a one-day span', () => {
    expect(dragRange({ mode: 'start', startDate: '2026-11-09', endDate: '2026-11-09', steps: -1, scale: 'month' }))
      .toEqual({ startDate: '2026-10-09', endDate: '2026-11-09' })
    expect(dragRange({ mode: 'start', startDate: '2026-11-09', endDate: '2026-11-09', steps: 1, scale: 'month' }))
      .toEqual({ startDate: '2026-11-09', endDate: '2026-11-09' })
    expect(dragRange({ mode: 'start', startDate: '2026-11-09', endDate: '2026-11-12', steps: 5, scale: 'week' }))
      .toEqual({ startDate: '2026-11-12', endDate: '2026-11-12' })
  })

  it('resizes the end edge by whole days and keeps the start', () => {
    expect(dragRange({ mode: 'end', startDate: '2026-11-09', endDate: '2026-11-12', steps: 2, scale: 'week' }))
      .toEqual({ startDate: '2026-11-09', endDate: '2026-11-14' })
  })

  it('resizes the end edge by whole months and keeps the start', () => {
    expect(dragRange({ mode: 'end', startDate: '2026-11-09', endDate: '2026-11-12', steps: 1, scale: 'month' }))
      .toEqual({ startDate: '2026-11-09', endDate: '2026-12-12' })
  })

  it('clamps the end edge to a one-day span', () => {
    expect(dragRange({ mode: 'end', startDate: '2026-11-09', endDate: '2026-11-12', steps: -5, scale: 'week' }))
      .toEqual({ startDate: '2026-11-09', endDate: '2026-11-09' })
    expect(dragRange({ mode: 'end', startDate: '2026-11-09', endDate: '2026-11-09', steps: -1, scale: 'month' }))
      .toEqual({ startDate: '2026-11-09', endDate: '2026-11-09' })
  })
})
