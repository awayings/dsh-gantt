import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore } from '../../src/host/store.js'
import { expectGanttError } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** Every writable tracker metadata field with a distinct value. */
const extras = {
  lane: '赚钱',
  dep: '1.8.1',
  doneWhen: 'a readable number',
  landing: 'invest/board.md',
  estimate: '2h',
  category: 'A 主攻片',
  inspiration: '#21',
}

describe('create with tracker metadata', () => {
  it('stores every writable field and the parsed links', () => {
    const task = store.create({ title: 'Rich task', ...extras, links: [{ type: 'memory', ref: 'key/x', label: 'memory' }, { type: 'url', ref: 'https://example.com' }] })
    expect(task).toMatchObject({ kind: 'task', ref: '', state: '', source: 'manual', ...extras, links: [{ type: 'memory', ref: 'key/x', label: 'memory' }, { type: 'url', ref: 'https://example.com' }] })
    expect(store.getRow(task.id)).toMatchObject({ ...extras, links: [{ type: 'memory', ref: 'key/x', label: 'memory' }, { type: 'url', ref: 'https://example.com' }] })
  })

  it('accepts an explicit kind and ref and rejects a duplicate pair with 409', () => {
    const track = store.create({ title: 'Imported track', kind: 'track', ref: 'track:7' })
    expect(track).toMatchObject({ kind: 'track', ref: 'track:7' })
    const node = store.create({ title: 'Imported node', kind: 'node', ref: 'node:7.1', parentId: track.id })
    expect(node).toMatchObject({ kind: 'node', ref: 'node:7.1' })
    expectGanttError(
      () => store.create({ title: 'Duplicate ref', kind: 'node', ref: 'node:7.1' }),
      'task with kind node and ref node:7.1 already exists',
      409,
    )
    expect(store.create({ title: 'Manual one', ref: '' }).ref).toBe('')
    expect(store.create({ title: 'Manual two', ref: '' }).ref).toBe('')
    expect(store.create({ title: 'Tracker alias', ref: 'manual:1' }).ref).toBe('manual:1')
    expect(store.create({ title: 'Same ref, other kind', kind: 'track', ref: 'manual:1' }).kind).toBe('track')
  })

  it('validates kind, ref, every text field, and links', () => {
    expectGanttError(() => store.create({ title: 't', kind: 'epic' }), 'kind must be one of track, node, task')
    expectGanttError(() => store.create({ title: 't', ref: 7 }), 'ref must be a string')
    expectGanttError(() => store.create({ title: 't', lane: 7 }), 'lane must be a string')
    expectGanttError(() => store.create({ title: 't', landing: 7 }), 'landing must be a string')
    expectGanttError(() => store.create({ title: 't', links: 'nope' }), 'links must be an array')
    expectGanttError(
      () => store.create({ title: 't', links: [{ type: 'nope', ref: 'x' }] }),
      'links[0].type must be one of memory, file, url, task, note',
    )
    expect(store.create({ title: 'Nullable ref', ref: null }).ref).toBe('')
    expect(store.create({ title: 'Padded', lane: '  赚钱  ' }).lane).toBe('赚钱')
    expect(store.count()).toBe(2)
  })
})

describe('update with tracker metadata', () => {
  it('updates every writable field and leaves kind and ref untouched', () => {
    const task = store.create({ title: 'Task', kind: 'node', ref: 'node:9.9' })
    const updated = store.update(task.id, {
      ...extras,
      links: [{ type: 'file', ref: 'notes.md' }],
      kind: 'track',
      ref: 'track:99',
    })
    expect(updated).toMatchObject({ kind: 'node', ref: 'node:9.9', source: 'manual', ...extras, links: [{ type: 'file', ref: 'notes.md' }] })
    expect(store.getRow(task.id)).toMatchObject(extras)
  })

  it('rejects non-string metadata and malformed links without writing', () => {
    const task = store.create({ title: 'Task', lane: '赚钱' })
    expectGanttError(() => store.update(task.id, { lane: 7 }), 'lane must be a string')
    expectGanttError(() => store.update(task.id, { doneWhen: 7 }), 'doneWhen must be a string')
    expectGanttError(() => store.update(task.id, { links: 'nope' }), 'links must be an array')
    expectGanttError(() => store.update(task.id, { links: [null] }), 'links[0] must be an object')
    expect(store.getRow(task.id).lane).toBe('赚钱')
  })
})

describe('split with tracker metadata', () => {
  it('passes metadata and links to the created children', () => {
    const parent = store.create({ title: 'Parent', startDate: '2024-01-01', endDate: '2024-01-31' })
    const result = store.split(parent.id, [
      { title: 'Child', ...extras, tags: ['split', 'child'], links: [{ type: 'note', ref: 'n1' }] },
    ])
    expect(result.children[0]).toMatchObject({ ...extras, tags: ['split', 'child'], links: [{ type: 'note', ref: 'n1' }], kind: 'task' })
  })

  it('validates child metadata and links before writing', () => {
    const parent = store.create({ title: 'Parent' })
    expectGanttError(() => store.split(parent.id, [{ title: 'c', lane: 7 }]), 'lane must be a string')
    expectGanttError(() => store.split(parent.id, [{ title: 'c', links: 'nope' }]), 'links must be an array')
    expectGanttError(() => store.split(parent.id, [{ title: 'c', tags: 'nope' }]), 'tags must be an array')
    expect(store.count()).toBe(1)
  })
})
