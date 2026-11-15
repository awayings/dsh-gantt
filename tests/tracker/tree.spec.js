import { describe, expect, it } from 'vitest'
import { parseTree } from '../../src/host/tracker.js'
import { TREE_MD } from './fixtures.js'

const TRACK_HEADER = '| id | 支线 | 组 | 优先级 | 状态 | 卡点 |\n|---|---|---|---|---|---|'
const NODE_HEADER = '| id | 支线 | 标题 | state | 起 | 止 | dep | done_when |\n|---|---|---|---|---|---|---|---|'

/** @param {string} body */
function withTracks(body) {
  return `# 任务地图\n\n## 三、六条支线（脚本读取，勿改列序）\n\n${body}`
}

/** @param {string} body */
function withNodes(body) {
  return `# 任务地图\n\n## 三、六条支线（脚本读取，勿改列序）\n\n${TRACK_HEADER}\n\n## 四、节点表（脚本读取，勿改列序）\n\n${body}`
}

describe('parseTree', () => {
  it('parses the track and node tables', () => {
    const { tracks, nodes } = parseTree(TREE_MD)
    expect(tracks).toEqual([
      { id: '1', name: '投资系统', lane: '赚钱', priority: '高', state: '进行', blocker: '6 条策略里 L5 = 0' },
      { id: '2', name: '打工', lane: '赚钱', priority: '高', state: '卡住', blocker: '黑名单只进不出' },
      { id: '3', name: '元能力', lane: '赚钱', priority: '中', state: '进行', blocker: '节点 ID 还没进' },
    ])
    expect(nodes).toHaveLength(7)
    expect(nodes[0]).toEqual({ id: '1.8', trackId: '1', title: '策略实盘化', state: '进行', startDate: null, endDate: null, dep: '', doneWhen: '≥2 条进 L5' })
    expect(nodes[1]).toEqual({ id: '1.8.1', trackId: '1', title: 'S2 每日交易仓读数', state: '未开始', startDate: '2026-11-09', endDate: '2026-11-15', dep: '', doneWhen: '每天一句读数' })
    expect(nodes[2]).toMatchObject({ id: '1.8.2', startDate: '2026-11-16', endDate: '2026-11-22' })
    expect(nodes[3]).toMatchObject({ id: '1.9', state: '进行中' })
    expect(nodes[4]).toMatchObject({ id: '2.3', startDate: '2026-10-05', endDate: null })
    expect(nodes[5]).toMatchObject({ id: '5.2', startDate: null, endDate: null, dep: '5.1' })
  })

  it('strips markdown decoration from titles and skips prose before the table', () => {
    const text = withNodes([
      '一段说明文字。',
      '',
      NODE_HEADER,
      '| 1.5 | 1 | 重点 ETF 资金看板 `#492` | 已过 | 2026-11-02 | 2026-11-08 |  | 页面 **上线** |',
    ].join('\n'))
    const { tracks, nodes } = parseTree(text)
    expect(tracks).toEqual([])
    expect(nodes[0]).toMatchObject({ title: '重点 ETF 资金看板 #492', doneWhen: '页面 上线' })
  })

  it('keeps unknown states verbatim and degrades invalid date cells to null', () => {
    const text = withNodes([
      NODE_HEADER,
      '| 9.1 | 9 | 怪状态 | 评审中 | 2026-02-30 | 2026-13-01 |  |  |',
      '| 9.2 | 9 | 破折号 | 撤销 | — | - | 9.1 |  |',
    ].join('\n'))
    const { nodes } = parseTree(text)
    expect(nodes[0]).toMatchObject({ state: '评审中', startDate: null, endDate: null })
    expect(nodes[1]).toMatchObject({ startDate: null, endDate: null, dep: '9.1' })
  })

  it('skips duplicated and incomplete track rows, notes, and separators', () => {
    const text = withTracks([
      '> 一段说明。',
      '',
      TRACK_HEADER,
      '| 1 | 投资系统 | 赚钱 | 高 | 进行 |  |',
      '| 1 | 重复支线 | 赚钱 | 高 | 进行 |  |',
      '|  | 没有 id | 赚钱 | 高 | 进行 |  |',
      '| 7 |  | 赚钱 | 高 | 进行 |  |',
      '|',
      '---',
      '| 8 | 表格之后 | 赚钱 | 高 | 进行 |  |',
    ].join('\n'))
    const { tracks } = parseTree(text)
    expect(tracks.map(track => track.name)).toEqual(['投资系统'])
  })

  it('skips duplicated and incomplete node rows', () => {
    const text = withNodes([
      NODE_HEADER,
      '| 1.1 | 1 | 标题 | 进行 |  |  |  |  |',
      '| 1.1 | 1 | 重复标题 | 进行 |  |  |  |  |',
      '|  | 1 | 没有 id | 进行 |  |  |  |  |',
      '| 1.2 | 1 |  | 进行 |  |  |  |  |',
      '|',
    ].join('\n'))
    const { nodes } = parseTree(text)
    expect(nodes.map(node => node.id)).toEqual(['1.1'])
  })

  it('reads both sections independently and stops each at the next heading', () => {
    const text = [
      '## 三、六条支线',
      '',
      TRACK_HEADER,
      '| 1 | 投资系统 | 赚钱 | 高 | 进行 |  |',
      '',
      '一些正文，结束表格。',
      '| 4 | 不该出现 | 生活 | 中 | 进行 |  |',
      '',
      '## 四、节点表',
      '',
      NODE_HEADER,
      '| 4.1 | 4 | 生活程序 | 进行 |  |  |  |  |',
      '',
      '## 五、别的内容',
      '',
      '| 9.9 | 9 | 不该出现 | 进行 |  |  |  |  |',
    ].join('\n')
    const { tracks, nodes } = parseTree(text)
    expect(tracks.map(track => track.id)).toEqual(['1'])
    expect(nodes.map(node => node.id)).toEqual(['4.1'])
  })

  it('returns empty results for hostile input', () => {
    expect(parseTree(/** @type {any} */ (null))).toEqual({ tracks: [], nodes: [] })
    expect(parseTree('')).toEqual({ tracks: [], nodes: [] })
    expect(parseTree('# 无关文件\n\n| id | 支线 |\n|---|---|\n| 1 | x |')).toEqual({ tracks: [], nodes: [] })
    expect(parseTree('## 三、六条支线\n\n| 只有一个管道 |\n|---|---|')).toEqual({ tracks: [], nodes: [] })
  })
})
