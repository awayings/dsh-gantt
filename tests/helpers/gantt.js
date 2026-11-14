import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect } from 'vitest'
import { GanttError, GanttStore } from '../../store.js'

/** @typedef {import('../../store.js').TaskRow} TaskRow */

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

/** Assert that a stored timestamp is a canonical ISO-8601 UTC string. */
export function expectIsoTimestamp(value) {
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
}
