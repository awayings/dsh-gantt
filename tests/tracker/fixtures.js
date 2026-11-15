// A miniature tracker workspace in the same shapes as the real one: a
// future-7-day board with decorated headings and a `||` table, the TREE tables,
// and one dated daily card. Tests and the e2e spec share it.
import fs from 'node:fs'
import path from 'node:path'

export const SCHEDULE_MD = `# 滚动排期板（未来 7 天的时间格）

## 四、未来 7 天

> 窗口 = **11/14-11/20**（2026-11-13 复盘右移后的 7 天）。
> ⚠️ 记录断档说明：这几天的产出只能从 git 反推。

### 11/14 六 —— 周末（休市）· **主攻片（≥4h）**

| 时段 | 类 | 内容 | 落点 | 预估 |
|------|----|------|------|------|
| 09:00-09:30 | **A 主攻片** | **策略总账核对** —— 读六条策略进度 | \`invest/strategy-ledger.md\` | 30min |
| 09:30-12:00 / 14:00-17:00 | A 主攻片 | **\`1.8.1\` 一周读数收口** —— 回看 11/09-11/13 | \`easy_tdx\` | ≥4h |
| **21:00-22:00** | **③ 元能力格** | **认知输出补回** —— 写一条 wiki ⭐ | \`projects/zhangjing_wiki/\` | ≤1h |

### 11/15 日 —— 周末（休市）· **主攻片（≥4h）**

| 时段 | 类 | 内容 | 落点 | 预估 |
|------|----|------|------|------|
| 09:00-12:00 / 14:00-17:00 | A 主攻片 | **\`1.8.1\` 每日交易仓读数收口** —— 把这一周收成一张表 | \`easy_tdx\` | ≥4h |
| 21:00-22:00 | ③ 元能力格（灵感 \`#21\`） | **无人工干预的代码开发 补回** —— 列 1 条 | \`projects/ai-dev-efficiency.md\` | ≤1h |

### 11/16 一 —— 上班（工作日）· 交易日

| 时段 | 类 | 内容 | 落点 | 预估 |
|------|----|------|------|------|
| 08:00-10:00 | 固定 | 盘前决策流程 | \`invest/premarket.sh\` | 2h |
| 10:00-19:30 | 工作 | 工作任务（当天记） | — | — |
| 21:00-22:00 | 多元化格（灵感 \`#19\`） | **B 类 · 内容平台**：列 5 个可写选题 | \`projects/douyin-downloader\` | ≤1h |

### 11/19 四 —— 上班（工作日）· 交易日

|| 时段 | 类 | 内容 | 落点 | 预估 |
|------|----|------|------|------|
|| 08:00-10:00 | 固定 | 盘前决策流程 | \`invest/premarket.sh\` | 2h |
|| 21:00-22:00 | 多元化格 | **A 类 · 黄金存留**：\`#12\` 十年期黄金 | \`directions.md\` | ≤1h |

## 五、候选池

| 顺位 | 灵感 |
|------|------|
| 1 | \`#22\` |
`

export const TREE_MD = `# 任务地图

## 一、两条主干

> 说明性文字。

## 三、六条支线（脚本读取，勿改列序）

| id | 支线 | 组 | 优先级 | 状态 | 卡点 |
|---|---|---|---|---|---|
| 1 | 投资系统 | 赚钱 | 高 | 进行 | 6 条策略里 L5 = 0 |
| 2 | 打工 | 赚钱 | 高 | 卡住 | 黑名单只进不出 |
| 3 | 元能力 | 赚钱 | 中 | 进行 | 节点 ID 还没进 |

## 四、节点表（脚本读取，勿改列序）

> dep = 前置节点 id；空 = 可以立即开工。

| id | 支线 | 标题 | state | 起 | 止 | dep | done_when |
|---|---|---|---|---|---|---|---|
| 1.8 | 1 | 策略实盘化 | 进行 |  |  |  | ≥2 条进 L5 |
| 1.8.1 | 1 | S2 每日交易仓读数 | 未开始 | 2026-11-09 | 2026-11-15 |  | 每天一句读数 |
| 1.8.2 | 1 | S1 换标的后重算价格档 | 未开始 | 2026-11-16 | 2026-11-22 |  | 有新档位 |
| 1.9 | 1 | 中美资金流动态模型 | 进行中 | 2026-11-16 | 2026-12-13 |  | issue 补数据 |
| 2.3 | 2 | 运营管控视图整理 | 进行 | 2026-10-05 | 持续 |  | 在跑 |
| 5.2 | 5 | 下一次真实社交动作 | 未开始 |  |  | 5.1 | 有 1 次见面 |
| 1.1 | 1 | 数据底座 | 已过 | 2026-07-01 | 2026-09-30 |  | 表能查 |
`

export const DAILY_MD = `---
date: 2026-11-15
week: W46
---

# 2026-11-15（周日）

## 🎯 今天核心目标

> 一句话：把 \`1.8.1\` 这一周的读数收成一张表。

> 📣 播报：今天不开盘，上午收表，晚上列一条能交给 agent 跑的任务。
`

/**
 * Write the fixture files (optionally overriding some) below `dir`.
 * @param {string} dir
 * @param {Record<string, string>} [overrides]
 * @returns {string}
 */
export function writeTrackerFixture(dir, overrides = {}) {
  /** @type {Record<string, string>} */
  const files = {
    'SCHEDULE.md': SCHEDULE_MD,
    'TREE.md': TREE_MD,
    'daily/2026-11-15.md': DAILY_MD,
    ...overrides,
  }
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return dir
}
