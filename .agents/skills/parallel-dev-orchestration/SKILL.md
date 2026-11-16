---
name: parallel-dev-orchestration
description: "用 DSH 原生 Agent Team + git worktree 做并行开发：把需求拆成写路径互不重叠的任务，每个 worker 在独立分支并行实现，Lead 收口审查后合并。触发场景：用户要求并行开发/同时开做多个任务/用 worktree 分支开发/多 agent 分工协作/一个需求拆成几块同时推进。"
---

# 并行开发编排（Agent Team + Worktree）

## 一、何时用 / 何时不用

**用**：需求能拆成 2~4 个写路径基本不重叠的独立块，且每块值得开一个完整会话（跨多文件、要自测、要迭代）。

**不用**：
- 单文件小改动 → 直接做，别开团队；
- 三个任务都要改同一个文件 → 串行做，或先重构接口再拆；
- 机械性批量任务（批量改调用点、批量补测试）→ 用 `subagent(cwd=...)` 扇出更省，见第十一节。

## 二、硬限制（先知道，免得设计错）

| 限制 | 后果 |
|---|---|
| 只有 Lead 能 `spawn_teammate` / `interrupt_agent` | teammate 不能再生 teammate，**最多两层，不能加第三层** |
| `subagent` 的 `maxDepth` 默认 1 | 子 agent 不能再派子 agent |
| `spawn_teammate` **没有 cwd 参数** | 隔离不是 spawn 时给的，要 worker 自己 `create_worktree` |
| `maxMembers: 16`（含创建失败的），`maxTasks: 256` | 名字不可复用，起之前想清楚分几个 |
| teammate 不会自动释放 | 收尾必须 `interrupt_agent` |

## 三、前置检查（任何一条不过就别开工）

1. **会话 cwd 是 git 仓库根**：`git rev-parse --is-inside-work-tree`
2. **仓库在 workspace 内**：沙箱是 workspace-write，仓库在 workspace 外时 `create_worktree` 会因 `EACCES` 失败
3. **基线干净**：`git status` 无未提交改动（worktree 不复制未提交内容）
4. **`.agents/` 已被 ignore**：`grep -q 'agents' .gitignore`。注意 worktree 服务只在**自己新建**父目录时才写 `.gitignore`，已有 `.agents/` 且没忽略规则时它不会补
5. 记录基线：`git rev-parse --short HEAD`（后面合并/回滚要用）

## 四、形态选择：worktree 分支（默认）还是单检出（轻量）

### 形态 A：worktree + 分支（默认，隔离彻底）

适用：写路径有交叉风险、≥3 个需求、结构重构、每个 worker 要独立跑全量门禁。

- 每个 worker：`working_directory({ cd: "<仓库根>" })` → `create_worktree({ name })` → 只在 worktree 内读写，绝不回主检出改动。
- worktree 落在 `<仓库根>/.agents/worktrees/`；不自动清理，收尾要 `git worktree remove` + 删分支。
- 代价：worktree 里没有 `node_modules`，首次要各自 `pnpm install`；**profile 链接的是主检出，worktree 不参与真机验收**（见第七节）。

### 形态 B：单检出（同一个 checkout，直接提交到 main）

适用：≤2 个需求、`write_scopes` 不相交或只共享文件的不同区域、改动小、需要边改边看 GUI。

| 优点 | 代价 |
|---|---|
| 零合并成本、历史线性、无需安装/清理 | 共享 git index 与 HEAD，**没有 merge 冲突提示**——同一 hunk 两人都改就是后写覆盖 |
| 主检出就是 GUI 服务目录，build + 刷新即可看 | push 是单写者；构建产物/日志/覆盖率目录会互相覆盖 |

单检出红线（踩过才写的）：

1. **禁止 `git add -A` / `git add .`**：逐文件 stage 自己的 `write_scopes`；commit 前 `git status` + `git diff --staged` 核边界。
2. **共享文件只在收到 go-ahead 后动**：先写"红测试"，等对方 commit 完再改；顺序写进任务描述，不靠叮嘱。
3. **push 单写者 = Lead**：pre-push 会校验"已验树指纹 == 待推树指纹"，树里有别人的未提交改动就拒推。
4. **门禁单写者**：同一时刻只跑一个 full gate（会写 `.tmp/check-logs`、重建客户端产物、写 `./coverage`）。
5. **WIP 保持 lint/typecheck 干净**：pre-commit 对整树跑 static，你的半成品会让别人的 commit 失败。
6. **i18n / docs / 版本号 / 锁文件归 Lead**，避免两人同改。

## 五、SOP

### 阶段 1：侦察与定契约（不许跳过）

并行失败九成出在这里，不是出在 agent 身上。

1. 读代码，确认每块的改动边界；
2. 定**文件级契约**：谁改哪几个文件，**写路径不允许重叠**；
3. 重叠的必须串行——用任务依赖表达，不要靠叮嘱；
4. 定**接口契约**：跨块共享的签名/数据结构，先写死在任务描述里，否则合并必炸。

### 阶段 2：建任务板

每个任务一条，必须带写路径提示：

```
team_task_create({
  subject: "实现 <模块> 的 <功能>",
  description: "目标：<一句话>\n验收：<可判定的标准>\n只允许改动：<文件列表>\n接口契约：<签名/数据结构>\n禁止：merge / push / 改主干 / 动范围外文件",
  write_scopes: ["src/a/", "test/a/"]
})
```

有先后依赖的，用 `blocked_by` 串起来。**不要在阶段 2 就把互斥的活并行掉。**

### 阶段 3：spawn worker

并行度建议 **2~4**（再多人会互相等审批、抢注意力，收益递减）。

`spawn_teammate({ name, description, context: "fresh", prompt })`，prompt 用模板：

```text
任务：<一句话目标>
对应任务板任务：<task id>

工作区纪律（严格按顺序，违反即作废）：
1. 先 working_directory({ cd: "<仓库根绝对路径>" })
2. 再 create_worktree({ name: "<任务短名>" })
3. 之后所有读写都在这个 worktree 内，绝不回主检出目录改动
4. 禁止 git merge / git push / 删除 worktree / 改主干分支
5. 只动这些文件：<文件清单>。需要动别的，先 send_message 问我

接口契约（不许改）：<签名/数据结构>

交付：
- 自己跑测试/自检，把命令和结果贴出来
- 改了 UI 就跑对应的 tests/client 用例（或 pnpm run e2e），结果必须贴
- git add -A && git commit -m "feat|fix: <摘要>"
- team_task_update 完成任务
- send_message 给 lead，只报：分支名 / commit hash / 改了哪些文件 / 自检结果
```

**关键**：worker 拿不到 cwd 参数，第 1、2 步是它唯一的隔离来源，必须写死。

### 阶段 4：收口（Lead 独占）

1. 收齐汇报，对照任务板核销；对不上就 `team_task_update` reopen；
2. **逐个看 diff**：`git diff <base>...<branch>`。别信"我做完了"——它和"做对了"是两件事；
3. 按依赖顺序合并，见第六节；
4. 冲突退给对应 worker 在自己的 worktree 里 rebase 解决，**不要在主干手工揉**；
5. **合并后在主干跑一遍集成测试**——各分支自己绿、合起来挂，是并行开发最常见的翻车点。

需要更硬的代码质量闸门时，另加一个 fresh 启动的 reviewer：只喂「验收条件 + diff」，不给它看 worker 的实现过程（否则会被带偏），输出 approve / request-changes，approve 后才合并。

### 阶段 5：收尾

- `interrupt_agent` 停掉不用的成员（不释放会一直占 roster）；
- 清理已合并的 worktree：`git worktree remove <path>` + `git branch -d <branch>`；
- 通报用户：合了哪些分支、跑了什么测试、还有什么没做。

## 六、合并顺序与冲突

- **依赖在前**的先合（被 `blocked_by` 指向的）；
- 用 `git merge --no-ff` 保留分支痕迹，便于回滚；仓库要求线性历史时先 rebase 分支再 `--ff-only`；
- 冲突时先判断归谁：谁的 `write_scopes` 覆盖冲突文件，谁去 rebase；
- 合并前确认各分支都基于同一个 base commit，偏离太远先 rebase 再合；
- 冲突观：**冲突要么不发生、要么当场显式暴露**——契约层拆文件 → 排序层 barrier → 合并层 worktree 分支，三级依次尝试；宁可用 barrier 排队，也不要让两人在同一 hunk 上"事后发现"。

## 七、worktree 里的验证边界（UI 改动的重点）

- **UI 测试照常在 worktree 里跑**：`pnpm exec vitest run --project client tests/client/<file>.spec.js -t "<case>"`（jsdom，覆盖结构/交互），跨真实接缝时跑 `pnpm run e2e`（会先重建客户端产物）。这些是合并前的硬门槛，不能省。
- 改了 `src/client/` 先 `pnpm run build`，否则 e2e 驱动的是旧产物。
- **真机 GUI 验收放到合并之后**：profile 链的是主检出，worktree 的客户端产物不会被服务。合并 → 主检出 build → 刷新页面（host 改动要重启 `dsh web`）→ 过一遍手动 checklist（桌面到 ~390px、双语、明暗、长列表）。
- 所以 UI 需求分两段验收：**worktree 内单测/e2e 必须绿，合并后主检出上人工过一遍**。两段都做完才算完成。

## 八、坑清单

1. **Lead 自己 `create_worktree`** → 主控 cwd 被切走，就没法在主干 review 和合并了。建 worktree 是 worker 的活。
2. **worker 忘 cd 就在共享目录写** → 两个 worker 同时写主干互相踩。prompt 第一条压死它。
3. **`write_scopes` 只是警告不是锁** → 重叠了必须自己串行化。
4. **各自测试都过、合并就崩** → 阶段 4 第 5 步不能省。
5. **worker 自己标任务完成** → 它有权这么做，所以 Lead 必须核验 + 保留 reopen 权。
6. **沙箱越界** → 报 `EACCES` 通常是仓库不在 workspace 内，不是工具坏了。
7. **不清理** → worktree 和分支会越堆越多，`git worktree list` 定期看。
8. **单检出下并发 build/e2e** → 产物、日志、覆盖率目录互相覆盖；要么单写者，要么换独立 reports 目录。

## 九、验证清单（合并前逐条打勾）

- [ ] 每个任务的 diff 我亲自看过
- [ ] 每个任务的验收标准逐条对过
- [ ] 每个分支的受影响单测（含 UI 的 tests/client）通过
- [ ] 所有分支都基于同一 base，或已 rebase
- [ ] 合并后主干集成测试通过
- [ ] 合并后主检出真机验收过（UI 改动必做）
- [ ] 无残留 worktree / 无未清理分支
- [ ] 未用的 teammate 已 interrupt

## 十、汇报格式

给用户收口时说清四件事：**合了哪些分支、每个分支改了什么、跑了什么测试结果如何、还剩什么没做**。不要把 worker 的原始汇报直接贴给用户。

## 十一、变体：大批量扇出用 subagent

任务机械、互不依赖、不需要长对话时，不必开团队：

1. Lead 自己先建好 N 个 worktree（注意：这会让 Lead cwd 切换，建完记得 `working_directory({ cd: <仓库根> })` 切回来）；
2. 每个任务一个 `subagent({ cwd: "<worktree 路径>", prompt })`，同一条消息里一起发 → 并行；
3. 好处：不占 roster；坏处：子 agent 一次性，靠 prompt 说清楚。

## 十二、常见错误设计

- ❌ 想"Lead → 子 Lead → worker"三层：DSH 不支持，第二层起不来。
- ❌ 想靠 `spawn_teammate` 指定目录：没有这个参数。
- ❌ 五个以上 worker 并行：收益递减，审批和注意力会打架。
- ❌ 不定义接口契约就并行：合并阶段必然返工。
- ❌ 认为 worktree 里"测不了 UI"：单测/e2e 照跑，只是真机验收要等合并。
