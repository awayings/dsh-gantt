# Compatibility

Rules `dsh-gantt` holds on its supported `@deepseek-ai/dsh` release, and the
evidence for each. Paths marked `dsh:` are read from the installed harness under
`/data/app/node_modules/@deepseek-ai/`; unmarked paths are in this repository.
Source wins over this page.

Last verified: **2026-11-14** (`dsh-gantt` `1.1.0`; installed dsh
`0.2.2-rc.1`, Node `v24.22.2`). The `1.2.0` Today page and tracker import were
verified by the automated gate and the disposable-profile host acceptance pass
on **2026-11-15**; the manual GUI checklist for the new page is in
`docs/development.md` and was not yet run at that date.

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
   installed line (§5); a newer DSH release is unverified until that pass is
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
   returns a `Response`. `index.js` registers eleven exact paths this way.
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
   `$DSH_HOME/gantt/tasks.db` (or `DSH_GANTT_DB`).
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
   is 2700 lines (`AGENTS.md`; raised from 2300 when the Today page landed).
2. **One SQLite writer per database file.** One `GanttStore` is opened per DSH
   process in `apply()` and closed through `ctx.effect`. WAL allows concurrent
   readers, not concurrent writers: two DSH processes sharing one `$DSH_HOME`
   and one `tasks.db` can hit `SQLITE_BUSY`/`database is locked`. There is no
   cross-process arbitration; run one DSH process per database file or give each
   instance its own `DSH_GANTT_DB`.
3. **Locale dictionaries stay complete and in parity.** `DICT_EN` and
   `DICT_ZH` are registered once through `ctx.locale.register(NS, DICTS)` and
   every visible string goes through `t(...)`/`ctx.locale.bind(NS)`. Both
   dictionaries carry the same keys (117 at the time of writing) with no unused
   entries; a missing key silently falls back, so a parity gap is a bug, not a
   graceful degradation.
4. **Errors are JSON, never HTML.** Every route returns
   `{ok:false,error}` with a 4xx/5xx status and `cache-control: no-store`; a
   non-Gantt throw maps to 500. The page shows an error banner plus a retry
   action instead of stale data.
5. **No second listener and no auth bypass.** Do not add a static server, a
   WebSocket, or an unauthenticated route to make development easier; the host
   half must stay inside the harness's `/api` channel on every release.
6. **Theme through tokens.** Colors and surfaces come from the harness's
   `--dsw-alias-*` theme tokens (plus `color-mix` for tints), so light/dark
   themes and host theme changes are inherited without a plugin theme state.
7. **Limitation — stale parent rollups.** `recomputeAncestors()` persists
   derived `start_date`/`end_date`/`progress`/`status` into every ancestor row,
   but `buildTree()` re-derives a node only while it *currently* has children.
   When the last child of a parent is moved away or deleted, the now-childless
   parent keeps the last rolled-up values (for example `done`/100% with no
   children), and the authored values it had before its first child are
   overwritten and unrecoverable. The behavior is pinned by
   `tests/store/crud.spec.js` ("retains the last rolled-up values when the final
   child moves away"). A fix needs a schema/design change and is not scheduled;
   do not rely on authored parent values surviving their first child.

## 4 · Limitations

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
- **Stale parent rollups** when a parent loses its last child (§3.7).
- **Concurrent DSH processes must not share one SQLite file** (§3.2).
- **i18n is `en` + `zh` only.** The harness may offer more UI languages; plugin
  strings fall back to the registered English dictionary.
- **No npm publication.** The package is `private` and `UNLICENSED`; releases
  are GitHub tags/releases, and installation is by repository path.
- **Rendering is not covered by automated tests.** jsdom proves behavior;
  paint, layout, and theme inheritance need the manual GUI checklist in
  `docs/development.md`.

## 5 · Verification

- **Check — syntax:** `pnpm run verify` (`node --check` on the four sources).
- **Check — behavior and coverage:** `pnpm run check` (lint + typecheck +
  coverage + e2e; per-file thresholds in `vitest.config.ts`, the end-to-end
  suite in `tests/e2e/`).
- **Check — live registrations:** `cordis_inspect_query` → Client
  `Slots.listSubTree` with `root: "sidebar.panellist"` and `root: "main"`.
- **Check — install and host API:** the disposable-profile procedure in
  `docs/development.md` (`DSH_HOME=/tmp/…`,
  `dsh plugin --profile web add <abs path>`, `dsh web --no-open`, then
  `/api/gantt/meta`, `/api/gantt/seed`, `/api/gantt/tree`,
  `/api/gantt/plan/import` with a fixture directory, and `/api/gantt/day` with
  the session cookie).
- **Check — rendering:** the manual GUI checklist in `docs/development.md`.
- **Procedure — add a supported DSH line:** install that release in a
  disposable profile, run the automated gate, run the install/host acceptance
  pass, run the manual GUI checklist, then update §1 and the "Last verified"
  line here.
