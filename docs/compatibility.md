# Compatibility

Rules `dsh-gantt` holds on its supported `@deepseek-ai/dsh` release, and the
evidence for each. Paths marked `dsh:` are read from the installed harness under
`/data/app/node_modules/@deepseek-ai/`; unmarked paths are in this repository.
Source wins over this page.

Last verified: **2026-11-16** (`dsh-gantt` `1.5.0`; installed dsh
`0.2.2-rc.1`, Node `v24.22.2`). The `1.2.0` Today page and tracker import were
verified by the automated gate and the disposable-profile host acceptance pass;
the `1.3.0` unified task tree added the schema-v3 migration and was verified by
the automated gate plus the real-database migration check; the `1.4.0` daily
brief and perspectives add the schema-v4 migration; the `1.5.0` round refactors
the source into `src/host/` + `src/client/` (rolldown bundle into `lib/client.js`)
and moves the AI workflow to native conversations (right-rail tab + host
assistant tools with per-conversation focus); the previous round added the
schema-v5 `task_events` trajectory, automatic session/turn provenance, and the
background assistant protocol context; the work-mode round adds schema-v6
`work_sessions`, the `gantt_track`/`gantt_create_task` round-closing tools, and
the `gantt-work` workbench tab, covered by the same gate. The manual GUI
checklist is in `docs/development.md` and had not been run at that date.

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
   shape (for example `dsh: dsh-client-locale/lib/client.js:1`).
   `lib/client.js:1` (the built artifact) follows it; the loader factory is
   declared once in `scripts/build-client.mjs` around the `src/client/` bundle.
   The package must keep `exports["./client"]` pointing at that artifact: the
   harness resolves it through `clientExportOf` (`dsh:
   dsh-client-modules/lib/index.js:200`) and rejects a package that declares
   `dsh.client` without it.
2. **Host JSON routes through the Connection service.**
   `ctx.connection.fetch.register({ path, methods, requestBody, fetch })`
   registers an exact route on the shared authenticated `/api` channel
   (`dsh: dsh-client-connection/lib/types/rpc.d.ts:119-141`, service declared in
   `dsh-client-connection/lib/types/index.d.ts`; an in-tree usage is
   `dsh-client-file-upload/lib/index.js:179`). The route path is absolute below
   `/api`; `requestBody: 'buffered'` applies the channel's JSON cap; the handler
   returns a `Response`. `src/host/routes/` registers twenty-three exact paths this
   way via `src/host/routes/http.js`.
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
   injects these two services, and `package.json` `dsh.client.inject` names the
   three platform packages that must arrive first. It also injects the optional
   `betterSidebar` service at runtime (item 9); that package is not required for
   the full pages.
5. **`node:sqlite`.** `src/host/store/db.js` opens `DatabaseSync` from
   `node:sqlite`; the
   module is a Node built-in, so no dependency is declared. WAL and
   `foreign_keys = ON` are set on open; the file is created under
   `$DSH_HOME/gantt/tasks.db` (or `DSH_GANTT_DB`). The schema is versioned with
   `PRAGMA user_version`; see §4 for the v2→v4 migration.
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
8. **Assistant tools (host).** `src/host/tools.js` registers three tools on the
   host **tools service** through `ctx.get('tools')`: `gantt_context`,
   `gantt_decompose`, and `gantt_update_task`. The service is optional — when
   it is absent (unit harnesses, headless profiles) registration is a no-op and
   the rest of the plugin keeps working. The plugin never calls an LLM itself;
   the model is the normal DSH conversation, and the tools are how it reads and
   writes the tree. Writes go through the store's normal validation and
   `BEGIN IMMEDIATE` transactions, so they need no shell/filesystem approval;
   tool references accept the internal id, the external `ref`, or the rendered
   dotted number. Tools are registered globally but their context is per
   conversation: each execution reads the session id from the execution context
   and looks up the `focus` row. Focus rows live in SQLite, so they survive a
   host restart and are removed by the foreign-key cascade when the task is
   deleted. Every tool write also appends to `task_events` with the session id
   and turn index, so task history is traceable without a separate logging call;
   the optional `summary` argument becomes the event detail.
9. **Right-rail tab (client).** The conversation sidebar is provided by the
   optional `dsh-better-sidebar` plugin. `src/client/index.js` injects
   `betterSidebar` with `ctx.inject(['betterSidebar'], …)` and calls
   `ctx.betterSidebar.registerTab({ id: 'gantt', title, description, order: 22,
   single: true, component })`; `single: true` keeps one tab per conversation,
   and the returned disposer is wrapped in `ctx.effect`. When the injection
   never resolves (host without the sidebar plugin) the tab is simply absent and
   the full `/gantt` page still works; nothing in the host depends on it. The
   tab's task clicks write the conversation focus through the focus routes.
10. **Task-day clock.** This deployment's host process runs in UTC
   (`/etc/timezone` `Etc/UTC`), while the tracker's plan dates and the 08:00
   recompute are the user's wall clock. `src/host/clock.js` resolves "today" and the
   next 08:00 with `Intl.DateTimeFormat` in an explicit IANA zone:
   `DSH_GANTT_TZ` when it names a usable zone, else `Asia/Shanghai`. An invalid
   or blank override falls back to the default instead of failing reads, and
   the default zone has no DST. The helpers are re-exported through
   `src/host/tree.js`, `src/host/daily.js`, and `src/host/store.js`, so every
   `today` field, default task date,
   `持续` end, and the scheduler agree with the browser rather than with the
   host clock.
11. **Assistant protocol context (optional `systemPrompt`).** The plugin
   declares the dependency lazily with `ctx.inject(['systemPrompt'], …)` and
   contributes a static prompt section (`gantt:protocol`, order `700`)
   plus a dynamic runtime context (`gantt:focus`, order `530`). The section
   states the completion / partial-decompose / decompose-only protocol and that
   provenance is automatic; the context is emitted only while the conversation
   has a focus and carries the focused ancestor chain, focus detail, and recent
   trajectory. `ctx.systemPrompt.section({ name, order, text })` and
   `ctx.systemPrompt.context({ name, order, text })` are the registry calls
   (`dsh: dsh-system-prompt/lib/types/index.d.ts:256,275`). Runtime context is
   materialized as a durable user-role snapshot; DSH appends a new snapshot only
   when the rendered text changes, so an unchanged focus keeps the cache prefix
   stable. Without the service the plugin registers neither piece and keeps
   working.

## 3 · Rules

1. **The client artifact stays one file; its sources are modules.** DSH derives
   the client artifact revision from `exports["./client"]` metadata only —
   mtime, ctime, size (`dsh: dsh-client-modules/lib/index.js:222`) — and serves
   chunks with `public, max-age=31536000, immutable` (`dsh:
   dsh-client-modules/lib/index.js:188`). Splitting the *entry* into
   runtime-loaded chunks would leave the revision unchanged and the browser on
   old bytes. The plugin therefore keeps one entry artifact, `lib/client.js`,
   and gets small files on the source side instead: `scripts/build-client.mjs`
   (rolldown) bundles `src/client/` into that single classic script, React left
   external for the loader-injected `require`. The artifact is gitignored build
   output: `prepare`, `pnpm run build`, `pnpm run deploy`, and `pnpm run e2e`
   all rebuild it, and the e2e artifact spec pins the single-loader /
   no-module-syntax contract. The former 4800-line ratchet cap is retired in
   favour of the <1000-line per-file rule (decision in
   `docs/development.md`).
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
   second tree. The daily brief is a derived snapshot in `daily_briefs`, not a
   second task tree. A new read surface must follow the same rule, otherwise the
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
9. **Assistant tools write, and the store is the guard.** The conversation
   model can create children (`gantt_decompose`), open a sibling
   (`gantt_create_task`), record a round association without a tree write
   (`gantt_track`), and change a task (`gantt_update_task`) directly. The guard is not an approval prompt but the
   store: depth cap, status vocabulary, date ranges, hierarchy rules, and one
   transaction per write all still apply, and tools return the resulting message
   to the model. Each write also appends a `task_events` row with the session id
   and turn, so the task remains traceable; task deletion cascades to its events.
   The plugin itself calls no model; its protocol contribution is prompt text,
   not a model call.

## 4 · Data model layering and migration

Schema version 6 adds the task ⇄ content-dedicated conversation mapping and
the `track` trajectory action; version 5 had added the append-only task
trajectory; version 4 had added the persisted daily brief report; version 3
had already unified the plugin's two previous datasets into one working tree. `tracks`/`nodes` remain as import
snapshots, and the importer materializes them into `tasks` in the same
transaction; the domain model is in `docs/personal-task-system.md`.

**v5 → v6 upgrade:** the base schema adds `work_sessions` (`task_id` primary
key with `ON DELETE CASCADE`, unique `session_id`, `created_at`, `updated_at`,
indexed by session) and recreates `task_events` with the widened `action`
CHECK (`create`/`update`/`complete`/`decompose`/`track`), copying every row and
recreating both indexes; the migration bumps `PRAGMA user_version` to 6. It
touches neither `tasks` nor the snapshot tables, and there is no backfill.

**v4 → v5 upgrade:** the base schema creates `task_events` (`id`, `task_id`
foreign key with `ON DELETE CASCADE`, `session_id`, `turn`, `action`, `detail`,
`created_at`) with indexes on `(task_id, created_at)` and
`(session_id, created_at)`, and the migration only bumps `PRAGMA user_version`
to 5. It does **not** touch `tasks`, the snapshot tables, `focus`, or
`daily_briefs`, and there is no event backfill: existing tasks start with an
empty trajectory and events accumulate from the next assistant-tool write.

**v3 → v4 upgrade:** the base schema creates the `daily_briefs` table
(`plan_date` primary key, `generated_at`, `source`, `report` JSON) and the
migration only bumps `PRAGMA user_version` to 4. It does **not** re-materialise
the snapshot tables or touch `tasks`: a v3 database keeps its tree byte for
byte, and no report backfill is needed because an absent report is computed on
read. The `focus` table (`session_id` primary key, `task_id` foreign key with
`ON DELETE CASCADE`, `updated_at`) is also created by the base schema's
`CREATE TABLE IF NOT EXISTS`, so existing v4 databases gain it on the next open
without a schema-version bump. Focus rows survive restarts and disappear with
the task they point at.

**v2 → v5 upgrade (append-only, run once when the host opens the database):**

1. The migration adds 12 columns to `tasks` — `kind`, `ref`, `state`, `lane`,
   `dep`, `done_when`, `landing`, `estimate`, `category`, `inspiration`,
   `links`, `source` — each `NOT NULL DEFAULT`, so existing rows stay valid; the
   migration then records the current schema version.
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
   by `user_version < 3`; the migration handles a v1 empty database, a v2
   imported one, a v3 database (tree kept, reports added), and a v4 database
   (reports kept, trajectory added), and re-opening a v5 database changes
   nothing.
5. The upgrade is one-way. To keep a downgrade path, stop `dsh web` and copy
   `tasks.db` (plus `-wal`/`-shm` if present) before opening the new build.

**Layers after migration:**

| Layer | Tables | Read by |
| --- | --- | --- |
| Working tree | `tasks` | Gantt page (`/tree`), Today page (`/day` nodes/tracks), context export |
| Import snapshot | `tracks`, `nodes` | Importer only (idempotency and provenance) |
| Time grid | `plan_blocks`, `day_plans` | Today page (`/day`) |
| Daily brief reports | `daily_briefs` | `/brief`, `/tree` `dailyBrief`, `/day` `brief`, context `## 今日窗口` |
| Conversation focus | `focus` | Right-rail tab (`/focus` routes), assistant `gantt_context` |
| Task trajectory | `task_events` | `/trajectory`, `gantt_context` `## 任务轨迹（会话与轮次）`, right-rail panel |

## 5 · Limitations

- **No auto-scheduler.** The tracker's scheduling meta-tasks M1–M3 are frozen
  (`RULES.md:341-351`). The daily brief productises the M3 direction only as a
  deterministic heuristic for today's windows; there is no ranking model, no
  direction scoring, and no week-level optimiser. `decompose` and `schedule`
  still place only the nodes the user names into the day the user names.
- **The stored daily brief is a morning snapshot.** Until a manual recompute or
  the next 08:00 run, the report reflects the tree as it was when generated, so
  later status edits do not move its picks. This is deliberate (the report is a
  plan for the day, not a live view) but it can look stale after edits.
- **No windows for an unknown day kind without blocks.** The template covers
  `workday` and `weekend`; an `unknown` day with no plan blocks yields an empty
  window list plus a diagnostic note. Import the day plan or classify the day to
  get picks.
- **The 08:00 recompute needs the host running.** The scheduler is an in-process
  `setTimeout` to the next 08:00 in the task-day zone, unref'ed and disposed
  with the plugin. A host that is down at 08:00 misses that run; the manual
  recompute route is the fallback, and nothing recomputes in the background.
- **The daily brief is a heuristic, not a solver.** It can leave windows
  unfilled (reported in `unfilled`, with English diagnostics in `notes`) and it
  cannot reorder the week or score directions. Rotation fairness only looks at
  the stored reports the database still has (up to 30).
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
  so the bar ends at today. It only advances when the tracker is imported
  again.
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
- **The right-rail tab needs `dsh-better-sidebar`.** A host without that plugin
  never resolves the `betterSidebar` injection, so the compact tree tab does
  not appear; the full `/gantt` page and every route still work. The tab is not
  a second application: it is a registered sidebar tab component.
- **Assistant tools need a host tools service.** A host without the `tools`
  service simply gets no assistant tools; the HTTP API and pages still work.
  Tool registration is global, but the context is per conversation via the
  `focus` row, so a conversation without focus gets the whole-tree fallback.
- **Assistant tool writes are not separately approved.** They are normal store
  calls over SQLite (no shell or filesystem access), and the store's validation
  and transactions are the guard. A model with tool access can modify tasks;
  treat the model's tool permissions as the real control surface.
- **No trajectory backfill.** `task_events` starts empty when the feature is
  installed; tasks created or changed before that have no recorded session/turn
  provenance. Events are append-only and are deleted with their task.
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

- **Check — syntax:** `pnpm run verify` (`node --check` on every source, test,
  and script file).
- **Check — build:** `pnpm run build` produces `lib/client.js`; the e2e suite
  rebuilds it and asserts the single-loader / no-top-level-module-syntax
  artifact contract.
- **Check — behavior and coverage:** `pnpm run check` (lint + typecheck +
  coverage + e2e; per-file thresholds in `vitest.config.ts`, the end-to-end
  suite in `tests/e2e/`).
- **Check — schema migration:** open a copy of a v2, v3, v4, or v5 database with
  the current build and assert `GET /api/gantt/meta` returns `schemaVersion: 6`.
  A v2 copy must materialize the imported tree once (track/node counts match the
  snapshots, `(kind, ref)` rows do not duplicate); a v3 copy must keep `tasks`
  unchanged and only gain `daily_briefs`; a v4 copy must keep the tree and
  reports and only gain `task_events` plus its two indexes; a v5 copy must keep
  every row and gain `work_sessions` plus the rebuilt `task_events` with the
  `track` action. All also gain the additive `focus` table. Then read `/api/gantt/brief` and assert the report is
  computed and cached for today, `/api/gantt/focus?sessionId=…` returns
  `taskId: null` on a fresh database, and `/api/gantt/trajectory` returns an
  empty `events` array before any assistant-tool write.
- **Check — task-day clock:** with the host in UTC, assert the `today` fields in
  `/tree`, `/day`, and `/brief` match the `Asia/Shanghai` date (not the UTC
  date late in the UTC evening), then restart with `DSH_GANTT_TZ=UTC` and
  assert they follow UTC; an invalid override must fall back to
  `Asia/Shanghai`, not fail.
- **Check — live registrations:** `cordis_inspect_query` → Client
  `Slots.listSubTree` with `root: "sidebar.panellist"` and `root: "main"`.
- **Check — install and host API:** the disposable-profile procedure in
  `docs/development.md` (`DSH_HOME=/tmp/…`,
  `dsh plugin --profile web add <abs path>`, `dsh web --no-open`, then
  `/api/gantt/meta` (schema version 6, twenty-three endpoints), `/api/gantt/seed`,
  `/api/gantt/tree` (including `brief` and `dailyBrief`), `/api/gantt/plan/import`
  with a fixture directory, `/api/gantt/day` (including `brief`),
  `/api/gantt/task/decompose`, `/api/gantt/task/schedule`,
  `/api/gantt/context` (including `## 今日窗口`), `/api/gantt/brief`,
  `/api/gantt/brief/compute`, `/api/gantt/trajectory`, a work round trip
  (`GET /api/gantt/work?taskId=…` returns `cwd` and a null `sessionId`, then
  `POST /api/gantt/work/session` binds one and a repeated GET returns it),
  `/api/gantt/work/skills`, `/api/gantt/work/team`, plus a focus round trip:
  `POST /api/gantt/focus/set` with a task id, then `GET /api/gantt/focus` for
  the same `sessionId` returns it and clearing returns `taskId: null`).
- **Check — assistant tools:** `tests/host/tools.spec.js` covers the five
  definitions, reference resolution, per-session context, round tracking,
  sibling creation, and registration no-op; the live check is a native
  conversation: focus a task in the right-rail tab, ask the model to decompose
  it, and confirm the children appear in the tree and the parent/child events
  appear in `/api/gantt/trajectory` with the conversation's session id and
  turn; a round with no tree write must record a `track` event.
- **Check — background context:** with `systemPrompt` present, a focused
  conversation should show the `gantt:protocol` section and a
  `gantt:focus` runtime-context snapshot containing the ancestor chain and
  recent trajectory; changing no focus state must not append a new snapshot.
  Without `systemPrompt`, the plugin must still start and the tools/API work.
- **Check — rendering:** the manual GUI checklist in `docs/development.md`.
- **Procedure — add a supported DSH line:** install that release in a
  disposable profile, run the automated gate, run the install/host acceptance
  pass, run the manual GUI checklist, then update §1 and the "Last verified"
  line here.
