import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore, addDays, todayIso } from '../../src/host/store.js'
import { expectGanttError } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** Seed a deterministic two-track tree with one planned day. */
function seedTree() {
  store.replacePlan({
    tracks: [
      { id: '1', name: '投资系统', lane: '赚钱', state: '进行', blocker: '卡点' },
      { id: '2', name: '生活程序', lane: '生活', state: '进行' },
    ],
    nodes: [
      { id: '1.1', trackId: '1', title: '数据底座', state: '已过', startDate: '2026-07-01', endDate: '2026-09-30', dep: '', doneWhen: '表能查' },
      { id: '1.8', trackId: '1', title: '策略实盘化', state: '进行', startDate: '2026-11-01', endDate: '2026-11-20', dep: '', doneWhen: '' },
      { id: '1.8.1', trackId: '1', title: 'S2 读数', state: '未开始', startDate: '2026-11-09', endDate: '2026-11-15', dep: '1.1', doneWhen: '每天一句' },
      { id: '2.1', trackId: '2', title: '生活节点', state: '未开始', startDate: '2026-11-10', endDate: '2026-11-12' },
    ],
    days: [{ date: '2026-11-15', weekday: '周日', dayKind: 'weekend', marketOpen: false, coreGoal: '收表' }],
  })
  store.upsertPlanBlocks('2026-11-15', [
    { title: '读数收口', startTime: '09:00', endTime: '17:00', slot: 'morning', category: 'A 主攻片', landing: 'invest/x.md', estimate: '4h', inspiration: '#21', detail: '' },
    { title: '晚格', startTime: '21:00', endTime: '22:00', slot: 'evening', category: '③ 元能力格', landing: 'wiki/x.md', estimate: '1h', inspiration: '', detail: '' },
  ])
  return store
}

describe('contextDocument markdown', () => {
  it('renders the whole tree and the day plan in the stable format', () => {
    seedTree()
    const document = store.contextDocument({ date: '2026-11-15' })
    expect(document.date).toBe('2026-11-15')
    expect(document.counts).toEqual({ tracks: 2, nodes: 4, tasks: 0, blocks: 2 })
    expect(document.truncated).toBe(false)
    expect(document.chars).toBe(document.markdown.length)
    expect(document.markdown).toBe([
      '# 个人任务树（2 条支线 · 4 个节点）',
      '',
      '## 1. 投资系统（赚钱 · 进行 · 卡住：卡点）',
      '- 1.1 数据底座 [done 已过] 2026-07-01→2026-09-30 · 完成标准 表能查',
      '- 1.8 策略实盘化 [in_progress 进行] 2026-11-09→2026-11-15',
      '  - 1.8.1 S2 读数 [todo 未开始] 2026-11-09→2026-11-15 · 完成标准 每天一句 · 依赖 1.1',
      '',
      '## 2. 生活程序（生活 · 进行）',
      '- 2.1 生活节点 [todo 未开始] 2026-11-10→2026-11-12',
      '',
      '## 今日 2026-11-15（周日 · 周末 · 休市）',
      '- 核心目标：收表',
      '- [todo] 09:00-17:00 A 主攻片 · 读数收口 · 落点 invest/x.md · 预估 4h · 灵感 #21',
      '- [todo] 21:00-22:00 ③ 元能力格 · 晚格 · 落点 wiki/x.md · 预估 1h',
      '',
      '## 完整性提示',
      '- inspiration-missing: 2026-11-15|21:00|1',
      '',
      '## 今日窗口 · 2026-11-15',
      '- 09:00-17:00 core：投资系统 node:1.8.1 S2 读数',
      '- 21:00-22:00 definition：生活程序 node:2.1 生活节点',
      '',
    ].join('\n'))
  })

  it('renders an empty day without a day row and without plan lines', () => {
    store.create({ title: 'Standalone' })
    const document = store.contextDocument({ date: '2024-02-10' })
    expect(document.counts).toEqual({ tracks: 0, nodes: 0, tasks: 1, blocks: 0 })
    expect(document.markdown).toContain('## 今日 2024-02-10\n\n## 完整性提示\n- evening-missing\n- unplanned-day')
    expect(document.markdown).toContain(`- 1 Standalone [todo] ${todayIso()}→${addDays(todayIso(), 3)}`)
    expect(document.truncated).toBe(false)
  })

  it('omits zero segments from the header', () => {
    const empty = store.contextDocument({ date: '2024-02-10' })
    expect(empty.markdown.startsWith('# 个人任务树\n')).toBe(true)
    store.create({ title: 'Only task' })
    expect(store.contextDocument({ date: '2024-02-10' }).markdown.startsWith('# 个人任务树（1 个任务）\n')).toBe(true)
  })

  it('renders inherited task metadata on plan block lines', () => {
    const parent = store.create({ title: 'Parent', startDate: todayIso(), endDate: addDays(todayIso(), 3) })
    store.decompose(parent.id, [{ title: 'Inherited block', landing: 'invest/a.md', estimate: '2h', inspiration: '#21', category: 'A', plan: { date: todayIso() } }])
    const document = store.contextDocument({ date: todayIso() })
    expect(document.markdown).toContain('- [todo] other A · Inherited block · 落点 invest/a.md · 预估 2h · 灵感 #21')
  })

  it('defaults the date to today', () => {
    expect(store.contextDocument().date).toBe(todayIso())
    expect(store.contextDocument().markdown).toContain(`## 今日 ${todayIso()}`)
  })

  it('exports only the requested subtree and counts it alone', () => {
    seedTree()
    const track = store.snapshot().tasks.find(node => node.ref === 'track:2')
    const document = store.contextDocument({ date: '2026-11-15', root: track.id })
    expect(document.counts).toEqual({ tracks: 1, nodes: 1, tasks: 0, blocks: 2 })
    expect(document.markdown).toContain('## 2. 生活程序（生活 · 进行）')
    expect(document.markdown).toContain('生活节点')
    expect(document.markdown).not.toContain('## 1. 投资系统')
    const flat = []
    const walk = (node) => { flat.push(node); node.children.forEach(walk) }
    store.snapshot().tasks.forEach(walk)
    const node = flat.find(task => task.ref === 'node:1.8.1')
    const nodeDocument = store.contextDocument({ date: '2026-11-15', root: node?.id })
    expect(nodeDocument.counts).toEqual({ tracks: 0, nodes: 1, tasks: 0, blocks: 2 })
    expect(nodeDocument.markdown).toContain('S2 读数')
  })

  it('renders every node metadata field, including links', () => {
    store.create({ title: 'Rich task', description: 'detail', dep: '1.1', doneWhen: 'done', landing: 'a.md', estimate: '2h', category: 'A', inspiration: '#21', links: [{ type: 'memory', ref: 'key/x' }], startDate: '2024-02-01', endDate: '2024-02-02' })
    const document = store.contextDocument({ date: '2024-02-10' })
    expect(document.markdown).toContain(
      '- 1 Rich task [todo] 2024-02-01→2024-02-02 · 落点 a.md · 完成标准 done · 依赖 1.1 · 预估 2h · 类 A · 灵感 #21 · 链接 memory:key/x',
    )
  })

  it('labels workday and unknown day kinds and omits an empty integrity section', () => {
    store.replacePlan({
      days: [
        { date: '2026-11-16', weekday: '一', dayKind: 'workday', marketOpen: true },
        { date: '2026-11-17', dayKind: 'unknown', marketOpen: false },
      ],
    })
    store.upsertPlanBlocks('2026-11-16', [
      { title: 'Day', startTime: '09:00', endTime: '10:00', landing: 'a.md' },
      { title: 'Evening', startTime: '21:00', endTime: '22:00', slot: 'evening', landing: 'b.md', inspiration: '#21' },
    ])
    const workday = store.contextDocument({ date: '2026-11-16' })
    expect(workday.markdown).toContain('## 今日 2026-11-16（一 · 工作日 · 交易日）')
    expect(workday.markdown).not.toContain('完整性提示')
    expect(workday.integrity).toBeUndefined()
    const unknown = store.contextDocument({ date: '2026-11-17' })
    expect(unknown.markdown).toContain('## 今日 2026-11-17（休市）')
    expect(unknown.markdown).toContain('## 完整性提示')
  })

  it('validates the date, root, and limit', () => {
    expectGanttError(() => store.contextDocument({ date: '2026-02-30' }), 'date is not a valid calendar date')
    expectGanttError(() => store.contextDocument({ root: 'ghost' }), 'task ghost was not found', 404)
    expectGanttError(() => store.contextDocument({ root: /** @type {any} */ (7) }), 'id is required')
    for (const limit of [999, 60_001, 1000.5, /** @type {any} */ ('1000')]) {
      expectGanttError(
        () => store.contextDocument({ limit: /** @type {any} */ (limit) }),
        'limit must be an integer from 1000 to 60000',
      )
    }
    expect(store.contextDocument({ limit: 1000 }).truncated).toBe(false)
    expect(store.contextDocument({ limit: 60_000 }).truncated).toBe(false)
    expect(store.contextDocument({ root: '' }).counts.tracks).toBe(0)
  })
})

describe('contextDocument truncation', () => {
  it('drops the deepest node lines first', () => {
    const nodes = Array.from({ length: 30 }, (unused, index) => ({
      id: `1.${String(index + 1).padStart(2, '0')}`,
      trackId: '1',
      title: `节点标题 ${index} ${'x'.repeat(80)}`,
      state: '进行',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
    }))
    store.replacePlan({ tracks: [{ id: '1', name: '投资系统' }], nodes })
    const document = store.contextDocument({ date: '2026-11-15', limit: 1000 })
    expect(document.truncated).toBe(true)
    expect(document.chars).toBeLessThanOrEqual(1000)
    expect(document.markdown.startsWith('# 个人任务树（1 条支线 · 30 个节点）')).toBe(true)
    expect(document.markdown).toContain('1.01 节点标题 0 ')
    expect(document.markdown).not.toContain('节点标题 29')
  })

  it('drops the oldest dated plan lines when no node line is left', () => {
    const blocks = Array.from({ length: 12 }, (unused, index) => ({
      title: `计划块 ${index} ${'y'.repeat(120)}`,
      startTime: `${String(8 + index).padStart(2, '0')}:00`,
      landing: 'x.md',
    }))
    store.upsertPlanBlocks('2026-11-15', blocks)
    const document = store.contextDocument({ date: '2026-11-15', limit: 1000 })
    expect(document.truncated).toBe(true)
    expect(document.chars).toBeLessThanOrEqual(1000)
    expect(document.markdown).toContain('## 今日 2026-11-15')
    expect(document.markdown).toContain('计划块 0')
    expect(document.markdown).not.toContain('计划块 11')
  })

  it('hard-cuts a document whose headers alone exceed the limit', () => {
    for (let index = 0; index < 8; index += 1) {
      store.create({ title: `Track ${index} ${'z'.repeat(150)}`, kind: 'track' })
    }
    const document = store.contextDocument({ date: '2026-11-15', limit: 1000 })
    expect(document.truncated).toBe(true)
    expect(document.chars).toBe(1000)
    expect(document.markdown).toHaveLength(1000)
  })

  it('does not flag a document that fits exactly', () => {
    const nodes = Array.from({ length: 12 }, (unused, index) => ({ id: `1.${String(index + 1).padStart(2, '0')}`, trackId: '1', title: `节点 ${index} ${'x'.repeat(80)}`, state: '进行', startDate: '2026-11-01', endDate: '2026-11-30' }))
    store.replacePlan({ tracks: [{ id: '1', name: '投资系统' }], nodes })
    const document = store.contextDocument({ date: '2026-11-15' })
    expect(document.chars).toBeGreaterThan(1000)
    expect(store.contextDocument({ date: '2026-11-15', limit: document.chars }).truncated).toBe(false)
    expect(store.contextDocument({ date: '2026-11-15', limit: document.chars - 1 }).truncated).toBe(true)
  })
})

describe('contextDocument with re-decomposed tasks', () => {
  it('counts client-created tasks and renders their plan cells', () => {
    const parent = store.create({ title: 'Parent', doneWhen: 'done', startDate: addDays(todayIso(), -1), endDate: addDays(todayIso(), 3) })
    store.decompose(parent.id, [{ title: 'Child task', plan: { date: todayIso(), startTime: '10:00', endTime: '11:00' } }])
    const document = store.contextDocument({ date: todayIso() })
    expect(document.counts).toEqual({ tracks: 0, nodes: 0, tasks: 2, blocks: 1 })
    expect(document.markdown).toContain('- 1 Parent [')
    expect(document.markdown).toContain('  - 1.1 Child task [todo]')
    expect(document.markdown).toContain('- [todo] 10:00-11:00 Child task')
  })
})
