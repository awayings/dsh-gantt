<!--
  Keep it short. The reviewers read the diff; this template exists so they know what to check.
  See CONTRIBUTING.md for the branch, commit, gate, and release rules.
-->

## Summary

<!-- What problem does this solve, and what is the smallest change that solves it? Link the issue. -->

Fixes #

## Verification

- [ ] `pnpm run check` is green (paste the final `==> check passed:` line below)
- [ ] Tests cover the change, including validation failures and hostile input where relevant
- [ ] Manual UI check when user-visible: desktop down to ~390px, `en` and `zh`, light and dark, long tree (screenshot below)
- [ ] Docs kept current: `docs/api.md` (routes), `docs/compatibility.md` (supported set, seams, limitations), `README.md` (user-facing behavior)
- [ ] No build step, no `dist/`, no new runtime dependency; `client.js` stayed monolithic

```text
==> check passed: ...
```

## Compatibility & risk

<!-- What did you verify against (DSH version, Node version, disposable profile)? Any behavior, API, or
schema change and its migration impact? Known limitations or follow-ups left open? -->

## Screenshots (UI changes)

<!-- Optional for non-UI changes. -->
