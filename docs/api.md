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

Base URL: the origin printed by your own `dsh web` launch, for example
`http://127.0.0.1:3080`.

## Routes

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| `GET` | `/api/gantt/tree` | — | `200` tree, numbers, rollups, stats |
| `GET` | `/api/gantt/meta` | — | `200` database path, statuses, endpoint catalog |
| `POST` | `/api/gantt/tasks` | `{ title, parentId?, startDate?, endDate?, status?, progress?, description? }` | `201` created task |
| `POST` | `/api/gantt/task/update` | `{ id, title?, description?, parentId?, startDate?, endDate?, status?, progress? }` | `200` updated task |
| `POST` | `/api/gantt/task/status` | `{ id, status, progress? }` | `200` updated task |
| `POST` | `/api/gantt/task/split` | `{ id, children: [{ title, startDate?, endDate?, status?, progress?, description? }] }` | `200` parent + created children |
| `POST` | `/api/gantt/task/delete` | `{ id }` | `200` deleted id + its former parent |
| `POST` | `/api/gantt/seed` | `{}` (body ignored) | `200` seed result, plus snapshot when seeded |

Routes that read a body require a JSON object; any other JSON value is
rejected with `400`. `GET` routes and `seed` do not read a body.

## Conventions

- **Dates** are `YYYY-MM-DD` and must be real calendar days. `endDate` MUST not
  be before `startDate`.
- **Status** is one of `todo`, `in_progress`, `blocked`, `done` (the vocabulary
  is also returned by `/tree` and `/meta`).
- **Progress** is a number from 0 to 100; it is rounded and clamped.
- **Title** is trimmed and whitespace-collapsed, 1–200 characters.
- **Description** is an optional string of at most 4000 characters; absent or
  `null` becomes `''`.
- **Numbers** (`1`, `1.1`, …) are derived from sibling order at read time.
- **Rollups**: when a task has children, its `startDate`/`endDate` cover them,
  `progress` is the mean of the children's progress, and `status` is derived
  (`done` when every child is done, `blocked` when any is blocked, `in_progress`
  when any is in progress or progress > 0, otherwise `todo`). Parent values are
  read-only; the UI never authors them. Limitation: a parent that loses its last
  child keeps the last persisted rollup values (rule 7 in
  [compatibility.md](compatibility.md)).

## Task object

Every task in a response has this shape. Fields marked *derived* are computed
on read.

```json
{
  "id": "0f0c1c2e-6f4a-4d1e-9f4a-1f0b2f5c8a11",
  "parentId": null,
  "title": "DSH 插件发布",
  "description": "从数据层到界面的端到端交付。",
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
  "today": "2026-11-14",
  "statuses": ["todo", "in_progress", "blocked", "done"],
  "stats": { "total": 13, "done": 2, "inProgress": 4, "blocked": 2, "overdue": 0, "progress": 15 },
  "tasks": [
    {
      "id": "…",
      "parentId": null,
      "number": "1",
      "title": "DSH 插件发布",
      "status": "in_progress",
      "progress": 45,
      "startDate": "2026-11-04",
      "endDate": "2026-12-08",
      "hasChildren": true,
      "children": [
        { "number": "1.1", "title": "需求梳理", "status": "done", "progress": 100, "children": [] }
      ]
    }
  ]
}
```

`stats` counts every task in the tree, not only the roots:

| Stat | Meaning |
| --- | --- |
| `total` | all tasks |
| `done` | tasks whose derived status is `done` |
| `inProgress` | tasks whose derived status is `in_progress` |
| `blocked` | tasks whose derived status is `blocked` |
| `overdue` | non-done tasks whose `endDate` is before `today` |
| `progress` | `round(done / total * 100)`, `0` for an empty tree |

## Read metadata

```sh
curl -s http://127.0.0.1:3080/api/gantt/meta
```

```json
{
  "ok": true,
  "dbPath": "/home/you/.dsh/gantt/tasks.db",
  "statuses": ["todo", "in_progress", "blocked", "done"],
  "schemaVersion": 1,
  "taskCount": 13,
  "engine": "node:sqlite",
  "endpoints": [
    { "method": "GET", "path": "/api/gantt/tree", "description": "Read the hierarchical task tree with numbers, rollups, and stats." }
  ]
}
```

`dbPath` is the resolved absolute path (`:memory:` for an in-memory store);
`endpoints` is the host's own eight-entry route catalog (abbreviated above).

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
    "description": "覆盖拆分与状态流转"
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
- The new task is appended after its siblings and ancestor rollups are
  recomputed.

## Update a task

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/task/update \
  -H 'content-type: application/json' \
  -d '{ "id": "<task-id>", "title": "新标题", "parentId": "<parent-id>" }'
```

```json
{ "ok": true, "task": { "id": "…", "number": "2.1", "title": "新标题", "…": "…" } }
```

- `id` is required; every other field is optional. Unknown fields are ignored.
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
      { "title": "子任务 B", "startDate": "2026-11-09", "endDate": "2026-11-10" }
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
- Children are appended after any existing children; the parent's range,
  progress, and status roll up from all of them, and ancestor rollups are
  recomputed.

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
"taskCount": <existing count> }`. A seeded database holds 13 tasks (two root
projects and their subtrees), which read back as
`stats:{total:13,done:2,inProgress:4,blocked:2,overdue:0,progress:15}` on the
day it was seeded.

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
| `400` | hierarchy violation | `a task cannot be its own parent`, `a task cannot move under one of its descendants` |
| `404` | unknown task id | `task <id> was not found` |
| `500` | unexpected host failure | the thrown error's message |

A wrong method or an unknown path is left to the harness's `/api` dispatch (it
is not handled by this plugin), so it does not return this error shape.
