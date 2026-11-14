# 02 · 三层知识：AGENTS.md / 记忆 / 技能

> DSH 里「让模型知道点什么」有三套机制，它们**互不重叠**，各管一层。

| 机制 | 管什么 | 注入方式 | 成本 |
|---|---|---|---|
| `AGENTS.md` 链 | 目录/仓库级约定（怎么改这个项目） | 首次请求**全量**注入，带预算 | 每次请求都付 |
| memory-evolve 记忆 | 跨会话事实（你是谁、项目定过什么） | 每轮渲染成 `memory:snapshot` 快照 | 每次请求都付 |
| skills | 任务级流程（怎么做某类事） | 只注入**名称+描述**目录，正文按需加载 | 目录常驻，正文按需 |

---

## 一、`AGENTS.md`：目录层级约定

对应包：`@deepseek-ai/dsh-agent-instructions`（`dsh-base` 默认启用）。
兼容 `CLAUDE.md`，所以从 Claude Code 迁过来可以直接复用。

### 加载顺序（从宽泛到具体）

```text
① $DSH_HOME/AGENTS.md                 本机 /data/dsh-home/AGENTS.md
② <agentsHome>/AGENTS.md              ~/.agents/AGENTS.md（本机 /data/home/.agents/）
③ <项目根>/AGENTS.md、CLAUDE.md        项目根 = 最近含 .git 的祖先
④ 项目根 → 会话 cwd 之间每一层目录的 AGENTS.md / CLAUDE.md
⑤ 每层再叠加 AGENTS.local.md / CLAUDE.local.md

（① ② 是「用户全局链」，③④⑤ 是「项目链」，两条链各自独立预算）
```

### 关键行为

- **预算**：每条链 64KB（`maxBytes: 65536`，见 `dsh-web-app/presets/standard.patch.yml:18`）。
  超预算时：先丢弃**较宽泛**的整个文件 → 再截断剩下的最后一个（最具体的）→ 最后退化成只有预算通知。
  会输出 `Workspace instruction budget ...` 通知，点名被省略/截断的路径。
- **去重**：`CLAUDE.md` 与 `AGENTS.md` 内容相同只渲染一次；共享根文件与 harness home 文件重复也会折叠。
- **动态发现**：**不监视文件系统**。是 `read` / `write` / `edit` 成功触达更深目录后，下一次请求把新适用的文件补进来；文件变了会替换内容，消失了会发移除通知，**内容没变绝不重复注入**。
- **失败即停**：项目根标记探测遇到权限/IO 错误会直接抛错，不会「猜一个祖先目录」。
- **注入形态**：带 `source.kind = "agent-instructions"` 的普通 `user/message`，包在插件控制的 `<system-reminder>` 框架里。
  所以它**可回放、可压缩、可恢复**，和普通历史同权。
- 指令内容里出现字面 `</system-reminder>` 会被转义，仓库作者无法提前关闭框架。

### 本机现状（已验证）

```text
/data/dsh-home/AGENTS.md      不存在
~/.agents/AGENTS.md           不存在
/data/home/ws/AGENTS.md       不存在
/AGENTS.md                    不存在
```

所以本会话**没有** AGENTS.md 基线消息。想要就新建 `/data/home/ws/AGENTS.md`，下一轮自动生效，无需改配置。

---

## 二、记忆（memory-evolve 插件）

> 注意：这**不是 DSH 核心**，是 profile 里装的第三方插件 `dsh-memory-evolve`。

### 五条轨

| 轨 | 存什么 | 存放位置 | 何时进上下文 |
|---|---|---|---|
| `user` | 用户档案（偏好、习惯） | 插件管理 | 每轮注入 |
| `memory` | 全局环境/项目事实 | 插件管理 | 每轮注入 |
| `key` | 项目关键记忆（约定/决策/架构/踩坑） | 项目 key 文件 | 每轮注入（可按 git 分支限定） |
| `project` | 项目日志（按工作目录隔离） | `/data/dsh-home/memories/projects/<hash>/MEMORY.md` | **按需**读取 |
| `daily` | 今日日志 | `/data/dsh-home/memories/daily/YYYY-MM-DD.md` | **按需**读取 |

### 注入机制

```js
ctx.systemPrompt.context({
  name: 'memory:snapshot',
  order: config.snapshotOrder,
  text: (context) => renderSnapshot(runtime, store, context.agent, ...),
})
```

源码：`dsh-memory-evolve/lib/index.js:1694`。

要点：

- 它是 **PromptContext（会物化成 user 快照）**，不是 system section。
- `text` 是**函数**，每次组装时读最新记忆 → 但物化时做**变更检测**，只有文本变了才追加消息，从而保住前缀缓存。
- 记忆正文会做 `{{...}}` 净化（`interpolate: false` 降级），否则记忆里写一个 `{{session}}` 就会让所有注入该轨的会话组装失败——这是插件踩过的真实坑（issue #53）。
- 写入走**待确认队列**：模型 `add` 只是建议，用户确认后才真正落盘并注入。

---

## 三、技能（skills）

对应包：`dsh-skill`（注册表）+ `dsh-skill-filesystem`（发现）+ `dsh-tool-skill`（注入目录 + `skill` 工具）。

### 目录与优先级

| Rank | 来源 | 路径 |
|---|---|---|
| 100 | project-dsh | `<项目根>/.dsh/skills` |
| 200 | project-agents | `<项目根>/.agents/skills` |
| 300 | custom | 配置的 `customSkillDirs` |
| 400 | user-dsh | `<dshHome>/skills` |
| 500 | user-agents | `<agentsHome>/skills` |
| 600 | bundled | `bundledSkillDir`（随包提供） |

本机实际用的是 `<agentsHome>/skills`，即 `/data/home/.agents/skills/`（`codex-cli-calling`、`grok-cli-calling`、`memory-consolidate` …）。

### 形态与加载

- 目录 bundle：`<name>/SKILL.md`，或平铺文件 `<name>.md`；**不支持**嵌套 `**/SKILL.md`。
- frontmatter 必填 `name`（kebab-case）与 `description`；可选 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`。
- **目录与正文分离**：发现阶段只解析 frontmatter 进目录；每次 `skill` 调用都重新读正文，所以改正文不需要缓存失效。
- **注入**：pre-step 里发一条 `source.kind = "skill-catalog"`、`form = "catalog"` 的 user 消息，内容包在 `<system-reminder>` 里（`dsh-tool-skill/lib/index.js:896` 起）。
- **按需加载**：模型看到的是 `- \`name\`: description` 列表；真正要用时调 `skill` 工具拿全文。
- 受监视根目录有变更（增删改名、frontmatter 变）会在下一个模型步骤刷新目录；`write`/`edit` 命中技能路径时立即失效。

### 为什么这样设计

技能可能几十上百个，正文全塞进去成本爆炸。目录（几十 token/个）+ 按需加载（一个 skill 一次几百到几千 token）是性价比最高的折中。

---

## 四、三者怎么配合

```text
AGENTS.md   →  这个仓库的规矩（怎么改）
memory key  →  这个项目的结论（改过什么、定过什么）
skills      →  这类任务的流程（按什么步骤做）
```

一个典型回合里，模型同时看到：系统提示词（工具说明）+ `memory:snapshot`（你是谁、项目定过什么）+ skill 目录（会哪些流程）+ AGENTS.md（仓库规矩）+ 历史消息。

---

## 五、本机现状速查

| 项 | 状态 |
|---|---|
| `$DSH_HOME/AGENTS.md` | ❌ 不存在 |
| `~/.agents/AGENTS.md` | ❌ 不存在 |
| `/data/home/ws/AGENTS.md` | ❌ 不存在（工作目录是空的） |
| 记忆 | ✅ `/data/dsh-home/memories/`（daily + projects/<hash>） |
| 技能 | ✅ `/data/home/.agents/skills/`（5 个） |
