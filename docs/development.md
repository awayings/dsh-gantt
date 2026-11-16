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

`pnpm install` also runs `husky` (installs both hooks: `pre-commit` runs
`pnpm run static` — lint + typecheck — and `pre-push` runs the full gate) and the
`prepare` hook, which bundles the browser half into `lib/client.js` once.

## Toolchain

| Tool | Role | Configuration |
| --- | --- | --- |
| [oxlint](https://oxc.rs/docs/guide/usage/linter) `1.85.0` | Lint | `.oxlintrc.json` (correctness, unicorn, import, promise rules) |
| TypeScript `~7.0.2` (`tsc --noEmit`) | Typecheck `checkJs` for host, client, and tests | `tsconfig.json`, `tsconfig.client.json`, `tsconfig.tests.json` |
| [vitest](https://vitest.dev/) `^5.1.0` | Host (Node), client (jsdom), and end-to-end (jsdom + real HTTP) projects | `vitest.config.ts` |
| `@vitest/coverage-v8` | Per-file coverage thresholds | `vitest.config.ts` |
| husky `^9.1.7` | Runs the commit and push gates | `.husky/pre-commit`, `.husky/pre-push` |
| jsdom `^30.1.3` | Browser environment for the `src/client/` modules | `tests/client/setup.js` |
| [rolldown](https://rolldown.rs/) `1.2.19` | Bundles `src/client/` into the single `lib/client.js` artifact | `scripts/build-client.mjs` |

The layout follows the reference plugin `dsh-context`: code under `src/`, one
concern per file, every source file under 1000 lines. Host modules are plain ESM
run in the `dsh web` process; the browser half is ESM bundled into one classic
script because the DSH client loader fetches a single artifact per package.

| Path | Half | Role |
| --- | --- | --- |
| `src/host/index.js` | host | Entry: store lifecycle, brief scheduler, route/tool/prompt registration |
| `src/host/routes/` | host | The nineteen `/api/gantt/*` route specs split by resource (including focus and trajectory); `http.js` is shared plumbing |
| `src/host/routes/focus.js` | host | `GET /focus` and `POST /focus/set`: per-conversation task focus |
| `src/host/store/` | host | SQLite schema/migrations, task/tree writes, task-event trajectory, brief persistence, context document, 08:00 scheduler |
| `src/host/tracker/` | host | Task-tracker markdown parsers and importer |
| `src/host/tree/` | host | Pure tree helpers: numbering, rollups, frontier/next, materialisation, context markdown |
| `src/host/tree/chain.js` | host | Focus-chain rendering for the assistant tools (track root → focus, task detail) |
| `src/host/clock.js` | host | Task-day date and next-08:00 resolution (`DSH_GANTT_TZ`, default `Asia/Shanghai`) |
| `src/host/daily/` | host | Daily 该动 report: windows, role budgets, fairness, report rendering |
| `src/host/tools.js` | host | Assistant tools (`gantt_context`, `gantt_decompose`, `gantt_update_task`), task-reference resolution, and automatic provenance recording |
| `src/host/prompt.js` | host | Static task-protocol section and dynamic focus trajectory context (optional `systemPrompt`) |
| `src/client/` | client | Plugin entry, the Gantt/Today pages, the right-rail `panel` tab, brief strip, dialogs, and stylesheet modules (ESM) |
| `src/shared/` | both | Status vocabularies imported by the host and bundled into the client |
| `lib/client.js` | artifact | Build output: one classic script registered through `window.__ModuleLoader__.load` (gitignored) |

The four `src/host/` facades (`store.js`, `tree.js`, `tracker.js`, `daily.js`)
only re-export, so tests and the entry keep a stable import surface while the
implementation stays split by concern.

### Build

`pnpm run build` runs `scripts/build-client.mjs`: rolldown bundles
`src/client/index.js` as CommonJS with `react` external, then wraps the result
in the loader factory the harness calls. The output must stay one classic
script — DSH derives the artifact revision from `exports["./client"]` metadata
only (mtime, ctime, size) and serves chunk URLs as immutable, so runtime-split
chunks would keep the old revision and stale bytes. `react` arrives through the
factory `require`, so leave it external. The artifact is gitignored; the e2e
gate rebuilds it before driving it, and `pnpm run deploy` builds it before
linking the checkout.

## Quality gate commands

| Command | What it runs | What it enforces |
| --- | --- | --- |
| `pnpm run verify` | `node --check` on every source, test, and script file | Syntax only; the fastest smoke check. |
| `pnpm run build` | `scripts/build-client.mjs` (rolldown) | Rebuilds `lib/client.js` from `src/client/`; required after client edits. |
| `pnpm run lint` | `oxlint` | Lint rules and unused code. |
| `pnpm run lint:fix` | `oxlint --fix` | Auto-fixes what it can; review the diff afterwards. |
| `pnpm run typecheck` | `tsc --noEmit` against all three tsconfigs | Host under `strict`; client and tests under `checkJs` with looser settings. |
| `pnpm run static` | `lint` then `typecheck` | The commit gate: static analysis only, ~3 seconds. |
| `pnpm run test` | `vitest run --project host --project client` | Unit behavior in Node and jsdom. |
| `pnpm run coverage` | `vitest run --project host --project client --coverage` | Unit behavior plus per-file thresholds. |
| `pnpm run e2e` | rebuild + `vitest run --project e2e` | The shipped client artifact, real HTTP, the real route handlers, and a real SQLite file. |
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

- `src/host/**` and `src/shared/**`: **100%** statements, branches, functions,
  lines, enforced per file. The four re-export facades count as `0/0`
  statements in the report, so they print as `0%` rows while the threshold run
  still passes.
- `src/client/**`: ratcheted floor per file — 99% statements, 98% branches, 99%
  functions, 99% lines. The measured values are printed by `pnpm run coverage`
  and only ratchet up.
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
- **2026-11-15 — `clock.js` added at 100%.** The task-day clock decides which
  date "today" is and when the next 08:00 fires; a wrong zone or an unparsed
  override would silently shift every date and the scheduler, so every branch
  (including the invalid-override fallback) is pinned by
  `tests/store/clock.spec.js`.
- **2026-11-15 — `daily.js` added at 100%.** The daily-brief engine decides
  which task goes into which window; a partial branch would silently mis-plan a
  day. The later `tools.js` / `tree/chain.js` split keeps the same per-file 100%
  floor: the assistant tools write tasks, so their reference resolution and
  error mapping are covered like routes.
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
  perspectives with path pruning, and the right-hand AI surface (now the
  conversation tab) add a second feature layer to the same single classic
  script. The artifact still cannot be split (see `docs/compatibility.md` §3.1),
  so the ratchet moves with the features. Revisit before a fourth raise: the
  right answer is a bundled single artifact (bundler output into `client.js`, so
  the entry metadata still changes) or moving one surface (the Today page or the
  conversation tab) out of the page, not an ever-growing monolith.
- **2026-11-15 — the file-size rule wins over the single-file client; the
  ratchet cap is retired.** Root modules were 348–996 lines and the client
  artifact 4140, which made every small change read a whole file. The plugin now
  follows the reference `dsh-context` layout: `src/host/` and `src/client/` hold
  one concern per file (<1000 lines each), and `scripts/build-client.mjs`
  (rolldown) emits the single `lib/client.js` artifact. The artifact is still
  one classic script, so the DSH revision contract in
  `docs/compatibility.md` §3.1 is unchanged; `lib/` is gitignored build output,
  `prepare`/`deploy`/`e2e` rebuild it, and `pnpm run verify` syntax-checks every
  source file instead of a fixed list. This intentionally supersedes the
  earlier "no build step / 4800-line cap" decisions.

## Test layout

| Directory | Project | Covers |
| --- | --- | --- |
| `tests/store/` | `host` (Node) | `src/host/store/`, `src/host/tree/`, `src/host/clock.js`, and `src/host/daily/`: task-day dates and next 08:00 (default zone, override, invalid fallback), schema v5 migration and the additive `focus`/`task_events` tables, conversation focus persistence/cascade, task-event trajectory, tracker materialization and state preservation, stale-row handling, dates, numbering, rollups, validation, CRUD, split, seed, delete, decompose and schedule transactions, links, plan upserts and integrity, daily-brief windows/budgets/fairness/persistence/lookup rules |
| `tests/host/` | `host` (Node) | `src/host/routes/`, the entry, `src/host/tools.js`, and `src/host/tree/chain.js`: all nineteen routes, body parsing, status codes, error mapping, store lifecycle, `tree` + `brief` + `dailyBrief`, the brief read/recompute routes, the focus read/set/clear routes, the trajectory read route, `decompose`/`schedule`/`context`, the day/plan routes, assistant tool definitions/reference resolution/execution, per-session context, automatic tool provenance, static/dynamic prompt context registration, and registration no-op without a tools or systemPrompt service |
| `tests/tracker/` | `host` (Node) | `tracker.js`: markdown parsers (schedule board, tree, daily card), slot derivation, import counts, hostile/truncated input |
| `tests/client/` | `client` (jsdom) | `src/client/` modules: rendering the unified tree (track/node metadata, links chips), brief strip blocks and window cards, perspectives and path pruning, decompose/schedule/context dialogs, the right-rail conversation tab (focus, clear, refresh, paused while hidden, five recent trajectory entries, loading/error/empty), tree/time-axis behavior, Today page with the 该动 section, locale strings, error and empty states |
| `tests/e2e/` | `e2e` (jsdom + node:http) | The real seams end to end: module-loader artifact contract, relative `fetch`, HTTP status/headers, route handlers, tracker import through a fixture directory (six roots and the imported nodes in `/tree`), decompose → a new block in `/day`, the daily-brief read/recompute routes and tree/day wiring, a focus HTTP round trip, a trajectory read after an assistant-tool write, a committed v2-schema fixture (`tests/helpers/v2.js`, no skipped tests) upgrading to schema 5, and a SQLite file that survives a restart |
| `tests/helpers/` | — | Shared fixtures and a fake host context for the `host` project |

New in the native-conversation round: `tests/store/focus.spec.js`,
`tests/host/routes-focus.spec.js`, `tests/host/chain.spec.js`, and
`tests/host/tools.spec.js`, plus `tests/client/panel.spec.js`; the e2e chat
`503` case became a focus HTTP round trip, and the old `chat.spec.js` files and
the fake `llm` helper were removed. The trajectory round adds
`tests/store/events.spec.js` and `tests/host/prompt.spec.js` and extends the
store, host, client, and e2e suites with task-event/provenance, trajectory-route,
and prompt-context cases (`task_events` migration, tool session/turn recording,
`gantt_context` 任务轨迹, right-rail five-entry view). Earlier daily-brief /
clock tests (`tests/store/clock.spec.js`, `tests/store/daily-brief.spec.js`,
`tests/store/schema-v4.spec.js`, `tests/host/routes-brief.spec.js`,
`tests/e2e/brief.spec.js`) remain.

`tests/client/setup.js` boots jsdom and resets the document between specs; the
harness imports the plugin from `src/client/index.js` directly. The client
suite has no network access; fetch is mocked per spec.

`tests/e2e/setup.js` captures the built artifact through the
`window.__ModuleLoader__` stub, and the suite is a real integration:
`tests/e2e/server.js` boots the host half against a temporary database file
behind a real `node:http` server, and the shipped `lib/client.js` requests it
over the wire. `tests/e2e/artifact.spec.js` pins the single-file classic-script
contract that DSH's cache revision depends on. Keep this suite small —
exhaustive cases belong in the unit projects.

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

### Task-day clock

The host process may run in UTC (this deployment does) while the tracker's plan
dates and the user's morning are wall-clock local. `clock.js` resolves "today"
and the next 08:00 in an explicit IANA zone:

- `DSH_GANTT_TZ` overrides the zone; unset/blank uses `Asia/Shanghai`.
- An invalid override falls back to the default instead of failing reads.
- `todayIso`/`nextEightAm` are re-exported through `src/host/tree.js`,
  `src/host/daily.js`, and `src/host/store.js`, so response `today` fields,
  default task dates, `持续` end dates,
  and the brief scheduler all agree with the browser. The default zone has no
  DST.

Because UTC is 8 hours behind the default zone, "today" can already be the next
calendar day while the host's UTC clock still shows the previous one. Set
`DSH_GANTT_TZ=UTC` only when a test or fixture intentionally expects host dates.

The stored columns and their API field mapping are documented under
[the task object](api.md#task-object); `GET /api/gantt/meta` reports the
resolved path, schema version, and row count at runtime.

### Schema version 5: one working tree plus daily reports and trajectory

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
`plan_blocks` and `day_plans` remain the time grid. Schema version 4 added
`daily_briefs` (`plan_date` primary key, `generated_at`, `source`, `report`
JSON), the persisted daily 该动 snapshots, plus `focus` (`session_id` primary
key, `task_id` foreign key with `ON DELETE CASCADE`, `updated_at`) for the
right-rail tab and assistant tools. The `focus` table is created by the base
schema's `CREATE TABLE IF NOT EXISTS` without a schema-version bump, survives
host restarts, and is cleared when its task is deleted. Schema version 5 adds
`task_events` (`id`, `task_id` foreign key with `ON DELETE CASCADE`,
`session_id`, `turn`, `action`, `detail`, `created_at`) with indexes on
`(task_id, created_at)` and `(session_id, created_at)`; it is created on every
open and has no data backfill. The rationale is in
[personal-task-system.md](personal-task-system.md), the layering table in
[compatibility.md](compatibility.md#4--data-model-layering-and-migration).

The host also starts an in-process scheduler: a `setTimeout` to the next 08:00
in the task-day zone recomputes today's report with `source: 'auto'`; the timer
is unref'ed and disposed with the plugin, so it only runs while `dsh web` is up.

#### Migrate a v2, v3, or v4 database

The host runs the append-only migration when it opens a database whose
`PRAGMA user_version` is below 5. A v2 database additionally gets the twelve
`tasks` columns, the `(kind, ref)` index, and the one-time backfill of
`tracks`/`nodes` into `tasks`; a v3 database keeps `tasks` untouched and gains
`daily_briefs`; a v4 database keeps the tree and reports and gains only
`task_events` (plus its indexes). No event backfill runs.

1. Stop `dsh web`, then copy the database aside:
   `cp "$DSH_HOME/gantt/tasks.db" /tmp/tasks.v3.db` (also copy `-wal`/`-shm` if
   present, or run `sqlite3 tasks.db 'PRAGMA wal_checkpoint(TRUNCATE)'` first).
2. Start the new build / restart `dsh web`. No separate migration command
   exists; opening the store performs it.
3. Verify with `GET /api/gantt/meta`: `schemaVersion` is `5` and `taskCount`
   is unchanged on a v3/v4 upgrade. `GET /api/gantt/tree` still has the same
   tree and now carries `dailyBrief`; `GET /api/gantt/brief` computes and caches
   today's report; `GET /api/gantt/trajectory` returns an empty `events` array
   until the first assistant-tool write.
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
3. Edit `src/host/`: these modules run in the `dsh web` server process and are
   re-read on restart, so restart `dsh web` after host changes. The daily-brief
   scheduler restarts with the process.
4. Edit `src/client/`, then run `pnpm run build`: the artifact file changes, so
   DSH derives a new client artifact revision and a page reload picks up the new
   bytes. Forgetting the build serves the previous artifact — run
   `pnpm run build` whenever `git status` shows `src/client/` edits.
5. Run the narrow test first (`pnpm exec vitest run tests/<area> -t "…"`), then
   commit and push. The commit hook runs the static check; the push hook runs
   the full gate before anything reaches `main`.

### Install a checkout

The package is private, so it is always installed from a directory: the GUI
`plugin_manager install_bundle { target: "/absolute/path/to/dsh-gantt" }`, the
CLI `dsh plugin --profile web add /absolute/path/to/dsh-gantt`, or the scripted
deploy. All three record a pnpm `link:` dependency plus the bundle selection
that makes the plugin part of the profile — nothing is copied. The right-rail
conversation tab additionally needs `dsh-better-sidebar` in the same profile; the
full pages and API work without it, and the assistant tools need the host
`tools` service.

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

- `src/host/` modules are re-read when `dsh web` starts — restart after editing
  them.
- `lib/client.js` is served from this directory on every page load and its
  revision follows the file metadata; rebuild (`pnpm run build`) and reload to
  serve new browser bytes.
- No edit requires a reinstall. Run `pnpm run deploy` again only when the
  profile lost the link (profile reset, DSH reinstall, or another checkout won
  the dependency); `pnpm run deploy --check` reports which part is missing.

## Verification procedure

### Automated

```sh
pnpm run verify    # syntax-check every source, test, and script
pnpm run build     # rebuild lib/client.js from src/client/
pnpm run check     # lint + typecheck + unit coverage + e2e (rebuilds the artifact)
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
# Conversation focus (the right-rail tab writes this; the assistant tools read it):
curl -s -H "Cookie: $COOKIE" "http://127.0.0.1:3080/api/gantt/focus?sessionId=demo"
curl -s -H "Cookie: $COOKIE" -X POST -H 'content-type: application/json' \
  http://127.0.0.1:3080/api/gantt/focus/set \
  -d '{"sessionId":"demo","taskId":"<task-id>"}'
curl -s -H "Cookie: $COOKIE" "http://127.0.0.1:3080/api/gantt/focus?sessionId=demo"
curl -s -H "Cookie: $COOKIE" -X POST -H 'content-type: application/json' \
  http://127.0.0.1:3080/api/gantt/focus/set \
  -d '{"sessionId":"demo","taskId":null}'
# Task trajectory (empty until an assistant tool writes):
curl -s -H "Cookie: $COOKIE" "http://127.0.0.1:3080/api/gantt/trajectory?taskId=<task-id>&limit=5"
```

Expected: every `today` field is the task-day date (`Asia/Shanghai` unless
`DSH_GANTT_TZ` says otherwise), not necessarily the host's UTC date. `meta`
returns `{ok:true, dbPath:"$DSH_HOME/gantt/tasks.db", engine:"node:sqlite",
schemaVersion:5, kinds:[…], linkTypes:[…], endpoints:[…19 routes…]}`; `seed`
on an empty database inserts 13 demo tasks and returns
`seeded:true, taskCount:13` plus the snapshot; `tree` returns the
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
`brief/compute` returns the same shape with `source: 'manual'`; the focus GET
returns `{ok:true,taskId:null}` before the set, the set returns the canonical
task id, a second GET returns it, and clearing returns `taskId:null`;
`trajectory` returns `{ok:true,events:[]}` until an assistant tool records an
event, and `{ok:true,events:[…]}` newest-first afterwards. The assistant tools
are not HTTP routes: they are verified through a native conversation in the
manual checklist below, and by `tests/host/tools.spec.js`.
An invalid JSON body returns HTTP 400 with
`{"ok":false,"error":"request body must be valid JSON"}`.

Remove the disposable home when done: `rm -rf /tmp/dsh-gantt-verify`.

### Slot registration

In the connected DSH Web GUI, use `cordis_inspect_query` → Client
`Slots.listSubTree`:

- `root: "sidebar.panellist"` shows the `gantt` and `today` entries.
- `root: "main"` shows the pages registered under keys `gantt` and `today`.

Registration proves composition, not rendering. The right-rail conversation tab
is a `dsh-better-sidebar` extension rather than a `main`/`sidebar.panellist`
slot, so it does not appear in `Slots.listSubTree`; check it in the conversation
sidebar itself.

### Manual GUI checklist

jsdom tests prove behavior; they do not prove paint or layout. The browser half
is a build output since 1.5.0: run `pnpm run build` and reload before this pass.
Open the page in the connected Web GUI and check:

- [ ] The sidebar icon appears with the localized label and opens the page in
      the center column, like the built-in pages.
- [ ] The title row keeps a compact header: no intro paragraph by default, just
      a small info button next to the title. Clicking it floats the intro text
      below the button; clicking outside the popover or pressing Escape closes
      it, in both locales and at narrow widths.
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
- [ ] The brief strip is an inset card with the frontier column/chevron in the
      brand accent and the 该动 column/chevron in the success colour, clearly
      separated from the plain task list below; the fold chevron collapses it to
      a compact `前沿 n · 该动 m · 今天 filled/total` summary (the grid and window
      cards hide) and expands back without breaking the three-column alignment.
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
- [ ] With `dsh-better-sidebar` installed, the conversation sidebar shows a
      **甘特** tab. It renders the compact tree with refs, status dots, and kind
      labels; clicking a row focuses it (chip + highlight), **clear** removes
      the focus, **refresh** reloads, an empty tree shows its hint, and the tab
      pauses refresh while it is not visible.
- [ ] With a focus set, the tab header shows up to five task-trajectory entries
      (action, turn, time, detail; full session id in the row tooltip), newest
      first.
- [ ] In a native conversation with that focus set, ask the model to decompose
      the task: it calls `gantt_context` (the focused chain and its
      `## 任务轨迹（会话与轮次）` section), then `gantt_decompose`, and the new
      children appear in the tree without any propose/apply card.
      `gantt_update_task` changes a task's
      status/progress/title/`doneWhen` the same way.
- [ ] After those tool calls, `GET /api/gantt/trajectory?taskId=…` shows the
      `decompose`/`create`/`update`/`complete` events with the conversation's
      full session id and turn; a new conversation focused on the same task
      receives the ancestor chain, focus detail, and recent trajectory via the
      `gantt:focus` runtime context.
- [ ] With `systemPrompt` absent, the plugin still starts and the tools/API keep
      working; with it present, repeated turns on an unchanged focus do not
      append a new runtime-context snapshot.
- [ ] Without `dsh-better-sidebar`, the full `/gantt` page still works and has
      no AI button or in-page chat panel; without a host tools service, the
      conversation simply has no assistant tools.
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

### Dates are off by one day

The host process runs in UTC, but task days and the 08:00 recompute resolve in
the task-day zone (`DSH_GANTT_TZ`, default `Asia/Shanghai`). Late in the UTC
evening the task day is already the next calendar day, so "today" can differ
from `date -u`. That is intended; set `DSH_GANTT_TZ` for a different wall clock
or `UTC` only for fixtures that expect host dates.

### The daily brief looks stale or empty

The report is a stored morning snapshot: it reflects the tree when it was
generated, so status edits made later in the day do not move its picks. Press
**Recompute** (or `POST /api/gantt/brief/compute`) to refresh it; the host also
recomputes at the next 08:00 in the task-day zone only while `dsh web` is
running. An empty
window list usually means an `unknown` day kind with no plan blocks — import the
day plan or classify the day. See `docs/compatibility.md` §5 for the full list.

### The right-rail 甘特 tab is missing

The tab is registered through the optional `dsh-better-sidebar` client service
(`ctx.inject(['betterSidebar'], …)`). If that plugin is not installed/enabled,
the injection never resolves and no tab appears — the full `/gantt` page and
every API route still work. Enable/install the sidebar plugin, reload the page,
and confirm the tab in the conversation sidebar (it is not a
`main`/`sidebar.panellist` slot, so it is not in `Slots.listSubTree`).

### Assistant tools do nothing

The tools are registered on the optional host `tools` service; without it,
`registerTools` is a no-op. They are global tools, but they act on the calling
conversation's focus: set a task in the right-rail tab (or via
`POST /api/gantt/focus/set`) first. Tool errors keep the `GanttError` status
(`400` validation, `404` unknown task) and are returned to the model; the plugin
never calls an LLM itself, so a model that is unavailable or lacks tool access is
a harness-side concern, not a plugin failure.

### The model does not see the gantt protocol or focus context

The static protocol section (`gantt:protocol`) and the dynamic focus
context (`gantt:focus`) are contributed only when the host exposes the optional
`systemPrompt` service; the plugin declares that dependency lazily with
`ctx.inject(['systemPrompt'], …)` and skips registration when it is absent.
Without it, tools and routes still work but the conversation has to discover the
protocol and focus through `gantt_context` instead of prompt context. With the
service present, check that the focus is set for the same conversation id and
that the runtime snapshot updates only when the rendered text changes.

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
then restart `dsh web`: a running process serves the linked `lib/client.js`
on reload, but a host-side change under `src/host/` (or the bundle patch) needs the
restart. After editing `src/client/`, run `pnpm run build` before reloading.

### The page shows old client code

The browser half is a build output: run `pnpm run build` from the checkout, then
reload. If it is still stale, confirm the profile links this checkout
(`pnpm run deploy --check`) and that `lib/client.js` exists — the served
artifact revision follows that file's metadata, so a rebuilt, linked artifact is
served without a reinstall. `lib/` is gitignored, so a fresh clone needs one
`pnpm run build` (or `pnpm install`, whose `prepare` hook builds it).

### `main` is protected against force-pushes and deletion

The administrator rules are enforced too, so `git push --force origin main` and
deleting the branch are rejected. Ordinary pushes are fine: there is no pull
request requirement and no server-side status check — the local `pre-push` gate
is the control. Release tags are not branches, so
`pnpm run release X.Y.Z --push` pushes the tag directly.
