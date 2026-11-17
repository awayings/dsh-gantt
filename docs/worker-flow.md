# Worker flow: joining the shared task context

`dsh-gantt` keeps one working tree in SQLite: every track, node, and decomposed
task, the fields that describe them, and an append-only trajectory of the
sessions and rounds that touched them. A conversation's context is disposable;
the tree is not. The Gantt view adds the two dimensions a transcript lacks:
time (dates, progress rolled up from children) and relation (ancestor chain,
siblings, links).

A worker - Codex on a Mac, Claude Code on a k3s node, a CLI inside the Pod -
joins that store so its rounds become one durable record: what one session
learns is readable by the next session on any machine, new levels decompose
against the chain already there, and the human's Gantt shows what happened
instead of a guess. The server is authoritative: call `get_worker_guide` for
its playbook. This page is the installer's view of the same loop and
complements [mcp.md](mcp.md) and [deployment.md](deployment.md).

## Pull only: there is no dispatch

Nothing pushes work to a worker. The server has no queue, no assignment, no
outbound call, and no notification; that surface is deliberately not
implemented. A worker pulls: `list_ready_tasks` for executable work,
`get_task_context` for one task's background, `list_agents` for the peers it
shares the tree with, and writes the result back. A human naming a task by
point number or id is the only other entry point.

Consequences: there is no "wait for work" loop (pull at the start of a task,
then work; never poll), nobody notices a worker that goes quiet (record
`status: "blocked"` with the blocker in `summary`), and the human coordinates:
when the chain is ambiguous, ask rather than invent a parent or sibling.

## Prerequisites

| Item | Value |
| --- | --- |
| Endpoint | `http://100.83.77.65:18765/mcp` on the tailnet; reachable only from a Tailscale peer |
| Health | `GET /healthz` returns `{"ok":true,"name":"dsh-gantt"}`, unauthenticated |
| Token | `GANTT_MCP_TOKEN`, a 32+ hex secret from `dsh-secrets` |
| Token on a client | `~/.config/gantt-mcp/token`, mode 0600 |
| Protocol | MCP `2025-06-18`, HTTP transport (`streamable_http` in Codex); `initialize` carries short instructions |

The client needs no Node.js and no checkout: HTTP transport, plain JSON-RPC. A
token-less network bind is refused and a wrong token is `401`, so a missing
credential shows up as "zero tools", never as a working server. Remote clients
share no filesystem with the Pod, so stdio registration is not an option.

The two client scripts live outside this repository
(`k3s-lab/dsh/codex-http-mcp.sh`, `k3s-lab/dsh/claude-http-mcp.sh`); run them
from the host that holds the token file, not on the client. Every remote step
goes through the safety-gated SSH wrapper in [remote-exec.md](remote-exec.md).
Both are idempotent; `--check` verifies, `--no-model` skips the model call.

## Codex on macOS

`bash k3s-lab/dsh/codex-http-mcp.sh` (target `mac` by default) does three things:

1. Pushes `/data/home/ws-plugin/.tmp/gantt-mcp.token` to
   `~/.config/gantt-mcp/token` (0600), skipping the write when the SHA-256 is
   unchanged.
2. Installs `~/.local/bin/co`: it reads the token file, exports
   `GANTT_MCP_TOKEN`, optionally exports the Azure key from `~/.zshrc`, and
   execs the Codex CLI inside `ChatGPT.app` (not on `PATH`; a GUI launch
   inherits no shell exports).
3. Registers the server at user scope with `co mcp add gantt --url
   http://100.83.77.65:18765/mcp --bearer-token-env-var GANTT_MCP_TOKEN`, then
   sets `default_tools_approval_mode = "approve"` for that server only; without
   it, non-interactive `co exec` answers "approval required".

It then proves the wiring with one model call (`list_ready_tasks`,
`get_task_context`, `register_agent`). The same run installs
[AGENTS.md.snippet](../deploy/worker/AGENTS.md.snippet) into `~/.codex/AGENTS.md`
between the `<!-- gantt-mcp:begin -->` / `<!-- gantt-mcp:end -->` markers,
substituting the worker name `codex-http` for `<gantt-agent-name>` (override with
`GANTT_AGENT_NAME`); a re-run replaces the block in place and leaves the rest of
the file untouched.

## Claude Code

`bash k3s-lab/dsh/claude-http-mcp.sh` (default target `k3s-node`, `--target mac`
for the Mac) syncs the same token and registers at user scope:

```sh
claude mcp add --transport http gantt http://100.83.77.65:18765/mcp --scope user \
  --header "Authorization: Bearer $(cat ~/.config/gantt-mcp/token)"
```

The header lives in Claude's own config, so a plain `claude` inherits the token.
Tools appear as `mcp__gantt__<tool>`; a non-interactive run must allow them
explicitly (`--allowedTools=mcp__gantt__list_ready_tasks`). The script finishes
with `claude mcp get gantt` showing `Connected` plus one real tool run, and it
writes [SKILL.md](../deploy/worker/SKILL.md) to
`~/.claude/skills/gantt-worker/SKILL.md` with the worker name
`claude-code-http` substituted for `<gantt-agent-name>` (override with
`GANTT_AGENT_NAME`).

## The worker loop

Steps 1-2 happen once per worker, 3-8 once per task, and step 9 closes a round.

1. **Register.** `register_agent` with a stable `name` and `type: "ai-agent"`;
   the name is the upsert key and is enough as `agentName` on later writes.
2. **Load the playbook.** `get_worker_guide` once at the start of a Gantt task;
   it returns the deployed server's full markdown playbook.
3. **Pull a task.** `list_ready_tasks` with `tag=ready` (dependencies met),
   `next` (frontier pick per track), or `todo` (every pending leaf). Rows carry
   `id`, `number` (`1.8.1`), `ref`, title, status, description, `doneWhen`, and
   the track.
4. **Read before you write.** `get_task_context` for the picked task: ancestor
   chain, fields, links, earlier report, recent trajectory.
5. **Work** in your own environment; the store never runs your code.
6. **Split when the task is too big or its edges are unclear.** `decompose_task`
   with `parentId` and 1-100 children, each with a verifiable `doneWhen`;
   `planDate` seeds child dates and `summary` explains the split.
7. **Add a peer when you need one.** `create_task` with exactly one of
   `parentId` (new child) or `afterTaskId` (next sibling).
8. **Write progress back.** `update_task` with any of `status`, `progress`,
   `description`, `doneWhen`, or dates, plus a `summary` naming what changed.
9. **Close the round.** `report_completion` when a task finished, `track_task`
   when the round wrote no task tree; see below.

### Context rules

- **Read before write.** Every task-tree write follows a `get_task_context` for
  the same task: a decomposition built from a title alone duplicates work that
  already exists one level up.
- **A doneWhen is verifiable.** "Dockerfile added and `pnpm run verify` passes"
  is verifiable; "improve deployment" is not.
- **Limits.** At most 100 children per call and 4 levels below a root; a deeper
  parent fails with `decompose would exceed 4 levels`.
- **taskId forms.** An internal UUID, a point number (`1.8.1`), or an external
  ref (`node:1.8.1`) all resolve on every task tool; use the form the server
  returned.
- **Identity and session.** One stable name per worker lane, passed as
  `agentName` on every write (`register_agent` first; an unknown name is an
  error). Pass your own session or thread id as `session` when you have one:
  the trajectory is keyed by it, else by `agent:<name>`, so a human can trace a
  change back to its conversation.
- **Commits carry the point number.** When you commit code for a task, end the
  subject with its point number — `feat(today): keep the plan row bold (1.8.1)`,
  template `<type>(<scope>): <imperative subject> (<point number>)`. The
  trajectory ties the round to the tree; a bare commit subject does not, and the
  human reviewing the Gantt then has to guess which change belonged to which
  task.
- **Never invent task ids.** Act only on ids from `list_ready_tasks`,
  `get_task_context`, a decomposition you just created, or a human message. An
  unknown id returns `task ... was not found`; resolve it again instead of
  guessing a neighbour.
- **Ambiguity goes to the human.** Nobody routes you a question, so ask; if
  nobody can answer, record `status: "blocked"` with the blocker in `summary`
  rather than writing a wrong structure.

### Round-closing discipline

Every round ends with exactly one write, mirroring the plugin's own assistant
tool protocol (`gantt_create_task` / `gantt_decompose` / `gantt_update_task` /
`gantt_track`), so both surfaces leave the same kind of trail in `task_events`:
one task-tree write (`create_task`, `decompose_task`, `update_task`, or
`report_completion`), or `track_task` with a `summary` of what the round did
when it wrote no task tree. Never end a round with only a message, and never
pair a task write with `track_task`: it is the fallback, not a receipt for a
write that already recorded its own event. It is also not a completion report;
finishing a task means `report_completion` with the evidence.

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Codex `/mcp` prints `Tools: (none)` | known display bug in the bundled Codex CLI | ignore it; tools still work - prove it with a real call |
| Every call is `401`, the client lists zero tools | token missing, wrong, or not exported | re-run the client script; compare token hashes |
| `connection refused` or timeout | tailnet down, wrong address, or no sidecar | `curl http://100.83.77.65:18765/healthz`, then `tailscale status` |
| `codex exec` answers "approval required" | approval mode missing for `[mcp_servers.gantt]` | re-run the Codex client script |
| the desktop app lists `gantt` but runs no tools | a GUI launch does not inherit `GANTT_MCP_TOKEN` | launch from a terminal through `co` |
| tool failure text instead of a JSON-RPC error | tool failures are content with `isError: true` | read the returned text and fix the arguments |

Registration is not a health check: a worker that registers can still fail
every task write after a token rotation. Re-run the smoke test after a change.

## Smoke tests

```sh
TOKEN=$(tr -d '\n' < ~/.config/gantt-mcp/token)
curl -fsS http://100.83.77.65:18765/healthz
curl -fsS -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  http://100.83.77.65:18765/mcp   # every tool name, get_worker_guide included
curl -fsS -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_ready_tasks","arguments":{"tag":"ready","limit":2}}}' \
  http://100.83.77.65:18765/mcp   # expect {"ok":true,"tag":"ready","tasks":[...]}
```

Codex on the Mac, from a terminal:

```sh
co mcp get gantt   # enabled, streamable_http, the tailnet URL, GANTT_MCP_TOKEN
co exec --skip-git-repo-check --sandbox read-only -C /tmp \
  "Use the gantt MCP tool list_ready_tasks with tag=ready and limit=2, then print the task numbers and titles. No markdown."
```

Claude Code:

```sh
claude mcp get gantt   # Type: http, URL, Connected
printf '%s' "Use the gantt MCP tool list_ready_tasks with tag=ready and limit=2, then print the task numbers and titles. No markdown." \
  | claude -p --output-format json --allowedTools=mcp__gantt__list_ready_tasks
```

A pass means a real `ok: true` result came back through the MCP server, not
merely that the server is listed in a config.
