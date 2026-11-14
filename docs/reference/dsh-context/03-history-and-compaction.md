# 03 · 历史、压缩与计量

> 会话是「事件日志」，模型看到的是它派生出来的「表面」。
> 长对话不靠遗忘，靠**有日志记录的压缩**。

---

## 一、事件溯源：日志是唯一真相

`@deepseek-ai/dsh-session` 的核心约定：

```text
Session = 只追加的类型化事件日志（append-only）
   └─ surface（表面） = 从日志增量推导出的有序消息视图
        └─ deriveMessages() → 模型请求里的 messages[]
```

- 表面事件类型是封闭集合：`system/message`、`developer/message`、`user/message`、`assistant/message`、`tool/result`，都必须带 `surfaceOp`。
- `surfaceOp` 只有两种：`append`，或 `replace { startSeq, endSeq }`（按当前表面顺序、端点为包含边界）。
- 其它事件（`step/start`、`turn/end`、`compaction/*`、`request/header`、遥测……）**只写日志，不进模型视野**。
- 不变式：**模型可见 = 已记录**。任何进入请求的内容都必须能从日志重建，所以回放是确定性的。
- 每次模型尝试成功都会提交一条 `assistant/message`，里面带紧凑的 provider 流；取消则提交 `interrupted: true` 的锚点，携带已交付前缀。

**为什么值得这样设计**：fork、恢复、审计、压缩、遥测、UI 全部读同一份日志，不会出现「界面上有、模型没看到」的分叉。

---

## 二、压缩（compaction）

### 触发

| 触发方式 | 时机 |
|---|---|
| `pressure` | `agent/pre-step` 里检查压力，越过阈值就压 |
| `context-overflow` | provider 报 `CONTEXT_WINDOW_EXCEEDED` 后强制压一次再重试 |
| 手动 | `/compact` 命令，或插件调 `compactNow()` |
| 显式范围 | `compactRegion()`，调用方指定表面区间 |

### 默认参数（`dsh-compaction-basic/lib/index.js:15`）

```text
thresholdRatio = 0.80      # 达到模型上下文窗口的 80% 触发
retainRatio    = 0.16      # 保留最近约 16% 逐字不动
headroomTokens = 65536     # 给输出预留的空间
```

实际阈值取 `min(contextWindow × 0.8, 消息预算 − headroom)`，并且必须满足 `retainTokens < thresholdTokens`，否则启动即报配置错误。

### 压缩做了什么

```text
压缩前: [system] [u1] [a1] [t1] [u2] [a2] [t2] ... [u20] [a20]      ← 超出压力
压缩后: [system] [<compacted-summary> 摘要] [u18] [a18] [t18] [u19] ...  ← 尾部逐字保留
```

- 被选中的**最旧平衡区间**被替换成**一条 user 消息**，用 `<compacted-summary>` 标签包住摘要文本。
- 边界必须「工具配对平衡」：不能把「assistant 发起工具调用」和「tool/result 返回」切开（`toolPairingBalancedBefore/After`）。
- 压缩范围**从第一个非 `system/message` 节点开始**，所以 node 0 的系统提示词永远不会被摘要掉。
- 摘要请求本身复用会话前缀（system + tools + 被遮蔽消息），只有尾部指令和输出不缓存，尽量命中 provider 的 hot prefix。
- 原始事件**仍留在日志里**，只是被 `replace` 遮蔽；回放能确定性重现同一份压缩后对话。

### 日志里的标记对 = 锁

```text
compaction/start     ← 仅日志，先写，取得锁
compaction/summary   ← 仅日志，记录原始摘要文本
user/message (replace, 摘要)  ← 唯一的表面变更
compaction/end       ← 仅日志，释放锁
```

`start` 与 `end` 之间崩溃会留下**可检测的遗留锁**（busy），不会假装成功。手动压缩用 `turn: null`，不要求有打开的轮次。

### 压缩的边界（做不了什么）

- 缩不了系统提示词、工具 schema、会话前缀。
- 拆不开单个不可分单元（比如一次超大的工具调用）。
- 需要**一次额外的模型请求**，只保留返回的文本（推理和工具调用丢弃）。

---

## 三、工具结果修剪（pruner）

`dsh-compaction-tool-result-pruner`，配置在 `standard.patch.yml`：

```text
thresholdChars = 8192     # 超过 8KB 的工具结果才修剪
headChars      = 4096     # 留头
tailChars      = 1024     # 留尾
```

- **只在压缩触发条件满足后才跑**——低压力对话绝不会被碰。
- 不发起模型调用，可能完全省掉一次摘要：修剪后若已降到阈值内，压缩直接跳过。
- 与压缩共享「影子价格」协议（`compaction/prune`），保证计量一致。

---

## 四、token 计量（token-meter）

```js
const { totalTokens, surfaceTokens, nodes } = ctx.tokenMeter.measure(session)
const pressure = ctx.tokenMeter.contextPressure(session)
```

- **回放日志**做估算，**不调模型**，确定性。
- `contextPressure`：`pressureTokens`（provider 报告的最新提示词规模）、`projectedTokens`（下一个请求将要花多少）、`contextWindow`。
- `contextBreakdown`：`systemTokens` / `toolsTokens` / `messageTokens`，固定启发式，用于「上下文构成」展示。
- 文本按约 4 字符/token 估算 → **CJK 和 JSON schema 会严重低估**。
- 只有最新成功调用的请求 envelope 与当前测量 envelope 完全一致时，才复用 provider 报告的用量。

**重要**：占用数字只是参考，harness 里没有任何机制根据它做内容决策；压缩读的是 `measure()`。

---

## 五、KV cache：所有设计都在保前缀

| 行为 | 对缓存的影响 |
|---|---|
| 普通历史追加 | ✅ 前缀不变，可复用 |
| 压缩 / 表面替换 | ❌ 从第一个被遮蔽 token 起失效 |
| 改系统提示词（原地替换 node 0） | ❌ 整个请求失效 |
| 同一序列内 `in-history` 方式追加提示词 | ✅ 历史末尾之前仍可复用 |
| 工具增删/重排 | ❌ 从第一个变化的 schema token 起失效 |
| 加一条尾部快照（runtime context） | ✅ 追加，前缀不受影响 |

这就是为什么：

- 运行时快照**变化才追加**，而不是每轮重写；
- 记忆快照做**变更检测**；
- 系统提示词渲染不变时**一个事件都不写**；
- 压缩摘要复用 system + tools + 被遮蔽消息作为前缀。

---

## 六、恢复与崩溃修复

- `resume` 会读物理日志，跳过中断留下的不完整 step，补写 `interruptedTurnClosers`。
- 被取消/失败的工具调用会得到合成结果（`ABORTED_BEFORE_DISPATCH`、`TOOL_OUTCOME_UNKNOWN`、`TOOL_NOT_STARTED`），保证下一次请求的工具历史**配对完整**。
- 恢复会话也会对账 AGENTS.md 基线，避免重复注入。

---

## 七、一句话总结

**日志负责「记住一切」，表面负责「给模型看什么」，压缩负责「看多少」，计量负责「还剩多少」。**
四者共用同一份事件流，所以回放、审计、缓存优化才能同时成立。
