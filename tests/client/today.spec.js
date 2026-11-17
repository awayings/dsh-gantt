// Today page behavior: registration, dictionary parity, the day bundle render,
// date navigation, block status cycling, tracker import, and empty/error states.
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import {
  NS,
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
  setupApp,
  text,
  unmountAll,
} from './harness.js'
import {
  TODAY_DATE,
  dayPayload,
  emptyDayPayload,
  makeDailyBrief,
  makePlanBlocks,
  makeTaskBlock,
  planDay,
  unplannedDayPayload,
} from './fixtures.js'

const DAY = 'api/gantt/day'
const STATUS = 'api/gantt/plan/status'
const IMPORT = 'api/gantt/plan/import'
const BRIEF_COMPUTE = 'api/gantt/brief/compute'

afterEach(unmountAll)

const TODAY_KEYS = [
  'nav.today',
  'today.title',
  'today.subtitle',
  'today.prevDay',
  'today.nextDay',
  'today.todayButton',
  'today.refresh',
  'today.import',
  'today.importDone',
  'today.importFailed',
  'today.coreGoal',
  'today.integrityTitle',
  'today.integrity.landing-missing',
  'today.integrity.evening-missing',
  'today.integrity.inspiration-missing',
  'today.integrity.unplanned-day',
  'today.blocks',
  'today.nodes',
  'today.nodesEmpty',
  'today.emptyTitle',
  'today.emptyHint',
  'today.emptyAction',
  'today.emptyDay',
  'slot.morning',
  'slot.daytime',
  'slot.evening',
  'slot.other',
  'planStatus.todo',
  'planStatus.in_progress',
  'planStatus.done',
  'planStatus.skipped',
  'today.statusHint',
  'today.open',
  'today.closed',
  'today.weekdayLabel',
  'today.remaining',
  'today.doneCount',
  'today.fromTree',
  'today.brief.title',
  'today.brief.recompute',
  'today.brief.empty',
  'today.brief.generated',
  'today.brief.source.auto',
  'today.brief.source.manual',
  'today.brief.unfilled',
]

function dayCalls(calls) {
  return calls.filter(call => call.path.startsWith(DAY))
}

function dayDates(calls) {
  return dayCalls(calls).map(call => new URL(call.path, 'http://dsh').searchParams.get('date'))
}

function shiftIso(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Mount the registered Today page against a stubbed fetch table and settle it. */
async function renderToday(routes = {}, options = {}) {
  const fetchState = installFetch({
    [DAY]: () => jsonResponse(dayPayload()),
    [STATUS]: () => jsonResponse({ ok: true, block: {} }),
    [IMPORT]: () => jsonResponse({ ok: true, dir: '/tracker', imported: { tracks: 6, nodes: 24, days: 7, blocks: 30 } }),
    [BRIEF_COMPUTE]: () => jsonResponse({ ok: true, brief: makeDailyBrief() }),
    ...routes,
  })
  const app = setupApp(options)
  const view = mount(createElement(app.todayPage().component))
  await flush()
  return { ...fetchState, app, view }
}

describe('registration and locale dictionaries', () => {
  it('registers the Today sidebar entry and the matching keyed main page', () => {
    const app = setupApp()
    const sidebar = app.todaySidebar()
    expect(sidebar.def).toMatchObject({ name: 'sidebar.panellist', id: 'today', order: 21 })
    expect(sidebar.def.label()).toBe('Today')
    expect(app.todayPage().def).toEqual({ name: 'main', key: 'today' })
    expect(app.page().def).toEqual({ name: 'main', key: 'gantt' })
    expect(app.registrations.size).toBe(4)

    const zh = setupApp({ locale: 'zh' })
    expect(zh.todaySidebar().def.label()).toBe('今日')
  })

  it('ships complete en/zh dictionaries for exactly the Today keys', () => {
    const app = setupApp()
    const dictionaries = app.dicts[NS]
    expect(Object.keys(dictionaries).sort()).toEqual(['en', 'zh'])
    const english = dictionaries.en
    const chinese = dictionaries.zh
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort())

    for (const key of TODAY_KEYS) {
      expect(typeof english[key], key).toBe('string')
      expect(english[key].length, key).toBeGreaterThan(0)
      expect(typeof chinese[key], key).toBe('string')
      expect(chinese[key].length, key).toBeGreaterThan(0)
    }

    const todayKeys = Object.keys(english)
      .filter(key => key.startsWith('today.') || key.startsWith('slot.') || key.startsWith('planStatus.') || key === 'nav.today')
      .sort()
    expect(todayKeys).toEqual([...TODAY_KEYS].sort())
  })

  it('renders the Today glyph with idle and active styling', () => {
    const app = setupApp()
    const component = app.todaySidebar().component

    const idle = mount(createElement(component))
    const svg = q(idle.container, 'svg')
    expect(svg).not.toBeNull()
    expect(svg.getAttribute('width')).toBe('18')
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('stroke-width')).toBe('1.8')
    expect(svg.style.opacity).toBe('0.85')
    expect(qa(idle.container, 'rect')).toHaveLength(1)
    expect(qa(idle.container, 'path')).toHaveLength(2)
    expect(qa(idle.container, 'circle')).toHaveLength(1)

    idle.rerender(createElement(component, { size: 24, active: true }))
    const active = q(idle.container, 'svg')
    expect(active.getAttribute('width')).toBe('24')
    expect(active.getAttribute('stroke-width')).toBe('2')
    expect(active.style.opacity).toBe('1')
  })
})

describe('day rendering', () => {
  it('renders the header, day meta, core goal, integrity, slots, blocks, and nodes', async () => {
    const { calls, view } = await renderToday()
    const container = view.container

    expect(text(container, '.gantt-title')).toBe('Today')
    expect(text(container, '.gantt-subtitle')).toContain('Planned time blocks')
    expect(qa(container, 'style')).toHaveLength(2)
    expect(dayCalls(calls)).toHaveLength(1)

    expect(text(container, '.today-weekday')).not.toBe('')
    expect(text(container, '.today-meta-label')).toBe('周末（休市）· 主攻片')
    expect(text(container, '.today-market')).toBe('Market closed')
    expect(text(container, '.gantt-stat-progress')).toContain('Done 1/5')
    expect(text(container, '.gantt-stat-progress')).toContain('Remaining 3')
    expect(q(container, '.gantt-progress > span').style.width).toBe('20%')

    expect(text(container, '.today-goal .gantt-label')).toBe('Core goal')
    expect(text(container, '.today-goal-text')).toBe('把 Today 页跑通并合并')

    expect(text(container, '.today-integrity .today-section-title')).toBe('Integrity checks')
    expect(qa(container, '.today-integrity-item')).toHaveLength(1)
    expect(text(container, '.today-integrity-item')).toBe('A block has no landing target')

    expect(qa(container, '.today-slot-title span:first-child').map(element => element.textContent))
      .toEqual(['Morning', 'Daytime', 'Evening', 'Unscheduled'])
    expect(qa(container, '.today-slot')).toHaveLength(4)
    expect(qa(container, '.today-block')).toHaveLength(5)

    const first = q(container, '.today-block[data-block-id="b1"]')
    expect(text(first, '.today-block-time')).toBe('09:00–12:00')
    expect(text(first, '.today-chip')).toBe('A 主攻片')
    expect(text(first, '.today-block-title')).toBe('主攻片：写 Today 页')
    expect(text(first, '.today-block-detail')).toBe('把设计落到 client.js 并跑通测试')
    expect(text(first, '.gantt-status')).toContain('To do')
    expect(q(first, '.gantt-status').getAttribute('title')).toBe('Click to cycle the block status')

    const second = q(container, '.today-block[data-block-id="b2"]')
    expect(q(second, '.today-block-detail')).toBeNull()
    expect(qa(second, '.today-block-meta .today-chip')).toHaveLength(3)

    const untimed = q(container, '.today-block[data-block-id="b4"]')
    expect(text(untimed, '.today-block-time')).toBe('—')
    expect(qa(untimed, '.today-block-meta .today-chip')).toHaveLength(1)

    expect(text(container, '.today-nodes .today-section-title')).toBe("This week's nodes")
    expect(qa(container, '.today-node')).toHaveLength(3)
    const nodes = qa(container, '.today-node')
    expect(nodes[0].getAttribute('data-kind')).toBe('node')
    expect(text(nodes[0], '.today-node-id')).toBe('1.8.1')
    expect(q(nodes[0], '.today-node-id').getAttribute('title')).toBe('node:1.8.1')
    expect(text(nodes[0], '.today-node-range')).toBe('2026-11-10 – 2026-11-18')
    expect(qa(nodes[0], '.today-chip')).toHaveLength(5)
    expect(qa(nodes[1], '.today-chip')).toHaveLength(0)
    expect(q(nodes[1], '.today-node-id').getAttribute('title')).toBe('node:2.3')
    expect(q(nodes[1], '.today-node-range')).toBeNull()
    expect(text(nodes[2], '.today-node-range')).toBe('2026-11-14')
  })

  it('renders every integrity code from the day bundle', async () => {
    const { view } = await renderToday({
      [DAY]: () => jsonResponse(dayPayload({
        integrity: [
          { code: 'landing-missing', blockId: 'b1' },
          { code: 'evening-missing' },
          { code: 'inspiration-missing' },
          { code: 'unplanned-day' },
        ],
      })),
    })

    expect(qa(view.container, '.today-integrity-item').map(item => item.textContent)).toEqual([
      'A block has no landing target',
      'No evening block for this day',
      'An evening block carries no inspiration id',
      'This day has no plan yet',
    ])
    expect(q(view.container, '.today-integrity-item').getAttribute('data-code')).toBe('landing-missing')
  })

  it('marks an open market and hides an absent core goal', async () => {
    const { view } = await renderToday({
      [DAY]: () => jsonResponse(dayPayload({
        day: planDay({ marketOpen: true, coreGoal: '', weekday: '周二', dayKind: 'workday', label: '工作日 · 主攻片' }),
      })),
    })

    expect(text(view.container, '.today-market')).toBe('Market open')
    expect(q(view.container, '.today-market').getAttribute('data-open')).toBe('true')
    expect(q(view.container, '.today-goal')).toBeNull()
  })

  it('skips a slot group that has no blocks', async () => {
    const { view } = await renderToday({
      [DAY]: () => jsonResponse(dayPayload({
        blocks: makePlanBlocks().filter(block => block.slot !== 'evening'),
      })),
    })

    expect(qa(view.container, '.today-slot-title span:first-child').map(element => element.textContent))
      .toEqual(['Morning', 'Daytime', 'Unscheduled'])
    expect(qa(view.container, '.today-block')).toHaveLength(4)
  })

  it('shows the empty-day and empty-node notices when nothing is planned', async () => {
    const { view } = await renderToday({ [DAY]: () => jsonResponse(emptyDayPayload()) })

    expect(text(view.container, '.today-blocks .today-muted')).toBe('No time blocks planned for this day.')
    expect(text(view.container, '.today-nodes .today-muted')).toBe('No task-tree nodes in play this week.')
    expect(qa(view.container, '.today-block')).toHaveLength(0)
    expect(qa(view.container, '.today-slot')).toHaveLength(0)
    expect(q(view.container, '.gantt-progress > span').style.width).toBe('0%')
  })
})

describe('daily brief section', () => {
  it('renders per-window rows with time, role, track, task, and unfilled markers', async () => {
    const { view } = await renderToday()
    const section = q(view.container, '.today-brief')

    expect(text(section, '.today-section-title')).toBe("Today's brief")
    const rows = qa(section, '.today-brief-row')
    expect(rows).toHaveLength(4)
    expect(rows[0].getAttribute('data-filled')).toBe('true')
    expect(text(rows[0], '.today-brief-time')).toBe('09:00–12:00')
    expect(text(rows[0], '.today-brief-role')).toBe('Core')
    expect(text(rows[0], '.today-brief-track')).toBe('投资系统')
    expect(text(rows[0], '.today-brief-task')).toBe('1.1 数据底座')
    expect(rows[1].getAttribute('data-filled')).toBe('false')
    expect(text(rows[1], '.today-brief-unfilled')).toBe('Unfilled')
    expect(rows[1].getAttribute('data-role')).toBe('core')
    expect(text(rows[2], '.today-brief-role')).toBe('Definition')
    expect(text(rows[2], '.today-brief-task')).toBe('1.8.4 读数收口')
    expect(text(rows[3], '.today-brief-time')).toBe('--:--')
    expect(text(section, '.today-brief-meta')).toContain('Generated')
    expect(text(section, '.today-brief-meta')).toContain('auto')
    expect(q(section, '[data-action="recompute-brief"]')).not.toBeNull()
  })

  it('treats a malformed report as empty windows', async () => {
    const brief = { ...makeDailyBrief(), slots: 'nope', items: 'nope' }
    const { view } = await renderToday({ [DAY]: () => jsonResponse(dayPayload({ brief })) })

    expect(text(view.container, '.today-muted')).toBe('No windows for today.')
  })

  it('drops a malformed generated-at timestamp', async () => {
    const brief = makeDailyBrief({ generatedAt: 'not-a-date' })
    const { view } = await renderToday({ [DAY]: () => jsonResponse(dayPayload({ brief })) })

    expect(text(view.container, '.today-brief-meta')).toBe('auto')
  })

  it('falls back to the task id and shows a source-only meta line', async () => {
    const base = makeDailyBrief()
    const brief = makeDailyBrief({
      generatedAt: '',
      source: 'manual',
      items: [{ ...base.items[0], ref: '', title: '手动任务' }],
    })
    const { view } = await renderToday({ [DAY]: () => jsonResponse(dayPayload({ brief })) })

    expect(text(view.container, '.today-brief-task')).toBe('n1 手动任务')
    expect(text(view.container, '.today-brief-meta')).toBe('manual')
  })

  it('recomputes the brief and refreshes the day', async () => {
    const gate = deferred()
    const { calls, view } = await renderToday({ [BRIEF_COMPUTE]: () => gate.promise })
    const button = q(view.container, '[data-action="recompute-brief"]')

    click(button)
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('…')

    gate.resolve(jsonResponse({ ok: true, brief: makeDailyBrief() }))
    await flush()

    const compute = calls.find(call => call.path === BRIEF_COMPUTE)
    expect(compute.options.method).toBe('POST')
    expect(requestBody(compute)).toEqual({ date: dayDates(calls)[0] })
    expect(dayCalls(calls)).toHaveLength(2)
    expect(q(view.container, '[data-action="recompute-brief"]').disabled).toBe(false)
  })

  it('reports a recompute failure in a banner', async () => {
    const { view } = await renderToday({
      [BRIEF_COMPUTE]: () => jsonResponse({ ok: false, error: 'brief engine down' }, 503),
    })
    click(q(view.container, '[data-action="recompute-brief"]'))
    await flush()

    expect(text(view.container, '.gantt-banner')).toBe('brief engine down')
    expect(q(view.container, '[data-action="recompute-brief"]').disabled).toBe(false)
    view.unmount()

    const exploding = await renderToday({ [BRIEF_COMPUTE]: () => Promise.reject('brief exploded') })
    click(q(exploding.view.container, '[data-action="recompute-brief"]'))
    await flush()
    expect(text(exploding.view.container, '.gantt-banner')).toBe('brief exploded')
  })

  it('shows the empty hint and a working recompute button without a brief', async () => {
    const { calls, view } = await renderToday({ [DAY]: () => jsonResponse(dayPayload({ brief: null })) })

    expect(text(view.container, '.today-brief .today-muted')).toBe('No daily brief yet.')
    click(q(view.container, '[data-action="recompute-brief"]'))
    await flush()

    expect(calls.some(call => call.path === BRIEF_COMPUTE)).toBe(true)
    expect(dayCalls(calls)).toHaveLength(2)
  })

  it('shows the empty-window hint for a report without slots', async () => {
    const { view } = await renderToday({
      [DAY]: () => jsonResponse(dayPayload({ brief: makeDailyBrief({ slots: [] }) })),
    })
    expect(text(view.container, '.today-brief .today-muted')).toBe('No windows for today.')
  })

  it('renders the Chinese dictionary for the brief section', async () => {
    const { view } = await renderToday({}, { locale: 'zh' })

    expect(text(view.container, '.today-brief .today-section-title')).toBe('今日该动')
    expect(text(view.container, '.today-brief-role')).toBe('主攻')
    expect(text(view.container, '.today-brief-unfilled')).toBe('未填')
    expect(text(view.container, '.today-brief-meta')).toContain('生成于')
    expect(q(view.container, '[data-action="recompute-brief"]').textContent).toBe('重新计算')
  })
})

describe('unified tree nodes', () => {
  it('renders node metadata and the task-source badge on scheduled blocks', async () => {
    const { view } = await renderToday({
      [DAY]: () => jsonResponse(dayPayload({ blocks: [...makePlanBlocks(), makeTaskBlock()] })),
    })

    const block = q(view.container, '.today-block[data-block-id="task|t-1|2026-11-15"]')
    expect(block.getAttribute('data-source')).toBe('task')
    expect(text(block, '.today-source-badge')).toBe('From task tree')
    expect(q(view.container, '.today-block[data-block-id="b1"] .today-source-badge')).toBeNull()

    const node = q(view.container, '.today-node[data-kind="node"]')
    expect(q(node, '.today-node-id').getAttribute('title')).toBe('node:1.8.1')
    expect(qa(node, '.today-chip').map(chip => chip.textContent)).toContain('⤷ client.js')
    expect(qa(node, '.today-chip').map(chip => chip.textContent)).toContain('系统记忆')
  })

  it('falls back to the task id for nodes without a ref and to the link ref without a label', async () => {
    const nodes = [{
      id: 'task-uuid-9',
      kind: 'task',
      trackId: 't1',
      lane: '',
      title: '拆解任务',
      state: '',
      startDate: '2026-11-15',
      endDate: '2026-11-15',
      dep: '',
      doneWhen: '',
      links: [{ type: 'file', ref: 'notes.md' }],
    }]
    const { view } = await renderToday({ [DAY]: () => jsonResponse(dayPayload({ nodes })) })
    const node = q(view.container, '.today-node')

    expect(node.getAttribute('data-kind')).toBe('task')
    expect(text(node, '.today-node-id')).toBe('task-uuid-9')
    expect(q(node, '.today-node-id').getAttribute('title')).toBe('task-uuid-9')
    expect(qa(node, '.today-chip').map(chip => chip.textContent)).toContain('notes.md')
  })
})

describe('date navigation and reload', () => {
  it('steps one day at a time and returns to the server today', async () => {
    const { calls, view } = await renderToday()
    const initialDate = dayDates(calls)[0]
    expect(initialDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const initialLabel = text(view.container, '.today-nav-date')
    expect(initialLabel).not.toBe('')

    click(q(view.container, 'button[aria-label="Previous day"]'))
    await flush()
    expect(dayDates(calls)).toHaveLength(2)
    expect(dayDates(calls)[1]).toBe(shiftIso(initialDate, -1))
    expect(text(view.container, '.today-nav-date')).not.toBe(initialLabel)

    click(q(view.container, 'button[aria-label="Next day"]'))
    await flush()
    expect(dayDates(calls)[2]).toBe(initialDate)

    click(q(view.container, 'button[aria-label="Previous day"]'))
    await flush()
    click(buttonByText(view.container, 'Today'))
    await flush()
    expect(dayDates(calls).at(-1)).toBe(TODAY_DATE)
  })

  it('disables Refresh while a reload is in flight and refetches once', async () => {
    const gate = deferred()
    let attempt = 0
    const { calls, view } = await renderToday({
      [DAY]: () => {
        attempt += 1
        return attempt === 1 ? jsonResponse(dayPayload()) : gate.promise
      },
    })

    const refreshButton = q(view.container, 'button[aria-label="Refresh"]')
    click(refreshButton)
    expect(refreshButton.disabled).toBe(true)
    expect(refreshButton.textContent).toBe('…')

    gate.resolve(jsonResponse(dayPayload()))
    await flush()

    expect(q(view.container, 'button[aria-label="Refresh"]').disabled).toBe(false)
    expect(dayCalls(calls)).toHaveLength(2)
    expect(qa(view.container, '.today-block')).toHaveLength(5)
  })

  it('keeps the day and shows a banner when a refresh fails, then recovers', async () => {
    let attempt = 0
    const { calls, view } = await renderToday({
      [DAY]: () => {
        attempt += 1
        if (attempt === 2) return jsonResponse({ ok: false, error: 'refresh failed' }, 500)
        return jsonResponse(dayPayload())
      },
    })

    click(q(view.container, 'button[aria-label="Refresh"]'))
    await flush()
    expect(qa(view.container, '.today-block')).toHaveLength(5)
    expect(text(view.container, '.gantt-banner')).toContain('refresh failed')

    click(buttonByText(view.container, 'Retry'))
    await flush()
    expect(q(view.container, '.gantt-banner')).toBeNull()
    expect(dayCalls(calls)).toHaveLength(3)
  })
})

describe('block status cycle', () => {
  it('cycles todo, in progress, done, and skipped with one write and one refetch each', async () => {
    const { calls, view } = await renderToday()
    const pill = id => q(view.container, `.today-block[data-block-id="${id}"] .gantt-status`)

    click(pill('b1'))
    await flush()
    click(pill('b2'))
    await flush()
    click(pill('b3'))
    await flush()
    click(pill('b4'))
    await flush()

    expect(calls.filter(call => call.path === STATUS).map(requestBody)).toEqual([
      { id: 'b1', status: 'in_progress' },
      { id: 'b2', status: 'done' },
      { id: 'b3', status: 'skipped' },
      { id: 'b4', status: 'todo' },
    ])
    expect(dayCalls(calls)).toHaveLength(5)
    expect(qa(view.container, '.today-block')).toHaveLength(5)
  })

  it('reports a failed status write in a banner and keeps the day', async () => {
    const { view } = await renderToday({
      [STATUS]: () => jsonResponse({ ok: false, error: 'status is locked' }, 409),
    })

    click(q(view.container, '.today-block[data-block-id="b1"] .gantt-status'))
    await flush()

    expect(text(view.container, '.gantt-banner')).toBe('status is locked')
    expect(qa(view.container, '.today-block')).toHaveLength(5)
  })

  it('stringifies a non-Error status rejection', async () => {
    const { view } = await renderToday({ [STATUS]: () => Promise.reject('status exploded') })

    click(q(view.container, '.today-block[data-block-id="b1"] .gantt-status'))
    await flush()

    expect(text(view.container, '.gantt-banner')).toBe('status exploded')
  })
})

describe('tracker import', () => {
  it('posts the import and refetches the day', async () => {
    const { calls, view } = await renderToday()

    click(buttonByText(view.container, 'Import plan'))
    await flush()

    const importCall = calls.find(call => call.path === IMPORT)
    expect(importCall.options.method).toBe('POST')
    expect(importCall.options.body).toBe('{}')
    expect(importCall.options.headers['content-type']).toBe('application/json')
    expect(text(view.container, '.gantt-toast')).toBe('Plan imported')
    expect(dayCalls(calls)).toHaveLength(2)
  })

  it('disables the import action while the import is in flight', async () => {
    const gate = deferred()
    const { view } = await renderToday({ [IMPORT]: () => gate.promise })

    click(buttonByText(view.container, 'Import plan'))
    expect(buttonByText(view.container, 'Import plan').disabled).toBe(true)

    gate.resolve(jsonResponse({ ok: true, dir: '/tracker', imported: {} }))
    await flush()
    expect(buttonByText(view.container, 'Import plan').disabled).toBe(false)
    expect(text(view.container, '.gantt-toast')).toBe('Plan imported')
  })

  it('reports a failed import with its error message', async () => {
    const { view } = await renderToday({
      [IMPORT]: () => jsonResponse({ ok: false, error: 'tracker dir missing' }, 400),
    })

    click(buttonByText(view.container, 'Import plan'))
    await flush()

    expect(text(view.container, '.gantt-banner')).toBe('Import failed: tracker dir missing')
  })

  it('stringifies a non-Error import rejection', async () => {
    const { view } = await renderToday({ [IMPORT]: () => Promise.reject('disk full') })

    click(buttonByText(view.container, 'Import plan'))
    await flush()

    expect(text(view.container, '.gantt-banner')).toBe('Import failed: disk full')
  })
})

describe('empty and error states', () => {
  it('renders the import-first empty state for an unplanned day', async () => {
    const { calls, view } = await renderToday({ [DAY]: () => jsonResponse(unplannedDayPayload()) })

    expect(text(view.container, '.gantt-empty-title')).toBe('No plan for this day')
    expect(text(view.container, '.gantt-empty-body')).toContain('Import the task tracker')
    expect(qa(view.container, '.today-integrity-item')).toHaveLength(1)
    expect(text(view.container, '.today-integrity-item')).toBe('This day has no plan yet')
    expect(q(view.container, '.today-goal')).toBeNull()
    expect(text(view.container, '.today-market')).toBe('Market closed')

    click(buttonByText(view.container, 'Import now'))
    await flush()
    expect(calls.some(call => call.path === IMPORT)).toBe(true)
  })

  it('shows the error screen and recovers through retry', async () => {
    let attempt = 0
    const { view } = await renderToday({
      [DAY]: () => {
        attempt += 1
        if (attempt === 1) return Promise.reject(new Error('offline'))
        return jsonResponse(dayPayload())
      },
    })

    expect(text(view.container, '.gantt-center')).toContain('Could not load tasks')
    expect(text(view.container, '.gantt-center')).toContain('offline')

    click(buttonByText(view.container, 'Retry'))
    await flush()
    expect(qa(view.container, '.today-block')).toHaveLength(5)
  })

  it('stringifies a non-Error load rejection', async () => {
    const { view } = await renderToday({ [DAY]: () => Promise.reject('offline') })
    expect(text(view.container, '.gantt-center')).toContain('offline')
  })

  it('ignores an abort rejection and stays on the loading spinner', async () => {
    const abort = new Error('The operation was aborted.')
    abort.name = 'AbortError'
    const { view } = await renderToday({ [DAY]: () => Promise.reject(abort) })

    expect(q(view.container, '.gantt-spinner')).not.toBeNull()
    expect(text(view.container, '.gantt-center')).toContain('Loading tasks…')
  })

  it('drops responses and rejections that land after unmount', async () => {
    const resolved = deferred()
    const rejected = deferred()
    let attempt = 0
    installFetch({
      [DAY]: () => {
        attempt += 1
        return attempt === 1 ? resolved.promise : rejected.promise
      },
    })
    const app = setupApp()

    const first = mount(createElement(app.todayPage().component))
    first.unmount()
    resolved.resolve(jsonResponse(dayPayload()))
    await flush()

    const second = mount(createElement(app.todayPage().component))
    second.unmount()
    rejected.reject(new Error('late'))
    await flush()

    expect(qa(document.body, '.today-block')).toHaveLength(0)
  })
})

describe('zh locale', () => {
  it('renders the Chinese dictionary for every Today surface', async () => {
    const { view } = await renderToday({
      [DAY]: () => jsonResponse(dayPayload({ blocks: [...makePlanBlocks(), makeTaskBlock()] })),
    }, { locale: 'zh' })

    expect(text(view.container, '.gantt-title')).toBe('今日安排')
    expect(text(view.container, '.today-market')).toBe('休市')
    expect(text(view.container, '.today-goal .gantt-label')).toBe('核心目标')
    expect(text(view.container, '.today-integrity .today-section-title')).toBe('完整性检查')
    expect(qa(view.container, '.today-slot-title span:first-child').map(element => element.textContent))
      .toEqual(['盘前', '工作时段', '晚间多元格', '未定时'])
    expect(text(view.container, '.today-block[data-block-id="b1"] .gantt-status')).toBe('待开始')
    expect(text(view.container, '.today-nodes .today-section-title')).toBe('本周节点')
    expect(text(view.container, '.today-source-badge')).toBe('来自树节点')

    click(buttonByText(view.container, '导入计划'))
    await flush()
    expect(text(view.container, '.gantt-toast')).toBe('计划已导入')
  })
})
