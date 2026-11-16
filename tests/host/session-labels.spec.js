import { describe, expect, it } from 'vitest'
import { sessionDisplay, shortSessionId } from '../../src/shared/session.js'

describe('session labels', () => {
  it('shortens a prefixed session id and keeps unknown shapes at eight characters', () => {
    expect(shortSessionId('session-b1f72425-d0d8-4124-960b-f12411698c2f')).toBe('b1f72425')
    expect(shortSessionId(' abcdefghijkl ')).toBe('abcdefgh')
    expect(shortSessionId('session-')).toBe('')
    expect(shortSessionId('')).toBe('')
    expect(shortSessionId(null)).toBe('')
    expect(shortSessionId(42)).toBe('')
  })

  it('puts a resolved title in front of the short id', () => {
    expect(sessionDisplay('session-b1f72425-d0d8', '个人任务管理')).toBe('个人任务管理（b1f72425）')
    expect(sessionDisplay('session-b1f72425-d0d8', '   ')).toBe('b1f72425')
    expect(sessionDisplay('session-b1f72425-d0d8', null)).toBe('b1f72425')
    expect(sessionDisplay('', 'Title')).toBe('Title')
  })
})
