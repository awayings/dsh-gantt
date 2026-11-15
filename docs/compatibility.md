# Compatibility

Rules `dsh-gantt` holds on its supported `@deepseek-ai/dsh` release, and the
evidence for each. Paths marked `dsh:` are read from the installed harness under
`/data/app/node_modules/@deepseek-ai/`; unmarked paths are in this repository.
Source wins over this page.

Last verified: **2026-11-15** (`dsh-gantt` `1.3.0`; installed dsh
`0.2.2-rc.1`, Node `v24.22.2`). The `1.2.0` Today page and tracker import were
verified by the automated gate and the disposable-profile host acceptance pass;
the `1.3.0` unified task tree adds the schema-v3 migration and was verified by
the automated gate plus the real-database migration check. The manual GUI
checklist for the tree features is in `docs/development.md` and had not been run
at that date.

## 1 · Supported set

1. **Support dsh `0.2.2-rc.1`.** The plugin has no `engines.dsh` and no
   `@deepseek-ai/dsh*` peer dependency; it declares only `engines.node`
   (`^22.19.0 || >=24.0.0`). DSH `0.2.2-rc.1` itself requires Node
   `>=24.9.0` (`dsh: dsh/package.json:179`), the effective floor when running
   the plugin inside DSH.
2. **Zero runtime dependencies.** The host half uses Node built-ins
   (`node:sqlite`, `node:crypto`, `node:fs`, `node:path`, `node:os`); the client
   half uses the React and harness services supplied by the DSH client module
   loader. Harness packages are platform externals, named only in
   `package.json` `dsh.client.inject` and imported through the loader's
   `require`.
3. **Limitation — one verified line.** There is no compatibility matrix or
   automated multi-version CI. Compatibility is verified manually against the
   installed line (§6); a newer DSH release is unverified until that pass is
   repeated.

## 2 · Harness seams

*What this plugin is allowed to rely on.*

1. **Client chunk contract `window.__ModuleLoader__.load({ id, factory })`.**
   The loader is defined by the harness (`dsh:
   dsh-client-modules/lib/index.js:521`) and every client package uses the same
   shape (for example `dsh: dsh-client-locale/lib/client.js:1`). `client.js:1`
   follows it. The package must keep `exports["./client"]` pointing at the
   bundle: the harness resolves it through `clientExportOf` (`dsh:
   dsh-client-modules/lib/index.js:200`) and rejects a package that declares
   `dsh.client` without it.
2. **Host JSON routes through the Connection service.**
   `ctx.connection.fetch.register({ path, methods, requestBody, fetch })`
   registers an exact route on the shared authenticated `/api` channel
   (`dsh: dsh-client-connection/lib/types/rpc.d.ts:119-141`, service declared in
   `dsh-client-connection/lib/types/index.d.ts`; an in-tree usage is
   `dsh-client-file-upload/lib/index.js:179`). The route path is absolute below
   `/api`; `requestBody: 'buffered'` applies the channel's JSON cap; the handler
   returns a `Response`. `index.js` registers fourteen exact paths this way.
3. **A sidebar entry id selects the keyed `main` page.** The sidebar renders
   `sidebar.panellist` entries and calls `ctx.layout.selectPanel(id)`
   (`dsh: dsh-client-ui-sidebar/lib/client.js:223,719-720`); the layout renders
   the `main` slot with `entryKey: panelId`
   (`dsh: dsh-client-ui-layout/lib/client.js:127`) and `selectPanel` throws when
   no `main` entry has that key (`.../client.js:523`). The two registrations
   therefore must use the same id: `gantt`/`gantt` and `today`/`today`.
4. **Client services `slots` and `locale`.**
   `ctx.slots` is the renderer-owned `SlotRegistry` (`dsh:
   dsh-client-ui-renderer/lib/types/client/index.d.ts:27`, `register`/`inject`
   at `.../client/registry.d.ts:85,111`). `sidebar.panellist` is rendered by the
   sidebar (`dsh: dsh-client-ui-sidebar/lib/client.js:228`), `main` by the
   layout (`dsh: dsh-client-ui-layout/lib/client.js:127`). The locale service
   provides `register`/`bind`/`getSnapshot`/`subscribe` (`dsh:
   dsh-client-locale/lib/types/client/index.d.ts:136-219`). The client half
   injects exactly these two services, and `package.json` `dsh.client.inject`
   names the three packages that must arrive first.
5. **`node:sqlite`.** `store.js` opens `DatabaseSync` from `node:sqlite`; the
   module is a Node built-in, so no dependency is declared. WAL and
   `foreign_keys = ON` are set on open; the file is created under
   `$DSH_HOME/gantt/tasks.db` (or `DSH_GANTT_DB`). The schema is versioned with
   `PRAGMA user_version`; see §4 for the v2→v3 migration.
6. **The importer reads the task-tracker directory from the local filesystem.**
   `POST /api/gantt/plan/import` reads `SCHEDULE.md`, `TREE.md`, and
   `daily/YYYY-MM-DD.md` under the configured directory and writes only to
   SQLite. This is a deliberate, explicit pull: no file watch, no write-back,
   and no network access. The default path is this host's layout
   (`/data/home/clawd/projects/task-tracker`); other machines must set
   `DSH_GANTT_TRACKER_DIR` or pass `dir`.
7. **No external listener, token, or CORS setup.** All data routes ride the
   harness's existing `/api` cookie authentication; the plugin never binds a
   port or reads a credential. Treating the cookie as a credential is
   documented in `docs/api.md`.

## 3 · Rules

1. **`client.js` stays a single file.** DSH derives the client artifact
   revision from `exports["./client"]` metadata only — mtime, ctime, size
   (`dsh: dsh-client-modules/lib/index.js:222`) — and serves chunks with
   `public, max-age=31536000, immutable` (`dsh:
   dsh-client-modules/lib/index.js:188`). Splitting logic into
   `require('./client.foo.js')` chunks leaves the entry file's metadata
   unchanged, so the revision and chunk URLs do not change and the browser keeps
   the old bytes; even a plain reload can show stale code. Keep the file
   monolithic by section (`DICT_*`, `CSS_*`, helpers, components) and, if real
   splitting is ever needed, bundle back into one `client.js`. The ratchet cap
   is 3600 lines (`AGENTS.md`; 2300 → 2700 when the Today page landed, 2700 →
   3600 when the unified tree, decompose, schedule, and context dialogs landed —
   the reason and the revisit trigger are recorded in `docs/development.md`).
2. **One SQLite writer per database file.** One `GanttStore` is opened per DSH
   process in `apply()` and closed through `ctx.effect`. WAL allows concurrent
   readers, not concurrent writers: two DSH processes sharing one `$DSH_HOME`
   and one `tasks.db` can hit `SQLITE_BUSY`/`database is locked`. There is no
   cross-process arbitration; run one DSH process per database file or give each
   instance its own `DSH_GANTT_DB`.
3. **One working tree; the snapshots are provenance.** The Gantt page, the day
   bundle, and the context export read the unified tree in `tasks`
   (`kind='track' | 'node' | 'task'`). `tracks` and `nodes` keep the imported
   snapshot and the `(kind, ref)` upsert key; they are never rendered as a
   second tree. A new read surface must follow the same rule, otherwise the
   two-dataset split that schema v3 removed comes back.
4. **Locale dictionaries stay complete and in parity.** `DICT_EN` and `DICT_ZH`
   are registered once through `ctx.locale.register(NS, DICTS)` and every
   visible string goes through `t(...)`/`ctx.locale.bind(NS)`. Both
   dictionaries carry the same keys with no unused entries — the client test
   suite asserts parity; a missing key silently falls back, so a parity gap is a
   bug, not a graceful degradation.
5. **Errors are JSON, never HTML.** Every route returns
   `{ok:false,error}` with a 4xx/5xx status and `cache-control: no-store`; a
   non-Gantt throw maps to 500. The page shows an error banner plus a retry
   action instead of stale data.
6. **No second listener and no auth bypass.** Do not add a static server, a
   WebSocket, or an unauthenticated route to make development easier; the host
   half must stay inside the harness's `/api` channel on every release.
7. **Theme through tokens.** Colors and surfaces come from the harness's
   `--dsw-alias-*` theme tokens (plus `color-mix` for tints), so light/dark
   themes and host theme changes are inherited without a plugin theme state.
8. **Limitation — stale parent rollups.** `recomputeAncestors()` persists
   derived `start_date`/`end_date`/`progress`/`status` into every ancestor row,
   but `buildTree()` re-derives a node only while it *currently* has children.
   When the last child of a parent is moved away or deleted, the now-childless
   parent keeps the last rolled-up values (for example `done`/100% with no
   children), and the authored values it had before its first child are
   overwritten and unrecoverable. The behavior is pinned by
   `tests/store/crud.spec.js` ("retains the last rolled-up values when the final
   child moves away"). A fix needs a schema/design change and is not scheduled;
   do not rely on authored parent values surviving their first child.

## 4 · Data model layering and migration

Schema version 3 unifies the plugin's two previous datasets into one working
tree. `tracks`/`nodes` remain as import snapshots, and the importer materializes
them into `tasks` in the same transaction; the domain model is in
`docs/personal-task-system.md`.

**v2 → v3 upgrade (append-only, run once when the host opens the database):**

1. The migration adds 12 columns to `tasks` — `kind`, `ref`, `state`, `lane`,
   `dep`, `done_when`, `landing`, `estimate`, `category`, `inspiration`,
   `links`, `source` — each `NOT NULL DEFAULT`, so existing rows stay valid, and
   sets `PRAGMA user_version = 3`.
2. It adds the unique index `idx_tasks_ref ON tasks(kind, ref) WHERE ref <> ''`
   that makes `(kind, ref)` the import upsert key.
3. A **one-time backfill** materializes the existing `tracks`/`nodes` rows into
   `tasks`. Without it a real v2 database would have snapshots but no tree: the
   v2 store never wrote task rows for imported data. Track rows become
   `kind='track'` roots (title = name, description = blocker); node rows become
   `kind='node'` children of their dot-id parent (description = `done_when`);
   state, lane, dependency, and `done_when` are copied, and dates that the
   snapshots left `NULL` are filled as `start = today`, `end = today` (or the
   start date when it is in the future).
4. The column/index steps are guarded by their own existence and the backfill
   by `user_version`; the migration handles both a v1 empty database and a v2
   imported one, and re-opening a v3 database changes nothing.
5. The upgrade is one-way. To keep a downgrade path, stop `dsh web` and copy
   `tasks.db` (plus `-wal`/`-shm` if present) before opening the new build.

**Layers after migration:**

| Layer | Tables | Read by |
| --- | --- | --- |
| Working tree | `tasks` | Gantt page (`/tree`), Today page (`/day` nodes/tracks), context export |
| Import snapshot | `tracks`, `nodes` | Importer only (idempotency and provenance) |
| Time grid | `plan_blocks`, `day_plans` | Today page (`/day`) |

## 5 · Limitations

- **No auto-scheduler.** The tracker's scheduling meta-tasks M1–M3 are frozen
  (`RULES.md:341-351`), and the plugin adopts that decision: `decompose` and
  `schedule` place the nodes the user names into the day the user names. There
  is no ranking, scoring, slot filling, or "plan my day" route.
- **Depth cap.** The tree is capped at 4 levels including the track root; a
  deeper decomposition is a `400` (`decompose would exceed 4 levels`). The
  tracker's prose caps depth at 3 levels below a track for the same reason: a
  deeper node usually means the parent was not thought through.
- **Stale tracker rows with children survive re-import.** A `(kind, ref)` row
  that no longer exists in the markdown is removed only when none of its
  children survive the same import. If the user decomposed it, the row and its
  children stay, with the last imported content — the import will not delete
  user work.
- **Imported nodes have no landing/estimate/category/inspiration.** The
  tracker's node table only carries id, track, title, state, dates, `dep`, and
  `done_when`; the extra tree metadata is a plugin-side extension. It starts
  empty on import and is filled by an update or a decomposition, so do not
  expect a fresh import to reproduce those fields from the tracker.
- **`持续` means today.** The tracker writes an open-ended end as `持续`; the
  parser stores no end date and materialization ends the row at the import day,
  so the bar is hatched up to today. It only advances when the tracker is
  imported again.
- **User status survives unless the tracker state changed.** Re-import rewrites
  content fields always, but `status`/`progress` are overwritten only when the
  raw tracker `state` changed since the previous import; `links` is never
  written by the importer. This keeps UI status clicks and links intact across
  imports.
- **Task-created plan blocks are not re-imported.** A block created by
  `task/decompose` or `task/schedule` has `source='task'`; the import only
  rewrites `source='schedule'` rows. Mark its status on the Today page like any
  other block; only deleting the block itself removes it.
- **The tracker import is a pull, not a sync.** The page shows the state as of
  the last import; `SCHEDULE.md` right-shifts daily in the source system, so a
  stale page is expected until **Import plan** runs again. Failures are a
  readable `400`, never a partial import (one transaction).
- **The import follows the tracker's markdown shape.** Headings, column order,
  and the `MM/DD 周X` day-heading convention are the contract; a format change
  in the tracker degrades to fewer parsed blocks rather than an error. The
  markdown itself is never modified.
- **Viewport media queries instead of container queries.** The pane is the
  shell's center column and its width follows the sidebar's collapse and drag,
  but the stylesheet still has `@media (max-width: 980px)` and
  `@media (max-width: 720px)` (`client.js`, CSS sections). These fire on the
  viewport, not the pane, so they can fold too early or too late. Known gap;
  new responsive work uses container queries (see `AGENTS.md`).
- **Stale parent rollups** when a parent loses its last child (§3.8).
- **Concurrent DSH processes must not share one SQLite file** (§3.2).
- **i18n is `en` + `zh` only.** The harness may offer more UI languages; plugin
  strings fall back to the registered English dictionary.
- **No npm publication.** The package is `private` and `UNLICENSED`; releases
  are GitHub tags/releases, and installation is by repository path.
- **Rendering is not covered by automated tests.** jsdom proves behavior;
  paint, layout, and theme inheritance need the manual GUI checklist in
  `docs/development.md`.

## 6 · Verification

- **Check — syntax:** `pnpm run verify` (`node --check` on the five sources).
- **Check — behavior and coverage:** `pnpm run check` (lint + typecheck +
  coverage + e2e; per-file thresholds in `vitest.config.ts`, the end-to-end
  suite in `tests/e2e/`).
- **Check — schema migration:** open a copy of a v2 database with the v3 build
  and assert `GET /api/gantt/meta` returns `schemaVersion: 3` with the imported
  tree materialized (the track count and node count match the snapshot tables),
  then run the import once and assert the counts and `(kind, ref)` rows do not
  duplicate.
- **Check — live registrations:** `cordis_inspect_query` → Client
  `Slots.listSubTree` with `root: "sidebar.panellist"` and `root: "main"`.
- **Check — install and host API:** the disposable-profile procedure in
  `docs/development.md` (`DSH_HOME=/tmp/…`,
  `dsh plugin --profile web add <abs path>`, `dsh web --no-open`, then
  `/api/gantt/meta` (schema version 3, fourteen endpoints), `/api/gantt/seed`,
  `/api/gantt/tree` (including `brief`), `/api/gantt/plan/import` with a fixture
  directory, `/api/gantt/day`, `/api/gantt/task/decompose`,
  `/api/gantt/task/schedule`, and `/api/gantt/context` with the session cookie).
- **Check — rendering:** the manual GUI checklist in `docs/development.md`.
- **Procedure — add a supported DSH line:** install that release in a
  disposable profile, run the automated gate, run the install/host acceptance
  pass, run the manual GUI checklist, then update §1 and the "Last verified"
  line here.
