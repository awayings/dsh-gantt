# Personal task system

How the plugin represents 张靖's personal task-management system: the markdown
records it imports, the tables it stores them in, and the rules it can check. The
conventions come from a set of Hermes productivity skills; only the parts that are
machine-checkable are adopted, the rest stay with the agent that runs them.

This page is rationale, not reference: routes and payloads are in
[api.md](api.md); setup, database and test layout in
[development.md](development.md).

## Scope

The extraction is additive. The existing Gantt page and its `tasks` table are
untouched; the import writes four new tables (`tracks`, `nodes`, `plan_blocks`,
`day_plans`) and the Today page reads them.

It is also read-only in both directions that matter:

- the plugin never writes to the tracker directory — no status, note or schedule
  edit is mirrored back to the markdown;
- there is no file watch. Import is triggered explicitly (the Today page's Import
  button or the import route), and re-importing is idempotent.

## Skills mined

| Skill | What it contributes |
| --- | --- |
| `task-tracker` | The file map and formats: `SCHEDULE.md` future-7-day time grid (time / class / content / landing / estimate), `TREE.md` trunk → lane → node with stable ids and a dependency column, the daily card's core goal, and the two-track time rules (work 10:00-19:30, personal 08:00-09:30 / 21:00-22:00 / weekend). |
| `daily` | The fixed output shape: core-goal status first, then one line per time block naming the first action and the landing point; progress stated in full words; a block that was never planned is reported as empty rather than invented. |
| `personal-tracking-mechanisms` | Remind, do not make him fill in a form: one-line records, no daily table, life items belong to the fixed programme rather than the schedulable grid. |
| `planning-record-integrity` | One structure-plus-progress source with stable node ids and back-fillable references, one frontier per lane, and a slot that must point back to a node id / landing point; a status update has to land in every store that carries the item. |
| `session-digest-reports` | Daily/weekly digests of LLM sessions (intent plus outcome, per client). |
| `session-history-recall` | Recalling an earlier session's conclusion from the Hermes state database. |
| `writing-plans` | Implementation-plan documents: bite-sized tasks, exact file paths, complete code, saved under `docs/plans/`. |

## What landed where

`import` = parsed into SQLite by the importer; `today page` = rendered on the
Today page; `integrity` = checked and surfaced as a warning; `deferred` = not in
this change.

| Skill | Rule / data model taken | Status |
| --- | --- | --- |
| `task-tracker` | Schedule grid, tree and daily-card parsers; block slots derived from clock time | `import` |
| `task-tracker` | Blocks grouped by slot, status cycles, stats bar, week's nodes | `today page` |
| `task-tracker` | Evening slot, inspiration id, landing point per block | `integrity` |
| `daily` | Core goal callout; blocks as time + title + landing + estimate; empty day state | `today page` |
| `personal-tracking-mechanisms` | No form: a single status click (`todo → in_progress → done → skipped`) plus optional notes, capped at 500 characters | `today page` |
| `planning-record-integrity` | Node ids, `dep`, `done_when`, node window of the day bundle; a block's landing point is checked, not assumed | `import`, `integrity` |
| `session-digest-reports` | — | `deferred` |
| `session-history-recall` | — | `deferred` |
| `writing-plans` | — | `deferred` |

Three things the skills describe are deliberately not claimed here: the
work-vs-personal dependency rules (needs a task-kind field the grid does not
carry, so only `slot` is derived), the per-lane frontier report (no report
surface), and habit logging/reminders (a scheduled-job concern, not a page).

## Domain model

### Tracks (支线)

`tracks` mirrors the six rows of `TREE.md` §三: `id` (`1`–`6`), `name`, `lane`
(赚钱 | 生活), `priority`, `state`, `blocker`, `sort_order`. Lanes are the mix
rule's unit — the schedule is supposed to rotate across them — so the page shows
all of them rather than a filtered subset.

### Nodes (TREE ids)

`nodes` mirrors `TREE.md` §四: `id` (`1.8.1`), `track_id`, `title`, `state`,
`start_date`, `end_date`, `dep`, `done_when`.

- `state` is stored verbatim — the tracker vocabulary (已过 / 进行 / 进行中 /
  卡住 / 未开始 / 已立项 / 撤销) is allowed to evolve, so the parser does not
  reject unknown values.
- A blank `起`/`止` cell becomes `NULL`, and so does `持续` in `止`. The table
  does not keep the difference between "not scheduled" and "still running" —
  that distinction stays in the markdown.
- Parent rows arrive with blank dates; the plugin stores the table as written and
  does not roll children up.

### Plan blocks (time grid)

`plan_blocks` is the time grid. A row's id is deterministic —
`${planDate}|${startTime}|${ordinal}` — so a re-import updates the same row
instead of appending. Content fields (`title`, `detail`, `landing`, `estimate`,
`inspiration`, times, slot, ordering) are rewritten on import; `status` and
`notes` are user state and survive. Rows that disappear from the markdown are
deleted, `source = 'manual'` rows are never touched.

- `slot`: `morning` before 10:00, `daytime` before 19:30, `evening` from 19:30,
  `other` when the cell has no time. Clock time only — the day kind lives on the
  day plan, so a weekend 09:00-12:00 block is `morning` like a weekday's.
- Time cell: the first `HH:MM-HH:MM` pair wins, so `09:30-12:00 / 14:00-17:00`
  stores `09:30`–`17:00`.
- `title` is the content cell with the trailing `—— …` detail split off when the
  title then stays within 120 characters; `detail` keeps the full cell text,
  markdown stripped.
- `landing` is the 落点 cell: a repo or file path, taken as written.
- `inspiration` is the first `#NN[.N]` token in the class, title, or detail
  cells (the tracker usually puts it in the class column, e.g.
  `③ 元能力格（灵感 #8 / #13）`) — in practice the idea-store number the evening
  slot is required to carry — and empty when the block has none.

### Day plan

`day_plans` is one row per date: `weekday`, `day_kind` (`workday` | `weekend` |
`unknown`), `market_open`, `label` (the heading tail, e.g.
`周末（休市）· 主攻片（≥4h）`) and `core_goal`. It is what makes "this day was
planned at all" a fact rather than an inference.

### Source file mapping

| Source | Section | Destination |
| --- | --- | --- |
| `SCHEDULE.md` | `## 四、未来 7 天` day headings + tables | `plan_blocks`, day meta on `day_plans` |
| `SCHEDULE.md` | `窗口 = MM/DD-MM/DD` in the section preamble | year anchor for the day headings only |
| `TREE.md` | `## 三、六条支线` | `tracks` |
| `TREE.md` | `## 四、节点表` | `nodes` |
| `daily/YYYY-MM-DD.md` | frontmatter `date:` + `## 🎯 今天核心目标` | `day_plans.core_goal` |

`INDEX.md`, `RULES.md` and the ledgers are not parsed: they are prose and
current-state views, and after an import the day bundle is the machine-readable
copy. The daily card's core goal is the first non-empty `>` line under the
heading.

### Paths

The skills write host paths `/home/jason/…`; the local data lives under
`/data/home/…`. The default tracker directory is
`/data/home/clawd/projects/task-tracker`
(`/home/jason/clawd/projects/task-tracker` on the host). Override it with
`DSH_GANTT_TRACKER_DIR`, or per call with the import route's `dir` body field,
which must be an absolute path. A missing directory is a `400`, not an empty
import.

## Integrity rules

Four checks, all computed from the imported rows and returned as `code` objects in
the day bundle's `integrity` array. Each corresponds to a rule that already
existed in the tracker; none is invented here.

| Code | Rule it encodes | Source |
| --- | --- | --- |
| `landing-missing` | "Every block must carry a landing point (repo / file path); no landing point = not scheduled." A block with an empty `landing`. | `SCHEDULE.md` 二、硬约束 4, `RULES.md` 第十一节 item 3 |
| `evening-missing` | The evening 1h diversity slot is a mechanism, not a ratio: every day 21:00-22:00 goes to pluralistic work, ≤1h/day. No block in slot `evening` for that day. | `RULES.md` 4.2, `SCHEDULE.md` 二、硬约束 1 |
| `inspiration-missing` | That slot's content "must carry an idea-store number" (`#13`, `#22`, `#10.2`), rotated from the candidate pool. An `evening` block without `inspiration`. | `SCHEDULE.md` 二、硬约束 1, `RULES.md` 第十一节 |
| `unplanned-day` | The seven-day board is the single source for future days and must not have holes; a day that was never planned is reported as empty, never filled in on the fly. No `day_plans` row for the date. | `SCHEDULE.md` 一、维护方式, `RULES.md` 第十一节, `daily` iron rule 4 |

The checks are advisory: they are derived at read time and reported as a warning
list with a hint to re-import, not stored as state and not enforced as validation
on the write path.

## Deferred

Three mined skills have no home in this change. Each needs a seam the plugin does
not have today; none is a prerequisite for the import or the Today page.

| Skill | What it does | Why not here, and the seam it would need |
| --- | --- | --- |
| `session-digest-reports` | Builds a per-day digest from LLM session logs along two paths — local Claude Code / Hermes sessions, and LiteLLM spend logs for other clients — as "what the user wanted" plus "what the model finished", then feeds the 21:45 review. | The inputs are session JSONL and spend logs outside the tracker directory, and output is a digest file, not a schedule. Needs a digest table plus an ingestion route for that file; the parser layer would be a fourth `parse*` in the same host module. |
| `session-history-recall` | Answers "what did we decide in that other session" by locating one session and dumping the assistant text from the Hermes state database. | Requires the Hermes `state.db` (session ids, messages) and a link format the page can render. Needs a read-only session lookup registered by the host half and a link component in the client; it is not tracker data, so it should not go into `plan_blocks`. |
| `writing-plans` | A software-development workflow for implementation plans: 2-5 minute steps, exact file paths, complete code, saved as `docs/plans/YYYY-MM-DD-feature.md`. | It authors plans for coding agents, not personal tasks, and it is a write surface — contrary to the read-only import. Needs a plan-document store and an editor (create/update/delete), and a decision on whether the Gantt page or a third page owns it. |

## See also

- [api.md](api.md) — the day bundle, plan status and import routes.
- [development.md](development.md) — database location, schema version, test layout.
- [compatibility.md](compatibility.md) — supported DSH versions and known limitations.
