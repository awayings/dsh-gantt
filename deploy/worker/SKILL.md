---
name: gantt-worker
description: 通过 MCP 从共享甘特任务树里领取工作 —— 当被要求接手一个甘特任务（甘特任务 / shared task tree）、更新它的进度、拆解它或汇报完成时使用。
---

# 甘特 worker

`gantt` MCP server（HTTP，tailnet）是共享的上下文存储：一棵 SQLite 任务树，带时间
维度（日期、进度）和关系维度（祖先链路、同级任务），外加只追加的 worker 轮次
轨迹。只拉取 —— 没有任何东西被派单给你。

**身份。** 你的固定 agent 名是 `<gantt-agent-name>`。每个会话用这个 `name` 和
`type: "ai-agent"` 调用一次 `register_agent`，之后每次写都把它作为 `agentName`
传进来。客户端能提供会话 id 时，再作为 `session` 传。同名重复注册会复用同一个
agent id。

**开始。** 接手甘特任务时，先调用一次 `get_worker_guide` 并照它执行。然后拉取：
`list_ready_tasks`（`tag` 取 `ready` | `next` | `todo`，默认 `ready`），再对你选中
的任务调用 `get_task_context`。写任何东西之前，先读完它的祖先链路、字段、关联和
轨迹。

**循环。**

1. 在你自己的环境里干活；store 从不执行代码。
2. 任务太大或边界不清：`decompose_task`，给 `parentId` 和 1–100 个子任务，最多
   4 层，每个 `doneWhen` 都可验证。
3. 需要一个同级任务：`create_task`，`parentId`（子任务）与 `afterTaskId`（下一个
   同级）恰好给一个。
4. 推进进度：`update_task`，改 `status`、`progress` 或其他可变字段，并用
   `summary` 说明改了什么。
5. 收尾：`report_completion`，写清产出了什么、在哪里验证过。

**每轮以恰好一次调用收尾。** 一次任务树写操作（`create_task`、
`decompose_task`、`update_task`、`report_completion`），或在本轮没有写任务树时用
`track_task`。不要只发文字就结束，不要同时发任务树写操作和 `track_task`，也不要
把 `track_task` 当作完成报告。

**规则。**

- 每个任务工具上的 `taskId` 都接受内部 UUID、点号编号（`1.8.1`）或外部 ref
  （`node:1.8.1`）。
- 不要编造 id：只对 server 返回的或人给你的 id 动手；未知 id 会回
  `task ... was not found`，重新解析即可。
- 链路不明确：问人；没人能回答时，`update_task` 设 `status: "blocked"`，并在
  `summary` 里写清阻塞条件。
- 工具失败会作为 `isError: true` 的内容返回 —— 读它返回的文本。
- 每次调用保持简短；这个数据库和 Web UI、其他 worker 共用。
- 提交代码时，把任务的点号编号写进 commit 标题末尾：`feat(today): 加粗计划行 (1.8.1)`；
  模板 `<type>(<scope>): <祈使句标题> (<点号编号>)`。点号编号是把 commit 和任务树
  对上的唯一把手，裸标题对不上。
