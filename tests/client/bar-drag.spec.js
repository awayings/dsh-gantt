// Week-snapping maths for the drag-and-resize gesture on Gantt bars.
import { describe, expect, it } from 'vitest'
import { dragMode, dragRange, dragWeeks } from '../../src/client/bar-drag.js'

function edge(attribute) {
  const bar = document.createElement('div')
  const handle = document.createElement('span')
  handle.setAttribute('data-edge', attribute)
  bar.append(handle)
  return handle
}

describe('dragWeeks', () => {
  it('rounds a pixel delta to whole weeks on the weekly scale', () => {
    expect(dragWeeks(0, 36)).toBe(0)
    expect(dragWeeks(125, 36)).toBe(0)
    expect(dragWeeks(126, 36)).toBe(1)
    expect(dragWeeks(251, 36)).toBe(1)
    expect(dragWeeks(252, 36)).toBe(1)
    expect(dragWeeks(504, 36)).toBe(2)
    expect(dragWeeks(-252, 36)).toBe(-1)
  })

  it('uses the monthly scale pixels per day', () => {
    expect(dragWeeks(22.4, 3.2)).toBe(1)
    expect(dragWeeks(11, 3.2)).toBe(0)
    expect(dragWeeks(-44.8, 3.2)).toBe(-2)
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
  it('moves a whole-week task by whole weeks and keeps its span', () => {
    expect(dragRange({ mode: 'move', startDate: '2026-11-16', endDate: '2026-11-22', weeks: 1 }))
      .toEqual({ startDate: '2026-11-23', endDate: '2026-11-29' })
    expect(dragRange({ mode: 'move', startDate: '2026-11-16', endDate: '2026-11-22', weeks: -2 }))
      .toEqual({ startDate: '2026-11-02', endDate: '2026-11-08' })
  })

  it('normalizes a misaligned task to whole weeks when it moves', () => {
    expect(dragRange({ mode: 'move', startDate: '2026-07-01', endDate: '2026-11-20', weeks: 1 }))
      .toEqual({ startDate: '2026-07-06', endDate: '2026-11-22' })
  })

  it('grows a one-day task to one whole week when it moves', () => {
    expect(dragRange({ mode: 'move', startDate: '2026-11-16', endDate: '2026-11-16', weeks: 0 }))
      .toEqual({ startDate: '2026-11-16', endDate: '2026-11-22' })
  })

  it('resizes the start edge on Mondays and snaps the end to its Sunday', () => {
    expect(dragRange({ mode: 'start', startDate: '2026-11-16', endDate: '2026-11-22', weeks: -1 }))
      .toEqual({ startDate: '2026-11-09', endDate: '2026-11-22' })
    expect(dragRange({ mode: 'start', startDate: '2026-11-09', endDate: '2026-11-12', weeks: -1 }))
      .toEqual({ startDate: '2026-11-02', endDate: '2026-11-15' })
  })

  it('clamps the start edge to a one-week span', () => {
    expect(dragRange({ mode: 'start', startDate: '2026-11-16', endDate: '2026-11-22', weeks: 1 }))
      .toEqual({ startDate: '2026-11-16', endDate: '2026-11-22' })
    expect(dragRange({ mode: 'start', startDate: '2026-11-09', endDate: '2026-11-12', weeks: 1 }))
      .toEqual({ startDate: '2026-11-09', endDate: '2026-11-15' })
  })

  it('resizes the end edge on Sundays and snaps the start to its Monday', () => {
    expect(dragRange({ mode: 'end', startDate: '2026-11-16', endDate: '2026-11-22', weeks: 1 }))
      .toEqual({ startDate: '2026-11-16', endDate: '2026-11-29' })
    expect(dragRange({ mode: 'end', startDate: '2026-11-09', endDate: '2026-11-12', weeks: 1 }))
      .toEqual({ startDate: '2026-11-09', endDate: '2026-11-22' })
  })

  it('clamps the end edge to a one-week span', () => {
    expect(dragRange({ mode: 'end', startDate: '2026-11-16', endDate: '2026-11-22', weeks: -1 }))
      .toEqual({ startDate: '2026-11-16', endDate: '2026-11-22' })
    expect(dragRange({ mode: 'end', startDate: '2026-11-09', endDate: '2026-11-12', weeks: -1 }))
      .toEqual({ startDate: '2026-11-09', endDate: '2026-11-15' })
  })
})
