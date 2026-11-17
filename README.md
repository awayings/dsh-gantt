# DSH Task Gantt

A persistent DeepSeek Harness Web UI plugin that adds two entries to the left
sidebar:

- **Task Gantt** — one hierarchical task tree with automatic `1`, `1.1`, `1.1.1`
  numbering; weekly and monthly timelines with zoom-out / zoom-in navigation;
  status, progress, and roll-up values on parent tasks; creation, editing,
  splitting, moving, deletion. The six imported tracks are the tree roots and
  their Hermes nodes hang below them, so the imported work is visible here.
  Decompose a node into subtasks, schedule a node into a day plan, and export
  the whole tree as markdown model context. **全部 / 未完成 / 进行中 / 前沿 /
  该动 / 今日 / 已完成** perspectives prune the tree to the paths that matter
  (未完成 keeps every task whose status is neither done nor cancelled; 进行中
  keeps tasks whose work conversation is running or waiting for a choice; 前沿
  and 该动 keep each track's frontier and next paths; 今日 keeps the tasks the
  daily brief picked for today), and **重算前沿和该动** on the right of the
  switch recomputes the daily brief. A **甘特** tab in the
  native conversation sidebar focuses one task per conversation, and the host
  assistant tools let that conversation read the focused chain and write
  decompositions straight into the tree. Every tool write records the DSH
  session and turn in a task trajectory that the tab, the tools, and
  `GET /api/gantt/trajectory` can read back. **Work mode** turns a row click
  into a workbench interaction without leaving the page: the **工作台** panel
  opens beside the tree with the task's work conversation, its description as a
  fixed-height scrollable markdown preview, and its trajectory. A task
  without a conversation shows **执行**, which creates it in the work workspace,
  queues the localized **完成任务** prompt into it so the model starts at once,
  and opens that same conversation in a new browser window (one conversation per
  task, reused afterwards); **拆解** does the same with **拆解任务**. Waiting
  tasks carry a warning badge. The workbench
  is also registered as a tab in the native right rail. Each round is required to close with
  `gantt_track` / `gantt_update_task` / `gantt_decompose` /
  `gantt_create_task` so the trajectory stays exact.
- **Today (今日安排)** — the day's planned time blocks, grouped by slot, with
  one-click status, the tree nodes in play, the day's core goal, and integrity
  warnings for missing landing targets or a missing evening slot. Blocks created
  by scheduling a tree node show where they came from, and the **今日该动**
  section lists the daily-brief windows with a manual recompute.

Both pages share a local SQLite database and an authenticated JSON API. The
tracker import is an explicit, idempotent pull from markdown files — no watcher,
no write-back — and it materializes the imported tree into the same working tree
the Gantt page renders.

No runtime dependencies beyond Node built-ins and the harness-provided React,
and no second server: the host half is seven plain-ESM modules under `src/host/`,
and the browser half is built from `src/client/` into a single classic-script
artifact (`lib/client.js`) that DeepSeek Harness loads. The right-rail tab is
optional (it needs `dsh-better-sidebar`) and the assistant tools are optional
(they need the host tools service); the plugin itself never calls an LLM.

## Destination

| Surface | Slot | Registration |
| --- | --- | --- |
| Left sidebar icon | `sidebar.panellist` | id `gantt` |
| Central page | `main` | key `gantt` |
| Left sidebar icon | `sidebar.panellist` | id `today` |
| Central page | `main` | key `today` |
| Conversation sidebar tab | `dsh-better-sidebar` | `registerTab` id `gantt`, `single: true` |
| Workbench tab | `dsh-better-sidebar` | `registerTab` id `gantt-work`, `single: true` |

Clicking a sidebar icon selects its page exactly like the built-in Plugins or
Schedules pages: the sidebar entry id is the keyed `main` page selection.

## Install

Requirements: DeepSeek Harness `0.2.2-rc.1` (verified), and the Node version it
requires (currently `>=24.9.0`).

Install the absolute path of a checkout. In the GUI's plugin manager:

```text
plugin_manager install_bundle { target: "/absolute/path/to/dsh-gantt" }
```

Or with the CLI:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-gantt
```

Or from the checkout, which installs the same way and proves the profile still
composes:

```sh
pnpm run deploy                 # link this checkout and verify the profile
pnpm run deploy --check         # verify the existing link; change no dependency
pnpm run deploy --uninstall     # remove the bundle from the profile
```

Every form records a pnpm `link:` dependency, so the profile resolves this
directory rather than a copy: restart `dsh web` after editing anything under
`src/host/`, and run `pnpm run build` (it rewrites `lib/client.js` when the bundler
output changed) plus reload
the page after editing `src/client/` — no reinstall step.
`pnpm run deploy` takes `--profile <name>` and `--home <dir>` when the target is
not the default `web` profile under `$DSH_HOME` (`~/.dsh`).

Then open the Harness page; the sidebar entry appears immediately after the
bundle activates and survives restart. The package is private, so installation
is always by path — it is not published to npm.

## Quick start

1. Open **Task Gantt** in the sidebar.
2. On an empty database, click **Load demo data** to get a small two-project
   tree (13 tasks) and explore the timeline, status cycling, and rollups.
3. Use **New task**, the row actions, and **Split** to build your own tree;
   **Week** / **Month**, the arrows, and **Today** move the time axis. The
   depth zoom collapses the tree to all nodes, two levels, or one level.
4. The **API** button shows the resolved database path and the full endpoint
   catalog, ready to copy into `curl`.
5. Open **Today** in the sidebar and press **Import plan** to pull the personal
   task tracker into the database. The imported tracks and nodes now appear as
   the Gantt tree too; browse days with `‹` / `›`.
6. On a tree row, **Decompose** creates subtasks (and optionally schedules each
   one), **Schedule** puts an existing node into a day's plan, and **Export
   context** copies the tree plus today's plan as markdown.
7. The perspective switch (**All / Unfinished / Active / Frontier / Next /
   Today / Done**) prunes the tree to the paths that matter: Unfinished keeps
   every task whose status is neither done nor cancelled, Frontier keeps each
   track's newest pending leaf, Next the first executable leaf, and Today the
   tasks the daily brief picked for today. **Recompute frontier and next** on
   the right of the switch refreshes the daily brief.
8. With `dsh-better-sidebar`, open the **甘特** tab in a native conversation
   and click a task to focus it. Ask the conversation model to decompose it:
   the assistant tools read the focused chain (`gantt_context`) and write the
   children (`gantt_decompose`) or a task update (`gantt_update_task`) directly
   into the tree. The full `/gantt` page has no in-page AI panel.

## Data source

The host half opens a SQLite database through Node's built-in `node:sqlite`:

```text
$DSH_HOME/gantt/tasks.db
```

`DSH_HOME` defaults to `~/.dsh`. Override the file before starting DSH:

```sh
DSH_GANTT_DB=/absolute/path/to/tasks.db DSH_GANTT_TZ=Asia/Shanghai dsh web
```

`DSH_GANTT_TZ` sets the task-day zone used for "today", plan dates, and the
08:00 brief recompute; it defaults to `Asia/Shanghai` (this deployment's host
process runs in UTC). An invalid IANA zone falls back to the default.

The schema is created on first activation and upgraded in place; a v2–v7
database is migrated to schema version 8 on open (the append-only migration,
the one-time tree backfill for v2, and the
`daily_briefs`/`focus`/`task_events`/`work_sessions`/agent additions are in
[docs/compatibility.md](docs/compatibility.md)). Dates are `YYYY-MM-DD` in the
task-day zone; task status is one of `todo`, `in_progress`, `blocked`, `done`, `cancelled`;
plan-block status is one of `todo`, `in_progress`, `done`, `skipped`.

Schema version 6 keeps one working tree in `tasks`: `kind='track'` roots (the
six imported tracks), `kind='node'` imported Hermes nodes, and `kind='task'`
manual or decomposed tasks. Each row carries the tracker's `ref`, `state`,
`lane`, `dep`, `done_when`, `landing`, `estimate`, `category`, `inspiration`,
and the plugin's `links`; `(kind, ref)` is unique for imported rows. The
`tracks`/`nodes` tables remain as import snapshots and idempotency keys, and
`plan_blocks`/`day_plans` hold the time grid. The `daily_briefs` table stores
one report per date: a deterministic, persisted snapshot of today's windows and
picked tasks, recomputed by the host at 08:00 in the task-day zone, by
**Recompute**, or on the first read of a day without a stored report.
`task_events` keeps the append-only provenance trail (action, session id, turn,
detail, time) that the assistant tools write automatically; `focus` keeps the
per-conversation focused task. The import reads a task-tracker
markdown workspace (`SCHEDULE.md`, `TREE.md`, `daily/*.md`) from
`/data/home/clawd/projects/task-tracker` by default (`DSH_GANTT_TRACKER_DIR`
overrides it) and never writes to it. See
[docs/personal-task-system.md](docs/personal-task-system.md) for the domain
model and the integrity checks. When a task has children, its dates and progress
are rolled up from them on read, and its status follows the tracker rule: the
parent's own tracker state wins over a weaker child-derived state. Parent fields
are never authored directly in the UI. Known limitation: a parent that loses its
last child keeps its last rolled-up values (see
[docs/compatibility.md](docs/compatibility.md)).
The full contract is in [docs/api.md](docs/api.md#conventions).

WAL mode keeps `tasks.db-wal` / `tasks.db-shm` beside the database. One DSH
process owns one database file; do not point concurrent DSH processes at the
same file (see [docs/compatibility.md](docs/compatibility.md)).

## Timeline scales

- **Week** — 28 days, one column per day, month group headers, weekend shading,
  and a today line. Previous/next moves 14 days.
- **Month** — 12 months, one column per month, year group headers, and
  day-proportional month widths. Previous/next moves 3 months.

Both scales share the same task tree, so a row stays in place while the time
axis changes.

## JSON API

All twenty-eight routes are mounted on the harness's existing authenticated `/api` channel.
The browser sends its normal session cookie; there is no second port, token, or
CORS setup. Errors use `{ "ok": false, "error": "..." }` with a `4xx`/`5xx`
status.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/gantt/tree` | Unified tree, numbers, rollups, stats, the frontier/next `brief`, and today's `dailyBrief` |
| `GET` | `/api/gantt/agents` | Registered external operators (`?type=&role=&q=&limit=`) |
| `POST` | `/api/gantt/agents` | Register or update an external operator |
| `GET` | `/api/gantt/task/context` | One task's stable markdown context (`?taskId=`) |
| `GET` | `/api/gantt/ready` | Ready/next/todo work (`?tag=&limit=`) |
| `POST` | `/api/gantt/task/report` | Write an external completion report back (`{taskId, agentId, report, ...}`) |
| `GET` | `/api/gantt/focus` | The task a conversation is focused on (`?sessionId=`) |
| `POST` | `/api/gantt/focus/set` | Focus one task for a conversation, or clear it |
| `GET` | `/api/gantt/trajectory` | Newest-first task provenance events (`?taskId=&sessionId=&limit=`) |
| `GET` | `/api/gantt/work` | Work directory, focused/requested task, and its dedicated conversation (`?taskId=&sessionId=`) |
| `POST` | `/api/gantt/work/session` | Bind a task to its dedicated conversation and focus it (`{taskId, sessionId}`) |
| `GET` | `/api/gantt/work/skills` | The optional host skill catalog for the workbench tab |
| `GET` | `/api/gantt/work/team` | The dedicated conversation's subagents (`?sessionId=`) |
| `GET` | `/api/gantt/meta` | Database path, statuses, kinds, link types, endpoint catalog |
| `POST` | `/api/gantt/tasks` | Create a task (including the tracker metadata fields) |
| `POST` | `/api/gantt/task/update` | Update any writable task fields |
| `POST` | `/api/gantt/task/status` | Change status/progress only |
| `POST` | `/api/gantt/task/split` | Create child subtasks |
| `POST` | `/api/gantt/task/decompose` | Decompose a node and optionally schedule each child |
| `POST` | `/api/gantt/task/schedule` | Put an existing node into a day's plan (idempotent) |
| `POST` | `/api/gantt/task/delete` | Delete a task and its descendants |
| `GET` | `/api/gantt/context` | Export the tree and a day plan as markdown model context |
| `POST` | `/api/gantt/seed` | Insert demo tasks when the database is empty |
| `GET` | `/api/gantt/day` | One day's plan bundle (blocks, tree nodes, integrity, stats, `brief`) |
| `POST` | `/api/gantt/plan/status` | Set a plan block's status and optional notes |
| `POST` | `/api/gantt/plan/import` | Import the task-tracker markdown into the unified tree |
| `GET` | `/api/gantt/brief` | The daily 该动 report for a date, cached when stored |
| `POST` | `/api/gantt/brief/compute` | Recompute and persist the daily report |


A terminal `curl` needs the page's session cookie — open the tokenized URL
printed by `dsh web` once, then copy the `Cookie` request header from an
authenticated request in DevTools. Treat that cookie as a credential.

The plugin does not call an LLM itself: a native conversation model reads and
writes tasks through the host assistant tools (`gantt_context`,
`gantt_decompose`, `gantt_update_task`, `gantt_track`, `gantt_create_task`)
described in [docs/api.md](docs/api.md).
Full request/response examples, field tables, focus, tool parameters, and error
codes: [docs/api.md](docs/api.md).

## MCP server

The package also ships a zero-dependency
[Model Context Protocol](docs/mcp.md) server for external coding tools
(stdio by default, optional authenticated HTTP): `gantt-mcp` exposes agent
registration, ready-task listing, per-task context, and completion write-back
against the same SQLite store.

## Verification

```sh
pnpm run verify    # node --check on every source, test, and script file
pnpm run build     # rebuild the browser artifact lib/client.js from src/client
pnpm run static    # lint + typecheck (the commit hook)
pnpm run test      # vitest (host + jsdom client unit suites)
pnpm run e2e       # rebuild the artifact, then drive it over HTTP into SQLite
pnpm run check     # the full gate, run by the push hook: static + coverage + e2e
```

- `cordis_inspect_query` → Client `Slots.listSubTree` with
  `root: "sidebar.panellist"` and `root: "main"` shows the live `gantt` and
  `today` registrations.
- The page renders in the connected Web GUI. Visual verification requires the
  browser page; slot registration and bundle activation alone do not prove the
  rendered result.
- The disposable-profile acceptance pass and the manual GUI checklist are in
  [docs/development.md](docs/development.md#verification-procedure).

## Layout, theme, and safety

- The page renders as a React component in the `main` slot; it does not serve an
  iframe or append a second application to `document.body`.
- The pane is the shell's center column, so its width follows the sidebar's
  collapse and drag; the layout folds with container queries (including the
  right-rail conversation tab at narrow widths), not viewport breakpoints.
- Styling uses the `--dsw-alias-*` theme tokens, so light and dark themes and
  host theme changes are inherited.
- All visible copy is registered through the Client locale service in English
  and Chinese.
- The right-rail tab is optional: the client injects the `betterSidebar`
  service and registers a per-conversation tab; without that plugin the tab is
  absent and the full page still works. The assistant tools are registered on
  the optional host `tools` service and write through the store with its normal
  validation; the plugin itself calls no model.
- The API is authenticated by the existing `/api` session cookie; it does not
  open a separate listener.
- The database is local to this DSH home. Multiple DSH processes sharing the same
  `$DSH_HOME` should not point at the same SQLite file simultaneously.

## Source layout

The plugin follows the reference `dsh-context` layout: code lives under `src/`,
one concern per file, and every source file stays under 1000 lines.

| Path | Role |
| --- | --- |
| `src/host/index.js` | plugin entry: store lifecycle, 08:00 scheduler, route and assistant-tool registration |
| `src/host/routes/` | the twenty-eight `/api/gantt/*` route specs split by resource (including `focus.js`, the trajectory read, `work.js`, and `agents.js`); `http.js` holds shared plumbing |
| `src/host/store/` | SQLite schema and migrations, task/tree writes, task-event trajectory, agent registry, work-session mapping, daily-brief persistence, context document |
| `src/host/work.js` | work directory for dedicated conversations (`DSH_GANTT_WORK_CWD`) |
| `src/host/tracker/` | tracker markdown parsers and importer |
| `src/host/tree/` | pure tree helpers: numbering, rollups, frontier/next, materialisation, context markdown, `chain.js` focus rendering |
| `src/host/clock.js` | task-day date and next-08:00 resolution (`DSH_GANTT_TZ`, default `Asia/Shanghai`) |
| `src/host/mcp.js`, `bin/gantt-mcp.js` | external-agent MCP server and its CLI (stdio or optional HTTP) |
| `src/host/daily/` | daily 该动 report: windows, role budgets, fairness, report rendering |
| `src/host/tools.js` | five assistant tools (`gantt_context`, `gantt_decompose`, `gantt_update_task`, `gantt_track`, `gantt_create_task`), task-reference resolution, and automatic provenance recording |
| `src/client/` | browser ESM modules: plugin entry, pages (`gantt`, `today`, right-rail `panel`, in-page/right-rail `workbench`), work-mode navigation, session activity (`session-status`), new-window handoff (`session-window`), active-page restore (`panel-session`), page-state restore (`page-state`), dialogs, styles |
| `src/shared/vocabulary.js` | status vocabularies used by both halves |
| `lib/client.js` | build output: the single browser artifact (gitignored) |

`scripts/build-client.mjs` bundles `src/client/index.js` with rolldown into
`lib/client.js`. The artifact must stay one classic script: DSH derives its
revision from `exports["./client"]` metadata only (mtime, ctime, size) and serves
every chunk URL as immutable, so splitting the entry across runtime chunks would
leave the revision unchanged and the browser on stale bytes. React stays
external — the DSH loader injects `require` into the factory, so the platform
React instance arrives through `require('react')` and the artifact has no
top-level `import`/`export`. A bundle whose bytes did not change is left
untouched, so a no-op gate run does not change the artifact revision (which
would reload every open page). The e2e suite rebuilds the artifact and pins both
rules; `pnpm run build` also runs from the `prepare` hook.

## Development / quality gates

`pnpm install` builds the browser artifact once; after client edits rebuild with
`pnpm run build` (the e2e gate rebuilds it too).

| Command | What it enforces |
| --- | --- |
| `pnpm run verify` | Syntax of every source, test, and script file |
| `pnpm run build` | Bundles `src/client/` into `lib/client.js` (rolldown) |
| `pnpm run lint` | oxlint |
| `pnpm run typecheck` | TypeScript `checkJs` across host, client, and tests |
| `pnpm run static` | lint + typecheck; what the commit hook runs (~3s) |
| `pnpm run test` | Vitest host + jsdom client unit suites |
| `pnpm run coverage` | Unit suites plus per-file coverage thresholds |
| `pnpm run e2e` | Rebuilds the client artifact, then drives it against real HTTP and a real SQLite file |
| `pnpm run check` | The full gate, run by the push hook: static + coverage + e2e in parallel, with a cached stamp |

Coverage is 100% per-file for `src/host/**` and `src/shared/**`, with a
documented floor (99/98/99/99) for `src/client/**`. The four host facades are
pure re-export modules, so the report prints them as `0/0` (no statements) while
the thresholds still pass.
Commits only run the static check; `.husky/pre-push` runs the full gate before
a push reaches `main`, and refuses a tree that is not green.
There is no pull request step. CI re-runs the same full gate only when a release
tag is pushed (`.github/workflows/release.yml`). `pnpm run deploy` links this
checkout into a DSH profile and verifies the composed tree (see
[Install](#install)). Setup, test layout,
database/API debugging, and the full verification procedure are in
[docs/development.md](docs/development.md).

## Documentation

- [docs/README.md](docs/README.md) — documentation index
- [docs/development.md](docs/development.md) — setup, toolchain, gates, verification
- [docs/api.md](docs/api.md) — JSON API reference
- [docs/mcp.md](docs/mcp.md) — MCP server, transports, five tools, troubleshooting
- [docs/deployment.md](docs/deployment.md) — host deployment for remote MCP clients: systemd service, ports, health checks, Claude Code + Codex
- [docs/remote-exec.md](docs/remote-exec.md) — safety-gated SSH wrapper for host-side steps: guard rules, audit log, tests
- [docs/compatibility.md](docs/compatibility.md) — supported set, harness seams, limitations
- [docs/personal-task-system.md](docs/personal-task-system.md) — unified task tree model, decomposition discipline, frontier/next, daily 该动 brief, perspectives, native-conversation assistant tools, task trajectory/protocol context, links, context export
- [CONTRIBUTING.md](CONTRIBUTING.md) — workflow, commits, release checklist
- [AGENTS.md](AGENTS.md) — engineering policy (priorities, tests, file size, gate)

## License

Private and `UNLICENSED`; not published to npm.
