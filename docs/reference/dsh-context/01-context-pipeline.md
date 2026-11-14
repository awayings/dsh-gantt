# 01 · 上下文是怎么组装出来的

> 一句话：**四类输入、四条通道、一个组装点。**

---

## 1. 四类输入，别混在一起看

| 类别 | 形态 | 谁生产 | 怎么进模型 |
|---|---|---|---|
| 系统提示词 | 有序「段」(section) | 各插件 `ctx.systemPrompt.section()` | 历史里的 `system/message` 表面节点（node 0） |
| 工具 schema | 结构化 JSON | 工具注册表 `ctx.tools.resolve()` | `request/header.tools`，独立字段 |
| 动态上下文快照 | user 角色消息 | `ctx.systemPrompt.context()` 或 pre-step 里自己追加 | 带 `source` 的 `user/message` |
| 会话历史 | 事件日志派生 | `Session`（append-only log）→ `deriveMessages()` | 每步全量重放（压缩遮蔽的除外） |

**常见误解 1**：以为系统提示词是请求里的 `system` 参数。
——不是。DSH 的请求**没有 `system` 字段**，提示词是消息序列里的第一个节点。这样它才能被回放、被压缩范围绕过、被原地替换。

**常见误解 2**：以为上下文快照会“覆盖”旧快照。
——不是。快照文本变了就**追加**一条新的（追加在尾部以保住前缀缓存），旧的在历史里留着，靠开头的 “This snapshot supersedes earlier runtime-context snapshots.” 语义压过旧的，直到被压缩遮蔽。

---

## 2. 段的顺序是写死的稀疏编号

`dsh-system-prompt/lib/index.js:10` 的 `SECTION_ORDERS`：

```text
-1000  HARNESS_IDENTITY          You are an AI agent powered by DeepSeek Harness.
    0  DEPLOYMENT_PERSONA_PREFIX You are a coding agent powered by the {{model}} model.
  500  PLAN_POLICY               计划模式规则
  600  TEAM_POLICY
  800  PTC_ONLY
  900  FILE_REFERENCE           @ 路径引用语义
 1000  TOOL_BASH
 1010  TOOL_PWSH
 1100  TOOL_READ
 1200  TOOL_WRITE
 1300  TOOL_EDIT
 1350  TOOL_APPLY_PATCH
 1400  TOOL_GLOB
 1500  TOOL_GREP
 1600  TOOL_JOBS
 1700  TOOL_PTY
 2000  TOOL_WEB_SEARCH
 2100  TOOL_WEB_FETCH
 2200  TOOL_LSP
 2300  TOOL_SESSION_QUERY
 2400  TOOL_GOAL
 2500  TOOL_SCHEDULE
 2600  TOOL_WORKFLOW
 2700  TOOL_RALPH
 2800  TOOL_SUBAGENT
 2900  TOOL_REPORT
 3000  TOOL_COMPUTER_USE
 3100  MCP_SERVERS
 5000  TOOLS_SDK              生成的工具 SDK 文档
 9000  DELIVERABLE_FILE_REFERENCES
 9900  STRUCTURED_OUTPUT
10000  HARNESS_SOURCE          本机 DSH 源码路径
10100  WEB_SURFACE             本机 Web GUI URL
10200  DEPLOYMENT_PERSONA_SUFFIX
```

规则：

- 升序拼接；同 order 按 name 的 code-unit 排序（保证跨机器逐字节一致）。
- 段文本支持 `{{variable}}` 插值（`model`、`provider` 由 loop 提供，插件可加自己的；`interpolate: false` 保留字面量）。
- 未知变量 → **组装失败**，不会带着坏提示词发请求。
- 空段自动消失。
- `complete: true` 的段会整份替换提示词；两个 complete 段同时生效 → 组装失败。

**运行时上下文另有一套 order**（`CONTEXT_ORDERS`）：

```text
100  WORKING_DIRECTORY
110  SANDBOX_POLICY
115  APPROVAL_POLICY
120  SUBAGENT_DELEGATION
125  TEAM_IDENTITY
200  HARNESS_SOURCE
210  WEB_SURFACE
```

memory-evolve 的 `memory:snapshot` 就注册在这一层（order 由插件配置 `snapshotOrder` 决定）。

---

## 3. 一次请求的完整时序

```text
turn 开始
  │
  ├─ 1. inbox.claim()              领取本轮用户消息 + 排队的注入消息
  │
  ├─ 2. tools.resolve()            算出「这个 agent × 这个模型」可见的工具集
  │
  ├─ 3. systemPrompt.assemble()    全局层 + agent 作用域层合并
  │        ├─ 段：求值 → 插值 → 排序 → 拼接
  │        ├─ 上下文：求值（先不物化）
  │        ├─ 变量：求值
  │        ├─ 工具 schema：按 toolOrder 排
  │        └─ system-prompt/assemble waterfall（监听器可改写）
  │
  ├─ 4. agent/pre-step waterfall   各插件在这里「加料」
  │        ├─ agent-instructions  → 首次请求插入 AGENTS.md 基线
  │        ├─ tool-skill          → <available_skills> 目录消息
  │        ├─ time-context        → 时间快照消息
  │        ├─ compaction-basic    → 压力检查/压缩（可能改历史）
  │        └─ fallback（最内层）   → 把第 3 步的 context 渲染成一条 user 快照
  │
  ├─ 5. 记录 request/header（provider/model/tools）与 request/context（contextWindow）
  │
  ├─ 6. renderPrompt() + deriveMessages() → 发请求
  │
  └─ 7. 流式响应、工具结果逐条 append 进会话日志
```

源码位置：`dsh-agent-loop/lib/index.js:666`（`preStep`）。

注意第 4 步的 fallback 在 **waterfall 链的最内层**：它先生成 context 快照，其它监听器在 `await next()` 之后往返回结果里追加自己的消息。所以观测到的顺序是「领取的消息 → context 快照 → skill 目录 → 时间」。

---

## 4. 本会话的实测取证（已验证）

解码 `session-9789ef20-.../session.v4.jsonl.zstd` 后，第一轮的表面事件：

```text
seq  9  system/message   身份 + persona + 各工具说明 + 环境段
seq 10  user/message     ← 用户提的问题
seq 11  user/message     source=runtime-context  form=snapshot
                          sections: working-directory:current / sandbox:policy /
                                    approval:policy / harness:source / app:web-surface /
                                    memory:snapshot
seq 12  user/message     source=skill-catalog    form=catalog
seq 13  user/message     source=time-context     form=snapshot

（第二轮）
seq 31  user/message     source=runtime-context  form=snapshot   ← 文本变了，追加一条
```

由此可以确认几件事：

1. 系统提示词确实是**一条 `system/message` 事件**，带 `surfaceOp`。
2. 运行时上下文是**一条 user 消息**，`sections` 里逐项记录了贡献者名字（可审计）。
3. **没有 AGENTS.md 相关消息** —— 因为本机候选路径全都不存在（见 `02-knowledge-layers.md`）。
4. 第二轮快照是**追加**而非替换，印证了「变化才追加、旧的不删」。

---

## 5. 请求里到底装了什么

```text
Request
 ├─ header.provider / header.model
 ├─ header.tools        ← 工具 schema（每次请求的固定成本）
 ├─ header.config       ← 采样参数等
 └─ messages[]          ← deriveMessages()：node 0 是系统提示词，其余是表面消息
```

- `request/header` 记录在会话日志里，所以「这个请求用了哪些工具」可回溯。
- `request/context` 单独记录 `contextWindow` 等路由信息，只在变化时写。
- 工具**增删**会生成一条 `developer/message` 说明「新增了哪些工具」，引用对应的 `headerSeq`。

---

## 6. 组装结果长什么样（本会话）

```text
You are an AI agent powered by DeepSeek Harness.          ← -1000
You are a coding agent powered by the cheap model.        ← 0（persona，来自 profile patch）
Tokens prefixed with @ are paths ...                      ← 900
<bash 工具说明> ...                                        ← 1000
<read / write / edit / glob / grep / jobs ...>            ← 1100–1700
<web / goal / schedule / workflow / subagent ...>         ← 2000–2900
<tools SDK / 结构化输出>                                   ← 5000 / 9900
Current DeepSeek Harness implementation checkout: ...     ← 10000
Current DeepSeek Harness Web GUI URL: ...                 ← 10100
```

`persona` 那行来自 Web profile 的 `dsh-web-app/cordis.patch.yml:19`（`personaPrefix`），`{{model}}` 被解析成当前模型 `cheap`。

---

## 7. 一句话总结

组装器本身**不生产任何内容**，它只做四件事：**收集（注册表）→ 排序（order）→ 插值（变量）→ 合并（waterfall）**。
内容从哪来，取决于「哪些插件被组合进来、它们各自注册了什么」——这就是下一篇要讲的「三层知识」。
