#!/usr/bin/env bash
# The full gate: static analysis (lint, typecheck), unit coverage and the end-to-end suite in parallel, with logs in
# .tmp/check-logs. `.husky/pre-push` runs it before a push to main, so no untested tree reaches the remote; commits
# only run `pnpm run static`. The plugin ships its source directly, so there is no build step to gate on. A green run
# fingerprints the worktree into .tmp/check.stamp so a repeated gate run skips unchanged content; the stamp expires
# after STAMP_TTL_MIN because gitignored inputs (node_modules, tool caches) can drift un-fingerprinted. `--full` forces.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STAMP=".tmp/check.stamp"
LOGS=".tmp/check-logs"
INDEX=".tmp/check-index"
STAMP_TTL_MIN=60
GATES=(lint typecheck coverage e2e)

# The fingerprint is the worktree's tree object, built through a THROWAWAY index: staged, unstaged and untracked files all count; gitignored outputs do not.
fingerprint() {
  local tree
  mkdir -p .tmp
  rm -f "$INDEX"
  if ! GIT_INDEX_FILE="$INDEX" git add -A -- . >/dev/null; then
    rm -f "$INDEX"
    return 1
  fi
  tree="$(GIT_INDEX_FILE="$INDEX" git write-tree)" || tree=""
  rm -f "$INDEX"
  [[ -n "$tree" ]] || return 1
  printf '%s\n' "$tree"
}

FULL=0
[[ "${1:-}" == "--full" ]] && FULL=1

# Command substitutions do not inherit errexit on bash 3.2 (macOS), so both fingerprint calls check status explicitly.
BEFORE="$(fingerprint)" || { echo "==> check: cannot fingerprint the worktree" >&2; exit 1; }
if (( FULL == 0 )) && [[ -f "$STAMP" ]] && [[ "$(cat "$STAMP")" == "$BEFORE" ]] \
  && [[ -n "$(find "$STAMP" -mmin "-$STAMP_TTL_MIN" 2>/dev/null)" ]]; then
  echo "==> check: worktree unchanged since the last green gate ($(cut -c1-12 "$STAMP")) — skipping. Run 'pnpm run check --full' to force a full run."
  exit 0
fi

rm -rf "$LOGS"
mkdir -p "$LOGS"

echo "==> check: static analysis, unit coverage and end-to-end in parallel"
pnpm run lint >"$LOGS/lint.log" 2>&1 & LINT=$!
pnpm run typecheck >"$LOGS/typecheck.log" 2>&1 & TYPECHECK=$!
pnpm run coverage >"$LOGS/coverage.log" 2>&1 & COVERAGE=$!
pnpm run e2e >"$LOGS/e2e.log" 2>&1 & E2E=$!

FAILED=""
wait "$LINT" || FAILED="$FAILED lint"
wait "$TYPECHECK" || FAILED="$FAILED typecheck"
wait "$COVERAGE" || FAILED="$FAILED coverage"
wait "$E2E" || FAILED="$FAILED e2e"

for name in "${GATES[@]}"; do
  echo
  echo "===== $name ====="
  cat "$LOGS/$name.log"
done

echo
if [[ -n "$FAILED" ]]; then
  echo "==> check FAILED:$FAILED" >&2
  exit 1
fi

# A gate run over a moving worktree proves nothing: an edit during the run must not be stamped as verified.
AFTER="$(fingerprint)" || { echo "==> check: cannot fingerprint the worktree" >&2; exit 1; }
if [[ "$BEFORE" != "$AFTER" ]]; then
  echo "==> check: the worktree changed while the gate ran — re-run before committing." >&2
  exit 1
fi

printf '%s\n' "$BEFORE" > "$STAMP"
echo "==> check passed: lint, typecheck, unit coverage thresholds and e2e — tree ${BEFORE:0:12} (logs in $LOGS)."
