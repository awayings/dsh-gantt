# Work-mode context

A work-mode conversation is a task's content-dedicated main conversation. Three
things put the task in front of the model, and one client-side editor lets the
user add instructions without editing the plugin:

| Surface | Runtime name / entry | Rendered by | Read from |
| --- | --- | --- | --- |
| Static protocol section | `gantt:protocol`, order `700` | `PROTOCOL_SECTION` (`src/host/prompt.js`) | constant text |
| Dynamic focus context | `gantt:focus`, order `530` | `renderFocusContext` (`src/host/prompt.js`) | `focus`, `tasks`, `task_events` |
| `gantt_context` tool result | assistant tool | `contextMarkdown` (`src/host/tools.js`) | same tables, plus the tree stats |
| Workbench prompt editor | client panel | `GanttWorkbench` (`src/client/pages/workbench.js`) | user input |

The host contributes the first two through the optional `systemPrompt` service:
`installPrompt` registers the static section and a dynamic context whose text is
a function of the calling conversation's id. The tool result is assembled only
when the model calls `gantt_context`. The editor is a client surface: its text
is sent as an ordinary user message to the dedicated conversation, so it is not
part of the system prompt and cannot change the renderers below.

## Static protocol section

`PROTOCOL_SECTION` is a constant. It explains the work-mode contract: the
conversation is its task's content-dedicated main conversation, writes go
through the assistant tools, provenance is recorded automatically, and every
round must close with exactly one of `gantt_track`, `gantt_update_task`,
`gantt_decompose`, or `gantt_create_task`. It also spells out how to close each
kind of round (complete, partial, decomposition-only, blocked). It carries no
task data, so it never invalidates the prompt cache.

## Dynamic focus context

`renderFocusContext(store, sessionId)` returns `''` when the conversation has no
focus — DSH then materializes no snapshot. With a focus it emits:

```
# 甘特图聚焦上下文
## 聚焦任务链路（从支线根到聚焦任务）
- {ref} {title}（{kind} · {status} · 当前聚焦）
    完成标准：{doneWhen}
## 当前聚焦任务（拆解对象）
- 点号 id：{ref}
- 内部 id：{id}
- 标题：{title}
- 描述：{description}            ← omitted entirely when empty
- 层级：第 {depth} 层（上限 4 层）
- 状态：{status}
- 完成标准：{doneWhen | （未填写）}
- 可以继续拆解。 | 已达层级上限，不能再拆解。
- 直接子任务：... | 无
## 任务轨迹（会话与轮次）
- {action} · 会话 {label} · 第 {turn} 轮 · {at}：{detail}
```

The chain section repeats each ancestor's `doneWhen` under its row and marks the
focused row with `当前聚焦`; it is built by walking `parentId` up to the root
(`renderFocusChain` in `src/host/tree/chain.js`) and stops on a parent cycle.

### Focus detail fields

| Line | Source | Rendering rule |
| --- | --- | --- |
| 点号 id | `focus.ref || focus.number` | `ref` wins; the dotted number is the fallback |
| 内部 id | `focus.id` | raw UUID |
| 标题 | `focus.title` | as stored |
| 描述 | `focus.description` | omitted when empty; a multi-line value continues under the item with two leading spaces per line |
| 层级 | `depthOf(tasks, focus.id)` | root counts as depth 1; compared with `DECOMPOSE_MAX_DEPTH` (4) |
| 状态 | `focus.status` | `STATUS_LABELS`; unknown vocabulary falls back to the raw value |
| 完成标准 | `focus.doneWhen` | `（未填写）` when empty |
| 拆解提示 | derived from the depth | `可以继续拆解` or `已达层级上限` |
| 直接子任务 | `focus.children` | one indented row per child with its `ref`/number, title, and optional `doneWhen` |

### Trajectory section

`store.trajectory({ taskId, limit: 5 })` reads the newest `task_events` rows for
the focused task; `renderTrajectory` maps the action vocabulary to labels,
resolves the session label, and appends the event detail. An empty list renders
`（暂无会话记录）`. The `gantt_context` tool uses the same renderer with
`limit: 8` and also resolves session titles. Events are the only place a
timestamp appears; nothing renders the current time.

### Data sources

| Data | Read through | Notes |
| --- | --- | --- |
| Focused task id | `store.focusOf(sessionId)` | per-conversation `focus` row; `null` when unset |
| Task tree | `store.tree()` / `store.snapshot().tasks` | `TreeTaskNode[]` built at read time; dotted numbers, rollups, and stats are never stored |
| Trajectory | `store.trajectory({ taskId, limit })` | append-only `task_events`, newest first |
| Work conversation | `work_sessions` mapping | not rendered here; it is what makes the conversation the task's dedicated one |

Rendering helpers live in `src/host/tree/chain.js`: `findFocus`, `depthOf`,
`renderFocusChain`, `renderFocusDetail`, `renderTrajectory`, plus the
`STATUS_LABELS`, `KIND_LABELS`, and `ACTION_LABELS` dictionaries. The assembly
functions are `renderFocusContext` (`src/host/prompt.js`) and
`contextMarkdown` (`src/host/tools.js`). Both render the same chain and detail,
so a field added to `renderFocusDetail` appears in the runtime context and in
the tool result at once.

Because DSH appends a runtime-context snapshot only when the rendered text
changes, the rendered text must stay deterministic: derive it from the tree, the
focus row, and recorded events only. Current time, random ordering, or
request-scoped data would churn the prompt and break the cache prefix.

## `gantt_context` result

`contextMarkdown` adds a one-line stats header (`# 甘特图任务上下文（今天 …）`,
task counts) before the chain, detail, and trajectory. Without a focus it falls
back to `## 当前会话没有聚焦任务` plus the whole-tree context document capped at
6000 characters, so a conversation without a task still gets useful context.
The tool is the fallback for models that need the current state mid-round; the
runtime context is the always-present snapshot.

## Workbench prompt editor

The task view in the workbench (both the in-page panel and the right-rail tab)
has an optional instructions editor (`textarea[data-field="prompt"]`) above its
action buttons. The buttons build one user message each:

| Button | Message | Conversation |
| --- | --- | --- |
| Execute | `workbench.prompt.execute` + blank line + editor text | bound, or created with `openWorkTask(open: false)` |
| Decompose | `workbench.prompt.decompose` + blank line + editor text | same |
| Send | editor text alone; disabled while blank | same |

A blank or whitespace-only editor keeps the fixed base prompt byte-identical to
the pre-editor behavior. The fixed prompts are localization keys in
`src/client/i18n/en.js` and `src/client/i18n/zh.js`, so they follow the UI
locale; the editor text is appended verbatim (trimmed). Every entry reuses the
same path: resolve or create the dedicated conversation, queue the message
through `sendWorkPrompt`, hand the conversation to a new window through
`session-window.js` (falling back to the current window), and refresh the
trajectory once the message is accepted. A successful send clears the editor; a
failure keeps the text so the user can retry.

Resolving the conversation is never a plain read of the panel state: all three
entries call `openWorkTask(open: false)` even when the panel already shows a
bound conversation. That helper re-reads the task ⇄ conversation mapping and,
for an existing conversation, posts `api/gantt/focus/set` before returning, so
the conversation's focus points at the task the user clicked before the prompt
is queued. The first runtime-context snapshot of the new turn is therefore built
from that task. Skipping the refresh and sending to the already-bound
conversation directly leaves its focus on the task it saw last, and the model
keeps working on the wrong task.

The editor is deliberately client-side: the model receives the composed text as
a normal user message, and the host never stores it. That keeps the system
prompt and the tool contract unchanged.

## Adding a context field

Follow these rules so a new field reaches every surface consistently:

1. **Store it first, or derive it.** Persisted fields need a `tasks` column (and
   a schema migration in `src/host/store/db.js`), inclusion in `TASK_COLUMNS`
   (`src/host/store/tasks.js`), and a `TreeTask` property in
   `src/host/tree/build.js`. Values that can be computed — numbers, rollups,
   labels — stay derived at read time; never persist them.
2. **Choose one surface.** Ancestor rows belong in `renderFocusChain`; fields of
   the focused task belong in `renderFocusDetail`. Do not repeat the same field
   in both: the runtime context is re-sent on every snapshot change and should
   stay compact.
3. **Rendering rules.** Empty optional values must omit their whole line (no
   dangling `- 描述：` and no blank line); multi-line text continues under its
   list item, indented two spaces per extra line; render through an existing
   label dictionary where there is one.
4. **Keep it deterministic.** No current time, no iteration over unordered
   maps, no request-scoped values in the rendered text (see the snapshot note
   above).
5. **Test both branches.** `tests/host/chain.spec.js` covers the renderer,
   including the empty-value case; `tests/host/prompt.spec.js` covers the
   assembled runtime context through a real store. If the field also changes the
   tool result, assert it there once and rely on the shared renderer elsewhere.
6. **Document it.** Update this file's field table and, when the public contract
   changes, the `gantt_context` paragraph in [api.md](api.md#gantt_context) and
   the summary in
   [personal-task-system.md](personal-task-system.md#task-trajectory-and-protocol-context).
   English only, links kept valid.

## Verification

```sh
pnpm run static                          # lint + typecheck
pnpm exec vitest run tests/host/chain.spec.js tests/host/prompt.spec.js
pnpm exec vitest run tests/client/workbench-prompt.spec.js
pnpm run test                            # host + client suites
pnpm run e2e                             # rebuilds lib/client.js, then real HTTP/SQLite
```

Coverage floors are per file: 100% for `src/host/**` and `src/shared/**`,
99/98/99/99 for `src/client/**` (`vitest.config.ts`).
