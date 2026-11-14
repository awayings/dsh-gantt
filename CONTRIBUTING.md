# Contributing to dsh-gantt

`dsh-gantt` is a DeepSeek Harness Web UI plugin: a hierarchical task Gantt page
backed by SQLite and an authenticated JSON API. Bug reports, compatibility
reports, documentation fixes, and pull requests are welcome.

Read [AGENTS.md](AGENTS.md) before changing anything: it is the engineering
policy (priorities, data integrity, comment/test/file-size rules, gate) and it
wins over this page on any conflict. [docs/development.md](docs/development.md)
covers setup, the toolchain, and the verification procedure in depth.

## Before you start

- Node satisfying `engines.node` in `package.json` (`^22.19.0 || >=24.0.0`; the
  DSH releases we support need `>=24.9.0`), plus `git` and `pnpm`.
- A working DeepSeek Harness install to check the plugin in the real UI; the
  verified line is recorded in [docs/compatibility.md](docs/compatibility.md).
- `pnpm install`, then `pnpm run check --full` once to confirm the toolchain.
- Read the doc that governs what you are touching: `docs/api.md` for routes,
  `docs/compatibility.md` for harness seams and supported versions, `README.md`
  for user-visible behavior.

## Branching

- `main` is the only long-lived branch and is protected: every change lands
  through a pull request, squash-merged, so history stays linear.
- Branch from an up-to-date `main`, name it `<type>/<short-topic>`, and keep it
  short-lived:

  | Type | Example |
  | --- | --- |
  | `feat/` | `feat/month-scale-zoom` |
  | `fix/` | `fix/stale-parent-rollup` |
  | `refactor/` | `refactor/split-store-module` |
  | `test/` | `test/host-route-errors` |
  | `docs/` | `docs/release-checklist` |
  | `chore/` | `chore/bump-oxlint` |

- Rebase onto `main` instead of merging it in; do not force-push a branch someone
  else is reviewing.
- Never push directly to `main`; maintainers do not bypass the protection
  either.

## Making changes

- **No build step.** `index.js` and `store.js` are plain ESM read by the
  `dsh web` process; `client.js` is the shipped client artifact. Do not add a
  bundler, a `dist/`, or a second entry file — [docs/compatibility.md](docs/compatibility.md)
  explains why the client entry must stay monolithic.
- **File size.** Every source and test file stays under 1000 lines; `client.js`
  has the documented 2300-line ratchet cap. A change that pushes a file past a
  limit needs a split or an explicit, recorded decision, not a quiet bump.
- **Types.** JSDoc types are mandatory in `store.js` and `index.js` (strict
  `checkJs`); `client.js` and `tests/` are checked leniently. No `@ts-ignore`
  or `@ts-expect-error`.
- **Tests.** Behavior changes need tests; hostile input and validation failures
  count as behavior. Run the narrowest spec first
  (`pnpm exec vitest run tests/<area>/<name>.spec.js -t "<case>"`). When a
  change crosses a real seam — the module-loader artifact, a request over the
  wire, persistence across a restart — extend `tests/e2e/` too
  (`pnpm run e2e`), and keep that suite small.
- **UI changes** also need the manual checklist in `docs/development.md`
  (desktop down to ~390px, both locales, light and dark, a long tree) and a
  screenshot in the pull request.
- **Compatibility.** Do not change the JSON API, the DB schema, or user-visible
  behavior in a breaking way. When a change is compatibility-relevant, update
  `docs/compatibility.md` in the same pull request and call it out.
- **i18n.** `DICT_EN` and `DICT_ZH` in `client.js` must contain the same keys
  with no unused entries.
- **Docs.** Keep `docs/` lowercase, written in English, with valid relative
  links. There is no `Docs/` directory.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), English,
imperative subject, one concern per commit:

```text
feat(store): reject circular parent moves
fix(client): keep the timeline header aligned at 390px
test(host): cover malformed JSON bodies
docs(compatibility): record dsh 0.2.2-rc.1 verification
chore(deps): bump oxlint to 1.86
```

- Keep the subject under ~72 characters and explain *why* in the body,
  including how the change was verified.
- Do not bundle formatting, refactoring, and behavior changes: a reviewer must
  be able to read each commit on its own.
- Reference issues with `Fixes #123` / `Refs #123`.
- Temporary files belong in `.tmp/` and must not be committed.

## The gates

Committing and merging are gated differently on purpose: commits stay fast, and
a branch only merges with full evidence.

### Commit — static only

`.husky/pre-commit` runs `pnpm run static` (`lint` then `typecheck`, a few
seconds). That is the whole commit gate: no unit tests, no end-to-end run. Fix
what it reports; do not use `--no-verify`.

### Pull request — the full gate

`pnpm run check` is the definition of green for a branch. It runs `lint`,
`typecheck`, `coverage` (the host and client unit suites with per-file
thresholds), and `e2e` (the shipped client artifact over real HTTP against the
real route handlers and a real SQLite file) in parallel, prints their complete
output, and fails if any part fails.

- Run it on the branch before opening the pull request, and again after any
  review change or rebase: the evidence must describe the tree that will land.
- Paste the final `==> check passed:` line — it names the tree hash — into the
  pull request template. Never merge with a red gate.
- A green run stamps the worktree (`.tmp/check.stamp`, 60-minute TTL). Unchanged
  content skips the rerun; `pnpm run check --full` forces it.
- Coverage is 100% per file for `store.js` and `index.js`, with the documented
  floor for `client.js`; the thresholds in `vitest.config.ts` are a ratchet —
  raise them when coverage rises, never lower them without a recorded decision
  in `docs/development.md`.

## Pull requests

Open the pull request against `main` with the repository template filled in.
Pull requests have no CI job: the local pull-request gate `pnpm run check` —
static analysis, the unit suites with coverage thresholds, and the end-to-end
suite — is the evidence, so paste its final `==> check passed:` line into the
template. CI re-runs the same full gate only when a release tag is pushed, so a
pull request that skipped the local gate is not ready for review, and a branch
merges only after its gate is green.

Reviewers look for:

- the smallest diff that fully solves the problem, with no behavior change left
  untested;
- `docs/compatibility.md`, `docs/api.md`, and `README.md` still accurate;
- dictionary parity and no user-visible string outside the locale service;
- no new runtime dependency, no build step, no `dist/`;
- no committed databases, logs, or `.tmp/` artifacts.

Draft pull requests are fine for early feedback. Maintainers squash-merge and
delete the branch; the merge commit subject keeps the conventional prefix.

## Releasing (maintainers)

The package is private and `UNLICENSED`; it is not published to npm. A release
is an annotated tag plus a GitHub Release, and consumers install it from a
checkout by path. `pnpm run release` automates the mechanical part.

1. Pick the version (semantic versioning) and bump `version` in `package.json`,
   landed through a pull request titled `chore(release): X.Y.Z`. That version
   commit is the only change a release adds.
2. If the supported DSH or Node set changed, update the verified line in
   `docs/compatibility.md` and the surface list in `AGENTS.md` in the same pull
   request.
3. After the version commit is merged and `main` is clean, validate:

   ```sh
   pnpm run release X.Y.Z --dry-run
   ```

   The script refuses to continue unless the branch is `main`, the worktree is
   clean, `main` equals `origin/main`, `package.json` says `X.Y.Z`, and the tag
   does not exist yet; then it runs `pnpm run verify` and the full gate
   (`pnpm run check --full`).
4. Cut and publish:

   ```sh
   pnpm run release X.Y.Z --push
   ```

   Without `--push` the tag is created locally and the script stops. With
   `--push` it pushes the tag and waits for `.github/workflows/release.yml`,
   which re-runs the gate, fails when the tag does not equal `v` +
   `package.json.version`, and creates the GitHub Release with generated notes.
5. If the workflow fails, delete the tag (`git tag -d vX.Y.Z`,
   `git push origin :vX.Y.Z`), fix the cause, and re-run the script — never move
   a published tag.
6. Polish the notes from [.github/release_template.md](.github/release_template.md):

   ```sh
   gh release view vX.Y.Z --json body -q .body > /tmp/notes.md
   # edit /tmp/notes.md, then:
   gh release edit vX.Y.Z --notes-file /tmp/notes.md
   ```

7. Smoke-test the published state: reinstall the checkout
   (`dsh plugin --profile web add /absolute/path/to/dsh-gantt`), restart
   `dsh web`, then load the Gantt page and hit `/api/gantt/meta` once.

Release notes must keep the install/update instructions from the template
accurate: there is no npm package, so update means `git pull` plus re-running
the install command.

## Maintainer setup: protect `main`

Branch protection is a repository setting, not a file. In GitHub: **Settings →
Branches → Add branch protection rule**, pattern `main`, then:

- require a pull request before merging (approvals optional for a solo
  maintainer, one for a team);
- do not require status checks — pull requests are verified locally and only
  release tags run CI;
- disallow force pushes and deletions;
- include administrators, so the rules also bind the maintainer — this
  repository enforces them, and a direct `git push` to `main` is rejected.
  Merging a pull request is a server-side operation and is not affected.

Or apply it with the GitHub CLI:

```sh
gh api -X PUT repos/awayings/dsh-gantt/branches/main/protection \
  -H 'Accept: application/vnd.github+json' --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null
}
JSON
```

Also enable **Automatically delete head branches** in the repository settings so
merged branches do not accumulate.

## Reporting issues

Use the bug report or feature request template. A useful bug report includes the
DSH version, the plugin version, OS and Node version, the resolved database path
shown in the API dialog, exact steps, and expected versus actual behavior. Redact
personal data from screenshots and logs.

Never attach a real `tasks.db` or paste a task tree that contains private
information. The database is user data and is git-ignored for that reason.
