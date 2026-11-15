// Unified-tree rendering on the Gantt page: track/node rows, Hermes ids, meta
// chips, the depth switch, and the frontier/next strip backed by `brief`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import {
  buttonByText,
  click,
  deferred,
  flush,
  installFetch,
  jsonResponse,
  mount,
  q,
  qa,
  requestBody,
  row,
  setupApp,
  text,
  unmountAll,
} from './harness.js'
import {
  makeDailyBrief,
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
    expect(qa(track, '.gantt-row-action').map(button => button.getAttribute('data-action'))).toEqual(['ai'])

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
      .toEqual(['ai', 'decompose', 'schedule'])
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

describe('brief strip', () => {
  function cssText(container) {
    return qa(container, 'style').map(node => node.textContent).join('\n')
  }

  it('renders the header block with the pending count, generated time, and recompute action', async () => {
    const { view } = await renderTree()
    const head = q(view.container, '.gantt-brief-head')

    expect(text(head, '.gantt-brief-title')).toBe('Frontier / next')
    expect(text(head, '.gantt-brief-pending')).toBe('3 pending leaves')
    expect(text(head, '.gantt-brief-computed')).toContain('Generated')
    expect(text(head, '.gantt-brief-computed')).toContain('Nov 18')
    expect(buttonByText(head, 'Recompute')).not.toBeNull()
  })

  it('renders the lanes grid with real column headers and grid-based ellipsis alignment', async () => {
    const { view } = await renderTree()
    const grid = q(view.container, '.gantt-brief-lanes')
    const rows = qa(grid, '.gantt-brief-lane')

    expect(qa(grid, '.gantt-brief-col').map(cell => cell.textContent)).toEqual(['Track', 'Frontier', 'Next'])
    expect(rows).toHaveLength(2)
    expect(text(rows[0], '.gantt-brief-lane-name')).toBe('投资系统')
    expect(qa(rows[0], '.gantt-brief-pick').map(pick => pick.textContent)).toEqual(['1.8.4读数收口', '1.1数据底座'])
    expect(qa(rows[0], '.gantt-brief-pick')[0].getAttribute('title')).toBe('1.8.4 读数收口')
    expect(qa(rows[1], '.gantt-brief-none')).toHaveLength(2)
    expect(qa(rows[1], '.gantt-brief-pick')).toHaveLength(0)

    const css = cssText(view.container)
    const laneRule = (css.match(/\.gantt-brief-lanes-head,\s*\.gantt-brief-lane\s*\{[^}]*\}/) ?? [''])[0]
    const cellRule = (css.match(/\.gantt-brief-lane-name,\s*\.gantt-brief-cell\s*\{[^}]*\}/) ?? [''])[0]
    expect(laneRule).toContain('display: grid')
    expect(laneRule).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.2fr)')
    expect(cellRule).toContain('white-space: nowrap')
    expect(cellRule).toContain('text-overflow: ellipsis')
    expect(css).toMatch(/\.gantt-brief-lane\s*\{[^}]*height:\s*34px/)
  })

  it('renders today windows with time, role badge, task, and unfilled markers', async () => {
    const { view } = await renderTree()
    const block = q(view.container, '.gantt-brief-today')
    const windows = qa(block, '.gantt-brief-window')

    expect(text(block, '.gantt-brief-title')).toBe("Today's windows")
    expect(windows).toHaveLength(4)
    expect(text(windows[0], '.gantt-brief-window-time')).toBe('09:00–12:00')
    expect(text(windows[0], '.gantt-brief-role')).toBe('Core')
    expect(text(windows[0], '.gantt-brief-window-task')).toBe('1.1数据底座')
    expect(windows[0].getAttribute('data-filled')).toBe('true')
    expect(text(windows[1], '.gantt-brief-unfilled')).toBe('Unfilled')
    expect(windows[1].getAttribute('data-filled')).toBe('false')
    expect(windows[1].getAttribute('data-role')).toBe('core')
    expect(text(windows[2], '.gantt-brief-role')).toBe('Definition')
    expect(text(windows[3], '.gantt-brief-window-time')).toBe('--:--')
  })

  it('reveals the picked task when a window card is clicked', async () => {
    const scroll = vi.fn()
    const hadScroll = 'scrollIntoView' in Element.prototype
    const originalScroll = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll

    try {
      const { view } = await renderTree()
      click(buttonByText(view.container, 'One level'))
      expect(row(view.container, '1.8.4 读数收口')).toBeNull()

      click(qa(view.container, '.gantt-brief-window-task')[1])
      expect(row(view.container, '1.8.4 读数收口')).not.toBeNull()
      expect(row(view.container, '1.8.4 读数收口').getAttribute('data-selected')).toBe('true')
      expect(scroll).toHaveBeenCalled()
    } finally {
      if (hadScroll) Element.prototype.scrollIntoView = originalScroll
      else delete Element.prototype.scrollIntoView
    }
  })

  it('recomputes the brief and refreshes the tree', async () => {
    const gate = deferred()
    const { calls, view } = await renderTree(unifiedTreePayload(), {}, {
      'api/gantt/brief/compute': () => gate.promise,
    })
    const button = buttonByText(view.container, 'Recompute')

    click(button)
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('…')

    gate.resolve(jsonResponse({ ok: true, brief: makeDailyBrief() }))
    await flush()

    const compute = calls.find(call => call.path === 'api/gantt/brief/compute')
    expect(compute.options.method).toBe('POST')
    expect(requestBody(compute)).toEqual({ date: '2026-11-18' })
    expect(calls.filter(call => call.path === TREE)).toHaveLength(2)
    expect(buttonByText(view.container, 'Recompute').disabled).toBe(false)
  })

  it('reports a recompute failure in an error toast', async () => {
    const { view } = await renderTree(unifiedTreePayload(), {}, {
      'api/gantt/brief/compute': () => jsonResponse({ ok: false, error: 'brief is locked' }, 409),
    })

    click(buttonByText(view.container, 'Recompute'))
    await flush()

    const toast = q(view.container, '.gantt-toast')
    expect(toast.textContent).toBe('brief is locked')
    expect(toast.getAttribute('data-error')).toBe('true')
    view.unmount()

    const exploding = await renderTree(unifiedTreePayload(), {}, {
      'api/gantt/brief/compute': () => Promise.reject('compute exploded'),
    })
    click(buttonByText(exploding.view.container, 'Recompute'))
    await flush()
    expect(text(exploding.view.container, '.gantt-toast')).toBe('compute exploded')
  })

  it('reveals a lane pick, ignores a stale pick, and degrades pick labels without ids', async () => {
    const base = makeDailyBrief()
    const dailyBrief = makeDailyBrief({
      generatedAt: 'not-a-date',
      tracks: [
        {
          trackId: 't1',
          ref: 'track:1',
          name: '投资系统',
          state: '进行',
          role: 'core',
          picks: 1,
          frontier: { id: 'n21', title: '读数收口' },
          next: { id: 'ghost', title: '幽灵节点' },
        },
        { trackId: 't2', ref: 'track:2', name: '生活系统', state: '卡住', role: 'blocked', picks: 0, frontier: null, next: null },
      ],
      items: [{ ...base.items[0], ref: '' }],
    })
    const { view } = await renderTree(unifiedTreePayload({ dailyBrief }))
    const lane = qa(view.container, '.gantt-brief-lane')[0]

    expect(q(view.container, '.gantt-brief-computed')).toBeNull()
    expect(text(lane, '.gantt-brief-pick')).toBe('读数收口')
    expect(q(lane, '.gantt-brief-pick').getAttribute('title')).toBe(' 读数收口')
    expect(q(view.container, '.gantt-brief-window-task').getAttribute('title')).toBe('n1 数据底座')

    click(q(lane, '.gantt-brief-pick[data-kind="frontier"]'))
    expect(row(view.container, '1.8.4 读数收口').getAttribute('data-selected')).toBe('true')

    click(q(lane, '.gantt-brief-pick[data-kind="next"]'))
    expect(row(view.container, '1.8.4 读数收口').getAttribute('data-selected')).toBe('true')
  })

  it('degrades gracefully when dailyBrief is absent or malformed', async () => {
    const withoutBrief = await renderTree(unifiedTreePayload({ dailyBrief: undefined, brief: undefined }))
    expect(q(withoutBrief.view.container, '.gantt-brief')).toBeNull()
    withoutBrief.view.unmount()

    const malformed = await renderTree(unifiedTreePayload({
      dailyBrief: { tracks: 'nope', slots: 'nope', items: 'nope' },
    }))
    expect(q(malformed.view.container, '.gantt-brief-lanes')).toBeNull()
    expect(text(malformed.view.container, '.gantt-brief-empty')).toBe('No windows for today.')
    expect(q(malformed.view.container, '.gantt-brief-pending')).not.toBeNull()
    malformed.view.unmount()

    const bare = await renderTree(unifiedTreePayload({
      brief: undefined,
      dailyBrief: { slots: [], items: [], tracks: [] },
    }))
    expect(q(bare.view.container, '.gantt-brief-pending')).toBeNull()
    expect(q(bare.view.container, '.gantt-brief-computed')).toBeNull()
    expect(text(bare.view.container, '.gantt-brief-empty')).toBe('No windows for today.')
  })

  it('renders the strip in the Chinese dictionary', async () => {
    const { view } = await renderTree(unifiedTreePayload(), { locale: 'zh' })
    const strip = q(view.container, '.gantt-brief')

    expect(text(strip, '.gantt-brief-title')).toBe('前沿 / 该动')
    expect(text(strip, '.gantt-brief-pending')).toBe('3 个待办叶子')
    expect(text(strip, '.gantt-brief-computed')).toContain('生成于')
    expect(qa(strip, '.gantt-brief-col').map(cell => cell.textContent)).toEqual(['支线', '前沿', '该动'])
    expect(text(strip, '.gantt-brief-window .gantt-brief-role')).toBe('主攻')
    expect(text(strip, '.gantt-brief-unfilled')).toBe('未填')
    expect(buttonByText(strip, '重新计算')).not.toBeNull()
  })
})
