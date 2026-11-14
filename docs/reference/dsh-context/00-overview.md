# DSH 上下文管理学习笔记

> **对象**：DeepSeek Harness（DSH）`0.2.2-rc.1`，本机 npm 安装态
> **安装路径**：`/data/app/node_modules/@deepseek-ai/*`（无源码仓库，只有各包 `README.zh.md` + 编译产物 `lib/index.js`）
> **Home**：`/data/dsh-home`，Web profile：`/data/dsh-home/profiles/web`
> **成文时间**：2026-11-08
> **取证方式**：包内文档 + 编译产物 + **本会话自己的 session 日志**（解码后逐条核对事件）

---

## 这套笔记回答什么问题

1. 一次对话发起时，上下文到底是怎么拼出来的？在哪段代码里？
2. 系统提示词里都有什么？为什么没有 `system` 字段？
3. `AGENTS.md` / `CLAUDE.md` 这种分层文件有没有？怎么加载？
4. 跨会话记忆、技能、历史消息分别走什么通道？
5. 长对话怎么不撑爆？压缩的阈值和保留策略是什么？
6. **谁**决定往上下文里塞什么？我想改该动哪里？

---

## 五分钟速览

- DSH **没有**一个巨大的 prompt 模板，也没有“临时决定塞点什么”的逻辑。它是**注册表 + 每个模型步骤重新组装**。
- 上下文由**四类输入**拼成，走四条不同通道：系统提示词段、工具 schema、动态上下文快照（user 消息）、会话历史（事件日志派生）。
- 系统提示词**不是** wire 上的 `system` 字段，而是历史里的第一个 `system/message` 表面节点。
- 段的顺序是**写死的稀疏编号**（`-1000` 身份 … `10200` persona 后缀），见 `dsh-system-prompt/lib/index.js:10`。
- 拼装发生在 `dsh-agent-loop` 的 `preStep()`（`lib/index.js:666`）：领取消息 → 解析工具 → `assemble()` → `agent/pre-step` waterfall（各插件在此加料）→ 组装请求。
- `AGENTS.md` 分层链**确实存在**（`dsh-agent-instructions`），从 `$DSH_HOME` → `~/.agents` → 项目根 → 逐级 cwd，每条链 64KB 预算。
- 历史是**事件溯源 + 全量重放**；长上下文靠 compaction（**80% 阈值、保留约 16% 尾部**）摘要成一条 `<compacted-summary>` 消息。
- 决定权分四层：**组合（profile/preset）→ 注册（插件）→ 组装（每步）→ 模型按需拉取**。模型不能自己往 system 里写东西。

---

## 目录

| 文件 | 内容 |
|---|---|
| [01-context-pipeline.md](01-context-pipeline.md) | 四类输入、段顺序表、`preStep()` 时序、本会话实测取证 |
| [02-knowledge-layers.md](02-knowledge-layers.md) | 三层知识：`AGENTS.md` 指令链 / memory 记忆 / skills 技能 |
| [03-history-and-compaction.md](03-history-and-compaction.md) | 事件溯源、`deriveMessages()`、压缩与修剪、token 计量、KV cache |
| [04-control-and-extension.md](04-control-and-extension.md) | 谁决定、作用域与遮蔽、子 agent 继承、修改清单与常见坑 |
| [appendix-file-map.md](appendix-file-map.md) | 关键文件/行号索引、日志解码脚本、术语表 |

---

## 建议阅读路线

- **只想搞懂原理**：`01` → `02` → `03`
- **想动手改**：`04` → `appendix`（查路径和行号）
- **想验证我有没有说错**：直接看 `appendix-file-map.md` 里的解码脚本，解本会话日志

---

## 版本与时效声明

- 行号对应 `0.2.2-rc.1` 的编译产物，升级后**一定会漂移**；文件名和包名相对稳定。
- 标注「已验证」的条目，是我在本机日志或编译产物里直接看到的；标注「据 README」的条目，来自包文档的说明，未逐行读实现。
- 本机是 npm 安装态，看不到 `src/*.ts`，只能读 `lib/index.js`（编译后）与 `README.zh.md`。
