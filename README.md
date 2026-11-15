# DSH Task Gantt

A persistent DeepSeek Harness Web UI plugin that adds a **Task Gantt** entry to
the left sidebar and a full central page with:

- a hierarchical task tree with automatic `1`, `1.1`, `1.1.1` numbering;
- weekly and monthly timelines with zoom-out / zoom-in navigation;
- task tracking through status, progress, and roll-up values on parent tasks;
- creation, editing, splitting into subtasks, moving between parents, and
  deletion;
- a local SQLite database and an authenticated JSON API for external callers.

No build step, no runtime dependencies, no second server: the host half is plain
ESM shipped in this repository, and the client half is a single browser artifact
loaded by DeepSeek Harness.

## Destination

| Surface | Slot | Registration |
| --- | --- | --- |
| Left sidebar icon | `sidebar.panellist` | id `gantt` |
| Central page | `main` | key `gantt` |

Clicking the sidebar icon selects the page exactly like the built-in Plugins or
Schedules pages.

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
directory rather than a copy: restart `dsh web` after editing `index.js` or
`store.js`, and reload the page after editing `client.js` — no reinstall step.
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
   **Week** / **Month**, the arrows, and **Today** move the time axis.
4. The **API** button shows the resolved database path and the full endpoint
   catalog, ready to copy into `curl`.

## Data source

The host half opens a SQLite database through Node's built-in `node:sqlite`:

```text
$DSH_HOME/gantt/tasks.db
```

`DSH_HOME` defaults to `~/.dsh`. Override the file before starting DSH:

```sh
DSH_GANTT_DB=/absolute/path/to/tasks.db dsh web
```

The schema is created on first activation. Dates are `YYYY-MM-DD`; status is one
of `todo`, `in_progress`, `blocked`, `done`. When a task has children, its
dates, progress, and status are rolled up from them on read — parent fields are
never authored directly in the UI. Known limitation: a parent that loses its
last child keeps its last rolled-up values (see
[docs/compatibility.md](docs/compatibility.md)). The full contract is in
[docs/api.md](docs/api.md#conventions).

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

All routes are mounted on the harness's existing authenticated `/api` channel.
The browser sends its normal session cookie; there is no second port, token, or
CORS setup. Errors use `{ "ok": false, "error": "..." }` with a `4xx`/`5xx`
status.

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

A terminal `curl` needs the page's session cookie — open the tokenized URL
printed by `dsh web` once, then copy the `Cookie` request header from an
authenticated request in DevTools. Treat that cookie as a credential.

Full request/response examples, field tables, and error codes:
[docs/api.md](docs/api.md).

## Verification

```sh
pnpm run verify    # node --check on the three source files
pnpm run static    # lint + typecheck (the commit hook)
pnpm run test      # vitest (host + jsdom client unit suites)
pnpm run e2e       # real client artifact -> HTTP -> host routes -> SQLite
pnpm run check     # the full gate, run by the push hook: static + coverage + e2e
```

- `cordis_inspect_query` → Client `Slots.listSubTree` with
  `root: "sidebar.panellist"` and `root: "main"` shows the live `gantt`
  registrations.
- The page renders in the connected Web GUI. Visual verification requires the
  browser page; slot registration and bundle activation alone do not prove the
  rendered result.
- The disposable-profile acceptance pass and the manual GUI checklist are in
  [docs/development.md](docs/development.md#verification-procedure).

## Layout, theme, and safety

- The page renders as a React component in the `main` slot; it does not serve an
  iframe or append a second application to `document.body`.
- The pane is the shell's center column, so its width follows the sidebar's
  collapse and drag. The current stylesheet still uses two viewport media
  queries instead of container queries — a known gap recorded in
  [docs/compatibility.md](docs/compatibility.md).
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
URL embeds that same revision, served as immutable. Splitting the client half
into runtime modules (`require('./client.foo.js')`) leaves the entry file
untouched, so the revision does not change, the chunk URL does not change, and
the browser keeps serving the old bytes from its cache — HMR stops firing and
even a plain reload can show stale code. The entry file must stay monolithic,
with a 2300-line ratchet cap documented in [AGENTS.md](AGENTS.md) and
[docs/compatibility.md](docs/compatibility.md).

Organize the single file by section instead:

| Section | Contents |
| --- | --- |
| `DICT_EN`, `DICT_ZH`, `DICTS` | locale dictionaries registered with the Client locale service |
| `CSS_BASE`, `CSS_HEAD`, `CSS_STATS`, `CSS_GRID`, `CSS_EMPTY`, `CSS_DIALOG`, `CSS_MISC` | stylesheet sections, joined once into the rendered `<style>` |
| `isoToDay`/`dayToIso`/`addDays`/`buildWindow`/`flattenTree` helpers | pure date and tree helpers |
| `GanttPage`, `TimelineHeader`, `GanttRow`, `TaskDialog`, `SplitDialog`, `ApiDialog` | React components |

If the file ever needs real splitting, bundle it back into a single `client.js`
(for example with esbuild) so the entry artifact still changes on every edit.

## Development / quality gates

There is no build step: `pnpm install`, edit, run the gates.

| Command | What it enforces |
| --- | --- |
| `pnpm run verify` | Syntax of `index.js`, `store.js`, `client.js` |
| `pnpm run lint` | oxlint |
| `pnpm run typecheck` | TypeScript `checkJs` across host, client, and tests |
| `pnpm run static` | lint + typecheck; what the commit hook runs (~3s) |
| `pnpm run test` | Vitest host + jsdom client unit suites |
| `pnpm run coverage` | Unit suites plus per-file coverage thresholds |
| `pnpm run e2e` | Shipped client artifact against real HTTP and a real SQLite file |
| `pnpm run check` | The full gate, run by the push hook: static + coverage + e2e in parallel, with a cached stamp |

Coverage is 100% per-file for `store.js` and `index.js`, with a documented floor
for `client.js`. Commits only run the static check; `.husky/pre-push` runs the
full gate before a push reaches `main`, and refuses a tree that is not green.
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
- [docs/compatibility.md](docs/compatibility.md) — supported set, harness seams, limitations
- [CONTRIBUTING.md](CONTRIBUTING.md) — workflow, commits, release checklist
- [AGENTS.md](AGENTS.md) — engineering policy (priorities, tests, file size, gate)

## License

Private and `UNLICENSED`; not published to npm.
