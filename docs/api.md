# JSON API

The host half exposes a JSON API under `/api/gantt/*`. It rides the harness's
existing authenticated `/api` channel: no second port, token, CORS setup, or
origin allowlist is involved.

- The browser half calls these routes with its normal session cookie.
- A terminal `curl` must send the same `dsh-auth` session cookie: open the
  tokenized URL printed by `dsh web` once, then copy the `Cookie` request
  header from an authenticated `/api` request (browser DevTools → Network).
  Treat that cookie as a credential.
- Requests and responses are JSON. Responses carry `cache-control: no-store`
  and `x-content-type-options: nosniff`.
- The page's **API** button shows the resolved database path and this endpoint
  catalog at runtime (`GET /api/gantt/meta`).
- The schema is version 6: one working tree in `tasks` (track roots, imported
  nodes, decomposed and manual tasks), the persisted daily brief report,
  per-conversation `focus` rows, the append-only `task_events` trajectory, and
  the `work_sessions` mapping from a task to its dedicated main conversation.
  The domain model is in [personal-task-system.md](personal-task-system.md);
  the migration in [compatibility.md](compatibility.md).

Base URL: the origin printed by your own `dsh web` launch, for example
`http://127.0.0.1:3080`.

## Routes

| Method | Path | Body / Query | Success |
| --- | --- | --- | --- |
| `GET` | `/api/gantt/tree` | — | `200` tree, frontier `brief`, `dailyBrief`, numbers, rollups, stats |
| `GET` | `/api/gantt/focus` | `?sessionId=<id>` | `200 { ok, taskId }` |
| `POST` | `/api/gantt/focus/set` | `{ sessionId, taskId? }` | `200 { ok, taskId }` |
| `GET` | `/api/gantt/trajectory` | `?taskId=&sessionId=&limit=` | `200 { ok, events }` |
| `GET` | `/api/gantt/work` | `?taskId=<id>` or `?sessionId=<id>` | `200 { ok, cwd, task, sessionId }` |
| `POST` | `/api/gantt/work/session` | `{ taskId, sessionId }` | `200 { ok, taskId, sessionId }` |
| `GET` | `/api/gantt/work/skills` | — | `200 { ok, available, skills }` |
| `GET` | `/api/gantt/work/team` | `?sessionId=<id>` | `200 { ok, available, agents }` |
| `GET` | `/api/gantt/meta` | — | `200` database path, statuses, kinds, link types, endpoint catalog |
| `POST` | `/api/gantt/tasks` | `{ title, parentId?, startDate?, endDate?, status?, progress?, description?, kind?, ref?, lane?, dep?, doneWhen?, landing?, estimate?, category?, inspiration?, links? }` | `201` created task |
| `POST` | `/api/gantt/task/update` | `{ id, title?, description?, parentId?, startDate?, endDate?, status?, progress?, lane?, dep?, doneWhen?, landing?, estimate?, category?, inspiration?, links? }` | `200` updated task |
| `POST` | `/api/gantt/task/status` | `{ id, status, progress? }` | `200` updated task |
| `POST` | `/api/gantt/task/split` | `{ id, children: [{ title, startDate?, endDate?, status?, progress?, description?, lane?, dep?, doneWhen?, landing?, estimate?, category?, inspiration?, links? }] }` | `200` parent + created children |
| `POST` | `/api/gantt/task/decompose` | `{ id, planDate?, children: [...] }` (see [Decompose](#decompose-a-node)) | `200` parent, children, created plan blocks |
| `POST` | `/api/gantt/task/schedule` | `{ id, date, startTime?, endTime?, slot?, category?, landing?, estimate?, inspiration?, detail? }` | `200` task + plan block |
| `POST` | `/api/gantt/task/delete` | `{ id }` | `200` deleted id + its former parent |
| `GET` | `/api/gantt/context` | `?date=YYYY-MM-DD&root=<taskId>&limit=<chars>` | `200` markdown context export |
| `POST` | `/api/gantt/seed` | `{}` (body ignored) | `200` seed result, plus snapshot when seeded |
| `GET` | `/api/gantt/day` | `?date=YYYY-MM-DD` | `200` one day's plan bundle |
| `POST` | `/api/gantt/plan/status` | `{ id, status, notes? }` | `200 { ok, block }` |
| `POST` | `/api/gantt/plan/import` | `{ dir?, year? }` | `200 { ok, dir, imported }` |
| `GET` | `/api/gantt/brief` | `?date=YYYY-MM-DD` | `200 { ok, today, date, brief, cached }` |
| `POST` | `/api/gantt/brief/compute` | `{ date? }` | `200 { ok, today, date, brief, cached: false }` |

Twenty-three routes are registered. Routes that read a body require a JSON
object; any other JSON value is rejected with `400`. `GET` routes and `seed` do
not read a body. The focus routes and the assistant tools share one
per-conversation focus; the work routes and `gantt_track` share one
task ⇄ dedicated-conversation mapping; the plugin itself never calls a model.

## Conventions

- **Dates** are `YYYY-MM-DD` and must be real calendar days. `endDate` MUST not
  be before `startDate`. They are **task-day dates**: the `today` fields in
  responses and every date default resolve in the task-day zone
  (`DSH_GANTT_TZ`, default `Asia/Shanghai`), not in the host process's UTC
  date.
- **Kind** is `track`, `node`, or `task`. `track` and `node` are the imported
  tree layers; `task` is a manually created or decomposed row. Create defaults
  to `task`. The create route technically accepts all three, but only a caller
  writing its own importer should create `track`/`node` rows — the UI never
  offers them.
- **Status** is one of `todo`, `in_progress`, `blocked`, `done` (the vocabulary
  is also returned by `/tree` and `/meta`).
- **Progress** is a number from 0 to 100; it is rounded and clamped.
- **Title** is trimmed and whitespace-collapsed, 1–200 characters.
- **Description** is an optional string of at most 4000 characters; absent or
  `null` becomes `''`.
- **Numbers** (`1`, `1.1`, …) are derived from sibling order at read time.
- **Rollups**: when a task has children, its `startDate`/`endDate` cover them
  and `progress` is the mean of the children's progress. Status follows the
  tracker rule, not a plain child average:
  - every child `done` → `done`;
  - otherwise, for a row that carries a tracker `state` (an imported track or
    node), its own state decides: parent `进行` → `in_progress`; a `卡住` child →
    `blocked`; any `进行`/`已过` child → `in_progress`; otherwise `todo`. A
    tracker parent's own state therefore wins over a weaker child-derived state
    — a track that is 进行 reads `in_progress` even while all its children are
    未开始;
  - for a manual parent (`state` empty) the child-derived rule applies: `done`
    when every child is done, `blocked` when any is blocked, `in_progress` when
    any is in progress or progress > 0, otherwise `todo`.

  Parent values are read-only; the UI never authors them. A decomposed node —
  imported or manual — is no longer an execution unit, so this is also how it
  gets completed. Limitation: a parent that loses its last child keeps the last
  persisted rollup values (rule 8 in [compatibility.md](compatibility.md)).
- **Ref** is the stable external key (`track:1`, `node:1.8.1`); it is writable
  only on create and immutable afterwards (update ignores the key). Manual rows
  carry `''`. A `(kind, ref)` pair with a non-empty `ref` must be unique:
  claiming one that already exists is a `409`.
- **State** is the normalized tracker state (`已过`, `进行`, `卡住`, `未开始`,
  `撤销`, …), stored beside `status` and returned as-is. It is not writable
  through this API: only the importer changes it.
- **Source** is `tracker` or `manual`; read-only.
- **Lane** is the track lane (`赚钱` or `生活`); imported nodes inherit it from
  their track. `dep` and `doneWhen` come from the tracker node table; `landing`,
  `estimate`, `category`, and `inspiration` are plugin-side execution metadata
  (see the [task object](#task-object)). Each is a string and empty when
  unknown; the importer fills only the tracker fields, so the plugin-side
  metadata starts empty on imported rows.
- **Links** is an array of at most 20 objects. Each entry is
  `{ type, ref, label? }`: `type` is one of `memory`, `file`, `url`, `task`,
  `note`; `ref` is 1–500 characters; `label` is optional and at most 120
  characters. A non-array value, an unknown type, or an over-long field is a
  `400`. `update` replaces the whole array.
- **Plan status** is one of `todo`, `in_progress`, `done`, `skipped` — the
  vocabulary of a *plan block* (a time slot on a day), not of a task.
- **Plan slot** is one of `morning` (starts before `10:00`), `daytime` (starts
  before `19:30`), `evening` (starts at or after `19:30`), `other` (no start
  time). It is derived from the clock when a block is created or imported, not
  stored by hand.
- **Times** are `HH:MM` or `''`; `dayKind` is `workday`, `weekend`, or
  `unknown`.

## Task object

Every task in a response has this shape. Fields marked *derived* are computed
on read.

```json
{
  "id": "0f0c1c2e-6f4a-4d1e-9f4a-1f0b2f5c8a11",
  "parentId": null,
  "kind": "track",
  "ref": "track:1",
  "state": "进行",
  "lane": "赚钱",
  "dep": "",
  "doneWhen": "",
  "landing": "",
  "estimate": "",
  "category": "",
  "inspiration": "",
  "links": [],
  "source": "tracker",
  "title": "投资系统",
  "description": "主线数据底座还没收口。",
  "status": "in_progress",
  "progress": 45,
  "startDate": "2026-11-04",
  "endDate": "2026-12-08",
  "sortOrder": 0,
  "createdAt": "2026-11-14T07:30:12.345Z",
  "updatedAt": "2026-11-14T07:30:12.345Z",
  "number": "1",
  "hasChildren": true,
  "children": []
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | UUID assigned on create |
| `parentId` | string \| null | `null` at the root |
| `kind` | string | `track` \| `node` \| `task`; writable on create only |
| `ref` | string | stable external key; `''` for manual; writable on create only |
| `state` | string | normalized tracker state; read-only |
| `lane` | string | track lane; writable |
| `dep` | string | one prerequisite node id; writable |
| `doneWhen` | string | evidence pointer; writable |
| `landing` | string | repo-relative landing point; writable |
| `estimate` | string | effort as written in the tracker; writable |
| `category` | string | slot class; writable |
| `inspiration` | string | idea-store id; writable |
| `links` | array | `{ type, ref, label? }`; writable, replaced as a whole |
| `source` | string | `tracker` \| `manual`; read-only |
| `title` | string | 1–200 characters |
| `description` | string | may be empty |
| `status` | string | status vocabulary |
| `progress` | number | 0–100 |
| `startDate`, `endDate` | string | `YYYY-MM-DD` |
| `sortOrder` | number | sibling order, assigned on create/move |
| `createdAt`, `updatedAt` | string | ISO 8601 timestamps |
| `number` | string | *derived* hierarchical number |
| `hasChildren` | boolean | *derived* |
| `children` | array | *derived* child tasks, same shape |

## Read the tree

```sh
curl -s http://127.0.0.1:3080/api/gantt/tree
```

```json
{
  "ok": true,
  "today": "2026-11-15",
  "statuses": ["todo", "in_progress", "blocked", "done"],
  "stats": { "total": 54, "done": 12, "inProgress": 9, "blocked": 3, "overdue": 4, "progress": 22 },
  "brief": {
    "pending": 20,
    "frontier": [
      { "id": "…", "ref": "node:1.8.4", "number": "1.8.4", "title": "…", "trackId": "…", "trackName": "投资系统" }
    ],
    "next": [
      { "id": "…", "ref": "node:1.9.3", "number": "1.9.3", "title": "…", "trackId": "…", "trackName": "元能力" }
    ],
    "lanes": [
      {
        "id": "…",
        "ref": "track:1",
        "name": "投资系统",
        "lane": "赚钱",
        "state": "进行",
        "blocker": "…",
        "frontier": { "id": "…", "ref": "node:1.8.4", "number": "1.8.4", "title": "…" },
        "next": { "id": "…", "ref": "node:1.9.3", "number": "1.9.3", "title": "…" }
      }
    ]
  },
  "dailyBrief": { "date": "2026-11-15", "generatedAt": "2026-11-15T00:05:00.000Z", "source": "auto", "slots": ["…"], "items": ["…"], "tracks": ["…"], "unfilled": [], "notes": [] },
  "tasks": [
    {
      "id": "…",
      "parentId": null,
      "kind": "track",
      "ref": "track:1",
      "number": "1",
      "title": "投资系统",
      "state": "进行",
      "status": "in_progress",
      "progress": 45,
      "startDate": "2026-11-04",
      "endDate": "2026-12-08",
      "hasChildren": true,
      "children": [
        { "number": "1.1", "ref": "node:1.1", "kind": "node", "title": "数据底座", "status": "done", "progress": 100, "children": [] }
      ]
    }
  ]
}
```

`stats` counts every row in the unified tree — track roots, imported nodes, and
manual/decomposed tasks:

| Stat | Meaning |
| --- | --- |
| `total` | all rows in the tree |
| `done` | rows whose derived status is `done` |
| `inProgress` | rows whose derived status is `in_progress` |
| `blocked` | rows whose derived status is `blocked` |
| `overdue` | non-done rows whose `endDate` is before `today` |
| `progress` | `round(done / total * 100)`, `0` for an empty tree |

### `brief`

`brief` is the tracker-style frontier report, recomputed on every read and
never stored. Its rules are in
[personal-task-system.md](personal-task-system.md#frontier-and-next):

- `pending` — the number of pending leaves in the whole tree. A pending leaf
  has no children and `status` `todo` or `blocked`.
- `frontier` — at most one entry per track: the pending leaf with the highest
  dot id. A track with none contributes nothing.
- `next` — at most one entry per track: the pending leaf with the lowest dot id
  whose `dep` is empty or points at a done node.
- `lanes` — one row per track root with its raw `state` and `blocker` text and
  the same two entries (or `null`).

Entries carry `id`, `ref`, `number`, `title`, and — in `frontier`/`next` — the
owning `trackId` (track task id) and `trackName`. Ids compare by numeric dot
segment (`1.10` sorts after `1.9`); manual tasks without a `ref` sort last.
This `brief` is computed on every read; the separate, persisted daily report is
`dailyBrief`.

### `dailyBrief`

The tree response also carries today's persisted daily 该动 report as
`dailyBrief`; the day bundle carries the report for its date as `brief`. The
object is returned verbatim from the stored report. Its selection rules are in
[personal-task-system.md](personal-task-system.md#the-daily-brief-report); the
shape is:

```jsonc
{
  "date": "2026-11-16",                    // YYYY-MM-DD
  "generatedAt": "2026-11-16T00:05:00.000Z",
  "source": "auto",                        // auto | manual
  "dayKind": "workday",                    // workday | weekend | unknown
  "slots": [                               // windows, chronological; '' times last
    { "slot": "evening", "startTime": "21:00", "endTime": "22:00", "minutes": 60, "kind": "definition", "blockId": "2026-11-16|21:00|0" }
  ],
  "items": [                               // one picked task per filled window
    { "slot": "evening", "startTime": "21:00", "endTime": "22:00", "minutes": 60,
      "blockId": "2026-11-16|21:00|0", "taskId": "…", "ref": "node:1.8.1",
      "title": "S2 每日交易仓读数", "trackId": "…", "trackName": "投资系统", "role": "definition" }
  ],
  "tracks": [                              // per-track summary, track order
    { "trackId": "…", "ref": "track:1", "name": "投资系统", "state": "进行",
      "role": "core", "picks": 1, "frontier": null, "next": null }
  ],
  "unfilled": [],                          // slot indexes without a candidate
  "notes": []                              // short English diagnostics
}
```

- `slots` come from the day's plan blocks when it has any; otherwise from a
  day-kind template: `workday` has one `evening` 21:00-22:00 window, `weekend`
  has `morning` 09:00-12:00, `daytime` 14:00-18:00, and `evening` 19:00-21:30,
  and `unknown` with no blocks has no windows.
- Window `kind`: `core` for at least 120 minutes, `definition` under 90 minutes
  or with unknown times, `rotation` in between. `blockId` is the source plan
  block id, or `''` for a template window.
- `items` is one picked task per filled window; `role` is the role it was picked
  for. `tracks` reports each track's role (`core`, `rotation`, `blocked`, or
  `done`), its `picks`, and its frontier/next entries.
- `unfilled` lists the indexes of windows with no candidate; `notes` holds
  English diagnostics for the UI to ignore or show.

#### Read the daily brief

```sh
curl -s 'http://127.0.0.1:3080/api/gantt/brief?date=2026-11-16'
```

```json
{ "ok": true, "today": "2026-11-16", "date": "2026-11-16", "cached": true, "brief": { "date": "2026-11-16", "…": "…" } }
```

- `date` defaults to today; a blank value behaves like omitted; an invalid date
  is a `400`.
- A stored report is returned as-is with `cached: true`. When the requested
  date has no stored report, today's report is computed from the tree, the day
  plan, and the previous stored reports, persisted with `source: 'auto'`, and
  returned with `cached: false`. A past or future date with no stored report is
  computed on read and not persisted, so it reports `cached: false` too.

#### Recompute the daily brief

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/brief/compute \
  -H 'content-type: application/json' -d '{ "date": "2026-11-16" }'
```

```json
{ "ok": true, "today": "2026-11-16", "date": "2026-11-16", "cached": false, "brief": { "date": "2026-11-16", "source": "manual", "…": "…" } }
```

`date` is optional and defaults to today; the body must be a JSON object, so
send `{}` when there is nothing to override. The route recomputes the report,
stores it (replacing any earlier report for that date), marks it
`source: 'manual'`, and returns it; the host also recomputes automatically at
the next 08:00 in the task-day zone. An invalid date or malformed body is a
`400`.

## Focus one task

The right-hand **甘特** tab of the native conversation sidebar keeps one focused
task per conversation. The focus is persisted in SQLite and is what the host
assistant tools read, so a conversation can act on the task the user clicked.

### Read the focus

```sh
curl -s 'http://127.0.0.1:3080/api/gantt/focus?sessionId=<session-id>'
```

```json
{ "ok": true, "taskId": "0f0c1c2e-6f4a-4d1e-9f4a-1f0b2f5c8a11" }
```

`taskId` is `null` when the conversation has no focused task. `sessionId` is
required (1–200 characters, trimmed); a missing or blank value is a `400`
(`sessionId is required`), and an over-long one is a `400`.

### Set or clear the focus

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/focus/set \
  -H 'content-type: application/json' \
  -d '{ "sessionId": "<session-id>", "taskId": "0f0c1c2e-6f4a-4d1e-9f4a-1f0b2f5c8a11" }'
```

```json
{ "ok": true, "taskId": "0f0c1c2e-6f4a-4d1e-9f4a-1f0b2f5c8a11" }
```

- `sessionId` is required; the body must be a JSON object.
- `taskId` sets (or replaces) the focus and returns the canonical task id. A
  missing, `null`, or `''` `taskId` clears it and returns `taskId: null`.
- An unknown task id is a `404` (`task <id> was not found`); the focus row is
  stored with a foreign key and is deleted automatically when its task is
  deleted.
- Focus is per conversation, survives a host restart (it lives in the
  `focus` table), and does not affect other conversations.

## Task trajectory

Every task keeps an append-only provenance trail in `task_events`: which DSH
conversation and turn created, updated, completed, or decomposed it. The
assistant tools write these events automatically; this read route exposes them
for dashboards and follow-up conversations.

```sh
curl -s 'http://127.0.0.1:3080/api/gantt/trajectory?taskId=<task-id>'
curl -s 'http://127.0.0.1:3080/api/gantt/trajectory?sessionId=<session-id>&limit=5'
curl -s 'http://127.0.0.1:3080/api/gantt/trajectory?limit=100'
```

```json
{
  "ok": true,
  "events": [
    {
      "id": "…",
      "taskId": "0f0c1c2e-6f4a-4d1e-9f4a-1f0b2f5c8a11",
      "sessionId": "session-abc",
      "turn": 7,
      "action": "complete",
      "detail": "已收口，读数表进日报",
      "at": "2026-11-16T07:12:00.000Z"
    }
  ]
}
```

| Query | Meaning |
| --- | --- |
| `taskId` | Only events for one task. An unknown task id is a `404`. |
| `sessionId` | Only events recorded by one conversation |
| `limit` | Maximum events; default `20`, integer 1–100 (blank uses the default); anything else is a `400` |

- Events are newest first.
- With no filter the route returns the most recent events across all tasks;
  filters may be combined to narrow the result.
- `action` is `create`, `update`, `complete`, `decompose`, or `track`; `detail` carries
  the tool's optional `summary` when supplied, otherwise a short generated
  description of the write.
- `sessionId` and `turn` identify the DSH conversation and the tool-call turn
  that produced the change (`turn` can be `null` when the host cannot read the
  durable turn index); `at` is the event's ISO timestamp. Events are created
  only by assistant-tool writes; they are not editable and are deleted with
  their task (`ON DELETE CASCADE`).
- An invalid `limit` is a `400`; an unknown `taskId` is a `404`.

## Work mode

Work mode turns a task-row click into "open this task's dedicated main
conversation": one task owns one real DSH session in the work workspace, stored
durably in `work_sessions` (`task_id` primary key, unique `session_id`,
`created_at`/`updated_at` stamps). The mapping is separate from the
per-conversation focus: a conversation keeps its focus, while a task keeps its
dedicated conversation across host restarts. The work directory is
`DSH_GANTT_WORK_CWD` (default `/data/home/ws-plugin`), trimmed; a blank value
falls back to the default.

### Read the work context

```sh
curl -s 'http://127.0.0.1:3080/api/gantt/work?taskId=<task-id>'
curl -s 'http://127.0.0.1:3080/api/gantt/work?sessionId=<session-id>'
```

```json
{
  "ok": true,
  "cwd": "/data/home/ws-plugin",
  "task": {
    "id": "0f0c1c2e-6f4a-4d1e-9f4a-1f0b2f5c8a11",
    "number": "1.8.1",
    "ref": "",
    "title": "写验收用例",
    "status": "in_progress",
    "progress": 40,
    "doneWhen": "HTTP 与 e2e 全绿"
  },
  "sessionId": "session-abc"
}
```

- `taskId` wins when both parameters are given; an unknown task id is a `404`
  (`task <id> was not found`).
- With only `sessionId`, the route resolves the conversation's focused task
  (`GET /api/gantt/focus`) and then the task whose dedicated conversation it is
  (`work_sessions`); an unbound conversation returns `task: null`.
- Neither parameter, or two blank values, is a `400`
  (`taskId or sessionId is required`); an over-long conversation id is a `400`
  (`sessionId must be at most 200 characters`).
- `task` is `null` or `{ id, number, ref, title, status, progress, doneWhen }`,
  where `number` is the rendered dotted number; `sessionId` is that task's
  dedicated conversation, or `null` when it has none.

### Bind a task to its conversation

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/work/session \
  -H 'content-type: application/json' \
  -d '{ "taskId": "<task-id>", "sessionId": "<session-id>" }'
```

```json
{ "ok": true, "taskId": "0f0c…", "sessionId": "session-abc" }
```

The route writes the mapping and sets that conversation's focus to the task in
one transaction. Rebinding a task replaces its conversation; binding a
conversation that already belongs to another task moves it (the old row is
deleted). `taskId` is required (`400 taskId is required`), the conversation id
follows the focus rules (`400 sessionId is required`, at most 200 characters),
and an unknown task is a `404`. The row is deleted with its task
(`ON DELETE CASCADE`).

### Workbench services

`GET /api/gantt/work/skills` reads the optional host `skills` service and calls
`skills.list()`; it answers `{ ok: true, available, skills: [{ name,
description, source }] }`, with `available: false` and `skills: []` when the
service is absent. A service rejection is a `500` carrying the service's
message.

`GET /api/gantt/work/team?sessionId=<dedicated-conversation-id>` reads the
optional host `subagents` service and calls `listChildren(sessionId)`; it
answers `{ ok: true, available, agents: [{ id, label, mode, createdAt }] }`.
`label` defaults to `''` and `mode` is `continuable`, `one-shot`, `external`, or
`unknown` (an unrecognized mode reads `unknown`). A missing or blank
`sessionId` is a `400`; an absent service answers `available: false` and
`agents: []`; a service rejection answers `200` with `available: true`,
`agents: []`, and an `error` message. Both routes degrade to
`available: false` when the host has no service seam, so a headless profile
keeps working; the workbench tab renders the unavailable state.

## Read metadata

```sh
curl -s http://127.0.0.1:3080/api/gantt/meta
```

```json
{
  "ok": true,
  "dbPath": "/home/you/.dsh/gantt/tasks.db",
  "statuses": ["todo", "in_progress", "blocked", "done"],
  "kinds": ["track", "node", "task"],
  "linkTypes": ["memory", "file", "url", "task", "note"],
  "schemaVersion": 6,
  "taskCount": 54,
  "engine": "node:sqlite",
  "endpoints": [
    { "method": "GET", "path": "/api/gantt/tree", "description": "Read the hierarchical task tree with numbers, rollups, and stats." }
  ]
}
```

`dbPath` is the resolved absolute path (`:memory:` for an in-memory store);
`endpoints` is the host's own twenty-three-entry route catalog (abbreviated above);
`taskCount` counts every row of the unified tree.

## Create a task

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/tasks \
  -H 'content-type: application/json' \
  -d '{
    "title": "写验收用例",
    "parentId": null,
    "startDate": "2026-11-07",
    "endDate": "2026-11-10",
    "status": "todo",
    "progress": 0,
    "description": "覆盖拆分与状态流转",
    "lane": "赚钱",
    "doneWhen": "验收用例覆盖拆解与排期路由",
    "landing": "tests/host/routes-write.spec.js",
    "links": [{ "type": "file", "ref": "tests/host/routes-write.spec.js" }]
  }'
```

`201 Created`:

```json
{ "ok": true, "task": { "id": "…", "parentId": null, "number": "3", "title": "写验收用例", "…": "…" } }
```

- `title` is required; `parentId` must reference an existing task or be `null`.
- Dates default to today through today + 3 days; `endDate` defaults to
  `startDate + 3 days`.
- `status` defaults to `todo`; `progress` defaults from the status
  (`done` → 100, `todo` → 0, `blocked` → 0, `in_progress` → 50).
- `kind` defaults to `task`; `ref` defaults to `''`. Supplying a non-empty `ref`
  that already exists for the same `kind` is a `409`.
- The new task is appended after its siblings and ancestor rollups are
  recomputed.

## Update a task

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/task/update \
  -H 'content-type: application/json' \
  -d '{ "id": "<task-id>", "title": "新标题", "parentId": "<parent-id>", "doneWhen": "…" }'
```

```json
{ "ok": true, "task": { "id": "…", "number": "2.1", "title": "新标题", "…": "…" } }
```

- `id` is required; every other field is optional. Unknown fields are ignored.
- `ref` and `kind` are not writable here; a supplied `ref` is ignored.
- `links`, when supplied, replaces the array as a whole.
- `parentId: null` (or `""`) moves the task to the root. Moving a task under one
  of its own descendants, or under itself, is rejected.
- A move re-numbers both affected branches and appends the task after its new
  siblings.
- Status/progress pairing:
  - `status` alone maps progress (`done` → 100, `todo` → 0, `blocked` keeps the
    current progress, `in_progress` keeps a current value in 1–99 else 50).
  - `progress` alone derives status (`100` → `done`, `0` → `todo`, otherwise
    `in_progress`, except a currently `blocked` task stays `blocked`).
  - Both supplied are stored as given.
- Ancestor rollups are recomputed for the old and the new parent.

## Change status

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/task/status \
  -H 'content-type: application/json' \
  -d '{ "id": "<task-id>", "status": "in_progress", "progress": 40 }'
```

```json
{ "ok": true, "task": { "id": "…", "status": "in_progress", "progress": 40, "…": "…" } }
```

`status` is required and must be in the vocabulary; `progress` is optional and
follows the same pairing rules as `update`.

## Split into subtasks

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/task/split \
  -H 'content-type: application/json' \
  -d '{
    "id": "<task-id>",
    "children": [
      { "title": "子任务 A", "startDate": "2026-11-07", "endDate": "2026-11-08" },
      { "title": "子任务 B", "startDate": "2026-11-09", "endDate": "2026-11-10", "doneWhen": "…" }
    ]
  }'
```

```json
{
  "ok": true,
  "parent": { "id": "…", "status": "todo", "progress": 0, "startDate": "2026-11-07", "endDate": "2026-11-10", "hasChildren": true, "…": "…" },
  "children": [
    { "id": "…", "number": "1.1", "title": "子任务 A", "…": "…" },
    { "id": "…", "number": "1.2", "title": "子任务 B", "…": "…" }
  ]
}
```

- `children` must be a non-empty array of at most 100 objects.
- Each child's `title` is required; dates default to the parent's date range;
  `status` defaults to `todo`; `progress` defaults from the status.
- Children accept the metadata fields (`lane`, `dep`, `doneWhen`, `landing`,
  `estimate`, `category`, `inspiration`, `links`) but not `kind`/`ref`.
- Children are appended after any existing children; the parent's range,
  progress, and status roll up from all of them, and ancestor rollups are
  recomputed.

## Decompose a node

`POST /api/gantt/task/decompose` creates child tasks for a node and, optionally,
a plan block for each child — in one transaction. It is the UI's **decompose**
action; the discipline behind the inputs is in
[personal-task-system.md](personal-task-system.md#decomposition-discipline).

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/task/decompose \
  -H 'content-type: application/json' \
  -d '{
    "id": "<parent-id>",
    "planDate": "2026-11-16",
    "children": [
      {
        "title": "S2 每日交易仓读数",
        "description": "把本周读数收成一张表",
        "doneWhen": "新标的有可执行档位表",
        "landing": "invest/strategy-ledger.md",
        "estimate": "2h",
        "category": "A 主攻片",
        "dep": "1.8.1",
        "links": [{ "type": "memory", "ref": "key/个人任务系统", "label": "系统记忆" }],
        "plan": { "date": "2026-11-16", "startTime": "21:00", "endTime": "22:00", "inspiration": "#21" }
      }
    ]
  }'
```

`200 OK`:

```json
{
  "ok": true,
  "parent": { "id": "…", "status": "todo", "progress": 0, "hasChildren": true, "…": "…" },
  "children": [
    { "id": "…", "kind": "task", "ref": "", "source": "manual", "number": "1.8.1.1", "title": "S2 每日交易仓读数", "…": "…" }
  ],
  "blocks": [
    { "id": "task|<child-id>|2026-11-16", "planDate": "2026-11-16", "slot": "evening", "title": "S2 每日交易仓读数", "source": "task", "sourceRef": "task:<child-id>", "…": "…" }
  ]
}
```

Request fields:

| Field | Required | Default |
| --- | --- | --- |
| `id` | yes | — parent task id |
| `planDate` | no | the child dates' fallback date |
| `children` | yes | 1–100 child objects |
| `children[].title` | yes | 1–200 characters |
| `children[].description` | no | `''` |
| `children[].startDate` | no | `planDate`, else the parent's start |
| `children[].endDate` | no | `startDate + 3 days`; without `planDate`, the parent's end |
| `children[].status` | no | `todo` |
| `children[].progress` | no | from the status |
| `children[].doneWhen`, `landing`, `dep`, `estimate`, `category`, `inspiration`, `links` | no | empty / `[]` |
| `children[].plan` | no | no block is created |
| `children[].plan.date` | yes, when `plan` is given | — |
| `children[].plan.startTime`, `endTime` | no | `''` |
| `children[].plan.slot` | no | derived from `startTime` (`<10:00` morning, `<19:30` daytime, `≥19:30` evening, no time `other`) |
| `children[].plan.category`, `landing`, `estimate`, `inspiration` | no | inherited from the child's matching field |

Behavior:

- `planDate` is only a date default: it fills a child's `startDate`/`endDate`
  when they are omitted and never creates a block by itself. A child is
  scheduled only when its own `plan` object is present, and that object must
  carry a `date`.
- Every child is created as `kind='task'`, `source='manual'`, `ref=''`, and is
  appended after the parent's existing children. The parent's rollups are
  recomputed.
- A plan block is created only when the child carries a `plan`. Its title is the
  child title, its detail is `description || doneWhen`, its `source` is `task`,
  its `sourceRef` is `task:<childId>`, and it is appended to the end of that
  day's order.
- The parent's depth is checked first: decomposing a parent already at the
  4-level cap is a `400` with `decompose would exceed 4 levels`.
- Writes happen in one `BEGIN IMMEDIATE` transaction, and every child is
  validated before the first write: an invalid child or plan leaves no partial
  tree and no partial block.
- `400` for validation failures (title, dates, status, links, depth, more than
  100 children); `404` for an unknown parent id.

## Schedule a node

`POST /api/gantt/task/schedule` places an existing tree node into one day's plan
as a `source='task'` block. The block id is deterministic, so re-scheduling the
same task on the same day updates the existing block — the route is idempotent.

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/task/schedule \
  -H 'content-type: application/json' \
  -d '{
    "id": "<task-id>",
    "date": "2026-11-16",
    "startTime": "21:00",
    "endTime": "22:00",
    "slot": "evening"
  }'
```

```json
{
  "ok": true,
  "task": { "id": "…", "number": "1.8.1", "landing": "invest/strategy-ledger.md", "…": "…" },
  "block": {
    "id": "task|<task-id>|2026-11-16",
    "planDate": "2026-11-16",
    "startTime": "21:00",
    "endTime": "22:00",
    "slot": "evening",
    "title": "S2 每日交易仓读数",
    "detail": "新标的有可执行档位表",
    "landing": "invest/strategy-ledger.md",
    "estimate": "2h",
    "category": "A 主攻片",
    "inspiration": "#21",
    "status": "todo",
    "source": "task",
    "sourceRef": "task:<task-id>"
  }
}
```

- `id` and `date` are required; `date` must be a real calendar day.
- Block defaults: `title` is the task title; `detail` is `doneWhen`; `landing`,
  `estimate`, `category`, and `inspiration` are inherited from the task. Any
  field supplied in the body overrides the inherited value.
- `slot` is derived from `startTime` when omitted, with the same thresholds as
  decompose.
- Errors: `400` for a missing/invalid date or an invalid field; `404` for an
  unknown task.

## Export model context

`GET /api/gantt/context` renders the tree, a day's plan, and the day's daily-brief
windows as stable markdown for model context. The export is read-only and
deterministic; the full rationale is in
[personal-task-system.md](personal-task-system.md#context-export).

```sh
curl -s 'http://127.0.0.1:3080/api/gantt/context?date=2026-11-15&limit=12000'
```

```json
{
  "ok": true,
  "date": "2026-11-15",
  "markdown": "# 个人任务树（6 条支线 · 48 个节点 · 3 个任务）\n## 1. 投资系统（赚钱 · 进行 · 卡住：…）\n- 1.1 数据底座… [done 已过] 2026-07-01→2026-09-30 · 落点 … · 完成标准 … · 依赖 1.8.1 · 链接 memory:…\n  - 1.8.1 S2 每日交易仓读数… [in_progress 进行] …\n\n## 今日 2026-11-15（周日 · 周末 · 休市）\n- 核心目标：…\n- [todo] 09:00-17:00 主攻片 · 1.8.1 读数收口 · 落点 invest/… · 预估 4h · 灵感 #21\n\n## 完整性提示\n- landing-missing: 2026-11-15|09:00|0\n\n## 今日窗口 · 2026-11-15\n- 09:00-17:00 core：投资系统 1.8.1 读数收口\n- 21:00-22:00 definition：未填\n",
  "chars": 3812,
  "truncated": false,
  "counts": { "tracks": 6, "nodes": 48, "tasks": 3, "blocks": 4 }
}
```

Query parameters:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `date` | today | The day section's date; must be a real calendar day |
| `root` | whole tree | Export only this task's subtree |
| `limit` | `12000` | Maximum `markdown` length in characters, 1000–60000 |

- The `## 今日窗口 · YYYY-MM-DD` section lists the daily-brief windows for
  `date`: one line per window as `HH:MM-HH:MM role：trackName ref title`, with
  `未填` for a window without a candidate. It is appended after the integrity
  section and is trimmed by the same `limit`.
- `chars` is the returned markdown length; `counts` counts each kind in the
  exported range plus the day's blocks. The title line omits a segment whose
  count is zero (a tree with no decomposed tasks has no `0 个任务` segment).
- `limit` is an integer from 1000 to 60000 (default 12000); an out-of-range or
  non-integer value is a `400`.
- Over `limit` the export drops the deepest nodes first, then the oldest day
  detail, sets `truncated: true`, and still returns valid markdown.
- Errors: `400` for an invalid `date` or an out-of-range `limit`; `404` for an
  unknown `root` task id.

## Delete a task

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/task/delete \
  -H 'content-type: application/json' \
  -d '{ "id": "<task-id>" }'
```

```json
{ "ok": true, "id": "…", "parentId": "…" }
```

Deletes the task and all of its descendants (foreign-key cascade) in one
transaction, then recomputes the former parent's rollups. `parentId` is `null`
when the deleted task was a root.

## Seed demo data

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/seed \
  -H 'content-type: application/json' -d '{}'
```

The route is a no-op unless the database is empty:

```json
{ "ok": true, "seeded": true, "taskCount": 13, "today": "…", "statuses": ["…"], "tasks": [ { "…": "…" } ], "stats": { "…": "…" } }
```

When rows already exist it returns only `{ "ok": true, "seeded": false,
"taskCount": <existing count> }`. The seeded database holds 13 manual tasks (two
root projects and their subtrees), which read back as
`stats:{total:13,done:2,inProgress:4,blocked:2,overdue:0,progress:15}` on the day
it was seeded.

## Read a day plan

```sh
curl -s 'http://127.0.0.1:3080/api/gantt/day?date=2026-11-15'
```

`date` is optional and defaults to the task-day today; a blank value behaves
like omitted. One bundle carries everything the Today page renders: the day's
plan metadata, its time blocks, the unified-tree nodes whose window overlaps the
day and the following six days, the six tracks, derived integrity warnings,
block stats, and the daily 该动 report as `brief`.

```json
{
  "ok": true,
  "today": "2026-11-15",
  "date": "2026-11-15",
  "day": {
    "date": "2026-11-15",
    "weekday": "周日",
    "dayKind": "weekend",
    "marketOpen": false,
    "label": "周末（休市）· 主攻片（≥4h）",
    "coreGoal": "上午把 1.8.1 这一周的读数收成一张表…",
    "source": "schedule"
  },
  "blocks": [
    {
      "id": "2026-11-15|09:00|0",
      "planDate": "2026-11-15",
      "startTime": "09:00",
      "endTime": "17:00",
      "slot": "morning",
      "category": "A 主攻片（① 投资系统 · 1.8 策略实盘化）",
      "title": "1.8.1 S2 每日交易仓读数收口",
      "detail": "…",
      "landing": "easy_tdx（1.8.1 board/features 消费侧…）",
      "estimate": "≥4h",
      "inspiration": "",
      "status": "todo",
      "notes": "",
      "sortOrder": 0,
      "source": "schedule",
      "sourceRef": "SCHEDULE.md"
    },
    {
      "id": "task|<task-id>|2026-11-15",
      "planDate": "2026-11-15",
      "slot": "evening",
      "title": "S2 每日交易仓读数",
      "source": "task",
      "sourceRef": "task:<task-id>",
      "…": "…"
    }
  ],
  "nodes": [
    {
      "id": "<task-id>",
      "ref": "node:1.8.1",
      "kind": "node",
      "trackId": "<track-task-id>",
      "title": "S2 每日交易仓读数",
      "state": "未开始",
      "startDate": "2026-11-09",
      "endDate": "2026-11-15",
      "dep": "",
      "doneWhen": "每天一句读数 + 三条腿各一个数",
      "landing": "",
      "estimate": "",
      "category": "",
      "inspiration": "",
      "links": []
    }
  ],
  "tracks": [
    { "id": "<track-task-id>", "ref": "track:1", "name": "投资系统", "lane": "赚钱", "priority": "", "state": "进行", "blocker": "…", "sortOrder": 0 }
  ],
  "integrity": [{ "code": "inspiration-missing", "blockId": "2026-11-15|21:00|1" }],
  "stats": { "total": 2, "done": 0, "inProgress": 0, "skipped": 0, "remaining": 2 },
  "brief": { "date": "2026-11-15", "source": "auto", "slots": ["…"], "items": ["…"], "tracks": ["…"], "unfilled": [], "notes": [] }
}
```

- `blocks[].source` is `schedule` (imported) or `task` (created by decompose or
  schedule). Re-import rewrites only `schedule` blocks; task blocks and every
  block's `status`/`notes` survive.
- `nodes` and `tracks` are derived from the unified tree, not from the snapshot
  tables. Identity fields share one id space: `tracks[].id` is the track task
  id, `tracks[].ref` is its external key (`track:3`), and `nodes[].trackId` is
  the parent track's **task id** (the same value as `tracks[].id`, empty when
  the node has no track ancestor), not the Hermes numeric track id.
  `nodes[].id` is the node task id. The node list is capped at 12 rows and
  sorted by start date. The shapes are backward compatible with the v2 bundle
  plus the fields shown above. Imported nodes carry `state`, `lane`, `dep`, and
  `doneWhen`; `landing`, `estimate`, `category`, `inspiration`, and `links` are
  plugin-side fields and are empty until annotated through an update or a
  decomposition.
- `brief` is the daily 该动 report for that date (the same object as the
  `GET /api/gantt/brief` response's `brief`); only today's report is persisted,
  so a past or future date returns a freshly computed report that is not stored.
- `day` is `null` when the date has no imported plan row. `blocks` is then `[]`,
  and `integrity` carries `unplanned-day`.

Integrity codes name a rule from the source tracker, not a validation error:

| Code | Meaning |
| --- | --- |
| `landing-missing` | a block has no landing target (the tracker rule is "no landing point = not scheduled") |
| `evening-missing` | the day has no block in the evening slot (the fixed 21:00-22:00 slot) |
| `inspiration-missing` | an evening block carries no inspiration id (`#12`, `#19.1`, …) |
| `unplanned-day` | the day has no imported plan row |

`stats` counts plan blocks: `total`, `done`, `inProgress`, `skipped`, and
`remaining` (`total - done - skipped`).

## Set a plan block status

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/plan/status \
  -H 'content-type: application/json' \
  -d '{ "id": "2026-11-15|21:00|1", "status": "done", "notes": "列了 3 条可交 agent 的任务" }'
```

```json
{ "ok": true, "block": { "id": "2026-11-15|21:00|1", "status": "done", "notes": "…", "…": "…" } }
```

- `status` must be a plan status; `notes` is optional and capped at 500
  characters (an absent or `null` value leaves the stored notes untouched).
- An unknown block id is `404`.
- The route works for any block source, including task blocks; re-importing the
  tracker rewrites imported block content but keeps `status` and `notes`, so a
  marked block stays marked.

## Import the task tracker

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/plan/import \
  -H 'content-type: application/json' -d '{}'
```

```json
{ "ok": true, "dir": "/data/home/clawd/projects/task-tracker", "imported": { "tracks": 6, "nodes": 48, "days": 9, "blocks": 27 } }
```

- The body must be a JSON object, so send `{}` when there is nothing to
  override. `dir` overrides the tracker directory and must be an absolute path;
  the default is `$DSH_GANTT_TRACKER_DIR`, else
  `/data/home/clawd/projects/task-tracker`.
- The import is read-only on the tracker side (no markdown is ever written) and
  idempotent. In one transaction it replaces the `tracks`/`nodes` snapshots,
  upserts the days and their blocks, and materializes the snapshots into the
  unified tree: new `(kind, ref)` rows are inserted, existing ones are updated,
  and a stale imported leaf with no children is removed. Manual tasks and
  manually scheduled blocks are never touched.
- A tracker row whose `ref` disappeared from the markdown but that has children
  (a decomposition the user added) survives, so the imported tree never loses
  user work.
- `year` (optional, integer 1970–9999) pins the year assumed for the
  `MM/DD` day headings when the file's window note does not settle it.
- A missing or unreadable directory is a `400`.

## Assistant tools

The host registers five tools on the DSH **tools service** so a native
conversation can read the task tree and write task changes directly. The plugin
does not call an LLM itself: the model is the normal DSH conversation, the tool
schemas are the ones below, and every write goes through the store's validation
and transaction path. Each tool write also records provenance automatically —
one `task_events` row per affected task, carrying the DSH session id, the turn
index of the tool call, the action, and the optional `summary`. If the host has
no tools service, registration is a no-op and the rest of the plugin keeps
working.

Every tool resolves a task reference the same way: the internal task id, the
external `ref` (`node:1.8.1`, `track:1`), or the rendered dotted number
(`1.1.1`). An unusable reference is a `400` (`id is required`); an id that
matches nothing is a `404` (`task <id> was not found`). Tool failures keep the
`GanttError` status (`400` validation, `404` missing task) and are surfaced to
the model by the harness; they are not HTTP responses.

### `gantt_context`

Read the task context for the calling conversation.

| | |
| --- | --- |
| Parameters | none |
| Returns | `{ ok: true, markdown: string }` |

The conversation id comes from the tool execution context, not from an
argument. When the conversation has a focused task the markdown contains the
chain from the track root to that task (kind, status, `doneWhen` per row), the
task's dotted id, internal id, title, depth (and whether the 4-level cap has
been reached), its status and `doneWhen`, and its direct children. It also
includes a `## 任务轨迹（会话与轮次）` section listing recent trajectory events
newest first, each with the full session id and turn, so the model can see how
the task reached its current state. With no focus, the tool falls back to the whole-tree
context document, capped at 6000 characters.

### `gantt_decompose`

Create child tasks under one task.

| Parameter | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Parent task: internal id, `ref`, or dotted number |
| `planDate` | no | `YYYY-MM-DD`; only a default for the children's start/end dates |
| `summary` | no | Short note stored as the event detail |
| `children` | yes | 1–100 child objects |
| `children[].title` | yes | 1–200 characters |
| `children[].doneWhen` | yes | Verifiable completion standard |
| `children[].estimate`, `category`, `landing`, `inspiration` | no | Optional metadata strings |
| `children[].status` | no | `todo` (default), `in_progress`, `blocked`, or `done` |

Returns `{ ok: true, message: string }` listing the created children with their
dotted ids and `doneWhen`. The store enforces the same rules as
`POST /api/gantt/task/decompose`: the 4-level cap, at most 100 children, valid
dates/status, and one atomic transaction. The call records a `decompose` event
on the parent and a `create` event on each child.

### `gantt_update_task`

Update one task's fields.

| Parameter | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Task: internal id, `ref`, or dotted number |
| `status` | no | New status vocabulary value |
| `progress` | no | 0–100 |
| `title` | no | New title |
| `doneWhen` | no | New completion standard |
| `summary` | no | Short note stored as the event detail |

Returns `{ ok: true, message: string }` with the updated task's ref/number,
title, status label, and progress. At least one of `status`/`progress`/`title`/
`doneWhen` is required (`400 nothing to update`); an unknown task is a `404`.
Status/progress follow the same pairing rules as the HTTP update route. The call
records an `update` event, or a `complete` event when the task is marked done.

### `gantt_track`

Record the current round against one task without writing the task tree.

| Parameter | Required | Meaning |
| --- | --- | --- |
| `id` | no | Task: internal id, `ref`, or dotted number; omitted -> the conversation's focused task |
| `summary` | yes | What the round did; stored as the `track` event detail |

Returns `{ ok: true, message: string }` naming the task and the recorded turn.
With no `id` and no focused task the call is a `400` (`id is required when this
conversation has no focused task`); a blank `summary` is a `400` (`summary is
required`). The event carries the calling conversation id and turn, so a round
that only reviewed, analyzed, or answered still shows up in the trajectory.

### `gantt_create_task`

Create a task as the immediate next sibling of the reference task.

| Parameter | Required | Meaning |
| --- | --- | --- |
| `id` | no | Reference task: internal id, `ref`, or dotted number; omitted -> the focused task |
| `title` | yes | 1–200 characters |
| `doneWhen` | no | Verifiable completion standard |
| `description` | no | Optional note |
| `status` | no | `todo` (default), `in_progress`, `blocked`, or `done` |
| `startDate`, `endDate` | no | `YYYY-MM-DD`; default today and today + 3 days |

Returns `{ ok: true, message: string }` naming the reference and the new
sibling's dotted number. The new row is inserted right after the reference,
later siblings shift down one position, and ancestor rollups are recomputed in
one transaction. The call records a `create` event on the new task, and — when
it comes from a conversation — a `track` event on the reference with detail
`sibling task <reference> <title>`.

The tools are registered globally on the host, but the context they read is
per conversation: the focus row keyed by the conversation id is what
`gantt_context` resolves, and it is what the right-rail tab writes when a row is
clicked. Writes do not trigger an approval prompt: they are ordinary store
calls over SQLite, not shell or filesystem work.

### Background context

When the host has the optional `systemPrompt` service, the plugin contributes two
prompt pieces so a conversation knows how to advance tasks without being asked:

- a **static section** named `gantt:protocol` at order `700`, describing the
  work mode protocol: the conversation is the focused task's content-dedicated
  main conversation, and every round must close with exactly one of
  `gantt_track` (no task write), `gantt_update_task` (advanced/completed/
  blocked), `gantt_decompose` (new subtasks), or `gantt_create_task` (a new
  sibling); a text-only round ending is not allowed. Provenance is recorded
  automatically;
- a **dynamic runtime context** named `gantt:focus` at order `530`, emitted only
  when the conversation has a focused task. It carries the focused task's
  ancestor chain (ref, title, kind, status, `doneWhen`), the focus detail, and
  the task's recent trajectory.

The plugin declares the dependency lazily through `ctx.inject(['systemPrompt'],
…)`; without that service it registers nothing and the tools/API keep working.
The runtime context is a durable context snapshot: DSH appends a new snapshot
only when the rendered text changes, so an unchanged focus keeps the prompt
cache prefix stable.

## Errors

All failures are JSON with a `4xx`/`5xx` status:

```json
{ "ok": false, "error": "task 0f0c… was not found" }
```

| Status | Cause | Example `error` |
| --- | --- | --- |
| `400` | malformed JSON body | `request body must be valid JSON` |
| `400` | body is not a JSON object | `request body must be a JSON object` |
| `400` | missing/invalid field | `title is required`, `status must be one of todo, in_progress, blocked, done`, `endDate must not be before startDate` |
| `400` | invalid links | `links must be an array`, `links[0].type must be one of memory, file, url, task, note` |
| `400` | hierarchy violation | `a task cannot be its own parent`, `a task cannot move under one of its descendants` |
| `400` | decomposition depth cap | `decompose would exceed 4 levels` |
| `400` | invalid plan/import/context/brief input | `date must be a YYYY-MM-DD date`, `date is not a valid calendar day`, `dir must be an absolute path`, `notes must be at most 500 characters`, `limit must be an integer from 1000 to 60000` |
| `400` | invalid focus input | `sessionId is required`, `sessionId must be at most 200 characters` |
| `400` | invalid trajectory input | `limit must be an integer from 1 to 100`, `sessionId must be at most 200 characters` |
| `400` | invalid work input | `taskId or sessionId is required`, `taskId is required`, `sessionId is required` |
| `404` | unknown task id | `task <id> was not found` |
| `404` | unknown plan block id | `plan block <id> was not found` |
| `409` | duplicate `(kind, ref)` | `task with kind node and ref node:1.8.1 already exists` |
| `500` | the optional skills service rejected | the service's message |
| `500` | unexpected host failure | the thrown error's message |

A wrong method or an unknown path is left to the harness's `/api` dispatch (it
is not handled by this plugin), so it does not return this error shape.
