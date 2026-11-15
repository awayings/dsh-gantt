# Development

How to set up, test, run, and verify `dsh-gantt`.

## Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | `^22.19.0 \|\| >=24.0.0` (plugin `engines.node`); DSH `0.2.2-rc.1` requires `>=24.9.0` | The effective floor when running inside DSH is the harness's own. |
| pnpm | latest (CI pins `latest`; the checked-in `pnpm-lock.yaml` is authoritative) | `corepack enable` or a standalone pnpm install. |
| DeepSeek Harness | `0.2.2-rc.1` verified | `dsh --version`; install from `@deepseek-ai/dsh`. |
| Git | any recent version | Husky installs the static pre-commit hook on `pnpm install`. |

There are no runtime dependencies: the host half uses Node built-ins, and the
client half uses the React instance provided by the DSH client module loader.

## Setup

```sh
git clone git@github.com:awayings/dsh-gantt.git
cd dsh-gantt
pnpm install
pnpm run verify
```

`pnpm install` also runs `husky` and installs both hooks: `pre-commit` runs
`pnpm run static` (lint + typecheck), and `pre-push` runs the full gate before a
push to `main`.

## Toolchain

| Tool | Role | Configuration |
| --- | --- | --- |
| [oxlint](https://oxc.rs/docs/guide/usage/linter) `1.85.0` | Lint | `.oxlintrc.json` (correctness, unicorn, import, promise rules) |
| TypeScript `~7.0.2` (`tsc --noEmit`) | Typecheck `checkJs` for host, client, and tests | `tsconfig.json`, `tsconfig.client.json`, `tsconfig.tests.json` |
| [vitest](https://vitest.dev/) `^5.1.0` | Host (Node), client (jsdom), and end-to-end (jsdom + real HTTP) projects | `vitest.config.ts` |
| `@vitest/coverage-v8` | Per-file coverage thresholds | `vitest.config.ts` |
| husky `^9.1.7` | Runs the commit and push gates | `.husky/pre-commit`, `.husky/pre-push` |
| jsdom `^30.1.3` | Browser environment for `client.js` | `tests/client/setup.js` |

There is **no build step**. All seven source files are shipped as-is: the six
host modules `index.js`, `store.js`, `tracker.js`, `tree.js`, `daily.js`, and
`chat.js` as ESM, plus `client.js` as the client artifact loaded by DSH.

## Quality gate commands

| Command | What it runs | What it enforces |
| --- | --- | --- |
| `pnpm run verify` | `node --check` on the six host modules and `client.js` | Syntax only; the fastest smoke check. |
| `pnpm run lint` | `oxlint` | Lint rules and unused code. |
| `pnpm run lint:fix` | `oxlint --fix` | Auto-fixes what it can; review the diff afterwards. |
| `pnpm run typecheck` | `tsc --noEmit` against all three tsconfigs | Host under `strict`; client and tests under `checkJs` with looser settings. |
| `pnpm run static` | `lint` then `typecheck` | The commit gate: static analysis only, ~3 seconds. |
| `pnpm run test` | `vitest run --project host --project client` | Unit behavior in Node and jsdom. |
| `pnpm run coverage` | `vitest run --project host --project client --coverage` | Unit behavior plus per-file thresholds. |
| `pnpm run e2e` | `vitest run --project e2e` | The shipped client artifact, real HTTP, the real route handlers, and a real SQLite file. |
| `pnpm run check` | lint + typecheck + coverage + e2e in parallel | The full gate, run by `.husky/pre-push` before a push to `main`. |

The gates are deliberately split. Committing runs `pnpm run static` from
`.husky/pre-commit`: fast enough to stay out of the way, strict enough that no
commit lands with a lint or type error. Behavior is verified before a push
reaches the remote: `.husky/pre-push` runs the full gate `pnpm run check` for
any push to `main` — it runs the unit suites with coverage thresholds, the
end-to-end suite, and static analysis in parallel, prints each tool's complete
output, and keeps the logs in `.tmp/check-logs/`. It is implemented as
`scripts/check.sh`, launched through `scripts/run-bash.mjs` so the same gate
also runs on Windows (where the launcher locates Git Bash; set `DSH_GANTT_BASH`
to a `bash.exe` path to override). A green run fingerprints the worktree
contents into `.tmp/check.stamp`, so an unchanged repeat run skips instantly and
the hook refuses a push whose tree does not match the stamp; `pnpm run check
--full` forces a full re-run.

Release tagging is scripted: `pnpm run release X.Y.Z [--dry-run] [--push]`
validates the repository, runs the full gate, and creates/pushes the tag (see
`CONTRIBUTING.md` §Releasing).

CI runs the full gate only on release tags: `.github/workflows/release.yml` runs
`pnpm run lint`, `pnpm run typecheck`, `pnpm run coverage`, and `pnpm run e2e`
after checking that the tag matches the package version. Branches have no CI
job — the local `pre-push` gate is what protects `main`, and the same gate runs
again in CI before a release is published.

Coverage policy:

- `store.js`, `index.js`, `tracker.js`, `tree.js`, `daily.js`, and `chat.js`:
  **100%** statements, branches, functions, lines.
- `client.js`: ratcheted floor — 99% statements, 98% branches, 99% functions,
  99% lines. The unreachable UI branches are listed in the coverage output and
  must not regress; the measured values are printed by `pnpm run coverage` and
  only ratchet up.
- Never weaken a threshold without recording the decision here and in the
  review that changes it.

Recorded decisions:

- **2026-11-15 — `tracker.js` added at 100%**, not below the host floor: the
  importer sits on the read path of the Today page, and a partial parse fails
  silently in the UI.
- **2026-11-15 — `tree.js` added at 100%.** The hierarchy helpers moved out of
  `store.js` to keep every file under the 1000-line cap; they are pure
  functions (numbering, flattening, rollups, stats, frontier/next, context
  markdown), so there is no excuse for a partial branch. Read-time derivation
  bugs would show up as wrong numbers on every page.
- **2026-11-15 — `daily.js` and `chat.js` added at 100%.** The daily-brief
  engine decides which task goes into which window and the chat module parses
  model output into a tree mutation; both are pure (or stream-shaped) and a
  partial branch would silently mis-plan a day or accept a malformed proposal.
- **2026-11-15 — `client.js` line cap raised 2300 → 2700.** The Today page is a
  second registered `main` page in the same single-file artifact (the artifact
  cannot be split, see `docs/compatibility.md` §3.1); the addition is additive
  UI, not a refactor.
- **2026-11-15 — `client.js` line cap raised 2700 → 3600.** The unified tree
  roughly doubles the Gantt page surface: track and node metadata rows, links
  chips, the decompose dialog, the schedule dialog, and the context dialog. The
  artifact still cannot be split, so the cap moves with the surface rather than
  the file becoming a bundle.
- **2026-11-15 — `client.js` line cap raised 3600 → 4800.** The daily-brief
  strip (three aligned blocks, lanes grid, window cards), the three
  perspectives with path pruning, and the right-hand AI sidebar add a second
  feature layer to the same single classic script. The artifact still cannot be
  split (see `docs/compatibility.md` §3.1), so the ratchet moves with the
  features. Revisit before a fourth raise: the right answer is a bundled single
  artifact (bundler output into `client.js`, so the entry metadata still
  changes) or moving one surface (the Today page or the AI sidebar) out of the
  page, not an ever-growing monolith.

## Test layout

| Directory | Project | Covers |
| --- | --- | --- |
| `tests/store/` | `host` (Node) | `store.js`, `tree.js`, and `daily.js`: schema v4 migration (v1/v2→v4 with the one-time tree backfill, v3→v4 without re-materializing snapshots, idempotent), tracker materialization and state preservation, stale-row handling, dates, numbering, rollups, validation, CRUD, split, seed, delete, decompose and schedule transactions, links, plan upserts and integrity, daily-brief windows/budgets/fairness/persistence/lookup rules |
| `tests/host/` | `host` (Node) | `index.js` and `chat.js`: all seventeen routes, body parsing, status codes, error mapping, store lifecycle, `tree` + `brief` + `dailyBrief`, the brief read/recompute routes, `decompose`/`schedule`/`context`, the day/plan routes, chat request validation, model streaming assembly, proposal parsing, and the 400/502/503 mapping |
| `tests/tracker/` | `host` (Node) | `tracker.js`: markdown parsers (schedule board, tree, daily card), slot derivation, import counts, hostile/truncated input |
| `tests/client/` | `client` (jsdom) | `client.js`: rendering the unified tree (track/node metadata, links chips), brief strip blocks and window cards, perspectives and path pruning, decompose/schedule/context dialogs, the AI sidebar (focus, send, proposal, apply, no-model banner), tree/time-axis behavior, Today page with the 该动 section, locale strings, error and empty states |
| `tests/e2e/` | `e2e` (jsdom + node:http) | The real seams end to end: module-loader artifact contract, relative `fetch`, HTTP status/headers, route handlers, tracker import through a fixture directory (six roots and the imported nodes in `/tree`), decompose → a new block in `/day`, the daily-brief read/recompute routes and tree/day wiring, chat answering `503` without a model, a committed v2-schema fixture (`tests/helpers/v2.js`, no skipped tests) upgrading to schema 4, and a SQLite file that survives a restart |
| `tests/helpers/` | — | Shared fixtures, a fake host context for the `host` project, and a fake `llm` stream (`tests/helpers/llm.js`) for chat tests |

New in the daily-brief / AI-sidebar round: `tests/store/daily-brief.spec.js` and
`tests/store/schema-v4.spec.js`, `tests/host/routes-brief.spec.js`,
`tests/host/routes-chat.spec.js`, and `tests/host/chat.spec.js`,
`tests/e2e/brief.spec.js`, and `tests/client/chat.spec.js`; the existing tree,
page, today, and fixtures specs gained the brief strip, perspective, and
Today-section cases.

`tests/client/setup.js` boots jsdom, stubs `window.__ModuleLoader__` so the
factory can be called with the real React, and resets the document between
specs. The client suite has no network access; fetch is mocked per spec.

`tests/e2e/setup.js` uses the same loader stub, but the suite is a real
integration: `tests/e2e/server.js` boots the host half against a temporary
database file behind a real `node:http` server, and the shipped `client.js`
requests it over the wire. `tests/e2e/artifact.spec.js` pins the single-file
classic-script contract that DSH's cache revision depends on. Keep this suite
small — exhaustive cases belong in the unit projects.

Run a single area or case while iterating:

```sh
pnpm exec vitest run tests/store
pnpm exec vitest run tests/client -t "week timeline"
```

## Database

The host half opens one SQLite database per DSH process through `node:sqlite`:

```text
$DSH_HOME/gantt/tasks.db
```

- `DSH_HOME` defaults to `~/.dsh`.
- Set `DSH_GANTT_DB=/absolute/path/to/tasks.db` to use another file (tests and
  disposable profiles use this to stay out of the real home).
- The database is created on first activation, including its parent directory;
  the file is chmod `0600` where the filesystem supports it.
- WAL mode leaves `tasks.db-wal` and `tasks.db-shm` beside the database; they
  are git-ignored along with `*.db`.
- One DSH process owns one database. Do not point concurrent DSH processes at
  the same file (see `docs/compatibility.md`).

The stored columns and their API field mapping are documented under
[the task object](api.md#task-object); `GET /api/gantt/meta` reports the
resolved path, schema version, and row count at runtime.

### Schema version 4: one working tree plus daily reports

The tree data lives in `tasks`, one row per node, with `kind` marking the layer:

| `kind` | Rows | `ref` |
| --- | --- | --- |
| `track` | The six track roots | `track:1` … `track:6` |
| `node` | The imported Hermes nodes | `node:1.8.1` |
| `task` | Manually created and decomposed tasks | `''` |

Each row also carries the tracker metadata (`state`, `lane`, `dep`, `done_when`,
`landing`, `estimate`, `category`, `inspiration`, `links`) and `source`
(`tracker` | `manual`). A unique index on `(kind, ref)` (where `ref <> ''`) is
the import's upsert key. `tracks` and `nodes` stay as import snapshots;
`plan_blocks` and `day_plans` remain the time grid. Schema version 4 adds
`daily_briefs` (`plan_date` primary key, `generated_at`, `source`, `report`
JSON), the persisted daily 该动 snapshots. The rationale is in
[personal-task-system.md](personal-task-system.md), the layering table in
[compatibility.md](compatibility.md#4--data-model-layering-and-migration).

The host also starts an in-process scheduler: a `setTimeout` to the next local
08:00 recomputes today's report with `source: 'auto'`; the timer is unref'ed and
disposed with the plugin, so it only runs while `dsh web` is up.

#### Migrate a v2 or v3 database

The host runs the append-only migration when it opens a database whose
`PRAGMA user_version` is below 4. A v2 database additionally gets the twelve
`tasks` columns, the `(kind, ref)` index, and the one-time backfill of
`tracks`/`nodes` into `tasks`; a v3 database keeps `tasks` untouched and only
gains `daily_briefs`.

1. Stop `dsh web`, then copy the database aside:
   `cp "$DSH_HOME/gantt/tasks.db" /tmp/tasks.v3.db` (also copy `-wal`/`-shm` if
   present, or run `sqlite3 tasks.db 'PRAGMA wal_checkpoint(TRUNCATE)'` first).
2. Start the new build / restart `dsh web`. No separate migration command
   exists; opening the store performs it.
3. Verify with `GET /api/gantt/meta`: `schemaVersion` is `4` and `taskCount`
   is unchanged on a v3 upgrade. `GET /api/gantt/tree` still has the same tree
   and now carries `dailyBrief`; `GET /api/gantt/brief` computes and caches
   today's report.
4. On a v2 upgrade, run the import once (`POST /api/gantt/plan/import`); it must
   report the same track/node counts as the snapshot and must not duplicate rows
   (the unique `(kind, ref)` index would reject a second copy).
5. The upgrade is one-way. If it fails, restore the copy from step 1 and report
   the error; do not hand-edit `PRAGMA user_version`.

### The task-tracker import

The import fills the snapshot tables from the markdown and then materializes
them into the working tree, all in one transaction:

```sh
# UI: Today page → Import plan. API:
curl -s -X POST http://127.0.0.1:3080/api/gantt/plan/import \
  -H 'content-type: application/json' -d '{}'
```

- Source directory: `$DSH_GANTT_TRACKER_DIR`, else
  `/data/home/clawd/projects/task-tracker`. An absolute `dir` in the body
  overrides it for one call.
- Files read: `SCHEDULE.md` (the future-7-day time grid), `TREE.md` (tracks and
  nodes), `daily/YYYY-MM-DD.md` (the day's core goal). The tracker is
  read-only for the plugin; nothing is written back and there is no watcher.
- The import is idempotent: tracks/nodes snapshots are replaced, days and blocks
  are upserted, and the snapshots are materialized into `tasks` by `(kind, ref)`
  (insert new refs, update existing rows, remove stale leaves). Manual tasks and
  task-sourced plan blocks are never touched.
- Content fields follow the markdown; `status`/`progress` are overwritten only
  when the normalized tracker state changed, and `links` is never written. A
  stale imported row that has children is kept, so user decompositions survive.
- Verify a fresh import by reading the tree and one day: `/tree` returns the
  six tracks with the imported nodes, `GET /api/gantt/day?date=<today>` returns
  the day, its blocks, tree-derived `nodes`/`tracks`, its `brief`, and
  `integrity: []` for a fully planned day, and `GET /api/gantt/brief` returns a
  report whose windows match that day's blocks.

## Local dev loop

1. `pnpm install`.
2. `pnpm run deploy` links this checkout into the target DSH profile and
   verifies the composed tree (see [Install a checkout](#install-a-checkout)).
3. Edit `index.js` / `store.js` / `tracker.js` / `tree.js` / `daily.js` /
   `chat.js`: these run in the `dsh web` server process and are re-read on
   restart, so restart `dsh web` after host changes. The daily-brief scheduler
   restarts with the process.
4. Edit `client.js`: the file metadata changes, so DSH derives a new client
   artifact revision and a page reload picks up the new bytes. A page refresh
   is enough; no build is involved.
5. Run the narrow test first (`pnpm exec vitest run tests/<area> -t "…"`), then
   commit and push. The commit hook runs the static check; the push hook runs
   the full gate before anything reaches `main`.

### Install a checkout

The package is private, so it is always installed from a directory: the GUI
`plugin_manager install_bundle { target: "/absolute/path/to/dsh-gantt" }`, the
CLI `dsh plugin --profile web add /absolute/path/to/dsh-gantt`, or the scripted
deploy. All three record a pnpm `link:` dependency plus the bundle selection
that makes the plugin part of the profile — nothing is copied.

| Command | Effect |
| --- | --- |
| `pnpm run deploy` | Link this checkout, select it as a bundle, verify the composed tree; safe to repeat |
| `pnpm run deploy --check` | Verify the recorded link, the `node_modules` symlink, the bundle selection, and the composition; change no dependency |
| `pnpm run deploy --uninstall` | Remove the bundle from the profile; the database file stays on disk |
| `--profile <name>` | Profile to manage (default `$DSH_PROFILE`, else `web`) |
| `--home <dir>` | DSH home holding `profiles/` (default `$DSH_HOME`, else `~/.dsh`) |

`pnpm run deploy` runs `dsh plugin --profile <name> add <repo-directory>` under
the hood, so it initializes a missing profile with the default bundle set and
reports the same compatibility warnings. It finishes by running
`dsh --profile <name> --dump-config` and checking that the composed tree still
contains this package: a broken bundle patch fails the deploy instead of
showing up as a missing page later. The profile lives outside the repository,
so the command needs write access to `$DSH_HOME/profiles/<profile>`; a sandboxed
agent session must run it with full filesystem access.

Because the dependency is a link, the profile never holds a copy:

- `index.js`, `store.js`, `tracker.js`, `tree.js`, `daily.js`, and `chat.js`
  are re-read when `dsh web` starts — restart after editing them.
- `client.js` is served from this directory on every page load and its revision
  follows the file metadata, so a reload serves the new bytes.
- No edit requires a reinstall. Run `pnpm run deploy` again only when the
  profile lost the link (profile reset, DSH reinstall, or another checkout won
  the dependency); `pnpm run deploy --check` reports which part is missing.

## Verification procedure

### Automated

```sh
pnpm run verify
pnpm run check     # lint + typecheck + unit coverage + e2e
```

### Install and host acceptance (disposable profile)

Proves the bundle installs, the host half activates, and the JSON API answers
against a real `dsh web` without touching your real DSH home:

```sh
export DSH_HOME=/tmp/dsh-gantt-verify       # never touch ~/.dsh
dsh plugin --profile web add /absolute/path/to/dsh-gantt
dsh --profile web --dump-config | grep -A2 gantt
# composes:  - id: gantt / name: '@local/dsh-gantt'

dsh web --no-open                           # prints http://127.0.0.1:3080/?token=…
# Open the tokenized URL once (sets the dsh-auth cookie), copy the cookie value
# from DevTools → Network, then:
COOKIE='dsh-auth=<value>'
curl -s -H "Cookie: $COOKIE" http://127.0.0.1:3080/api/gantt/meta
# Optional demo tree, only on a fresh database (use a second DSH_GANTT_DB file
# if you also want to check the import below without mixing the two):
curl -s -H "Cookie: $COOKIE" -X POST -H 'content-type: application/json' \
  http://127.0.0.1:3080/api/gantt/seed -d '{}'
curl -s -H "Cookie: $COOKIE" http://127.0.0.1:3080/api/gantt/tree
# Unified tree:
curl -s -H "Cookie: $COOKIE" -X POST -H 'content-type: application/json' \
  http://127.0.0.1:3080/api/gantt/plan/import -d '{"dir":"/absolute/path/to/task-tracker"}'
curl -s -H "Cookie: $COOKIE" http://127.0.0.1:3080/api/gantt/tree
curl -s -H "Cookie: $COOKIE" "http://127.0.0.1:3080/api/gantt/day"
curl -s -H "Cookie: $COOKIE" -X POST -H 'content-type: application/json' \
  http://127.0.0.1:3080/api/gantt/task/decompose \
  -d '{"id":"<task-id>","children":[{"title":"验收子任务","doneWhen":"有一行可核对的产出"}]}'
curl -s -H "Cookie: $COOKIE" -X POST -H 'content-type: application/json' \
  http://127.0.0.1:3080/api/gantt/task/schedule \
  -d '{"id":"<task-id>","date":"<today>","startTime":"21:00","endTime":"22:00"}'
curl -s -H "Cookie: $COOKIE" "http://127.0.0.1:3080/api/gantt/context"
# Daily brief:
curl -s -H "Cookie: $COOKIE" "http://127.0.0.1:3080/api/gantt/brief"
curl -s -H "Cookie: $COOKIE" -X POST -H 'content-type: application/json' \
  http://127.0.0.1:3080/api/gantt/brief/compute -d '{}'
# AI chat (a host without a model service must answer 503, not 500):
curl -s -H "Cookie: $COOKIE" -X POST -H 'content-type: application/json' \
  http://127.0.0.1:3080/api/gantt/chat -d '{"message":"拆解这个任务"}'
```

Expected: `meta` returns `{ok:true, dbPath:"$DSH_HOME/gantt/tasks.db",
engine:"node:sqlite", schemaVersion:4, kinds:[…], linkTypes:[…],
endpoints:[…17 routes…]}`; `seed` on an empty database inserts 13 demo tasks
and returns `seeded:true, taskCount:13` plus the snapshot; `tree` returns the
track roots with their imported children, a `brief` whose `lanes` has one entry
per track, and a `dailyBrief` for today; `plan/import` returns
`imported:{tracks,nodes,days,blocks}` with non-zero counts for a real tracker
directory; `day` returns `day`, `blocks`, tree-derived `nodes`/`tracks`,
`integrity`, `stats`, and `brief`; `decompose` returns the parent with a new
child and no `blocks` when no `plan` was given; `schedule` returns the block
with id `task|<task-id>|<date>`, and repeating the same call returns the same
block id instead of a duplicate; `context` returns markdown with `chars`,
`truncated`, `counts`, and a `## 今日窗口` section; `brief` returns the report
with `cached` and the report's `slots`/`items`/`tracks`, and
`brief/compute` returns the same shape with `source: 'manual'`; `chat` returns
`503 {"ok":false,"error":"model unavailable"}` on a host without a model (a
500 there means the optional-seam handling is broken). An invalid JSON body
returns HTTP 400 with `{"ok":false,"error":"request body must be valid JSON"}`.

Remove the disposable home when done: `rm -rf /tmp/dsh-gantt-verify`.

### Slot registration

In the connected DSH Web GUI, use `cordis_inspect_query` → Client
`Slots.listSubTree`:

- `root: "sidebar.panellist"` shows the `gantt` and `today` entries.
- `root: "main"` shows the pages registered under keys `gantt` and `today`.

Registration proves composition, not rendering.

### Manual GUI checklist

jsdom tests prove behavior; they do not prove paint or layout. Before shipping,
open the page in the connected Web GUI and check:

- [ ] The sidebar icon appears with the localized label and opens the page in
      the center column, like the built-in pages.
- [ ] The tree renders numbers (`1`, `1.1`, `1.1.1`), bars, today line, and
      weekend/month groups in both **Week** and **Month** scales.
- [ ] Imported track rows show the lane chip and the raw tracker state chip;
      node rows show `state`, `doneWhen`, `landing`, `estimate`, `category`,
      `inspiration`, and links chips with the full link in a tooltip.
- [ ] A running (`持续`) node's bar ends at today, and the depth zoom switches
      between all nodes, two levels, and one level.
- [ ] The brief strip shows three aligned blocks — header (title, pending
      count, generated-at, recompute), a three-column `支线 / 前沿 / 该动` grid
      with single-line ellipsis and one row per track, and `今日窗口` cards with
      time, role badge, task (`ref title`), or `未填`. Column alignment is
      independent of title length at desktop width and the cards stack at
      ~390 px; clicking a pick reveals that task.
- [ ] The perspective switch offers 全部 / 待做 / 已完成: 待做 keeps only the
      frontier/next/daily-brief paths to the track roots and hides completed
      siblings, 已完成 keeps done nodes with their ancestors, and each view
      shows its kept count and an empty hint. Switching clears the manual
      collapse for 待做/已完成 and restores the depth-level collapse for 全部.
- [ ] **Decompose** opens from a node row, requires a title and `done_when` per
      child, can add/remove rows, and schedules a child into a day when its
      date/time row is filled; success reports the child and block counts.
- [ ] **Schedule** opens for one node with fields prefilled from the node, and
      scheduling the same node on the same day updates the existing block.
- [ ] **Export context** shows read-only markdown with `chars`/`truncated` and
      copies it (clipboard, with a selected-text fallback when the clipboard API
      is unavailable).
- [ ] Previous/next moves the window by the documented amounts (14 days /
      3 months) and **Today** returns to the current date.
- [ ] **New task**, edit, and **Split** dialogs validate input and show a toast
      on success and an error banner on failure.
- [ ] Clicking a status pill cycles status; a parent's status/progress/range
      roll up from its children.
- [ ] Deleting a branch removes its descendants.
- [ ] **Load demo data** works on an empty database and is a no-op afterwards.
- [ ] The **API** dialog shows the resolved database path and endpoint list.
- [ ] Reloading the page preserves data; light and dark themes both render.
- [ ] Narrow widths (down to ~390px) in both locales have no overlapping
      content; English labels are the truncation stress case.
- [ ] Switching the harness language updates the plugin strings.
- [ ] The **Today** entry opens the day plan: date nav (`‹` / `Today` / `›`),
      day meta, core-goal callout, slot groups, status pills that persist on
      reload, and the "this week's nodes" list now fed by the unified tree.
- [ ] A block created by scheduling shows its tree-node origin marker and can
      still change status like an imported block.
- [ ] The Today page shows the **今日该动** section above the slot groups: one
      row per window (time, role, track, task, or 未填), generated-at and
      source, and **重新计算** recomputes and refreshes; an empty report shows
      the muted hint plus the button.
- [ ] The **AI 拆解** header button opens the right sidebar; a row's ✦ action
      focuses that task and opens it. With a model, sending a decomposition
      request renders the reply and a proposal card, **应用拆解** calls
      decompose and refreshes; without a model the panel shows the no-model
      banner instead of breaking. Enter sends, Shift+Enter inserts a newline,
      and the panel becomes a full-width overlay at narrow widths.
- [ ] **Import plan** on the Today page reports success (or a readable error),
      and a fully planned day shows no integrity warnings while a day missing
      its evening slot or an evening inspiration id does.

## Troubleshooting

### Token, port, and cookies when calling the API

The API rides the existing authenticated `/api` channel; there is no second
port, CORS setup, or API token.

- Start with `dsh web` and open the full printed URL
  (`http://127.0.0.1:3080/?token=…`) once so the browser receives the session
  cookie.
- For `curl`, reuse that browser cookie (`Cookie:` request header copied from
  an authenticated `/api` request). Treat it as a credential; do not paste it
  into tickets or logs.
- A `401`/`403` almost always means a missing or expired cookie, not a plugin
  bug.
- `EADDRINUSE` on 3080 means another `dsh web` (or a stale process) still
  holds the port; stop it before starting again.
- The server prints the tokenized URL on every start; copy the current one
  rather than reusing an old URL.

### `node:sqlite`

- `node:sqlite` is a Node built-in (`DatabaseSync`) and requires the Node
  version declared in `engines.node`; `dsh` `0.2.2-rc.1` requires Node
  `>=24.9.0`, so use the Node that runs DSH.
- The API is synchronous; long transactions block the host event loop. Keep
  write transactions short (the store does).
- Import it as `node:sqlite`, never as an npm package; the package has no
  runtime dependencies and must not gain one.
- `SQLITE_BUSY`/`database is locked` means another process is writing the same
  file. Stop the other process or give each instance its own `DSH_GANTT_DB`.

### Multi-process SQLite single-writer

SQLite in WAL mode allows concurrent readers but still one writer. Two DSH
processes that share one `$DSH_HOME` and therefore one `tasks.db` can
interleave writes and hit lock errors; there is no cross-process arbitration in
this plugin. Run one DSH process per database file, or set a distinct
`DSH_GANTT_DB` for each. The full rule is in `docs/compatibility.md`.

### The daily brief looks stale or empty

The report is a stored morning snapshot: it reflects the tree when it was
generated, so status edits made later in the day do not move its picks. Press
**Recompute** (or `POST /api/gantt/brief/compute`) to refresh it; the host also
recomputes at the next local 08:00 only while `dsh web` is running. An empty
window list usually means an `unknown` day kind with no plan blocks — import the
day plan or classify the day. See `docs/compatibility.md` §5 for the full list.

### The AI sidebar says no model

`POST /api/gantt/chat` answers `503 model unavailable` when the host exposes no
`llm` service or no `agentDefaultModel` selection; the panel shows the no-model
copy and nothing is broken. Configure a model in the harness (or use a host that
provides one) and reopen the panel. A `502` is an upstream model failure or the
60-second timeout, not a plugin state problem.

### Concurrent coverage runs collide on `./coverage`

`vitest run --coverage` writes its report to `./coverage` by default. Two
coverage runs in the same worktree (parallel terminals, teammates, or a local
run during CI) clobber each other's report and can make a failure look
unrelated. Give each run its own reports directory:

```sh
pnpm exec vitest run --coverage --coverage.reportsDirectory=/tmp/gantt-cov-$$
```

Thresholds still come from `vitest.config.ts`; only the output location moves.

### The profile does not show the plugin

Run `pnpm run deploy --check`: it names the part that is missing or stale — the
recorded `link:` dependency, the `node_modules` symlink, the bundle selection,
or the composition itself. `pnpm run deploy` repairs all four. If the profile
is correct but the page still has no sidebar entry, reload the page once and
then restart `dsh web`: a running process serves the linked `client.js` on
reload, but a host-side change (`index.js`, `store.js`, `tracker.js`,
`tree.js`, `daily.js`, `chat.js`, or the bundle patch) needs the restart.

### No build, no dist

If a page shows old client code after an edit, confirm the profile still links
this checkout (`pnpm run deploy --check`) and reload the page; the served
artifact revision follows the file metadata, so a linked install serves the
edited bytes without a reinstall. Adding a bundler or build directory is out of
scope; the single-file client is deliberate (`docs/compatibility.md`).

### `main` is protected against force-pushes and deletion

The administrator rules are enforced too, so `git push --force origin main` and
deleting the branch are rejected. Ordinary pushes are fine: there is no pull
request requirement and no server-side status check — the local `pre-push` gate
is the control. Release tags are not branches, so
`pnpm run release X.Y.Z --push` pushes the tag directly.
