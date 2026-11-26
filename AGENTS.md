# dsh-gantt

A DeepSeek Harness plugin: a hierarchical task Gantt page in the Web UI, backed
by a local SQLite database and an authenticated JSON API.

## Shape

- Host `src/host/`: `index.js` owns the store lifecycle, the 08:00 scheduler, and
  route/tool/prompt registration; `routes/` holds twenty-eight route specs incl.
  `focus.js`/trajectory, `work.js`, and `agents.js` (plumbing in `http.js`);
  `store/` owns SQLite, briefs, `task_events`, the agent registry, the task ⇄
  work-conversation mapping, and the long-run knowledge table; `tracker/` parses the tracker markdown; `tree/` holds pure
  tree/brief/context/chain helpers; `clock.js` resolves task-day dates; `daily/`
  builds the daily report; `tools.js` declares the six assistant tools and records
  provenance; `knowledge.js` declares the knowledge pair only the gantt-long-run
  preset registers; `long-run.js` is that preset's plugin entry (declared in
  `cordis.patch.yml`); `mcp.js` is the external-agent JSON-RPC server behind
  `bin/gantt-mcp.js`. Four facades keep the public surface stable for tests.
- Client `src/client/`: ESM modules (plugin entry, Gantt/Today pages, the
  right-rail `panel` tab and `gantt-work` workbench tab, work-mode navigation,
  active-page restore across client reloads, page-state restore across visits
  (timeline view, highlight, work panel), dialogs, styles) bundled by
  `scripts/build-client.mjs` (rolldown) into gitignored `lib/client.js` — one
  classic script registered through `window.__ModuleLoader__.load`, React from
  the factory `require`. DSH derives the artifact revision from
  `exports["./client"]` metadata only; rebuild after client edits, never commit
  `lib/`.
- One working tree: imported tracks/nodes, manual tasks, and decomposed tasks
  live in `tasks`; `tracks`/`nodes` are import snapshots only. `daily_briefs` is
  a morning snapshot; `focus` stores one task per conversation; `work_sessions` maps a task to its
  content-dedicated main conversation; `task_events` is the append-only
  session/turn trajectory (`create`/`update`/`complete`/`decompose`/`track`);
  `knowledge_entries` is the long-run preset's judgment store, task-linked and
  unlinked (never deleted) when its task goes. Details in
  `docs/personal-task-system.md`.
- Harness behavior: read the installed `@deepseek-ai/dsh` package under
  `/data/app/node_modules/@deepseek-ai/` (`README.*`, `lib/`) before deciding
  anything; never guess a seam. `docs/compatibility.md` owns the supported set.

## Gates

No pull requests: work commits straight to `main`, gated by two local hooks.

- `pre-commit` → `pnpm run static` (lint + typecheck, ~3 s).
- `pre-push` → `pnpm run check`: static + coverage + e2e in parallel (~25 s
  cold; e2e rebuilds `lib/client.js`). A green run is cached in
  `.tmp/check.stamp` for 60 min; the push is refused unless the stamp matches
  the tree, so commit or stash first. `--full` forces a run.
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
  report is a snapshot, not live state; assistant tools write through the store
  (validation is the guard) and append `task_events` with the session and turn;
  the plugin never calls an LLM, and optional `systemPrompt` carries the
  protocol/focus context. Dates and the 08:00 recompute resolve in the task-day
  zone (`DSH_GANTT_TZ`, default `Asia/Shanghai`), not the host time zone.
- Multi-row writes use one `BEGIN IMMEDIATE` transaction; validate before
  mutating (dates, status, progress, parent existence, cycles). The client
  refetches after every write and shows an error banner, never stale data.
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
- Layout: the pane is the shell's center column; use container queries, not
  viewport breakpoints. Fold, never crush; verify desktop → ~390 px, both
  locales and themes, a long tree.
- Zero runtime dependencies (Node built-ins + loader-provided React); dev
  tooling is pinned and locked (rolldown builds the browser half).
- Conventional Commits, English, imperative subject, one concern per commit.
  When the work belongs to a Gantt task (the focused task, or the task this
  session is working under), end the subject with its point number —
  `feat(today): keep the plan row bold (1.8.1)`; template in
  `CONTRIBUTING.md`, enforced for remote workers by the MCP `get_worker_guide`.
- Release: `pnpm run release X.Y.Z --push` (validates a clean, synced `main` and
  its version, runs the full gate, packages, tags, pushes, waits for the
  workflow). The artifact is `pnpm run package`: one tarball for both deployment
  units (plugin bundle + MCP sidecar) plus `SHA256SUMS`, attached to the GitHub
  Release. Private package, never published to npm.

## Runbook

- `pnpm install` (the `prepare` hook builds the browser half); `pnpm run build`
  after client edits; `pnpm run verify` syntax-checks every source and test.
- Live UI: start `dsh web`, open the printed `http://127.0.0.1:3080/?token=…`
  URL once (it sets the session cookie). DB: `$DSH_HOME/gantt/tasks.db`,
  override with `DSH_GANTT_DB`; task-day zone `DSH_GANTT_TZ` (default
  `Asia/Shanghai`).
- Install with `pnpm run deploy` (`--check`, `--uninstall`) or GUI
  `plugin_manager install_bundle`; restart for host changes, rebuild+reload for client.
  The deployed profile pins the release tarball (`file:`), so this checkout is
  not live there: re-link with `pnpm run deploy` before iterating and repackage
  to ship (`docs/development.md`, "Iterating against a pinned deployment").
- `docs/` is lowercase, English, links kept valid. Details — setup, test layout,
  manual checklist, acceptance pass, API — in `docs/development.md`,
  `docs/api.md`, `docs/compatibility.md`.
