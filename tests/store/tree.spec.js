import { describe, expect, it } from 'vitest'
import { buildTree, deriveSummaryStatus } from '../../store.js'
import { byNumber, childTitles, makeRow, makeRows } from '../helpers/gantt.js'

describe('buildTree numbering and shape', () => {
  it('returns an empty forest for no rows', () => {
    expect(buildTree([])).toEqual([])
  })

  it('numbers nested branches 1, 1.1, 1.1.1 in sibling order', () => {
    const tree = buildTree(makeRows(
      { id: 'b', title: 'Second root', sortOrder: 1 },
      { id: 'a', title: 'First root', sortOrder: 0 },
      { id: 'a2', parentId: 'a', title: 'A second', sortOrder: 1 },
      { id: 'a1', parentId: 'a', title: 'A first', sortOrder: 0 },
      { id: 'a11', parentId: 'a1', title: 'A first one', sortOrder: 0 },
      { id: 'b1', parentId: 'b', title: 'B first', sortOrder: 0 },
    ))
    const nodes = byNumber(tree)
    expect([...nodes.keys()]).toEqual(['1', '1.1', '1.1.1', '1.2', '2', '2.1'])
    expect(nodes.get('1').title).toBe('First root')
    expect(nodes.get('2').title).toBe('Second root')
    expect(childTitles(nodes.get('1'))).toEqual(['A first', 'A second'])
    expect(childTitles(nodes.get('1.1'))).toEqual(['A first one'])
  })

  it('reports hasChildren only for nodes that own children', () => {
    const nodes = byNumber(buildTree(makeRows(
      { id: 'root', title: 'Root', sortOrder: 0 },
      { id: 'leaf', parentId: 'root', title: 'Leaf', sortOrder: 0 },
    )))
    expect(nodes.get('1').hasChildren).toBe(true)
    expect(nodes.get('1.1').hasChildren).toBe(false)
    expect(nodes.get('1.1').children).toEqual([])
  })

  it('treats an orphaned parent reference as a root and clears parentId', () => {
    const tree = buildTree(makeRows(
      { id: 'orphan', parentId: 'missing-parent', title: 'Orphan', sortOrder: 0 },
      { id: 'empty', parentId: '', title: 'Empty parent', sortOrder: 1 },
      { id: 'real', title: 'Real root', sortOrder: 2 },
    ))
    expect(tree.map(node => node.title)).toEqual(['Orphan', 'Empty parent', 'Real root'])
    expect(tree.map(node => node.parentId)).toEqual([null, null, null])
    expect(tree.map(node => node.number)).toEqual(['1', '2', '3'])
  })

  it('orders siblings by sortOrder, then createdAt, then id', () => {
    const tree = buildTree([
      { ...makeRow({ id: 'z', title: 'z', sortOrder: 0, createdAt: '2024-01-01T00:00:00.000Z' }) },
      { ...makeRow({ id: 'a', title: 'a', sortOrder: 0, createdAt: '2024-01-01T00:00:00.000Z' }) },
      { ...makeRow({ id: 'm', title: 'm', sortOrder: 0, createdAt: '2023-12-31T00:00:00.000Z' }) },
      { ...makeRow({ id: 'last', title: 'last', sortOrder: 5, createdAt: '2020-01-01T00:00:00.000Z' }) },
      { ...makeRow({ id: 'first', title: 'first', sortOrder: -1, createdAt: '2025-01-01T00:00:00.000Z' }) },
    ])
    expect(tree.map(node => node.title)).toEqual(['first', 'm', 'a', 'z', 'last'])
  })

  it('does not mutate the input rows', () => {
    const rows = makeRows(
      { id: 'root', title: 'Root', sortOrder: 0 },
      { id: 'child', parentId: 'root', title: 'Child', sortOrder: 0 },
    )
    const frozen = JSON.parse(JSON.stringify(rows))
    buildTree(rows)
    expect(rows).toEqual(frozen)
  })
})

describe('buildTree rollups', () => {
  it('rolls child dates, progress, and status up to the parent', () => {
    const nodes = byNumber(buildTree(makeRows(
      { id: 'p', title: 'Parent', startDate: '2024-01-10', endDate: '2024-01-11', sortOrder: 0 },
      { id: 'c1', parentId: 'p', title: 'Done child', sortOrder: 0, status: 'done', progress: 100, startDate: '2024-01-05', endDate: '2024-01-10' },
      { id: 'c2', parentId: 'p', title: 'Busy child', sortOrder: 1, status: 'in_progress', progress: 20, startDate: '2024-01-01', endDate: '2024-01-20' },
      { id: 'c3', parentId: 'p', title: 'Todo child', sortOrder: 2, status: 'todo', progress: 0, startDate: '2024-01-03', endDate: '2024-01-15' },
    )))
    const parent = nodes.get('1')
    expect(parent.startDate).toBe('2024-01-01')
    expect(parent.endDate).toBe('2024-01-20')
    expect(parent.progress).toBe(40)
    expect(parent.status).toBe('in_progress')
  })

  it('reports a parent as done when every child is done', () => {
    const nodes = byNumber(buildTree(makeRows(
      { id: 'p', title: 'Parent', sortOrder: 0 },
      { id: 'c1', parentId: 'p', title: 'One', sortOrder: 0, status: 'done', progress: 100 },
      { id: 'c2', parentId: 'p', title: 'Two', sortOrder: 1, status: 'done', progress: 100 },
    )))
    expect(nodes.get('1').status).toBe('done')
    expect(nodes.get('1').progress).toBe(100)
  })

  it('reports a parent as blocked when any child is blocked', () => {
    const nodes = byNumber(buildTree(makeRows(
      { id: 'p', title: 'Parent', sortOrder: 0 },
      { id: 'c1', parentId: 'p', title: 'Blocked', sortOrder: 0, status: 'blocked', progress: 0 },
      { id: 'c2', parentId: 'p', title: 'Busy', sortOrder: 1, status: 'in_progress', progress: 100 },
    )))
    expect(nodes.get('1').status).toBe('blocked')
  })

  it('reports a parent as todo when children are untouched', () => {
    const nodes = byNumber(buildTree(makeRows(
      { id: 'p', title: 'Parent', sortOrder: 0 },
      { id: 'c1', parentId: 'p', title: 'One', sortOrder: 0, status: 'todo', progress: 0 },
      { id: 'c2', parentId: 'p', title: 'Two', sortOrder: 1, status: 'todo', progress: 0 },
    )))
    expect(nodes.get('1').status).toBe('todo')
    expect(nodes.get('1').progress).toBe(0)
  })

  it('reports a parent as in_progress when child progress is positive without in_progress children', () => {
    const nodes = byNumber(buildTree(makeRows(
      { id: 'p', title: 'Parent', sortOrder: 0 },
      { id: 'c1', parentId: 'p', title: 'One', sortOrder: 0, status: 'todo', progress: 10 },
    )))
    expect(nodes.get('1').status).toBe('in_progress')
    expect(nodes.get('1').progress).toBe(10)
  })

  it('rolls up nested grandchildren before rolling up the root', () => {
    const nodes = byNumber(buildTree(makeRows(
      { id: 'p', title: 'Parent', sortOrder: 0 },
      { id: 'c1', parentId: 'p', title: 'Child', sortOrder: 0 },
      { id: 'g1', parentId: 'c1', title: 'Grandchild one', sortOrder: 0, status: 'done', progress: 100, startDate: '2024-02-10', endDate: '2024-02-12' },
      { id: 'g2', parentId: 'c1', title: 'Grandchild two', sortOrder: 1, status: 'in_progress', progress: 50, startDate: '2024-02-05', endDate: '2024-02-20' },
    )))
    expect(nodes.get('1.1').progress).toBe(75)
    expect(nodes.get('1.1').startDate).toBe('2024-02-05')
    expect(nodes.get('1.1').endDate).toBe('2024-02-20')
    expect(nodes.get('1').progress).toBe(75)
    expect(nodes.get('1').status).toBe('in_progress')
    expect(nodes.get('1').number).toBe('1')
    expect(nodes.get('1.1.2').number).toBe('1.1.2')
  })
})

describe('deriveSummaryStatus', () => {
  it('summarizes an only-childless list by progress', () => {
    expect(deriveSummaryStatus([], 0)).toBe('todo')
    expect(deriveSummaryStatus([], 7)).toBe('in_progress')
  })

  it('prefers done, then blocked, then in_progress', () => {
    expect(deriveSummaryStatus([{ status: 'done' }, { status: 'done' }], 0)).toBe('done')
    expect(deriveSummaryStatus([{ status: 'done' }, { status: 'blocked' }], 100)).toBe('blocked')
    expect(deriveSummaryStatus([{ status: 'done' }, { status: 'in_progress' }], 0)).toBe('in_progress')
    expect(deriveSummaryStatus([{ status: 'done' }, { status: 'todo' }], 25)).toBe('in_progress')
    expect(deriveSummaryStatus([{ status: 'todo' }, { status: 'todo' }], 0)).toBe('todo')
  })
})
