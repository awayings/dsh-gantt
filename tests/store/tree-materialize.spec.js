import { describe, expect, it } from 'vitest'
import {
  compareDotIds,
  compareRefs,
  materializeTracker,
  normalizeTrackerState,
  parseLinks,
  parseLinksJson,
  progressForStatus,
  slotForStart,
  statusForState,
} from '../../tree.js'

const TODAY = '2026-11-15'

/** @param {Partial<import('../../tree.js').ExistingTask>} [overrides] */
function existing(overrides = {}) {
  return {
    id: 'existing',
    kind: /** @type {import('../../tree.js').TaskKind} */ ('node'),
    ref: 'node:1.1',
    state: '未开始',
    status: /** @type {import('../../tree.js').TaskStatus} */ ('todo'),
    progress: 0,
    links: [],
    parentId: null,
    source: 'tracker',
    ...overrides,
  }
}

/** @param {Partial<import('../../tree.js').SnapshotTrack>} [overrides] */
function track(overrides = {}) {
  return { id: '1', name: '投资系统', lane: '赚钱', state: '进行', blocker: '卡点', ...overrides }
}

/** @param {Partial<import('../../tree.js').SnapshotNode>} [overrides] */
function node(overrides = {}) {
  return { id: '1.1', trackId: '1', title: '节点', state: '未开始', startDate: '2026-11-09', endDate: '2026-11-15', ...overrides }
}

describe('materializeTracker inserts', () => {
  it('materialises tracks first and nodes in natural dot order', () => {
    const result = materializeTracker({ tracks: [track(), track({ id: '2', name: '生活', lane: undefined, state: undefined, blocker: undefined })], nodes: [ node({ id: '1.8.1', title: 'Child', doneWhen: 'DW', dep: '1.8' }), node({ id: '1.8', title: 'Parent', state: '进行', startDate: null, endDate: null }), node({ id: '5.2', trackId: '5', title: 'Orphan', state: '卡住', startDate: '2026-12-01', endDate: null }) ], existing: [], today: TODAY })
    expect(result.updates).toEqual([])
    expect(result.deletes).toEqual([])
    expect(result.inserts.map(draft => draft.ref)).toEqual(['track:1', 'track:2', 'node:1.8', 'node:1.8.1', 'node:5.2'])

    const [investment, life, parent, child, orphan] = result.inserts
    expect(investment).toMatchObject({ kind: 'track', title: '投资系统', description: '卡点', lane: '赚钱', state: '进行', status: 'in_progress', progress: 50, source: 'tracker', parentRef: null, sortOrder: 0, startDate: '2026-11-09', endDate: '2026-11-15' })
    expect(life).toMatchObject({ lane: '', state: '', description: '', status: 'todo', sortOrder: 1, startDate: TODAY, endDate: TODAY })
    expect(parent).toMatchObject({ parentRef: 'track:1', lane: '赚钱', state: '进行', status: 'in_progress', progress: 50, sortOrder: 0, startDate: TODAY, endDate: TODAY })
    expect(child).toMatchObject({ parentRef: 'node:1.8', lane: '赚钱', sortOrder: 1, description: 'DW', doneWhen: 'DW', dep: '1.8', state: '未开始', status: 'todo', progress: 0, startDate: '2026-11-09', endDate: '2026-11-15' })
    expect(orphan).toMatchObject({ parentRef: null, lane: '', state: '卡住', status: 'blocked', progress: 0, startDate: '2026-12-01', endDate: '2026-12-01' })
  })

  it('degrades non-string snapshot fields and defaults a missing sort order to the input index', () => {
    const result = materializeTracker({ tracks: [{ id: '1', name: 'Branch', lane: 7, state: null, blocker: 9, sortOrder: undefined }], nodes: [{ id: '1.1', title: 'Node', trackId: 7, state: undefined, dep: 7, doneWhen: 7, startDate: '2026-11-16', endDate: null }], existing: [], today: TODAY })
    expect(result.inserts[0]).toMatchObject({ ref: 'track:1', lane: '', state: '', description: '', sortOrder: 0 })
    expect(result.inserts[1]).toMatchObject({ ref: 'node:1.1', lane: '', dep: '', doneWhen: '', description: '', startDate: '2026-11-16', endDate: '2026-11-16' })
  })
})

describe('materializeTracker user state rules', () => {
  it('keeps a user-set status, progress, and links while the tracker state is unchanged', () => {
    const previous = existing({ id: 'stable', status: 'done', progress: 100, links: [{ type: 'memory', ref: 'key/x' }] })
    const trackRow = existing({ id: 'track-row', kind: 'track', ref: 'track:1', state: '进行', status: 'in_progress', progress: 50 })
    const result = materializeTracker({ tracks: [track()], nodes: [node({ title: 'Renamed' })], existing: [previous, trackRow], today: TODAY })
    expect(result.inserts).toEqual([])
    expect(result.deletes).toEqual([])
    expect(result.updates).toHaveLength(2)
    expect(result.updates.find(draft => draft.id === 'stable')).toMatchObject({ title: 'Renamed', state: '未开始', status: 'done', progress: 100, links: [{ type: 'memory', ref: 'key/x' }] })
  })

  it('replaces progress and status when the raw tracker state changed', () => {
    const previous = existing({ id: 'stable', state: '未开始', status: 'done', progress: 100, links: [{ type: 'file', ref: 'a.md' }] })
    const result = materializeTracker({ tracks: [track()], nodes: [node({ state: '进行' })], existing: [previous], today: TODAY })
    expect(result.updates.find(draft => draft.id === 'stable')).toMatchObject({ state: '进行', status: 'in_progress', progress: 50, links: [{ type: 'file', ref: 'a.md' }] })
  })

  it('keeps a normalized alias equal to the stored state from counting as a change', () => {
    const previous = existing({ id: 'stable', state: '进行', status: 'blocked', progress: 30 })
    const result = materializeTracker({ tracks: [track()], nodes: [node({ state: '进行中' })], existing: [previous], today: TODAY })
    expect(result.updates.find(draft => draft.id === 'stable')).toMatchObject({ state: '进行', status: 'blocked', progress: 30 })
  })
})

describe('materializeTracker expired rows', () => {
  it('deletes an imported row only when nothing still hangs below it', () => {
    const manualChild = existing({ id: 'manual-child', kind: 'task', ref: '', parentId: 'n91', source: 'manual' })
    const kept = materializeTracker({ tracks: [], nodes: [], existing: [ existing({ id: 't9', kind: 'track', ref: 'track:9' }), existing({ id: 'n91', ref: 'node:9.1', parentId: 't9' }), manualChild, existing({ id: 'manual-root', kind: 'task', ref: '', parentId: null, source: 'manual' }) ], today: TODAY })
    expect(kept.deletes).toEqual([])

    const removed = materializeTracker({ tracks: [], nodes: [], existing: [ existing({ id: 't9', kind: 'track', ref: 'track:9' }), manualChild, existing({ id: 'manual-root', kind: 'task', ref: '', parentId: null, source: 'manual' }) ], today: TODAY })
    expect(removed.deletes).toEqual(['t9'])
  })
})

describe('tracker state vocabulary', () => {
  it('normalises aliases and keeps unknown words verbatim', () => {
    expect(normalizeTrackerState('已过')).toBe('已过')
    expect(normalizeTrackerState('已完成')).toBe('已过')
    expect(normalizeTrackerState('完成')).toBe('已过')
    expect(normalizeTrackerState('撤销')).toBe('撤销')
    expect(normalizeTrackerState('进行')).toBe('进行')
    expect(normalizeTrackerState('进行中')).toBe('进行')
    expect(normalizeTrackerState('在做')).toBe('进行')
    expect(normalizeTrackerState('卡住')).toBe('卡住')
    expect(normalizeTrackerState('未开始')).toBe('未开始')
    expect(normalizeTrackerState('已立项')).toBe('未开始')
    expect(normalizeTrackerState('待定')).toBe('未开始')
    expect(normalizeTrackerState('没开始')).toBe('未开始')
    expect(normalizeTrackerState('未知')).toBe('未开始')
    expect(normalizeTrackerState(' 进行中 ')).toBe('进行')
    expect(normalizeTrackerState('自定义')).toBe('自定义')
    expect(normalizeTrackerState(7)).toBe('')
    expect(normalizeTrackerState(undefined)).toBe('')
  })

  it('maps every state form to a status and a progress value', () => {
    expect(statusForState('已过')).toBe('done')
    expect(statusForState('已完成')).toBe('done')
    expect(statusForState('撤销')).toBe('done')
    expect(statusForState('进行')).toBe('in_progress')
    expect(statusForState('进行中')).toBe('in_progress')
    expect(statusForState('卡住')).toBe('blocked')
    expect(statusForState('未开始')).toBe('todo')
    expect(statusForState('已立项')).toBe('todo')
    expect(statusForState('unknown-word')).toBe('todo')
    expect(progressForStatus('done')).toBe(100)
    expect(progressForStatus('in_progress')).toBe(50)
    expect(progressForStatus('blocked')).toBe(0)
    expect(progressForStatus('todo')).toBe(0)
  })
})

describe('dotted ids and refs', () => {
  it('compares dotted ids segment by segment as numbers', () => {
    expect(compareDotIds('1.10', '1.9')).toBeGreaterThan(0)
    expect(compareDotIds('1.8.4', '1.9.3')).toBeLessThan(0)
    expect(compareDotIds('1.8.1', '1.8.2')).toBeLessThan(0)
    expect(compareDotIds('1.8', '1.8.0')).toBe(0)
    expect(compareDotIds('2.1', '2.1')).toBe(0)
  })

  it('orders refs by dotted id and puts manual tasks (empty ref) last', () => {
    const refs = ['node:1.10', '', 'node:1.9', 'track:1', 'node:1.9.1']
    expect(refs.slice().sort(compareRefs)).toEqual(['track:1', 'node:1.9', 'node:1.9.1', 'node:1.10', ''])
    expect(compareRefs('', '')).toBe(0)
    expect(compareRefs('', 'node:1.1')).toBe(1)
    expect(compareRefs('node:1.1', '')).toBe(-1)
  })

  it('derives a plan slot from the start clock time', () => {
    expect(slotForStart('')).toBe('other')
    expect(slotForStart(undefined)).toBe('other')
    expect(slotForStart('09:59')).toBe('morning')
    expect(slotForStart('10:00')).toBe('daytime')
    expect(slotForStart('19:29')).toBe('daytime')
    expect(slotForStart('19:30')).toBe('evening')
  })
})

describe('link parsing', () => {
  it('degrades a stored links column to an empty array when it is not valid', () => {
    expect(parseLinksJson(undefined)).toEqual([])
    expect(parseLinksJson('')).toEqual([])
    expect(parseLinksJson('[]')).toEqual([])
    expect(parseLinksJson('{')).toEqual([])
    expect(parseLinksJson('"text"')).toEqual([])
    expect(parseLinksJson('[{"type":"memory","ref":"key/x"}]')).toEqual([{ type: 'memory', ref: 'key/x' }])
    expect(parseLinksJson('[{"type":"nope","ref":"x"}]')).toEqual([])
  })

  it('normalises valid links', () => {
    expect(parseLinks(undefined)).toEqual({ links: [], error: null })
    expect(parseLinks(null)).toEqual({ links: [], error: null })
    expect(parseLinks([{ type: 'memory', ref: ' key/x ', label: ' 系统记忆 ' }, { type: 'url', ref: 'https://x', label: '' }]))
      .toEqual({ links: [{ type: 'memory', ref: 'key/x', label: '系统记忆' }, { type: 'url', ref: 'https://x' }], error: null })
    expect(parseLinks(Array.from({ length: 20 }, (unused, index) => ({ type: 'note', ref: `n${index}` }))).error).toBeNull()
  })

  it('rejects every malformed link shape', () => {
    expect(parseLinks('nope').error).toBe('links must be an array')
    expect(parseLinks(Array.from({ length: 21 }, () => ({ type: 'note', ref: 'n' }))).error).toBe('links must have at most 20 entries')
    expect(parseLinks([null]).error).toBe('links[0] must be an object')
    expect(parseLinks([5]).error).toBe('links[0] must be an object')
    expect(parseLinks([['x']]).error).toBe('links[0] must be an object')
    expect(parseLinks([{ type: 'nope', ref: 'x' }]).error).toBe('links[0].type must be one of memory, file, url, task, note')
    expect(parseLinks([{ type: 'memory' }]).error).toBe('links[0].ref must be a string')
    expect(parseLinks([{ type: 'memory', ref: '  ' }]).error).toBe('links[0].ref is required')
    expect(parseLinks([{ type: 'memory', ref: 'x'.repeat(501) }]).error).toBe('links[0].ref must be at most 500 characters')
    expect(parseLinks([{ type: 'memory', ref: 'x', label: 7 }]).error).toBe('links[0].label must be a string')
    expect(parseLinks([{ type: 'memory', ref: 'x', label: 'y'.repeat(121) }]).error).toBe('links[0].label must be at most 120 characters')
  })
})
