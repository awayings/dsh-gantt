# 附录 · 文件地图与取证方法

> 所有路径基于 DSH `0.2.2-rc.1` 本机安装态（`/data/app/node_modules/@deepseek-ai/`）。
> 行号会随版本漂移，包名与文件名相对稳定。

---

## 一、关键包一览

| 包 | 职责 | 入口 |
|---|---|---|
| `dsh-system-prompt` | 段/上下文/变量/工具 schema 的注册表与组装 | `lib/index.js` |
| `dsh-agent-loop` | 轮次与步骤驱动、inbox、请求组装、运行时快照 | `lib/index.js` |
| `dsh-session` | 事件日志、表面投影、`deriveMessages()` | `lib/index.js` |
| `dsh-agent-instructions` | `AGENTS.md` / `CLAUDE.md` 分层加载 | `lib/index.js` |
| `dsh-tool-skill` | skill 目录消息 + `skill` 工具 | `lib/index.js` |
| `dsh-skill-filesystem` | 从磁盘发现 skill、监视根目录 | `lib/index.js` |
| `dsh-time-context` | 每步注入时间快照 | `lib/index.js` |
| `dsh-compaction` | 压缩的抽象约定（接口/标记/锁） | `lib/index.js` |
| `dsh-compaction-basic` | 默认压缩后端（摘要 + 阈值） | `lib/index.js` |
| `dsh-token-meter` | 回放式 token / 压力计量 | `lib/index.js` |
| `dsh-tool-subagent` / `dsh-subagent-*` | 子 agent（spawn / fork） | `lib/index.js` |
| `dsh-web-app` | Web 组合 + agent preset | `presets/standard.patch.yml` |
| `dsh-memory-evolve`（第三方） | 记忆/待办/技能管理 | `lib/index.js` |

---

## 二、行号索引（已验证）

| 位置 | 内容 |
|---|---|
| `dsh-system-prompt/lib/index.js:10` | `SECTION_ORDERS`（段顺序表） |
| `dsh-system-prompt/lib/index.js:46` | `CONTEXT_ORDERS`（运行时上下文顺序表） |
| `dsh-system-prompt/lib/index.js:138` | `joinContextSections()` |
| `dsh-system-prompt/lib/index.js:153` | `renderContextSections()` |
| `dsh-agent-loop/lib/index.js:666` | `preStep()`：领取 → 解析工具 → assemble → waterfall |
| `dsh-agent-loop/lib/index.js:297` | `RuntimeContextProjection`（快照变更检测/追加） |
| `dsh-agent-loop/lib/index.js:843` | `refreshContext()` 后的快照刷新 |
| `dsh-agent-instructions/lib/index.js:961` | 构造 `agent-instructions` 消息 |
| `dsh-agent-instructions/lib/index.js:1480` | `agent/pre-step` 基线组合 |
| `dsh-tool-skill/lib/index.js:896` | `agent/pre-step`（目录注入） |
| `dsh-tool-skill/lib/index.js:985` | 构造 `skill-catalog` 消息 |
| `dsh-time-context/lib/index.js:249` | `agent/pre-step`（时间快照） |
| `dsh-compaction-basic/lib/index.js:15` | `thresholdRatio = 0.8` / `retainRatio = 0.16` |
| `dsh-compaction-basic/lib/index.js:839` | `agent/pre-step` 压力检查 |
| `dsh-web-app/cordis.patch.yml:19` | `personaPrefix`（`{{model}}` 那行） |
| `dsh-web-app/presets/standard.patch.yml:15` | `agent-instructions`（`maxBytes: 65536` 在 18 行） |
| `dsh-memory-evolve/lib/index.js:1694` | 注册 `memory:snapshot` 上下文 |

---

## 三、解会话日志（取证脚本）

会话日志是 zstd 压缩的 JSONL。Node 22+ 自带 zstd 解压：

```bash
node -e '
const fs = require("fs"), z = require("zlib");
const p = "/data/dsh-home/sessions/--data-home-ws--/session-<ID>/session.v4.jsonl.zstd";
const lines = z.zstdDecompressSync(fs.readFileSync(p)).toString("utf8").split("\n").filter(Boolean);
for (const l of lines) {
  const e = JSON.parse(l);
  if (e.type === "user/message") console.log(e.seq, "USER", e.data.source.kind, e.data.source.form || "");
  else if (e.type === "system/message") console.log(e.seq, "SYSTEM", JSON.stringify(e.data.message).length, "bytes");
  else if (e.type === "request/header") console.log(e.seq, "HEADER", e.data.tools?.length, "tools");
  else if (e.type.startsWith("compaction/")) console.log(e.seq, e.type);
}
'
```

按项目目录分桶：`sessions/<cwd 转义>/session-<uuid>/`，例如 `/data/home/ws` → `--data-home-ws--`。

### 只想看「谁注入了什么」

```bash
node -e '
const fs=require("fs"),z=require("zlib");
const p=process.argv[1];
const lines=z.zstdDecompressSync(fs.readFileSync(p)).toString("utf8").split("\n").filter(Boolean);
for(const l of lines){const e=JSON.parse(l);
  if(e.type==="user/message" && e.data.source.kind!=="user"){
    console.log("\n#",e.seq,e.data.source.kind);
    console.log((e.data.source.sections||[]).map(s=>" - "+s.name).join("\n"));
  }}
' /path/to/session.v4.jsonl.zstd
```

---

## 四、常用排查命令

```bash
# 段顺序表
sed -n '10,60p' /data/app/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js

# 某个插件注册了哪些 section / context
grep -rn "systemPrompt.section\|systemPrompt.context" <package>/lib/index.js

# 谁在 pre-step 加料
grep -rln "agent/pre-step" /data/app/node_modules/@deepseek-ai/*/lib/index.js

# 本机 profile 装了什么
cat /data/dsh-home/profiles/web/package.json
cat /data/dsh-home/profiles/web/cordis.patch.yml

# 当前 agent 的组合
cat /data/app/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml

# 记忆文件
ls -R /data/dsh-home/memories
```

---

## 五、术语表

| 术语 | 含义 |
|---|---|
| **section（段）** | 系统提示词的一段有名字、有 order 的文本 |
| **context（上下文）** | 会物化成 user 消息的动态快照（cwd、沙箱、时间、记忆…） |
| **surface（表面）** | 从事件日志派生的有序消息视图，模型只看到它 |
| **surfaceOp** | 表面事件的操作：`append` 或 `replace {startSeq,endSeq}` |
| **assemble()** | 把注册的段/上下文/变量/工具合并成一次提示词 |
| **waterfall** | 中间件链，监听器可改写组装结果（`agent/pre-step`、`system-prompt/assemble`） |
| **complete section** | 声明自己就是完整提示词，组装后它会独占整份提示词 |
| **compaction** | 把最旧的一平衡区间换成一条 `<compacted-summary>` 消息，日志保留原文 |
| **pressure** | token 计量得出的「当前请求占窗口的比例」 |
| **request/header** | 会话日志里记录本次请求 provider/model/tools 的事件 |
| **spawn / fork** | 子 agent 的两种起点：全新会话 / 复制父级已完成轮次 |
| **baseline** | 首次请求注入的 AGENTS.md 基线消息（带 `source.baseline = true`） |

---

## 六、延伸阅读（包内文档）

```text
dsh-system-prompt/README.zh.md            组装规则、工具顺序、抑制器
dsh-agent-loop/README.zh.md               轮次/步骤、请求 header、失败与取消
dsh-session/README.zh.md                  事件溯源、表面、deriveMessages
dsh-agent-instructions/README.zh.md       指令链、预算、动态发现
dsh-compaction/README.zh.md               压缩约定、锁、标记对
dsh-compaction-basic/README.zh.md         阈值、保留、摘要机制
dsh-token-meter/README.zh.md              计量语义与近似误差
dsh-skill-filesystem/README.zh.md         skill 根目录与优先级
dsh-subagent-fork-in-process/README.zh.md fork 的继承边界
```
