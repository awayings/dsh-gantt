// A deterministic v2 database fixture: the pre-v3 schema (tasks without the 12
// tracker columns) plus a small imported snapshot, one plan block, and one day
// plan. Committed in code so migration tests run in a clean checkout without the
// gitignored `.tmp/v2-copy.db`.
import { DatabaseSync } from 'node:sqlite'

const V2_SCHEMA = `
CREATE TABLE tasks (
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
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_parent ON tasks(parent_id, sort_order, created_at);
CREATE TABLE tracks (id TEXT PRIMARY KEY, name TEXT NOT NULL, lane TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT '', blocker TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE nodes (id TEXT PRIMARY KEY, track_id TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL DEFAULT '', start_date TEXT, end_date TEXT, dep TEXT NOT NULL DEFAULT '', done_when TEXT NOT NULL DEFAULT '');
CREATE TABLE plan_blocks (id TEXT PRIMARY KEY, plan_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '', end_time TEXT NOT NULL DEFAULT '', slot TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', landing TEXT NOT NULL DEFAULT '', estimate TEXT NOT NULL DEFAULT '', inspiration TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'skipped')), notes TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'schedule', source_ref TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_plan_blocks_date ON plan_blocks(plan_date, sort_order, start_time);
CREATE TABLE day_plans (plan_date TEXT PRIMARY KEY, weekday TEXT NOT NULL DEFAULT '', day_kind TEXT NOT NULL DEFAULT '', market_open INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '', core_goal TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
PRAGMA user_version = 2;
`

/** Tracks of the v2 fixture, in import order. */
export const V2_TRACKS = [
  { id: '1', name: '投资系统', lane: '赚钱', priority: '高', state: '进行', blocker: 'L5 = 0' },
  { id: '2', name: '打工', lane: '赚钱', priority: '高', state: '卡住', blocker: '黑名单只进不出' },
]

/** Nodes of the v2 fixture: one done leaf, one running parent, its todo child, one blocked leaf. */
export const V2_NODES = [
  { id: '1.1', trackId: '1', title: '数据底座', state: '已过', startDate: '2026-07-01', endDate: '2026-09-30', dep: '', doneWhen: '表能查' },
  { id: '1.8', trackId: '1', title: '策略实盘化', state: '进行', startDate: null, endDate: null, dep: '', doneWhen: '≥2 条进 L5' },
  { id: '1.8.1', trackId: '1', title: 'S2 每日交易仓读数', state: '未开始', startDate: '2026-11-09', endDate: '2026-11-15', dep: '', doneWhen: '每天一句读数' },
  { id: '2.1', trackId: '2', title: '运营管控视图整理', state: '卡住', startDate: '2026-10-05', endDate: null, dep: '', doneWhen: '在跑规则全列' },
]

/** The plan block inserted next to the snapshot, keyed by its deterministic id. */
export const V2_BLOCK_ID = '2026-11-15|09:00|0'

/**
 * Write the v2 database fixture to `file` (replacing it).
 * @param {string} file
 * @returns {string}
 */
export function writeV2Database(file) {
  const db = new DatabaseSync(file)
  try {
    db.exec(V2_SCHEMA)
    const track = db.prepare('INSERT INTO tracks (id, name, lane, priority, state, blocker, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
    V2_TRACKS.forEach((row, index) => track.run(row.id, row.name, row.lane, row.priority, row.state, row.blocker, index))
    const node = db.prepare('INSERT INTO nodes (id, track_id, title, state, start_date, end_date, dep, done_when) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (const row of V2_NODES) node.run(row.id, row.trackId, row.title, row.state, row.startDate, row.endDate, row.dep, row.doneWhen)
    db.prepare(`INSERT INTO plan_blocks (id, plan_date, start_time, end_time, slot, category, title, detail, landing, estimate, inspiration, status, notes, sort_order, source, source_ref, created_at, updated_at)
      VALUES (?, '2026-11-15', '09:00', '17:00', 'morning', 'A', '读数收口', '', 'invest/a.md', '4h', '#21', 'todo', '', 0, 'schedule', 'SCHEDULE.md', '2026-11-14T00:00:00.000Z', '2026-11-14T00:00:00.000Z')`).run(V2_BLOCK_ID)
    db.prepare(`INSERT INTO day_plans (plan_date, weekday, day_kind, market_open, label, core_goal, source, updated_at)
      VALUES ('2026-11-15', '周日', 'weekend', 0, '周末（休市）', '收表', 'schedule', '2026-11-14T00:00:00.000Z')`).run()
  } finally {
    db.close()
  }
  return file
}
