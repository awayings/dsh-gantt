# dsh-gantt

A DeepSeek Harness plugin: a hierarchical task Gantt page in the Web UI, backed
by a local SQLite database and an authenticated JSON API.

## Shape

- Host half, six modules (run in the `dsh web` process): `index.js` registers
  the seventeen `/api/gantt/*` routes through the Connection service;
  `store.js` owns SQLite and the 08:00 brief scheduler; `tracker.js` parses and
  imports the tracker markdown; `tree.js` holds the pure tree helpers;
  `daily.js` builds the daily 该动 report; `chat.js` calls the optional model
  and parses decomposition proposals.
- Client half `client.js`: one browser artifact loaded by the DSH module loader;
  registers two sidebar icons and two keyed `main` pages (`gantt`, `today`), with
  the brief strip, perspectives, and an optional AI sidebar on the Gantt page.
- **No build step**, no bundler, no `dist/`: all seven files ship as source.
  `client.js` must stay one classic script — DSH derives the artifact revision
  from `exports["./client"]` metadata (mtime/ctime/size) only, so splitting the
  entry would serve stale bytes from the immutable cache. Cap: 4800 lines.
- One working tree: imported tracks/nodes, manual tasks, and decomposed tasks
  all live in `tasks`; `tracks`/`nodes` are import snapshots only. `daily_briefs`
  stores the derived daily report as a morning snapshot, refreshed by recompute
  or the 08:00 run. Details in `docs/personal-task-system.md`.
- Harness behavior: read the installed `@deepseek-ai/dsh` package under
  `/data/app/node_modules/@deepseek-ai/` (`README.*`, `lib/`, `lib/types/`)
  before deciding anything. Never guess a seam, lifecycle, or wire shape.
  `docs/compatibility.md` is the source of truth for supported versions, seams,
  and known limitations.

## Gates

No pull requests: work commits straight to `main`, gated by two local hooks.

- `pre-commit` → `pnpm run static` (lint + typecheck, ~3 s).
- `pre-push` → `pnpm run check` (static + unit coverage thresholds + e2e, in
  parallel, ~15 s cold). A green run is cached in `.tmp/check.stamp` for 60 min
  and skipped while the tree is unchanged; the push is refused unless the stamp
  matches the pushed tree, so commit or stash first. `--full` forces a run.
- Never `--no-verify`, never push a red or uncommitted tree, no history rewrites.
- Coverage floors live in `vitest.config.ts` and ratchet up: 100% for `store.js`,
  `index.js`, `tracker.js`, `tree.js`, `daily.js`, and `chat.js`; `client.js`
  99/98/99/99.
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
  schemas are sent.
- Multi-row writes use one `BEGIN IMMEDIATE` transaction; validate before
  mutating (dates, status vocabulary, progress bounds, parent existence,
  cycles). The client refetches after every write and shows an error banner
  instead of stale data.
- Smallest change that fully solves it; reuse existing helpers; no abstraction
  with a single caller, no unused option; delete dead code and old tests.
- All source and test files < 1000 lines (`client.js`: 4800 cap).
- Tests: `tests/store|host|client` (unit, Node/jsdom) and `tests/e2e` (real
  artifact → real HTTP → real SQLite; small, behavior only). Narrowest run
  first: `pnpm exec vitest run tests/<area>/<file>.spec.js -t "<case>"`.
  Cover hostile input and validation failures.
- English only in code, comments, tests, docs, and commits. UI copy: `en` + `zh`
  dictionaries complete and in parity, every string through `t()`.
- JSDoc on exported types/functions; prose comments only for non-obvious
  platform constraints (e.g. the single-file artifact rule), never line
  narration.
- Temp files only in `.tmp` (gitignored); delete them after use.
- No leaks on either side; no unbounded polling or duplicate refreshes.
- Layout: the pane is the shell's center column, so its width varies — use
  container queries, not viewport breakpoints. Fold, never crush; verify desktop
  → ~390 px, both locales, light and dark, a long tree.
- Zero runtime dependencies (Node built-ins + loader-provided React). Dev
  tooling is pinned and locked; update one concern at a time.
- Conventional Commits, English, imperative subject, one concern per commit.
- Release: `pnpm run release X.Y.Z --push` (validates a clean, synced `main` and
  its version, runs the full gate, tags, pushes, waits for the workflow).
  Private package, never published to npm.

## Runbook

- `pnpm install`; `pnpm run verify` = `node --check` on the seven sources.
- Live UI: start `dsh web`, open the printed `http://127.0.0.1:3080/?token=…`
  URL once (it sets the session cookie). DB: `$DSH_HOME/gantt/tasks.db`;
  override with an absolute `DSH_GANTT_DB`.
- Install a checkout: `pnpm run deploy` (link + composition check; `--check`,
  `--uninstall`), or the GUI `plugin_manager install_bundle { target: "/abs/path" }`;
  restart `dsh web` for host-side changes. The install is a link, so edits need
  no reinstall.
- `docs/` is lowercase, English, links kept valid. Details — setup, test layout,
  manual checklist, acceptance pass, API — in `docs/development.md`,
  `docs/api.md`, `docs/compatibility.md`.
