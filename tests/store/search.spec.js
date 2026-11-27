import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore } from '../../src/host/store.js'
import { SEARCH_FIELDS, collectSearchMatches } from '../../src/host/tree/search.js'
import { expectGanttError } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** The locator fixture mirrors the tree that motivated the tool: one concept
 * (冰点) lives in two different chains — once inside a longer title, once only
 * in description and doneWhen — and one hit is already done, so a search must
 * cross branches, depths, and statuses to find them all. */
function makeTree() {
  const invest = store.create({ title: '投资系统', kind: 'track', ref: 'track:1' })
  const flow = store.create({ title: '中美资金流动态模型', parentId: invest.id })
  store.create({
    title: '投资因子流程状态盘点：五步流程覆盖现状 + 冰点反弹因子所处阶段',
    description: '五步流程的覆盖现状，其中冰点反弹因子处于初步验证阶段。',
    parentId: flow.id,
  })
  const strategy = store.create({ title: '长期策略', parentId: invest.id })
  store.create({ title: '冰点抄底', parentId: strategy.id })
  store.create({
    title: '历史复盘',
    description: '复盘两次冰点的买入窗口。',
    doneWhen: '两次冰点的窗口写进复盘文档',
    status: 'done',
    parentId: invest.id,
  })
  const work = store.create({ title: '打工', kind: 'track', ref: 'track:2' })
  store.create({ title: 'Iceberg sweep', description: 'A frozen sweep', parentId: work.id })
  return store.tree()
}

describe('collectSearchMatches', () => {
  it('finds one concept across branches, depths, and statuses', () => {
    const tree = makeTree()
    const entries = collectSearchMatches(tree, '冰点')
    expect(entries.map(entry => entry.task.number)).toEqual(['1.1.1', '1.2.1', '1.3'])
    expect(entries.map(entry => entry.matchedFields)).toEqual([
      ['title', 'description'], ['title'], ['description', 'doneWhen'],
    ])
    expect(entries.map(entry => entry.chain)).toEqual([
      [{ number: '1', title: '投资系统' }, { number: '1.1', title: '中美资金流动态模型' }],
      [{ number: '1', title: '投资系统' }, { number: '1.2', title: '长期策略' }],
      [{ number: '1', title: '投资系统' }],
    ])
    expect(entries.map(entry => [entry.trackId, entry.trackName])).toEqual([
      [tree[0].id, '投资系统'], [tree[0].id, '投资系统'], [tree[0].id, '投资系统'],
    ])
  })

  it('matches case-insensitively over the documented fields', () => {
    makeTree()
    expect(SEARCH_FIELDS).toEqual(['title', 'description', 'doneWhen'])
    expect(collectSearchMatches(store.tree(), 'ICE').map(entry => [entry.task.number, entry.matchedFields]))
      .toEqual([['2.1', ['title']]])
    expect(collectSearchMatches(store.tree(), 'frozen sweep').map(entry => entry.task.number)).toEqual(['2.1'])
    expect(collectSearchMatches([], 'missing')).toEqual([])
  })

  it('keeps a root hit chainless and stops at a parent missing from the tree', () => {
    const base = { description: '', doneWhen: '', kind: 'task', ref: '', status: 'todo' }
    const root = { ...base, id: 'r1', parentId: null, title: 'Ice root', number: '1', children: [] }
    root.children.push({ ...base, id: 'c1', parentId: 'ghost', title: 'Ice leaf', number: '1.1', children: [] })
    const entries = collectSearchMatches(/** @type {any} */ ([root]), 'ice')
    expect(entries.map(entry => [entry.task.id, entry.chain, entry.trackId])).toEqual([
      ['r1', [], 'r1'],
      ['c1', [], 'r1'],
    ])
    expect(entries.map(entry => entry.trackName)).toEqual(['Ice root', 'Ice root'])
  })
})

describe('GanttStore.searchTasks', () => {
  it('returns the documented rows in document order', () => {
    makeTree()
    const result = store.searchTasks({ q: '冰点' })
    expect(result.q).toBe('冰点')
    expect(result.total).toBe(3)
    expect(result.tasks).toHaveLength(3)
    expect(result.tasks[0]).toEqual({
      id: expect.any(String),
      number: '1.1.1',
      ref: '',
      title: '投资因子流程状态盘点：五步流程覆盖现状 + 冰点反弹因子所处阶段',
      kind: 'task',
      status: 'todo',
      description: '五步流程的覆盖现状，其中冰点反弹因子处于初步验证阶段。',
      doneWhen: '',
      matchedFields: ['title', 'description'],
      chain: [{ number: '1', title: '投资系统' }, { number: '1.1', title: '中美资金流动态模型' }],
      trackId: expect.any(String),
      trackName: '投资系统',
    })
    expect(result.tasks[2]).toMatchObject({ number: '1.3', status: 'done', matchedFields: ['description', 'doneWhen'] })
  })

  it('caps the page while total keeps the full match count', () => {
    makeTree()
    const capped = store.searchTasks({ q: '冰点', limit: 2 })
    expect(capped.total).toBe(3)
    expect(capped.tasks.map(task => task.number)).toEqual(['1.1.1', '1.2.1'])
    expect(store.searchTasks({ q: ' 冰点 ' }).tasks).toHaveLength(3)
    expect(store.searchTasks({ q: '冰点', limit: '2' }).tasks).toHaveLength(2)
    expect(store.searchTasks({ q: 'missing-keyword' })).toEqual({ q: 'missing-keyword', total: 0, tasks: [] })
  })

  it('matches a track itself and reports it under its own id', () => {
    makeTree()
    const result = store.searchTasks({ q: '打工' })
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0]).toMatchObject({ number: '2', kind: 'track', chain: [], trackName: '打工' })
    expect(result.tasks[0].id).toBe(result.tasks[0].trackId)
  })

  it('validates the keyword and the limit', () => {
    makeTree()
    for (const q of [undefined, null, '', '   ', 7]) {
      expectGanttError(() => store.searchTasks({ q }), 'q is required')
    }
    expectGanttError(() => store.searchTasks({ q: 'x'.repeat(201) }), 'q must be at most 200 characters')
    expect(store.searchTasks({ q: 'x'.repeat(200) }).total).toBe(0)
    expectGanttError(() => store.searchTasks({ q: '冰点', limit: 0 }), 'limit must be an integer from 1 to 100')
    expectGanttError(() => store.searchTasks({ q: '冰点', limit: 'two' }), 'limit must be an integer from 1 to 100')
  })
})
