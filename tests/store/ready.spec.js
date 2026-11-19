import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore } from '../../src/host/store.js'
import { READY_TAGS, collectReadyTasks } from '../../src/host/tree/ready.js'
import { expectGanttError } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** Two tracks: one with a met dependency, a missing dependency, and a blocked leaf. */
function makeTree() {
  const first = store.create({ title: '投资系统', kind: 'track', ref: 'track:1' })
  store.create({ title: 'Done leaf', parentId: first.id, kind: 'node', ref: 'node:1.1', status: 'done' })
  store.create({ title: 'Ready leaf', parentId: first.id, kind: 'node', ref: 'node:1.2', dep: '1.1', tags: ['ops'] })
  store.create({ title: 'Missing dep', parentId: first.id, kind: 'node', ref: 'node:1.3', dep: '9.9', tags: ['ops', 'db'] })
  store.create({ title: 'Blocked leaf', parentId: first.id, kind: 'node', ref: 'node:1.4', status: 'blocked' })
  store.create({ title: 'Running leaf', parentId: first.id, kind: 'node', ref: 'node:1.5', status: 'in_progress' })
  const second = store.create({ title: '元能力', kind: 'track', ref: 'track:2' })
  store.create({ title: 'Second leaf', parentId: second.id, kind: 'node', ref: 'node:2.1', tags: ['db'] })
  return store.tree()
}

describe('collectReadyTasks', () => {
  it('lists every pending leaf for todo in track and document order', () => {
    const tree = makeTree()
    expect(collectReadyTasks(tree, 'todo').map(entry => entry.task.ref)).toEqual([
      'node:1.2', 'node:1.3', 'node:1.4', 'node:2.1',
    ])
    expect(collectReadyTasks(tree, 'todo').map(entry => [entry.trackId, entry.trackName])).toEqual([
      [tree[0].id, '投资系统'],
      [tree[0].id, '投资系统'],
      [tree[0].id, '投资系统'],
      [tree[1].id, '元能力'],
    ])
  })

  it('keeps only leaves whose dependency is done for ready', () => {
    const tree = makeTree()
    expect(collectReadyTasks(tree, 'ready').map(entry => entry.task.ref)).toEqual([
      'node:1.2', 'node:1.4', 'node:2.1',
    ])
  })

  it('maps the brief next picks back to their nodes and tracks', () => {
    const tree = makeTree()
    expect(collectReadyTasks(tree, 'next').map(entry => [entry.task.ref, entry.trackName])).toEqual([
      ['node:1.2', '投资系统'],
      ['node:2.1', '元能力'],
    ])
  })

  it('rejects an unknown tag and returns an empty list for an empty tree', () => {
    expect(READY_TAGS).toEqual(['ready', 'next', 'todo'])
    expect(collectReadyTasks([], 'ready')).toEqual([])
    expectGanttError(
      () => collectReadyTasks([], /** @type {any} */ ('later')),
      'tag must be one of ready, next, todo',
    )
  })
})

describe('GanttStore.readyTasks', () => {
  it('defaults to ready and returns compact rows with the owning track', () => {
    makeTree()
    const result = store.readyTasks()
    expect(result.tag).toBe('ready')
    expect(result.tasks.map(task => task.ref)).toEqual(['node:1.2', 'node:1.4', 'node:2.1'])
    expect(result.tasks[0]).toEqual({
      id: expect.any(String),
      number: '1.2',
      ref: 'node:1.2',
      title: 'Ready leaf',
      status: 'todo',
      description: '',
      doneWhen: '',
      tags: ['ops'],
      trackId: expect.any(String),
      trackName: '投资系统',
    })
  })

  it('honors next, todo, and the limit', () => {
    makeTree()
    expect(store.readyTasks({ tag: 'next' }).tasks.map(task => task.ref)).toEqual(['node:1.2', 'node:2.1'])
    expect(store.readyTasks({ tag: 'todo' }).tasks.map(task => task.ref)).toEqual([
      'node:1.2', 'node:1.3', 'node:1.4', 'node:2.1',
    ])
    expect(store.readyTasks({ tag: 'ready', limit: 2 }).tasks.map(task => task.ref)).toEqual(['node:1.2', 'node:1.4'])
    expect(store.readyTasks({ tag: null, limit: null })).toEqual({ tag: 'ready', tasks: expect.any(Array) })
  })

  it('filters the ready list by manual tags in any and and mode', () => {
    makeTree()
    expect(store.readyTasks({ tags: ['ops'] }).tasks.map(task => task.ref)).toEqual(['node:1.2'])
    expect(store.readyTasks({ tags: ['ops'], tag: 'todo' }).tasks.map(task => task.ref)).toEqual(['node:1.2', 'node:1.3'])
    expect(store.readyTasks({ tags: ['ops'], mode: 'any', tag: 'todo' }).tasks.map(task => task.ref)).toEqual(['node:1.2', 'node:1.3'])
    expect(store.readyTasks({ tags: ['ops'], mode: 'and', tag: 'todo' }).tasks.map(task => task.ref)).toEqual(['node:1.2', 'node:1.3'])
    expect(store.readyTasks({ tags: ['ops', 'db'], mode: 'and', tag: 'todo' }).tasks.map(task => task.ref)).toEqual(['node:1.3'])
    expect(store.readyTasks({ tags: ['db'], tag: 'todo' }).tasks.map(task => task.ref)).toEqual(['node:1.3', 'node:2.1'])
    expect(store.readyTasks({ tags: [] }).tasks).toHaveLength(3)
    expect(store.readyTasks({ tags: ['db'], tag: 'todo', limit: 1 }).tasks.map(task => task.ref)).toEqual(['node:1.3'])
  })

  it('validates the tag, the limit, the tag list, and the mode', () => {
    makeTree()
    expectGanttError(() => store.readyTasks({ tag: 'later' }), 'tag must be one of ready, next, todo')
    expectGanttError(() => store.readyTasks({ limit: 0 }), 'limit must be an integer from 1 to 100')
    expectGanttError(() => store.readyTasks({ limit: 101 }), 'limit must be an integer from 1 to 100')
    expectGanttError(() => store.readyTasks({ tags: 'ops' }), 'tags must be an array')
    expectGanttError(() => store.readyTasks({ tags: [''] }), 'tags[0] must not be empty')
    expectGanttError(
      () => store.readyTasks({ tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`) }),
      'tags must have at most 20 entries',
    )
    expectGanttError(() => store.readyTasks({ mode: 'all' }), 'mode must be one of any, and')
  })
})
