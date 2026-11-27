---
name: gantt-dispatch-flow
description: 甘特长城分发会话的每轮操作手册：定位→成形→沉淀→派发四步的判定规则、已知落点路由表、反犹豫纪律与 subagent 派发约定；分发者处理任何新请求或复盘派发流程时使用。
---
# gantt-dispatch-flow：甘特长城分发者每轮操作手册
## 概览
分发会话每轮固定四步：定位 → 成形 → 沉淀 → 派发。分发者自己不执行任务、不写代码、不跑命令；只落账、派发、转告。本技能把判定规则固化成清单，替代临场推演；规则来源为用户已确认的判定反馈（2026-11-27）。核心纪律：每步一次收敛——一次读取、一次查询、直接落账；拿不准且影响判定时，问用户一个具体问题，不用第二轮自查代替提问或行动。
## 步骤
### 1. 定位（一次收敛）
- gantt_context 读一次；提示树未变化时沿用上次结果，不重复全量重读。
- gantt_knowledge_query 按主题关键词查一次过往判定。
- 已知落点规则（直接执行，不再侦察）：dsh-gantt 开发/改进 → 父节点 3.7 直接建子任务，不新建父支线（用户确认）；投资策略灵感/因子 → 1.12.1 冰点抄底链（用户口中「冰点反弹」=此链），投资执行/状态盘点 → 1.9（easy-tdx 落点）；闲聊、纯信息查询、设计讨论 → 直接回答，不进树不派发。
- 用户点名任务/支线 → 挂现有；新工作 → 落点下 decompose；未定型灵感 → gantt_capture。
### 2. 成形
- gantt_decompose：每个子任务带可验证 doneWhen（做完了吗？怎么证明？）。
- description = 用户原话 + ≤30 字路由注记（只写背景与人类约束）+ 必要链接；不替执行者写实现计划或验收清单。
- 挂现有任务且本轮有新要求 → gantt_update_task 把新旧说明合并写回，不丢旧约束。
### 3. 沉淀
- gantt_knowledge_save 记判定：为什么落在这里、哪里拿不准、下次怎么判更好。
- 用户口头确立的长期路由规则 → 另提 memory key 建议（待确认后常驻注入）。
### 4. 派发（fire-and-forget）
- gantt_agents 查能力与投递登记：能力对口且有 endpoint 的远程 Agent → gantt_delegate（执行 execute / 只拆解 decompose）；否则 gantt_execute 本机 subagent。
- subagent prompt 自包含：点号 + doneWhen + 用户原话 + 仓库硬约束 + 并行约定 + 轻量报告与回写要求。
- 派发后即回复用户：落点、新建了什么、派给谁、走哪条通道；不等结果、不代收。
- 完成通知到达 → 照抄执行者上报转告，它说完成才算完成，不加工成新技术判断；执行者以落点不对为由 blocked/cancelled → 当新候选重新定位，不塞回原处。
## 命令（工具调用模式）
- 无依赖的调用放同一批次并行；gantt_context 提示未变化时不重读。
- 收尾一轮：memory 一次调用（action=add + entries=[daily, project]）；出现长期规则另提 key 建议；用户有明显情绪时各条目带 feedback。
- subagent worktree 约定：DSH 沙箱只允许写工作区目录；分发者 cwd 是多仓工作区根不是仓库根（create_worktree 直用会失败）——worktree 由 subagent 定位检出后在沙箱内自建（如 .worktrees/<分支名>）；并行任务各自分支、不动 main、完成后统一顺序合并。
## 坑
- 树没有关键词检索工具（3.7.43 开发中）：定位靠知识库同义词映射与用户给的父节点，不靠多轮盲查。
- 聚焦链只见单链；分支折叠（auto blockpoint）时子任务展不开：落点判定用 knowledge_query(taskId=X) 一次。
- 预查过度已被用户两次催促：一次查询拿不到就直接问用户或按规则落账。
- 投递通道缺口：easy-tdx-workstation 能力已注册但 endpoint 不完整，不可 gantt_delegate——投资类任务先落账压着，不硬派。
## 验证
- 每轮自检三问：① 落点是否一次收敛（≤1 次 context + ≤1 次 knowledge 查询）？② description 是否含用户原话与路由注记？③ 是否派发即收尾、只转告不加工？
- 收尾查 dtodo list 默认视图，有到期未完成项在回复末尾提醒。
