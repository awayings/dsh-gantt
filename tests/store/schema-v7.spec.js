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

/** Rewind a v7 database to the v6 four-word status CHECK. */
function downgradeToV6(file) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec(`
    CREATE TABLE tasks_v6 (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES tasks_v6(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
      progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'task',
      ref TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      lane TEXT NOT NULL DEFAULT '',
      dep TEXT NOT NULL DEFAULT '',
      done_when TEXT NOT NULL DEFAULT '',
      landing TEXT NOT NULL DEFAULT '',
      estimate TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      inspiration TEXT NOT NULL DEFAULT '',
      links TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'manual'
    );
    INSERT INTO tasks_v6 (
      id, parent_id, title, description, status, progress, start_date, end_date,
      sort_order, created_at, updated_at, kind, ref, state, lane, dep, done_when,
      landing, estimate, category, inspiration, links, source
    )
      SELECT
      id, parent_id, title, description, status, progress, start_date, end_date,
      sort_order, created_at, updated_at, kind, ref, state, lane, dep, done_when,
      landing, estimate, category, inspiration, links, source
      FROM tasks;
    DROP TABLE tasks;
    ALTER TABLE tasks_v6 RENAME TO tasks;
    CREATE INDEX idx_tasks_parent ON tasks(parent_id, sort_order, created_at);
    CREATE UNIQUE INDEX idx_tasks_ref ON tasks(kind, ref) WHERE ref <> '';
    PRAGMA user_version = 6;
  `)
  db.close()
}

describe('schema v7', () => {
  it('creates the widened status vocabulary', () => {
    store = new GanttStore(':memory:')
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(7)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(() => store.create({ title: 'Dropped', status: 'cancelled' })).not.toThrow()
    expect(() => store.db.prepare(
      "INSERT INTO tasks (id, title, status, start_date, end_date, created_at, updated_at) VALUES ('bad', 'Bad', 'archived', '2026-11-16', '2026-11-16', '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z')",
    ).run()).toThrow()
  })

  it('rebuilds the tasks table without losing the rows that reference it', () => {
    dir = makeTempDir('dsh-gantt-v6-to-v7-')
    const file = path.join(dir, 'tasks.db')
    store = new GanttStore(file)
    const parent = store.create({ title: 'Parent', kind: 'track', ref: 'T1' })
    const task = store.create({ title: 'Existing task', parentId: parent.id })
    store.update(task.id, { status: 'done' }, { sessionId: 'session-old', turn: 3, summary: 'shipped' })
    store.setFocus('session-old', task.id)
    store.bindWorkSession(task.id, 'session-old')
    store.close()

    downgradeToV6(file)

    store = new GanttStore(file)
    expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(store.count()).toBe(2)
    expect(store.getRow(task.id)?.title).toBe('Existing task')
    expect(store.trajectory({ taskId: task.id })[0]).toMatchObject({ action: 'complete', sessionId: 'session-old', turn: 3 })
    expect(store.focusOf('session-old')).toBe(task.id)
    expect(store.workSessionOf(task.id)).toBe('session-old')
    expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(store.update(task.id, { status: 'cancelled' })?.status).toBe('cancelled')
  })
})
