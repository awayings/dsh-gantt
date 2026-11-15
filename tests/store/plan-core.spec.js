import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore, PLAN_STATUSES, SCHEMA_VERSION } from '../../store.js'
import { expectGanttError, makeTempDir, removeTempDir } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

describe('schema v2', () => {
  it('creates the plan tables, index, and version next to tasks', () => {
    const tables = /** @type {{ name: string }[]} */ (
      store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    ).map(row => row.name)
    expect(tables).toEqual(expect.arrayContaining(['day_plans', 'nodes', 'plan_blocks', 'tasks', 'tracks']))
    const indexes = /** @type {{ name: string }[]} */ (
      store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()
    ).map(row => row.name)
    expect(indexes).toContain('idx_plan_blocks_date')
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(SCHEMA_VERSION).toBe(2)
    expect(PLAN_STATUSES).toEqual(['todo', 'in_progress', 'done', 'skipped'])
  })
})

describe('replacePlan', () => {
  it('clears the imported tree when called with no input', () => {
    store.replacePlan({
      tracks: [{ id: '1', name: '投资系统' }],
      nodes: [{ id: '1.1', trackId: '1', title: '节点' }],
      days: [{ date: '2026-11-15' }],
    })
    expect(store.replacePlan()).toEqual({ tracks: 0, nodes: 0, days: 0 })
    const bundle = store.dayPlan('2026-11-15')
    expect(bundle.tracks).toEqual([])
    expect(bundle.blocks).toEqual([])
    expect(bundle.nodes).toEqual([])
    expect(bundle.day).toMatchObject({ date: '2026-11-15', weekday: '' })
  })

  it('stores tracks, nodes, and day metadata with sane defaults', () => {
    const counts = store.replacePlan({
      tracks: [
        { id: '1', name: '投资系统', lane: '赚钱', priority: '高', state: '进行', blocker: '卡住' },
        { id: '2', name: '打工' },
      ],
      nodes: [
        { id: '1.1', trackId: '1', title: '数据底座', state: '已过', startDate: '2026-07-01', endDate: '2026-09-30', dep: '', doneWhen: '表能查' },
        { id: '1.2', trackId: '1', title: '回测引擎', state: '进行', startDate: null, endDate: null },
      ],
      days: [
        { date: '2026-11-15', weekday: '周日', dayKind: 'weekend', label: '周末（休市）', coreGoal: '收表' },
        { date: '2026-11-16', marketOpen: true, source: 'manual' },
      ],
    })
    expect(counts).toEqual({ tracks: 2, nodes: 2, days: 2 })
    const bundle = store.dayPlan('2026-11-15')
    expect(bundle.tracks).toEqual([
      { id: '1', name: '投资系统', lane: '赚钱', priority: '高', state: '进行', blocker: '卡住', sortOrder: 0 },
      { id: '2', name: '打工', lane: '', priority: '', state: '', blocker: '', sortOrder: 1 },
    ])
    expect(bundle.day).toEqual({
      date: '2026-11-15',
      weekday: '周日',
      dayKind: 'weekend',
      marketOpen: false,
      label: '周末（休市）',
      coreGoal: '收表',
      source: 'schedule',
    })
    expect(store.dayPlan('2026-11-16').day).toEqual({
      date: '2026-11-16',
      weekday: '',
      dayKind: 'unknown',
      marketOpen: true,
      label: '',
      coreGoal: '',
      source: 'manual',
    })
    expect(store.dayPlan('2026-11-16').nodes.map(node => node.id)).toEqual([])
  })

  it('replaces the previous tree instead of appending to it', () => {
    store.replacePlan({ tracks: [{ id: '1', name: '旧支线' }], days: [{ date: '2026-11-15' }] })
    store.replacePlan({ tracks: [{ id: '2', name: '新支线' }] })
    expect(store.dayPlan('2026-11-15').tracks.map(track => track.id)).toEqual(['2'])
  })

  it('degrades non-string optional fields and accepts partial parsed rows', () => {
    store.replacePlan({
      tracks: [{ id: '1', name: '投资系统', lane: 7 }],
      nodes: [{ id: '1.1', title: '节点', trackId: 7, state: 7, dep: 7, doneWhen: 7 }],
      days: [{ date: '2026-11-15', weekday: 7, label: 7, coreGoal: 7 }],
    })
    const bundle = store.dayPlan('2026-11-15')
    expect(bundle.tracks[0]).toMatchObject({ lane: '', priority: '', state: '', blocker: '' })
    expect(bundle.day).toMatchObject({ weekday: '', label: '', coreGoal: '', source: 'schedule' })
  })

  it('validates lists before writing anything', () => {
    store.replacePlan({ tracks: [{ id: '1', name: '保留' }] })
    expectGanttError(() => store.replacePlan({ tracks: 'nope' }), 'tracks must be an array')
    expectGanttError(() => store.replacePlan({ tracks: [null] }), 'tracks[0] must be an object')
    expectGanttError(() => store.replacePlan({ tracks: [{ name: '无 id' }] }), 'tracks[0].id is required')
    expectGanttError(() => store.replacePlan({ tracks: [{ id: '1', name: '  ' }] }), 'tracks[0].name is required')
    expectGanttError(() => store.replacePlan({ nodes: 'nope' }), 'nodes must be an array')
    expectGanttError(() => store.replacePlan({ nodes: [null] }), 'nodes[0] must be an object')
    expectGanttError(() => store.replacePlan({ nodes: [{ title: '无 id' }] }), 'nodes[0].id is required')
    expectGanttError(() => store.replacePlan({ nodes: [{ id: '1.1' }] }), 'nodes[0].title is required')
    expectGanttError(() => store.replacePlan({ nodes: [{ id: '1.1', title: 'x', startDate: '2026-02-30' }] }), 'nodes[0].startDate is not a valid calendar date')
    expectGanttError(() => store.replacePlan({ nodes: [{ id: '1.1', title: 'x', endDate: '2026-13-01' }] }), 'nodes[0].endDate is not a valid calendar date')
    expectGanttError(() => store.replacePlan({ days: 'nope' }), 'days must be an array')
    expectGanttError(() => store.replacePlan({ days: [null] }), 'days[0] must be an object')
    expectGanttError(() => store.replacePlan({ days: [{ date: '2026-1-1' }] }), 'days[0].date must be a YYYY-MM-DD date')
    expectGanttError(() => store.replacePlan({ days: [{ date: '2026-11-15', dayKind: 'holiday' }] }), 'days[0].dayKind must be one of workday, weekend, unknown')
    expect(store.dayPlan('2026-11-15').tracks.map(track => track.name)).toEqual(['保留'])
  })

  it('keeps its tables on a file-backed database across a reopen', () => {
    const dir = makeTempDir('dsh-gantt-plan-')
    const file = `${dir}/plan.db`
    try {
      const first = new GanttStore(file)
      first.replacePlan({ tracks: [{ id: '1', name: '投资系统' }], days: [{ date: '2026-11-15' }] })
      first.close()
      const second = new GanttStore(file)
      expect(second.dayPlan('2026-11-15').tracks).toHaveLength(1)
      second.close()
    } finally {
      removeTempDir(dir)
    }
  })
})
