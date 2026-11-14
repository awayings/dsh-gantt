# dsh-gantt

A DeepSeek Harness plugin: a hierarchical task Gantt page in the Web UI, backed
by a local SQLite database and an authenticated JSON API.

## Background

- DeepSeek Harness (DSH):
  - an open-source agent harness developed by DeepSeek AI.
  - GitHub: https://github.com/deepseek-ai/deepseek-harness
  - NPM: `@deepseek-ai/dsh`
  - The installed packages under `/data/app/node_modules/@deepseek-ai/` are the
    source of truth for harness behavior (currently `0.2.2-rc.1`); a local clone
    of the repository is an equivalent source when one is available.
  - MUST read the actual package files (`README.*`, `lib/`, `lib/types/`) before
    deciding anything about harness behavior. Never guess a seam, lifecycle, or
    wire shape.
- The plugin has two halves:
  - host half `index.js` — runs in the `dsh web` server process, registers
    `/api/gantt/*` routes through the Connection service, and owns the store.
  - client half `client.js` — a single browser artifact loaded by the DSH client
    module loader, registering one sidebar icon and one `main` page.
- `docs/compatibility.md` is the single source of truth for supported versions
  and harness seams. Read it before any compatibility-relevant change.

## Coding standard

### Priorities

- User experience, data accuracy, and data integrity come first. Nothing
  outranks them.
- Never trade them away for refactors, performance, or convenience.
- Verify every change against reality with real tests. No assumptions.

### Efficiency

- Make the smallest change that fully solves the problem, with the most
  efficient implementation.
- Keep code and tests small, modular, and loosely coupled. No duplication.
- Reuse existing helpers, tests, and the harness's own facilities (slots,
  locale service, style tokens). Delete code and tests that are outdated or no
  longer needed.
- No over-engineering: no abstraction that has a single caller, no option that
  nothing sets.

### Data integrity

- The SQLite database is the single source of truth for the task tree.
  Hierarchical numbers and stats are computed at read time and never stored.
- Parent rollups (range, progress, status) are a persisted denormalized cache:
  the read path re-derives them only while a parent has children. A parent that
  loses its last child keeps its last rolled-up values, and the authored values
  it had before its first child are overwritten — a known limitation recorded in
  `docs/compatibility.md`. Never rely on authored parent values surviving their
  first child.
- Multi-row writes go through a `BEGIN IMMEDIATE` transaction; a failure rolls
  back completely.
- Validate before mutating: dates, status vocabulary, progress bounds, parent
  existence, and hierarchy cycles.
- The client never keeps a second source of truth: refresh from the API after
  every write, and show an error banner rather than stale data when a read
  fails.

### Comments

- JSDoc for exported types, functions, and public fields.
- Prose comments only for non-obvious platform constraints, such as the
  single-file client artifact rule or a SQLite/Node behavior a reader cannot
  infer from the code. No narration of what the next line does.
- Do not leave dead code or dead comments behind.

### Tests

- Tests live under `tests/store/`, `tests/host/`, and `tests/client/`. Host
  logic runs in Node; the client runs in jsdom.
- Reuse existing specs, suites, and assertions. Drop tests no longer needed.
- Iterate with the narrowest run first:
  `pnpm exec vitest run tests/<area>/<name>.spec.js -t "<case name>"`.
- Cover validation failures and hostile input, not only happy paths.

### File size

- Every source and test file stays under 1000 lines, with one documented
  exception:
  - `client.js` has a ratchet cap of **2300 lines**. DSH derives the client
    artifact revision from the metadata of `exports["./client"]` only (mtime,
    ctime, size), and every chunk URL embeds that revision; splitting the entry
    file into runtime-required chunks leaves the entry untouched, so the
    revision does not change and the browser serves stale bytes from its
    immutable cache. The entry file MUST stay monolithic. See
    `docs/compatibility.md` for the evidence and the escape hatch (bundle back
    into one file if splitting is ever needed).
  - Do not raise the cap without updating this rule and adding a test or check
    that enforces it.

### Language

- English only: code, comments, tests, documentation, commit messages, PR
  descriptions.
- UI copy exists in both `en` and `zh` dictionaries and MUST stay complete and
  in parity. The Chinese study notes under `docs/reference/` are historical
  reference material and are the only exception.

### Temporary files

- Create them only in `./.tmp`.
- Delete them immediately after use; `.tmp` is git-ignored.

### Memory and performance

- No leaks on either side: clear timers/effects in the client, close the
  SQLite handle on host unload, and release references to removed nodes.
- Keep row work proportional to the task tree size; there is no hidden
  pagination, so never add unbounded polling or duplicate refreshes.

## Pre-commit checks

Complete ALL of these before ANY commit:

- Close out the to-do list, ensuring every item is completed, cleaned up, or
  explicitly closed.
- Review the full diff independently: every change necessary, correct, and not
  over-engineered.
- Clean up generated temporary files and temporary or unhelpful comments.
- Run `pnpm run check`: it runs `pnpm run lint`, `pnpm run typecheck`, and
  `pnpm run coverage` concurrently, prints each tool's complete output, and
  fails when any of them does. The same logs stay in `.tmp/check-logs/`.
  - Fix every lint and type error, and keep coverage at the policy below. Read
    the complete output; never tail or truncate it.
  - Coverage policy: **100% per-file** (statements, branches, functions, lines)
    for `store.js` and `index.js`. `client.js` has a documented floor:
    99% statements, 98% branches, 99% functions, 99% lines (measured
    99.79/98.62/99.36/100), as configured in `vitest.config.ts`. The floor is a
    ratchet: raise it when coverage rises, and never weaken it without a
    recorded decision in `docs/development.md`.
  - The `pre-commit` hook runs this same gate, and a green run stamps the
    worktree into `.tmp/check.stamp` with a 60-minute TTL; a commit of unchanged
    content skips the run. `pnpm run check --full` forces a full re-run.

## Layout & responsive

- The plugin pane is the shell's center column, not the viewport — its width
  follows the sidebar's collapse and drags. Prefer container queries for new
  responsive work, as the harness itself does.
- Known gap: the current stylesheet uses viewport media queries
  (`@media (max-width: 980px)` and `@media (max-width: 720px)`) in `client.js`.
  They can fire at the wrong pane width; `docs/compatibility.md` records this
  as a limitation. Do not claim container-query support until it is migrated.
- Fold, never crush: under width pressure, wrap rows or fold columns instead of
  truncating into unreadability. No horizontal scrollbars, no overlapping
  content, and every field stays reachable on the narrowest pane.
- Verify layout changes visually before shipping: a spread of widths from
  desktop down to phone (~390px), in both locales (English labels are the
  truncation stress case), in light and dark themes, on a long tree.

## Build & run

- **No build step.** `index.js` and `store.js` are plain ESM; `client.js` is the
  shipped client artifact. Do not add a bundler or a dist directory for the
  runtime.
- **Setup**: `pnpm install` (installs the pinned dev toolchain and husky hooks).
- **Syntax check**: `pnpm run verify` runs `node --check` on all three source
  files.
- **Quality gate**: `pnpm run test` (vitest), `pnpm run check` (lint +
  typecheck + coverage). On Windows the gate locates Git Bash via
  `scripts/run-bash.mjs`; set `DSH_GANTT_BASH` to override the `bash.exe` path.
  See `docs/development.md` for the full procedure.
- **CI runs the gate only on release tags** (`.github/workflows/release.yml`).
  Pull requests have no CI job: the local gate is the evidence, and the same
  gate runs again in CI before a release is published.
- **Web server**: start DSH with `dsh web`; it prints a tokenized URL such as
  `http://127.0.0.1:3080/?token=…`. Open that full URL once so the browser
  receives its session cookie.
- **Database**: `$DSH_HOME/gantt/tasks.db` by default (`DSH_HOME` defaults to
  `~/.dsh`). Override with an absolute `DSH_GANTT_DB` path before starting DSH.
- **Install/update a local bundle**:
  - in the GUI: `plugin_manager install_bundle { target: "/absolute/path/to/dsh-gantt" }`
  - in a terminal: `dsh plugin --profile web add /absolute/path/to/dsh-gantt`
- **Verification**:
  - `pnpm run test` for the automated suites.
  - `cordis_inspect_query` → Client `Slots.listSubTree` with
    `root: "sidebar.panellist"` and `root: "main"` for the live registrations.
  - Manual GUI checklist in `docs/development.md`; jsdom tests prove behavior,
    not rendering.
  - The disposable-profile acceptance pass in `docs/development.md` proves the
    host routes against a real `dsh web`.
- **No commits or pushes without being asked.** The Lead owns git operations in
  shared work.

## Compatibility

- MUST install and work correctly on every supported `@deepseek-ai/dsh` release,
  with no regressions in the JSON API or any user-visible behavior.
- **`docs/compatibility.md` is the single source of truth** — supported set,
  harness seams with evidence pointers, rules, limitations, and verification
  commands. Read it before any compatibility-relevant change and keep it
  current whenever the code or the supported set changes.
- Surfaces this plugin uses:
  - `window.__ModuleLoader__` client chunk contract (`client.js`).
  - `ctx.connection.fetch.register` host JSON routes (`index.js`).
  - `ctx.slots` and locale services in the client half.
  - `node:sqlite` for the store; `engines.node` is
    `^22.19.0 || >=24.0.0`, while DSH `0.2.2-rc.1` itself requires Node
    `>=24.9.0` (the effective floor when running inside DSH).
- Verified against installed dsh `0.2.2-rc.1`; the package has no runtime
  dependencies.

## I18n

- `DICT_EN` and `DICT_ZH` in `client.js` are the complete UI dictionary pair;
  every visible string goes through the locale service (`t(...)`), and both
  dictionaries must contain the same keys with no unused entries.
- Keep copy concise and prefer terms used by the harness UI.
- Other harness UI languages fall back to the registered English dictionary;
  the plugin does not ship translations beyond `en` and `zh`.
- Documentation is English.

## Docs

- `docs/` is lowercase and contains plugin and maintainer documentation.
- `docs/reference/` holds internal study notes about DSH internals; they are
  not plugin documentation and are not a compatibility contract.
- There is no uppercase `Docs/` directory; never recreate one.
- Keep relative links valid, and re-check them when moving files.
- `CONTRIBUTING.md` is the contribution workflow (branches, commits, pull
  requests, release checklist); keep it in step with `docs/development.md`.

## Git

- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`,
  `chore:`), English, imperative subject.
- Commit mixed changes separately per concern; do not bundle unrelated work.
- Run `git push` only when asked. No force-push, no history rewriting.

## Releasing

- Semantic versioning `X.Y.Z`; bump `package.json` `version` in the release
  commit.
- Review all commits since the last tag and write the release notes from
  `.github/release_template.md` (install/update, what's new, commits,
  contributors).
- Cut releases by tagging: `git tag vX.Y.Z` and push the tag. The
  `.github/workflows/release.yml` workflow fails when the tag does not match the
  package version, then creates the GitHub Release with generated notes.
- The package is private (`"private": true`, `"license": "UNLICENSED"`) and is
  not published to npm. Installation is by repository path.

## Dependencies

- Keep **zero runtime dependencies**: the host uses Node built-ins only, and
  the client uses the React provided by the DSH client module loader.
- Dev tooling is pinned in `package.json` (`oxlint` exact, TypeScript `~`,
  vitest `^`) and locked in `pnpm-lock.yaml`; update deliberately, one concern
  at a time.
- `engines.node` is declared; keep it in step with `docs/compatibility.md`.
