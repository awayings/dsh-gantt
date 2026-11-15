import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore } from '../../store.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** Seed three tracks: A has a pending frontier, B has a cross-track dependency, C is done. */
function seed() {
  store.replacePlan({
    tracks: [
      { id: '1', name: '投资系统', lane: '赚钱', state: '进行', blocker: '卡点' },
      { id: '2', name: '打工', lane: '赚钱', state: '卡住' },
      { id: '3', name: '元能力', lane: '赚钱', state: '进行' },
    ],
    nodes: [
      { id: '1.1', trackId: '1', title: 'Done leaf', state: '已过' },
      { id: '1.2', trackId: '1', title: 'Todo leaf', state: '未开始' },
      { id: '1.3', trackId: '1', title: 'Dependent leaf', state: '未开始', dep: '1.2' },
      { id: '1.4', trackId: '1', title: 'Blocked leaf', state: '卡住' },
      { id: '1.5', trackId: '1', title: 'Missing dependency', state: '未开始', dep: '9.9' },
      { id: '2.1', trackId: '2', title: 'Work leaf', state: '未开始' },
      { id: '2.2', trackId: '2', title: 'Cross-track leaf', state: '未开始', dep: '1.1' },
      { id: '3.1', trackId: '3', title: 'Finished track leaf', state: '已过' },
    ],
  })
}

/** @param {string} ref @returns {import('../../store.js').TaskNode} */
function nodeByRef(ref) {
  const flat = []
  const walk = (node) => {
    flat.push(node)
    node.children.forEach(walk)
  }
  store.tree().forEach(walk)
  const found = flat.find(node => node.ref === ref)
  if (!found) throw new Error(`missing ${ref}`)
  return found
}

describe('computeBrief', () => {
  it('counts pending leaves and reports one frontier and next per track', () => {
    seed()
    const brief = store.snapshot().brief
    expect(brief.pending).toBe(6)
    expect(brief.frontier.map(entry => entry.ref)).toEqual(['node:1.5', 'node:2.2'])
    expect(brief.next.map(entry => entry.ref)).toEqual(['node:1.2', 'node:2.1'])
    expect(brief.lanes).toHaveLength(3)
    const investment = brief.lanes[0]
    expect(investment).toMatchObject({ ref: 'track:1', name: '投资系统', lane: '赚钱', state: '进行', blocker: '卡点' })
    expect(investment.frontier).toEqual({
      id: nodeByRef('node:1.5').id,
      ref: 'node:1.5',
      number: '1.5',
      title: 'Missing dependency',
      trackId: nodeByRef('track:1').id,
      trackName: '投资系统',
    })
    expect(brief.lanes[1].next?.ref).toBe('node:2.1')
    expect(brief.lanes[2]).toMatchObject({ ref: 'track:3', frontier: null, next: null })
    expect(brief.lanes[2].state).toBe('进行')
  })

  it('moves next past a dependency once that node is done', () => {
    seed()
    store.setStatus(nodeByRef('node:1.2').id, 'done')
    const brief = store.snapshot().brief
    expect(brief.frontier.map(entry => entry.ref)).not.toContain('node:1.2')
    expect(brief.next.map(entry => entry.ref)).toEqual(['node:1.3', 'node:2.1'])
    expect(brief.pending).toBe(5)
  })

  it('sorts manual tasks last and counts manual roots as pending leaves', () => {
    seed()
    const track = nodeByRef('track:1')
    store.create({ title: 'Manual child', parentId: track.id, status: 'todo' })
    store.create({ title: 'Manual root', status: 'todo' })
    const brief = store.snapshot().brief
    expect(brief.frontier[0].ref).toBe('')
    expect(brief.frontier[0].title).toBe('Manual child')
    expect(brief.frontier[0].number).toBe('1.6')
    expect(brief.pending).toBe(8)
    expect(brief.lanes).toHaveLength(3)
  })

  it('returns an empty brief for a tree without tracks', () => {
    store.create({ title: 'Manual only', status: 'blocked' })
    expect(store.snapshot().brief).toEqual({ pending: 1, frontier: [], next: [], lanes: [] })
  })
})
