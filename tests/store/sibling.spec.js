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

describe('createSibling', () => {
  it('inserts the new task immediately after the reference and shifts later siblings', () => {
    const parent = store.create({ title: 'Parent' })
    const first = store.create({ title: 'First', parentId: parent.id })
    const second = store.create({ title: 'Second', parentId: parent.id })
    const third = store.create({ title: 'Third', parentId: parent.id })
    const sibling = store.createSibling(first.id, { title: 'Inserted' })
    const numbers = store.getNode(parent.id)?.children.map(child => child.number)
    expect(numbers).toEqual(['1.1', '1.2', '1.3', '1.4'])
    expect(store.getNode(parent.id)?.children.map(child => child.title)).toEqual(['First', 'Inserted', 'Second', 'Third'])
    expect(sibling.number).toBe('1.2')
    expect(store.getNode(second.id)?.number).toBe('1.3')
    expect(store.getNode(third.id)?.number).toBe('1.4')
  })

  it('inserts a top-level sibling after a root reference', () => {
    const first = store.create({ title: 'Root one' })
    const second = store.create({ title: 'Root two' })
    const created = store.createSibling(first.id, { title: 'Root inserted' })
    expect(store.tree().map(node => node.title)).toEqual(['Root one', 'Root inserted', 'Root two'])
    expect(created.number).toBe('2')
    expect(store.getNode(second.id)?.number).toBe('3')
    expect(created.parentId).toBeNull()
  })

  it('defaults dates, status, progress, kind, ref, and source', () => {
    const reference = store.create({ title: 'Reference' })
    const created = store.createSibling(reference.id, { title: 'Next' })
    expect(created.startDate).toBe(todayIso())
    expect(created.endDate).toBe(addDays(todayIso(), 3))
    expect(created.status).toBe('todo')
    expect(created.progress).toBe(0)
    expect(created.kind).toBe('task')
    expect(created.ref).toBe('')
    expect(created.source).toBe('manual')
    expect(created.doneWhen).toBe('')
  })

  it('defaults dates to the later of today and the shared parent\'s start', () => {
    const today = todayIso()
    const parent = store.create({ title: 'Future parent', startDate: addDays(today, 5), endDate: addDays(today, 30) })
    const first = store.create({ title: 'First', parentId: parent.id, startDate: addDays(today, 5), endDate: addDays(today, 6) })
    const created = store.createSibling(first.id, { title: 'Next' })
    expect(created.startDate).toBe(addDays(today, 5))
    expect(created.endDate).toBe(addDays(today, 8))
    const root = store.create({ title: 'Root' })
    expect(store.createSibling(root.id, { title: 'Root next' }).startDate).toBe(today)
  })

  it('reuses the create validation for fields, extras, and links', () => {
    const reference = store.create({ title: 'Reference', kind: 'track', ref: 'T1' })
    const created = store.createSibling(reference.id, {
      title: '  Detailed   sibling  ',
      description: ' notes ',
      status: 'in_progress',
      progress: 40,
      startDate: '2024-02-01',
      endDate: '2024-02-05',
      doneWhen: 'Proof ready',
      lane: '赚钱',
      estimate: '2h',
      links: [{ type: 'file', ref: 'docs/api.md' }],
    })
    expect(created).toMatchObject({
      title: 'Detailed sibling',
      description: 'notes',
      status: 'in_progress',
      progress: 40,
      startDate: '2024-02-01',
      endDate: '2024-02-05',
      doneWhen: 'Proof ready',
      lane: '赚钱',
      estimate: '2h',
    })
    expect(created.links).toEqual([{ type: 'file', ref: 'docs/api.md' }])
  })

  it('recomputes the parent rollup with the new sibling dates and progress', () => {
    const parent = store.create({ title: 'Parent', startDate: '2024-03-01', endDate: '2024-03-10' })
    store.create({ title: 'Early', parentId: parent.id, startDate: '2024-03-01', endDate: '2024-03-02', status: 'done' })
    store.createSibling(/** @type {string} */ (store.getNode(parent.id)?.children[0].id), {
      title: 'Late',
      startDate: '2024-03-08',
      endDate: '2024-03-20',
      status: 'in_progress',
      progress: 50,
    })
    const rolled = store.getNode(parent.id)
    expect(rolled?.startDate).toBe('2024-03-01')
    expect(rolled?.endDate).toBe('2024-03-20')
    expect(rolled?.progress).toBe(75)
    expect(rolled?.status).toBe('in_progress')
  })

  it('validates the reference and the new task fields', () => {
    const reference = store.create({ title: 'Reference' })
    expectGanttError(() => store.createSibling('', { title: 'X' }), 'id is required', 400)
    expectGanttError(() => store.createSibling('missing', { title: 'X' }), 'task missing was not found', 404)
    expectGanttError(() => store.createSibling(reference.id, {}), 'title is required', 400)
    expectGanttError(() => store.createSibling(reference.id, { title: 'X', startDate: 'nope' }), 'startDate must be a YYYY-MM-DD date', 400)
    expectGanttError(() => store.createSibling(reference.id, { title: 'X', startDate: '2024-02-02', endDate: '2024-02-01' }), 'endDate must not be before startDate', 400)
    expectGanttError(() => store.createSibling(reference.id, { title: 'X', status: 'odd' }), 'status must be one of todo, in_progress, blocked, done, cancelled', 400)
    expectGanttError(() => store.createSibling(reference.id, { title: 'X', progress: 'half' }), 'progress must be a number from 0 to 100', 400)
    expectGanttError(() => store.createSibling(reference.id, { title: 'X', links: 'nope' }), 'links must be an array', 400)
  })

  it('records a create event and a track event on the reference for one origin', () => {
    const track = store.create({ title: 'Content', kind: 'track', ref: 'T1' })
    const reference = store.create({ title: 'Focused task', parentId: track.id })
    const created = store.createSibling(reference.id, { title: 'Follow-up' }, { sessionId: 'session-a', turn: 4, summary: 'open a follow-up' })
    expect(store.trajectory({ taskId: created.id })[0]).toMatchObject({
      action: 'create',
      sessionId: 'session-a',
      turn: 4,
      detail: 'open a follow-up',
    })
    const [tracked] = store.trajectory({ taskId: reference.id })
    expect(tracked).toMatchObject({ action: 'track', sessionId: 'session-a', turn: 4, detail: 'sibling task 1.1 Follow-up' })
  })

  it('falls back to a generated create detail and the reference ref label', () => {
    const reference = store.create({ title: 'Focused task', kind: 'track', ref: 'T1' })
    const created = store.createSibling(reference.id, { title: 'Follow-up' }, { sessionId: 'session-a', turn: 5 })
    expect(store.trajectory({ taskId: created.id })[0]).toMatchObject({ action: 'create', detail: '在 T1 后创建' })
    expect(store.trajectory({ taskId: reference.id })[0]).toMatchObject({ action: 'track', detail: 'sibling task T1 Follow-up' })
  })

  it('skips every event without a usable origin', () => {
    const reference = store.create({ title: 'Reference' })
    const created = store.createSibling(reference.id, { title: 'No origin' })
    expect(store.trajectory({ taskId: created.id })).toEqual([])
    expect(store.trajectory({ taskId: reference.id })).toEqual([])
    const blank = store.createSibling(reference.id, { title: 'Blank origin' }, { sessionId: '   ', turn: 1 })
    expect(store.trajectory({ taskId: blank.id })).toEqual([])
    expect(store.trajectory({ taskId: reference.id })).toEqual([])
  })
})
