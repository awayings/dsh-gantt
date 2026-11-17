// Workbench task view's editable prompt: Execute and Decompose append the
// user's instructions to their fixed base prompt, and Send delivers the editor
// content alone through the same create → queue → hand-off path. A successful
// turn clears the editor; a failure keeps the text so it can be retried.
import { afterEach, describe, expect, it } from 'vitest'
import {
  click,
  deferred,
  flush,
  installFetch,
  jsonResponse,
  q,
  requestBody,
  setField,
  text,
  unmountAll,
} from './harness.js'
import {
  FOCUS_SET,
  WORK_WITHOUT_SESSION,
  defaultRoutes,
  fakeServices,
  fakeWindow,
  handoff,
  renderWorkbench,
  stubOpen,
} from './workbench-fixtures.js'

const PROMPT_FIELD = '[data-field="prompt"]'

/** The editor's current value. */
function promptValue(container) {
  return q(container, PROMPT_FIELD).value
}

describe('editable prompt', () => {
  it('renders an empty editor with its label and placeholder', async () => {
    installFetch(defaultRoutes())
    const { view } = renderWorkbench()
    await flush()

    const input = q(view.container, PROMPT_FIELD)
    expect(input).not.toBeNull()
    expect(input.value).toBe('')
    expect(input.getAttribute('placeholder')).toBe('Appended to Execute and Decompose; Send delivers it alone.')
    expect(text(view.container, '.gantt-workbench-prompt-label')).toBe('Extra instructions (optional)')
    expect(q(view.container, '[data-action="send"]').disabled).toBe(true)
  })

  it('localizes the editor through the host dictionary', async () => {
    installFetch(defaultRoutes())
    const { view } = renderWorkbench({ locale: 'zh' })
    await flush()
    expect(text(view.container, '.gantt-workbench-prompt-label')).toBe('补充说明（可选）')
    expect(text(view.container, '[data-action="send"]')).toBe('发送')
    expect(q(view.container, PROMPT_FIELD).getAttribute('placeholder'))
      .toBe('会追加在「执行/拆解」之后；「发送」只发这段内容。')
  })

  it('appends the instructions to the execute prompt', async () => {
    stubOpen(fakeWindow())
    installFetch(defaultRoutes())
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    setField(q(view.container, PROMPT_FIELD), 'Also update the docs.')
    expect(promptValue(view.container)).toBe('Also update the docs.')
    click(q(view.container, '[data-action="execute"]'))
    await flush()

    expect(services.prompts).toEqual([{
      sessionId: 'session-work',
      text: 'Complete this task.\n\nAlso update the docs.',
    }])
    expect(promptValue(view.container)).toBe('')
  })

  it('appends the instructions to the decompose prompt', async () => {
    stubOpen(fakeWindow())
    installFetch(defaultRoutes())
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    setField(q(view.container, PROMPT_FIELD), 'Split off the docs task.')
    click(q(view.container, '[data-action="decompose"]'))
    await flush()

    expect(services.prompts).toEqual([{
      sessionId: 'session-work',
      text: 'Decompose this task into subtasks.\n\nSplit off the docs task.',
    }])
  })

  it('ignores whitespace-only instructions and keeps the base prompt unchanged', async () => {
    stubOpen(fakeWindow())
    installFetch(defaultRoutes())
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    setField(q(view.container, PROMPT_FIELD), '   ')
    expect(q(view.container, '[data-action="send"]').disabled).toBe(true)
    click(q(view.container, '[data-action="decompose"]'))
    await flush()

    expect(services.prompts).toEqual([{ sessionId: 'session-work', text: 'Decompose this task into subtasks.' }])
  })

  it('sends the editor content alone to the bound conversation', async () => {
    const win = fakeWindow()
    stubOpen(win)
    installFetch(defaultRoutes())
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    setField(q(view.container, PROMPT_FIELD), 'Check the failing e2e run.')
    expect(q(view.container, '[data-action="send"]').disabled).toBe(false)
    click(q(view.container, '[data-action="send"]'))
    await flush()

    expect(services.created).toEqual([])
    expect(services.prompts).toEqual([{ sessionId: 'session-work', text: 'Check the failing e2e run.' }])
    expect(handoff()).toMatchObject({ sessionId: 'session-work' })
    expect(promptValue(view.container)).toBe('')
  })

  it.each([
    ['execute', 'Complete this task.'],
    ['decompose', 'Decompose this task into subtasks.'],
    ['send', 'Check the failing e2e run.'],
  ])('refreshes the bound conversation focus before the %s prompt is queued', async (action, expected) => {
    const order = []
    stubOpen(fakeWindow())
    installFetch(defaultRoutes({
      routes: {
        [FOCUS_SET]: (call) => {
          order.push(['focus', requestBody(call)])
          return jsonResponse({ ok: true, taskId: 'task-1' })
        },
      },
    }))
    const services = fakeServices({
      send: async (sessionId, promptText) => {
        order.push(['send', sessionId, promptText])
      },
    })
    const { view } = renderWorkbench({ services })
    await flush()

    if (action === 'send') setField(q(view.container, PROMPT_FIELD), expected)
    click(q(view.container, `[data-action="${action}"]`))
    await flush()

    expect(order).toEqual([
      ['focus', { sessionId: 'session-work', taskId: 'task-1' }],
      ['send', 'session-work', expected],
    ])
  })

  it('creates the conversation for an unbound task and sends the content there', async () => {
    const win = fakeWindow()
    stubOpen(win)
    installFetch(defaultRoutes({ work: WORK_WITHOUT_SESSION }))
    const services = fakeServices()
    const { view } = renderWorkbench({ services })
    await flush()

    setField(q(view.container, PROMPT_FIELD), 'Start with the schema review.')
    click(q(view.container, '[data-action="send"]'))
    await flush()

    expect(services.created).toEqual([{ workspaceId: 'ws-1' }])
    expect(services.prompts).toEqual([{ sessionId: 'session-created', text: 'Start with the schema review.' }])
    expect(services.retained).toEqual([{ sessionId: 'session-created', source: 'ganttWork' }])
    expect(services.released).toEqual(['session-created'])
    expect(handoff()).toMatchObject({ sessionId: 'session-created' })
    expect(win.location.replaced).toBe(globalThis.location.href)
    expect(promptValue(view.container)).toBe('')
  })

  it('shows the sending state and keeps the text when the send fails', async () => {
    const pending = deferred()
    stubOpen(fakeWindow())
    installFetch(defaultRoutes())
    const services = fakeServices({ send: () => pending.promise })
    const { view } = renderWorkbench({ services })
    await flush()

    setField(q(view.container, PROMPT_FIELD), 'Retry the flaky check.')
    click(q(view.container, '[data-action="send"]'))
    await flush()
    expect(text(view.container, '[data-action="send"]')).toBe('Sending…')
    expect(q(view.container, '[data-action="send"]').disabled).toBe(true)
    expect(q(view.container, '[data-action="execute"]').disabled).toBe(true)

    pending.reject(new Error('prompt rejected'))
    await flush()
    expect(text(view.container, '.gantt-workbench-error')).toBe('Could not start the conversation. prompt rejected')
    expect(promptValue(view.container)).toBe('Retry the flaky check.')
    expect(text(view.container, '[data-action="send"]')).toBe('Send')
  })
})

afterEach(() => {
  unmountAll()
  localStorage.clear()
})
