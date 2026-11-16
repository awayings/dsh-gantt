import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GanttStore, SCHEMA_VERSION } from '../../src/host/store.js'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'

let dir
let store

afterEach(() => {
  store?.close()
  store = undefined
  if (dir) removeTempDir(dir)
  dir = undefined
})

/** Columns of one table, in declaration order. */
function columns(db, table) {
  return /** @type {{ name: string }[]} */ (db.prepare(`PRAGMA table_info(${table})`).all()).map(row => row.name)
}

/** Named indexes on one table. */
function indexes(db, table) {
  return /** @type {{ name: string }[]} */ (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name LIKE 'idx_%'").all(table)).map(row => row.name).sort()
}

/** Rewind a v6 database to the v5 task_events CHECK and user version. */
function downgradeToV5(file) {
  const db = new DatabaseSync(file)
  db.exec(`
    DROP TABLE work_sessions;
    ALTER TABLE task_events RENAME TO task_events_v6;
    CREATE TABLE task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL DEFAULT '',
      turn INTEGER,
      action TEXT NOT NULL CHECK (action IN ('create', 'update', 'complete', 'decompose')),
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    INSERT INTO task_events SELECT * FROM task_events_v6;
    DROP TABLE task_events_v6;
    CREATE INDEX idx_task_events_task ON task_events(task_id, created_at);
    CREATE INDEX idx_task_events_session ON task_events(session_id, created_at);
    PRAGMA user_version = 5;
  `)
  db.close()
}

describe('schema v6', () => {
  it('creates the work-session table and the widened trajectory vocabulary', () => {
    store = new GanttStore(':memory:')
    expect(SCHEMA_VERSION).toBe(6)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(columns(store.db, 'work_sessions')).toEqual(['task_id', 'session_id', 'created_at', 'updated_at'])
    expect(indexes(store.db, 'work_sessions')).toEqual(['idx_work_sessions_session'])
    expect(columns(store.db, 'task_events')).toEqual(['id', 'task_id', 'session_id', 'turn', 'action', 'detail', 'created_at'])
    expect(indexes(store.db, 'task_events')).toEqual(['idx_task_events_session', 'idx_task_events_task'])
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM work_sessions').get()).toEqual({ count: 0 })
  })

  it('accepts the track action and rejects actions outside the vocabulary', () => {
    store = new GanttStore(':memory:')
    const task = store.create({ title: 'Tracked task' })
    const event = store.recordTrack({ taskId: task.id, sessionId: 'session-a', turn: 1, detail: 'round note' })
    expect(event.action).toBe('track')
    expect(() => store.recordEvent({ taskId: task.id, action: 'archive' })).toThrow(/action must be one of/)
    expect(() => store.db.prepare(
      'INSERT INTO task_events (id, task_id, session_id, turn, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('bad-event', task.id, '', null, 'archive', '', '2026-11-16T00:00:00.000Z')).toThrow()
  })

  it('rebuilds task_events with its rows when a v5 database is reopened', () => {
    dir = makeTempDir('dsh-gantt-v5-to-v6-')
    const file = path.join(dir, 'tasks.db')
    store = new GanttStore(file)
    const task = store.create({ title: 'Existing task' })
    const event = store.recordEvent({ taskId: task.id, action: 'update', sessionId: 'session-old', turn: 3, detail: 'started' })
    store.bindWorkSession(task.id, 'session-old')
    store.close()

    downgradeToV5(file)

    store = new GanttStore(file)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(store.count()).toBe(1)
    expect(store.getRow(/** @type {string} */ (task?.id))?.title).toBe('Existing task')
    expect(store.trajectory({ taskId: task?.id })[0]).toMatchObject({ id: event.id, action: 'update', sessionId: 'session-old', turn: 3, detail: 'started' })
    expect(columns(store.db, 'work_sessions')).toEqual(['task_id', 'session_id', 'created_at', 'updated_at'])
    expect(store.workSessionOf(task?.id)).toBeNull()
    const tracked = store.recordTrack({ taskId: task?.id, sessionId: 'session-new' })
    expect(tracked.action).toBe('track')
  })

  it('adds both tables when a v4 database is reopened without a trajectory', () => {
    dir = makeTempDir('dsh-gantt-v4-to-v6-')
    const file = path.join(dir, 'tasks.db')
    store = new GanttStore(file)
    const task = store.create({ title: 'Existing task' })
    store.close()
    const db = new DatabaseSync(file)
    db.exec('DROP TABLE task_events; DROP TABLE work_sessions; PRAGMA user_version = 4')
    db.close()

    store = new GanttStore(file)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(store.count()).toBe(1)
    expect(store.trajectory()).toEqual([])
    expect(store.workSessionOf(task?.id)).toBeNull()
    expect(store.recordTrack({ taskId: task?.id, detail: 'manual note' }).action).toBe('track')
  })

  it('keeps one mapping per task and drops it with the task', () => {
    store = new GanttStore(':memory:')
    const task = store.create({ title: 'Task' })
    store.bindWorkSession(task.id, 'session-a')
    store.bindWorkSession(task.id, 'session-b')
    expect(store.db.prepare('SELECT session_id AS sessionId FROM work_sessions').all()).toEqual([{ sessionId: 'session-b' }])
    store.delete(task.id)
    expect(store.workSessionOf(task.id)).toBeNull()
  })
})
