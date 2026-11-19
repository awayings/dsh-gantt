import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect } from 'vitest'
import { GanttError, GanttStore } from '../../src/host/store.js'

/** @typedef {import('../../src/host/store.js').TaskRow} TaskRow */

/** Create a disposable in-memory store. */
export function memoryStore() {
  return new GanttStore(':memory:')
}

/** Create a unique temporary directory for file-backed store tests. */
export function makeTempDir(prefix = 'dsh-gantt-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/** Remove a temporary directory and everything below it. */
export function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

/**
 * Build one raw task row in the same shape that GanttStore#listRows returns.
 * @param {Partial<TaskRow>} [overrides]
 * @returns {TaskRow}
 */
export function makeRow(overrides = {}) {
  return {
    id: 'row-1',
    parentId: null,
    title: 'Task',
    description: '',
    status: 'todo',
    progress: 0,
    startDate: '2024-01-01',
    endDate: '2024-01-03',
    sortOrder: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    kind: 'task',
    ref: '',
    state: '',
    lane: '',
    dep: '',
    doneWhen: '',
    landing: '',
    estimate: '',
    category: '',
    inspiration: '',
    links: [],
    tags: [],
    source: 'manual',
    operatorId: '',
    completedById: '',
    report: '',
    workSessionId: null,
    ...overrides,
  }
}

/**
 * Build raw task rows, one per override object.
 * @param {Partial<TaskRow>[]} overrides
 * @returns {TaskRow[]}
 */
export function makeRows(...overrides) {
  return overrides.map(row => makeRow(row))
}

/** Capture the current values of env vars and return a restore function. */
export function snapshotEnv(...names) {
  const saved = names.map(name => [name, process.env[name]])
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

/** Clear the env vars that decide where the store lives. */
export function clearDatabaseEnv() {
  delete process.env.DSH_GANTT_DB
  delete process.env.DSH_HOME
}

/** Index task nodes by hierarchical number, walking the tree depth-first. */
export function byNumber(nodes) {
  const map = new Map()
  const walk = (list) => {
    for (const node of list) {
      map.set(node.number, node)
      walk(node.children)
    }
  }
  walk(nodes)
  return map
}

/** Names of a node's direct children, in rendered order. */
export function childTitles(node) {
  return node.children.map(child => child.title)
}

/** Assert that `run` throws a GanttError carrying the given message and status. */
export function expectGanttError(run, message, status = 400) {
  let caught
  try {
    run()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(GanttError)
  expect(caught.message).toBe(message)
  expect(caught.status).toBe(status)
}

/** Insert or replace one persisted daily-brief report row verbatim. */
export function insertDailyReport(store, report) {
  store.db.prepare(`INSERT INTO daily_briefs (plan_date, generated_at, source, report)
    VALUES (?, ?, ?, ?) ON CONFLICT(plan_date) DO UPDATE SET generated_at = excluded.generated_at,
    source = excluded.source, report = excluded.report`).run(report.date, report.generatedAt, report.source, JSON.stringify(report))
}

/** Assert that a stored timestamp is a canonical ISO-8601 UTC string. */
export function expectIsoTimestamp(value) {
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
}

/** Names of the columns of one table, in declaration order. */
function columnNames(db, table) {
  return new Set(/** @type {{ name: string }[]} */ (db.prepare(`PRAGMA table_info(${table})`).all()).map(row => row.name))
}

/** Drop one task column when the table still has it. */
function dropTaskColumn(db, name) {
  if (columnNames(db, 'tasks').has(name)) db.exec(`ALTER TABLE tasks DROP COLUMN ${name}`)
}

/** Rewind a current-version database to the v7 shape: no agents table and none
 * of the v8 or v9 task columns, while still claiming v7. */
export function downgradeToV7(file) {
  const db = new DatabaseSync(file)
  db.exec('DROP TABLE agents')
  dropTaskColumn(db, 'operator_id')
  dropTaskColumn(db, 'completed_by_id')
  dropTaskColumn(db, 'report')
  dropTaskColumn(db, 'tags')
  db.exec('PRAGMA user_version = 7')
  db.close()
}

/** Rewind a current-version database to the v8 shape: no tags column, while
 * still claiming v8. */
export function downgradeToV8(file) {
  const db = new DatabaseSync(file)
  dropTaskColumn(db, 'tags')
  db.exec('PRAGMA user_version = 8')
  db.close()
}
