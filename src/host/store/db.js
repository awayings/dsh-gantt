// Database location, handle opening, schema, and in-place migration.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** @typedef {import('../tree.js').SnapshotNode} SnapshotNode */
/** @typedef {import('../tree.js').SnapshotTrack} SnapshotTrack */

export const SCHEMA_VERSION = 4

/** Columns added by schema v3/v4; the migration appends whichever is missing. @type {Record<string, string>} */
const TASK_EXTRA_COLUMNS = { kind: "TEXT NOT NULL DEFAULT 'task'", ref: "TEXT NOT NULL DEFAULT ''", state: "TEXT NOT NULL DEFAULT ''", lane: "TEXT NOT NULL DEFAULT ''", dep: "TEXT NOT NULL DEFAULT ''", done_when: "TEXT NOT NULL DEFAULT ''", landing: "TEXT NOT NULL DEFAULT ''", estimate: "TEXT NOT NULL DEFAULT ''", category: "TEXT NOT NULL DEFAULT ''", inspiration: "TEXT NOT NULL DEFAULT ''", links: "TEXT NOT NULL DEFAULT '[]'", source: "TEXT NOT NULL DEFAULT 'manual'" }

const CREATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
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
  CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id, sort_order, created_at);
  CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, name TEXT NOT NULL, lane TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', blocker TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, track_id TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL DEFAULT '', start_date TEXT, end_date TEXT, dep TEXT NOT NULL DEFAULT '', done_when TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS plan_blocks (id TEXT PRIMARY KEY, plan_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '', end_time TEXT NOT NULL DEFAULT '', slot TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', landing TEXT NOT NULL DEFAULT '', estimate TEXT NOT NULL DEFAULT '', inspiration TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'skipped')), notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'schedule', source_ref TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_plan_blocks_date ON plan_blocks(plan_date, sort_order, start_time);
  CREATE TABLE IF NOT EXISTS day_plans (plan_date TEXT PRIMARY KEY, weekday TEXT NOT NULL DEFAULT '', day_kind TEXT NOT NULL DEFAULT '', market_open INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '', core_goal TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS daily_briefs (plan_date TEXT PRIMARY KEY, generated_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'auto', report TEXT NOT NULL);
`

/**
 * Resolve the durable database location; override with DSH_GANTT_DB.
 * @returns {string}
 */
export function resolveDatabasePath() {
  if (process.env.DSH_GANTT_DB) return process.env.DSH_GANTT_DB
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'gantt', 'tasks.db')
}

/**
 * Open (creating if needed) the SQLite database, set the pragmas the store
 * relies on, and create the schema.
 * @param {string} file
 * @returns {DatabaseSync}
 */
export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  if (file !== ':memory:') {
    try {
      fs.chmodSync(file, 0o600)
    } catch {
      // best effort; the database may live on a filesystem without POSIX modes
    }
  }
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(CREATE_SCHEMA)
  return db
}

/**
 * Upgrade an older database in one transaction: add columns, index, version, backfill.
 * @param {DatabaseSync} db
 * @param {(fn: () => void) => void} transaction
 * @param {(tracks: SnapshotTrack[], nodes: SnapshotNode[]) => void} syncTrackerTree
 * @returns {void}
 */
export function migrateDatabase(db, transaction, syncTrackerTree) {
  const version = /** @type {{ user_version: number }} */ (db.prepare('PRAGMA user_version').get()).user_version
  const columns = new Set(/** @type {{ name: string }[]} */ (db.prepare('PRAGMA table_info(tasks)').all()).map(row => row.name))
  const missing = Object.keys(TASK_EXTRA_COLUMNS).filter(name => !columns.has(name))
  transaction(() => {
    for (const name of missing) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${TASK_EXTRA_COLUMNS[name]}`)
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_ref ON tasks(kind, ref) WHERE ref <> ''")
    if (version < 3) {
      const tracks = /** @type {SnapshotTrack[]} */ (db.prepare('SELECT id, name, lane, state, blocker, sort_order AS sortOrder FROM tracks ORDER BY sort_order, id').all())
      const nodes = /** @type {SnapshotNode[]} */ (db.prepare('SELECT id, track_id AS trackId, title, state, start_date AS startDate, end_date AS endDate, dep, done_when AS doneWhen FROM nodes ORDER BY id').all())
      syncTrackerTree(tracks, nodes)
    }
    if (version < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  })
}
