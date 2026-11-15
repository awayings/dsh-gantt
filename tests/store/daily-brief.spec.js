import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendBriefSection,
  buildWindows,
  computeDailyBrief,
  nextEightAm,
  parseDailyReport,
  parseEstimate,
  trackRole,
  windowKindOf,
} from '../../daily.js'
import { GanttStore, todayIso } from '../../store.js'
import { expectGanttError, insertDailyReport } from '../helpers/gantt.js'

/** @param {string} id @param {string} startTime @param {string} endTime @param {string} [slot] */
function block(id, startTime, endTime, slot = 'morning') {
  return { id, startTime, endTime, slot }
}

/** Seed the live-shape fixture: six tracks with mixed states and ready leaves. */
function seedLiveLike(store) {
  store.replacePlan({
    tracks: [
      { id: '1', name: '投资系统', lane: '赚钱', state: '进行', blocker: 'L5 = 0' },
      { id: '2', name: '打工', lane: '赚钱', state: '卡住' },
      { id: '3', name: '元能力', lane: '赚钱', state: '进行' },
      { id: '4', name: '生活程序', lane: '生活', state: '进行' },
      { id: '5', name: '社会化', lane: '生活', state: '卡住' },
      { id: '6', name: '内容平台', lane: '赚钱', state: '未开始' },
    ],
    nodes: [
      { id: '1.8', trackId: '1', title: '策略实盘化', state: '进行' },
      { id: '1.8.1', trackId: '1', title: 'S2 每日交易仓读数', state: '未开始' },
      { id: '1.9', trackId: '1', title: '资金流模型', state: '进行' },
      { id: '1.9.1', trackId: '1', title: 'D0 数据缺口', state: '已立项' },
      { id: '2.3', trackId: '2', title: '运营视图', state: '进行' },
      { id: '2.4', trackId: '2', title: '黑名单复核', state: '卡住' },
      { id: '3.5', trackId: '3', title: '任务地图', state: '进行' },
      { id: '3.5.5', trackId: '3', title: '决策日志', state: '未开始' },
      { id: '4.1', trackId: '4', title: '生活记录', state: '未开始' },
      { id: '5.1', trackId: '5', title: '社交动作', state: '卡住' },
      { id: '6.1', trackId: '6', title: '内容选题', state: '未开始' },
      { id: '6.2', trackId: '6', title: '选题库', state: '未开始', dep: '6.1' },
    ],
  })
}

const LIVE_BLOCKS = [
  block('2026-11-15|09:00|0', '09:00', '17:00'),
  block('2026-11-15|21:00|0', '21:00', '22:00', 'evening'),
]

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
  vi.useRealTimers()
})

/** @param {'auto' | 'manual'} [source] */
function reportOf(source = 'auto') {
  return computeDailyBrief({ date: '2026-11-15', generatedAt: '2026-11-15T00:05:00.000Z', source, dayKind: 'weekend', blocks: LIVE_BLOCKS, tree: store.tree() })
}

describe('windowKindOf and buildWindows', () => {
  it('classifies windows by duration with unknown times as definition', () => {
    expect(windowKindOf('09:00', '12:00')).toBe('core')
    expect(windowKindOf('21:00', '22:30')).toBe('rotation')
    expect(windowKindOf('20:00', '21:59')).toBe('rotation')
    expect(windowKindOf('21:00', '22:00')).toBe('definition')
    expect(windowKindOf('', '22:00')).toBe('definition')
    expect(windowKindOf('21:00', '')).toBe('definition')
    const invalidEnd = windowKindOf('21:00', '25:00')
    expect(invalidEnd).toBe('definition')
    expect(windowKindOf('22:00', '21:00')).toBe('definition')
  })

  it('builds blocks windows from stored slots and derives a missing slot', () => {
    const windows = buildWindows(/** @type {any} */ ([
      block('b1', '21:00', '22:00', 'evening'),
      block('b2', '', '', ''),
      { id: 7, startTime: 9, endTime: null, slot: 3 },
      block('b3', '09:00', '17:00', 'morning'),
    ]), 'weekend')
    expect(windows).toEqual([
      { slot: 'morning', startTime: '09:00', endTime: '17:00', minutes: 480, kind: 'core', blockId: 'b3' },
      { slot: 'evening', startTime: '21:00', endTime: '22:00', minutes: 60, kind: 'definition', blockId: 'b1' },
      { slot: 'other', startTime: '', endTime: '', minutes: 0, kind: 'definition', blockId: '' },
      { slot: 'other', startTime: '', endTime: '', minutes: 0, kind: 'definition', blockId: 'b2' },
    ])
    expect(windows.map(window => window.blockId)).not.toContain(7)
  })

  it('sorts equal start times by end time and then block id', () => {
    const windows = buildWindows([
      block('b2', '09:00', '11:00'),
      block('b1', '09:00', '10:00'),
      block('b3', '09:00', '10:00'),
    ], 'workday')
    expect(windows.map(window => window.blockId)).toEqual(['b1', 'b3', 'b2'])
  })

  it('falls back to the day-kind templates', () => {
    const workday = buildWindows([], 'workday')
    expect(workday).toEqual([
      { slot: 'evening', startTime: '21:00', endTime: '22:00', minutes: 60, kind: 'definition', blockId: '' },
    ])
    const weekend = buildWindows([], 'weekend')
    expect(weekend.map(window => [window.slot, window.minutes, window.kind])).toEqual([
      ['morning', 180, 'core'],
      ['daytime', 240, 'core'],
      ['evening', 150, 'core'],
    ])
    expect(buildWindows([], 'unknown')).toEqual([])
    expect(buildWindows(/** @type {any} */ (undefined), 'unknown')).toEqual([])
  })
})

describe('trackRole', () => {
  it('derives every track role from state or status', () => {
    expect(trackRole({ state: '进行', status: 'todo' })).toBe('core')
    expect(trackRole({ state: '进行中', status: 'todo' })).toBe('core')
    expect(trackRole({ state: '', status: 'in_progress' })).toBe('core')
    expect(trackRole({ state: '卡住', status: 'todo' })).toBe('blocked')
    expect(trackRole({ state: '', status: 'blocked' })).toBe('blocked')
    expect(trackRole({ state: '已过', status: 'todo' })).toBe('done')
    expect(trackRole({ state: '撤销', status: 'todo' })).toBe('done')
    expect(trackRole({ state: '', status: 'done' })).toBe('done')
    expect(trackRole({ state: '', status: 'todo' })).toBe('rotation')
  })
})

describe('parseEstimate and nextEightAm', () => {
  it('parses tracker estimate strings to minutes', () => {
    expect(parseEstimate('2h')).toBe(120)
    expect(parseEstimate('≥4h')).toBe(240)
    expect(parseEstimate('1.5h')).toBe(90)
    expect(parseEstimate('2 Hours')).toBe(120)
    expect(parseEstimate('30min')).toBe(30)
    expect(parseEstimate('90m')).toBe(90)
    expect(parseEstimate('30 minutes')).toBe(30)
    expect(parseEstimate('no estimate')).toBe(0)
    expect(parseEstimate(7)).toBe(0)
  })

  it('finds the next local 08:00', () => {
    expect(nextEightAm(new Date(2026, 10, 16, 7, 59, 0, 0))).toEqual(new Date(2026, 10, 16, 8, 0, 0, 0))
    expect(nextEightAm(new Date(2026, 10, 16, 8, 0, 0, 0))).toEqual(new Date(2026, 10, 17, 8, 0, 0, 0))
    expect(nextEightAm(new Date(2026, 10, 16, 9, 30, 0, 0))).toEqual(new Date(2026, 10, 17, 8, 0, 0, 0))
  })
})

describe('parseDailyReport', () => {
  it('accepts a valid report and rejects corrupt or foreign shapes', () => {
    const report = reportOf()
    expect(parseDailyReport(JSON.stringify(report))).toMatchObject({ date: '2026-11-15', source: 'auto' })
    expect(parseDailyReport(undefined)).toBeNull()
    expect(parseDailyReport('')).toBeNull()
    expect(parseDailyReport('{')).toBeNull()
    expect(parseDailyReport('null')).toBeNull()
    expect(parseDailyReport('[]')).toBeNull()
    expect(parseDailyReport('{"slots":[]}')).toBeNull()
    expect(parseDailyReport('{"date":"2026-11-15","items":[],"tracks":[],"unfilled":[],"notes":[]}')).toBeNull()
    expect(parseDailyReport('{"date":7,"slots":[],"items":[],"tracks":[],"unfilled":[],"notes":[]}')).toBeNull()
  })
})

describe('computeDailyBrief selection', () => {
  it('picks the running frontier for the core window and a cold leaf for the definition window', () => {
    seedLiveLike(store)
    const report = reportOf()
    expect(report).toMatchObject({ date: '2026-11-15', generatedAt: '2026-11-15T00:05:00.000Z', source: 'auto', dayKind: 'weekend' })
    expect(report.slots).toHaveLength(2)
    expect(report.slots.map(window => window.kind)).toEqual(['core', 'definition'])
    expect(report.items.map(item => [item.role, item.trackName, item.ref, item.title])).toEqual([
      ['core', '投资系统', 'node:1.8.1', 'S2 每日交易仓读数'],
      ['definition', '内容平台', 'node:6.1', '内容选题'],
    ])
    expect(report.unfilled).toEqual([])
    expect(report.notes).toEqual([])
    expect(report.tracks.map(track => track.ref)).toEqual(['track:1', 'track:2', 'track:3', 'track:4', 'track:5', 'track:6'])
    expect(report.tracks.map(track => track.role)).toEqual(['core', 'blocked', 'core', 'core', 'blocked', 'rotation'])
    expect(report.tracks.map(track => track.picks)).toEqual([1, 0, 0, 0, 0, 1])
    expect(report.tracks[0].frontier).toMatchObject({ ref: 'node:1.9.1' })
    expect(report.tracks[0].next).toMatchObject({ ref: 'node:1.8.1' })
    expect(report.tracks[5].next).toMatchObject({ ref: 'node:6.1' })
  })

  it('assigns item roles chronologically and lets exhausted budgets fall through to rotation', () => {
    seedLiveLike(store)
    const report = computeDailyBrief({ date: '2026-11-15', generatedAt: 'now', dayKind: 'workday', tree: store.tree(), blocks: [ block('a', '09:00', '11:00'), block('b', '12:00', '14:00'), block('c', '09:30', '10:30')] })
    expect(report.slots.map(window => window.kind)).toEqual(['core', 'definition', 'core'])
    expect(report.items.map(item => item.role)).toEqual(['core', 'rotation', 'core'])
  })

  it('fills the definition role from the rotation tier and falls back through core', () => {
    store.create({ title: 'Only core track', kind: 'track', status: 'in_progress' })
    const track = store.tree()[0]
    store.create({ title: 'Core leaf one', parentId: track.id, ref: 'node:1.1' })
    store.create({ title: 'Core leaf two', parentId: track.id, ref: 'node:1.2' })
    const report = computeDailyBrief({ date: '2026-11-15', generatedAt: 'now', dayKind: 'weekend', tree: store.tree(), blocks: [block('a', '09:00', '11:00'), block('b', '09:30', '10:30')] })
    expect(report.items.map(item => [item.role, item.title])).toEqual([['core', 'Core leaf one'], ['definition', 'Core leaf two']])
  })

  it('falls back to blocked tracks when core and rotation tiers have no leaves', () => {
    store.create({ title: 'Core track', kind: 'track', status: 'in_progress' })
    store.create({ title: 'Blocked track', kind: 'track', state: '卡住' })
    const [coreTrack, blockedTrack] = store.tree()
    store.create({ title: 'Done leaf', parentId: coreTrack.id, status: 'done', ref: 'node:9.1' })
    store.create({ title: 'Stuck leaf', parentId: blockedTrack.id, status: 'blocked', ref: 'node:9.2' })
    const report = computeDailyBrief({ date: '2026-11-15', generatedAt: 'now', dayKind: 'workday', tree: store.tree(), blocks: [block('a', '09:00', '11:00')] })
    expect(report.items.map(item => [item.role, item.title])).toEqual([['core', 'Stuck leaf']])
  })

  it('round-robins across tracks of a tier and never repeats a task', () => {
    store.create({ title: 'Track A', kind: 'track', status: 'in_progress', sortOrder: 0 })
    store.create({ title: 'Track B', kind: 'track', status: 'in_progress', sortOrder: 1 })
    const [trackA, trackB] = store.tree()
    store.create({ title: 'A ready', parentId: trackA.id, ref: 'node:1.1' })
    store.create({ title: 'B ready', parentId: trackB.id, ref: 'node:2.1' })
    const report = computeDailyBrief({ date: '2026-11-15', generatedAt: 'now', dayKind: 'workday', tree: store.tree(), blocks: [block('a', '09:00', '11:00'), block('b', '12:00', '14:00')] })
    expect(report.items.map(item => [item.trackName, item.title])).toEqual([
      ['Track A', 'A ready'],
      ['Track B', 'B ready'],
    ])
    expect(new Set(report.items.map(item => item.taskId)).size).toBe(2)
  })

  it('orders the rotation tier by least-recently-picked, never-picked first', () => {
    store.create({ title: 'Rotation A', kind: 'track', sortOrder: 0 })
    store.create({ title: 'Rotation B', kind: 'track', sortOrder: 1 })
    const [trackA, trackB] = store.tree()
    store.create({ title: 'A leaf', parentId: trackA.id, ref: 'node:1.1' })
    store.create({ title: 'B leaf', parentId: trackB.id, ref: 'node:2.1' })
    const previous = [{
      date: '2026-11-14',
      items: [{ trackId: trackA.id, role: 'definition' }],
    }]
    const report = computeDailyBrief({ date: '2026-11-15', generatedAt: 'now', dayKind: 'workday', tree: store.tree(), previous, blocks: [block('a', '09:30', '10:30'), block('b', '11:00', '12:00')] })
    expect(report.items.map(item => item.trackName)).toEqual(['Rotation B', 'Rotation A'])
  })

  it('keeps the latest previous pick per track and orders by least-recently-picked', () => {
    store.create({ title: 'Track A', kind: 'track', sortOrder: 0 })
    store.create({ title: 'Track B', kind: 'track', sortOrder: 1 })
    store.create({ title: 'Track C', kind: 'track', sortOrder: 2 })
    const [trackA, trackB, trackC] = store.tree()
    store.create({ title: 'A leaf', parentId: trackA.id, ref: 'node:1.1' })
    store.create({ title: 'B leaf', parentId: trackB.id, ref: 'node:2.1' })
    store.create({ title: 'C leaf', parentId: trackC.id, ref: 'node:3.1' })
    const previous = [
      { date: '2026-11-13', items: [{ trackId: trackA.id }] }, { date: '2026-11-10', items: [{ trackId: trackA.id }] }, { date: '2026-11-12', items: [{ trackId: trackC.id }] },
    ]
    const report = computeDailyBrief({ date: '2026-11-15', generatedAt: 'now', dayKind: 'workday', tree: store.tree(), previous, blocks: [block('a', '09:00', '10:00'), block('b', '10:00', '11:00'), block('c', '11:00', '12:00')] })
    expect(report.items.map(item => item.trackName)).toEqual(['Track B', 'Track C', 'Track A'])
    expect(report.tracks.map(track => track.picks)).toEqual([1, 1, 1])
  })

  it('orders two picked tracks oldest-first regardless of input order', () => {
    store.create({ title: 'Older pick', kind: 'track', sortOrder: 0 })
    store.create({ title: 'Newer pick', kind: 'track', sortOrder: 1 })
    const [older, newer] = store.tree()
    store.create({ title: 'Older leaf', parentId: older.id, ref: 'node:1.1' })
    store.create({ title: 'Newer leaf', parentId: newer.id, ref: 'node:2.1' })
    const report = computeDailyBrief({ date: '2026-11-15', generatedAt: 'now', dayKind: 'workday', tree: store.tree(), previous: [{ date: '2026-11-13', items: [{ trackId: older.id }] }, { date: '2026-11-14', items: [{ trackId: newer.id }] }], blocks: [block('a', '09:30', '10:30'), block('b', '11:00', '12:00')] })
    expect(report.items.map(item => item.trackName)).toEqual(['Older pick', 'Newer pick'])
  })

  it('orders never-picked tracks first regardless of input order', () => {
    store.create({ title: 'Picked first', kind: 'track', sortOrder: 0 })
    store.create({ title: 'Never picked', kind: 'track', sortOrder: 1 })
    const [picked] = store.tree()
    store.create({ title: 'Picked leaf', parentId: picked.id, ref: 'node:1.1' })
    store.create({ title: 'Never leaf', parentId: store.tree()[1].id, ref: 'node:2.1' })
    const report = computeDailyBrief({ date: '2026-11-15', generatedAt: 'now', dayKind: 'workday', tree: store.tree(), previous: [{ date: '2026-11-14', items: [{ trackId: picked.id }] }], blocks: [block('a', '09:30', '10:30'), block('b', '11:00', '12:00')] })
    expect(report.items.map(item => item.trackName)).toEqual(['Never picked', 'Picked first'])
  })

  it('marks unfillable windows and records English diagnostics', () => {
    const report = computeDailyBrief({ date: '2026-11-15', generatedAt: 'now', dayKind: 'weekend', tree: [], blocks: [block('a', '09:00', '11:00')] })
    expect(report.items).toEqual([])
    expect(report.unfilled).toEqual([0])
    expect(report.notes).toEqual(['no candidate for core window 0 (weekend)'])
  })

  it('notes tracks without ready leaves and an unknown day kind without windows', () => {
    store.create({ title: 'Empty track', kind: 'track', state: '进行' })
    const track = store.tree()[0]
    store.create({ title: 'Finished leaf', parentId: track.id, status: 'done', ref: 'node:1.1' })
    const report = computeDailyBrief({ date: '2026-11-15', generatedAt: 'now', dayKind: 'unknown', tree: store.tree(), blocks: [] })
    expect(report.slots).toEqual([])
    expect(report.unfilled).toEqual([])
    expect(report.notes).toEqual(['no plan blocks; no template for unknown day kind', 'no ready leaves for Empty track'])
  })

  it('uses the day-kind template when there are no plan blocks', () => {
    seedLiveLike(store)
    const report = computeDailyBrief({ date: '2026-11-15', generatedAt: 'now', dayKind: 'workday', tree: store.tree(), blocks: [] })
    expect(report.slots).toHaveLength(1)
    expect(report.notes).toEqual(['no plan blocks; workday template used'])
    expect(report.items).toHaveLength(1)
    expect(report.items[0]).toMatchObject({ role: 'rotation', trackName: '内容平台', ref: 'node:6.1' })
  })

  it('respects dependencies and blocked pending leaves', () => {
    store.create({ title: 'Track', kind: 'track', status: 'in_progress' })
    const track = store.tree()[0]
    store.create({ title: 'Done base', parentId: track.id, kind: 'node', status: 'done', ref: 'node:1.1' })
    store.create({ title: 'Ready', parentId: track.id, kind: 'node', ref: 'node:1.2', dep: '1.1' })
    store.create({ title: 'Waiting', parentId: track.id, kind: 'node', ref: 'node:1.3', dep: '1.2' })
    store.create({ title: 'Stuck', parentId: track.id, kind: 'node', status: 'blocked', ref: 'node:1.4' })
    const report = computeDailyBrief({ date: '2026-11-15', generatedAt: 'now', dayKind: 'workday', tree: store.tree(), blocks: [block('a', '09:00', '11:00')] })
    expect(report.items.map(item => item.title)).toEqual(['Ready'])
  })
})

describe('appendBriefSection', () => {
  /** @param {Partial<import('../../daily.js').DailyReport>} [overrides] */
  function miniReport(overrides = {}) {
    return {
      date: '2026-11-15',
      slots: [
        { slot: /** @type {const} */ ('morning'), startTime: '09:00', endTime: '11:00', minutes: 120, kind: /** @type {const} */ ('core'), blockId: 'b1' },
        { slot: /** @type {const} */ ('evening'), startTime: '', endTime: '', minutes: 0, kind: /** @type {const} */ ('definition'), blockId: '' },
      ],
      items: [{
        slot: /** @type {const} */ ('morning'), startTime: '09:00', endTime: '11:00', minutes: 120, blockId: 'b1', taskId: 't1', ref: 'node:1.1', title: 'Ready', trackId: 'tr1', trackName: 'Track', role: /** @type {const} */ ('core'),
      }],
      unfilled: [1],
      ...overrides,
    }
  }

  it('appends window lines with roles, tasks, and unfilled markers', () => {
    const document = { markdown: '# tree\n', chars: 7, truncated: false }
    const result = appendBriefSection(document, /** @type {any} */ (miniReport()), 1000)
    expect(result.markdown).toBe('# tree\n\n## 今日窗口 · 2026-11-15\n- 09:00-11:00 core：Track node:1.1 Ready\n- --:-- 未填\n')
    expect(result.chars).toBe(result.markdown.length)
    expect(result.truncated).toBe(false)
  })

  it('marks a window unfilled when its item is missing and trims to the limit', () => {
    const document = { markdown: '# tree\n', chars: 7, truncated: false }
    const report = miniReport({ items: [], unfilled: [] })
    const full = appendBriefSection(document, /** @type {any} */ (report), 1000)
    expect(full.markdown).toContain('- 09:00-11:00 未填')
    const trimmed = appendBriefSection(document, /** @type {any} */ (miniReport()), 30)
    expect(trimmed.truncated).toBe(true)
    expect(trimmed.chars).toBeLessThanOrEqual(30)
    const alreadyTruncated = appendBriefSection({ markdown: '# tree\n', chars: 7, truncated: true }, /** @type {any} */ (miniReport()), 1000)
    expect(alreadyTruncated.truncated).toBe(true)
  })
})

describe('store dailyBrief / computeDailyBrief', () => {
  it('computes and persists today, then serves it from the cache', () => {
    seedLiveLike(store)
    store.replacePlan({ days: [{ date: todayIso(), dayKind: 'weekend', weekday: '周日' }] })
    store.upsertPlanBlocks(todayIso(), [
      { title: '读数收口', startTime: '09:00', endTime: '17:00', slot: 'morning', landing: 'a.md' },
      { title: '晚格', startTime: '21:00', endTime: '22:00', slot: 'evening', landing: 'b.md', inspiration: '#21' },
    ])
    const first = store.dailyBrief()
    expect(first.cached).toBe(false)
    expect(first.report).toMatchObject({ date: todayIso(), source: 'auto', dayKind: 'weekend' })
    const second = store.dailyBrief()
    expect(second.cached).toBe(true)
    expect(second.report.generatedAt).toBe(first.report.generatedAt)
    expect(store.snapshot().dailyBrief).toEqual(second.report)
    expect(store.dayPlan(todayIso()).brief).toEqual(second.report)
    const row = store.db.prepare('SELECT plan_date AS date, source FROM daily_briefs').get()
    expect(row).toEqual({ date: todayIso(), source: 'auto' })
  })

  it('computes past and future dates without writing them', () => {
    seedLiveLike(store)
    const past = store.dailyBrief('2026-11-10')
    expect(past.cached).toBe(false)
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM daily_briefs').get()).toEqual({ count: 0 })
    expect(store.dailyBrief('2026-11-10').cached).toBe(false)
    expect(store.dailyBrief('2026-11-20').cached).toBe(false)
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM daily_briefs').get()).toEqual({ count: 0 })
  })

  it('forces and persists a manual recompute', () => {
    seedLiveLike(store)
    const manual = store.computeDailyBrief(todayIso(), { source: 'manual' })
    expect(manual).toMatchObject({ date: todayIso(), source: 'manual' })
    const cached = store.dailyBrief()
    expect(cached).toMatchObject({ cached: true, report: { source: 'manual' } })
    expect(store.computeDailyBrief(todayIso()).source).toBe('manual')
    const auto = store.computeDailyBrief(todayIso(), { source: 'auto' })
    expect(auto.source).toBe('auto')
    expect(store.dailyBrief().report.source).toBe('auto')
  })

  it('validates dates and the source', () => {
    expectGanttError(() => store.dailyBrief('nope'), 'date must be a YYYY-MM-DD date')
    expectGanttError(() => store.dailyBrief('2026-02-30'), 'date is not a valid calendar date')
    expectGanttError(() => store.computeDailyBrief('2026-02-30'), 'date is not a valid calendar date')
    expectGanttError(() => store.computeDailyBrief(todayIso(), { source: /** @type {any} */ ('cron') }), 'source must be one of auto, manual')
  })

  it('treats a corrupt cached row as a cache miss and skips corrupt history', () => {
    seedLiveLike(store)
    store.db.prepare('INSERT INTO daily_briefs (plan_date, generated_at, source, report) VALUES (?, ?, ?, ?)').run(todayIso(), 'now', 'auto', '{bad json')
    store.db.prepare('INSERT INTO daily_briefs (plan_date, generated_at, source, report) VALUES (?, ?, ?, ?)').run('2026-11-14', 'now', 'auto', '{bad json')
    const result = store.dailyBrief()
    expect(result.cached).toBe(false)
    expect(store.previousDailyBriefs(todayIso())).toEqual([])
  })

  it('feeds previous persisted reports into rotation fairness', () => {
    store.create({ title: 'Rotation A', kind: 'track', sortOrder: 0 })
    store.create({ title: 'Rotation B', kind: 'track', sortOrder: 1 })
    const [trackA, trackB] = store.tree()
    store.create({ title: 'A leaf', parentId: trackA.id, ref: 'node:1.1' })
    store.create({ title: 'B leaf', parentId: trackB.id, ref: 'node:2.1' })
    insertDailyReport(store, { date: '2026-11-14', generatedAt: '2026-11-14T08:00:00.000Z', source: 'auto', dayKind: 'workday', slots: [], items: [{ trackId: trackA.id, role: 'definition' }], tracks: [], unfilled: [], notes: [] })
    store.upsertPlanBlocks('2026-11-15', [
      { title: 'Morning', startTime: '09:30', endTime: '10:30', slot: 'morning' },
      { title: 'Noon', startTime: '11:00', endTime: '12:00', slot: 'daytime' },
    ])
    const report = store.dailyBrief('2026-11-15').report
    expect(report.items.map(item => item.trackName)).toEqual(['Rotation B', 'Rotation A'])
  })

  it('appends the 今日窗口 section to the context document', () => {
    seedLiveLike(store)
    store.upsertPlanBlocks('2026-11-15', [
      { title: '读数收口', startTime: '09:00', endTime: '17:00', slot: 'morning', landing: 'a.md' },
    ])
    const document = store.contextDocument({ date: '2026-11-15' })
    expect(document.markdown).toContain('## 今日窗口 · 2026-11-15')
    expect(document.markdown).toContain('- 09:00-17:00 core：投资系统 node:1.8.1 S2 每日交易仓读数')
  })
})

describe('startScheduler', () => {
  it('recomputes at the next local 08:00 and disposes idempotently', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 16, 7, 59, 0, 0))
    const schedulerStore = new GanttStore(':memory:')
    const dispose = schedulerStore.startScheduler()
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(60_000)
    expect(schedulerStore.db.prepare('SELECT plan_date AS date, source FROM daily_briefs').get()).toEqual({ date: '2026-11-16', source: 'auto' })
    expect(vi.getTimerCount()).toBe(1)
    dispose()
    expect(vi.getTimerCount()).toBe(0)
    expect(() => dispose()).not.toThrow()
    schedulerStore.close()
  })
})
