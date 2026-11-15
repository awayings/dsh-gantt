// Decompose and schedule dialogs: row actions, defaults, validation, and the
// exact request bodies they send to `task/decompose` and `task/schedule`.
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import {
  buttonByText,
  click,
  dialog,
  dialogTitle,
  flush,
  installFetch,
  jsonResponse,
  mount,
  q,
  qa,
  requestBody,
  row,
  setField,
  setupApp,
  text,
  unmountAll,
} from './harness.js'
import { unifiedTreePayload } from './fixtures.js'

const TREE = 'api/gantt/tree'
const DECOMPOSE = 'api/gantt/task/decompose'
const SCHEDULE = 'api/gantt/task/schedule'

afterEach(unmountAll)

function localDate(offset = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function tomorrow() {
  return localDate(1)
}

async function renderPage(routes = {}) {
  const fetchState = installFetch({
    [TREE]: () => jsonResponse(unifiedTreePayload()),
    [DECOMPOSE]: () => jsonResponse({ ok: true, parent: { id: 'n2' }, children: [], blocks: [] }),
    [SCHEDULE]: () => jsonResponse({ ok: true, task: { id: 'n2' }, block: { id: 'b1' } }),
    ...routes,
  })
  const app = setupApp()
  const view = mount(createElement(app.page().component))
  await flush()
  return { ...fetchState, app, view }
}

function action(view, label, kind) {
  return q(row(view.container, label), `.gantt-row-action[data-action="${kind}"]`)
}

function openDecompose(view) {
  click(action(view, '1.8 交易仓', 'decompose'))
}

function openSchedule(view) {
  click(action(view, '1.1 数据底座', 'schedule'))
}

function decomposeRows(view) {
  return qa(view.container, '.gantt-decompose-row')
}

function decomposeFields(view, index = 0) {
  const rowElement = decomposeRows(view)[index]
  const field = key => rowElement.querySelector(`[data-field="${key}"]`)
  return {
    title: field('title'),
    doneWhen: field('doneWhen'),
    landing: field('landing'),
    estimate: field('estimate'),
    category: field('category'),
    inspiration: field('inspiration'),
    start: field('startDate'),
    end: field('endDate'),
    planDate: field('planDate'),
    planTime: field('planTime'),
    remove: rowElement.querySelector('.gantt-decompose-head button'),
  }
}

function scheduleField(view, key) {
  return q(view.container, `.gantt-dialog [data-field="${key}"]`)
}

describe('decompose dialog', () => {
  it('opens from a node row action with a parent summary and plan defaults', async () => {
    const { view } = await renderPage()
    openDecompose(view)

    expect(dialog(view.container)).not.toBeNull()
    expect(dialogTitle(view.container)).toBe('Decompose node · 1.8 交易仓')
    expect(text(view.container, '.gantt-parent-summary')).toContain('交易仓')
    expect(text(view.container, '.gantt-parent-summary')).toContain('卡住')
    expect(text(view.container, '.gantt-dialog-note')).toContain('decomposition itself takes a slot')

    const fields = decomposeFields(view)
    expect(decomposeRows(view)).toHaveLength(1)
    expect(fields.title.value).toBe('')
    expect(fields.doneWhen.value).toBe('')
    expect(fields.planDate.value).toBe(tomorrow())
    expect(fields.planTime.value).toBe('21:00')
    expect(fields.start.value).toBe(tomorrow())
    expect(fields.end.value).toBe(tomorrow())
    expect(fields.remove.disabled).toBe(true)
    expect(buttonByText(view.container, 'Decompose')).not.toBeNull()
    expect(dialog(view.container).getAttribute('role')).toBe('dialog')
  })

  it('requires a title and a done-when standard for every child', async () => {
    const { calls, view } = await renderPage()
    openDecompose(view)

    click(buttonByText(view.container, 'Decompose'))
    expect(text(view.container, '.gantt-form-error')).toBe('Each child needs a title and a done-when standard.')

    const fields = decomposeFields(view)
    setField(fields.title, '读数收口')
    click(buttonByText(view.container, 'Decompose'))
    expect(text(view.container, '.gantt-form-error')).toBe('Each child needs a title and a done-when standard.')

    setField(fields.doneWhen, '读数写进策略账本')
    setField(fields.start, '2026-11-20')
    setField(fields.end, '2026-11-18')
    click(buttonByText(view.container, 'Decompose'))
    expect(text(view.container, '.gantt-form-error')).toBe('The end date cannot be before the start date.')
    expect(calls.filter(call => call.path === DECOMPOSE)).toHaveLength(0)
  })

  it('posts children with their optional plan and shows the scheduled toast', async () => {
    const { calls, view } = await renderPage()
    openDecompose(view)
    const fields = decomposeFields(view)

    setField(fields.title, '  读数收口 ')
    setField(fields.doneWhen, ' 读数写进策略账本 ')
    setField(fields.landing, 'invest/strategy-ledger.md')
    setField(fields.estimate, '2h')
    setField(fields.category, 'A 主攻片')
    setField(fields.inspiration, '#21')
    setField(fields.start, '2026-11-19')
    setField(fields.end, '2026-11-20')
    setField(fields.planDate, '2026-11-20')
    setField(fields.planTime, '20:00')

    click(buttonByText(view.container, 'Decompose'))
    await flush()

    expect(requestBody(calls.find(call => call.path === DECOMPOSE))).toEqual({
      id: 'n2',
      children: [{
        title: '读数收口',
        doneWhen: '读数写进策略账本',
        landing: 'invest/strategy-ledger.md',
        estimate: '2h',
        category: 'A 主攻片',
        inspiration: '#21',
        startDate: '2026-11-19',
        endDate: '2026-11-20',
        plan: { date: '2026-11-20', startTime: '20:00' },
      }],
    })
    expect(text(view.container, '.gantt-toast')).toBe('Decomposed 1 subtasks, 1 scheduled into 2026-11-20')
    expect(dialog(view.container)).toBeNull()
    expect(calls.filter(call => call.path === TREE)).toHaveLength(2)
    expect(row(view.container, '1.8 交易仓').getAttribute('data-selected')).toBe('true')
  })

  it('adds and removes child rows and omits a cleared plan', async () => {
    const { calls, view } = await renderPage()
    openDecompose(view)

    click(buttonByText(view.container, '+ Add subtask row'))
    expect(decomposeRows(view)).toHaveLength(2)
    expect(decomposeFields(view, 1).planDate.value).toBe(tomorrow())
    expect(decomposeFields(view, 0).remove.disabled).toBe(false)

    const first = decomposeFields(view, 0)
    const second = decomposeFields(view, 1)
    setField(first.title, 'Part one')
    setField(first.doneWhen, 'First is done')
    setField(second.title, 'Part two')
    setField(second.doneWhen, 'Second is done')

    click(second.remove)
    expect(decomposeRows(view)).toHaveLength(1)
    expect(decomposeFields(view, 0).remove.disabled).toBe(true)

    click(buttonByText(view.container, 'Decompose'))
    await flush()

    const body = requestBody(calls.find(call => call.path === DECOMPOSE))
    expect(body.children).toHaveLength(1)
    expect(body.children[0].title).toBe('Part one')
    expect(body.children[0].plan).toEqual({ date: tomorrow(), startTime: '21:00' })
  })

  it('sends children with a plan date but no plan time, and without any plan', async () => {
    const { calls, view } = await renderPage()
    openDecompose(view)
    const first = decomposeFields(view)
    setField(first.title, 'Planned child')
    setField(first.doneWhen, 'Done')

    click(buttonByText(view.container, '+ Add subtask row'))
    const second = decomposeFields(view, 1)
    setField(second.title, 'No time child')
    setField(second.doneWhen, 'Done too')
    setField(second.planTime, '')

    click(buttonByText(view.container, 'Decompose'))
    await flush()

    const body = requestBody(calls.find(call => call.path === DECOMPOSE))
    expect(body.children[0].plan).toEqual({ date: tomorrow(), startTime: '21:00' })
    expect(body.children[1].plan).toEqual({ date: tomorrow() })
  })

  it('reports a decomposition without scheduling when the plan date is cleared', async () => {
    const { calls, view } = await renderPage()
    openDecompose(view)
    const fields = decomposeFields(view)
    setField(fields.title, 'Only child')
    setField(fields.doneWhen, 'Done')
    setField(fields.planDate, '')
    setField(fields.start, '')
    setField(fields.end, '')

    click(buttonByText(view.container, 'Decompose'))
    await flush()

    const child = requestBody(calls.find(call => call.path === DECOMPOSE)).children[0]
    expect(child.plan).toBeUndefined()
    // cleared date inputs are dropped from the request so the host falls back
    expect(child.startDate).toBeUndefined()
    expect(child.endDate).toBeUndefined()
    expect(text(view.container, '.gantt-toast')).toBe('Decomposed 1 subtasks (none scheduled yet)')
  })

  it('tolerates a parent summary without state and a response without a parent', async () => {
    const tasks = unifiedTreePayload().tasks
    tasks[0].children[1].state = ''
    const { calls, view } = await renderPage({
      [TREE]: () => jsonResponse(unifiedTreePayload({ tasks })),
      [DECOMPOSE]: () => jsonResponse({ ok: true, children: [], blocks: [] }),
    })
    openDecompose(view)
    expect(qa(view.container, '.gantt-parent-summary .gantt-row-chip')).toHaveLength(0)

    const fields = decomposeFields(view)
    setField(fields.title, 'Baseline fix')
    setField(fields.doneWhen, 'Baseline is covered')
    click(buttonByText(view.container, 'Decompose'))
    await flush()

    expect(dialog(view.container)).toBeNull()
    expect(calls.filter(call => call.path === TREE)).toHaveLength(2)
    expect(row(view.container, '1.8 交易仓').getAttribute('data-selected')).toBe('true')
  })

  it('keeps the dialog open on server and non-Error failures', async () => {
    const failing = await renderPage({
      [DECOMPOSE]: () => jsonResponse({ ok: false, error: 'depth 4 exceeded' }, 400),
    })
    openDecompose(failing.view)
    const fields = decomposeFields(failing.view)
    setField(fields.title, 'Too deep')
    setField(fields.doneWhen, 'Nope')
    click(buttonByText(failing.view.container, 'Decompose'))
    await flush()
    expect(text(failing.view.container, '.gantt-form-error')).toBe('depth 4 exceeded')
    expect(dialog(failing.view.container)).not.toBeNull()
    click(buttonByText(failing.view.container, 'Cancel'))
    expect(dialog(failing.view.container)).toBeNull()
    failing.view.unmount()

    const exploding = await renderPage({ [DECOMPOSE]: () => Promise.reject('decompose exploded') })
    openDecompose(exploding.view)
    const explodingFields = decomposeFields(exploding.view)
    setField(explodingFields.title, 'Boom')
    setField(explodingFields.doneWhen, 'Boom')
    click(buttonByText(exploding.view.container, 'Decompose'))
    await flush()
    expect(text(exploding.view.container, '.gantt-form-error')).toBe('decompose exploded')
  })
})

describe('schedule dialog', () => {
  it('opens from a node row action and prefills the node fields', async () => {
    const { view } = await renderPage()
    openSchedule(view)

    expect(dialogTitle(view.container)).toBe('Schedule into day plan · 1.1 数据底座')
    expect(text(view.container, '.gantt-dialog-note')).toContain('lands on the chosen day')
    expect(scheduleField(view, 'date').value).toBe(tomorrow())
    expect(scheduleField(view, 'startTime').value).toBe('21:00')
    expect(scheduleField(view, 'endTime').value).toBe('22:00')
    expect(scheduleField(view, 'category').value).toBe('A 主攻片')
    expect(scheduleField(view, 'landing').value).toBe('invest/data.md')
    expect(scheduleField(view, 'estimate').value).toBe('2h')
    expect(scheduleField(view, 'inspiration').value).toBe('#21')
    expect(buttonByText(view.container, 'Schedule')).not.toBeNull()
  })

  it('requires a date and an ordered time range', async () => {
    const { calls, view } = await renderPage()
    openSchedule(view)

    setField(scheduleField(view, 'date'), '')
    click(buttonByText(view.container, 'Schedule'))
    expect(text(view.container, '.gantt-form-error')).toBe('Pick a day to schedule this into.')

    setField(scheduleField(view, 'date'), '2026-11-20')
    setField(scheduleField(view, 'endTime'), '09:00')
    click(buttonByText(view.container, 'Schedule'))
    expect(text(view.container, '.gantt-form-error')).toBe('The end time cannot be before the start time.')
    expect(calls.filter(call => call.path === SCHEDULE)).toHaveLength(0)
  })

  it('posts the prefilled schedule and refreshes the tree', async () => {
    const { calls, view } = await renderPage()
    openSchedule(view)
    setField(scheduleField(view, 'date'), '2026-11-20')

    click(buttonByText(view.container, 'Schedule'))
    await flush()

    expect(requestBody(calls.find(call => call.path === SCHEDULE))).toEqual({
      id: 'n1',
      date: '2026-11-20',
      startTime: '21:00',
      endTime: '22:00',
      category: 'A 主攻片',
      landing: 'invest/data.md',
      estimate: '2h',
      inspiration: '#21',
    })
    expect(text(view.container, '.gantt-toast')).toBe('Scheduled into 2026-11-20')
    expect(dialog(view.container)).toBeNull()
    expect(calls.filter(call => call.path === TREE)).toHaveLength(2)
  })

  it('omits cleared optional fields from the request body', async () => {
    const { calls, view } = await renderPage()
    openSchedule(view)
    for (const key of ['startTime', 'endTime', 'category', 'landing', 'estimate', 'inspiration']) {
      setField(scheduleField(view, key), '')
    }
    setField(scheduleField(view, 'date'), '2026-11-21')

    click(buttonByText(view.container, 'Schedule'))
    await flush()

    expect(requestBody(calls.find(call => call.path === SCHEDULE))).toEqual({ id: 'n1', date: '2026-11-21' })
  })

  it('defaults missing node fields and tolerates a response without a task', async () => {
    const { calls, view } = await renderPage({
      [SCHEDULE]: () => jsonResponse({ ok: true, block: { id: 'b9' } }),
    })
    click(action(view, '1.8 交易仓', 'schedule'))

    expect(dialogTitle(view.container)).toBe('Schedule into day plan · 1.8 交易仓')
    for (const key of ['category', 'landing', 'estimate', 'inspiration']) {
      expect(scheduleField(view, key).value).toBe('')
    }

    click(buttonByText(view.container, 'Schedule'))
    await flush()

    expect(requestBody(calls.find(call => call.path === SCHEDULE))).toEqual({
      id: 'n2',
      date: tomorrow(),
      startTime: '21:00',
      endTime: '22:00',
    })
    expect(text(view.container, '.gantt-toast')).toBe(`Scheduled into ${tomorrow()}`)
    expect(row(view.container, '1.8 交易仓').getAttribute('data-selected')).toBe('true')
  })

  it('keeps the dialog open on server and non-Error failures', async () => {
    const failing = await renderPage({
      [SCHEDULE]: () => jsonResponse({ ok: false, error: 'date is closed' }, 409),
    })
    openSchedule(failing.view)
    click(buttonByText(failing.view.container, 'Schedule'))
    await flush()
    expect(text(failing.view.container, '.gantt-form-error')).toBe('date is closed')
    expect(dialog(failing.view.container)).not.toBeNull()
    click(buttonByText(failing.view.container, 'Cancel'))
    expect(dialog(failing.view.container)).toBeNull()
    failing.view.unmount()

    const exploding = await renderPage({ [SCHEDULE]: () => Promise.reject('schedule exploded') })
    openSchedule(exploding.view)
    click(buttonByText(exploding.view.container, 'Schedule'))
    await flush()
    expect(text(exploding.view.container, '.gantt-form-error')).toBe('schedule exploded')
  })
})

describe('row actions', () => {
  it('does not open the editor and is hidden on track rows', async () => {
    const { view } = await renderPage()

    expect(action(view, '1 投资系统', 'decompose')).toBeNull()
    expect(action(view, '1 投资系统', 'schedule')).toBeNull()

    click(action(view, '1.1 数据底座', 'decompose'))
    expect(dialogTitle(view.container)).toBe('Decompose node · 1.1 数据底座')
    click(buttonByText(view.container, 'Cancel'))
    expect(dialog(view.container)).toBeNull()

    click(action(view, '1.1 数据底座', 'schedule'))
    expect(dialogTitle(view.container)).toBe('Schedule into day plan · 1.1 数据底座')
  })

  it('renders the localized action labels in the Chinese dictionary', async () => {
    installFetch({ [TREE]: () => jsonResponse(unifiedTreePayload()) })
    const app = setupApp({ locale: 'zh' })
    const view = mount(createElement(app.page().component))
    await flush()

    const decompose = q(row(view.container, '1.1 数据底座'), '.gantt-row-action[data-action="decompose"]')
    expect(decompose.getAttribute('title')).toBe('拆解为子任务')
    expect(q(row(view.container, '1.1 数据底座'), '.gantt-row-action[data-action="schedule"]').getAttribute('title'))
      .toBe('排入某天计划')
  })
})
