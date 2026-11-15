import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSchedule, slotForTime } from '../../src/host/tracker.js'
import { SCHEDULE_MD } from './fixtures.js'

/** @param {string} body */
function withSection(body) {
  return `# 滚动排期板\n\n## 四、未来 7 天\n\n${body}`
}

afterEach(() => {
  vi.useRealTimers()
})

describe('slotForTime', () => {
  it('derives the slot from the start time only', () => {
    expect(slotForTime('09:00', '12:00')).toBe('morning')
    expect(slotForTime('09:59', '')).toBe('morning')
    expect(slotForTime('10:00', '19:30')).toBe('daytime')
    expect(slotForTime('19:29', '')).toBe('daytime')
    expect(slotForTime('19:30', '')).toBe('evening')
    expect(slotForTime('22:00', '')).toBe('evening')
    expect(slotForTime('', '')).toBe('other')
    expect(slotForTime('25:00', '')).toBe('other')
  })
})

describe('parseSchedule', () => {
  it('parses days, headings, labels, and time blocks', () => {
    const { days } = parseSchedule(SCHEDULE_MD, { year: 2026 })
    expect(days.map(day => day.date)).toEqual(['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-19'])
    expect(days.map(day => day.weekday)).toEqual(['周六', '周日', '周一', '周四'])
    expect(days[0]).toMatchObject({ dayKind: 'weekend', marketOpen: false, label: '周末（休市）· 主攻片（≥4h）' })
    expect(days[2]).toMatchObject({ dayKind: 'workday', marketOpen: true, label: '上班（工作日）· 交易日' })
    expect(days[0].blocks).toHaveLength(3)
    expect(days[0].blocks[0]).toEqual({
      startTime: '09:00',
      endTime: '09:30',
      slot: 'morning',
      category: 'A 主攻片',
      title: '策略总账核对',
      detail: '策略总账核对 —— 读六条策略进度',
      landing: 'invest/strategy-ledger.md',
      estimate: '30min',
      inspiration: '',
      sortOrder: 0,
      sourceRef: 'SCHEDULE.md',
    })
    expect(days[0].blocks[1]).toMatchObject({ startTime: '09:30', endTime: '17:00', title: '1.8.1 一周读数收口' })
    expect(days[0].blocks[2]).toMatchObject({ slot: 'evening', title: '认知输出补回', inspiration: '' })
    expect(days[1].blocks[0]).toMatchObject({ startTime: '09:00', endTime: '17:00' })
    expect(days[1].blocks[1]).toMatchObject({ inspiration: '#21', slot: 'evening' })
    expect(days[2].blocks[2]).toMatchObject({ category: '多元化格（灵感 #19）', inspiration: '#19' })
    expect(days[3].blocks.map(block => block.startTime)).toEqual(['08:00', '21:00'])
  })

  it('strips markdown decoration from every cell', () => {
    const text = withSection([
      '### 11/14 六 —— **主攻片**',
      '',
      '| 时段 | 类 | 内容 | 落点 | 预估 |',
      '|------|----|------|------|------|',
      '| **09:30-10:00** | **A 类** ⚠️ | **`#17` 两化名录** 补回 → 明天 | `directions.md` ✅ | ❌ 1h |',
    ].join('\n'))
    const [day] = parseSchedule(text, { year: 2026 }).days
    expect(day.label).toBe('主攻片')
    expect(day.blocks[0]).toMatchObject({
      category: 'A 类',
      title: '#17 两化名录 补回 → 明天',
      landing: 'directions.md',
      inspiration: '#17',
    })
  })

  it('ignores time tokens that are not real clock times', () => {
    const text = withSection([
      '### 11/14 六 —— 主攻片',
      '',
      '| 时段 | 类 | 内容 | 落点 | 预估 |',
      '|------|----|------|------|------|',
      '| 25:99 | A | 非法时间 | `x.md` | 1h |',
    ].join('\n'))
    const [day] = parseSchedule(text, { year: 2026 }).days
    expect(day.blocks[0]).toMatchObject({ startTime: '', endTime: '', slot: 'other' })
  })

  it('ignores a malformed 窗口 note', () => {
    const monthBad = withSection('> 窗口 = **13/40-11/20**\n\n### 11/14 六 —— 主攻片')
    expect(parseSchedule(monthBad, { year: 2026 }).days[0].date).toBe('2026-11-14')
    const dayBad = withSection('> 窗口 = **11/32-11/40**\n\n### 11/14 六 —— 主攻片')
    expect(parseSchedule(dayBad, { year: 2026 }).days[0].date).toBe('2026-11-14')
  })

  it('degrades when columns are missing or extra', () => {
    const text = withSection([
      '### 11/14 六 —— 周末（休市）',
      '',
      '| 时段 | 类 | 内容 | 落点 | 预估 |',
      '|------|----|------|------|------|',
      '| 14:00 | 固定 | 只有三列 |',
      '| 18:00-19:00 | 固定 | 多出来的列 | `a.md` | 1h | extra |',
      '| 19:00 | 固定 | 没有收尾管道',
    ].join('\n'))
    const [day] = parseSchedule(text, { year: 2026 }).days
    expect(day.blocks[0]).toEqual({
      startTime: '14:00',
      endTime: '',
      slot: 'daytime',
      category: '固定',
      title: '只有三列',
      detail: '只有三列',
      landing: '',
      estimate: '',
      inspiration: '',
      sortOrder: 0,
      sourceRef: 'SCHEDULE.md',
    })
    expect(day.blocks[1]).toMatchObject({ startTime: '18:00', endTime: '19:00', landing: 'a.md', estimate: '1h' })
    expect(day.blocks[2]).toMatchObject({ startTime: '19:00', title: '没有收尾管道', landing: '' })
  })

  it('keeps the title only when splitting the —— detail leaves 120 characters or fewer', () => {
    const long = '长'.repeat(121)
    const text = withSection([
      '### 11/14 六 —— 主攻片',
      '',
      '| 时段 | 类 | 内容 | 落点 | 预估 |',
      '|------|----|------|------|------|',
      `| 09:00 | A | ${long} —— 细节 | x | 1h |`,
      '| 10:00 | A | —— 只有细节 | x | 1h |',
    ].join('\n'))
    const [day] = parseSchedule(text, { year: 2026 }).days
    expect(day.blocks[0].title).toBe(`${long} —— 细节`)
    expect(day.blocks[1].title).toBe('—— 只有细节')
  })

  it('parses a `||` table and single-time cells', () => {
    const text = withSection([
      '### 11/19 四 —— 上班（工作日）· 交易日',
      '',
      '|| 时段 | 类 | 内容 | 落点 | 预估 |',
      '|------|----|------|------|------|',
      '|| 08:00-10:00 | 固定 | 盘前决策流程 | `invest/premarket.sh` | 2h |',
      '|| 21:00 | 多元化格 | **A 类 · 黄金存留** | `directions.md` | ≤1h |',
    ].join('\n'))
    const [day] = parseSchedule(text, { year: 2026 }).days
    expect(day.blocks).toHaveLength(2)
    expect(day.blocks[0]).toMatchObject({ startTime: '08:00', endTime: '10:00', title: '盘前决策流程' })
    expect(day.blocks[1]).toMatchObject({ startTime: '21:00', endTime: '', slot: 'evening', title: 'A 类 · 黄金存留' })
  })

  it('infers a year from the 窗口 note only when no year option is given', () => {
    const text = withSection('> 窗口 = **11/14-11/20**\n\n### 11/14 六 —— 周末（休市）')
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 1, 12))
    expect(parseSchedule(text).days[0].date).toBe('2026-11-14')
    expect(parseSchedule(text, { year: 2024 }).days[0].date).toBe('2024-11-14')
    vi.setSystemTime(new Date(2026, 0, 2, 12))
    expect(parseSchedule(text).days[0].date).toBe('2025-11-14')
    vi.setSystemTime(new Date(2026, 11, 31, 12))
    expect(parseSchedule(withSection('> 窗口 = **01/02-01/08**\n\n### 01/02 五 —— 上班（工作日）· 交易日')).days[0].date).toBe('2027-01-02')
  })

  it('rolls a window crossing New Year into the next year', () => {
    const text = withSection([
      '> 窗口 = **12/28-01/03**',
      '',
      '### 12/28 日 —— 周末（休市）',
      '',
      '| 时段 | 类 | 内容 | 落点 | 预估 |',
      '|------|----|------|------|------|',
      '| 09:00 | A | 年末收口 | `x.md` | 1h |',
      '',
      '### 01/03 六 —— 周末（休市）',
      '',
      '### 11/30 一 —— 上班（工作日）· 交易日',
    ].join('\n'))
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 2, 12))
    const { days } = parseSchedule(text)
    expect(days.map(day => day.date)).toEqual(['2025-12-28', '2026-01-03', '2025-11-30'])
  })

  it('falls back to the current year and the derived weekday when the board omits them', () => {
    const text = withSection('### 01/02 —— 上班（工作日）· 交易日\n\n| 时段 | 类 | 内容 | 落点 | 预估 |\n|---|---|---|---|---|\n| 21:00 | 多元化格 | 写一条 | `a.md` | 1h |')
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 1, 12))
    expect(parseSchedule(text).days[0]).toMatchObject({ date: '2026-01-02', weekday: '周五' })
    expect(parseSchedule(withSection('### 11/15 天 —— 主攻片')).days[0].weekday).toBe('周日')
    expect(parseSchedule(withSection('### 11/15 日')).days[0].label).toBe('')
    expect(parseSchedule(withSection('### 11/15 日 —— 自定义日子')).days[0]).toMatchObject({ dayKind: 'unknown', marketOpen: false })
  })

  it('ignores malformed headings and their tables', () => {
    const text = withSection([
      '### 13/40 一 —— 坏月份',
      '',
      '| 时段 | 类 | 内容 | 落点 | 预估 |',
      '|---|---|---|---|---|',
      '| 09:00 | A | 不该出现 | `x.md` | 1h |',
      '',
      '### 02/30 六 —— 不存在的日子',
      '',
      '| 时段 | 类 | 内容 | 落点 | 预估 |',
      '|---|---|---|---|---|',
      '| 09:00 | A | 也不该出现 | `x.md` | 1h |',
    ].join('\n'))
    expect(parseSchedule(text, { year: 2026 }).days).toEqual([])
  })

  it('stops a table at a blank line, a prose line, or a malformed row', () => {
    const text = withSection([
      '### 11/14 六 —— 主攻片',
      '',
      '| 时段 | 类 | 内容 | 落点 | 预估 |',
      '|------|----|------|------|------|',
      '| 09:00 | A | 第一行 | `x.md` | 1h |',
      '',
      '| 10:00 | A | 空行之后不算 | `x.md` | 1h |',
      '',
      '### 11/15 日 —— 主攻片',
      '',
      '一些说明文字',
      '',
      '| 时段 | 类 | 内容 | 落点 | 预估 |',
      '|---|---|---|---|---|',
      '| 09:00 | A | 说明后仍解析 | `x.md` | 1h |',
      '说明结束表格',
      '| 10:00 | A | 文字之后不算 | `x.md` | 1h |',
      '|',
      '| 内容 | 类 | 内容 | 落点 |',
      '|------|----|------|------|',
      '| 11:00 | A | 不能再算 | `x.md` | 1h |',
    ].join('\n'))
    const { days } = parseSchedule(text, { year: 2026 })
    expect(days[0].blocks.map(block => block.title)).toEqual(['第一行'])
    expect(days[1].blocks.map(block => block.title)).toEqual(['说明后仍解析'])
  })

  it('skips header, separator, note, and empty rows', () => {
    const text = withSection([
      '### 11/14 六 —— 主攻片',
      '',
      '> 一条说明。',
      '',
      '| 时段 | 类 | 内容 | 落点 | 预估 |',
      '|:---|---|:---:|---|---|',
      '|  | 固定 |  |  |  |',
      '| 10:00 | A |  |  |  |',
      '| 11:00 | A | 内容 |  |  |',
    ].join('\n'))
    const { days } = parseSchedule(text, { year: 2026 })
    expect(days[0].blocks.map(block => block.title)).toEqual(['内容'])
  })

  it('treats a malformed header cell as a header, not a block', () => {
    const text = withSection('### 11/14 六 —— 主攻片\n\n| | 类 | 内容 | 落点 | 预估 |\n|---|---|---|---|---|\n| 09:00 | A | 真正的行 | `x.md` | 1h |')
    const { days } = parseSchedule(text, { year: 2026 })
    expect(days[0].blocks.map(block => block.title)).toEqual(['真正的行'])
  })

  it('returns empty results for hostile input', () => {
    expect(parseSchedule(/** @type {any} */ (undefined))).toEqual({ days: [] })
    expect(parseSchedule('')).toEqual({ days: [] })
    expect(parseSchedule('# 无关文件\n\n### 11/14 六 —— 不在章节内')).toEqual({ days: [] })
    expect(parseSchedule('## 四、未来 7 天\n\n### 11/14 六 —— 主攻片')).toEqual({
      days: [{ date: expect.any(String), weekday: '周六', dayKind: 'unknown', marketOpen: false, label: '主攻片', blocks: [] }],
    })
  })

  it('stops at the next level-two heading', () => {
    const text = [
      '## 四、未来 7 天',
      '',
      '### 11/14 六 —— 主攻片',
      '',
      '| 时段 | 类 | 内容 | 落点 | 预估 |',
      '|---|---|---|---|---|',
      '| 09:00 | A | 章节内 | `x.md` | 1h |',
      '',
      '## 五、候选池',
      '',
      '### 11/15 日 —— 主攻片',
      '',
      '| 时段 | 类 | 内容 | 落点 | 预估 |',
      '|---|---|---|---|---|',
      '| 09:00 | A | 章节外 | `x.md` | 1h |',
    ].join('\n')
    expect(parseSchedule(text, { year: 2026 }).days.map(day => day.date)).toEqual(['2026-11-14'])
  })
})
