# dsh-gantt

A DeepSeek Harness plugin: a hierarchical task Gantt page in the Web UI, backed
by a local SQLite database and an authenticated JSON API.

## Shape

- Layout mirrors the reference plugin: `src/host/` (runs in the `dsh web`
  process), `src/client/` (browser modules), `src/shared/` (plain data used by
  both halves). One concern per file; every source file stays under 1000 lines.
- Host entry `src/host/index.js` owns the store lifecycle, the 08:00 scheduler,
  and the `ctx.get` model seam; `routes/` holds the seventeen `/api/gantt/*`
  route specs split by resource (plumbing in `http.js`); `store/` owns SQLite
  and brief persistence; `tracker/` parses and imports the tracker markdown;
  `tree/` holds pure tree/brief/context helpers; `clock.js` resolves task-day
  dates; `daily/` builds the daily 该动 report; `chat/` assembles the model
  prompt and parses proposals. The `store.js`/`tree.js`/`tracker.js`/`daily.js`/
  `chat.js` facades keep the public surface stable for tests.
- Client: `src/client/` ESM modules (plugin entry, two pages, brief strip,
  dialogs, styles) bundled by `scripts/build-client.mjs` (rolldown) into the
  gitignored `lib/client.js` — one classic script registered through
  `window.__ModuleLoader__.load`, with React supplied by the factory `require`.
  DSH derives the artifact revision from `exports["./client"]` metadata only, so
  the artifact stays one file; rebuild after client edits, never commit `lib/`.
- One working tree: imported tracks/nodes, manual tasks, and decomposed tasks
  all live in `tasks`; `tracks`/`nodes` are import snapshots only. `daily_briefs`
  stores the derived daily report as a morning snapshot, refreshed by recompute
  or the 08:00 run. Details in `docs/personal-task-system.md`.
- Harness behavior: read the installed `@deepseek-ai/dsh` package under
  `/data/app/node_modules/@deepseek-ai/` (`README.*`, `lib/`) before deciding
  anything; never guess a seam. `docs/compatibility.md` owns the supported set.

## Gates

No pull requests: work commits straight to `main`, gated by two local hooks.

- `pre-commit` → `pnpm run static` (lint + typecheck, ~3 s).
- `pre-push` → `pnpm run check`: static + unit coverage thresholds + e2e in
  parallel (~25 s cold; the e2e gate rebuilds `lib/client.js` first). A green
  run is cached in `.tmp/check.stamp` for 60 min and skipped while the tree is
  unchanged; the push is refused unless the stamp matches the pushed tree, so
  commit or stash first. `--full` forces a run.
- Never `--no-verify`, never push a red or uncommitted tree, no history rewrites.
- Coverage floors live in `vitest.config.ts` and ratchet up: 100% per file for
  `src/host/**` and `src/shared/**`; 99/98/99/99 per file for `src/client/**`.
  Weakening one needs a recorded decision in `docs/development.md`.
- CI runs the same gate only on `v*` release tags
  (`.github/workflows/release.yml`); branches have no CI.

## Rules

- UX, data accuracy, and data integrity first; never trade them for refactors,
  speed, or convenience. Verify with real tests, not assumptions.
- SQLite is the source of truth. One working tree in `tasks`; `tracks`/`nodes`
  are import snapshots, never a second UI tree. Hierarchy numbers, stats,
  frontier/next, and context markdown are derived at read time, never stored.
  Parent rollups are a cache: a parent that loses its last child keeps its last
  rolled-up values (known limitation in `docs/compatibility.md`). The daily
  report is a snapshot, not live state; the model only proposes, and no tool
  schemas are sent. Dates and the 08:00 recompute resolve in the task-day zone
  (`DSH_GANTT_TZ`, default `Asia/Shanghai`), not the host time zone.
- Multi-row writes use one `BEGIN IMMEDIATE` transaction; validate before
  mutating (dates, status vocabulary, progress bounds, parent existence,
  cycles). The client refetches after every write and shows an error banner
  instead of stale data.
- Smallest change that fully solves it; reuse existing helpers; no abstraction
  with a single caller, no unused option; delete dead code and old tests.
- All source and test files < 1000 lines; split by concern when a file grows.
- Tests: `tests/store|host|client` (unit, Node/jsdom) and `tests/e2e` (real
  artifact → real HTTP → real SQLite; small, behavior only). Narrowest run
  first: `pnpm exec vitest run tests/<area>/<file>.spec.js -t "<case>"`.
  Cover hostile input and validation failures.
- English only in code, comments, tests, docs, and commits. UI copy: `en` + `zh`
  dictionaries complete and in parity, every string through `t()`.
- JSDoc on exported types/functions; prose comments only for non-obvious
  platform constraints (e.g. the artifact revision rule), never line narration.
- Temp files only in `.tmp` (gitignored); delete them after use.
- No leaks on either side; no unbounded polling or duplicate refreshes.
- Layout: the pane is the shell's center column, so its width varies — use
  container queries, not viewport breakpoints. Fold, never crush; verify desktop
  → ~390 px, both locales, light and dark, a long tree.
- Zero runtime dependencies (Node built-ins + loader-provided React). Dev
  tooling is pinned and locked (rolldown builds the browser half); update one
  concern at a time.
- Conventional Commits, English, imperative subject, one concern per commit.
- Release: `pnpm run release X.Y.Z --push` (validates a clean, synced `main` and
  its version, runs the full gate, tags, pushes, waits for the workflow).
  Private package, never published to npm.

## Runbook

- `pnpm install` (the `prepare` hook builds the browser half); `pnpm run build`
  after client edits; `pnpm run verify` syntax-checks every source and test.
- Live UI: start `dsh web`, open the printed `http://127.0.0.1:3080/?token=…`
  URL once (it sets the session cookie). DB: `$DSH_HOME/gantt/tasks.db`,
  override with `DSH_GANTT_DB`; task-day zone `DSH_GANTT_TZ` (default
  `Asia/Shanghai`).
- Install a checkout: `pnpm run deploy` (builds, links, checks composition;
  `--check`, `--uninstall`), or the GUI
  `plugin_manager install_bundle { target: "/abs/path" }`; restart `dsh web` for
  host-side changes, rebuild + reload for client changes. The install is a link,
  so an edit needs no reinstall.
- `docs/` is lowercase, English, links kept valid. Details — setup, test layout,
  manual checklist, acceptance pass, API — in `docs/development.md`,
  `docs/api.md`, `docs/compatibility.md`.
