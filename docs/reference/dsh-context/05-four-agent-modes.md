# 05 · DeepSeek Harness 四种 Agent 模式的实现区别

> **对象**：DeepSeek Harness（DSH）`0.2.2-rc.5`，本机 npm 安装态
> **安装路径**：`/data/app/node_modules/@deepseek-ai/*`
> **取证方式**：安装态 `presets/*.patch.yml`、各包 `README.md` / `src/` / `lib/`、包内 `docs/`，以及本会话自己的 session JSONL（zstd 解压后逐条核对事件）
> **成文时间**：2026-11-26
> **定位**：这是 `reference/` 下的内部学习笔记，不是 `dsh-gantt` 的插件文档，也不是兼容性契约。行号对应安装态版本，升级后一定会漂移。事实以安装态源码为准；与本文冲突时以源码为准。

---

## 0. 先厘清「四种模式」是什么

DSH 里有好几个叫「mode」的东西，写文档前必须分清，否则会各说各话：

| 名称 | 归属 | 是什么 | 本文是否讨论 |
| --- | --- | --- | --- |
| **Agent preset（模式）** | Web profile 的 browser session | `standard` / `ptc` / `minimal` / `cordis`（UI 里叫 Creator）四个随发行版交付的 agent 组合；每个 session 选一个，默认 `standard` | **本文主题** |
| Plan mode | agent 会话状态 | `plan:policy`（order 500）软规则 + `exit_plan_mode` 工具；标准/Creator/PTC 三个 preset 都挂载了 `dsh-plan-mode`，但它不是「第四种模式」 | 只在模式内部说明 |
| PTC mode | 工具执行方式 | `run_code` 单入口 + SDK 生成代码再调工具；`ptc` preset 是它最常见的载体，但 PTC 本身是 ToolExecutor 选择，不等于 preset | 第 3 节详述 |
| Team mode | 会话功能开关 | `agent-team`，由 patch 开启，与 preset 正交 | 不讨论 |

preset 的权威定义在四份文件里（按 bundle patch 顺序插入）：

```text
/data/app/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml   id=standard  order=1
/data/app/node_modules/@deepseek-ai/dsh-web-app/presets/ptc.patch.yml        id=ptc       order=2
/data/app/node_modules/@deepseek-ai/dsh-web-app/presets/minimal.patch.yml    id=minimal   order=3
/data/app/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml     id=cordis    order=4  (UI: Creator)
```

注意：**Web 编辑器里保存的改动会按 id 覆盖 profile patch（`profiles/web/cordis.patch.yml`）中的 `config.plugins`**，所以线上实际工具集可能与上面四份文件不同。排查时一定要看该会话 `request/header` 里的真实 tools，不能只看 preset 模板。

---

## 1. 实现载体：preset 本身不改提示词

先讲共同机制，否则四份 YAML 看起来像四份菜单，实际差别藏在插件里。

### 1.1 preset 是一个声明 + 一棵作用域插件树

`@deepseek-ai/dsh-agent-preset` 的 `AgentPreset` 类（`src/index.ts:12-29`）只做一件事：把 `config`（`id` / `order` / `plugins`）注册到 `ctx.agentPresets`。registry 为每个声明建一个自有 scope 和内存 Loader tree（`dsh-agent-preset-registry/README.md:56`），会话选中某个 preset 后就绑定到那棵树的 composition。registry README:85/89 明确写着：preset 自己**不直接**产生任何模型可见的工具或提示词段，一切来自它的 `plugins` 子项。

`plugins` 里的 `cordis:group` + `isolate:` 是**服务隔离组**，不是提示词分组：

- `isolate: {planMode: true}` / `{compaction: true, toolResultPruner: true}` / `{workflowEngine: true}` / `{terminals: true}` 中的 `true` 表示 entry-local realm（键为 `条目id#entryId`），见 `cordis-plugin-loader/src/config/isolate.ts:25-89`。
- 目的是让同一服务（如 `compaction`、`workflowEngine`）的不同实现互不串线。它不改变段的 order，也不影响模型看到什么文本。

### 1.2 提示词与上下文的四条通道（复习）

沿用 [01-context-pipeline.md](01-context-pipeline.md) 的框架：一次请求的模型输入 = **一个 `system/message`（按 order 升序拼接的段）+ `request/header.tools` + 若干带 source 的 `user/message`（运行时上下文 / 技能目录 / AGENTS.md / 记忆 / 时间）+ 事件日志派生的历史**。没有 wire 上的 `system` 字段。

四模式之间的差别，可以精确落到这四条通道上：

1. **段**：几乎只有 `persona` 的 prefix（order 0）和 suffix（order 10200）会变；`minimal` 用 `complete: true` 把整份提示词替换成这一句。
2. **工具 schema**：由 `plugins` 列表决定，是四模式差别最大的地方。
3. **上下文**：`minimal` 用 `includeRuntimeContext: false` 关掉可选上下文；其余模式保留（含 memory snapshot、gantt:focus 等）。
4. **历史 / 压缩**：`standard`/`cordis`/`ptc` 有 compaction + tool-result-pruner；`minimal` 只有 compaction，没有 pruner。

### 1.3 `persona` 的三个开关

配置 schema 在 `dsh-persona/src/index.ts:49-54`，实现在 `:62-75`，语义在 `README.md:40-49`：

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `prefix` | 必填 | 注册 `deployment:persona-prefix`，**order 0**，覆盖 deployment 全局默认；`{{model}}` 在渲染时严格插值 |
| `suffix` | `''` | 注册 `deployment:persona-suffix`，**order 10200**；preset 里省略即空段，会遮蔽全局 suffix（写入空串的段渲染时消失） |
| `complete` | `false` | `true` 时 waterfall 之后把该 prefix 恢复为**唯一**的提示词段：身份句、工具说明、环境段、监听器追加全部消失 |
| `includeRuntimeContext` | `true` | `false` 时调用 `suppressRuntimeContext()`：只保留 `required` 的上下文（cwd、sandbox/approval、subagent identity 等），memory/skill catalog/time 这类可选上下文不再求值 |

`complete: true` 和 `includeRuntimeContext: false` 是两个独立开关，常有人以为是一回事：前者管系统段，后者管 user 快照。

---

## 2. `standard`（默认模式）：完整编码 agent

### 2.1 提示词（系统段）

`standard.patch.yml:11-14` 的 persona prefix：

```yaml
prefix: You are a coding agent powered by the {{model}} model.
```

渲染后的系统消息（本会话实测，session JSONL 的 `system/message`，仅列骨架）：

```text
-1000  You are an AI agent powered by DeepSeek Harness.          # harness 身份
    0  You are a coding agent powered by the <model> model.      # preset persona
  500  plan:policy（仅 plan mode 激活时）
  900  @ 路径引用规则
 1000+ 各工具说明段：bash / read / write / edit / glob / grep / jobs /
        web search+fetch / goal / schedule / workflow / subagent / MCP servers
10000  harness 源码路径
10100  Web GUI URL
10200  persona suffix（此处为空 → 消失）
```

段顺序常量见 `dsh-system-prompt/src/index.ts:136-186`（`SECTION_ORDERS`），升序拼接，同 order 按 name 的 code-unit 排序。工具说明段是「有哪些工具」的副产品：某个工具在 `tools.resolve()` 里可见，其 `sections` 才会进 node 0；所以 `standard` 的系统提示词明显比 `minimal` 长。

### 2.2 最终上下文组织（本会话实测）

本会话（`standard`）session JSONL 的真实事件序列：

```text
seq 9    user/message  runtime-context
           sections: working-directory:current(100), sandbox:policy(110),
                     approval:policy(115), subagent:identity(120),
                     harness:source(200), app:web-surface(210), memory:snapshot
seq 10   user/message  skill-catalog       # <available_skills>，含 dsh-doc
seq 11   user/message  time-context
seq 12   request/header  tools: 41 个（bash/read/edit/grep/glob/web_fetch/
                                   subagent/workflow/plugin_manager/...）
seq 65   user/message  agent-instructions  # AGENTS.md 链，首次触达目录时插入
...
```

顺序原因是 `agent/pre-step` waterfall 的层级：runtime-context 的 fallback 在最内层，skill catalog 和 time snapshot 依次包在外面，AGENTS.md 在更外层的用户消息。上下文快照只在渲染文本变化时追加新的一条，旧快照留在历史里 —— 这是 KV cache 前缀稳定的关键（见 [03-history-and-compaction.md](03-history-and-compaction.md)）。

### 2.3 工具与能力（`standard.patch.yml`）

| 组 | 包含 |
| --- | --- |
| 基础 | `bash`（非 Win）/ `pwsh`（Win）、`read/write/edit/glob/grep`（`applyPatch: false`）、`jobs`、`schedule` |
| 知识 | `agent-instructions`（64KB 链）、`time-context`、`skill-filesystem`（`customSkillDirs` 指向 preset 包的 `skills/` → `dsh-doc`）、`tool-skill` |
| 规划 | `planning` group：`plan-mode`（`plan:policy`, order 500）+ `exit_plan_mode` |
| 压缩 | `compaction-basic` + `command-compact` + `tool-result-pruner`（8192/4096/1024） |
| 委派 | `subagent`(spawn)、`subagent_fork`、`workflow`、`tool-subagent-control`（`interrupt: false`） |
| 交互/产出 | `ask_user_question`、`todo`、`web`（fetch + search）、`present` |
| 文档 | `tool-office`（`office_convert/recalculate/render`，技能加载后渐进出现） |
| 插件 | `plugin_manager`：仅当 Host 提供可编辑 profile 时启用；`plugin_market`：**hard disabled** |

### 2.4 适用特点

默认的「什么都给你」模式：文件读写 + shell + web + 子 agent + workflow + 计划模式 + 压缩。适合日常编码、多步实现、需要委派或大规模编排的任务。代价是工具 schema 和系统段最长，每步请求前缀最大。

---

## 3. `ptc`：把工具调用收进 `run_code`

### 3.1 实现机制

`ptc.patch.yml` 与 `standard` 共享绝大部分插件（persona prefix 相同、plan/compaction/delegation 组相同、tools/goal/schedule/web/todo/present/office 相同），关键差异是**把工具执行器换掉**：

- 挂载 `@deepseek-ai/dsh-tool-executor-ptc`（`ptc.patch.yml:127-128`），并且 `workflow-ptc` 与 `tool-workflow` 被 `disabled: true`（`:108-115`）。
- `skill-filesystem` 在 PTC preset 里**没有** `customSkillDirs`（`:40-41`），即不带 `dsh-doc`；其他技能来源照旧。
- `plugin_manager` / `plugin_market` 都 hard disabled（`:133-138`）。

`dsh-tool-executor-ptc/src/index.ts:15-50` 的实现要点：

- 注册两个系统段：`tools:ptc-only`（order 800，`PTC_ONLY_INSTRUCTION`：`run_code` 是唯一可直接调用的工具）和 `tools:sdk`（order 5000，把当前可见工具的 schema 渲染成该语言的 SDK 声明）。
- `describe()` 只暴露一个 `run_code` transport schema；模型直接调用任何别的工具名都会在 pipeline 的 `reject` 里得到 `ToolNotFoundError`。
- 所有子调用通过 `ToolExecutionPipeline` 执行，携带父 token，事件 id 形如 `<parent>:ptc:<n>`；调用/结果保持相邻，子调用不携带 `additionalContexts`（`docs/tool-execution-pipeline.md:64`）。
- SDK 文本由 `ts-types.ts:250-273,300-335` / `py-types.ts:733` 生成：固定的「## Writing code for run_code」说明 + 按字典序排列的 `declare const tools` 接口；说明里写明 `await tools.name(args)`、失败会 reject `ToolCallError`、只读调用可以用 `Promise.all` 并发而写操作按提交顺序独占，中间结果不进会话。
- 子调用的中间值只在执行环境里，不进 session 历史；只有外层 `run_code` 的结果有硬大小上限。图片类结果以 `source.kind: 'ptc-mode'` 的 user 消息延后送达（`ptc.ts:612-617`）。
- 调用额度：`maxSubCallsPerMinute` 默认 1024，每次 `run_code` 的额度 = `floor(timeoutMs/60000 × 1024)`（默认 2 分钟 → 2048），耗尽即整段程序失败（`dsh-tool-executor-ptc/README.md:37-39`）。根 `run_code` 独占串行，程序内并行安全子调用最多 10 个。
- 运行时默认每次全新环境；Node REPL / Script + `scriptPersistence: true` 可保留变量，重置靠 host 的 `reset(agent)`，不是模型工具（README:67-69）。

### 3.2 提示词与最终上下文

model 端看到的是（README:90-95）：**一个 `run_code` schema + SDK 使用说明 + 一段完整的 SDK 声明**。系统段里 `PTC_ONLY` 在 order 800、`TOOLS_SDK` 在 order 5000，即「先告诉你只能调 `run_code`，再告诉你每个工具怎么写代码调」。工具说明段（bash/read/... 那些 order 1000-3000）不再作为独立工具 schema 出现，而是被编译进 SDK 文本；工具名在模型侧是「program-only bindings」。

上下文组织与 `standard` 基本一致（persona 未变、可选上下文未关），历史里多的是一条条 `run_code` 调用及其结果，内部子调用只以 `tool/ptc-dispatch` 事件存在。

### 3.3 token / cache 效果（别把它神化）

`dsh-tool-executor-ptc/README.md:123-127` 写得很坦白：这是**用工具 schema 换 SDK 文本 + 一个 transport schema**，并不保证普遍省 token。固定成本与可见定义数量成正比；额度诊断只在失败时贡献 token。KV cache 在「PTC 选择、生成的 SDK、transport schema、可见工具集」都不变时稳定；模式或过滤器一变，从第一个变化的 token 起失效。

### 3.4 适用特点

- 适合**一次需要跨多个工具、但不想把每个工具调用都作为独立 assistant 消息发回模型**的场景：批量检索、循环处理、中间值不需要进入历史。
- 不适合需要逐工具审批/可视化的场景：真实工具调用藏在程序里，只有外层结果可见；额度耗尽会整体失败。
- 注意：PTC preset 禁用了 workflow 工具，但可通过 `run_code` 内调其他工具；`subagent` / `subagent_fork` 仍在（delegation 组未删）。

---

## 4. `minimal`：固定人格 + 持久 shell

### 4.1 提示词（与其他模式最不同）

`minimal.patch.yml:11-16`：

```yaml
persona:
  prefix: You are a helpful software engineer assistant.
  complete: true
  includeRuntimeContext: false
```

这意味着：

- 整份系统提示词**只有**这一句。没有 harness 身份句、没有工具说明段、没有环境段（`harness:source` / `app:web-surface`）、没有 `@` 路径引用规则，也没有任何监听器能往 node 0 里追加文本（`dsh-persona/README.md:49`）。
- 可选运行时上下文全部不注册值：`memory:snapshot`、`gantt:focus`、skill catalog、time-context 都不会出现。**required 上下文仍保留**：cwd、sandbox、approval、subagent identity（`README.md:99`）。

最终上下文组织因此非常薄：

```text
node 0  system: You are a helpful software engineer assistant.
user    runtime-context（仅 required：working-directory / sandbox / approval / subagent identity）
user    本轮用户消息
（tool 调用与结果按需追加）
```

这对 `dsh-gantt` 尤其重要：`minimal` 下 `gantt:protocol`（系统段）被 `complete` 吞掉，`gantt:focus`（可选上下文）被 `suppressRuntimeContext()` 抑制，**Gantt 插件的零配置上下文注入在 minimal 模式下不生效**。这不是 bug，是 persona 语义。

### 4.2 工具与机制

`minimal.patch.yml` 只有三组插件：

| 组 | 内容 |
| --- | --- |
| persona | 上述三个开关 |
| `tool-fs` | `read: false, readImage: true, write: false, edit: false` —— 只有读图，没有文件读写/编辑 |
| `compaction` | `compaction-basic` + `command-compact`，**没有** tool-result-pruner |
| `persistent-shell`（`isolate: {terminals: true}`） | `pty` + `terminal-bash` + `persistent-bash`（timeout 300000，自定义 description），Win 上换成 `terminal-pwsh` + `persistent-pwsh` |

持久 shell 的语义（`dsh-tool-bash-persistent/README.md:12,28-34,57`）：每个 agent 一个隔离 shell，cwd / 导出变量 / 函数 / 后台任务跨调用保留，同一 agent 的命令串行；`exit`、超时、取消都会**重置** shell（不是修复），结果末尾附 `[Command finished with exit code N]`，长输出保留前段 + 裁剪提示。shell 是进程内状态，**harness 重启后不保留**。模型只能通过这个 shell 间接读写文件（`sed -n 10,25p ...` 这类方式）。

自动压缩（`dsh-compaction-basic/README.md:10-12,68-78`）：默认在模型窗口 80% 压力（`headroomTokens: 65536`）时把最旧的一段平衡历史换成一条 `<compacted-summary>` user 消息，尾部原文保留；`/compact` 可手动触发。压缩动不了系统提示词和工具 schema，也不会拆开工具调用/结果的配对。

### 4.3 适用特点

- 适合**「给我一个终端，让我自己搞定」**的轻量场景：一次性脚本、环境验证、快速探针；提示词极短，KV 前缀非常稳。
- 不适合：需要结构化文件编辑、跨会话记忆、技能加载、子 agent / workflow、任务树协议注入的工作流。本插件（`dsh-gantt`）的功能在 minimal 下基本不可用。
- 注意：`persistent-bash` 的 description 是 preset 手写的长文本（含 `sed -n` 用法提示等），它出现在 `request/header.tools` 的 schema 里，不在系统段里。

---

## 5. `cordis`（UI: Creator）：为「改 DSH 本身」而生

### 5.1 与 standard 相同的部分

- plan / compaction + pruner / delegation 三组参数逐字相同（`cordis.patch.yml:47-84` vs `standard.patch.yml:51-88`）。
- 基础工具集相同：`agent-instructions`(64KB)、`time-context`、bash/pwsh、`tool-fs`（`applyPatch: false`）、`fs-search`、`jobs`、`schedule`、goal、ask-user、todo、web、`present`。
- `skill-filesystem` 的 `customSkillDirs` 同样指向 preset 包里的 `skills/` → `dsh-doc`（`cordis.patch.yml:126-131`）。两者都把 `dsh-doc` 列进技能目录，但 cordis 才具备 `cordis_inspect_*` 这条「先看运行时事实」的通道。

### 5.2 三处关键差异

1. **persona prefix 多一句**（`cordis.patch.yml:15-17`）：

   ```text
   You are a coding agent powered by the {{model}} model.
   You help the user customize DeepSeek Harness itself.
   ```

   只在 order 0 多一句固定文本；后续段、工具 schema、上下文组织与 standard 相同。KV 前缀只要不切换 preset 就稳定（`dsh-web-app/README.md:173-185`）。

2. **多 `tool-cordis`**（`:124-125`）→ `cordis_inspect_list` + `cordis_inspect_query`：只读的运行时检查工具。Host runner 提供 registry；Client 查询需要已连接的页面；不能调用业务服务、不能改运行时（`docs/tool-catalog.md:30,944-999`）。这是 `dsh-doc` 技能推荐的第一条取证路径（`SKILL.md:12-16`）。

3. **`plugin_market` 不再 hard disabled**（`:138-140`）：与 `plugin_manager` 一样受 `!!js "!ctx.get('profileContext')"` 门控，只有 Host 提供可编辑 profile 时才启用。standard 里 `plugin_market` 是 `disabled: true`。

   另外：**`tool-office` 在 cordis preset 里没有挂载**（对比 standard `:130-131`、ptc `:131-132`），所以 Creator 默认没有 Office 三件套。

### 5.3 适用特点

适合「安装/调试插件、改 composition、升级 DSH」这类工作：人格上声明自己在改 harness，工具上多出运行时检查与插件市场，`dsh-doc` 技能把实现与授权规则按需加载（`docs/user/develop/practice/dynamic-cordis.md:5`）。代价是比 standard 多两个工具的 schema 与一段固定 persona。

---

## 6. 四模式对照表

| 维度 | standard | ptc | minimal | cordis (Creator) |
| --- | --- | --- | --- | --- |
| persona prefix | coding agent + `{{model}}` | 同 standard | `You are a helpful software engineer assistant.` | 同 standard + `customize DeepSeek Harness itself.` |
| `complete` / `includeRuntimeContext` | false / true | false / true | **true / false** | false / true |
| 系统提示词 | 完整：身份 + 工具说明 + 环境 | 完整 + `PTC_ONLY`(800) + `TOOLS_SDK`(5000) | **仅一句 persona** | 完整，多一句 persona |
| 工具入口 | 每个工具各自 schema | **只有 `run_code`**；工具在 SDK 里 | `bash`（持久）+ `read_image` | 同 standard + `cordis_inspect_*` + `plugin_market` |
| 文件读写 | read/write/edit（无 apply_patch） | 同 standard，经 SDK 调用 | **无**（仅 read_image） | 同 standard |
| skill catalog | `dsh-doc`（customSkillDirs） | 默认来源，**无 dsh-doc** | **无技能** | `dsh-doc`（customSkillDirs） |
| plan mode | 有 | 有 | 无 | 有 |
| compaction / pruner | 有 / 有 | 有 / 有 | 有 / **无** | 有 / 有 |
| subagent / workflow | 有 / 有 | 有 / **无 workflow** | 无 / 无 | 有 / 有 |
| plugin_manager / market | 条件启用 / 禁用 | 禁用 / 禁用 | 无 / 无 | 条件启用 / 条件启用 |
| Office 工具 | 有 | 有 | 无 | **无** |
| 可选运行时上下文 | 全部 | 全部 | **仅 required** | 全部 |
| 对 `dsh-gantt` 的影响 | 完整（协议段 + focus 快照 + 六工具） | 完整（工具经 `run_code` 间接调用） | **协议与 focus 均被抑制** | 完整 |

「条件启用」= `disabled: !!js "!ctx.get('profileContext')"`，即只有 dsh 启动的、带可编辑 profile 的 Host 才给。

---

## 7. 怎么自己验证（别只信 preset 模板）

1. **看模板**：`dsh-web-app/presets/<id>.patch.yml`；profile 的实际覆盖在 `$DSH_HOME/profiles/web/cordis.patch.yml`。
2. **看真实请求**：解压该会话的 `session.v4.jsonl.zstd`（脚本见 [appendix-file-map.md](appendix-file-map.md)），查：
   - `system/message` 的 content 文本（确认 persona / complete / 段集合）；
   - `request/header` 的 `header.tools`（确认这一步真正下发了哪些工具 schema）；
   - `user/message` 的 `source.kind`（`runtime-context` / `skill-catalog` / `time-context` / `agent-instructions` / `memory` 等）及其 `sections[].name`。
3. **看模式绑定**：session 保存的是 preset id，切换 preset 只影响之后的操作；已有 session 保留自己的 composition（`dsh-agent-preset-registry/README.md:56`）。
4. **改 preset 的方式**：Web 的 Agent presets 设置页写入 profile patch（按 id 覆盖 `config.plugins`），或直接改 bundle 的 preset patch。二者都会影响之后的会话；不要指望正在跑的会话即时变化。

### 已知坑（与本文直接相关）

- `docs/tool-catalog.md:34` 声称 Web `standard` 启用 `apply_patch`，但本机 `standard.patch.yml:29-31` 明确 `applyPatch: false`。以 preset patch 为准。
- 同名段重复注册会抛错；`toolOrder` 必须恰好有一个 `<unlisted-tools>` 占位；未知 `{{variable}}` 会让组装直接失败（见 [04-control-and-extension.md](04-control-and-extension.md) 第六节）。
- KV cache 前缀对任何系统段变化敏感；切换 preset（尤其进出 `minimal`）会让缓存从 node 0 起全部失效。
- 本文的行号对应 `0.2.2-rc.5`；`0.2.2-rc.1` 的旧笔记（本目录 00–04 号文件）里的行号已漂移，但四通道框架与段顺序表仍适用。
