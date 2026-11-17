#!/usr/bin/env bash
# gantt-mcp container entrypoint: install the release tarball from the /data PVC
# into a versioned runtime directory, then exec the MCP server.
#
# Why this shape: one release artifact serves both deployment units. Operators
# install the same tarball as the DSH plugin (`dsh plugin add file:<tarball>`,
# resolved to an absolute path under /data) and the sidecar extracts it here, so
# plugin code is never baked into an image and upgrades are "drop a tarball on
# the PVC, bump GANTT_VERSION, restart the Pod". The image only needs node >= 24,
# bash and tar: the DSH image itself or a plain node:24-bookworm-slim both work.
#
# Layout under /data/dsh-home/gantt (see deploy/k3s/README.md):
#   releases/dsh-gantt-<version>.tgz   release artifact, persisted on the PVC
#   releases/SHA256SUMS                checksums, verified when present
#   runtime/<version>/                 extracted copy (no node_modules needed:
#                                      gantt-mcp has zero runtime dependencies)
#   current -> runtime/<version>       what this container executes
#   tasks.db                           shared with the DSH plugin (SQLite WAL)
#
# Idempotent: when `current` already points at runtime/<version> only the exec
# below runs. A missing or corrupt tarball exits non-zero, so a broken release
# stays visible as a crash loop instead of silently serving an older version.
set -uo pipefail

ROOT="${GANTT_HOME:-/data/dsh-home/gantt}"
VERSION="${GANTT_VERSION:?GANTT_VERSION is not set (sidecar release version)}"
RELEASES="$ROOT/releases"
RUNTIME="$ROOT/runtime"
CURRENT="$ROOT/current"

log() { echo "[gantt-mcp] $*"; }
die() { echo "[gantt-mcp] ERROR: $*" >&2; exit 1; }

install_release() {
  local target="$RUNTIME/$VERSION" tarball="$RELEASES/dsh-gantt-$VERSION.tgz" staging="$RUNTIME/.$VERSION.staging"
  if [[ "$(readlink -f "$CURRENT" 2>/dev/null || true)" == "$target" && -f "$CURRENT/bin/gantt-mcp.js" ]]; then
    log "release $VERSION already installed"
    return 0
  fi
  [[ -f "$tarball" ]] || die "missing $tarball; copy the release tarball onto the PVC (deploy/k3s/README.md)"
  if [[ -f "$RELEASES/SHA256SUMS" ]] && command -v sha256sum >/dev/null 2>&1; then
    (cd "$RELEASES" && sha256sum -c --ignore-missing SHA256SUMS >/dev/null) || die "checksum mismatch for $(basename "$tarball")"
  else
    log "WARN: no $RELEASES/SHA256SUMS, skipping checksum verification"
  fi
  rm -rf "$staging"
  mkdir -p "$staging"
  tar xzf "$tarball" -C "$staging" --strip-components=1 || die "cannot extract $tarball"
  [[ -f "$staging/bin/gantt-mcp.js" ]] || die "release $VERSION has no bin/gantt-mcp.js"
  rm -rf "$target"
  mv "$staging" "$target"
  # Swap the symlink atomically so a restart mid-install never exposes a half
  # extracted tree.
  ln -sfn "runtime/$VERSION" "$CURRENT.tmp" && mv -T "$CURRENT.tmp" "$CURRENT"
  log "installed release $VERSION at runtime/$VERSION"
  # Older runtimes are dead weight on the PVC: releases/ keeps the tarball a
  # rollback extracts from, so pruning the extracted trees is free.
  find "$RUNTIME" -mindepth 1 -maxdepth 1 -type d ! -name "$VERSION" -exec rm -rf {} + 2>/dev/null || true
}

install_release

TRANSPORT="${GANTT_MCP_TRANSPORT:-http}"
HOST="${GANTT_MCP_HOST:-}"
PORT="${GANTT_MCP_PORT:-18765}"
DB="${GANTT_MCP_DB:-$ROOT/tasks.db}"
ARGS=(--transport "$TRANSPORT" --db "$DB")
if [[ "$TRANSPORT" == 'http' ]]; then
  [[ -n "$HOST" ]] || die "GANTT_MCP_HOST is not set; the HTTP transport needs the address to bind"
  [[ -n "${GANTT_MCP_TOKEN:-}" ]] || die "GANTT_MCP_TOKEN is not set; the HTTP transport refuses non-loopback binds without it"
  ARGS+=(--host "$HOST" --port "$PORT")
fi

exec node "$CURRENT/bin/gantt-mcp.js" "${ARGS[@]}"
