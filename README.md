# DSH Task Gantt

A persistent DSH Web UI plugin that adds a **Task Gantt** entry to the left
sidebar and a full central page with:

- a hierarchical task tree with automatic `1`, `1.1`, `1.1.1` numbering;
- weekly and monthly timeline scales with zoom-out / zoom-in navigation;
- task tracking through status, progress, and roll-up values on parent tasks;
- task creation, editing, splitting into subtasks, moving between parents, and
  deletion;
- a local SQLite database and an authenticated JSON API for external callers.

## Destination

The plugin registers:

| Surface | Slot | Registration |
| --- | --- | --- |
| Left sidebar icon | `sidebar.panellist` | id `gantt` |
| Central page | `main` | key `gantt` |

Clicking the sidebar icon selects the page exactly like the built-in Plugins or
Schedules pages.

## Data source

The Host half opens a SQLite database through Node's built-in `node:sqlite`:

```
$DSH_HOME/gantt/tasks.db
```

`DSH_HOME` defaults to `~/.dsh`. Override the database file with the
`DSH_GANTT_DB` environment variable before starting DSH:

```sh
DSH_GANTT_DB=/absolute/path/to/tasks.db dsh --profile web
```

The table is created on first activation:

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  progress INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Dates are stored as `YYYY-MM-DD`. Status is one of `todo`, `in_progress`,
`blocked`, `done`. When a task has children, its dates, progress, and status are
rolled up from those children on read; parent task fields are never authored
directly in the UI.

## JSON API

All routes are mounted on the existing authenticated `/api` channel. The browser
sends its normal session cookie; there is no second port, token, or CORS setup.
Requests and responses are JSON. Errors use `{ "ok": false, "error": "..." }`
with a `4xx`/`5xx` status. Examples below use the default `dsh web` port
`3080`; replace it with the origin and port printed by your own DSH launch.

The page is already authenticated. A terminal `curl` needs the same browser
session cookie: copy the `Cookie` request header from an authenticated request
to `/api` (browser DevTools → Network), or call the routes from the page's own
origin. Treat that cookie as a credential.

### Read the tree

```sh
curl -s http://127.0.0.1:3080/api/gantt/tree
```

Response:

```json
{
  "ok": true,
  "today": "2026-11-07",
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
      "startDate": "2026-10-28",
      "endDate": "2026-12-01",
      "hasChildren": true,
      "children": [
        { "number": "1.1", "title": "需求梳理", "…": "…" }
      ]
    }
  ]
}
```

### Create a task

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

`parentId` decides the hierarchy and therefore the number. Omitting dates
defaults to today through today + 3 days.

### Change status

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/task/status \
  -H 'content-type: application/json' \
  -d '{ "id": "<task-id>", "status": "in_progress", "progress": 40 }'
```

`status` alone maps to a sensible progress (`done` → 100, `todo` → 0,
`in_progress` → current or 50). `progress` alone derives the status
(100 → `done`, 0 → `todo`, otherwise `in_progress`).

### Update any field

```sh
curl -s -X POST http://127.0.0.1:3080/api/gantt/task/update \
  -H 'content-type: application/json' \
  -d '{ "id": "<task-id>", "title": "新标题", "parentId": "<parent-id>" }'
```

Moving a task under another parent renumbers both branches automatically.
A task cannot become its own ancestor.

### Split into subtasks

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

The parent becomes a summary task whose range and progress cover the new
children.

### Delete, seed, and inspect

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/gantt/tree` | Task tree, numbers, rollups, stats |
| `GET` | `/api/gantt/meta` | Database path, statuses, endpoint catalog |
| `POST` | `/api/gantt/tasks` | Create a task |
| `POST` | `/api/gantt/task/update` | Update any task fields |
| `POST` | `/api/gantt/task/status` | Change status/progress only |
| `POST` | `/api/gantt/task/split` | Create child subtasks |
| `POST` | `/api/gantt/task/delete` | Delete a task and its descendants |
| `POST` | `/api/gantt/seed` | Insert demo tasks when the database is empty |

The page itself exposes the same catalog through the **API** button in the
header, including the resolved database path.

## Timeline scales

- **Week** — 28 days, one column per day, month group headers, weekend shading,
  and a today line. Previous/next moves 14 days.
- **Month** — 12 months, one column per month, year group headers, and
  day-proportional month widths. Previous/next moves 3 months.

Both scales share the same task tree, so a row stays in place while the time
axis changes.

## Install

From a workspace checkout of this directory:

```text
plugin_manager install_bundle { target: "/Users/edy/projects/me/pve/dsh-gantt" }
```

Then open the Harness page; the sidebar entry appears immediately after the
bundle activates. The plugin is persistent and survives restart.

## Verify

- `node --check index.js client.js store.js`
- `node --input-type=module -e "import { GanttStore } from './store.js'; …"`
  exercises create/update/split/delete against an in-memory database.
- `cordis_inspect_query` → Client `Slots.listSubTree` with `root: "sidebar.panellist"`
  and `root: "main"` shows the live `gantt` registrations.
- The page renders in the connected Web GUI. Visual verification requires the
  browser page; slot registration and bundle activation alone do not prove the
  rendered result.

## Layout and safety notes

- The page renders as a React component in the `main` slot; it does not serve an
  iframe or append a second application to `document.body`.
- Styling uses the `--dsw-alias-*` theme tokens, so light and dark themes and
  host theme changes are inherited.
- All visible copy is registered through the Client locale service in English
  and Chinese.
- The API is authenticated by the existing `/api` session cookie; it does not
  open a separate listener.
- The database is local to this DSH home. Multiple DSH processes sharing the same
  `$DSH_HOME` should not point at the same SQLite file simultaneously.

## Client source layout

`client.js` is deliberately one file. DSH derives a client artifact revision
from `exports["./client"]` metadata only (mtime, ctime, size), and every chunk
URL embeds that same revision. Splitting the client half into runtime modules
(`require('./client.foo.js')`) leaves the entry file untouched, so the revision
does not change, the chunk URL does not change, and the browser keeps serving
the old bytes from its immutable cache — HMR stops firing and even a plain
reload can show stale code.

Organize the single file by section instead:

| Section | Contents |
| --- | --- |
| `DICT_EN`, `DICT_ZH`, `DICTS` | locale dictionaries registered with the Client locale service |
| `CSS_BASE`, `CSS_HEAD`, `CSS_STATS`, `CSS_GRID`, `CSS_EMPTY`, `CSS_DIALOG`, `CSS_MISC` | stylesheet sections, joined once into the rendered `<style>` |
| `iso`/`day`/`addDays`/`buildWindow`/`flattenTree` helpers | pure date and tree helpers |
| `GanttPage`, `TimelineHeader`, `GanttRow`, `TaskDialog`, `SplitDialog`, `ApiDialog` | React components |

If the file ever needs real splitting, bundle it back into a single `client.js`
(for example with esbuild) so the entry artifact still changes on every edit.
