import { describe, expect, it } from 'vitest'
import { parseDaily } from '../../src/host/tracker.js'
import { DAILY_MD } from './fixtures.js'

describe('parseDaily', () => {
  it('parses the frontmatter date and the first core-goal quote', () => {
    expect(parseDaily(DAILY_MD)).toEqual({
      date: '2026-11-15',
      coreGoal: '把 1.8.1 这一周的读数收成一张表。',
    })
  })

  it('accepts the heading without the target emoji', () => {
    const text = '---\ndate: 2026-11-16\n---\n\n## 今天核心目标\n\n> 直接写目标。\n'
    expect(parseDaily(text)).toEqual({ date: '2026-11-16', coreGoal: '直接写目标。' })
  })

  it('returns an empty date when frontmatter is missing or the date is not a real day', () => {
    expect(parseDaily('## 今天核心目标\n\n> 无 frontmatter。\n')).toEqual({ date: '', coreGoal: '无 frontmatter。' })
    expect(parseDaily('---\ndate: YYYY-MM-DD\n---\n\n## 今天核心目标\n\n> 模板。\n')).toEqual({ date: '', coreGoal: '模板。' })
    expect(parseDaily('---\nweek: W46\n---\n\n## 🎯 今天核心目标\n\n> 只有周。\n')).toEqual({ date: '', coreGoal: '只有周。' })
    expect(parseDaily('---\ndate: 2026-02-30\n---\n')).toEqual({ date: '', coreGoal: '' })
  })

  it('takes the first non-empty quote and ignores the rest of the card', () => {
    const text = '## 🎯 今天核心目标\n\n\n> 第一句。\n\n> 播报：第二句。\n'
    expect(parseDaily(text).coreGoal).toBe('第一句。')
  })

  it('stops at the next heading or at a non-quote line', () => {
    expect(parseDaily('## 🎯 今天核心目标\n\n## 盘前流程\n\n> 不属于目标。\n')).toEqual({ date: '', coreGoal: '' })
    expect(parseDaily('## 🎯 今天核心目标\n\n普通正文。\n')).toEqual({ date: '', coreGoal: '' })
    expect(parseDaily('## 没有目标章节\n\n> 无关引用。\n')).toEqual({ date: '', coreGoal: '' })
  })

  it('returns empty results for hostile input', () => {
    expect(parseDaily(/** @type {any} */ (undefined))).toEqual({ date: '', coreGoal: '' })
    expect(parseDaily('')).toEqual({ date: '', coreGoal: '' })
    expect(parseDaily('---\n')).toEqual({ date: '', coreGoal: '' })
  })
})
