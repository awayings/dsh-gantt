// Database location, handle opening, schema, and in-place migration.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** @typedef {import('../tree.js').SnapshotNode} SnapshotNode */
/** @typedef {import('../tree.js').SnapshotTrack} SnapshotTrack */

export const SCHEMA_VERSION = 8

/** Columns added by schema v3, v4, and v8; the migration appends whichever is missing. @type {Record<string, string>} */
const TASK_EXTRA_COLUMNS = { kind: "TEXT NOT NULL DEFAULT 'task'", ref: "TEXT NOT NULL DEFAULT ''", state: "TEXT NOT NULL DEFAULT ''", lane: "TEXT NOT NULL DEFAULT ''", dep: "TEXT NOT NULL DEFAULT ''", done_when: "TEXT NOT NULL DEFAULT ''", landing: "TEXT NOT NULL DEFAULT ''", estimate: "TEXT NOT NULL DEFAULT ''", category: "TEXT NOT NULL DEFAULT ''", inspiration: "TEXT NOT NULL DEFAULT ''", links: "TEXT NOT NULL DEFAULT '[]'", source: "TEXT NOT NULL DEFAULT 'manual'", operator_id: "TEXT NOT NULL DEFAULT ''", completed_by_id: "TEXT NOT NULL DEFAULT ''", report: "TEXT NOT NULL DEFAULT ''" }

const CREATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
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
    source TEXT NOT NULL DEFAULT 'manual',
    operator_id TEXT NOT NULL DEFAULT '',
    completed_by_id TEXT NOT NULL DEFAULT '',
    report TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id, sort_order, created_at);
  CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, name TEXT NOT NULL, lane TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', blocker TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, track_id TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL DEFAULT '', start_date TEXT, end_date TEXT, dep TEXT NOT NULL DEFAULT '', done_when TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS plan_blocks (id TEXT PRIMARY KEY, plan_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '', end_time TEXT NOT NULL DEFAULT '', slot TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', landing TEXT NOT NULL DEFAULT '', estimate TEXT NOT NULL DEFAULT '', inspiration TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'skipped')), notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'schedule', source_ref TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_plan_blocks_date ON plan_blocks(plan_date, sort_order, start_time);
  CREATE TABLE IF NOT EXISTS day_plans (plan_date TEXT PRIMARY KEY, weekday TEXT NOT NULL DEFAULT '', day_kind TEXT NOT NULL DEFAULT '', market_open INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '', core_goal TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS daily_briefs (plan_date TEXT PRIMARY KEY, generated_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'auto', report TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS focus (session_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS task_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL DEFAULT '',
    turn INTEGER,
    action TEXT NOT NULL CHECK (action IN ('create', 'update', 'complete', 'decompose', 'track')),
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_task_events_session ON task_events(session_id, created_at);
  CREATE TABLE IF NOT EXISTS work_sessions (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_work_sessions_session ON work_sessions(session_id);
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'ai-agent' CHECK (type IN ('human', 'ai-agent')),
    role TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    endpoint TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
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
  // The Web UI and an MCP CLI process can hold this file at the same time; WAL
  // lets readers proceed and the timeout lets a writer wait out a short lock
  // instead of failing with SQLITE_BUSY.
  db.exec('PRAGMA busy_timeout = 5000')
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
  // SQLite cannot widen a CHECK constraint in place, and dropping the parent
  // table with foreign keys on would cascade-delete the focus/trajectory rows
  // that reference it. The v7 rebuild therefore runs with checks disabled and
  // recreates the same ids, so the invariant holds again once they are back on.
  const rebuildTasks = version < 7
  if (rebuildTasks) db.exec('PRAGMA foreign_keys = OFF')
  try {
    transaction(() => {
      for (const name of missing) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${TASK_EXTRA_COLUMNS[name]}`)
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_ref ON tasks(kind, ref) WHERE ref <> ''")
      if (version < 3) {
        const tracks = /** @type {SnapshotTrack[]} */ (db.prepare('SELECT id, name, lane, state, blocker, sort_order AS sortOrder FROM tracks ORDER BY sort_order, id').all())
        const nodes = /** @type {SnapshotNode[]} */ (db.prepare('SELECT id, track_id AS trackId, title, state, start_date AS startDate, end_date AS endDate, dep, done_when AS doneWhen FROM nodes ORDER BY id').all())
        syncTrackerTree(tracks, nodes)
      }
      // SQLite cannot widen a CHECK constraint in place: rebuild task_events with
      // the `track` action vocabulary, preserving every recorded row.
      if (version < 6) {
        db.exec(`
          DROP TABLE IF EXISTS task_events_v6;
          CREATE TABLE task_events_v6 (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            session_id TEXT NOT NULL DEFAULT '',
            turn INTEGER,
            action TEXT NOT NULL CHECK (action IN ('create', 'update', 'complete', 'decompose', 'track')),
            detail TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
          );
          INSERT INTO task_events_v6 (id, task_id, session_id, turn, action, detail, created_at)
            SELECT id, task_id, session_id, turn, action, detail, created_at FROM task_events;
          DROP TABLE task_events;
          ALTER TABLE task_events_v6 RENAME TO task_events;
          CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_task_events_session ON task_events(session_id, created_at);
        `)
      }
      // Widen the status CHECK with the cancelled vocabulary, preserving rows and
      // the ids that focus/task_events/work_sessions reference.
      if (version < 7) {
        db.exec(`
          DROP TABLE IF EXISTS tasks_v7;
          CREATE TABLE tasks_v7 (
            id TEXT PRIMARY KEY,
            parent_id TEXT REFERENCES tasks_v7(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
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
            source TEXT NOT NULL DEFAULT 'manual',
            operator_id TEXT NOT NULL DEFAULT '',
            completed_by_id TEXT NOT NULL DEFAULT '',
            report TEXT NOT NULL DEFAULT ''
          );
          INSERT INTO tasks_v7 (
            id, parent_id, title, description, status, progress, start_date, end_date,
            sort_order, created_at, updated_at, kind, ref, state, lane, dep, done_when,
            landing, estimate, category, inspiration, links, source, operator_id,
            completed_by_id, report
          )
            SELECT
            id, parent_id, title, description, status, progress, start_date, end_date,
            sort_order, created_at, updated_at, kind, ref, state, lane, dep, done_when,
            landing, estimate, category, inspiration, links, source, operator_id,
            completed_by_id, report
            FROM tasks;
          DROP TABLE tasks;
          ALTER TABLE tasks_v7 RENAME TO tasks;
          CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id, sort_order, created_at);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_ref ON tasks(kind, ref) WHERE ref <> '';
        `)
      }
      if (version < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    })
  } finally {
    if (rebuildTasks) db.exec('PRAGMA foreign_keys = ON')
  }
}
