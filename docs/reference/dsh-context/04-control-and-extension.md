# 04 · 谁来决定，以及怎么改

> 「谁决定往上下文里塞什么」不是一个答案，是**四层决策**。

---

## 一、四层决策

| 层 | 谁 | 决定什么 | 在哪 |
|---|---|---|---|
| 组合层（静态） | profile + bundle + agent preset | 有哪些插件在、哪些段可能存在、预算多少 | `profiles/web/package.json`、`cordis.patch.yml`、`presets/standard.patch.yml` |
| 注册层（插件） | 拥有该事实的插件 | 注册哪些 section / context / tool / 变量 | 各包 `apply()` |
| 组装层（每步） | `dsh-agent-loop` + `dsh-system-prompt` | 合并、排序、插值、waterfall、工具集 | `dsh-agent-loop/lib/index.js:666` |
| 使用层（模型） | 模型自己 | 通过 `read` / `skill` / `memory` **按需拉取** | 工具调用 |

**模型不能自己往 system 里写东西。** 它能做的只有：调用工具取内容、或触发一个插件在 `pre-step` 里做决定。

---

## 二、作用域与遮蔽

```js
// 全局：影响所有 agent
ctx.systemPrompt.section({ name: 'x', order: 900, text: '...' })

// agent 作用域：只影响这个 agent，并遮蔽同名全局项
agent.ctx.systemPrompt.section({ name: 'x', order: 900, text: '...' })
```

- 同名注册只在该作用域内遮蔽，不污染其它 agent。
- `system-prompt/assemble` 是 **waterfall**（中间件链）：监听器可以改段、改上下文、加变量；返回的文本是权威结果。
- `complete: true` 的段在 waterfall 之后被恢复成**唯一**的提示词段——监听器无法给它加东西。
- `suppressRuntimeContext()` 可以移除本作用域的可选动态上下文（`required` 的仍保留），用于子 agent 或特殊路由。

---

## 三、组合是怎么长出来的

```text
profiles/web/package.json  dsh.profile.bundles
        │  dsh-base, dsh-web-app, dsh-memory-evolve, ...
        ▼
profiles/web/cordis.patch.yml      覆盖/追加/禁用（按 id 定位）
        │  例：system-prompt.personaPrefix、memory-evolve.reviewEnabled
        ▼
agent preset（standard）           决定这个 agent 挂哪些插件
        │  例：persona、agent-instructions、tool-*、compaction、delegation
        ▼
运行时 ctx.systemPrompt / ctx.tools 注册表 → 每步 assemble
```

`standard` preset 的完整清单在 `dsh-web-app/presets/standard.patch.yml`，包括：

- `persona`（`You are a coding agent powered by the {{model}} model.`）
- `agent-instructions`（`maxBytes: 65536`）
- `time-context`
- `tool-bash` / `tool-fs` / `tool-fs-search` / `tool-jobs` / `tool-schedule` / `tool-web` / `tool-goal` / `tool-todo` / `tool-ask-user` / `tool-present` / `tool-skill`
- `plan-mode`（独立 group）
- `compaction` group（`compaction-basic` + `command-compact` + `tool-result-pruner`）
- `delegation` group（`tool-subagent` spawn / `tool-subagent` fork / `tool-workflow` / `tool-subagent-control`）

---

## 四、子 agent 的上下文继承

| 方式 | 初始上下文 | 适用 |
|---|---|---|
| `subagent`（spawn） | **全新会话**，只多一条 `subagent:delegation` 运行时声明 | 独立任务、审计、并行调研 |
| `subagent_fork` | 父级**已完成的轮次前缀**一次性复制 | 承接当前对话继续做 |
| `workflow` | 每个 agent 独立（spawn 语义），脚本编排 | 大规模扇出 |

要点：

- fork **看不到进行中的轮次**，只看到已完成的。
- fork 是**一次性快照**：之后父级记录的任何内容都不会到达子级。
- 子级不继承父级的权限/沙箱，工具作用域是全新的。
- fork 首轮没有历史（父级没完成轮次时）。
- 父级 ID 与返回指导放在**初始任务**里（继承历史之后的 user 消息），所以不会破坏子级复用的前缀缓存。

---

## 五、修改清单（想做什么 → 改哪里）

| 目标 | 动作 | 生效时机 |
|---|---|---|
| 让项目遵守某约定 | 写 `<项目根>/AGENTS.md`（或 `CLAUDE.md`） | 下一次请求 |
| 让子目录有更具体规则 | 在子目录放 `AGENTS.md`，或在其中 `read` 一次触发发现 | 下一次请求 |
| 跨会话记住事实 | 让模型 `memory add target=key`，用户确认 | 确认后下一次组装 |
| 固化一套流程 | `~/.agents/skills/<name>/SKILL.md` | 下一个模型步骤（有 watcher） |
| 改人格/常驻前言 | profile patch 的 `system-prompt.personaPrefix`，或 preset 里的 `dsh-persona` | 重启 |
| 加一段固定提示词 | 插件里 `ctx.systemPrompt.section({ name, order, text })`，order 取 9000–9900 之间 | 注册后下一次组装 |
| 加动态运行时事实 | `ctx.systemPrompt.context({ name, order, text })` → 自动变 user 快照 | 注册后下一次组装 |
| 加工具 | 注册到 `ctx.tools`；schema 自动进 `request/header` | 下一个步骤 |
| 加变量 | `ctx.systemPrompt.variable('name', () => ...)`，段里写 `{{name}}` | 下次组装 |
| 调压缩阈值 | profile patch 覆盖 `compaction-basic.config.thresholdRatio/retainRatio` | 重启 |
| 临时压一次 | `/compact` | 立即 |

---

## 六、常见坑（都是真实踩过的）

1. **未知变量 = 组装失败**
   自定义 persona 里不要写 `{{cwd}}`——loop 不注册这个变量，会在任何模型请求之前抛错。当前目录由 `working-directory` 服务以 user 上下文提供。

2. **同名 section 重复注册会抛错**
   插件被加载两次（历史上 loader 的 bug）会 `already registered`。memory-evolve 为此加了幂等保护。

3. **`toolOrder` 必须恰好有一个 `'<unlisted-tools>'` 其余项**
   重复项或缺失会在加载时失败；列了不存在的工具名会让**每次** `assemble()` 被拒。

4. **AGENTS.md 不监视外部编辑**
   只在首次请求加载一次 + 文件工具触达更深的目录时增量发现。用 shell 改文件、在 IDE 里改，不会立刻反映（要等下一次 `read/write/edit` 或恢复会话对账）。

5. **记忆里的 `{{` 会让组装炸**
   记忆正文可能包含 `{{session}}` 这类字面量，插件会整段净化并以 `interpolate: false` 降级。自己写段时同理。

6. **改系统提示词会打断 KV cache**
   原地替换 node 0 会让整个请求前缀失效；能追加就追加（尾部快照、`in-history` 提示词更新）。

7. **压缩范围不能切工具配对**
   自己实现压缩后端时用 `toolPairingBalancedBefore/After`，否则会留下孤儿 `tool/result`。

8. **`contextBreakdown` 不是账单**
   CJK + JSON schema 在 4 字符/token 下会被严重低估；精确值要看 provider 报告的 `pressureTokens`。

---

## 七、怎么自己验证

1. 解本会话日志，看表面事件序列（脚本见 `appendix-file-map.md`）。
2. 看 `request/header` 里的 `tools`，确认这一步到底给了哪些工具。
3. 看 `user/message` 的 `source.kind`：`user` / `runtime-context` / `skill-catalog` / `time-context` / `agent-instructions`，一眼看出谁注入的。
4. 改完 AGENTS.md 后，下一轮日志里应该多一条 `agent-instructions` 基线；没有就是路径不在候选链上。

---

## 八、一句话总结

**组合层决定「谁能说话」，注册层决定「说什么」，组装层决定「按什么顺序说」，模型只决定「要不要现在去拿」。**
