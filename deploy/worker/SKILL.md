---
name: gantt-worker
description: Pick up work from the shared Gantt task tree over MCP - use when asked to take a gantt task (甘特任务 / task from the shared task tree), update its progress, decompose it, or report its completion.
---

# Gantt worker

The `gantt` MCP server (HTTP, tailnet) is the shared context store: one SQLite
tree of tasks with time (dates, progress) and relation (ancestor chain,
siblings), plus a trajectory of worker rounds. Pull only - nothing is dispatched
to you.

**Identity.** Your stable agent name is `<gantt-agent-name>`. Call
`register_agent` once per session with that `name` and `type: "ai-agent"`, then
pass it as `agentName` on every write. Pass your session id as `session` when
the client exposes one. Re-registering the same name reuses the same agent id.

**Start.** For a Gantt task, call `get_worker_guide` once and follow it. Then
pull: `list_ready_tasks` (`tag`: `ready` | `next` | `todo`, default `ready`),
and `get_task_context` for the task you pick. Read its ancestor chain, fields,
links, and trajectory before writing anything.

**Loop.**

1. Work in your own environment; the store never runs code.
2. Too big or edges unclear: `decompose_task` with `parentId` and 1-100
   children, max 4 levels, every `doneWhen` verifiable.
3. Need a peer: `create_task` with exactly one of `parentId` (child) or
   `afterTaskId` (next sibling).
4. Progress: `update_task` with `status`, `progress`, or another mutable field,
   and `summary` for what changed.
5. Finish: `report_completion` with what was produced and where it was verified.

**Close every round with exactly one call.** A task-tree write (`create_task`,
`decompose_task`, `update_task`, `report_completion`), or `track_task` when the
round wrote no task tree. Never end with only text, never pair a write with
`track_task`, and never use `track_task` as a completion report.

**Rules.**

- `taskId` accepts an internal UUID, a point number (`1.8.1`), or an external
  ref (`node:1.8.1`) on every task tool.
- Never fabricate ids: act only on ids the server returned or a human gave you;
  an unknown id answers `task ... was not found`, so re-resolve it.
- Ambiguous chain: ask the human; if nobody can answer, `update_task` with
  `status: "blocked"` and the blocker in `summary`.
- Tool failures arrive as content with `isError: true` - read the returned text.
- Keep each call short; the database is shared with the Web UI and other
  workers.
