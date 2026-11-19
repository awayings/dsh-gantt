# MCP server

`@local/dsh-gantt` ships a small [Model Context Protocol](https://modelcontextprotocol.io/)
server so an external coding tool — Claude Code, Codex, or any JSON-RPC client
— can join the same task tree the Web UI shows: register itself as an operator,
pull ready work and task context, create and decompose tasks, update them,
record a round against a task, and report a completion back into the same SQLite
store.

The server has no runtime dependency and no protocol SDK: it is a hand-written
JSON-RPC 2.0 implementation over newline-delimited stdio (the default) or an
optional HTTP transport. There is no MCP `resources`/`prompts` surface; the ten
tools below are the contract. The worker-side workflow that uses them — pull
loop, when to decompose, how a round is closed — is in
[worker-flow.md](worker-flow.md) and is also served by the `get_worker_guide`
tool.

## Run it

```sh
node /absolute/path/to/dsh-gantt/bin/gantt-mcp.js
pnpm run mcp                       # same entry from a checkout
```

Register it with Claude Code:

```sh
claude mcp add gantt -- node /absolute/path/to/dsh-gantt/bin/gantt-mcp.js
```

The process speaks JSON-RPC on stdin/stdout, so it is the child of the coding
tool: the tool sends one JSON object per line and reads one response line. A
notification (a request without an `id`) produces no line. A line that is not
valid JSON is answered with JSON-RPC error `-32700` and `id: null`; blank lines
are ignored.

The `bin` field in `package.json` also exposes `gantt-mcp` when the package is
installed from a directory. A DSH profile is not required: the CLI opens the
database directly.

### CLI options

| Option | Default | Meaning |
| --- | --- | --- |
| `--transport <stdio\|http>` | `stdio` | Transport; `http` starts the optional server |
| `--host <host>` | `GANTT_MCP_HOST`, else `127.0.0.1` | HTTP bind host |
| `--port <port>` | `GANTT_MCP_PORT`, else `8765` | HTTP bind port (`0` picks a free port) |
| `--db <path>` | `DSH_GANTT_DB`, else `$DSH_HOME/gantt/tasks.db` | SQLite file |
| `--token <token>` | `GANTT_MCP_TOKEN`, else empty | Bearer token for HTTP |
| `--help` | — | Print usage and exit |

Both `--flag value` and `--flag=value` are accepted. Unknown options, an invalid
transport, or an out-of-range port exit with status `1` and print usage on
stderr.

## Transport: stdio (default)

```sh
claude mcp add gantt -- node /abs/path/dsh-gantt/bin/gantt-mcp.js --db /abs/path/tasks.db
```

- One JSON-RPC message per line; responses are `JSON.stringify(response) + '\n'`.
- Notifications never produce output.
- `SIGINT`/`SIGTERM` close the database and exit `0`.

Do not add `Content-Length` framing. Newline-delimited JSON is the MCP stdio
contract and is what the bundled clients expect.

## Transport: HTTP (optional)

```sh
node bin/gantt-mcp.js --transport http --host 127.0.0.1 --port 8765
# with auth:
GANTT_MCP_TOKEN=secret node bin/gantt-mcp.js --transport http --port 8765
```

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/mcp` | One JSON-RPC message; `200` with the response, `202` for a notification, `400` for invalid JSON |
| `GET` | `/healthz` | `200 {"ok":true,"name":"dsh-gantt"}` |

Every other method/path is `404`. The startup log prints the bound address, for
example `gantt-mcp listening on http://127.0.0.1:8765`.

When a token is configured, every `POST /mcp` must send
`Authorization: Bearer <token>`; a missing or wrong header is `401`.
`GET /healthz` is not authenticated. A bind other than `127.0.0.1`, `::1`, or
`localhost` **requires** a token: the process refuses to start without one
(`refusing to serve 0.0.0.0 without a bearer token …`), so a LAN address cannot
expose task writes unauthenticated. Only a loopback bind may serve token-less.

For the supported deployment — `gantt-mcp` as a sidecar in the DSH Pod, behind a
bearer token — follow [deployment.md](deployment.md): the two deployment units in
one release tarball, the install/upgrade/rollback sequence, the schema contract,
and the client setup for Claude Code and Codex.

The MCP process and the DSH Web UI may open the same `tasks.db`: WAL lets
readers proceed concurrently, the store sets a five-second `busy_timeout`, and
each task write is a short `BEGIN IMMEDIATE` transaction, so a writer waits out
a brief lock instead of failing with `SQLITE_BUSY`. Keep individual MCP calls
short and do not run long ad-hoc transactions against the same file.

### Kubernetes

The HTTP transport only opens a listener; it creates no Kubernetes objects. The
supported shape is a same-Pod sidecar under `hostNetwork` that binds the node's
tailnet address with a token from a Secret, so no Service or Ingress is involved.
Install, upgrade, rollback and the schema contract are in
[deployment.md](deployment.md); Service/Ingress/NetworkPolicy and multi-replica
deployments stay out of scope because one SQLite file has one writer.

## Database path

The CLI resolves the database exactly like the host plugin:

1. `--db <path>` if given;
2. `DSH_GANTT_DB` if set;
3. `$DSH_HOME/gantt/tasks.db`, where `DSH_HOME` defaults to `~/.dsh`.

Use a disposable file (`DSH_GANTT_DB=/tmp/gantt-mcp.db`) for experiments so the
real `$DSH_HOME/gantt/tasks.db` is never touched. The schema is upgraded to v9
on open, including the `agents` table, the task operator/completer/report
columns, and the `tags` label column.

## Tools

Every successful `tools/call` returns MCP content:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [{ "type": "text", "text": "{\"ok\":true,...}" }]
  }
}
```

The `text` field is `JSON.stringify` of the tool result documented below.
Validation failures and unknown tools return `isError: true` with the message
as text; they never crash the server.

| Tool | Purpose |
| --- | --- |
| `register_agent` | Register or update this tool as a human/AI operator |
| `list_agents` | List operators with optional filters |
| `list_ready_tasks` | Pull ready / next / todo work |
| `get_task_context` | Read one task's stable markdown context |
| `create_task` | Create a child task, or the next sibling of a task |
| `decompose_task` | Split one task into 1–100 child tasks |
| `update_task` | Update status, progress, title, description, doneWhen, or dates |
| `track_task` | Record a round against a task without writing the tree |
| `report_completion` | Write the operator, completer, report, status, and progress back |
| `get_worker_guide` | Read the full worker playbook |

All ten tools return `{ "ok": true, … }` on success and `isError` content on a
validation failure. `taskId` / `parentId` / `afterTaskId` accept three forms:
the internal UUID, the rendered point number (`1.8.1`), or an external ref.
`agentId` / `agentName` resolve the same registered operator, so a worker never
has to remember the UUID: `name` is the upsert key, and `agentName` is enough on
every write. Every write records provenance in the `task_events` trajectory
under the worker's `session` when it passes one, else `agent:<name>`, so a
remote worker is never indistinguishable from a manual API write. Two rules
follow from that: an unregistered `agentName` is an error (`agent <name> was not
found; call register_agent first`), and a call that passes neither `agentId` nor
`agentName` writes anonymously under the `mcp:manual` context key — register
first.

### `register_agent`

Registration is idempotent by `name`: registering the same name again updates
that row and returns the same `id`. Passing an existing `id` updates by id; an
unknown `id` falls back to the name upsert. Names are unique.

| Parameter | Required | Notes |
| --- | --- | --- |
| `name` | yes | 1–100 characters, trimmed and whitespace-collapsed |
| `type` | yes | `human` or `ai-agent` |
| `role` | no | Free text, at most 2000 characters |
| `description` | no | Free text, at most 2000 characters |
| `details` | no | Free text, at most 2000 characters |
| `endpoint` | no | Free text, at most 2000 characters |
| `id` | no | Existing agent id; ignored when unknown |

Returns:

```json
{
  "ok": true,
  "agent": {
    "id": "0f0c1c2e-…",
    "name": "Codex",
    "type": "ai-agent",
    "role": "implementer",
    "description": "",
    "details": "",
    "endpoint": "",
    "createdAt": "2026-11-17T00:00:00.000Z",
    "updatedAt": "2026-11-17T00:00:00.000Z"
  }
}
```

### `list_agents`

| Parameter | Required | Notes |
| --- | --- | --- |
| `type` | no | `human` or `ai-agent` |
| `role` | no | Exact role match |
| `q` | no | Fuzzy match over `name`, `role`, `description`, and `details` |
| `limit` | no | Integer 1–100, default 20 |

Returns `{ "ok": true, "agents": [ … ] }`, ordered by name. Each row has the
same shape as `register_agent`'s `agent`.

### `list_ready_tasks`

| Parameter | Required | Notes |
| --- | --- | --- |
| `tag` | no | `ready` (default), `next`, or `todo` |
| `limit` | no | Integer 1–100, default 20 |

- `ready` — pending leaves (`todo`/`blocked`, no children) whose `dep` is empty
  or points at a completed imported node.
- `next` — the frontier rule `computeBrief(tree).next`: the first executable
  pick per track.
- `todo` — every pending leaf.

Rows are grouped by track in rendered tree order, then in document order:

```json
{
  "ok": true,
  "tag": "ready",
  "tasks": [
    {
      "id": "0f0c1c2e-…",
      "number": "1.8.1",
      "ref": "node:1.8.1",
      "title": "S2 每日交易仓读数",
      "status": "todo",
      "description": "",
      "doneWhen": "每天一句读数 + 三条腿各一个数",
      "trackId": "…",
      "trackName": "投资系统"
    }
  ]
}
```

### `get_task_context`

| Parameter | Required | Notes |
| --- | --- | --- |
| `taskId` | yes | Internal id, point number, or ref |

Returns:

```json
{ "ok": true, "taskId": "…", "markdown": "# 任务上下文：…", "chars": 1234 }
```

The markdown is stable and deterministic (it never contains the current time):
title, status/progress/operator/completer/description/doneWhen/dates/category/
estimate/landing/inspiration/dependency, the link list, `## 任务链路`,
`## 当前任务`, `## 汇报结果` when a report exists, and `## 任务轨迹` with the
newest recorded events. Unknown ids are `isError` text `task … was not found`.

### `create_task`

| Parameter | Required | Notes |
| --- | --- | --- |
| `title` | yes | 1–200 characters |
| `parentId` | one of | Parent task; creates a child |
| `afterTaskId` | one of | Reference task; creates the next sibling |
| `doneWhen` | no | Verifiable completion standard |
| `description` | no | At most 4000 characters |
| `status` | no | Status vocabulary; default `todo` |
| `startDate` / `endDate` | no | `YYYY-MM-DD`; default today and start + 3 days |
| `agentName` | no | Registered agent recorded as `operatorId` when the task has none |
| `session` | no | The worker's own conversation/run id, recorded in the trajectory |

Exactly one of `parentId` / `afterTaskId` is required. A child insert records a
`create` event; a sibling insert also records a `track` event on the reference
task, exactly like the in-process `gantt_create_task` tool. Returns
`{ "ok": true, "task": { … } }`.

### `decompose_task`

| Parameter | Required | Notes |
| --- | --- | --- |
| `parentId` | yes | Task being split; internal id, point number, or ref |
| `children` | yes | 1–100 child objects |
| `planDate` | no | `YYYY-MM-DD`; only the default child date range |
| `summary` | no | Recorded on the parent's `decompose` event |
| `agentName` / `session` | no | As on `create_task` |

Each child needs `title` and a verifiable `doneWhen`; `description`,
`estimate`, `category`, `landing`, `inspiration`, and `status` are optional.
The tree is capped at four levels, so a task at depth 4 cannot be decomposed.
Returns `{ "ok": true, "parent": { … }, "children": [ … ] }`. Read
`get_task_context` first: a decomposition needs the ancestor chain and the
background the parent carries, which a title alone does not provide.

### `update_task`

| Parameter | Required | Notes |
| --- | --- | --- |
| `taskId` | yes | Internal id, point number, or ref |
| `title`, `description`, `doneWhen` | no | Any one is enough to write |
| `status` | no | Status vocabulary |
| `progress` | no | 0–100 |
| `startDate` / `endDate` | no | `YYYY-MM-DD` |
| `summary` | no | What changed, or the completion evidence; recorded in the trajectory |
| `agentName` / `session` | no | As on `create_task` |

A write with none of the mutable fields is rejected with `nothing to update`.
`operator_id` is claimed only when the task has no operator; an existing
operator is never overwritten. Returns `{ "ok": true, "task": { … } }`.

### `track_task`

| Parameter | Required | Notes |
| --- | --- | --- |
| `taskId` | yes | Internal id, point number, or ref |
| `summary` | yes | What this round did |
| `agentName` / `session` | no | As on `create_task` |

Use it when a round only read, investigated, or produced evidence elsewhere: it
appends one `track` event and touches nothing else. Returns
`{ "ok": true, "event": { … } }`.

### `get_worker_guide`

No parameters. Returns `{ "ok": true, "markdown": "# Working a shared Gantt task tree…" }`
— the server's authoritative playbook, readable without a local skill file. It
carries the round-closing discipline, the task-id forms, and the commit
convention (end the subject with the task's point number, template
`<type>(<scope>): <imperative subject> (<point number>)`).
[worker-flow.md](worker-flow.md) is the human-facing companion: install, client
setup, and smoke tests. The guide is served live, but the client copies of the
playbook (`~/.claude/skills/gantt-worker/SKILL.md`, the `gantt` block in
`~/.codex/AGENTS.md`) are pushed by the installers and do not refresh
themselves: after editing this guide, `MCP_INSTRUCTIONS`, a tool schema, or
[deploy/worker/](../deploy/worker), re-run both clients with one command —
`bash k3s-lab/dsh/sync-workers.sh` ([worker-flow.md](worker-flow.md#keeping-the-client-copies-in-sync)).

### `report_completion`

| Parameter | Required | Notes |
| --- | --- | --- |
| `taskId` | yes | Internal id, point number, or ref |
| `agentId` or `agentName` | yes | One registered operator, by id or by unique name |
| `report` | yes | Non-empty, at most 4000 characters |
| `status` | no | Status vocabulary; default `done` |
| `progress` | no | 0–100; default follows `defaultProgress` for the status |
| `session` | no | The worker's own conversation/run id, recorded on the `complete` event |

The write happens in one transaction: `operator_id` is set only when it was
empty, `completed_by_id` and `report` are overwritten, status/progress are
applied, ancestor rollups are recomputed, and one `complete` event with the
report as its detail is appended under the worker's session key. Returns:

```json
{
  "ok": true,
  "task": {
    "id": "…",
    "title": "S2 每日交易仓读数",
    "status": "done",
    "progress": 100,
    "operatorId": "…",
    "completedById": "…",
    "report": "shipped; verified in tests/report.spec.js"
  },
  "event": {
    "id": "…",
    "taskId": "…",
    "sessionId": "",
    "turn": null,
    "action": "complete",
    "detail": "shipped; verified in tests/report.spec.js",
    "at": "2026-11-17T00:00:00.000Z"
  }
}
```

## Protocol details

- `initialize` echoes `params.protocolVersion` when it is a string, otherwise
  answers `2025-06-18`; it advertises `capabilities.tools.listChanged: false`,
  `serverInfo: { name: "dsh-gantt", version: "1.6.0" }`, and a short
  `instructions` string with the worker contract (clients may truncate it; the
  full playbook is `get_worker_guide`).
- `notifications/initialized` and every other message without an `id` are
  ignored.
- `ping` returns `{}`; `tools/list` returns the ten tool schemas verbatim.
- Unknown methods are JSON-RPC error `-32601`; a non-object message or a
  missing/blank `method` is `-32600` with `id: null` when the request has no
  usable id.
- Tool failures are content errors (`isError: true`), not JSON-RPC errors, so a
  client can show the message and retry.

## HTTP API vs MCP

The same capabilities are available as authenticated `/api/gantt/*` routes for
the Web UI and other in-process callers. The MCP transport is for external
coding tools that speak the protocol; it opens its own SQLite handle and has no
DSH session cookie. See [api.md](api.md) for the HTTP shapes and
[work-context.md](work-context.md) for the assistant-tool context layout.

## Troubleshooting

- **`401 unauthorized`** — set `GANTT_MCP_TOKEN`/`--token` on both sides and
  send `Authorization: Bearer <token>`.
- **`EADDRINUSE`** — another process holds the port; stop it or pass
  `--port 0`/a free port.
- **`SQLITE_BUSY` / `database is locked`** — another process is writing the same
  file. One DSH process owns one database; use a distinct `--db` for an
  experiment.
- **No tools in the coding tool** — check that the command points at the real
  `bin/gantt-mcp.js` and that Node is the version DSH runs (see
  [compatibility.md](compatibility.md)). Send a manual `ping`/`initialize` line
  to confirm the process is alive. Over HTTP, a missing `Authorization` header is
  `401` on every call, which most clients render as an empty tool list; Codex
  additionally shows `Tools: (none)` in `/mcp` for working servers, so call
  `get_worker_guide` to tell the two apart.
- **`-32700` on every line** — the client is sending batched or
  `Content-Length`-framed JSON. Send one newline-delimited object per line.
- **The schema is old** — reopen the database with the new build; `--db` is
  upgraded to v9 on open. The real `$DSH_HOME/gantt/tasks.db` is never modified
  by the test suite.
