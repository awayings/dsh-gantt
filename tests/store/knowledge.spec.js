import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { GanttStore, SCHEMA_VERSION } from '../../src/host/store.js'
import { KNOWLEDGE_KINDS, MAX_QUERY_LIMIT, queryKnowledge, saveKnowledge } from '../../src/host/store/knowledge.js'
import { expectGanttError, makeTempDir, removeTempDir } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** Save one entry through the facade under test. */
function save(input, origin) {
  return saveKnowledge(store, input, origin)
}

/** Seed one track (ref T1) with one child task (number 1.1). */
function seedTask() {
  const track = store.create({ title: 'Content platform', kind: 'track', ref: 'T1' })
  const task = store.create({ title: 'Collect data', parentId: track.id, doneWhen: 'Data ready' })
  return { track, task }
}

describe('saveKnowledge', () => {
  it('saves a fresh entry with defaults and provenance', () => {
    const entry = save({ title: ' 落点判定 ', content: '用户要 X，落在 1.8，因为口径一致' }, { sessionId: 'session-a', turn: 2 })
    expect(entry.id).not.toBe('')
    expect(entry.kind).toBe('lesson')
    expect(entry.title).toBe('落点判定')
    expect(entry.content).toBe('用户要 X，落在 1.8，因为口径一致')
    expect(entry.taskId).toBe(null)
    expect(entry.tags).toEqual([])
    expect(entry.sessionId).toBe('session-a')
    expect(entry.turn).toBe(2)
    expect(entry.createdAt).toBe(entry.updatedAt)
  })

  it('links a resolved task and normalizes kind and tags', () => {
    const { task } = seedTask()
    const entry = save({
      kind: 'feedback',
      title: '判定反馈',
      content: '这次落在采集任务下是对的',
      taskId: task.id,
      tags: ['dispatch', ' 归档 ', 'dispatch'],
    })
    expect(entry.kind).toBe('feedback')
    expect(entry.taskId).toBe(task.id)
    expect(entry.tags).toEqual(['dispatch', '归档'])
  })

  it('replaces an existing entry by id and keeps its created timestamp', () => {
    const first = save({ title: 'A', content: 'B' })
    const second = save({ id: first.id, kind: 'note', title: 'C', content: 'D', tags: ['x'] })
    expect(second.id).toBe(first.id)
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.title).toBe('C')
    expect(second.kind).toBe('note')
    expect(queryKnowledge(store, {})).toHaveLength(1)
  })

  it('treats a blank or non-string id as a fresh entry', () => {
    expect(save({ id: '   ', title: 'A', content: 'B' }).id).not.toBe('')
    expect(save({ id: 5, title: 'A2', content: 'B2' }).id).not.toBe('')
    expect(queryKnowledge(store, {})).toHaveLength(2)
  })

  it('rejects an unknown replace id', () => {
    expectGanttError(() => save({ id: 'missing', title: 'A', content: 'B' }), 'knowledge missing was not found', 404)
  })

  it('rejects hostile titles, content, and kinds', () => {
    expectGanttError(() => save({ title: 5, content: 'B' }), 'title is required')
    expectGanttError(() => save({ title: '   ', content: 'B' }), 'title must not be empty')
    expectGanttError(() => save({ title: 'あ'.repeat(201), content: 'B' }), 'title must be at most 200 characters')
    expectGanttError(() => save({ title: 'A' }), 'content is required')
    expectGanttError(() => save({ title: 'A', content: 5 }), 'content is required')
    expectGanttError(() => save({ title: 'A', content: '   ' }), 'content must not be empty')
    expectGanttError(() => save({ title: 'A', content: 'あ'.repeat(4001) }), 'content must be at most 4000 characters')
    expectGanttError(() => save({ title: 'A', content: 'B', kind: 'bad' }), 'kind must be one of lesson, feedback, note')
  })

  it('rejects an unknown or non-string linked task', () => {
    expectGanttError(() => save({ title: 'A', content: 'B', taskId: 'missing' }), 'task missing was not found', 404)
    expectGanttError(() => save({ title: 'A', content: 'B', taskId: 5 }), 'taskId must be a string')
    expect(save({ title: 'A', content: 'B', taskId: '' }).taskId).toBe(null)
  })

  it('rejects hostile tags', () => {
    expectGanttError(() => save({ title: 'A', content: 'B', tags: 5 }), 'tags must be an array')
    expectGanttError(() => save({ title: 'A', content: 'B', tags: [5] }), 'tags[0] must be a string')
    expectGanttError(() => save({ title: 'A', content: 'B', tags: [''] }), 'tags[0] must not be empty')
    expectGanttError(() => save({ title: 'A', content: 'B', tags: ['x'.repeat(41)] }), 'tags[0] must be at most 40 characters')
    expectGanttError(() => save({ title: 'A', content: 'B', tags: Array.from({ length: 21 }, () => 'x') }), 'tags must have at most 20 entries')
  })

  it('stores empty provenance without a conversation or a turn', () => {
    expect(save({ title: 'A', content: 'B' })).toMatchObject({ sessionId: '', turn: null })
    expect(save({ title: 'C', content: 'D' }, { sessionId: 's', turn: 'x' })).toMatchObject({ sessionId: 's', turn: null })
  })
})

describe('queryKnowledge', () => {
  it('matches a keyword over title and content case-insensitively', () => {
    save({ title: '资金流 model', content: '判定按流速' })
    save({ title: '其他', content: '资金流出现在正文' })
    save({ title: '无关', content: '无关内容' })
    expect(queryKnowledge(store, { query: '资金流' })).toHaveLength(2)
    expect(queryKnowledge(store, { query: 'MODEL' })).toHaveLength(1)
    expect(queryKnowledge(store, { query: null })).toHaveLength(3)
  })

  it('escapes LIKE wildcards inside a keyword', () => {
    save({ title: '100% done', content: 'B' })
    save({ title: 'a_b', content: 'B' })
    save({ title: 'plain', content: 'B' })
    expect(queryKnowledge(store, { query: '100%' })).toHaveLength(1)
    expect(queryKnowledge(store, { query: 'a_b' })).toHaveLength(1)
    expect(queryKnowledge(store, { query: '%' })).toHaveLength(1)
    expect(queryKnowledge(store, { query: '_' })).toHaveLength(1)
  })

  it('filters by task, kind, and exact tag', () => {
    const { track, task } = seedTask()
    const other = store.create({ title: 'Other', parentId: track.id })
    save({ kind: 'feedback', title: 'F1', content: 'C', taskId: task.id, tags: ['归档'] })
    save({ kind: 'lesson', title: 'L1', content: 'C', taskId: other.id, tags: ['x'] })
    save({ kind: 'note', title: 'N1', content: 'C', taskId: task.id })
    expect(queryKnowledge(store, { taskId: task.id })).toHaveLength(2)
    expect(queryKnowledge(store, { taskId: task.id, kind: 'note' }).map(entry => entry.title)).toEqual(['N1'])
    expect(queryKnowledge(store, { tag: '归档' }).map(entry => entry.title)).toEqual(['F1'])
    expect(queryKnowledge(store, { tag: '档' })).toHaveLength(0)
    expect(queryKnowledge(store, { tag: null, kind: null, taskId: null })).toHaveLength(3)
  })

  it('returns the newest entries first within the limit', () => {
    for (let index = 1; index <= 10; index += 1) save({ title: `T${index}`, content: 'C' })
    const recent = queryKnowledge(store, {})
    expect(recent).toHaveLength(8)
    expect(recent[0].title).toBe('T10')
    expect(queryKnowledge(store, { limit: 3 }).map(entry => entry.title)).toEqual(['T10', 'T9', 'T8'])
    expect(queryKnowledge(store, { limit: MAX_QUERY_LIMIT })).toHaveLength(10)
    expect(queryKnowledge(store, { limit: null })).toHaveLength(8)
  })

  it('rejects hostile filters', () => {
    expectGanttError(() => queryKnowledge(store, { query: 5 }), 'query must be a string')
    expectGanttError(() => queryKnowledge(store, { taskId: 5 }), 'taskId must be a string')
    expectGanttError(() => queryKnowledge(store, { taskId: 'missing' }), 'task missing was not found', 404)
    expectGanttError(() => queryKnowledge(store, { kind: 'bad' }), 'kind must be one of lesson, feedback, note')
    expectGanttError(() => queryKnowledge(store, { tag: 5 }), 'tag must be a string')
    expectGanttError(() => queryKnowledge(store, { tag: '' }), 'tag must not be empty')
    expectGanttError(() => queryKnowledge(store, { limit: 0 }), 'limit must be an integer between 1 and 50')
    expectGanttError(() => queryKnowledge(store, { limit: MAX_QUERY_LIMIT + 1 }), 'limit must be an integer between 1 and 50')
    expectGanttError(() => queryKnowledge(store, { limit: 1.5 }), 'limit must be an integer between 1 and 50')
    expectGanttError(() => queryKnowledge(store, { limit: '3' }), 'limit must be an integer between 1 and 50')
  })

  it('unlinks entries when their task is deleted instead of dropping them', () => {
    const { task } = seedTask()
    save({ title: 'L', content: 'C', taskId: task.id })
    store.delete(task.id)
    const entries = queryKnowledge(store, {})
    expect(entries).toHaveLength(1)
    expect(entries[0].taskId).toBe(null)
  })
})

describe('knowledge schema migration', () => {
  it('recreates the knowledge table when upgrading a v9 database', () => {
    const dir = makeTempDir('dsh-gantt-knowledge-')
    const file = path.join(dir, 'tasks.db')
    try {
      const store = new GanttStore(file)
      store.close()
      const raw = new DatabaseSync(file)
      raw.exec('PRAGMA foreign_keys = OFF')
      raw.exec('DROP TABLE knowledge_entries')
      raw.exec('PRAGMA user_version = 9')
      raw.close()
      const upgraded = new GanttStore(file)
      expect(/** @type {{ user_version: number }} */ (upgraded.db.prepare('PRAGMA user_version').get()).user_version).toBe(SCHEMA_VERSION)
      const entry = saveKnowledge(upgraded, { title: 'A', content: 'B' })
      expect(upgraded.db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries').get()).toEqual({ count: 1 })
      expect(entry.title).toBe('A')
      upgraded.close()
    } finally {
      removeTempDir(dir)
    }
  })

  it('exposes the three entry kinds', () => {
    expect(KNOWLEDGE_KINDS).toEqual(['lesson', 'feedback', 'note'])
  })
})
