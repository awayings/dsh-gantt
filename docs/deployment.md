# Hosting the MCP server for remote coding tools

`dsh-gantt` exposes its task tree over the [Model Context Protocol](mcp.md) so
external coding tools can list ready work, read one task's context, and report
completions back into the same SQLite database the Web UI shows. This page is
the deployment recipe for the case where one client runs **on the host** (Claude
Code, stdio) and another runs **on a different machine** (Codex on a Mac over
the network), so the HTTP transport has to stay up as a service.

Kubernetes exposure (Service, Ingress, NetworkPolicy) is a separate concern and
is documented by its own task; this page covers a plain host deployment.

## 1. Topology and the services involved

```text
        ┌──────────────────── host machine ──────────────────────────────┐
        │                                                                │
        │  dsh web ──── serves the Gantt UI, owns schema/migrations      │
        │      │                                                         │
        │      └──► /data/dsh-home/gantt/tasks.db (SQLite + WAL) ◄──┐    │
        │                                    ▲                      │    │
        │  Claude Code ── stdio ──► gantt-mcp (per session) ────────┘    │
        │                                                                │
        │  gantt-mcp --transport http :8765 ────────────────────────┐    │
        └───────────────────────────────────────────────────────────┼────┘
                                                                    │ LAN / Tailscale
                                                                    ▼
                                                        Mac: Codex client (HTTP)
```

| Service | What runs it | Required for | Port | Notes |
| --- | --- | --- | --- | --- |
| DSH web (`dsh web`) | the host user | Web UI, schema migration, the plugin's own tools | `3080/tcp` loopback | The plugin's SQLite is created/migrated here on first start |
| `gantt-mcp` HTTP | systemd unit below | Remote MCP clients (Mac Codex) | `8765/tcp` | A non-loopback bind is refused without a bearer token |
| `gantt-mcp` stdio | the local client (Claude Code spawns it) | Host-local MCP clients | none | One short-lived process per MCP session; shares the same DB |
| SQLite file | - | everything | none | `$DSH_HOME/gantt/tasks.db`; WAL mode and `busy_timeout = 5000` already set |
| Optional reverse proxy | nginx/Caddy | TLS for untrusted networks | `443/tcp` | Only if the MCP port must be reachable beyond a trusted LAN or overlay |

All MCP transports share **one** database. There is no separate server-side
state; registering an agent, reporting a completion, or reading a task context
is the same write path the Web UI uses.

## 2. Ports and network exposure

| Port | Protocol | Bind | Purpose |
| --- | --- | --- | --- |
| `8765` | HTTP | `127.0.0.1` (default) or `0.0.0.0` | MCP JSON-RPC: `POST /mcp`, liveness `GET /healthz` |
| `3080` | HTTP | `127.0.0.1` | DSH Web UI and the plugin's JSON API (keep it local) |
| `443` | HTTPS | `0.0.0.0` | Optional reverse proxy in front of `8765` |

Binding rules enforced by the server:

- `127.0.0.1`, `::1`, and `localhost` may serve **without** a token (only the
  host reaches them).
- Any other bind (`0.0.0.0`, `::`, a LAN address) **requires**
  `GANTT_MCP_TOKEN`; without it the process refuses to start:
  `refusing to serve 0.0.0.0 without a bearer token; set GANTT_MCP_TOKEN or --token`.

Host firewall example (Ubuntu `ufw`), allowing only the Mac's LAN segment:

```sh
sudo ufw allow from 192.168.1.0/24 to any port 8765 proto tcp
```

If both machines are on a Tailscale/WireGuard network, bind the overlay address
instead of `0.0.0.0` and drop the LAN rule; that keeps the port off every other
interface.

## 3. Prepare the token and the environment file

```sh
openssl rand -hex 32                       # the MCP bearer token
sudo install -d -m 0750 /etc/dsh-gantt
sudo install -m 0600 deploy/mcp.env.example /etc/dsh-gantt/mcp.env
sudoedit /etc/dsh-gantt/mcp.env
```

```sh
# /etc/dsh-gantt/mcp.env
GANTT_MCP_HOST=0.0.0.0
GANTT_MCP_PORT=8765
GANTT_MCP_TOKEN=<the hex token>
DSH_GANTT_DB=/data/dsh-home/gantt/tasks.db
```

The CLI reads all four variables, so the service needs no flags. Keep the file
`0600`: it holds the only copy of the token the server trusts.

## 4. Start the service

### 4.1 Foreground (first run, troubleshooting)

```sh
set -a; . /etc/dsh-gantt/mcp.env; set +a
node /data/home/ws-plugin/dsh-gantt/bin/gantt-mcp.js --transport http
# gantt-mcp listening on http://0.0.0.0:8765
```

Run it from the repository root or pass `--db`/`DSH_GANTT_DB`; the CLI has no
runtime dependencies, so plain `node` is enough (no `pnpm install` on the host).

### 4.2 systemd (the actual deployment)

`deploy/gantt-mcp.service` is the unit template. It runs as the DB owner user,
loads `/etc/dsh-gantt/mcp.env`, restarts on failure, and keeps only the gantt
data directory writable.

```sh
sudo cp deploy/gantt-mcp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gantt-mcp
systemctl status gantt-mcp --no-pager
journalctl -u gantt-mcp -f
```

Adjust `ExecStart`, `User`, and `ReadWritePaths` if the checkout or the
database lives elsewhere. Restart after upgrading the host half:
`git pull && sudo systemctl restart gantt-mcp`.

## 5. Health checks

| Check | Command | Expected |
| --- | --- | --- |
| Liveness (no auth, no DB write) | `curl -fsS http://127.0.0.1:8765/healthz` | `{"ok":true,"name":"dsh-gantt"}` |
| Auth is enforced | `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8765/mcp -H 'content-type: application/json' -d '{}'` | `401` |
| Protocol handshake | see below | `result.serverInfo.name == "dsh-gantt"` |
| Tool surface | `tools/list` over the same endpoint | five tools |

```sh
curl -fsS http://127.0.0.1:8765/mcp \
  -H "Authorization: Bearer $GANTT_MCP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"healthcheck","version":"0"}}}'
```

`/healthz` answers even when the token is wrong or missing, so it is safe for a
systemd/monitoring probe; the handshake check above is the readiness probe (it
proves the store opened and the MCP dispatcher answers). The server speaks MCP
revision `2025-06-18` and echoes the client's requested revision.

`pnpm run e2e` includes `tests/e2e/mcp-cli.spec.js`, which spawns the real CLI
and covers the same surface automatically: `/healthz`, `401` without the token,
`initialize`/`tools/list`, `202` notifications, unknown paths, malformed JSON,
the stdio handshake, and the refusal of a token-less network bind. Run it before
trusting a new checkout on the host.

## 6. Client configuration

Register each tool under a distinct agent name so `operator`/`completedBy` stay
readable in the UI.

### 6.1 Claude Code on the host — stdio (preferred)

```sh
claude mcp add gantt -- node /data/home/ws-plugin/dsh-gantt/bin/gantt-mcp.js
claude mcp list          # gantt: ✔ Connected, with the five tools
```

Stdio needs no port, no token, and starts one short-lived process per session.
It can also use the loopback HTTP endpoint instead:

```sh
claude mcp add --transport http gantt http://127.0.0.1:8765/mcp \
  --header "Authorization: Bearer $GANTT_MCP_TOKEN"
```

### 6.2 Codex on the Mac — HTTP

`~/.codex/config.toml`:

```toml
[mcp_servers.gantt]
url = "http://<host-lan-ip>:8765/mcp"
bearer_token_env_var = "GANTT_MCP_TOKEN"
```

The CLI form is `codex mcp add gantt --url http://<host-lan-ip>:8765/mcp`; add
the `bearer_token_env_var` line to the resulting table because Codex has no
token flag for that field. `codex mcp list` shows the server and its tools.

Export `GANTT_MCP_TOKEN` in the shell that starts Codex (same token as the
service), then check the connection:

```sh
codex mcp list
```

The Mac must reach the host on `8765/tcp`; a `connection refused` means the
service binds loopback only or the firewall drops the packet.

### 6.3 Changing which task a report targets

Both clients call the same five tools (`register_agent`, `list_agents`,
`list_ready_tasks`, `get_task_context`, `report_completion`); see
[mcp.md](mcp.md) for the parameter and return schemas.

## 7. Operations

- **Token rotation**: write a new value into `/etc/dsh-gantt/mcp.env`,
  `systemctl restart gantt-mcp`, then update the Mac's environment. No database
  change and no client reinstall.
- **Concurrency**: WAL plus `busy_timeout = 5000` lets the Web UI, a stdio
  client, and the HTTP service share the file. Writes are short and use
  `BEGIN IMMEDIATE`; a long manual transaction is the only realistic source of
  `SQLITE_BUSY`.
- **Backup**: stop the service (or use SQLite's online backup) before copying
  `tasks.db`; the `-wal` file carries recent commits.
- **Upgrade**: `git pull` in the checkout, `pnpm run build` if client sources
  changed, `sudo systemctl restart gantt-mcp`; restart `dsh web` when host code
  changed (new routes or tables only take effect after a restart).
- **Logs**: the service logs the bind line and request errors to the journal
  (`journalctl -u gantt-mcp`); the JSON-RPC payloads themselves are not logged.

## 8. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `401 unauthorized` | token missing/mismatched | set the same `GANTT_MCP_TOKEN` on server and client |
| `refusing to serve 0.0.0.0 without a bearer token` | network bind without token | set `GANTT_MCP_TOKEN` in the env file |
| `EADDRINUSE` | another process holds `8765` | stop it or pick another `GANTT_MCP_PORT` |
| Mac: `connection refused` | service bound to `127.0.0.1` | bind `0.0.0.0`/the LAN address and restart |
| Mac: timeout | firewall or wrong IP | open `8765/tcp`, verify `hostname -I` |
| `SQLITE_BUSY` | long write transaction elsewhere | retry; keep external transactions short |
| tools missing in a client | protocol mismatch or old client | require an MCP client that speaks `2025-06-18` |

## 9. Out of scope

Kubernetes Service/Ingress definitions, cluster NetworkPolicy, and secret
management stay outside this feature; the host deployment above is the supported
shape today. The MCP server itself is described in [mcp.md](mcp.md).
