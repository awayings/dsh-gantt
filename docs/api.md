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
- The schema is version 3: one working tree in `tasks` (track roots, imported
  nodes, decomposed and manual tasks). The domain model is in
  [personal-task-system.md](personal-task-system.md); the migration in
  [compatibility.md](compatibility.md).

Base URL: the origin printed by your own `dsh web` launch, for example
`http://127.0.0.1:3080`.

## Routes

| Method | Path | Body / Query | Success |
| --- | --- | --- | --- |
| `GET` | `/api/gantt/tree` | — | `200` tree, `brief`, numbers, rollups, stats |
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

Routes that read a body require a JSON object; any other JSON value is
rejected with `400`. `GET` routes and `seed` do not read a body.

## Conventions

- **Dates** are `YYYY-MM-DD` and must be real calendar days. `endDate` MUST not
  be before `startDate`.
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
  "schemaVersion": 3,
  "taskCount": 54,
  "engine": "node:sqlite",
  "endpoints": [
    { "method": "GET", "path": "/api/gantt/tree", "description": "Read the hierarchical task tree with numbers, rollups, and stats." }
  ]
}
```

`dbPath` is the resolved absolute path (`:memory:` for an in-memory store);
`endpoints` is the host's own fourteen-entry route catalog (abbreviated above);
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
    "doneWhen": "验收用例覆盖 v3 的三条新路由",
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

`GET /api/gantt/context` renders the tree and a day's plan as stable markdown for
model context. The export is read-only and deterministic; the full rationale is
in [personal-task-system.md](personal-task-system.md#context-export).

```sh
curl -s 'http://127.0.0.1:3080/api/gantt/context?date=2026-11-15&limit=12000'
```

```json
{
  "ok": true,
  "date": "2026-11-15",
  "markdown": "# 个人任务树（6 条支线 · 48 个节点 · 3 个任务）\n## 1. 投资系统（赚钱 · 进行 · 卡住：…）\n- 1.1 数据底座… [done 已过] 2026-07-01→2026-09-30 · 落点 … · 完成标准 … · 依赖 1.8.1 · 链接 memory:…\n  - 1.8.1 S2 每日交易仓读数… [in_progress 进行] …\n\n## 今日 2026-11-15（周日 · 周末 · 休市）\n- 核心目标：…\n- [todo] 09:00-17:00 主攻片 · 1.8.1 读数收口 · 落点 invest/… · 预估 4h · 灵感 #21\n## 完整性提示\n- landing-missing: 2026-11-15|09:00|0\n",
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

`date` is optional and defaults to the host's today; a blank value behaves like
omitted. One bundle carries everything the Today page renders: the day's plan
metadata, its time blocks, the unified-tree nodes whose window overlaps the day
and the following six days, the six tracks, derived integrity warnings, and
block stats.

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
  "stats": { "total": 2, "done": 0, "inProgress": 0, "skipped": 0, "remaining": 2 }
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
| `400` | invalid plan/import/context input | `date must be a YYYY-MM-DD date`, `date is not a valid calendar day`, `dir must be an absolute path`, `notes must be at most 500 characters`, `limit must be an integer from 1000 to 60000` |
| `404` | unknown task id | `task <id> was not found` |
| `404` | unknown plan block id | `plan block <id> was not found` |
| `409` | duplicate `(kind, ref)` | `task with kind node and ref node:1.8.1 already exists` |
| `500` | unexpected host failure | the thrown error's message |

A wrong method or an unknown path is left to the harness's `/api` dispatch (it
is not handled by this plugin), so it does not return this error shape.
