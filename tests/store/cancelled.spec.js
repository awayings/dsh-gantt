import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore } from '../../src/host/store.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

describe('cancelled tasks', () => {
  it('keeps the parent open only for its active children', () => {
    const parent = store.create({ title: 'Parent' })
    const done = store.create({ parentId: parent.id, title: 'Done', status: 'done' })
    store.create({ parentId: parent.id, title: 'Dropped', status: 'cancelled' })

    expect(store.getRow(parent.id)).toMatchObject({ status: 'done', progress: 100 })

    store.update(done.id, { status: 'todo', progress: 0 })
    expect(store.getRow(parent.id)).toMatchObject({ status: 'todo', progress: 0 })

    store.update(parent.id, { status: 'cancelled' })
    expect(store.getRow(parent.id)?.status).toBe('cancelled')
  })

  it('reports a parent of nothing but cancelled children as cancelled', () => {
    const parent = store.create({ title: 'Parent' })
    const one = store.create({ parentId: parent.id, title: 'One' })
    const two = store.create({ parentId: parent.id, title: 'Two' })
    store.update(one.id, { status: 'cancelled' })
    store.update(two.id, { status: 'cancelled' })

    expect(store.getRow(parent.id)).toMatchObject({ status: 'cancelled', progress: 0 })
    expect(store.tree()[0].status).toBe('cancelled')
  })

  it('accepts cancelled on every write path and keeps its progress', () => {
    const sibling = store.create({ title: 'Reference' })
    const created = store.createSibling(sibling.id, { title: 'Sibling', status: 'cancelled' })
    expect(created.status).toBe('cancelled')
    expect(store.update(created.id, { status: 'cancelled', progress: 40 })?.progress).toBe(40)
    expect(store.setStatus(created.id, 'cancelled', 70)?.progress).toBe(70)
    expect(store.decompose(created.id, [{ title: 'Child', status: 'cancelled', doneWhen: 'dropped' }]).children[0].status).toBe('cancelled')
  })
})
