#!/usr/bin/env bash
# Upgrade (or roll back) only the gantt-mcp sidecar, without restarting DSH.
#
#   bash deploy/k3s/upgrade-mcp.sh /path/to/dsh-gantt-<version>.tgz
#
# Works from the host (kubectl) and from inside the DSH Pod: every filesystem
# write goes through `kubectl exec/cp` into the Pod that holds the /data PVC.
# The sidecar must run with GANTT_VERSION=auto (the default in
# deploy/k3s/sidecar-patch.yaml), so it follows releases/desired on start.
#
# Flow: copy the tarball and its checksum into releases/, write releases/desired,
# restart the gantt-mcp container in place (kill its pid 1; the kubelet restarts
# that container and the entrypoint installs the new release), then health-check
# and assert the served version. The dsh container — and every DSH session —
# keeps running.
#
# The plugin half (web UI code) is loaded when DSH starts, so upgrading the UI
# still needs the full rollout: use install-gantt.sh.
set -euo pipefail

NAMESPACE="${DSH_GANTT_NAMESPACE:-dsh}"
DEPLOYMENT="${DSH_DEPLOYMENT:-dsh}"
POD_LABEL="${GANTT_POD_LABEL:-app=dsh}"
CONTAINER="${GANTT_SIDECAR_CONTAINER:-gantt-mcp}"
HELPER_CONTAINER="${GANTT_HELPER_CONTAINER:-dsh}"
ROOT="${GANTT_HOME:-/data/dsh-home/gantt}"
RELEASES="$ROOT/releases"

TGZ="${1:?usage: bash upgrade-mcp.sh <dsh-gantt-x.y.z.tgz>}"
TGZ="$(readlink -f "$TGZ")"
NAME="$(basename "$TGZ")"
[[ "$NAME" =~ ^dsh-gantt-[0-9]+\.[0-9]+\.[0-9].*\.tgz$ ]] || { echo "not a dsh-gantt release tarball: $NAME" >&2; exit 1; }
VERSION="${NAME#dsh-gantt-}"
VERSION="${VERSION%.tgz}"

POD="$(kubectl -n "$NAMESPACE" get pod -l "$POD_LABEL" -o jsonpath='{.items[0].metadata.name}')"
[[ -n "$POD" ]] || { echo "no pod matching $POD_LABEL in namespace $NAMESPACE" >&2; exit 1; }
ENV_OF="$(kubectl -n "$NAMESPACE" get deployment "$DEPLOYMENT" -o json)"
HOST="${GANTT_MCP_HOST:-$(jq -r --arg c "$CONTAINER" '.spec.template.spec.containers[] | select(.name==$c) | .env[]? | select(.name=="GANTT_MCP_HOST") | .value' <<<"$ENV_OF" | head -1)}"
PORT="${GANTT_MCP_PORT:-$(jq -r --arg c "$CONTAINER" '.spec.template.spec.containers[] | select(.name==$c) | .env[]? | select(.name=="GANTT_MCP_PORT") | .value' <<<"$ENV_OF" | head -1)}"
PORT="${PORT:-18765}"
BASE="http://$HOST:$PORT"

echo "== pod $POD, release $VERSION, endpoint $BASE"
POD_UID_BEFORE="$(kubectl -n "$NAMESPACE" get pod "$POD" -o jsonpath='{.metadata.uid}')"
RESTARTS_BEFORE="$(kubectl -n "$NAMESPACE" get pod "$POD" -o jsonpath="{.status.containerStatuses[?(@.name==\"$CONTAINER\")].restartCount}")"
echo "   sidecar restarts: ${RESTARTS_BEFORE:-0} (this upgrade adds one)"

echo "== 1/5 copy release to the PVC"
kubectl -n "$NAMESPACE" exec "$POD" -c "$HELPER_CONTAINER" -- mkdir -p "$RELEASES"
kubectl -n "$NAMESPACE" cp "$TGZ" "$NAMESPACE/$POD:$RELEASES/$NAME" -c "$HELPER_CONTAINER"
SUM="$(sha256sum "$TGZ" | cut -d' ' -f1)"
kubectl -n "$NAMESPACE" exec -i "$POD" -c "$HELPER_CONTAINER" -- bash -c "
set -euo pipefail
cd '$RELEASES'
touch SHA256SUMS
grep -v '  $NAME\$' SHA256SUMS > SHA256SUMS.tmp || true
printf '%s  %s\n' '$SUM' '$NAME' >> SHA256SUMS.tmp
mv SHA256SUMS.tmp SHA256SUMS
chmod 644 '$NAME' SHA256SUMS
sha256sum -c SHA256SUMS >/dev/null
echo '   checksum ok'"

echo "== 2/5 point releases/desired at $VERSION"
printf '%s\n' "$VERSION" | kubectl -n "$NAMESPACE" exec -i "$POD" -c "$HELPER_CONTAINER" -- tee "$RELEASES/desired" >/dev/null

echo "== 3/5 restart only the $CONTAINER container"
kubectl -n "$NAMESPACE" exec "$POD" -c "$CONTAINER" -- kill -TERM 1 2>/dev/null || true

echo "== 4/5 wait for the new container to become ready"
for _ in $(seq 1 60); do
  ready="$(kubectl -n "$NAMESPACE" get pod "$POD" -o jsonpath="{.status.containerStatuses[?(@.name==\"$CONTAINER\")].ready}" 2>/dev/null || true)"
  restarts="$(kubectl -n "$NAMESPACE" get pod "$POD" -o jsonpath="{.status.containerStatuses[?(@.name==\"$CONTAINER\")].restartCount}" 2>/dev/null || true)"
  if [[ "$ready" == 'true' && -n "$restarts" && "$restarts" != "${RESTARTS_BEFORE:-0}" ]]; then
    echo "   ready after $restarts restart(s)"
    break
  fi
  sleep 2
done
[[ -n "$HOST" ]] || { echo "cannot resolve GANTT_MCP_HOST from the Deployment; set it in the environment" >&2; exit 1; }

echo "== 5/5 verify"
curl -fsS "$BASE/healthz"
echo
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"upgrade-mcp","version":"0"}}}'
TOKEN="${GANTT_MCP_TOKEN:-$(kubectl -n "$NAMESPACE" get secret dsh-secrets -o jsonpath='{.data.GANTT_MCP_TOKEN}' | base64 -d)}"
SERVED="$(curl -fsS -X POST "$BASE/mcp" -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -d "$INIT" | jq -r '.result.serverInfo.version')"
TOOLS="$(curl -fsS -X POST "$BASE/mcp" -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq -r '.result.tools | length')"
echo "   serverInfo.version=$SERVED tools=$TOOLS"
[[ "$SERVED" == "$VERSION" ]] || { echo "FAIL: sidecar reports $SERVED, expected $VERSION" >&2; exit 1; }
POD_UID_AFTER="$(kubectl -n "$NAMESPACE" get pod "$POD" -o jsonpath='{.metadata.uid}')"
[[ "$POD_UID_BEFORE" == "$POD_UID_AFTER" ]] || { echo "FAIL: the Pod was recreated; use install-gantt.sh for full upgrades" >&2; exit 1; }
echo "PASS: sidecar upgraded in place, dsh container untouched (pod uid unchanged)"
