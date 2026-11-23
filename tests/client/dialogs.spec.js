// Dialog behavior of the Gantt client: create/edit/delete, split, and the data
// API catalog. Every mutation is asserted through the recorded fetch calls so
// the suite proves the wire contract, not just the rendered text.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import {
  buttonByText,
  click,
  deferred,
  dialog,
  dialogTitle,
  flush,
  installFetch,
  jsonResponse,
  keydown,
  mouseEvent,
  mount,
  q,
  qa,
  requestBody,
  row,
  setField,
  setupApp,
  taskForm,
  text,
  unmountAll,
} from './harness.js'
import { metaPayload, mutationTask, treePayload } from './fixtures.js'
import { resetAgentNames } from '../../src/client/agent-labels.js'

const TREE = 'api/gantt/tree'
const TASKS = 'api/gantt/tasks'
const UPDATE = 'api/gantt/task/update'
const STATUS = 'api/gantt/task/status'
const DELETE = 'api/gantt/task/delete'
const SPLIT = 'api/gantt/task/split'
const META = 'api/gantt/meta'
const AGENTS = 'api/gantt/agents'

beforeEach(resetAgentNames)
afterEach(unmountAll)
afterEach(resetAgentNames)

const OK_TASK = () => jsonResponse({ ok: true, task: mutationTask() })

/** Mount the page with every API route stubbed; individual specs override. */
async function renderPage(routes = {}) {
  const fetchState = installFetch({
    [TREE]: () => jsonResponse(treePayload()),
    [TASKS]: () => jsonResponse({ ok: true, task: mutationTask({ id: 'new-1' }) }, 201),
    [UPDATE]: OK_TASK,
    [STATUS]: OK_TASK,
    [DELETE]: () => jsonResponse({ ok: true, deleted: 1 }),
    [SPLIT]: () => jsonResponse({ ok: true, parent: { id: 'c1' } }),
    [META]: () => jsonResponse(metaPayload()),
    [AGENTS]: () => jsonResponse({
      ok: true,
      agents: [
        { id: 'a1', name: 'reviewer' },
        { id: 'a2', name: 'builder' },
      ],
    }),
    ...routes,
  })
  const app = setupApp()
  const view = mount(createElement(app.page().component))
  await flush()
  return { ...fetchState, app, view }
}

function form(view) {
  return taskForm(view.container)
}

function splitRows(view) {
  return qa(view.container, '.gantt-split-row')
}

function splitRowFields(rowElement) {
  const dates = [...rowElement.querySelectorAll('input[type="date"]')]
  return {
    title: rowElement.querySelector('input.gantt-input:not([type])'),
    start: dates[0],
    end: dates[1],
    remove: rowElement.querySelector('button.gantt-icon-btn'),
  }
}

function openCreate(view) {
  click(buttonByText(view.container, 'New task'))
  return form(view)
}

function openEditor(view, label) {
  click(row(view.container, label))
  return form(view)
}

async function fillCreate(view, title = 'Plan release') {
  const fields = openCreate(view)
  setField(fields.title, title)
  return fields
}

describe('create dialog', () => {
  it('validates the title and date range, then posts the new task', async () => {
    const { calls, view } = await renderPage({})
    const fields = openCreate(view)

    expect(dialogTitle(view.container)).toBe('New task')
    // A new task starts on the task-day today, not on a parent range.
    expect(fields.start.value).toBe('2026-11-18')
    expect(fields.end.value).toBe('2026-11-21')
    click(fields.submit)
    expect(q(view.container, '.gantt-form-error').textContent).toBe('Enter a title.')

    setField(fields.title, '  Plan release  ')
    setField(fields.start, '2026-11-10')
    setField(fields.end, '2026-11-05')
    click(fields.submit)
    expect(q(view.container, '.gantt-form-error').textContent).toBe('The end date cannot be before the start date.')

    setField(fields.end, '2026-11-14')
    click(fields.submit)
    await flush()

    const post = calls.find(call => call.path === TASKS)
    expect(post.options.method).toBe('POST')
    expect(requestBody(post)).toEqual({
      title: 'Plan release',
      description: '',
      doneWhen: '',
      inspiration: '',
      parentId: null,
      startDate: '2026-11-10',
      endDate: '2026-11-14',
      status: 'todo',
      progress: 0,
      tags: [],
    })
    expect(text(view.container, '.gantt-toast')).toBe('Task created')
    expect(dialog(view.container)).toBeNull()
    expect(calls.filter(call => call.path === TREE)).toHaveLength(2)
  })

  it('creates a subtask on the creation day, not the parent range, with form-state transitions', async () => {
    const { calls, view } = await renderPage({})
    click(q(row(view.container, '1 Release 2.0'), '.gantt-add-child'))

    const fields = form(view)
    expect(dialogTitle(view.container)).toBe('New task')
    expect(fields.parent.value).toBe('p1')
    // The parent spans 11-05 -> 11-20; a new child still starts today.
    expect(fields.start.value).toBe('2026-11-18')
    expect(fields.end.value).toBe('2026-11-21')

    setField(fields.title, 'Design docs')
    setField(fields.description, 'notes')
    setField(fields.parent, 'p2', 'change')

    setField(fields.status, 'done', 'change')
    expect(fields.progress.value).toBe('100')
    setField(fields.status, 'todo', 'change')
    expect(fields.progress.value).toBe('0')
    setField(fields.status, 'in_progress', 'change')
    expect(fields.progress.value).toBe('50')

    setField(fields.progress, '100')
    expect(fields.status.value).toBe('done')
    setField(fields.progress, '0')
    expect(fields.status.value).toBe('todo')
    setField(fields.progress, '50')
    expect(fields.status.value).toBe('in_progress')
    setField(fields.progress, '25')
    expect(fields.status.value).toBe('in_progress')
    setField(fields.status, 'blocked', 'change')
    expect(fields.progress.value).toBe('25')
    setField(fields.status, 'in_progress', 'change')
    expect(fields.progress.value).toBe('25')

    setField(fields.start, '2026-11-25')
    expect(fields.end.value).toBe('2026-11-25')
    setField(fields.start, '2026-11-22')
    expect(fields.end.value).toBe('2026-11-25')

    click(fields.submit)
    await flush()

    expect(requestBody(calls.find(call => call.path === TASKS))).toEqual({
      title: 'Design docs',
      description: 'notes',
      doneWhen: '',
      inspiration: '',
      parentId: 'p2',
      startDate: '2026-11-22',
      endDate: '2026-11-25',
      status: 'in_progress',
      progress: 25,
      tags: [],
    })
  })

  it('posts the completion standard and source words, trimmed', async () => {
    const { calls, view } = await renderPage({})
    const fields = openCreate(view)
    setField(fields.title, 'Idea with a standard')
    setField(fields.doneWhen, '  The row renders solid  ')
    setField(fields.inspiration, '  用户 11/23：主弹窗找不到灵感字段  ')

    click(fields.submit)
    await flush()

    expect(requestBody(calls.find(call => call.path === TASKS))).toMatchObject({
      title: 'Idea with a standard',
      doneWhen: 'The row renders solid',
      inspiration: '用户 11/23：主弹窗找不到灵感字段',
    })
  })

  it('shows a server error and leaves the dialog open; cancel closes it', async () => {
    const { calls, view } = await renderPage({
      [TASKS]: () => jsonResponse({ ok: false, error: 'duplicate title' }, 409),
    })
    const fields = await fillCreate(view)

    click(fields.submit)
    await flush()

    expect(q(view.container, '.gantt-form-error').textContent).toBe('duplicate title')
    expect(dialog(view.container)).not.toBeNull()

    click(buttonByText(view.container, 'Cancel'))
    expect(dialog(view.container)).toBeNull()
    expect(calls.filter(call => call.path === TASKS)).toHaveLength(1)
  })

  it('stringifies a non-Error creation failure', async () => {
    const { view } = await renderPage({ [TASKS]: () => Promise.reject('create exploded') })
    const fields = await fillCreate(view)

    click(fields.submit)
    await flush()

    expect(q(view.container, '.gantt-form-error').textContent).toBe('create exploded')
    expect(dialog(view.container)).not.toBeNull()
  })

  it('closes from the header button, Escape, and the backdrop only', async () => {
    const { view } = await renderPage({})

    openCreate(view)
    click(q(view.container, '.gantt-dialog-head button'))
    expect(dialog(view.container)).toBeNull()

    openCreate(view)
    keydown(window, 'a')
    expect(dialog(view.container)).not.toBeNull()
    keydown(window, 'Escape')
    expect(dialog(view.container)).toBeNull()

    openCreate(view)
    mouseEvent(q(view.container, '.gantt-dialog'), 'mousedown')
    expect(dialog(view.container)).not.toBeNull()
    mouseEvent(q(view.container, '.gantt-backdrop'), 'mousedown')
    expect(dialog(view.container)).toBeNull()
  })
})

describe('edit dialog', () => {
  it('edits and saves a leaf task with its own fields', async () => {
    const { calls, view } = await renderPage({})
    const fields = openEditor(view, '1.1 Write spec')

    expect(dialogTitle(view.container)).toBe('Edit task · 1.1')
    expect(fields.title.value).toBe('Write spec')
    expect(fields.parent.value).toBe('p1')
    expect(fields.start.value).toBe('2026-11-09')
    expect(fields.end.value).toBe('2026-11-12')
    expect(fields.status.value).toBe('done')
    expect(fields.progress.value).toBe('100')

    setField(fields.title, '  Write the spec ')
    setField(fields.description, 'updated')
    setField(fields.status, 'in_progress', 'change')
    expect(fields.progress.value).toBe('50')
    setField(fields.progress, '25')
    setField(fields.start, '2026-11-08')
    setField(fields.end, '2026-11-13')

    click(fields.submit)
    await flush()

    const update = calls.find(call => call.path === UPDATE)
    expect(requestBody(update)).toEqual({
      id: 'c1',
      title: 'Write the spec',
      description: 'updated',
      doneWhen: '',
      inspiration: '',
      parentId: 'p1',
      startDate: '2026-11-08',
      endDate: '2026-11-13',
      status: 'in_progress',
      progress: 25,
      tags: ['docs', 'urgent'],
    })
    expect(text(view.container, '.gantt-toast')).toBe('Task saved')
    expect(dialog(view.container)).toBeNull()
  })

  it('prefills an unshaped idea and shapes it by filling the standard', async () => {
    const payload = treePayload()
    const idea = payload.tasks[1].children[0]
    idea.inspiration = '用户 11/23：主弹窗找不到灵感字段'
    const { calls, view } = await renderPage({ [TREE]: () => jsonResponse(payload) })

    const fields = openEditor(view, '2.1 Announce')
    expect(fields.inspiration.value).toBe('用户 11/23：主弹窗找不到灵感字段')
    expect(fields.doneWhen.value).toBe('')

    setField(fields.doneWhen, '  两个弹窗字段都能填能改，行转实线  ')
    click(fields.submit)
    await flush()

    expect(requestBody(calls.find(call => call.path === UPDATE))).toMatchObject({
      id: 'c3',
      doneWhen: '两个弹窗字段都能填能改，行转实线',
      inspiration: '用户 11/23：主弹窗找不到灵感字段',
    })
    expect(text(view.container, '.gantt-toast')).toBe('Task saved')
  })

  it('edits a summary task without sending rolled-up fields', async () => {
    const { calls, view } = await renderPage({})
    const fields = openEditor(view, '1 Release 2.0')

    expect(dialogTitle(view.container)).toBe('Edit task · 1')
    expect(fields.start.disabled).toBe(true)
    expect(fields.end.disabled).toBe(true)
    expect(fields.status.disabled).toBe(true)
    expect(fields.progress.disabled).toBe(true)
    expect(q(view.container, '.gantt-hint').textContent).toBe('Dates, status, and progress are rolled up from subtasks.')

    const options = [...fields.parent.options].map(option => option.value)
    expect(options).toEqual(['', 'p2', 'c3', 'p3'])

    setField(fields.title, 'Release 2.1')
    click(fields.submit)
    await flush()

    expect(requestBody(calls.find(call => call.path === UPDATE))).toEqual({
      id: 'p1',
      title: 'Release 2.1',
      description: '',
      doneWhen: '',
      inspiration: '',
      parentId: null,
      tags: [],
    })
  })

  it('shows a server error when saving fails', async () => {
    const { view } = await renderPage({ [UPDATE]: () => jsonResponse({ ok: false, error: 'update rejected' }, 500) })
    const fields = openEditor(view, '1.1 Write spec')

    click(fields.submit)
    await flush()

    expect(q(view.container, '.gantt-form-error').textContent).toBe('update rejected')
    expect(dialog(view.container)).not.toBeNull()
    expect(buttonByText(view.container, 'Save')).not.toBeNull()
  })

  it('deletes the task after a second confirmation click', async () => {
    const { calls, view } = await renderPage({})
    const fields = openEditor(view, '1.1 Write spec')

    click(fields.remove)
    expect(buttonByText(view.container, 'Confirm delete')).not.toBeNull()

    click(buttonByText(view.container, 'Confirm delete'))
    await flush()

    expect(requestBody(calls.find(call => call.path === DELETE))).toEqual({ id: 'c1' })
    expect(text(view.container, '.gantt-toast')).toBe('Task deleted')
    expect(dialog(view.container)).toBeNull()
  })

  it('reports a failed deletion inside the dialog', async () => {
    const { view } = await renderPage({ [DELETE]: () => jsonResponse({ ok: false, error: 'task is pinned' }, 409) })
    const fields = openEditor(view, '1.1 Write spec')

    click(fields.remove)
    click(buttonByText(view.container, 'Confirm delete'))
    await flush()

    expect(q(view.container, '.gantt-form-error').textContent).toBe('task is pinned')
    expect(dialog(view.container)).not.toBeNull()
  })

  it('stringifies a non-Error deletion failure', async () => {
    const { view } = await renderPage({ [DELETE]: () => Promise.reject('delete exploded') })
    const fields = openEditor(view, '1.1 Write spec')

    click(fields.remove)
    click(buttonByText(view.container, 'Confirm delete'))
    await flush()

    expect(q(view.container, '.gantt-form-error').textContent).toBe('delete exploded')
  })

  it('closes an open editor when a refresh no longer contains the task', async () => {
    let attempt = 0
    const { view } = await renderPage({
      [TREE]: () => {
        attempt += 1
        const payload = treePayload()
        if (attempt > 1) payload.tasks[0].children = payload.tasks[0].children.filter(child => child.id !== 'c1')
        return jsonResponse(payload)
      },
    })
    openEditor(view, '1.1 Write spec')
    expect(dialog(view.container)).not.toBeNull()

    click(q(view.container, 'button[aria-label="Refresh"]'))
    await flush()

    expect(dialog(view.container)).toBeNull()
    expect(row(view.container, '1.1 Write spec')).toBeNull()
    expect(q(view.container, '.gantt-row[data-selected="true"]')).toBeNull()
  })
})

describe('task tags', () => {
  it('adds tags by Enter and button, ignoring empty and duplicate input, and posts them', async () => {
    const { calls, view } = await renderPage({})
    const fields = openCreate(view)
    setField(fields.title, 'Tagged task')

    setField(fields.tags, '  docs  ')
    keydown(fields.tags, 'Enter')
    expect(fields.tagChips()).toEqual(['#docs'])
    expect(fields.tags.value).toBe('')

    setField(fields.tags, 'docs')
    click(fields.addTag)
    expect(fields.tagChips()).toEqual(['#docs'])
    expect(fields.tags.value).toBe('docs')

    setField(fields.tags, '   ')
    click(fields.addTag)
    expect(fields.tagChips()).toEqual(['#docs'])

    setField(fields.tags, 'release')
    keydown(fields.tags, 'a')
    expect(fields.tagChips()).toEqual(['#docs'])
    click(fields.addTag)
    expect(fields.tagChips()).toEqual(['#docs', '#release'])
    expect(fields.tags.value).toBe('')

    click(fields.submit)
    await flush()

    expect(requestBody(calls.find(call => call.path === TASKS)).tags).toEqual(['docs', 'release'])
  })

  it('caps the editor at 20 tags and removes a chip', async () => {
    const { view } = await renderPage({})
    const fields = openCreate(view)

    for (let index = 0; index < 20; index += 1) {
      setField(fields.tags, `tag-${index}`)
      click(fields.addTag)
    }
    expect(fields.tagChips()).toHaveLength(20)

    setField(fields.tags, 'tag-21')
    click(fields.addTag)
    expect(fields.tagChips()).toHaveLength(20)
    expect(fields.tagChips()).not.toContain('#tag-21')

    click(fields.tagRemove('tag-0'))
    expect(fields.tagChips()).toHaveLength(19)
    expect(fields.tagChips()).not.toContain('#tag-0')
  })

  it('suggests every tag already in the tree through a datalist', async () => {
    const { view } = await renderPage({})
    const fields = openCreate(view)

    expect(fields.tags.getAttribute('maxLength')).toBe('40')
    expect(fields.tags.getAttribute('list')).toBe('gantt-tag-suggestions')
    expect(fields.tags.getAttribute('placeholder')).toBe('Type a tag and press Enter')
    expect(qa(view.container, '#gantt-tag-suggestions option').map(option => option.value))
      .toEqual(['docs', 'urgent'])
    expect(qa(view.container, '.gantt-dialog .gantt-hint').map(hint => hint.textContent))
      .toContain('Up to 20 tags; press Enter or Add to append one.')
  })

  it('prefills the tags of the edited task and posts the edited list', async () => {
    const { calls, view } = await renderPage({})
    const fields = openEditor(view, '1.1 Write spec')

    expect(fields.tagChips()).toEqual(['#docs', '#urgent'])

    click(fields.tagRemove('docs'))
    setField(fields.tags, 'release')
    click(fields.addTag)
    expect(fields.tagChips()).toEqual(['#urgent', '#release'])

    click(fields.submit)
    await flush()

    expect(requestBody(calls.find(call => call.path === UPDATE)).tags).toEqual(['urgent', 'release'])
  })

  it('creates and edits without tags by posting an empty list', async () => {
    const { calls, view } = await renderPage({})
    const createFields = openCreate(view)
    expect(createFields.tagChips()).toEqual([])
    setField(createFields.title, 'No tags')
    click(createFields.submit)
    await flush()
    expect(requestBody(calls.find(call => call.path === TASKS)).tags).toEqual([])

    const editFields = openEditor(view, '2.1 Announce')
    click(editFields.submit)
    await flush()
    expect(requestBody(calls.find(call => call.path === UPDATE)).tags).toEqual([])
  })
})

describe('write-back info', () => {
  const block = container => q(container, '[data-block="writeback"]')
  const valueOf = (container, name) => text(container, `[data-field="${name}"] .gantt-writeback-value`)

  it('shows the registered operator and completer names with the full report', async () => {
    const { calls, view } = await renderPage({})
    openEditor(view, '1.1 Write spec')
    await flush()

    expect(block(view.container)).not.toBeNull()
    expect(valueOf(view.container, 'operator')).toBe('reviewer')
    expect(valueOf(view.container, 'completedBy')).toBe('builder')
    expect(valueOf(view.container, 'report')).toBe('Spec written and reviewed.\nVerified with tests/client/dialogs.spec.js.')
    expect(q(view.container, '[data-field="report"] .gantt-writeback-report')).not.toBeNull()
    expect(calls.filter(call => call.path === AGENTS)).toHaveLength(1)
  })

  it('localizes an unassigned operator and an empty report', async () => {
    const { view } = await renderPage({})
    openEditor(view, '2.1 Announce')
    await flush()

    expect(valueOf(view.container, 'operator')).toBe('Unassigned')
    expect(valueOf(view.container, 'completedBy')).toBe('Unassigned')
    expect(valueOf(view.container, 'report')).toBe('No report')
  })

  it('falls back to the raw agent ids when the registry request fails', async () => {
    const { view } = await renderPage({
      [AGENTS]: () => jsonResponse({ ok: false, error: 'registry down' }, 500),
    })
    openEditor(view, '1.1 Write spec')
    await flush()

    expect(valueOf(view.container, 'operator')).toBe('a1')
    expect(valueOf(view.container, 'completedBy')).toBe('a2')
    expect(q(view.container, '.gantt-form-error')).toBeNull()
  })

  it('renders no write-back block and loads no registry while creating', async () => {
    const { calls, view } = await renderPage({})
    openCreate(view)

    expect(block(view.container)).toBeNull()
    await flush()
    expect(block(view.container)).toBeNull()
    expect(calls.filter(call => call.path === AGENTS)).toHaveLength(0)
  })

  it('ignores a registry response that arrives after the dialog closed', async () => {
    const agents = deferred()
    const { view } = await renderPage({ [AGENTS]: () => agents.promise })
    openEditor(view, '1.1 Write spec')

    expect(valueOf(view.container, 'operator')).toBe('a1')
    click(buttonByText(view.container, 'Cancel'))
    expect(dialog(view.container)).toBeNull()

    agents.resolve(jsonResponse({ ok: true, agents: [{ id: 'a1', name: 'reviewer' }] }))
    await flush()

    expect(dialog(view.container)).toBeNull()
    expect(view.container.textContent).not.toContain('reviewer')
  })
})

describe('split dialog', () => {
  it('splits a multi-day task into two child rows', async () => {
    const { calls, view } = await renderPage({})
    const editor = openEditor(view, '1.1 Write spec')
    click(editor.split)

    expect(dialogTitle(view.container)).toBe('Split task · 1.1 Write spec')
    const rows = splitRows(view)
    expect(rows).toHaveLength(2)
    expect(splitRowFields(rows[0]).start.value).toBe('2026-11-09')
    expect(splitRowFields(rows[0]).end.value).toBe('2026-11-10')
    expect(splitRowFields(rows[1]).start.value).toBe('2026-11-11')
    expect(splitRowFields(rows[1]).end.value).toBe('2026-11-12')

    setField(splitRowFields(rows[0]).title, 'Part one')
    setField(splitRowFields(rows[1]).title, 'Part two')
    click(buttonByText(view.container, 'Split'))
    await flush()

    expect(requestBody(calls.find(call => call.path === SPLIT))).toEqual({
      id: 'c1',
      children: [
        { title: 'Part one', startDate: '2026-11-09', endDate: '2026-11-10', status: 'todo', progress: 0 },
        { title: 'Part two', startDate: '2026-11-11', endDate: '2026-11-12', status: 'todo', progress: 0 },
      ],
    })
    expect(text(view.container, '.gantt-toast')).toBe('Subtasks created')
    expect(dialog(view.container)).toBeNull()
  })

  it('validates rows and supports adding and removing them', async () => {
    const { calls, view } = await renderPage({})
    const editor = openEditor(view, '1.1 Write spec')
    click(editor.split)

    click(buttonByText(view.container, 'Split'))
    expect(q(view.container, '.gantt-form-error').textContent).toBe('Every subtask needs a title and a valid date range.')

    let rows = splitRows(view)
    setField(splitRowFields(rows[0]).title, 'Part one')
    setField(splitRowFields(rows[1]).end, '2026-11-01')
    click(buttonByText(view.container, 'Split'))
    expect(q(view.container, '.gantt-form-error').textContent).toBe('Every subtask needs a title and a valid date range.')

    setField(splitRowFields(rows[1]).end, '2026-11-14')
    setField(splitRowFields(rows[1]).title, 'Part two')

    click(buttonByText(view.container, 'Add subtask row'))
    rows = splitRows(view)
    expect(rows).toHaveLength(3)
    expect(splitRowFields(rows[2]).start.value).toBe('2026-11-15')
    expect(splitRowFields(rows[2]).end.value).toBe('2026-11-16')

    setField(splitRowFields(rows[2]).title, 'Part three')
    setField(splitRowFields(rows[2]).start, '2026-11-20')
    expect(splitRowFields(rows[2]).end.value).toBe('2026-11-20')
    setField(splitRowFields(rows[0]).start, '2026-11-08')
    expect(splitRowFields(rows[0]).end.value).toBe('2026-11-10')

    click(splitRowFields(rows[2]).remove)
    rows = splitRows(view)
    expect(rows).toHaveLength(2)

    click(splitRowFields(rows[1]).remove)
    rows = splitRows(view)
    expect(rows).toHaveLength(1)
    expect(splitRowFields(rows[0]).remove.disabled).toBe(true)

    click(buttonByText(view.container, 'Add subtask row'))
    rows = splitRows(view)
    expect(rows).toHaveLength(2)
    expect(splitRowFields(rows[1]).start.value).toBe('2026-11-11')
    expect(splitRowFields(rows[1]).end.value).toBe('2026-11-12')
    click(splitRowFields(rows[1]).remove)
    expect(splitRows(view)).toHaveLength(1)

    click(buttonByText(view.container, 'Split'))
    await flush()

    expect(requestBody(calls.find(call => call.path === SPLIT)).children).toHaveLength(1)
  })

  it('splits a one-day task and appends a follow-up row', async () => {
    const { calls, view } = await renderPage({})
    const editor = openEditor(view, '2.1 Announce')
    click(editor.split)

    let rows = splitRows(view)
    expect(rows).toHaveLength(1)
    expect(splitRowFields(rows[0]).start.value).toBe('2026-11-16')
    expect(splitRowFields(rows[0]).end.value).toBe('2026-11-16')

    click(buttonByText(view.container, 'Add subtask row'))
    rows = splitRows(view)
    expect(rows).toHaveLength(2)
    expect(splitRowFields(rows[1]).start.value).toBe('2026-11-17')
    expect(splitRowFields(rows[1]).end.value).toBe('2026-11-18')

    setField(splitRowFields(rows[0]).title, 'Same day')
    setField(splitRowFields(rows[1]).title, 'Next day')
    click(buttonByText(view.container, 'Split'))
    await flush()

    expect(requestBody(calls.find(call => call.path === SPLIT)).children.map(child => child.title))
      .toEqual(['Same day', 'Next day'])
  })

  it('stringifies a non-Error split failure', async () => {
    const { view } = await renderPage({ [SPLIT]: () => Promise.reject('split exploded') })
    const editor = openEditor(view, '2.1 Announce')
    click(editor.split)

    const rows = splitRows(view)
    setField(splitRowFields(rows[0]).title, 'Only child')
    click(buttonByText(view.container, 'Split'))
    await flush()

    expect(q(view.container, '.gantt-form-error').textContent).toBe('split exploded')
  })

  it('reports a failed split and closes on cancel', async () => {
    const { view } = await renderPage({ [SPLIT]: () => jsonResponse({ ok: false, error: 'children overlap' }, 409) })
    const editor = openEditor(view, '2.1 Announce')
    click(editor.split)

    const rows = splitRows(view)
    setField(splitRowFields(rows[0]).title, 'Only child')
    click(buttonByText(view.container, 'Split'))
    await flush()
    expect(q(view.container, '.gantt-form-error').textContent).toBe('children overlap')

    click(buttonByText(view.container, 'Cancel'))
    expect(dialog(view.container)).toBeNull()
  })
})

describe('API dialog', () => {
  it('renders database metadata and the endpoint catalog', async () => {
    const { calls, view } = await renderPage({})
    click(buttonByText(view.container, 'API'))

    expect(dialogTitle(view.container)).toBe('Data API')
    expect(view.container.textContent).toContain('Loading endpoint catalog…')
    await flush()

    const codes = qa(view.container, '.gantt-api-meta code').map(element => element.textContent)
    expect(codes).toEqual(['/data/home/ws-plugin/dsh-gantt/.tmp/gantt.db', 'node:sqlite'])
    expect(view.container.textContent).toContain('Authentication: the browser session cookie; no separate port or token.')

    const rows = qa(view.container, '.gantt-api-row')
    expect(rows).toHaveLength(5)
    expect(q(rows[0], '.gantt-method').getAttribute('data-method')).toBe('GET')
    expect(q(rows[0], '.gantt-api-path').textContent).toBe('/api/gantt/tree')
    expect(q(rows[0], '.gantt-api-desc').textContent)
      .toBe('Read the task tree with hierarchical numbers, rollups, and stats.')
    expect(q(rows[2], '.gantt-method').getAttribute('data-method')).toBe('POST')
    expect(q(rows[4], '.gantt-api-desc').textContent).toBe('Custom endpoint from the host.')
    expect(calls.filter(call => call.path === META)).toHaveLength(1)

    click(buttonByText(view.container, 'Close'))
    expect(dialog(view.container)).toBeNull()
  })

  it('reports meta failures and tolerates a minimal payload', async () => {
    const failing = await renderPage({ [META]: () => jsonResponse({ ok: false, error: 'meta unavailable' }, 500) })
    click(buttonByText(failing.view.container, 'API'))
    await flush()
    expect(q(failing.view.container, '.gantt-form-error').textContent).toBe('meta unavailable')
    expect(qa(failing.view.container, '.gantt-api-row')).toHaveLength(0)
    click(buttonByText(failing.view.container, 'Close'))
    failing.view.unmount()

    const minimal = await renderPage({ [META]: () => jsonResponse({ ok: true }) })
    click(buttonByText(minimal.view.container, 'API'))
    await flush()
    expect(qa(minimal.view.container, '.gantt-api-meta code').map(element => element.textContent))
      .toEqual(['—', '—'])
    expect(qa(minimal.view.container, '.gantt-api-row')).toHaveLength(0)
  })

  it('stringifies a non-Error meta failure', async () => {
    const { view } = await renderPage({ [META]: () => Promise.reject('meta exploded') })
    click(buttonByText(view.container, 'API'))
    await flush()

    expect(q(view.container, '.gantt-form-error').textContent).toBe('meta exploded')
  })

  it('ignores a meta response that arrives after the dialog closed', async () => {
    const { view } = await renderPage({})
    click(buttonByText(view.container, 'API'))
    click(buttonByText(view.container, 'Close'))
    expect(dialog(view.container)).toBeNull()
    await flush()
    expect(dialog(view.container)).toBeNull()
  })

  it('ignores a failed meta response that arrives after the dialog closed', async () => {
    const { view } = await renderPage({ [META]: () => jsonResponse({ ok: false, error: 'late failure' }, 500) })
    click(buttonByText(view.container, 'API'))
    click(buttonByText(view.container, 'Close'))
    await flush()
    expect(dialog(view.container)).toBeNull()
    expect(view.container.textContent).not.toContain('late failure')
  })
})

describe('capture dialog', () => {
  const captureFields = view => ({
    parent: q(view.container, '.gantt-dialog .gantt-select'),
    title: q(view.container, '.gantt-dialog input.gantt-input:not([type])'),
    inspiration: q(view.container, '.gantt-dialog textarea[data-field="inspiration"]'),
    submit: q(view.container, '.gantt-dialog [data-action="capture-submit"]'),
    hint: () => text(view.container, '.gantt-dialog .gantt-hint'),
  })

  it('captures a trimmed idea with its source words under the chosen branch', async () => {
    const { calls, view } = await renderPage({})
    click(buttonByText(view.container, 'Capture'))

    expect(dialogTitle(view.container)).toBe('Capture an idea')
    const fields = captureFields(view)
    expect(fields.hint()).toBe('Unshaped by design: no completion standard, placeholder dates. Shape it from the row once you pick it up.')
    expect(fields.parent.value).toBe('')

    click(fields.submit)
    expect(q(view.container, '.gantt-form-error').textContent).toBe('Enter a title.')

    setField(fields.title, '  财务雷点 predict-L2  ')
    click(fields.submit)
    expect(q(view.container, '.gantt-form-error').textContent).toBe('Enter the words that sparked the idea.')

    setField(fields.inspiration, '  用户 11/23：现金流跟利润不匹配  ')
    setField(fields.parent, 'p1', 'change')
    click(fields.submit)
    await flush()

    const post = calls.find(call => call.path === TASKS)
    expect(requestBody(post)).toEqual({
      title: '财务雷点 predict-L2',
      parentId: 'p1',
      status: 'todo',
      inspiration: '用户 11/23：现金流跟利润不匹配',
    })
    expect(text(view.container, '.gantt-toast')).toBe('Idea captured')
    expect(dialog(view.container)).toBeNull()
    expect(calls.filter(call => call.path === TREE)).toHaveLength(2)
  })

  it('defaults the parent to the selected row', async () => {
    const { view } = await renderPage({})
    click(row(view.container, '1.1 Write spec'))
    expect(dialogTitle(view.container)).toBe('Edit task · 1.1')

    click(buttonByText(view.container, 'Capture'))
    const fields = captureFields(view)
    expect(fields.parent.value).toBe('c1')
    expect(fields.inspiration.value).toBe('')
    expect(fields.title.value).toBe('')
  })

  it('keeps the dialog open and reports the failure', async () => {
    const { view } = await renderPage({ [TASKS]: () => jsonResponse({ ok: false, error: 'capture rejected' }, 500) })
    click(buttonByText(view.container, 'Capture'))
    const fields = captureFields(view)
    setField(fields.title, 'Idea')
    setField(fields.inspiration, 'Origin words')
    click(fields.submit)
    await flush()

    expect(q(view.container, '.gantt-form-error').textContent).toBe('capture rejected')
    expect(dialog(view.container)).not.toBeNull()
    expect(q(view.container, '.gantt-toast')).toBeNull()
  })

  it('shows the pending state while the capture is in flight', async () => {
    const gate = deferred()
    const { view } = await renderPage({ [TASKS]: () => gate.promise })
    click(buttonByText(view.container, 'Capture'))
    const fields = captureFields(view)
    setField(fields.title, 'Idea')
    setField(fields.inspiration, 'Origin words')

    click(fields.submit)
    expect(fields.submit.textContent).toBe('…')
    expect(fields.submit.disabled).toBe(true)

    gate.resolve(jsonResponse({ ok: true, task: mutationTask({ id: 'new-2' }) }, 201))
    await flush()
    expect(text(view.container, '.gantt-toast')).toBe('Idea captured')
    expect(dialog(view.container)).toBeNull()
  })

  it('stringifies a non-Error capture failure', async () => {
    const { view } = await renderPage({ [TASKS]: () => Promise.reject('capture exploded') })
    click(buttonByText(view.container, 'Capture'))
    const fields = captureFields(view)
    setField(fields.title, 'Idea')
    setField(fields.inspiration, 'Origin words')
    click(fields.submit)
    await flush()

    expect(q(view.container, '.gantt-form-error').textContent).toBe('capture exploded')
    expect(dialog(view.container)).not.toBeNull()
  })

  it('closes from the cancel button without posting', async () => {
    const { calls, view } = await renderPage({})
    click(buttonByText(view.container, 'Capture'))
    click(buttonByText(view.container, 'Cancel'))
    expect(dialog(view.container)).toBeNull()
    expect(calls.filter(call => call.path === TASKS)).toHaveLength(0)
  })
})
