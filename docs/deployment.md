# Deploying the plugin and the MCP sidecar

`dsh-gantt` ships as **one release artifact with two deployment units**: the
DSH plugin (Web UI half) installed into a DSH profile, and `gantt-mcp` (MCP
server) run as a second container next to DSH. Both read and write the same
SQLite file, so they are deployed together and upgraded in the same step.

The supported shape in this deployment is **k3s, same Pod, sidecar**. Kubernetes
manifests are templates in the package (`deploy/k3s/`), and the concrete
manifests, scripts and secrets live in the cluster repository
(`k3s-lab/dsh/`). A plain-host systemd deployment still exists but is kept as a
legacy appendix — it is not what this cluster runs.

## 1. The artifact: one tarball, two units

`pnpm run package` produces one tarball and its checksum file:

```text
dsh-gantt-<version>.tgz
SHA256SUMS
```

The tarball contains both units, so a plugin install and a sidecar install for
the same version can never diverge:

| Unit | Entry point in the tarball | Runs as |
| --- | --- | --- |
| Plugin (host half + browser bundle) | `package.json`, `src/host/`, `lib/client.js`, `cordis.patch.yml` | DSH process, installed into `DSH_HOME/profiles/<profile>` |
| MCP server | `bin/gantt-mcp.js` | its own container (or a local stdio client) |
| Deployment assets | `deploy/` | templates only; nothing auto-applies |

`bin/gantt-mcp.js` has zero runtime dependencies, so the sidecar needs `node`,
`bash` and `tar` — no `pnpm install`, no per-release image. That is why the
image is reused from DSH and the code always comes from the tarball.

Never delete a tarball from the persistent volume: the plugin profile records a
`file:` dependency that points at it by absolute path, so removing it breaks a
later reinstall of that version.

## 2. Topology (k3s)

```text
        ┌──────────────────────────────── k3s node, hostNetwork ─────────┐
        │  Pod dsh (Recreate)                        node IP 192.168.1.5 │
        │  ┌────────────────────┐   ┌───────────────────────────────┐    │
        │  │ dsh                │   │ gantt-mcp                     │    │
        │  │ web UI + plugin    │   │ entrypoint → current/bin/…    │    │
        │  │ owns schema        │   │ HTTP :18765                   │    │
        │  └─────────┬──────────┘   └───────────────┬───────────────┘    │
        │            └─────────► /data ◄────────────┘                    │
        │                        PVC dsh-data                            │
        │                        gantt/tasks.db          (SQLite WAL)    │
        │                        gantt/releases/*.tgz                    │
        │                        gantt/runtime/<v>, current              │
        └────────────────────────────────────────────────────────────────┘
                     │ tailnet 100.83.77.65:18765 (bearer token)
                     ▼
        clients: Claude Code on k3s-node, Claude Code + Codex on the Mac
```

| Piece | Notes |
| --- | --- |
| Pod | one DSH Deployment with two containers; `hostNetwork`, `Recreate`, PVC `/data` mounted at the same path in both |
| `gantt-mcp` port | `18765/tcp` on the node's tailnet address only. Never bind `0.0.0.0`: that publishes task writes to the LAN |
| token | Kubernetes Secret `dsh-secrets`, key `GANTT_MCP_TOKEN`; a non-loopback bind is refused without one |
| database | `/data/dsh-home/gantt/tasks.db`, `DSH_HOME=/data/dsh-home`; the plugin and the sidecar share one file |
| entrypoint | ConfigMap `gantt-entrypoint`, mounted at `/opt/gantt`, created from `deploy/k3s/gantt-mcp-entrypoint.sh` |

The sidecar is not a separate workload on purpose: a second Pod would need a
second mount of the RWO volume and a second version to keep in step, and
`hostNetwork` makes a Service/Ingress unnecessary.

The volume layout the entrypoint maintains:

```text
/data/dsh-home/gantt/
├── releases/dsh-gantt-<version>.tgz   release artifact — keep forever
├── releases/SHA256SUMS                verified when present
├── releases/desired                   version `GANTT_VERSION=auto` follows
├── runtime/<version>/                 extracted copy (pruned when unused)
├── current -> runtime/<version>       what the sidecar execs
├── tasks.db (+ -wal, -shm)            shared with the plugin
└── mcp.token                          optional 0600 copy to hand to clients
```

## 3. Fresh install (k3s)

Two levels: the cluster repository has the lab's real manifests and a
one-command installer; the package ships the portable contract in
[deploy/k3s/README.md](../deploy/k3s/README.md), whose "Fresh install" section
is the step-by-step reference for a different cluster.

### 3.1 With the cluster repository

```bash
cd k3s-lab/dsh
bash create.sh /path/to/dsh-gantt-<version>.tgz     # base Deployment + release
./verify-gantt.sh                                   # healthz / 401 / tools
```

`create.sh` applies the namespace, PVC, RBAC, Deployment (both containers), the
`gantt-entrypoint` ConfigMap, a generated `GANTT_MCP_TOKEN` (kept in the ignored
`.keys/`, never printed) and `install-gantt.sh`, which does the work below.

### 3.2 Portable steps (any cluster)

1. **Base workload first.** Apply the DSH Deployment and wait for the `dsh`
   container. The sidecar only gates itself, so a missing release marks one
   container unready, not the Pod.
2. **Put the release on the PVC** (`releases/dsh-gantt-<version>.tgz` and
   `SHA256SUMS`), via `kubectl cp` through the `dsh` container.
3. **Token.** Patch the Secret once; never put the token in a manifest:

   ```bash
   TOKEN="$(openssl rand -hex 24)"
   kubectl -n dsh patch secret dsh-secrets --type merge \
     -p "{\"data\":{\"GANTT_MCP_TOKEN\":\"$(printf %s "$TOKEN" | base64 -w0)\"}}"
   ```

4. **Entrypoint ConfigMap + sidecar patch.** Create `gantt-entrypoint` from
   `deploy/k3s/gantt-mcp-entrypoint.sh`, replace the `<dsh-image>` and
   `<tailnet-ip>` placeholders in `deploy/k3s/sidecar-patch.yaml`, preview with
   `--dry-run=server`, then apply it as a strategic merge patch. Probes must
   repeat the literal tailnet address as `httpGet.host`: under `hostNetwork` the
   Pod IP is the node IP, not the address the sidecar bound.

   Order does not matter: if the tarball is not on the PVC yet, the sidecar
   crash-loops until it appears and then installs itself on the next retry.

5. **Point `releases/desired` at the version** so `GANTT_VERSION=auto` runs that
   release instead of the newest tarball on the volume.

### 3.3 Plugin in the DSH profile

The same tarball is the plugin. Inside the Pod (`dsh` is not on `PATH`; the
image's CLI is `/data/app/node_modules/.bin/dsh`):

```bash
DSH=/data/app/node_modules/.bin/dsh
DSH_HOME=/data/dsh-home $DSH plugin --profile web add \
  file:/data/dsh-home/gantt/releases/dsh-gantt-<version>.tgz
DSH_HOME=/data/dsh-home $DSH --profile web --dump-config | grep -c dsh-gantt
kubectl -n dsh rollout restart deployment/dsh        # the host half loads at start
```

This is exactly what `install-gantt.sh` runs in its third step.

`add` is fast (a `file:` dependency, no network) and idempotent per version; the
profile keeps `"@local/dsh-gantt": "file:/data/dsh-home/gantt/releases/…"` and
selects the bundle, so `--dump-config` proves the plugin is part of the composed
tree. Because DSH loads the host half at startup, a plugin-only change still
needs the rollout — which is exactly what a full upgrade does (section 4.2).

Checks: `--dump-config` contains the package, the UI shows the Gantt/Today
pages, and `node /data/dsh-home/gantt/current/bin/gantt-mcp.js --help` prints
usage (the extracted tree is a complete release).

### 3.4 Switching a profile from `link:` to `file:`

Contributor profiles use `link:` (they point at a checkout). A cluster profile
pins a release instead. `add` replaces the existing dependency in place and
keeps the bundle selection, so no uninstall is needed:

```bash
DSH=/data/app/node_modules/.bin/dsh
DSH_HOME=/data/dsh-home $DSH plugin --profile web add \
  file:/data/dsh-home/gantt/releases/dsh-gantt-<version>.tgz
kubectl -n dsh rollout restart deployment/dsh
```

Rollback to the checkout is the reverse `add`:

```bash
DSH_HOME=/data/dsh-home $DSH plugin --profile web add /data/home/ws-plugin/dsh-gantt
kubectl -n dsh rollout restart deployment/dsh
```

Both directions were exercised in a scratch `DSH_HOME` against a release
tarball: the dependency became `file:/…/dsh-gantt-<version>.tgz`,
`dsh.profile.bundles` still listed `@local/dsh-gantt`, `--dump-config` listed
the package, and re-adding the checkout restored `link:`. Switching the live
profile restarts DSH, so run it in a maintenance window and then check
`--dump-config` and the Gantt page.

## 4. Upgrade and rollback

Two levels, because the artifact has two units.

### 4.1 Sidecar only (most upgrades)

The JSON-RPC server changes, the UI half does not. No Pod recreation, no DSH
restart, sessions keep running:

```bash
bash deploy/k3s/upgrade-mcp.sh /path/to/dsh-gantt-<version>.tgz
```

The script copies the tarball and its checksum into `releases/`, writes
`releases/desired`, then `kill -TERM 1` inside the `gantt-mcp` container. The
kubelet restarts only that container; the entrypoint reads `desired`, extracts
the release into `runtime/<version>`, swaps `current` atomically and execs the
new `bin/gantt-mcp.js`. It then asserts `serverInfo.version` and that the Pod UID
is unchanged, so a version mismatch or an accidental Pod recreation fails loudly.
The lab copy is `k3s-lab/dsh/upgrade-mcp.sh`; it can run inside the Pod as well.

This relies on the sidecar keeping `GANTT_VERSION=auto`. Pinning an explicit
version in the Deployment is supported but stops it from following `desired`.

### 4.2 Full upgrade (plugin half changes too)

```bash
bash install-gantt.sh /path/to/dsh-gantt-<version>.tgz   # in k3s-lab/dsh
```

It performs the same PVC and `desired` work, installs the plugin into the web
profile with `dsh plugin … add file:<tarball>`, and rolls the Deployment
(`Recreate`, so DSH restarts). Expect a restart of every DSH session; the
database is on the PVC and survives.

### 4.3 Rollback

Run the same command with the older tarball:

- sidecar only → `upgrade-mcp.sh` with the old version, `desired` moves back,
  the container restarts, `current` is re-pointed;
- full → `install-gantt.sh` with the old version, which reinstalls the plugin
  from that tarball and rolls the Pod.

No rebuild and no extra copy is needed: every installed tarball stays under
`releases/`, and `runtime/` is pruned and re-extracted by the entrypoint. Never
delete a tarball you may want to roll back to.

## 5. Schema contract

The database records its schema in `PRAGMA user_version` (currently **v8**).

- A build refuses a file written by a newer build instead of writing to it:
  `refusing to open …: schema v9 is newer than this build supports (v8); run the
  same release for the plugin and gantt-mcp`.
- Migrations are idempotent and serialized, so the plugin and the sidecar can
  start together after an upgrade without double-migrating.
- Therefore: upgrade both units in the same step (section 4.2), and roll back
  both units together if the old build predates the schema. The version-guard
  error is the signal that the two halves disagree.
- The message names both versions on purpose — quote it when reporting a
  deployment failure; it distinguishes "old code, new database" from a real
  data problem.

## 6. Health checks

| Check | Command | Expected |
| --- | --- | --- |
| Liveness (no auth, no DB write) | `curl -fsS http://100.83.77.65:18765/healthz` | `{"ok":true,"name":"dsh-gantt"}` |
| Auth enforced | `curl -s -o /dev/null -w '%{http_code}' -X POST http://100.83.77.65:18765/mcp -H 'content-type: application/json' -d '{}'` | `401` |
| Protocol handshake | `initialize` over the same endpoint | `result.serverInfo.name == "dsh-gantt"`, `version` = release |
| Tool surface | `tools/list` | five tools |
| Pod shape | `kubectl -n dsh get pod -l app=dsh` | `2/2` after a restart |

```bash
curl -fsS http://100.83.77.65:18765/mcp \
  -H "Authorization: Bearer $GANTT_MCP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"healthcheck","version":"0"}}}'
```

`verify-gantt.sh` in the cluster repository runs exactly these checks (plus the
token-less `401`) against the live Pod. `/healthz` answers even without a token,
which is why the Kubernetes probes use it; the handshake above is the readiness
proof that the store opened and the dispatcher answers. The server speaks MCP
revision `2025-06-18`.

`pnpm run e2e` covers the same surface without a cluster:
`tests/e2e/mcp-cli.spec.js` spawns the real CLI and asserts `/healthz`, `401`
without a token, `initialize`/`tools/list`, `202` notifications, malformed
input, the stdio handshake, and the refusal of a token-less network bind.

## 7. Clients

Remote clients never share a filesystem with the Pod, so they use **HTTP**.
stdio stays available, but only where the client can see
`/data/dsh-home/gantt/current/bin/gantt-mcp.js` — that is CLI runs inside the
Pod, not a workstation.

| Client | Register with | Script |
| --- | --- | --- |
| Claude Code on k3s-node | `claude mcp add --transport http gantt http://100.83.77.65:18765/mcp --scope user --header "Authorization: Bearer …"` | `k3s-lab/dsh/claude-http-mcp.sh` |
| Claude Code on the Mac | same, over the tailnet | `claude-http-mcp.sh --target mac` |
| Codex on the Mac | `~/.codex/config.toml` `[mcp_servers.gantt]` with `url` + `bearer_token_env_var` | `k3s-lab/dsh/codex-http-mcp.sh` |

Both scripts are idempotent: they take the token from `GANTT_TOKEN_FILE` on the
host (default `.tmp/gantt-mcp.token`, written once from the Secret; never in the
repository), push it to the client over SSH stdin, and compare it by SHA-256 so
an unchanged token is not rewritten. Then they register the server at user scope
and prove the connection with one real tool call. `--check` verifies without
changing anything.

### 7.1 Client gotchas learned in production

- **A `lo`-style wrapper that does not quote `$@` splits a prompt.** Pipe it
  instead of passing it as an argument:

  ```sh
  printf '%s' "$PROMPT" | lo -p --output-format json \
    --allowedTools=mcp__gantt__list_ready_tasks
  ```

- **Codex has no standalone `codex` on macOS** — the CLI lives inside
  `ChatGPT.app/Contents/Resources/codex-cli/…` — and non-interactive
  `codex exec` refuses MCP tools until that server allows them: set
  `default_tools_approval_mode = "approve"` in its `[mcp_servers.gantt]` table
  (per server, not globally). `-c approval_policy="never"` does not help.
- **A GUI-launched Codex does not inherit shell environment**, so it cannot see
  `GANTT_MCP_TOKEN` or the Azure key exported by `~/.zshrc`. The verified entry
  point is the terminal wrapper the script installs.
- **stdio clients inside Pod**: `claude mcp add gantt -- node
  /data/dsh-home/gantt/current/bin/gantt-mcp.js --db /data/dsh-home/gantt/tasks.db`.
- Register each tool under a distinct agent name (`register_agent`) so
  `operator`/`completedBy` stay readable in the UI.

Steps that change files or services on a remote host go through
[remote-exec.md](remote-exec.md) in this repository or through the cluster
scripts, so the pre-SSH guard and audit log apply.

## 8. Operations

- **Token rotation**: patch `dsh-secrets/GANTT_MCP_TOKEN`, restart the sidecar
  container (`kubectl -n dsh exec <pod> -c gantt-mcp -- kill -TERM 1`), then
  re-run the client scripts to push the new token. No database change, no
  plugin reinstall.
- **Logs**: `kubectl -n dsh logs deploy/dsh -c gantt-mcp` shows the entrypoint's
  install lines and request errors; JSON-RPC payloads are not logged.
  `kubectl -n dsh logs deploy/dsh -c dsh` covers the plugin half.
- **Backup**: copy `tasks.db` with SQLite's online backup, or stop the sidecar
  first — the `-wal` file carries recent commits.
- **Concurrency**: WAL plus a five-second `busy_timeout` lets the plugin, a
  stdio client and the HTTP server share the file. Each task write is a short
  `BEGIN IMMEDIATE`; a long manual transaction is the only realistic source of
  `SQLITE_BUSY`.
- **Version pinning**: `GANTT_VERSION=auto` follows `releases/desired`; an
  explicit value pins one release and disables the PVC-only upgrade path.
- **Pruning**: old `runtime/<version>` trees are removed by the entrypoint;
  `releases/` is never pruned automatically.

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pod `1/2`, sidecar `CrashLoopBackOff`, log `missing …/releases/dsh-gantt-<v>.tgz` | tarball absent or `GANTT_VERSION` pinned to a version not on the PVC | copy the tarball, or fix `desired` |
| probes fail with `connection refused`, container otherwise fine | `httpGet.host` omitted: with `hostNetwork` the kubelet probes the node IP, the sidecar binds the tailnet address | repeat the literal tailnet address in all three probes |
| `GANTT_MCP_TOKEN is not set` / pod cannot start | Secret key missing in `dsh-secrets` | patch the Secret, restart the sidecar |
| `401 unauthorized` | client and server tokens differ | re-run the client script; compare hashes |
| `address already in use` on `18765` | leftover manual `gantt-mcp` on the node | stop it; the sidecar must own the port |
| sidecar log `…: version: unbound variable` | stale `gantt-entrypoint` ConfigMap after an entrypoint fix | recreate the ConfigMap from `deploy/k3s/gantt-mcp-entrypoint.sh` |
| `schema vN is newer than this build supports` | plugin and sidecar are different versions | install one release for both units |
| `SQLITE_BUSY` | long write transaction elsewhere | retry; keep external transactions short |
| Mac: `connection refused` | tailscale down, wrong address, or the firewall drops the packet | `tailscale status`, `curl http://100.83.77.65:18765/healthz` from the Mac |
| tools missing in a client | old client, wrong transport, or Codex approval mode | require MCP `2025-06-18`; set `default_tools_approval_mode = "approve"` |
| UI unreachable while the sidecar crash-loops | the Service selects the Pod and an unready Pod leaves the endpoint list | fix or remove the sidecar; the `dsh` container itself is healthy |

## Appendix A: legacy host deployment (systemd)

Before the plugin ran in k3s, `gantt-mcp` was a systemd service on the same host
as `dsh web`. The assets are still shipped in the package and still work for a
single-machine, non-Kubernetes host; no installer is added for this shape and
nothing in the cluster uses it.

`deploy/gantt-mcp.service` + `deploy/mcp.env.example`:

```sh
sudo install -d -m 0750 /etc/dsh-gantt
sudo install -m 0600 deploy/mcp.env.example /etc/dsh-gantt/mcp.env
sudoedit /etc/dsh-gantt/mcp.env            # GANTT_MCP_HOST/PORT/TOKEN, DSH_GANTT_DB
sudo cp deploy/gantt-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now gantt-mcp
systemctl status gantt-mcp --no-pager
```

Differences from the k3s shape, so the two are not confused:

| | k3s sidecar (supported) | systemd (legacy) |
| --- | --- | --- |
| Code source | release tarball on the PVC, extracted at start | a checkout or an unpacked tarball on the host |
| Port | `18765` on the tailnet address | `8765`, loopback or LAN |
| Token | Secret `dsh-secrets` | `/etc/dsh-gantt/mcp.env`, `0600` |
| Upgrade | tarball + `desired` + container or Pod restart | replace the checkout, `systemctl restart gantt-mcp` |
| With no token | refused for any non-loopback bind | same rule |
| Health | Kubernetes probes on `/healthz` | `curl -fsS http://127.0.0.1:8765/healthz` |

Loopback binds are the only token-less ones in either shape:
`127.0.0.1`, `::1` and `localhost` may serve without `GANTT_MCP_TOKEN`; any
other address refuses to start without one
(`refusing to serve 0.0.0.0 without a bearer token; set GANTT_MCP_TOKEN or
--token`). For a LAN-facing legacy install, allow only the client subnet
(`sudo ufw allow from 192.168.1.0/24 to any port 8765 proto tcp`) or bind the
overlay address instead of `0.0.0.0`.

## Appendix B: out of scope

- **Service / Ingress / NetworkPolicy / multi-replica.** The sidecar binds the
  node's tailnet address inside a `hostNetwork` Pod; there is nothing to route
  and one SQLite writer is the design. Exposing MCP beyond the tailnet is a
  separate networking decision.
- **Per-release images.** The image only provides `node`, `bash` and `tar`; code
  always comes from the tarball, which is what makes upgrade and rollback a file
  operation.
- **A second MCP deployment for a second client.** Clients are stateless; they
  all talk to the one sidecar and the same database.

The MCP server itself — transports, authentication, the five tools and their
schemas — is documented in [mcp.md](mcp.md). Contributor install from a checkout
(`pnpm run deploy`, `link:` dependencies) is documented in
[development.md](development.md); it is not a deployment path for the cluster.
