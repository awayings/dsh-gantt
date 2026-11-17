// Unified-tree rendering on the Gantt page: track/node rows, Hermes ids, meta
// chips, and the depth switch.
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import {
  buttonByText,
  click,
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

async function renderTree(payload = unifiedTreePayload(), options = {}, routes = {}) {
  const fetchState = installFetch({ [TREE]: () => jsonResponse(payload), ...routes })
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
