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
  (`pnpm exec vitest run tests/<area>/<name>.spec.js -t "<case>"`), then the
  full gate.
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

## The local gate

`pnpm run check` is the definition of green — it runs `lint`, `typecheck`, and
`coverage` in parallel, prints their complete output, and fails if any of them
does. `.husky/pre-commit` runs the same gate, so a commit cannot slip past it.

- A green run stamps the worktree (`.tmp/check.stamp`, 60-minute TTL). Unchanged
  content skips the rerun; `pnpm run check --full` forces it.
- Do not use `--no-verify`. If the gate is failing for a reason unrelated to
  your change, fix the reason or stop and report it.
- Coverage is 100% per file for `store.js` and `index.js`, with the documented
  floor for `client.js`; the thresholds in `vitest.config.ts` are a ratchet —
  raise them when coverage rises, never lower them without a recorded decision
  in `docs/development.md`.

## Pull requests

Open the pull request against `main` with the repository template filled in.
Pull requests have no CI job: the local gate `pnpm run check` is the evidence, so
paste its final `==> check passed:` line into the template. CI re-runs the same
gate only when a release tag is pushed, so a pull request that skipped the local
gate is not ready for review.

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
is a git tag plus a GitHub Release, and consumers install it from a checkout by
path.

1. Confirm `main` is green: CI on the tip commit passed and
   `pnpm run check --full` passes locally.
2. Pick the version (semantic versioning) and bump `version` in `package.json`.
   Land it as a pull request titled `chore(release): X.Y.Z`.
3. If the supported DSH or Node set changed, update the verified line and rules
   in `docs/compatibility.md`, and the surface list in `AGENTS.md`.
4. Tag the merged commit and push the tag:

   ```sh
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

5. `.github/workflows/release.yml` re-runs the full gate, fails when the tag
   does not equal `v` + `package.json.version`, then creates the GitHub Release
   with generated notes. If it fails, delete the tag (`git tag -d`, `git push
   origin :vX.Y.Z`), fix, and re-tag — never move a published tag.
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
- optionally include administrators (recommended once the workflow is routine).

Or apply it with the GitHub CLI:

```sh
gh api -X PUT repos/awayings/dsh-gantt/branches/main/protection \
  -H 'Accept: application/vnd.github+json' --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": false,
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
