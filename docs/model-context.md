# Model context with `dsh-gantt` installed

This page describes what the model sees in one conversation round when this
plugin is active in a DSH profile. It is the bridge between two documents that
do not cover the combined picture:

- [work-context.md](work-context.md) documents only the surfaces this plugin
  contributes (protocol section, focus context, `gantt_context` tool result,
  workbench editor).
- [reference/dsh-context/](reference/dsh-context/README.md) documents the
  harness's context pipeline as background study notes, explicitly not as
  plugin documentation and not as a compatibility contract.

What follows is plugin documentation: the stable shape this plugin relies on,
with the harness internals named only where they explain placement. Verify
changes against the installed `@deepseek-ai/dsh` packages, not against this
page; [compatibility.md](compatibility.md) owns the supported set.

## The four inputs to one model request

DSH does not send a `system` request field. Each round resolves four inputs into
one ordered message sequence. `dsh-gantt` contributes to the first and third,
and adds one tool to the second:

| Input | Where it lands in the request | Contribution from `dsh-gantt` |
| --- | --- | --- |
| System prompt sections | One `system/message` surface node, assembled by ascending `order` | `gantt:protocol`, order `700` — static text, no task data |
| Tool schemas | `request/header.tools`, resolved per agent and model | Six tools: `gantt_context`, `gantt_decompose`, `gantt_update_task`, `gantt_track`, `gantt_create_task`, `gantt_capture` |
| Dynamic runtime context | A `user/message` snapshot with `source=runtime-context`, appended when its rendered text changes | `gantt:focus`, order `530` — focused ancestor chain, focus detail, recent trajectory; empty text when no focus |
| Conversation history | All surface messages replayed from the append-only event log | `task_events` rows are not messages; the model reads them through the focus context and `gantt_context` |

Two consequences matter for this plugin:

1. The protocol is a **system section**, so it is shared by every conversation
   in the scope and never differs per task. It carries the round-closing rules,
   not task facts, so it does not invalidate the prompt cache when focus moves.
2. The focus context is a **runtime context**, not a tool result. It is present
   from the first step of a round without the model asking for it. DSH
   materializes a new snapshot only when the rendered text changes, so an
   unchanged focus keeps the prompt prefix stable; old snapshots stay in
   history and are superseded by the newer text.

The `gantt_context` tool is the mid-round read. It renders the same chain and
detail with a stats header and a longer trajectory window; with no focus it
falls back to the two-level whole-tree overview, and its `id` parameter drills
one level below any parent task. See
[work-context.md](work-context.md#gantt_context-result) for the exact layout.

## Round timeline, end to end

```text
turn starts
  │
  ├─ 1. inbox.claim()                     user message + any queued injection
  │       (workbench Execute / Decompose / Send queue a user message here)
  │
  ├─ 2. tools.resolve()                   this agent x this model's tool set
  │       incl. the six gantt_* tools when the host tools service exists
  │
  ├─ 3. systemPrompt.assemble()           sections + contexts + variables
  │       gantt:protocol (700) → system sections
  │       gantt:focus (530)    → evaluated now, not materialized yet
  │
  ├─ 4. pre-step waterfall                other plugins add their messages
  │       AGENTS.md chain (first round), skill catalog, time context,
  │       memory snapshot, then the runtime-context fallback materializes
  │       gantt:focus next to the other context contributions
  │
  ├─ 5. request recorded                  header.tools, context window
  │
  └─ 6. deriveMessages() → model          node 0 = assembled system prompt,
                                         then history + snapshots + catalog
```

The runtime-context fallback sits innermost in the pre-step waterfall, so the
observed order after the user message is: context snapshot (including
`gantt:focus` and `memory:snapshot`), then the skill catalog, then the time
snapshot. `gantt:protocol` is already inside node 0 and does not appear as a
separate message.

## What surrounds the Gantt surfaces

A work-mode conversation does not see only the Gantt. The same round also
carries the harness's own and other plugins' contributions; the Gantt plugin
never suppresses them.

| Surface | Owner | Placement relative to Gantt |
| --- | --- | --- |
| Harness identity, persona, tool documentation, file-reference rules, environment | DSH core / profile | Same assembled system node; ordered by their own `order` values (tool docs `1000`–`5000`, environment `10000`–`10100`) |
| `AGENTS.md` / `CLAUDE.md` chain | `dsh-agent-instructions` | A user message injected on first access to a directory; not a system section. Its source is its own `<system-reminder>` block, separate from any Gantt text |
| `memory:snapshot` (user profile, global facts, project key facts) | `dsh-memory-evolve` | Another runtime-context contribution; per the profile it appears in the same snapshot message as `gantt:focus`, ordered by that plugin's `snapshotOrder` |
| Skill catalog | `dsh-tool-skill` | A `skill-catalog` message after the context snapshot; full skill text is loaded only when the model calls `skill` |
| Time / working-directory / sandbox / approval snapshots | DSH core | Other sections of the same runtime-context snapshot |
| Conversation history | DSH `Session` | Replayed in full each step, minus compacted spans; tool calls and their results are part of it |

A concrete first-round sequence, matching the installed harness, is therefore:

```text
seq N    system/message       identity + persona + tool docs + gantt:protocol + environment
seq N+1  user/message         the user's request (or a queued workbench prompt)
seq N+2  user/message         runtime-context snapshot, sections include
                              gantt:focus (when focused) and memory:snapshot
seq N+3  user/message         skill catalog
seq N+4  user/message         time snapshot
seq N+5  user/message         AGENTS.md chain (when files exist; first request)
seq N+6  assistant/tool-call  e.g. gantt_context or gantt_decompose
seq N+7  tool/result          its Markdown or success message
```

`gantt:focus` is omitted entirely when the conversation has no focused task:
`renderFocusContext` returns `''` and DSH materializes no snapshot for it. The
protocol section is still present, but its "every round must close with a tool"
rule is explicitly scoped to conversations that have a focus, so an ordinary
conversation is not forced to invent a task association.

## Two paths to the same task detail

The runtime context and the tool result deliberately share renderers:

```text
                  ┌─ renderFocusContext (src/host/prompt.js) ──→ gantt:focus snapshot
focus + tasks ────┤
                  └─ contextMarkdown (src/host/tools.js) ──────→ gantt_context result
                                    │
                                    └─ (no focus) two-level tree overview; `id` drills one level down
```

Both call `renderFocusChain`, `renderFocusDetail`, and `renderTrajectory` from
`src/host/tree/chain.js`. A field added to `renderFocusDetail` reaches both at
once; this is why [work-context.md](work-context.md#adding-a-context-field)
requires one renderer per field and tests the assembled surfaces. Trajectory
events are rendered from `task_events`, never from raw history messages, so the
same session/turn label appears in the panel, the snapshot, and the tool result.

The external-agent equivalent, `get_task_context` over HTTP or MCP, reuses the
same renderers but takes an explicit task id and has no no-focus fallback. See
[work-context.md](work-context.md#get_task_context-result) and
[mcp.md](mcp.md).

## Data flow of a Gantt write

```text
model calls gantt_decompose / update / create / track / capture
        │
        ├─ resolve id (internal id, ref, or dotted number)
        ├─ store mutation in one transaction, with validation
        └─ task_events row: session id + turn (from tool execution context)
                 │
                 ├─ panel / workbench reads the events back (recent five)
                 ├─ renderTrajectory includes them in the next focus snapshot
                 └─ gantt_context renders them too (recent eight, titled)
```

Writes never fabricate provenance: if the call has no agent session, no event
is recorded. The session id and turn are read from the tool execution context,
not from model arguments, and the model is told not to put them into titles or
descriptions. The store is the guard — no shell or filesystem approval is
involved and the plugin never calls an LLM itself.

## Why the text must stay deterministic

`gantt:focus` and `memory:snapshot` are prompt contexts: DSH appends a new
snapshot only when the rendered text differs. A renderer that includes the
current time, a random order, or request-scoped data would append a new message
every step and break the cache prefix. The Gantt renderers therefore derive
text only from the task tree, the focus row, and recorded events. Session
titles in `gantt_context` are resolved from the durable log, and the HTTP
context export is read-only.

## Inspecting a real round

When a conversation behaves unexpectedly, verify context before changing code:

1. Call `gantt_context` in that conversation. The header shows the tree stats;
   the presence of the ancestor chain shows whether focus resolved.
2. Check the right-rail **甘特** tab: the focus chip and highlighted row come
   from `POST /api/gantt/focus/set`. A missing focus explains a whole-tree
   fallback and no `gantt:focus` snapshot.
3. Check the **Workbench** tab: the bound conversation, available skills, and
   agent team are read through `/api/gantt/work*`; the recent trajectory rows
   come from `/api/gantt/trajectory`.
4. For a definitive view, decompress the session's JSONL from `$DSH_HOME` and
   inspect the surface sequence: one `system/message` containing
   `## 甘特图任务协议`, then a `user/message` whose sections include
   `gantt:focus`, then the catalog and time messages. Tool calls and results
   follow as their own surface nodes.

Do not infer tool delivery from the UI alone: a missing `gantt_*` tool in the
live session is a tools-service registration issue, not a prompt issue.
[compatibility.md](compatibility.md#2--harness-seams) lists the seams this
plugin relies on and how each was verified.
