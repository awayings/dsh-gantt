import { describe, expect, it } from 'vitest'
import { buildTree, summarize } from '../../store.js'
import { makeRows } from '../helpers/gantt.js'

describe('summarize', () => {
  it('reports an empty snapshot', () => {
    expect(summarize([])).toEqual({
      total: 0,
      done: 0,
      inProgress: 0,
      blocked: 0,
      overdue: 0,
      progress: 0,
    })
  })

  it('counts every node of a nested tree by status and overdue state', () => {
    const tree = buildTree(makeRows(
      { id: 'root', title: 'Root', sortOrder: 0, status: 'in_progress', progress: 25, endDate: '2999-12-31' },
      { id: 'done', parentId: 'root', title: 'Done', sortOrder: 0, status: 'done', progress: 100, endDate: '2000-01-01' },
      { id: 'busy', parentId: 'root', title: 'Busy', sortOrder: 1, status: 'in_progress', progress: 50, endDate: '2999-12-31' },
      { id: 'blocked', parentId: 'root', title: 'Blocked', sortOrder: 2, status: 'blocked', progress: 0, endDate: '2000-01-01' },
      { id: 'late', parentId: 'root', title: 'Late', sortOrder: 3, status: 'todo', progress: 0, endDate: '2000-01-01' },
      { id: 'future', parentId: 'root', title: 'Future', sortOrder: 4, status: 'todo', progress: 0, endDate: '2999-12-31' },
    ))
    expect(summarize(tree)).toEqual({
      total: 6,
      done: 1,
      inProgress: 1,
      blocked: 2,
      overdue: 2,
      progress: 17,
    })
  })

  it('rounds the done ratio to whole percent', () => {
    const tree = buildTree(makeRows(
      { id: 'a', title: 'A', sortOrder: 0, status: 'done', progress: 100, endDate: '2999-01-01' },
      { id: 'b', title: 'B', sortOrder: 1, status: 'todo', progress: 0, endDate: '2999-01-01' },
      { id: 'c', title: 'C', sortOrder: 2, status: 'todo', progress: 0, endDate: '2999-01-01' },
    ))
    expect(summarize(tree).progress).toBe(33)
  })

  it('counts a parent row itself, using the rolled-up status', () => {
    const tree = buildTree(makeRows(
      { id: 'root', title: 'Root', sortOrder: 0, status: 'todo', progress: 0, endDate: '2999-01-01' },
      { id: 'done', parentId: 'root', title: 'Done', sortOrder: 0, status: 'done', progress: 100, endDate: '2999-01-01' },
      { id: 'todo', parentId: 'root', title: 'Todo', sortOrder: 1, status: 'todo', progress: 0, endDate: '2999-01-01' },
    ))
    const stats = summarize(tree)
    expect(stats.total).toBe(3)
    expect(stats.done).toBe(1)
    expect(stats.inProgress).toBe(1)
  })
})
