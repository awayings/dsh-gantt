// Label-filter behavior of the Gantt page: one filter row mixing predefined
// status/perspective labels with artificial tags, path pruning, the persisted
// selection, and the inspiration pool. Split from page.spec.js so no spec file
// grows past the line cap.
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
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
import { emptyTreePayload, filterTreePayload, makeFilterTree, treePayload, TODAY } from './fixtures.js'

const TREE = 'api/gantt/tree'

afterEach(unmountAll)

function fakeUiSession(entries = {}) {
  let snapshot = new Map(Object.entries(entries))
  const listeners = new Set()
  return {
    sessionStatus: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    update(next) {
      snapshot = new Map(Object.entries(next))
      for (const listener of [...listeners]) listener()
    },
  }
}

describe('label filter', () => {
  async function renderFiltered(payload = filterTreePayload(), options = {}, routes = {}) {
    const fetchState = installFetch({ [TREE]: () => jsonResponse(payload), ...routes })
    const app = setupApp(options)
    const view = mount(createElement(app.page().component))
    await flush()
    return { ...fetchState, app, view }
  }

  function labelButton(view, label) {
    return q(view.container, `.gantt-tag-filter [data-label="${label}"]`)
  }

  function rowLabels(view) {
    return qa(view.container, '.gantt-row').map(element => element.getAttribute('aria-label'))
  }

  function chips(view) {
    return qa(view.container, '.gantt-tag-filter [data-label]')
  }

  it('offers one label row with counted predefined labels and artificial tags', async () => {
    const { view } = await renderFiltered()

    expect(qa(view.container, '.gantt-row')).toHaveLength(8)
    expect(chips(view).map(button => button.getAttribute('data-label'))).toEqual([
      'all',
      'preset:unfinished',
      'preset:active',
      'preset:frontier',
      'preset:next',
      'preset:today',
      'preset:done',
      'preset:inspiration',
      'tag:backend',
      'tag:invest',
      'tag:urgent',
      'tag:life',
    ])
    expect(chips(view).map(button => button.getAttribute('data-kind'))).toEqual([
      ...Array.from({ length: 8 }, () => 'preset'),
      ...Array.from({ length: 4 }, () => 'tag'),
    ])
    expect(chips(view).map(button => button.textContent)).toEqual([
      'All',
      'Unfinished (8)',
      'Active (0)',
      'Frontier (1)',
      'Next (1)',
      'Today (2)',
      'Done (0)',
      'Inspiration (1)',
      '#backend (1)',
      '#invest (2)',
      '#urgent (1)',
      '#life (1)',
    ])
    expect(labelButton(view, 'all').getAttribute('data-active')).toBe('true')
    expect(labelButton(view, 'preset:frontier').getAttribute('aria-pressed')).toBe('false')
    expect(labelButton(view, 'tag:invest').getAttribute('aria-pressed')).toBe('false')
    expect(labelButton(view, 'preset:frontier').getAttribute('title'))
      .toBe('Predefined label: filter by status or perspective.')
    expect(q(view.container, '.gantt-filter [data-filter]')).toBeNull()
    expect(q(view.container, '.gantt-filter-count')).toBeNull()
    expect(q(view.container, '.gantt-tag-filter [data-action="clear-tags"]')).toBeNull()
    expect(q(view.container, '.gantt-tag-filter [data-action="recompute-brief"]')).not.toBeNull()
  })

  it('keeps only the paths of the picked status label', async () => {
    const { view } = await renderFiltered()

    click(labelButton(view, 'preset:frontier'))
    expect(rowLabels(view)).toEqual(['1 投资系统', '1.8 交易仓', '1.8.4 读数收口'])
    expect(row(view.container, '2 生活系统')).toBeNull()
    expect(text(view.container, '.gantt-filter-count')).toBe('1 paths')
    expect(text(view.container, '.gantt-corner-sub')).toBe('3 tasks')
    expect(labelButton(view, 'preset:frontier').getAttribute('data-active')).toBe('true')
    expect(labelButton(view, 'all').getAttribute('data-active')).toBeNull()

    click(labelButton(view, 'all'))
    click(labelButton(view, 'preset:next'))
    expect(rowLabels(view)).toEqual(['2 生活系统', '2.1 生活实验'])
    expect(text(view.container, '.gantt-filter-count')).toBe('1 paths')
    expect(text(view.container, '.gantt-corner-sub')).toBe('2 tasks')

    click(labelButton(view, 'all'))
    click(labelButton(view, 'preset:today'))
    expect(rowLabels(view)).toEqual(['1 投资系统', '1.1 数据底座', '2 生活系统', '2.1 生活实验'])
    expect(text(view.container, '.gantt-filter-count')).toBe('2 paths')
    expect(text(view.container, '.gantt-corner-sub')).toBe('4 tasks')
  })

  it('filters to tasks whose work conversation is running or waiting', async () => {
    const tasks = makeFilterTree()
    tasks[0].children[0].workSessionId = 'session-run'
    tasks[1].children[0].workSessionId = 'session-wait'
    tasks[2].children[0].workSessionId = 'session-idle'
    const uiSession = fakeUiSession({
      'session-run': { running: true },
      'session-wait': { running: true, pendingInteraction: 'approval' },
      'session-idle': { running: false },
    })
    const { view } = await renderFiltered(filterTreePayload({ tasks }), { services: { uiSession } })

    expect(q(view.container, '.gantt-row[data-task-id="n1"] .gantt-row-activity').getAttribute('data-state')).toBe('running')
    expect(q(view.container, '.gantt-row[data-task-id="n31"] .gantt-row-activity').getAttribute('data-state')).toBe('waiting')
    expect(q(view.container, '.gantt-row[data-task-id="n31"] .gantt-row-activity').getAttribute('title'))
      .toBe('The work conversation is waiting for your choice')

    click(labelButton(view, 'preset:active'))
    expect(rowLabels(view)).toEqual([
      '1 投资系统',
      '1.1 数据底座',
      '2 生活系统',
      '2.1 生活实验',
    ])
    expect(row(view.container, '3 元能力')).toBeNull()
    expect(text(view.container, '.gantt-filter-count')).toBe('2 paths')

    act(() => uiSession.update({
      'session-run': { pendingInteraction: 'question' },
      'session-wait': { running: true },
    }))
    expect(q(view.container, '.gantt-row[data-task-id="n1"] .gantt-row-activity').getAttribute('data-state')).toBe('waiting')
    // A session-status change keeps the label selection instead of resetting it.
    expect(labelButton(view, 'preset:active').getAttribute('data-active')).toBe('true')
    expect(qa(view.container, '.gantt-row')).toHaveLength(4)
  })

  it('keeps only the inspired nodes and their ancestors for the inspiration label', async () => {
    const tasks = makeFilterTree()
    tasks[1].children[0].inspiration = '#9'
    const { view } = await renderFiltered(filterTreePayload({ tasks }))

    expect(labelButton(view, 'preset:inspiration').textContent).toBe('Inspiration (2)')
    click(labelButton(view, 'preset:inspiration'))
    expect(rowLabels(view)).toEqual([
      '1 投资系统',
      '1.1 数据底座',
      '2 生活系统',
      '2.1 生活实验',
    ])
    expect(row(view.container, '1.8 交易仓')).toBeNull()
    expect(row(view.container, '3 元能力')).toBeNull()
    expect(text(view.container, '.gantt-filter-count')).toBe('2 paths')
    expect(labelButton(view, 'preset:inspiration').getAttribute('data-active')).toBe('true')

    click(labelButton(view, 'all'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(8)
  })

  it('shows the generic hint when the selected labels match nothing', async () => {
    const { view } = await renderFiltered()

    click(labelButton(view, 'preset:active'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(0)
    expect(text(view.container, '.gantt-filter-empty .gantt-empty-title'))
      .toBe('No task matches the selected labels.')
    expect(text(view.container, '.gantt-filter-empty .gantt-hint')).toBe('Clear the labels, or pick another one.')
  })

  it('keeps only done nodes and their ancestors for the done label', async () => {
    const tasks = makeFilterTree()
    tasks[0].children[0].status = 'done'
    tasks[0].children[0].progress = 100
    const { view } = await renderFiltered(filterTreePayload({ tasks }))

    click(labelButton(view, 'preset:done'))
    expect(rowLabels(view)).toEqual([
      '1 投资系统',
      '1.1 数据底座',
    ])
    expect(text(view.container, '.gantt-filter-count')).toBe('1 paths')
    expect(q(view.container, '.gantt-banner')).toBeNull()
  })

  it('keeps only unfinished nodes and their ancestors for the unfinished label', async () => {
    const tasks = makeFilterTree()
    tasks[0].children[0].status = 'done'
    tasks[0].children[0].progress = 100
    tasks[1].status = 'cancelled'
    tasks[1].children[0].status = 'cancelled'
    tasks[2].status = 'done'
    const { view } = await renderFiltered(filterTreePayload({ tasks }))

    click(labelButton(view, 'preset:unfinished'))
    expect(rowLabels(view)).toEqual([
      '1 投资系统',
      '1.8 交易仓',
      '1.8.4 读数收口',
      '3 元能力',
      '3.1 复盘节奏',
    ])
    expect(row(view.container, '1.1 数据底座')).toBeNull()
    expect(row(view.container, '2 生活系统')).toBeNull()
    expect(text(view.container, '.gantt-filter-count')).toBe('4 paths')
    expect(text(view.container, '.gantt-corner-sub')).toBe('5 tasks')
    expect(labelButton(view, 'preset:unfinished').getAttribute('data-active')).toBe('true')
  })

  it('shows the generic hint when nothing is unfinished', async () => {
    const tasks = makeFilterTree()
    const markDone = (nodes) => {
      for (const node of nodes) {
        node.status = 'done'
        markDone(node.children ?? [])
      }
    }
    markDone(tasks)
    tasks[1].status = 'cancelled'
    const { view } = await renderFiltered(filterTreePayload({ tasks }))

    click(labelButton(view, 'preset:unfinished'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(0)
    expect(q(view.container, '.gantt-body')).toBeNull()
    expect(text(view.container, '.gantt-filter-empty .gantt-empty-title'))
      .toBe('No task matches the selected labels.')
    expect(text(view.container, '.gantt-filter-empty .gantt-hint')).toBe('Clear the labels, or pick another one.')
    expect(q(view.container, '.gantt-filter-count')).toBeNull()

    click(labelButton(view, 'all'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(8)
    expect(q(view.container, '.gantt-filter-empty')).toBeNull()
  })

  it('treats a tree without brief data as empty frontier, next, and today labels', async () => {
    const fetchState = installFetch({ [TREE]: () => jsonResponse(treePayload()) })
    const app = setupApp()
    const view = mount(createElement(app.page().component))
    await flush()

    for (const label of ['preset:frontier', 'preset:next', 'preset:today']) {
      click(q(view.container, `.gantt-tag-filter [data-label="${label}"]`))
      expect(qa(view.container, '.gantt-row')).toHaveLength(0)
      expect(text(view.container, '.gantt-filter-empty .gantt-empty-title'))
        .toBe('No task matches the selected labels.')
      expect(text(view.container, '.gantt-filter-empty .gantt-hint')).toBe('Clear the labels, or pick another one.')
      expect(q(view.container, '.gantt-filter-count')).toBeNull()
      click(q(view.container, '.gantt-tag-filter [data-label="all"]'))
      expect(qa(view.container, '.gantt-row')).toHaveLength(6)
    }
    expect(fetchState.calls.filter(call => call.path === TREE)).toHaveLength(1)
  })

  it('expands for any label and gives the level folds back once the selection clears', async () => {
    const { view } = await renderFiltered()
    click(buttonByText(view.container, 'One level'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(3)

    click(labelButton(view, 'preset:frontier'))
    expect(rowLabels(view)).toEqual(['1 投资系统', '1.8 交易仓', '1.8.4 读数收口'])

    click(labelButton(view, 'all'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(3)

    // The source tree was never mutated: expanding again restores every row.
    click(buttonByText(view.container, 'All levels'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(8)
  })

  it('is hidden for an empty tree and localizes the labels', async () => {
    const emptyFetch = installFetch({ [TREE]: () => jsonResponse(emptyTreePayload()) })
    const emptyApp = setupApp()
    const emptyView = mount(createElement(emptyApp.page().component))
    await flush()
    expect(q(emptyView.container, '.gantt-filter')).toBeNull()
    expect(emptyFetch.calls.filter(call => call.path === TREE)).toHaveLength(1)
    emptyView.unmount()

    const { view } = await renderFiltered(filterTreePayload(), { locale: 'zh' })
    expect(text(view.container, '.gantt-tag-filter .gantt-filter-label')).toBe('标签')
    expect(chips(view).map(button => button.textContent)).toEqual([
      '全部',
      '未完成 (8)',
      '进行中 (0)',
      '前沿 (1)',
      '该动 (1)',
      '今日 (2)',
      '已完成 (0)',
      '灵感 (1)',
      '#backend (1)',
      '#invest (2)',
      '#urgent (1)',
      '#life (1)',
    ])
    expect(labelButton(view, 'preset:frontier').getAttribute('title')).toBe('预定义标签：按状态或视角筛选。')
    click(labelButton(view, 'preset:frontier'))
    expect(text(view.container, '.gantt-filter-count')).toBe('1 条路径')
    expect(text(view.container, '.gantt-corner-sub')).toBe('3 个任务')
    expect(text(view.container, '.gantt-tag-filter [data-action="recompute-brief"]')).toBe('重算前沿和该动')
    expect(text(view.container, '.gantt-tag-filter [data-action="clear-tags"]')).toBe('清除标签')

    const { view: english } = await renderFiltered()
    expect(text(english.container, '.gantt-tag-filter .gantt-filter-label')).toBe('Tags')
    expect(text(english.container, '.gantt-tag-filter [data-action="clear-tags"]')).toBe('Clear labels')
  })

  it('recomputes the frontier and next from the label row and refreshes the tree', async () => {
    const gate = deferred()
    const { calls, view } = await renderFiltered(filterTreePayload(), {}, {
      'api/gantt/brief/compute': () => gate.promise,
    })
    const button = q(view.container, '.gantt-tag-filter [data-action="recompute-brief"]')
    expect(button.textContent).toBe('Recompute frontier and next')

    click(button)
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('…')

    gate.resolve(jsonResponse({ ok: true }))
    await flush()

    const compute = calls.find(call => call.path === 'api/gantt/brief/compute')
    expect(compute.options.method).toBe('POST')
    expect(requestBody(compute)).toEqual({ date: TODAY })
    expect(calls.filter(call => call.path === TREE)).toHaveLength(2)
    expect(text(view.container, '.gantt-toast')).toBe('Frontier and next recomputed')
    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Recompute frontier and next')
  })

  it('shows artificial tags with usage counts and keeps the row when a tree has none', async () => {
    const { view } = await renderFiltered()

    expect(qa(view.container, '.gantt-tag-filter [data-kind="tag"]').map(button => button.getAttribute('data-label')))
      .toEqual(['tag:backend', 'tag:invest', 'tag:urgent', 'tag:life'])
    expect(qa(view.container, '.gantt-tag-filter [data-kind="tag"]').map(button => button.textContent))
      .toEqual(['#backend (1)', '#invest (2)', '#urgent (1)', '#life (1)'])

    const tasks = makeFilterTree()
    const strip = (nodes) => {
      for (const node of nodes) {
        node.tags = []
        strip(node.children ?? [])
      }
    }
    strip(tasks)
    const { view: plain } = await renderFiltered(filterTreePayload({ tasks }))
    expect(qa(plain.container, '.gantt-tag-filter [data-kind="tag"]')).toHaveLength(0)
    expect(qa(plain.container, '.gantt-tag-filter [data-kind="preset"]')).toHaveLength(8)
    expect(q(plain.container, '.gantt-tag-filter')).not.toBeNull()
  })

  it('keeps matching tasks and their ancestors when a tag is picked', async () => {
    const { view } = await renderFiltered()

    click(labelButton(view, 'tag:invest'))
    expect(rowLabels(view)).toEqual([
      '1 投资系统',
      '1.8 交易仓',
      '1.8.4 读数收口',
    ])
    expect(labelButton(view, 'tag:invest').getAttribute('data-active')).toBe('true')
    expect(labelButton(view, 'tag:invest').getAttribute('aria-pressed')).toBe('true')
    expect(text(view.container, '.gantt-filter-count')).toBe('2 paths')
    expect(text(view.container, '.gantt-corner-sub')).toBe('3 tasks')

    click(labelButton(view, 'tag:invest'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(8)
    expect(text(view.container, '.gantt-filter-count')).toBeNull()
    expect(labelButton(view, 'all').getAttribute('data-active')).toBe('true')
  })

  it('unions several selected labels and clears the whole selection', async () => {
    const { view } = await renderFiltered()

    click(labelButton(view, 'tag:invest'))
    click(labelButton(view, 'tag:life'))
    expect(rowLabels(view)).toEqual([
      '1 投资系统',
      '1.8 交易仓',
      '1.8.4 读数收口',
      '2 生活系统',
      '2.1 生活实验',
    ])
    expect(text(view.container, '.gantt-filter-count')).toBe('3 paths')

    click(q(view.container, '.gantt-tag-filter [data-action="clear-tags"]'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(8)
    expect(q(view.container, '.gantt-tag-filter [data-action="clear-tags"]')).toBeNull()
    expect(labelButton(view, 'tag:invest').getAttribute('data-active')).toBeNull()
    expect(text(view.container, '.gantt-filter-count')).toBeNull()
  })

  it('unions predefined labels with artificial tags instead of narrowing them', async () => {
    const { view } = await renderFiltered()

    click(labelButton(view, 'preset:frontier'))
    click(labelButton(view, 'tag:life'))
    expect(rowLabels(view)).toEqual([
      '1 投资系统',
      '1.8 交易仓',
      '1.8.4 读数收口',
      '2 生活系统',
      '2.1 生活实验',
    ])
    expect(text(view.container, '.gantt-filter-count')).toBe('2 paths')

    // A label whose set is empty adds nothing to the union.
    click(labelButton(view, 'preset:done'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(5)
    expect(text(view.container, '.gantt-filter-count')).toBe('2 paths')

    click(q(view.container, '.gantt-tag-filter [data-action="clear-tags"]'))
    expect(qa(view.container, '.gantt-row')).toHaveLength(8)
  })

  it('reports a recompute failure in an error toast', async () => {
    const { view } = await renderFiltered(filterTreePayload(), {}, {
      'api/gantt/brief/compute': () => jsonResponse({ ok: false, error: 'brief is locked' }, 409),
    })

    click(q(view.container, '.gantt-tag-filter [data-action="recompute-brief"]'))
    await flush()

    const toast = q(view.container, '.gantt-toast')
    expect(toast.textContent).toBe('brief is locked')
    expect(toast.getAttribute('data-error')).toBe('true')
    view.unmount()

    const exploding = await renderFiltered(filterTreePayload(), {}, {
      'api/gantt/brief/compute': () => Promise.reject('compute exploded'),
    })
    click(q(exploding.view.container, '.gantt-tag-filter [data-action="recompute-brief"]'))
    await flush()
    expect(text(exploding.view.container, '.gantt-toast')).toBe('compute exploded')
  })
})
