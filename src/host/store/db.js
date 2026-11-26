// Database location, handle opening, schema, and in-place migration.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** @typedef {import('../tree.js').SnapshotNode} SnapshotNode */
/** @typedef {import('../tree.js').SnapshotTrack} SnapshotTrack */

export const SCHEMA_VERSION = 10

/** Columns added by schema v3, v4, v8, and v9; the migration appends whichever is missing. @type {Record<string, string>} */
const TASK_EXTRA_COLUMNS = { kind: "TEXT NOT NULL DEFAULT 'task'", ref: "TEXT NOT NULL DEFAULT ''", state: "TEXT NOT NULL DEFAULT ''", lane: "TEXT NOT NULL DEFAULT ''", dep: "TEXT NOT NULL DEFAULT ''", done_when: "TEXT NOT NULL DEFAULT ''", landing: "TEXT NOT NULL DEFAULT ''", estimate: "TEXT NOT NULL DEFAULT ''", category: "TEXT NOT NULL DEFAULT ''", inspiration: "TEXT NOT NULL DEFAULT ''", links: "TEXT NOT NULL DEFAULT '[]'", tags: "TEXT NOT NULL DEFAULT '[]'", source: "TEXT NOT NULL DEFAULT 'manual'", operator_id: "TEXT NOT NULL DEFAULT ''", completed_by_id: "TEXT NOT NULL DEFAULT ''", report: "TEXT NOT NULL DEFAULT ''" }

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
    tags TEXT NOT NULL DEFAULT '[]',
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
  CREATE TABLE IF NOT EXISTS knowledge_entries (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'lesson' CHECK (kind IN ('lesson', 'feedback', 'note')),
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    session_id TEXT NOT NULL DEFAULT '',
    turn INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_knowledge_task ON knowledge_entries(task_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_knowledge_kind ON knowledge_entries(kind, created_at);
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
 * Read the schema version recorded by the last migration.
 * @param {DatabaseSync} db
 * @returns {number}
 */
function readSchemaVersion(db) {
  return /** @type {{ user_version: number }} */ (db.prepare('PRAGMA user_version').get()).user_version
}

/** How long {@link enableWal} keeps retrying while another process holds the write lock. */
const WAL_LOCK_WAIT_MS = 5000
/** Poll interval for {@link enableWal}. */
const WAL_LOCK_POLL_MS = 25
/** Milliseconds a writer waits for another process's lock before reporting SQLITE_BUSY. */
const BUSY_TIMEOUT_MS = 5000

/**
 * Block the current thread for `ms`; there is no timer API that runs while a
 * synchronous SQLite call owns the thread.
 * @param {number} ms
 * @returns {void}
 */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Switch the database to WAL. Two processes opening a fresh file at the same
 * instant both need the exclusive lock the journal-mode switch takes, and
 * SQLite does not run the busy handler for that pragma, so the wait is driven
 * here: the switch is retried until the winner commits.
 * @param {DatabaseSync} db
 * @param {number} waitMs
 * @returns {void}
 */
function enableWal(db, waitMs) {
  db.exec('PRAGMA busy_timeout = 0')
  const deadline = Date.now() + waitMs
  try {
    for (;;) {
      try {
        db.exec('PRAGMA journal_mode = WAL')
        return
      } catch (error) {
        if (Date.now() >= deadline) throw error
        sleep(WAL_LOCK_POLL_MS)
      }
    }
  } finally {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  }
}

/**
 * Names of the task columns the current schema expects but the table lacks.
 * @param {DatabaseSync} db
 * @returns {string[]}
 */
function missingTaskColumns(db) {
  const columns = new Set(/** @type {{ name: string }[]} */ (db.prepare('PRAGMA table_info(tasks)').all()).map(row => row.name))
  return Object.keys(TASK_EXTRA_COLUMNS).filter(name => !columns.has(name))
}

/**
 * Open (creating if needed) the SQLite database, set the pragmas the store
 * relies on, and create the schema. Refuses a file written by a newer build:
 * the plugin and gantt-mcp must agree on the schema they share.
 * @param {string} file
 * @param {number} [lockWaitMs] how long to retry the WAL switch while another
 *   process holds the write lock on a file both are opening for the first time
 * @returns {DatabaseSync}
 */
export function openDatabase(file, lockWaitMs = WAL_LOCK_WAIT_MS) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  if (file !== ':memory:') {
    try {
      fs.chmodSync(file, 0o600)
    } catch {
      // best effort; the database may live on a filesystem without POSIX modes
    }
  }
  // The Web UI and an MCP CLI process can hold this file at the same time; WAL
  // lets readers proceed and the timeout lets a writer wait out a short lock
  // instead of failing with SQLITE_BUSY. The timeout is set before the journal
  // mode change and the schema creation, which both need a write lock, so two
  // processes starting on a fresh file serialize instead of failing.
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  try {
    enableWal(db, lockWaitMs)
  } catch (error) {
    db.close()
    throw error
  }
  db.exec('PRAGMA foreign_keys = ON')
  const version = readSchemaVersion(db)
  if (version > SCHEMA_VERSION) {
    db.close()
    throw new Error(`refusing to open ${file}: schema v${version} is newer than this build supports (v${SCHEMA_VERSION}); run the same release for the plugin and gantt-mcp`)
  }
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
  // A database that is already current takes no write lock: the Web UI and
  // gantt-mcp open this file independently on every start.
  if (readSchemaVersion(db) === SCHEMA_VERSION && missingTaskColumns(db).length === 0) return
  // SQLite cannot widen a CHECK constraint in place, and dropping the parent
  // table with foreign keys on would cascade-delete the focus/trajectory rows
  // that reference it. The v7 rebuild therefore runs with checks disabled and
  // recreates the same ids, so the invariant holds again once they are back on.
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    transaction(() => {
      // BEGIN IMMEDIATE serializes concurrent first starts after an upgrade;
      // the version is read again inside the lock, so a migration another
      // process already committed is not applied a second time.
      const version = readSchemaVersion(db)
      for (const name of missingTaskColumns(db)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${TASK_EXTRA_COLUMNS[name]}`)
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
            tags TEXT NOT NULL DEFAULT '[]',
            source TEXT NOT NULL DEFAULT 'manual',
            operator_id TEXT NOT NULL DEFAULT '',
            completed_by_id TEXT NOT NULL DEFAULT '',
            report TEXT NOT NULL DEFAULT ''
          );
          INSERT INTO tasks_v7 (
            id, parent_id, title, description, status, progress, start_date, end_date,
            sort_order, created_at, updated_at, kind, ref, state, lane, dep, done_when,
            landing, estimate, category, inspiration, links, tags, source, operator_id,
            completed_by_id, report
          )
            SELECT
            id, parent_id, title, description, status, progress, start_date, end_date,
            sort_order, created_at, updated_at, kind, ref, state, lane, dep, done_when,
            landing, estimate, category, inspiration, links, tags, source, operator_id,
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
    db.exec('PRAGMA foreign_keys = ON')
  }
}
