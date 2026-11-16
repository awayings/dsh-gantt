// Right-hand AI decompose chat: panel open/close, focusing a task from a row,
// send/apply request bodies, proposal rendering, error mapping, and clearing.
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
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
  row,
  setField,
  setupApp,
  text,
  unmountAll,
} from './harness.js'
import {
  chatPayload,
  chatProposal,
  decomposePayload,
  deepTreePayload,
  emptyTreePayload,
  unifiedTreePayload,
} from './fixtures.js'

const TREE = 'api/gantt/tree'
const CHAT = 'api/gantt/chat'
const DECOMPOSE = 'api/gantt/task/decompose'

afterEach(unmountAll)

const CHAT_KEYS = [
  'actions.ai',
  'chat.title',
  'chat.welcome',
  'chat.focus',
  'chat.clearFocus',
  'chat.placeholder',
  'chat.send',
  'chat.sending',
  'chat.clear',
  'chat.error',
  'chat.noModel',
  'chat.proposal',
  'chat.apply',
  'chat.applied',
  'chat.depth',
  'chat.empty',
]

async function renderPage(routes = {}, options = {}) {
  const fetchState = installFetch({
    [TREE]: () => jsonResponse(unifiedTreePayload()),
    [CHAT]: () => jsonResponse(chatPayload()),
    [DECOMPOSE]: () => jsonResponse(decomposePayload()),
    ...routes,
  })
  const app = setupApp(options)
  const view = mount(createElement(app.page().component))
  await flush()
  return { ...fetchState, app, view }
}

const panel = view => q(view.container, '.gantt-chat')
const composer = view => q(view.container, '.gantt-chat-input')
const sendButton = view => buttonByText(view.container, 'Send')
const chatCalls = calls => calls.filter(call => call.path === CHAT)
const treeCalls = calls => calls.filter(call => call.path === TREE)

function openChat(view) {
  click(q(view.container, '[data-action="chat-toggle"]'))
}

function focusRow(view, label) {
  click(q(row(view.container, label), '.gantt-row-action[data-action="ai"]'))
}

function typeMessage(view, value) {
  setField(composer(view), value)
}

function pressEnter(element, shiftKey = false) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true, cancelable: true }))
  })
}

async function sendMessage(view, value) {
  typeMessage(view, value)
  pressEnter(composer(view))
  await flush()
}

describe('panel open and close', () => {
  it('opens from the header button with a welcome state and closes again', async () => {
    const { view } = await renderPage()
    expect(panel(view)).toBeNull()

    openChat(view)
    expect(panel(view)).not.toBeNull()
    expect(text(view.container, '.gantt-chat-title')).toBe('AI decompose')
    expect(text(view.container, '.gantt-chat-welcome')).toContain('Focus a task')
    expect(text(view.container, '.gantt-chat-focus-none')).toBe('Focus a task first to apply the decomposition.')
    expect(q(view.container, '.gantt-chat-msg')).toBeNull()

    click(q(view.container, '.gantt-chat-head button[aria-label="Close"]'))
    expect(panel(view)).toBeNull()
  })

  it('focuses a node row from the ✦ action and opens the panel', async () => {
    const { view } = await renderPage()
    focusRow(view, '1.1 数据底座')

    expect(panel(view)).not.toBeNull()
    expect(text(view.container, '.gantt-chat-focus-label')).toBe('Focus')
    expect(text(view.container, '.gantt-chat-chip-ref')).toBe('1.1')
    expect(text(view.container, '.gantt-chat-chip-title')).toBe('数据底座')
    expect(q(view.container, '.gantt-chat-clear-focus')).not.toBeNull()
    expect(row(view.container, '1.1 数据底座').getAttribute('data-selected')).toBe('true')
    expect(q(view.container, '.gantt-chat-depth')).toBeNull()
  })

  it('drops the focused chip when the task leaves the tree', async () => {
    let emptied = false
    const { view } = await renderPage({
      [TREE]: () => jsonResponse(emptied ? emptyTreePayload() : unifiedTreePayload()),
    })
    focusRow(view, '1.1 数据底座')
    expect(text(view.container, '.gantt-chat-chip-title')).toBe('数据底座')

    emptied = true
    click(q(view.container, 'button[aria-label="Refresh"]'))
    await flush()

    expect(q(view.container, '.gantt-chat-chip')).toBeNull()
    expect(text(view.container, '.gantt-chat-focus-none')).toBe('Focus a task first to apply the decomposition.')
  })

  it('focuses a track row from the same ✦ action', async () => {
    const { view } = await renderPage()
    focusRow(view, '1 投资系统')
    expect(panel(view)).not.toBeNull()
    expect(text(view.container, '.gantt-chat-chip-title')).toBe('投资系统')
  })

  it('clears the focused task without closing the panel', async () => {
    const { view } = await renderPage()
    focusRow(view, '1.1 数据底座')
    click(q(view.container, '.gantt-chat-clear-focus'))
    expect(q(view.container, '.gantt-chat-chip')).toBeNull()
    expect(panel(view)).not.toBeNull()
    expect(text(view.container, '.gantt-chat-focus-none')).toBe('Focus a task first to apply the decomposition.')
  })

  it('keeps the stats row on the page column above the work area', async () => {
    const { view } = await renderPage()
    const stats = q(view.container, '.gantt-stats')
    expect(stats).not.toBeNull()
    expect(stats.parentElement.className).toBe('gantt-page')
    expect(q(view.container, '.gantt-work-main > .gantt-stats')).toBeNull()
    expect(q(view.container, '.gantt-page > .gantt-stats + .gantt-work')).not.toBeNull()

    openChat(view)
    expect(q(view.container, '.gantt-work > .gantt-chat')).not.toBeNull()
    expect(q(view.container, '.gantt-work-main .gantt-chat')).toBeNull()
    expect(q(view.container, '.gantt-page > .gantt-stats')).toBe(stats)
  })
})

describe('sending a message', () => {
  it('posts the focused task, history, and message, then renders the reply and proposal', async () => {
    const { calls, view } = await renderPage()
    focusRow(view, '1.1 数据底座')
    await sendMessage(view, '拆一下数据底座')

    const call = chatCalls(calls)[0]
    expect(call.options.method).toBe('POST')
    expect(requestBody(call)).toEqual({ message: '拆一下数据底座', history: [], taskId: 'n1' })

    const messages = qa(view.container, '.gantt-chat-msg')
    expect(messages).toHaveLength(2)
    expect(messages[0].getAttribute('data-role')).toBe('user')
    expect(text(messages[0], '.gantt-chat-bubble')).toBe('拆一下数据底座')
    expect(messages[1].getAttribute('data-role')).toBe('assistant')
    expect(text(messages[1], '.gantt-chat-bubble')).toBe('先拆成三个可以今天执行的小任务。')
    expect(q(view.container, '.gantt-chat-welcome')).toBeNull()

    expect(text(view.container, '.gantt-chat-proposal-head')).toContain('Proposed decomposition')
    expect(text(view.container, '.gantt-chat-proposal-date')).toBe('2026-11-18')
    const children = qa(view.container, '.gantt-chat-child')
    expect(children).toHaveLength(3)
    expect(text(children[0], '.gantt-chat-child-title')).toBe('拆出三个数据源')
    expect(text(children[0], '.gantt-chat-child-done')).toBe('三个数据源都能查到当天数据')
    expect(text(children[0], '.gantt-chat-child-meta')).toContain('30min')
    expect(text(children[0], '.gantt-chat-child-meta')).toContain('2026-11-18 21:00–21:30')
    expect(text(children[1], '.gantt-chat-child-meta')).toBe('')
    expect(text(children[2], '.gantt-chat-child-meta')).toContain('2026-11-19')
    expect(buttonByText(view.container, 'Apply decomposition').disabled).toBe(false)
  })

  it('keeps the previous turns in the next request history', async () => {
    const { calls, view } = await renderPage()
    focusRow(view, '1.1 数据底座')
    await sendMessage(view, '第一问')
    await sendMessage(view, '第二问')

    expect(requestBody(chatCalls(calls)[1])).toEqual({
      message: '第二问',
      history: [
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '先拆成三个可以今天执行的小任务。' },
      ],
      taskId: 'n1',
    })
  })

  it('omits taskId when no task is focused', async () => {
    const { calls, view } = await renderPage()
    openChat(view)
    await sendMessage(view, '帮我安排今天')

    expect(requestBody(chatCalls(calls)[0])).toEqual({ message: '帮我安排今天', history: [] })
  })

  it('sends on Enter but keeps Shift+Enter inside the composer', async () => {
    const { calls, view } = await renderPage()
    focusRow(view, '1.1 数据底座')
    typeMessage(view, '第一行')

    pressEnter(composer(view), true)
    await flush()
    expect(chatCalls(calls)).toHaveLength(0)
    expect(composer(view).value).toBe('第一行')

    pressEnter(composer(view))
    await flush()
    expect(chatCalls(calls)).toHaveLength(1)
    expect(composer(view).value).toBe('')
  })

  it('disables the composer and the send button while the request is in flight', async () => {
    const gate = deferred()
    const { view } = await renderPage({ [CHAT]: () => gate.promise })
    openChat(view)
    expect(sendButton(view).disabled).toBe(true)

    typeMessage(view, '拆一下')
    expect(sendButton(view).disabled).toBe(false)
    click(sendButton(view))
    expect(sendButton(view).disabled).toBe(true)
    expect(composer(view).disabled).toBe(true)
    expect(text(view.container, '.gantt-chat-sending')).toBe('Thinking…')

    gate.resolve(jsonResponse(chatPayload()))
    await flush()
    expect(composer(view).disabled).toBe(false)
    expect(qa(view.container, '.gantt-chat-msg')).toHaveLength(2)
  })

  it('ignores Enter on an empty draft and while a send is in flight', async () => {
    const gate = deferred()
    const { calls, view } = await renderPage({ [CHAT]: () => gate.promise })
    focusRow(view, '1.1 数据底座')

    pressEnter(composer(view))
    await flush()
    expect(chatCalls(calls)).toHaveLength(0)

    typeMessage(view, '拆一下')
    click(sendButton(view))
    pressEnter(composer(view))
    await flush()
    expect(chatCalls(calls)).toHaveLength(1)

    gate.resolve(jsonResponse(chatPayload()))
    await flush()
    expect(qa(view.container, '.gantt-chat-msg')).toHaveLength(2)
  })

  it('renders a reply without a proposal card when the model proposes nothing', async () => {
    const { view } = await renderPage({
      [CHAT]: () => jsonResponse(chatPayload({ reply: '先聊聊目标。', proposal: null })),
    })
    openChat(view)
    await sendMessage(view, '今天该做什么')
    expect(text(view.container, '.gantt-chat-msg[data-role="assistant"] .gantt-chat-bubble')).toBe('先聊聊目标。')
    expect(q(view.container, '.gantt-chat-proposal')).toBeNull()
  })
})

describe('applying a proposal', () => {
  async function proposalConversation(routes = {}) {
    const state = await renderPage(routes)
    focusRow(state.view, '1.1 数据底座')
    await sendMessage(state.view, '拆一下数据底座')
    return state
  }

  it('posts the decompose body, refetches the tree, and marks the card applied', async () => {
    const { calls, view } = await proposalConversation()
    click(buttonByText(view.container, 'Apply decomposition'))
    await flush()

    expect(requestBody(calls.find(call => call.path === DECOMPOSE))).toEqual({
      id: 'n1',
      planDate: '2026-11-18',
      children: chatProposal().children,
    })
    expect(treeCalls(calls)).toHaveLength(2)
    expect(text(view.container, '.gantt-toast')).toBe('Applied')
    expect(text(view.container, '.gantt-chat-applied')).toBe('Applied')
    expect(q(view.container, '.gantt-chat-proposal').getAttribute('data-applied')).toBe('true')
    expect(buttonByText(view.container, 'Apply decomposition')).toBeUndefined()
  })

  it('omits planDate when the proposal has none', async () => {
    const { calls, view } = await proposalConversation({
      [CHAT]: () => jsonResponse(chatPayload({ proposal: chatProposal({ planDate: null }) })),
    })
    click(buttonByText(view.container, 'Apply decomposition'))
    await flush()

    expect(requestBody(calls.find(call => call.path === DECOMPOSE))).toEqual({
      id: 'n1',
      children: chatProposal().children,
    })
  })

  it('disables apply without a focused task and explains why', async () => {
    const { view } = await renderPage()
    openChat(view)
    await sendMessage(view, '今天怎么拆')
    expect(q(view.container, '.gantt-chat-note')).not.toBeNull()
    expect(text(view.container, '.gantt-chat-note')).toBe('Focus a task first to apply the decomposition.')
    expect(buttonByText(view.container, 'Apply decomposition').disabled).toBe(true)

    focusRow(view, '1.1 数据底座')
    expect(q(view.container, '.gantt-chat-note')).toBeNull()
    expect(buttonByText(view.container, 'Apply decomposition').disabled).toBe(false)
  })

  it('reports a failed apply in the panel error banner', async () => {
    const { view } = await proposalConversation({
      [DECOMPOSE]: () => jsonResponse({ ok: false, error: 'decompose refused' }, 400),
    })
    click(buttonByText(view.container, 'Apply decomposition'))
    await flush()

    expect(text(view.container, '.gantt-chat-error')).toBe('The chat request failed. decompose refused')
    expect(q(view.container, '.gantt-chat-applied')).toBeNull()
    expect(buttonByText(view.container, 'Apply decomposition')).not.toBeUndefined()
  })
})

describe('error handling', () => {
  it('maps a 503 model failure to the no-model copy plus the message', async () => {
    const { view } = await renderPage({
      [CHAT]: () => jsonResponse({ ok: false, error: 'model unavailable' }, 503),
    })
    focusRow(view, '1.1 数据底座')
    await sendMessage(view, '拆一下')

    const banner = text(view.container, '.gantt-chat-error')
    expect(banner).toContain('No model is configured, or the model is unavailable.')
    expect(banner).toContain('model unavailable')
    expect(qa(view.container, '.gantt-chat-msg')).toHaveLength(1)
  })

  it('maps other chat failures to the generic chat error', async () => {
    const { view } = await renderPage({
      [CHAT]: () => jsonResponse({ ok: false, error: 'upstream exploded' }, 502),
    })
    openChat(view)
    await sendMessage(view, '拆一下')
    expect(text(view.container, '.gantt-chat-error')).toBe('The chat request failed. upstream exploded')
  })

  it('stringifies a non-Error chat rejection', async () => {
    const { view } = await renderPage({ [CHAT]: () => Promise.reject('socket closed') })
    openChat(view)
    await sendMessage(view, '拆一下')
    expect(text(view.container, '.gantt-chat-error')).toBe('The chat request failed. socket closed')
  })

  it('shows an error instead of a blank bubble for an empty reply', async () => {
    const { view } = await renderPage({
      [CHAT]: () => jsonResponse({ ok: true, reply: '', proposal: null }),
    })
    openChat(view)
    await sendMessage(view, '拆一下')
    expect(text(view.container, '.gantt-chat-error')).toBe('The chat request failed.')
    expect(qa(view.container, '.gantt-chat-msg')).toHaveLength(1)
  })

  it('clears messages and the error banner from the clear button', async () => {
    const { view } = await renderPage({
      [CHAT]: () => jsonResponse({ ok: false, error: 'model unavailable' }, 503),
    })
    focusRow(view, '1.1 数据底座')
    await sendMessage(view, '拆一下')
    expect(q(view.container, '.gantt-chat-error')).not.toBeNull()

    click(buttonByText(view.container, 'Clear chat'))
    expect(qa(view.container, '.gantt-chat-msg')).toHaveLength(0)
    expect(q(view.container, '.gantt-chat-error')).toBeNull()
    expect(q(view.container, '.gantt-chat-welcome')).not.toBeNull()
  })
})

describe('dictionary and depth cap', () => {
  it('ships the sixteen chat keys in both locales', () => {
    const app = setupApp()
    const dictionaries = app.dicts[NS]
    for (const key of CHAT_KEYS) {
      expect(typeof dictionaries.en[key], key).toBe('string')
      expect(dictionaries.en[key].length, key).toBeGreaterThan(0)
      expect(typeof dictionaries.zh[key], key).toBe('string')
      expect(dictionaries.zh[key].length, key).toBeGreaterThan(0)
    }
  })

  it('shows the depth-cap note for a fourth-level task', async () => {
    const { view } = await renderPage({ [TREE]: () => jsonResponse(deepTreePayload()) })
    focusRow(view, '1.1.1.1 叶子任务')
    expect(text(view.container, '.gantt-chat-chip-ref')).toBe('1.1.1.1')
    expect(text(view.container, '.gantt-chat-depth'))
      .toBe('This task already sits at the 4-level cap; decompose a higher-level task instead.')
  })

  it('renders the panel in Chinese and applies with the localized toast', async () => {
    const { view } = await renderPage({}, { locale: 'zh' })
    openChat(view)
    expect(text(view.container, '.gantt-chat-title')).toBe('AI 拆解')
    expect(text(view.container, '.gantt-chat-focus-none')).toBe('先聚焦一个任务，才能应用拆解。')
    expect(text(view.container, '.gantt-chat-welcome')).toContain('先点任务的 ✦ 聚焦')
    expect(composer(view).getAttribute('placeholder')).toContain('Enter 发送')

    focusRow(view, '1.1 数据底座')
    await sendMessage(view, '拆一下数据底座')
    expect(text(view.container, '.gantt-chat-proposal-head')).toContain('拆解建议')
    click(buttonByText(view.container, '应用拆解'))
    await flush()
    expect(text(view.container, '.gantt-toast')).toBe('已生成')
    expect(text(view.container, '.gantt-chat-applied')).toBe('已生成')
  })
})
