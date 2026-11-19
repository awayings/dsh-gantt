import { describe, expect, it } from 'vitest'
import { buildTree } from '../../src/host/store.js'
import { TAG_MODES, filterTreeByTags, matchesTagFilter, normalizeTagMode } from '../../src/host/tree/tag-filter.js'
import { expectGanttError, makeRows } from '../helpers/gantt.js'

/** A forest with one deep path, one matched parent, and one untagged root. */
function build() {
  return buildTree(makeRows(
    { id: 'track', title: 'Track', tags: ['ops'], sortOrder: 0, startDate: '2024-01-01', endDate: '2024-01-10' },
    { id: 'ui', parentId: 'track', title: 'UI', tags: ['ui'], sortOrder: 0, status: 'done', progress: 100, startDate: '2024-01-01', endDate: '2024-01-02' },
    { id: 'ops', parentId: 'track', title: 'Ops', tags: ['ops'], sortOrder: 1, status: 'in_progress', progress: 40, startDate: '2024-01-03', endDate: '2024-01-06' },
    { id: 'infra', parentId: 'ops', title: 'Infra', tags: ['ops', 'infra'], sortOrder: 0, startDate: '2024-01-03', endDate: '2024-01-04' },
    { id: 'plain', title: 'Plain', sortOrder: 1, startDate: '2024-02-01', endDate: '2024-02-02' },
    { id: 'group', title: 'Group', tags: ['ui'], sortOrder: 2, startDate: '2024-03-01', endDate: '2024-03-05' },
    { id: 'group-leaf', parentId: 'group', title: 'Group leaf', sortOrder: 0, status: 'done', progress: 100, startDate: '2024-03-01', endDate: '2024-03-05' },
  ))
}

/** Flatten a forest into `[id, number]` pairs in document order. */
function idNumbers(nodes) {
  const flat = []
  const walk = (list) => {
    for (const node of list) {
      flat.push([node.id, node.number])
      walk(node.children)
    }
  }
  walk(nodes)
  return flat
}

describe('normalizeTagMode', () => {
  it('defaults to any and accepts the documented vocabulary', () => {
    expect(TAG_MODES).toEqual(['any', 'and'])
    for (const value of [undefined, null, '']) expect(normalizeTagMode(value)).toBe('any')
    expect(normalizeTagMode('any')).toBe('any')
    expect(normalizeTagMode('and')).toBe('and')
  })

  it('rejects any other value as a 400', () => {
    expectGanttError(() => normalizeTagMode('all'), 'mode must be one of any, and')
    expectGanttError(() => normalizeTagMode(7), 'mode must be one of any, and')
  })
})

describe('matchesTagFilter', () => {
  it('matches everything without a filter', () => {
    expect(matchesTagFilter([], [], 'any')).toBe(true)
    expect(matchesTagFilter(['ops'], [], 'and')).toBe(true)
  })

  it('ORs the tags in any mode and requires all of them in and mode', () => {
    expect(matchesTagFilter(['ui'], ['ui', 'ops'], 'any')).toBe(true)
    expect(matchesTagFilter(['db'], ['ui', 'ops'], 'any')).toBe(false)
    expect(matchesTagFilter(['ui', 'ops'], ['ui', 'ops'], 'and')).toBe(true)
    expect(matchesTagFilter(['ui'], ['ui', 'ops'], 'and')).toBe(false)
  })
})

describe('filterTreeByTags', () => {
  it('keeps the matching task plus its ancestor path and prunes the rest', () => {
    const filtered = filterTreeByTags(build(), ['ui'], 'any')
    expect(idNumbers(filtered)).toEqual([
      ['track', '1'],
      ['ui', '1.1'],
      ['group', '3'],
    ])
    const track = filtered[0]
    expect(track.hasChildren).toBe(true)
    expect(track.children.map(child => child.id)).toEqual(['ui'])
    expect(track.tags).toEqual(['ops'])
    const group = filtered[1]
    expect(group.hasChildren).toBe(false)
    expect(group.children).toEqual([])
  })

  it('recomputes the rollup of a retained ancestor from the surviving children', () => {
    const filtered = filterTreeByTags(build(), ['infra'], 'any')
    expect(idNumbers(filtered)).toEqual([
      ['track', '1'],
      ['ops', '1.2'],
      ['infra', '1.2.1'],
    ])
    const [track] = filtered
    const ops = track.children[0]
    expect(track).toMatchObject({
      status: 'todo',
      progress: 0,
      startDate: '2024-01-03',
      endDate: '2024-01-04',
    })
    expect(ops).toMatchObject({ status: 'todo', progress: 0, startDate: '2024-01-03', endDate: '2024-01-04' })
    expect(track.children.map(child => child.id)).toEqual(['ops'])
  })

  it('keeps a matched parent as a leaf with its full-tree rollup when its children are pruned', () => {
    const filtered = filterTreeByTags(build(), ['ui'], 'any')
    expect(filtered[1]).toMatchObject({
      id: 'group',
      status: 'done',
      progress: 100,
      startDate: '2024-03-01',
      endDate: '2024-03-05',
      hasChildren: false,
      number: '3',
    })
  })

  it('applies any and and mode and returns an empty forest when nothing matches', () => {
    expect(idNumbers(filterTreeByTags(build(), ['ui', 'ops'], 'any')).map(([id]) => id)).toEqual([
      'track', 'ui', 'ops', 'infra', 'group',
    ])
    expect(idNumbers(filterTreeByTags(build(), ['ops', 'infra'], 'and')).map(([id]) => id)).toEqual([
      'track', 'ops', 'infra',
    ])
    expect(filterTreeByTags(build(), ['nothing'], 'any')).toEqual([])
  })

  it('returns the whole forest for an empty filter', () => {
    const filtered = filterTreeByTags(build(), [], 'any')
    expect(idNumbers(filtered)).toEqual(idNumbers(build()))
  })

  it('reports an all-cancelled container as cancelled with zero progress', () => {
    const tree = buildTree(makeRows(
      { id: 'p', title: 'Parent', tags: ['ops'], startDate: '2024-01-01', endDate: '2024-01-09' },
      { id: 'c1', parentId: 'p', title: 'One', tags: ['ops'], status: 'cancelled', startDate: '2024-01-01', endDate: '2024-01-02' },
      { id: 'c2', parentId: 'p', title: 'Two', tags: ['ops'], status: 'cancelled', sortOrder: 1, startDate: '2024-01-08', endDate: '2024-01-09' },
    ))
    const [parent] = filterTreeByTags(tree, ['ops'], 'and')
    expect(parent).toMatchObject({ status: 'cancelled', progress: 0, hasChildren: true })
    expect(parent.children).toHaveLength(2)
    expect(parent.startDate).toBe('2024-01-01')
    expect(parent.endDate).toBe('2024-01-09')
  })
})
