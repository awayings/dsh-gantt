# Contributing to dsh-gantt

`dsh-gantt` is a DeepSeek Harness Web UI plugin: a hierarchical task Gantt page
backed by SQLite and an authenticated JSON API. Bug reports, compatibility
reports, and patches are welcome.

[AGENTS.md](AGENTS.md) is the engineering policy and wins over this page on any
conflict. [docs/development.md](docs/development.md) covers setup, the
toolchain, and verification in depth.

## Setup

- Node satisfying `engines.node` in `package.json` (`^22.19.0 || >=24.0.0`; the
  DSH releases we support need `>=24.9.0`), plus `git` and `pnpm`.
- A DeepSeek Harness install to check the plugin in the real UI; the verified
  line is recorded in [docs/compatibility.md](docs/compatibility.md).
- `pnpm install`, then `pnpm run check --full` once to confirm the toolchain.
- Read the doc that governs what you are touching: [docs/api.md](docs/api.md)
  for routes, [docs/compatibility.md](docs/compatibility.md) for harness seams
  and supported versions, [README.md](README.md) for user-visible behavior.

## Workflow

`main` is the only long-lived branch and the working branch — there is no pull
request step. `main` blocks force-pushes and deletion.

1. Edit the source. No build step: `index.js`, `store.js`, `tracker.js`,
   `tree.js`, and `client.js` are served as-is.
2. `pnpm run static` runs on every commit (lint + typecheck, ~3 s).
3. `pnpm run check` runs before a push reaches the remote (`pre-push` hook):
   lint, typecheck, unit coverage thresholds, and the end-to-end suite in
   parallel, ~15 s cold. A green run is cached in `.tmp/check.stamp`; repeated
   pushes of the same tree skip it. `--full` forces a run.
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`), English,
   imperative subject, one concern per commit, then `git push`.
5. Never use `--no-verify`, never force-push `main`, and never push a red or
   uncommitted tree — the hook refuses it anyway.

If you only have read access, fork and open a pull request; it is reviewed and
squash-merged under the same gate.

## What a change needs

- **Tests.** Behavior changes need tests; hostile input and validation failures
  count as behavior. Run the narrowest spec first
  (`pnpm exec vitest run tests/<area>/<name>.spec.js -t "<case>"`). When a
  change crosses a real seam — the module-loader artifact, a request over the
  wire, persistence across a restart — extend `tests/e2e/` too
  (`pnpm run e2e`), and keep that suite small.
- **UI changes** also need the manual checklist in `docs/development.md`
  (desktop down to ~390 px, both locales, light and dark, a long tree) and a
  screenshot attached to the issue or commit.
- **Compatibility.** Do not change the JSON API, the DB schema, or user-visible
  behavior in a breaking way. When a change is compatibility-relevant, update
  `docs/compatibility.md` in the same commit. Keep one working tree: new read
  surfaces use `tasks` (tracks/nodes are import snapshots), and a schema change
  needs an append-only migration plus the one-time backfill rule.
- **i18n.** `DICT_EN` and `DICT_ZH` in `client.js` must contain the same keys
  with no unused entries.
- **File size.** Every source and test file stays under 1000 lines; `client.js`
  has the documented 3600-line ratchet cap. Do not add a bundler or a `dist/`.
- **Docs.** Keep `docs/` lowercase, written in English, with valid relative
  links. There is no `Docs/` directory.

## Releasing

Releases are cut from a clean, synced `main` by a maintainer:

1. Bump `version` in `package.json` in a `chore(release): X.Y.Z` commit and push
   it through the normal gate.
2. `pnpm run release X.Y.Z --dry-run` validates the repository (clean tree,
   `main` synced with the remote, version matches the tag) and runs `verify` and
   the full gate.
3. `pnpm run release X.Y.Z --push` creates the annotated tag, pushes it, and
   waits for `.github/workflows/release.yml`: it re-runs lint, typecheck,
   coverage, and e2e, rejects a tag that does not match the package version, and
   creates the GitHub Release with generated notes.

The profile that serves the UI links the working tree rather than a copy, so a
release needs no reinstall: `pnpm run deploy --check` confirms the link, then
smoke-test the Gantt page before announcing the release.

The package is private and not published to npm; installation is by repository
path.
