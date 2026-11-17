# K3s deployment: same-Pod sidecar

`gantt-mcp` runs as a second container inside the DSH Pod, not as its own
workload. It reads and writes the same SQLite database the plugin uses
(`/data/dsh-home/gantt/tasks.db` on the `/data` PVC), so a separate Pod would
only add a second mount of an RWO volume and a second version to manage. With
`hostNetwork` (DSH already uses it) the sidecar binds the node's tailscale
address directly and needs no Service or Ingress.

**One artifact, two deployment units.** The release tarball
(`dsh-gantt-<version>.tgz` + `SHA256SUMS`) is both the plugin an operator
installs with `dsh plugin add file:<tarball>` and the sidecar's code, because
`bin/gantt-mcp.js` ships inside it. No image per release: the sidecar reuses the
DSH image (or any `node:24` image with `bash` and `tar` — gantt-mcp has zero
runtime dependencies) and extracts the tarball from the PVC before exec'ing.

Files here:

| File | Purpose |
| --- | --- |
| `sidecar-patch.yaml` | strategic-merge patch adding the `gantt-mcp` container and its ConfigMap volume to a DSH Deployment |
| `gantt-mcp-entrypoint.sh` | container entrypoint: extract the PVC tarball into `runtime/<version>`, point `current` at it, then `exec node …/bin/gantt-mcp.js` |

The lab-specific manifests (real Deployment, secrets, scripts) live in the
cluster repository, not here; this directory is the portable contract.

## PVC layout

```text
/data/dsh-home/gantt/
├── releases/
│   ├── dsh-gantt-<version>.tgz   release artifact, one per installed version
│   └── SHA256SUMS                checked by the entrypoint when present
├── runtime/<version>/            extracted copy, created by the entrypoint
├── current -> runtime/<version>  what the sidecar runs
├── tasks.db                      shared with the DSH plugin (WAL)
└── tasks.db-wal, tasks.db-shm    SQLite sidecars
```

The plugin's `file:` dependency records the tarball's absolute path, so
`releases/dsh-gantt-<version>.tgz` must stay on the PVC: deleting it breaks a
later `dsh plugin add`/reinstall of that version. Old `runtime/` trees are pruned
by the entrypoint; the tarball is what a rollback extracts from.

## Fresh install

1. **Base workload first.** Apply the DSH Deployment without the sidecar (or with
   it — see step 4 for why either order converges) and wait for the `dsh`
   container to be up. The sidecar is gated by its own probes, so a missing
   release only marks the sidecar unready, not the Pod.
2. **Put the release on the PVC.** Copy the tarball and checksums into
   `releases/`. From outside the cluster, `kubectl cp` through the `dsh`
   container is the portable way:

   ```bash
   kubectl -n dsh exec deploy/dsh -c dsh -- mkdir -p /data/dsh-home/gantt/releases
   kubectl -n dsh cp dsh-gantt-<version>.tgz dsh/<pod>:/data/dsh-home/gantt/releases/dsh-gantt-<version>.tgz -c dsh
   kubectl -n dsh cp SHA256SUMS           dsh/<pod>:/data/dsh-home/gantt/releases/SHA256SUMS -c dsh
   ```

3. **Secret.** Add the bearer token once with `kubectl patch` (never put it in a
   manifest):

   ```bash
   TOKEN="$(openssl rand -hex 24)"
   kubectl -n dsh patch secret dsh-secrets --type merge \
     -p "{\"data\":{\"GANTT_MCP_TOKEN\":\"$(printf %s "$TOKEN" | base64 -w0)\"}}"
   printf %s "$TOKEN" > /data/dsh-home/gantt/mcp.token   # hand this to clients
   chmod 600 /data/dsh-home/gantt/mcp.token
   ```

   The sidecar refuses to start when the HTTP transport is configured without a
   token, and it never binds `0.0.0.0` (that would expose MCP to the LAN).

4. **Entrypoint ConfigMap and sidecar patch.**

   ```bash
   kubectl -n dsh create configmap gantt-entrypoint \
     --from-file=gantt-mcp-entrypoint.sh=deploy/k3s/gantt-mcp-entrypoint.sh \
     --dry-run=client -o yaml | kubectl apply -f -
   # edit the placeholders in sidecar-patch.yaml, preview, then apply
   kubectl -n dsh patch deployment dsh --type=strategic \
     --patch-file deploy/k3s/sidecar-patch.yaml --dry-run=server
   kubectl -n dsh patch deployment dsh --type=strategic \
     --patch-file deploy/k3s/sidecar-patch.yaml
   ```

   The first extraction happens inside the sidecar container, so if step 2 ran
   after the Deployment update the container simply crash-loops until the tarball
   appears; its next retry installs and the Pod turns ready without touching the
   Deployment again.

5. **Plugin in the DSH profile.** Install the same artifact into the web profile
   so the UI half matches the sidecar version:

   ```bash
   kubectl -n dsh exec deploy/dsh -c dsh -- \
     dsh plugin --profile web add file:/data/dsh-home/gantt/releases/dsh-gantt-<version>.tgz
   kubectl -n dsh rollout restart deployment/dsh   # host half loads at startup
   ```

## Upgrade / rollback

Upgrade: copy the new tarball into `releases/`, bump `GANTT_VERSION` in the
sidecar env, install the plugin from it, `kubectl -n dsh rollout restart
deployment/dsh`. The entrypoint extracts the new version and swaps `current`
atomically.

Rollback: set `GANTT_VERSION` back to the version whose tarball is still in
`releases/` (and reinstall the plugin from it), then restart. A rollback needs
no rebuild — the old tarball is the artifact.

## Verify

```bash
HOST=<tailnet-ip>; PORT=18765; TOKEN="$(cat /data/dsh-home/gantt/mcp.token)"
curl -fsS "http://$HOST:$PORT/healthz"            # {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://$HOST:$PORT/mcp"   # 401
curl -fsS -X POST "http://$HOST:$PORT/mcp" \
  -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

`kubectl -n dsh get pod -l app=dsh` must show `2/2` after a restart; the
sidecar's entrypoint log (`kubectl -n dsh logs deploy/dsh -c gantt-mcp`) records
the installed release.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Pod `1/2`, sidecar `CrashLoopBackOff`, log `missing …/releases/dsh-gantt-<v>.tgz` | tarball absent or `GANTT_VERSION` mismatched |
| log `GANTT_MCP_TOKEN is not set` | Secret key missing in `dsh-secrets` |
| log `address already in use` | another MCP process on the port (e.g. a leftover manual run) |
| probe failures, `kubectl describe pod` shows `connection refused` on `/healthz` | probe `host` omitted: with `hostNetwork` the Pod IP is the host IP, but the sidecar binds the tailnet address, so `httpGet` must repeat that literal `host` |
| UI unreachable while the sidecar crash-loops | the Service selects the Pod, and an unready Pod leaves the endpoints list; fix the sidecar or remove it, the `dsh` container itself is healthy |
| two containers writing the DB | expected: SQLite WAL supports concurrent processes; keep transactions short (the store already does) |

## Clients

- Host Claude Code, stdio (no port, no token):

  ```bash
  claude mcp add gantt -- node /data/dsh-home/gantt/current/bin/gantt-mcp.js --db /data/dsh-home/gantt/tasks.db
  ```

- Host Claude Code, HTTP: `claude mcp add --transport http gantt http://<tailnet-ip>:18765/mcp --header "Authorization: Bearer $TOKEN"`.

- Mac Codex (`~/.codex/config.toml`) over the tailnet:

  ```toml
  [mcp_servers.gantt]
  url = "http://<tailnet-ip>:18765/mcp"
  bearer_token_env_var = "GANTT_MCP_TOKEN"
  ```
