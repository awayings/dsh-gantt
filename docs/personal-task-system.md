# Personal task system

How `dsh-gantt` models 张靖's personal task-management system: one task tree in
the plugin's SQLite database, imported from a Hermes-maintained markdown
workspace and extended in place. The conventions come from a set of Hermes
productivity skills; only the parts that are machine-checkable are adopted, the
rest stay with the agent that runs them.

This page is rationale, not reference: routes and payloads are in
[api.md](api.md); schema, migration, and test layout in
[development.md](development.md); known limitations in
[compatibility.md](compatibility.md).

## Why one tree

Before schema version 3 the plugin kept two unrelated datasets:

- `tasks`, the v1 table the Gantt page rendered;
- `tracks` and `nodes`, snapshot tables filled by the tracker import and read by
  the Today page.

The import therefore produced a tree the Gantt page could not show, and a
decomposed subtask could not belong to an imported node. Schema v3 removes the
split: the six tracks are the roots of the working tree, the imported Hermes
nodes are their children, and every task the user creates or decomposes lands in
the same tree. `tracks` and `nodes` remain as import snapshots and as the
idempotency key of the import, but no page reads a separate tree from them.

The consequences are deliberate:

- one read model — `GET /api/gantt/tree` and the day bundle read the same rows;
- one write path — manual creation, decomposition, and scheduling all write
  `tasks` (and, for scheduling, `plan_blocks`);
- import stays a one-way, idempotent pull keyed by `(kind, ref)`.

## Domain model

### One tree, three row kinds

Every row in `tasks` is a node of the tree. `kind` says where it came from:

| `kind` | Meaning | `ref` | `source` |
| --- | --- | --- | --- |
| `track` | Root layer: one row per tracker track (six on this workspace) | `track:1` … `track:6` | `tracker` |
| `node` | An imported Hermes node | `node:1.8.1` | `tracker` |
| `task` | A manually created or decomposed task | `''` | `manual` |

- Track rows have `parent_id = null`; imported node rows attach to their dot-id
  parent (`node:1.8.1` → `node:1.8`, `node:1.1` → `track:1`); decomposed tasks
  and manual tasks attach to whatever parent the user chose.
- A decomposed task is a normal `task` row. It can itself be decomposed until
  the depth cap is reached.
- `number` (`1`, `1.1`, `1.8.1.2`) is still derived from sibling order at read
  time, never stored. Imported siblings are ordered by their dot ids, so the
  displayed number mirrors the tracker path for the imported part of the tree.

### Stable ids and provenance

- `ref` is the external key. Dot ids are Hermes identifiers and are never
  renumbered: a node that is 撤销 keeps its id and only changes state. The plugin
  never rewrites `ref` — the update route ignores the key.
- `source` records provenance (`tracker` or `manual`); it is not derived from
  the presence of a `ref`, because the API technically allows a manual row with
  a `ref`, but the UI does not create one.
- A unique index on `(kind, ref)` (where `ref <> ''`) makes the import an upsert:
  a re-import updates the row that carries the same external key instead of
  duplicating it. Two rows may not claim the same `(kind, ref)`; the write
  routes answer `409`.
- Import is one-way. The plugin never writes to the tracker directory, there is
  no file watch, and a re-import is an explicit action.

### The snapshot tables are import provenance

| Table | Role after v3 |
| --- | --- |
| `tasks` | The one working tree: tracks, imported nodes, decomposed and manual tasks |
| `tracks`, `nodes` | Import snapshots. They preserve what the markdown said, make re-import idempotent, and are not rendered as a tree |
| `plan_blocks` | The time grid: imported blocks plus blocks created by scheduling |
| `day_plans` | One row per planned day: weekday, day kind, market flag, label, core goal |

The importer writes the snapshots first, then materializes them into `tasks` in
the same `BEGIN IMMEDIATE` transaction. A v2 database is backfilled once during
the schema migration (see [compatibility.md](compatibility.md)); after that, each
import keeps both layers in step.

### Hierarchy rules from the tracker

The rules below are drawn from the tracker's `TREE.md` §二 (the numbering
rules, lines 37-50) and are what the plugin keeps:

1. **Ids are stable.** A node is created with an id, and the id never changes;
   a revoked (撤销) node keeps its number and only changes state. No renumbering
   pass exists in the plugin.
2. **A decomposed node is no longer an execution unit.** Its completion equals
   all children complete — the rollup rule the v1 tree already had for `status`,
   `progress`, and dates, now applied to imported nodes too. A tracker parent's
   own state still decides whether a not-yet-complete parent reads `进行` or
   `卡住`; see [Rollups on imported parents](#rollups-on-imported-parents).
3. **Siblings are parallel by default.** Order is expressed through a single
   `dep` node id, not through sibling order. `dep` gates "what can be started"
   (the next list); it does not block a status edit.
4. **Depth is capped.** The tracker's prose says depth is not meant to exceed
   3 levels below a track ("深度不设上限，但不超过 3 层…再深说明 1.8.3 本身没想
   清，回头拆它"); the plugin's root layer is the track, so its cap is
   **4 levels including the track root** (`track → node → node → task`).
   Decomposing a parent at the cap is a `400` rather than a silent deeper tree.
5. **A running item is open-ended.** The tracker writes `止 = 持续`; the parser
   stores no end date and the materialized row ends *today*, so the Gantt bar
   runs to the import day. A later import refreshes that date.

### Fields the tree carries

The v1 task fields (`id`, `parentId`, `title`, `description`, `status`,
`progress`, `startDate`, `endDate`, `sortOrder`, timestamps) are unchanged. The
v3 tree adds the tracker's addressing and execution metadata to the same row:

| Field | Example | Meaning | Filled by import |
| --- | --- | --- | --- |
| `kind` | `node` | `track` \| `node` \| `task` | yes |
| `ref` | `node:1.8.1` | Stable external key, empty for manual tasks | yes |
| `state` | `未开始` | Raw tracker state after vocabulary normalisation | yes |
| `lane` | `赚钱` | Track lane (`赚钱` \| `生活`), inherited by nodes | yes |
| `dep` | `1.8.1` | One prerequisite node id, or empty | yes |
| `doneWhen` | `新标的有可执行档位表` | Evidence pointer: what "done" means | yes |
| `source` | `tracker` | `tracker` \| `manual` | yes |
| `description` | `…` | Node: the `done_when` cell; track: the blocker | yes |
| `links` | `[{ "type": "memory", … }]` | Plugin-side links, see [Links](#links) | no |
| `landing` | `invest/strategy-ledger.md` | Repo-relative landing point | no |
| `estimate` | `2h` | Estimated effort | no |
| `category` | `A 主攻片` | Slot class | no |
| `inspiration` | `#21` | Idea-store id | no |

`landing`, `estimate`, `category`, and `inspiration` are plugin-side extensions:
the tracker's node table has no such columns (they appear on time-grid blocks,
not tree nodes), so imported nodes start empty and the fields are filled by the
user or by a decomposition. `links` is likewise never imported.

The full JSON shape and the writable subset are in
[api.md](api.md#task-object).

### State vocabulary and the status mapping

The tracker is hand-written and its state words drift, so the parser normalises
aliases before storing (`render_tree.py:44-52` defines the same aliases). The
stored `state` keeps the normalised tracker word — `撤销` stays `撤销` — while
`status` is the plugin's four-value vocabulary:

| Tracker state | Stored `state` | `status` | `progress` |
| --- | --- | --- | --- |
| 已过 / 已完成 / 完成 | 已过 | `done` | 100 |
| 进行 / 进行中 / 在做 | 进行 | `in_progress` | 50 |
| 卡住 | 卡住 | `blocked` | 0 |
| 未开始 / 已立项 / 待定 / 没开始 / 未知 | 未开始 | `todo` | 0 |
| 撤销 | 撤销 | `done` | 100 |

`撤销` is treated as closed, not as a separate status, because every read-side
rule in the tracker counts it as done. A state word outside this table is kept
verbatim in `state` (the vocabulary is allowed to evolve) and maps to `todo`
unless it is one of the aliases above.

### Rollups on imported parents

The tracker's page rolls a parent state up from its children but lets the
parent's own state win when it is stronger (`render_tree.py` lines 199-211).
The plugin mirrors that for rows that carry a tracker `state` — imported tracks
and nodes:

1. every child `done` → `done`;
2. otherwise the parent's own state decides: parent 进行 → `in_progress`;
3. a 卡住 child → `blocked`;
4. any 进行/已过 child → `in_progress`;
5. otherwise `todo`.

The consequence is visible on a track row: 投资系统 reads `in_progress` even
while all of its children are 未开始, because the track itself carries
`进行`. A manual parent (`state` empty) keeps the child-derived rule the v1 tree
always had: every child done → `done`, any blocked → `blocked`, any in progress
or progress > 0 → `in_progress`, otherwise `todo`. Parent dates and progress
are still the child min/max and mean.

Re-import is careful with user edits: content fields (title, description, state,
lane, dep, doneWhen, parent, sort order, dates) always follow the markdown, but
`status` and `progress` are overwritten only when the normalized tracker state
actually changed since the last import. If the state is unchanged, a status the user set
in the UI survives. `links` is plugin state and is never written by the
importer.

## Decomposition discipline

Decomposition in this system is not an algorithm. There is no auto-scheduler and
no ranking model (both are frozen, see [Not adopted](#not-adopted--deferred));
the human-facing agent and the user do the thinking, and the plugin provides the
mechanics. The discipline the plugin reflects:

### Two questions before a node

The tracker's `TREE.md:235` says a new node must answer two questions first:
**who is the parent** and **what does `done_when` point at**. The decompose
dialog therefore requires a title and a `done_when` for every child. The API
accepts an empty `done_when` so imported and programmatic callers are not
blocked, but the UI does not.

### A/B classes and the cost of decomposing

`RULES.md:29-39` splits work into two classes:

- **A class** — the agent can decompose it: it goes straight to daily-executable
  granularity and into a time slot.
- **B class** — the agent cannot decompose it: the user gets a
  "definition / decomposition" slot first, thinks it through, and the agent
  decomposes afterwards.

The key sentence is that **decomposition itself occupies a time slot, it is not
a free action**. B-class work is not a to-do gap; it is a scheduled block. The
plugin supports this by letting a decomposition optionally create a plan block
per child in the same transaction, so a "definition" child can be placed on the
day where the user will actually think. `planDate` only supplies fallback dates
for the children; a block appears only for a child that carries its own `plan`
entry, and the block inherits the child's landing point, estimate, category, and
inspiration when the plan entry omits them.

### Granularity and capacity

From the `task-tracker` skill (`SKILL.md:403-409`):

- split work into steps of **at most 30 minutes**;
- one evening holds **at most 1 P0 plus 1-2 P1/P2** items — scheduling three
  epics into one evening is the known pattern that triggers overthinking and
  delays action.

### Slot classes and the evening grid

From `RULES.md:145-175`:

| Slot class | Duration | Where it fits |
| --- | --- | --- |
| 主攻片 (main push) | ≥4h, ~70% of the personal track | Weekends only; a weekday cannot hold it |
| 轮转片 (rotation) | ~2h, ~20% | Weekend afternoon, or two 1h pieces |
| 定义片 (definition) | ~1h, ~10% | Fragmented time such as weekday gaps |

The fixed 21:00-22:00 evening diversity grid (`SCHEDULE.md:35-49`) is ≤1h per
day, must carry an inspiration id (`#13`, `#22`, `#10.2`), and must not be taken
over by the main line without a written reason; the plugin surfaces the missing
inspiration id as an integrity warning rather than enforcing the rotation.

What the plugin enforces and what it leaves to discipline:

| Enforced by the API / dialog | Left to the discipline |
| --- | --- |
| Title and `doneWhen` required in the dialog | A/B classification |
| At most 100 children per decomposition; one transaction | Step size ≤30 minutes |
| Depth cap of 4 levels | Slot class ↔ day kind matching |
| Real calendar dates, status vocabulary, progress bounds | At most 1 P0 + 1-2 P1/P2 per evening |
| Plan block needs a real `date` | The 21:00-22:00 rotation and its reason |

## Frontier and next

The tracker page answers two different questions per track (`render_tree.py`
lines 213-233; `TREE.md` §二 "两个不同的下一个"). The `brief` object on
`GET /api/gantt/tree` mirrors both at read time, never storing them:

| Concept | Definition | Question it answers |
| --- | --- | --- |
| **Frontier** (前沿) | Per track, the pending leaf that sorts last by `ref` (dot-id order, manual tasks last) | How far has this track reached? |
| **Next** (该动) | Per track, the pending leaf that sorts first whose `dep` is satisfied | What can be started today? |

Definitions used by the plugin:

- A **pending leaf** has no children and `status` `todo` or `blocked`. A leaf
  that is `in_progress` is already moving and is not pending.
- `dep` is satisfied when it is empty or the referenced node is done. `dep` is a
  single node id; there is no graph.
- Ids compare by numeric dot segment (`1.10` sorts after `1.9`), not by plain
  string order. Manual tasks have no `ref` and sort last.
- A track with no pending leaf contributes no entry to `frontier`/`next` and
  reports `null` in its `brief.lanes` row.

The distinction matters because long-running parallel lines (the tracker names
wiki, predict, and session accumulation) must not grab the frontier: a
long-running line is `in_progress`, so it is not pending, and the frontier stays
on the untouched leaves. The two are often different leaves: the frontier shows
how far the track has reached, the next shows where work can start.

`brief.lanes` repeats the per-track view — track id, `ref`, name, lane, raw
state, blocker text, and the frontier/next entry for that track — so a client
can render the report without joining the tree.

## Links

`links` is the plugin's own extension, not something the tracker has. The
tracker's cross-references are prose conventions: issues as `#505` or markdown
issue URLs, commits as 7-hex ids in ledgers, landing points as repo-relative
paths, inspiration ids as `#12` / `#10.2`. There is no memory-link field in the
tracker and nothing in the import fills `links`.

A link is `{ type, ref, label? }` with `type` one of:

| Type | Points at |
| --- | --- |
| `memory` | A memory key or entry the node depends on |
| `file` | A repo-relative file or directory |
| `url` | An external issue, document, or page |
| `task` | Another task in this tree |
| `note` | Free-form note reference |

`ref` is 1-500 characters, an optional `label` is at most 120 characters, and a
node carries at most 20 links. Validation is strict: a non-array, an unknown
type, or an over-long field is a `400`, not a silent drop. The update route
replaces the array as a whole. The intent is to make a tree node addressable by
the rest of the harness (memory, files, issues) without copying their content
into the tree.

## Context export

`GET /api/gantt/context` renders the unified tree and the day plan as stable
markdown. This is the plugin's model-context surface: the text is designed to be
handed to a model as-is, so the format is deterministic and the data is read
only.

- Header: the tree size (`track · node · task` counts); a zero count omits its
  segment entirely.
- One section per track with lane, state, and blocker; nodes are indented by
  depth and carry state, dates, landing point, `done_when`, dependency, and
  links inline.
- A today section: the day's metadata, core goal, and its time blocks with slot,
  landing point, estimate, and inspiration.
- An integrity section listing the same warnings the Today page derives.

Options: `date` defaults to today; `root` limits the export to one subtree;
`limit` caps the markdown length (default 12000 characters, 1000-60000). Over
the limit the renderer drops the deepest nodes first, then the oldest day
detail, and sets `truncated: true`; only a document whose headers alone exceed
the limit is hard-cut.

The export is the future seam for memory auto-injection — a caller could take
`markdown` and put it in a model prompt — but nothing in this round wires it
into the harness automatically. The page offers it as a read-only dialog with a
copy button.

## Day plans and the Today page

The Today page reads one day bundle: day metadata, time blocks, the tree nodes
in play, derived integrity warnings, and block stats.

- `plan_blocks.source` is `schedule` for imported blocks and `task` for blocks
  created by `task/decompose` or `task/schedule`. Re-import only rewrites
  `schedule` rows; `status` and `notes` are user state and survive on every row.
- A scheduled task produces a block whose id is deterministic —
  `task|<taskId>|<date>` — so scheduling the same task on the same day updates
  the existing block instead of appending a duplicate.
- The day bundle's `tracks` and `nodes` are now read from the unified tree
  (`kind='track'` / `kind='node'`), not from the snapshot tables. Identity
  fields share one id space: `tracks[].id` is the track task id,
  `tracks[].ref` is `track:<n>`, `nodes[].id` is the node task id, and
  `nodes[].trackId` is the parent track's task id. The snapshot fields the page
  rendered before remain on nodes, plus `ref`, `state`, `kind`, `landing`,
  `estimate`, `category`, `inspiration`, and `links`.
- Integrity warnings are advisory, computed at read time, and never stored:

| Code | Rule it encodes | Source |
| --- | --- | --- |
| `landing-missing` | Every block must carry a landing point; no landing point = not scheduled | `SCHEDULE.md` 二、硬约束 4, `RULES.md` 第十一节 item 3 |
| `evening-missing` | The day has no block in the 21:00-22:00 evening slot | `RULES.md` 4.2, `SCHEDULE.md` 二、硬约束 1 |
| `inspiration-missing` | An evening block carries no inspiration id | `SCHEDULE.md` 二、硬约束 1, `RULES.md` 第十一节 |
| `unplanned-day` | The date has no plan row; a never-planned day is reported as empty, never filled in on the fly | `SCHEDULE.md` 一、维护方式, `daily` iron rule 4 |

## Source formats and paths

| Source | Section | Destination |
| --- | --- | --- |
| `SCHEDULE.md` | `## 四、未来 7 天` day headings and tables | `day_plans` and `plan_blocks` |
| `SCHEDULE.md` | `窗口 = MM/DD-MM/DD` preamble | Year anchor for the day headings |
| `TREE.md` | `## 三、六条支线` | `tracks` snapshot, then `tasks(kind='track')` |
| `TREE.md` | `## 四、节点表` | `nodes` snapshot, then `tasks(kind='node')` |
| `daily/YYYY-MM-DD.md` | frontmatter date + `## 🎯 今天核心目标` | `day_plans.core_goal` |

`INDEX.md`, `RULES.md`, and the ledgers are prose and are not parsed. The
tracker directory defaults to `/data/home/clawd/projects/task-tracker`
(`/home/jason/clawd/projects/task-tracker` on the host); override it with
`DSH_GANTT_TRACKER_DIR` or the import route's `dir` field (absolute paths only).
A missing directory is a `400`, never an empty import.

## Render semantics

The Gantt page does not render the tracker's `tree.html`, but it keeps the
semantics that make the tree readable:

- depth indentation by dot-id level;
- an open-ended item: the tracker draws `持续` as a bar running to the latest
  data; the plugin stores the end as the import day, so the bar ends at today
  and advances on the next import (this data rule replaces the tracker's hatch);
- the lane and raw tracker state are chips on the track row, and node rows carry
  the metadata chips for state, `doneWhen`, landing point, estimate, category,
  inspiration, and links (the tracker colours a lane; the plugin keeps the lane
  as data and a chip);
- a depth zoom (all nodes, two levels, one level) that mirrors the tracker
  page's depth-limited views.

## Not adopted / deferred

Several things from the tracker and the skills are deliberately **not** in this
round. They are not prerequisites for the unified tree, and none is silently
half-built.

| Item | Why not now | What it would need |
| --- | --- | --- |
| **Auto-scheduler** (M1 priority ranking, M2 direction scoring, M3 slot auto-fill) | Frozen in `RULES.md:341-351` ("先用起来，不是先做工具"); scheduling stays manual and explicit | A ranking model and a slot-filling service; the current routes only place a node into a day the user names |
| **Session digests** (`session-digest-reports`) | Inputs are session JSONL and spend logs outside the tracker; output is a digest file, not a schedule | A digest table plus an ingestion route |
| **Session-history recall** (`session-history-recall`) | Needs the Hermes state database and a session-lookup API the plugin does not have | A read-only session lookup in the host half plus a link component |
| **Writing plans** (`writing-plans`) | It authors implementation plans for coding agents, not personal tasks, and it is a write surface | A plan-document store and editor, and a decision on which page owns it |
| **Memory auto-injection wiring** | `links` and the context export exist as data, but nothing feeds the tree into a model prompt automatically | A harness seam that calls `GET /api/gantt/context` and injects the result; deferred until the export format has been used by hand |

The work-vs-personal dependency rules and habit logging remain out of scope for
the same reason: they need a field or a scheduled job the plugin does not have.

## See also

- [api.md](api.md) — the tree, decompose, schedule, context, and day routes.
- [development.md](development.md) — schema, migration runbook, test layout.
- [compatibility.md](compatibility.md) — v2→v3 migration and known limitations.
