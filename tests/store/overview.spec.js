import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore } from '../../src/host/store.js'
import { renderTreeOverview } from '../../src/host/tree/overview.js'
import { expectGanttError } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** The fixture mirrors the real tree that motivated the tool: a concept four
 * levels down (冰点抄底) is invisible in the two-level overview but reachable
 * by drilling its parent, and a second track stays a childless leaf. */
function makeTree() {
  const invest = store.create({ title: '投资系统', kind: 'track', ref: 'track:1' })
  store.create({ title: '数据底座', status: 'done', parentId: invest.id })
  const strategy = store.create({ title: '长期策略', parentId: invest.id })
  store.create({ title: '冰点抄底', parentId: strategy.id })
  const trend = store.create({ title: '趋势跟踪', parentId: strategy.id })
  store.create({ title: '信号复核', status: 'in_progress', parentId: trend.id })
  store.create({ title: '打工', kind: 'track', ref: 'track:2' })
  store.create({ title: '随手记' })
  return store.tree()
}

describe('renderTreeOverview', () => {
  it('renders the whole tree at two levels with drillable rows marked', () => {
    const markdown = renderTreeOverview(makeTree())
    expect(markdown).toContain('# 任务树概览（2 条支线 · 1 个顶层任务 · 前两层）')
    expect(markdown).toContain('- 1 投资系统（支线 · 进行中） · 2 个子任务')
    expect(markdown).toContain('  - 1.1 数据底座（任务 · 已完成）')
    expect(markdown).toContain('  - 1.2 长期策略（任务 · 进行中） · 2 个子任务')
    expect(markdown).toContain('- 2 打工（支线 · 待办）')
    expect(markdown).toContain('- 3 随手记（任务 · 待办）')
    expect(markdown).not.toContain('冰点抄底')
    expect(markdown).toContain('把它的点号作为下钻父任务再查一层即可')
  })

  it('renders an empty tree without a drill hint', () => {
    const markdown = renderTreeOverview([])
    expect(markdown).toContain('# 任务树概览（前两层）')
    expect(markdown).toContain('（任务树为空。）')
    expect(markdown).not.toContain('下钻')
  })

  it('renders the one level below a parent and keeps deeper rows hidden', () => {
    const tree = makeTree()
    const strategy = tree[0].children[1]
    const markdown = renderTreeOverview(tree, strategy)
    expect(markdown).toContain('# 1.2 长期策略（任务 · 进行中）的下一层')
    expect(markdown).toContain('- 1.2.1 冰点抄底（任务 · 待办）')
    expect(markdown).toContain('- 1.2.2 趋势跟踪（任务 · 进行中） · 1 个子任务')
    expect(markdown).not.toContain('信号复核')
    expect(markdown).toContain('再查一层即可')
  })

  it('marks a childless parent as the finest level without a drill hint', () => {
    const tree = makeTree()
    const leaf = tree[0].children[1].children[0]
    const markdown = renderTreeOverview(tree, leaf)
    expect(markdown).toContain('# 1.2.1 冰点抄底（任务 · 待办）的下一层')
    expect(markdown).toContain('（无子任务——已是最细一层。）')
    expect(markdown).not.toContain('再查一层即可')
  })

  it('falls back to the raw kind and status outside the label vocabularies', () => {
    const base = { description: '', doneWhen: '', ref: '' }
    const child = { ...base, id: 'c1', parentId: 'p1', title: 'Odd child', number: '1.1', kind: 'alien', status: 'paused', children: [] }
    const parent = { ...base, id: 'p1', parentId: null, title: 'Odd parent', number: '1', kind: 'alien', status: 'paused', children: [child] }
    const markdown = renderTreeOverview(/** @type {any} */ ([parent]), /** @type {any} */ (parent))
    expect(markdown).toContain('# 1 Odd parent（alien · paused）的下一层')
    expect(markdown).toContain('- 1.1 Odd child（alien · paused）')
  })
})

describe('GanttStore.treeOverview', () => {
  it('returns the two-level whole tree by default', () => {
    makeTree()
    const result = store.treeOverview()
    expect(result.parentId).toBeNull()
    expect(result.chars).toBe(result.markdown.length)
    expect(result.markdown).toContain('# 任务树概览（2 条支线 · 1 个顶层任务 · 前两层）')
    expect(result.markdown).toContain('长期策略')
    expect(result.markdown).not.toContain('冰点抄底')
  })

  it('drills into the parent named by internal id', () => {
    const tree = makeTree()
    const strategy = tree[0].children[1]
    const result = store.treeOverview(strategy.id)
    expect(result.parentId).toBe(strategy.id)
    expect(result.markdown).toContain('# 1.2 长期策略（任务 · 进行中）的下一层')
    expect(result.markdown).toContain('冰点抄底')
    expect(result.markdown).not.toContain('数据底座')
  })

  it('rejects an unknown or blank parent id', () => {
    makeTree()
    expectGanttError(() => store.treeOverview('missing'), 'task missing was not found', 404)
    expectGanttError(() => store.treeOverview(''), 'id is required', 400)
  })
})
