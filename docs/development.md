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

There is **no build step**. All three source files are shipped as-is:
`index.js` and `store.js` as ESM, `client.js` as the client artifact loaded by
DSH.

## Quality gate commands

| Command | What it runs | What it enforces |
| --- | --- | --- |
| `pnpm run verify` | `node --check` on `index.js`, `store.js`, `client.js` | Syntax only; the fastest smoke check. |
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

- `store.js` and `index.js`: **100%** statements, branches, functions, lines.
- `client.js`: ratcheted floor — 99% statements, 98% branches, 99% functions,
  99% lines (currently 99.79 / 98.62 / 99.36 / 100). Six UI branches are
  unreachable through the UI; `client.js` line numbers are listed in the
  coverage output and must not regress.
- Never weaken a threshold without recording the decision here and in the
  review that changes it.

## Test layout

| Directory | Project | Covers |
| --- | --- | --- |
| `tests/store/` | `host` (Node) | `store.js`: schema, dates, numbering, rollups, validation, CRUD, split, seed, delete |
| `tests/host/` | `host` (Node) | `index.js`: route registration, body parsing, status codes, error mapping, store lifecycle |
| `tests/client/` | `client` (jsdom) | `client.js`: rendering, tree/time-axis behavior, dialogs, locale strings, error and empty states |
| `tests/e2e/` | `e2e` (jsdom + node:http) | The real seams end to end: module-loader artifact contract, relative `fetch`, HTTP status/headers, route handlers, and a SQLite file that survives a restart |
| `tests/helpers/` | — | Shared fixtures and a fake host context for the `host` project |

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

## Local dev loop

1. `pnpm install`.
2. `pnpm run deploy` links this checkout into the target DSH profile and
   verifies the composed tree (see [Install a checkout](#install-a-checkout)).
3. Edit `index.js` / `store.js`: these run in the `dsh web` server process and
   are re-read on restart, so restart `dsh web` after host changes.
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

- `index.js` and `store.js` are re-read when `dsh web` starts — restart after
  editing them.
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
curl -s -H "Cookie: $COOKIE" -X POST -H 'content-type: application/json' \
  http://127.0.0.1:3080/api/gantt/seed -d '{}'
curl -s -H "Cookie: $COOKIE" http://127.0.0.1:3080/api/gantt/tree
```

Expected: `meta` returns `{ok:true, dbPath:"$DSH_HOME/gantt/tasks.db",
engine:"node:sqlite", endpoints:[…]}`; `seed` inserts 13 demo tasks and returns
`seeded:true, taskCount:13` plus the snapshot; `tree` returns
`stats:{total:13,done:2,inProgress:4,blocked:2,overdue:0,progress:15}`. An
invalid JSON body returns HTTP 400 with
`{"ok":false,"error":"request body must be valid JSON"}`.

Remove the disposable home when done: `rm -rf /tmp/dsh-gantt-verify`.

### Slot registration

In the connected DSH Web GUI, use `cordis_inspect_query` → Client
`Slots.listSubTree`:

- `root: "sidebar.panellist"` shows the `gantt` entry.
- `root: "main"` shows the page registered under key `gantt`.

Registration proves composition, not rendering.

### Manual GUI checklist

jsdom tests prove behavior; they do not prove paint or layout. Before shipping,
open the page in the connected Web GUI and check:

- [ ] The sidebar icon appears with the localized label and opens the page in
      the center column, like the built-in pages.
- [ ] The tree renders numbers (`1`, `1.1`, `1.1.1`), bars, today line, and
      weekend/month groups in both **Week** and **Month** scales.
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
reload, but a host-side change (`index.js`, `store.js`, or the bundle patch)
needs the restart.

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
