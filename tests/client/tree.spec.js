// Unified-tree rendering on the Gantt page: track/node rows, Hermes ids, meta
// chips, the depth switch, and the frontier/next strip backed by `brief`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import {
  buttonByText,
  click,
  dialog,
  flush,
  installFetch,
  jsonResponse,
  mount,
  q,
  qa,
  row,
  setupApp,
  text,
  unmountAll,
} from './harness.js'
import {
  makeUnifiedTree,
  unifiedTreePayload,
} from './fixtures.js'

const TREE = 'api/gantt/tree'

afterEach(unmountAll)

async function renderTree(payload = unifiedTreePayload(), options = {}) {
  const fetchState = installFetch({ [TREE]: () => jsonResponse(payload) })
  const app = setupApp(options)
  const view = mount(createElement(app.page().component))
  await flush()
  return { ...fetchState, app, view }
}

function chipTexts(container) {
  return qa(container, '.gantt-row-chip').map(element => element.textContent)
}

describe('unified tree rendering', () => {
  it('renders track rows with lane and raw state chips', async () => {
    const { view } = await renderTree()
    const track = row(view.container, '1 投资系统')

    expect(track).not.toBeNull()
    expect(track.getAttribute('data-kind')).toBe('track')
    expect(track.getAttribute('data-task-id')).toBe('t1')
    expect(chipTexts(track)).toEqual(['赚钱', '进行'])
    expect(qa(track, '.gantt-row-action')).toHaveLength(0)

    const leafTrack = row(view.container, '2 生活系统')
    expect(chipTexts(leafTrack)).toEqual(['生活', '卡住'])
    expect(qa(view.container, '.gantt-row')).toHaveLength(5)
    expect(text(view.container, '.gantt-corner-sub')).toBe('5 tasks')
  })

  it('renders Hermes node ids and every metadata chip with a full-value tooltip', async () => {
    const { view } = await renderTree()
    const node = row(view.container, '1.1 数据底座')
    const number = q(node, '.gantt-number')

    expect(node.getAttribute('data-kind')).toBe('node')
    expect(text(node, '.gantt-number')).toBe('1.1')
    expect(number.getAttribute('title')).toBe('node:1.1')
    expect(chipTexts(node)).toEqual([
      '进行',
      '数据底座从 tracker 导入后可查',
      '⤷ invest/data.md',
      '2h',
      'A 主攻片',
      '#21',
      '系统记忆',
      'invest/data.md',
    ])
    const chips = qa(node, '.gantt-row-chip')
    expect(chips[1].getAttribute('title')).toBe('Done when: 数据底座从 tracker 导入后可查')
    expect(chips[6].getAttribute('title')).toBe('Links: memory:key/个人任务系统')
    expect(chips[7].getAttribute('title')).toBe('Links: file:invest/data.md')

    expect(qa(node, '.gantt-row-action').map(button => button.getAttribute('data-action')))
      .toEqual(['decompose', 'schedule'])
    expect(q(node, '.gantt-row-action[data-action="decompose"]').getAttribute('title'))
      .toBe('Decompose into subtasks')
    expect(qa(view.container, '.gantt-bar').length).toBeGreaterThan(0)
  })

  it('falls back to the derived number when a node has no ref', async () => {
    const tasks = makeUnifiedTree()
    tasks[0].children[0].ref = ''
    const { view } = await renderTree(unifiedTreePayload({ tasks }))

    const node = row(view.container, '1.1 数据底座')
    expect(text(node, '.gantt-number')).toBe('1.1')
    expect(q(node, '.gantt-number').getAttribute('title')).toBe('1.1')
  })

  it('ignores a malformed links payload instead of crashing', async () => {
    const tasks = makeUnifiedTree()
    tasks[0].children[0].links = 'memory:key/x'
    const { view } = await renderTree(unifiedTreePayload({ tasks }))

    expect(qa(row(view.container, '1.1 数据底座'), '.gantt-row-chip')).toHaveLength(6)
  })

  it('renders a track without lane or state chips', async () => {
    const tasks = makeUnifiedTree()
    tasks[1].lane = ''
    tasks[1].state = ''
    const { view } = await renderTree(unifiedTreePayload({ tasks }))

    expect(qa(row(view.container, '2 生活系统'), '.gantt-row-chip')).toHaveLength(0)
  })

  it('renders the metadata chips in the Chinese dictionary', async () => {
    const { view } = await renderTree(unifiedTreePayload(), { locale: 'zh' })
    const chips = qa(row(view.container, '1.1 数据底座'), '.gantt-row-chip')

    expect(chips[1].getAttribute('title')).toBe('完成标准: 数据底座从 tracker 导入后可查')
    expect(chips[6].getAttribute('title')).toBe('链接: memory:key/个人任务系统')
  })
})

describe('tree depth switch', () => {
  it('switches between all, two, and one level through the collapsed set', async () => {
    const { view } = await renderTree()
    const levelButton = key => buttonByText(view.container, key)

    expect(qa(view.container, '.gantt-row')).toHaveLength(5)
    expect(levelButton('All levels').getAttribute('data-active')).toBe('true')

    click(levelButton('Two levels'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(4)
    expect(row(view.container, '1.8.4 读数收口')).toBeNull()
    expect(levelButton('Two levels').getAttribute('data-active')).toBe('true')
    expect(levelButton('All levels').getAttribute('data-active')).toBeNull()

    click(levelButton('One level'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(2)
    expect(row(view.container, '1.1 数据底座')).toBeNull()
    expect(row(view.container, '2 生活系统')).not.toBeNull()

    click(levelButton('All levels'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(5)
  })

  it('keeps the manual chevron collapse working after a level change', async () => {
    const { view } = await renderTree()
    click(buttonByText(view.container, 'Two levels'))

    click(q(row(view.container, '1 投资系统'), '.gantt-chevron'))
    expect(row(view.container, '1.1 数据底座')).toBeNull()

    click(q(row(view.container, '1 投资系统'), '.gantt-chevron'))
    expect(row(view.container, '1.1 数据底座')).not.toBeNull()
    expect(row(view.container, '1.8.4 读数收口')).toBeNull()
  })

  it('localizes the depth controls', async () => {
    const { view } = await renderTree(unifiedTreePayload(), { locale: 'zh' })
    expect(buttonByText(view.container, '全部')).not.toBeNull()
    expect(buttonByText(view.container, '两层')).not.toBeNull()
    expect(buttonByText(view.container, '一层')).not.toBeNull()
  })
})

describe('frontier and next strip', () => {
  it('renders per-lane frontier and next picks with the pending count', async () => {
    const { view } = await renderTree()
    const strip = q(view.container, '.gantt-brief')

    expect(strip).not.toBeNull()
    expect(text(strip, '.gantt-brief-title')).toBe('Frontier / next')
    expect(text(strip, '.gantt-brief-pending')).toBe('3 pending leaves')
    expect(qa(strip, '.gantt-brief-lane')).toHaveLength(1)
    expect(text(strip, '.gantt-brief-lane-name')).toBe('投资系统')
    expect(chipTexts(strip)).toEqual(['赚钱'])

    const picks = qa(strip, '.gantt-brief-pick')
    expect(picks.map(pick => pick.getAttribute('data-kind'))).toEqual(['frontier', 'next'])
    expect(picks.map(pick => pick.textContent)).toEqual([
      'Frontier1.8.4读数收口',
      'Next1.1数据底座',
    ])
    expect(picks[0].getAttribute('title')).toBe('1.8.4 读数收口')
  })

  it('selects the picked node and expands its ancestors when collapsed', async () => {
    const scroll = vi.fn()
    const hadScroll = 'scrollIntoView' in Element.prototype
    const originalScroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll

    try {
      const { view } = await renderTree()
      click(buttonByText(view.container, 'One level'))
      expect(row(view.container, '1.8.4 读数收口')).toBeNull()

      click(q(view.container, '.gantt-brief-pick[data-kind="frontier"]'))
      expect(row(view.container, '1.8.4 读数收口')).not.toBeNull()
      expect(row(view.container, '1 投资系统')).not.toBeNull()
      expect(row(view.container, '1.8.4 读数收口').getAttribute('data-selected')).toBe('true')
      expect(dialog(view.container)).toBeNull()
      expect(scroll).toHaveBeenCalled()

      click(q(view.container, '.gantt-brief-pick[data-kind="next"]'))
      expect(row(view.container, '1.1 数据底座').getAttribute('data-selected')).toBe('true')
    } finally {
      if (hadScroll) Element.prototype.scrollIntoView = originalScroll
      else delete Element.prototype.scrollIntoView
    }
  })

  it('skips lanes without picks and picks whose node left the tree', async () => {
    const brief = {
      lanes: [
        { id: 't1', name: '投资系统', lane: '', next: { id: 'n1', number: '1.1', title: '数据底座' } },
        { id: 't2', name: '生活系统', lane: '', frontier: null, next: null },
      ],
    }
    const { view } = await renderTree(unifiedTreePayload({ brief }))

    expect(qa(view.container, '.gantt-brief-lane')).toHaveLength(1)
    expect(qa(view.container, '.gantt-brief-pick')).toHaveLength(1)
    expect(text(view.container, '.gantt-brief-pending')).toBeNull()

    click(q(view.container, '.gantt-brief-pick[data-kind="next"]'))
    click(q(view.container, '.gantt-brief-pick[data-kind="next"]'))
    expect(row(view.container, '1.1 数据底座').getAttribute('data-selected')).toBe('true')
  })

  it('degrades gracefully when brief is absent or malformed', async () => {
    const withoutBrief = await renderTree(unifiedTreePayload({ brief: undefined }))
    expect(q(withoutBrief.view.container, '.gantt-brief')).toBeNull()
    withoutBrief.view.unmount()

    const badBrief = await renderTree(unifiedTreePayload({ brief: { lanes: 'nope' } }))
    expect(q(badBrief.view.container, '.gantt-brief')).toBeNull()
    badBrief.view.unmount()

    const emptyBrief = await renderTree(unifiedTreePayload({ brief: { lanes: [] } }))
    expect(q(emptyBrief.view.container, '.gantt-brief')).toBeNull()
  })

  it('degrades pick labels and lane keys when the brief omits ids', async () => {
    const brief = {
      lanes: [
        { id: 't1', name: '投资系统', lane: '赚钱', frontier: { id: 'n21', title: '读数收口' } },
        { ref: 'track:2', name: '生活系统', next: { id: 'n1', ref: 'node:1.1', title: '数据底座' } },
        { name: '元能力', frontier: { id: 'ghost', number: '9.9', ref: 'node:9.9', title: '幽灵节点' } },
      ],
    }
    const { view } = await renderTree(unifiedTreePayload({ brief }))
    const lanes = qa(view.container, '.gantt-brief-lane')

    expect(lanes).toHaveLength(3)
    expect(qa(view.container, '.gantt-brief-pick')).toHaveLength(3)
    const firstPick = q(view.container, '.gantt-brief-pick[data-kind="frontier"]')
    expect(firstPick.getAttribute('title')).toBe(' 读数收口')
    expect(text(firstPick, '.gantt-brief-id')).toBe('')
    expect(qa(lanes[0], '.gantt-row-chip')).toHaveLength(1)

    click(qa(view.container, '.gantt-brief-pick[data-kind="frontier"]')[1])
    expect(q(view.container, '.gantt-row[data-selected="true"]')).toBeNull()
    click(q(view.container, '.gantt-brief-pick[data-kind="frontier"]'))
    expect(row(view.container, '1.8.4 读数收口').getAttribute('data-selected')).toBe('true')
  })

  it('renders the strip in the Chinese dictionary', async () => {
    const { view } = await renderTree(unifiedTreePayload(), { locale: 'zh' })
    expect(text(view.container, '.gantt-brief-title')).toBe('前沿 / 该动')
    expect(text(view.container, '.gantt-brief-pending')).toBe('3 个待办叶子')
    expect(qa(view.container, '.gantt-brief-tag').map(tag => tag.textContent)).toEqual(['前沿', '该动'])
  })
})
