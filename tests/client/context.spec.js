// Context export dialog: fetch `GET /api/gantt/context`, show the read-only
// markdown with its size/truncation line, and copy it with a selection fallback.
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  setupApp,
  text,
  unmountAll,
} from './harness.js'
import { contextPayload, unifiedTreePayload } from './fixtures.js'

const TREE = 'api/gantt/tree'
const CONTEXT = 'api/gantt/context'

afterEach(unmountAll)

function setClipboard(writeText) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  })
}

function clearClipboard() {
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined })
}

async function renderPage(routes = {}, options = {}) {
  const fetchState = installFetch({
    [TREE]: () => jsonResponse(unifiedTreePayload()),
    [CONTEXT]: () => jsonResponse(contextPayload()),
    ...routes,
  })
  const app = setupApp(options)
  const view = mount(createElement(app.page().component))
  await flush()
  click(buttonByText(view.container, options.locale === 'zh' ? '导出上下文' : 'Export context'))
  await flush()
  return { ...fetchState, app, view }
}

function contextTextarea(view) {
  return q(view.container, '.gantt-dialog .gantt-context-text')
}

function copyButton(view) {
  return q(view.container, '.gantt-dialog [data-action="copy"]')
}

describe('context export dialog', () => {
  it('renders the read-only markdown with its character count', async () => {
    const { calls, view } = await renderPage()
    const payload = contextPayload()

    expect(dialogTitle(view.container)).toBe('Model context')
    expect(text(view.container, '.gantt-dialog-note')).toContain('Read-only Markdown export')
    const textarea = contextTextarea(view)
    expect(textarea).not.toBeNull()
    expect(textarea.readOnly).toBe(true)
    expect(textarea.value).toBe(payload.markdown)
    expect(textarea.getAttribute('aria-label')).toBe('Model context')
    expect(text(view.container, '.gantt-context-meta')).toBe(`${payload.chars} characters`)
    expect(q(view.container, '.gantt-context-truncated')).toBeNull()
    expect(copyButton(view).disabled).toBe(false)
    expect(calls.filter(call => call.path === CONTEXT)).toHaveLength(1)
  })

  it('flags a truncated export and falls back to the markdown length', async () => {
    const { view } = await renderPage({
      [CONTEXT]: () => jsonResponse(contextPayload({ chars: undefined, truncated: true })),
    })

    expect(text(view.container, '.gantt-context-meta span')).toBe(`${contextPayload().markdown.length} characters`)
    expect(text(view.container, '.gantt-context-truncated')).toBe('truncated to the size limit')
  })

  it('handles a context payload without markdown and copies the empty body', async () => {
    const writeText = vi.fn(async () => {})
    setClipboard(writeText)
    try {
      const { view } = await renderPage({
        [CONTEXT]: () => jsonResponse({ ok: true, chars: 0 }),
      })
      expect(contextTextarea(view).value).toBe('')
      expect(text(view.container, '.gantt-context-meta span')).toBe('0 characters')

      click(copyButton(view))
      await flush()
      expect(writeText).toHaveBeenCalledWith('')
      expect(text(view.container, '.gantt-hint')).toBe('Copied to the clipboard.')
    } finally {
      clearClipboard()
    }
  })

  it('falls back to a zero count for a bare context payload', async () => {
    const { view } = await renderPage({ [CONTEXT]: () => jsonResponse({ ok: true }) })
    expect(contextTextarea(view).value).toBe('')
    expect(text(view.container, '.gantt-context-meta span')).toBe('0 characters')
  })

  it('shows the loading state until the context response arrives', async () => {
    let resolveContext
    const fetchState = installFetch({
      [TREE]: () => jsonResponse(unifiedTreePayload()),
      [CONTEXT]: () => new Promise((resolve) => { resolveContext = resolve }),
    })
    const app = setupApp()
    const view = mount(createElement(app.page().component))
    await flush()
    click(buttonByText(view.container, 'Export context'))

    expect(text(view.container, '.gantt-hint')).toBe('Rendering context…')
    expect(contextTextarea(view)).toBeNull()
    expect(copyButton(view).disabled).toBe(true)

    resolveContext(jsonResponse(contextPayload()))
    await flush()
    expect(contextTextarea(view)).not.toBeNull()
    expect(fetchState.calls.filter(call => call.path === CONTEXT)).toHaveLength(1)
  })

  it('copies the markdown through the clipboard API', async () => {
    const writeText = vi.fn(async () => {})
    setClipboard(writeText)
    try {
      const { view } = await renderPage()
      click(copyButton(view))
      await flush()

      expect(writeText).toHaveBeenCalledWith(contextPayload().markdown)
      expect(text(view.container, '.gantt-hint')).toBe('Copied to the clipboard.')
    } finally {
      clearClipboard()
    }
  })

  it('selects the text and explains the fallback when the clipboard is unavailable', async () => {
    clearClipboard()
    const select = vi.spyOn(HTMLTextAreaElement.prototype, 'select')
    const { view } = await renderPage()

    click(copyButton(view))
    await flush()

    expect(select).toHaveBeenCalled()
    expect(text(view.container, '.gantt-hint')).toBe(
      'Clipboard unavailable: the text is selected. Press Ctrl/Cmd+C to copy.',
    )
  })

  it('falls back to selection when the clipboard write rejects', async () => {
    const writeText = vi.fn(async () => { throw new Error('denied') })
    setClipboard(writeText)
    const select = vi.spyOn(HTMLTextAreaElement.prototype, 'select')
    try {
      const { view } = await renderPage()
      click(copyButton(view))
      await flush()

      expect(writeText).toHaveBeenCalled()
      expect(select).toHaveBeenCalled()
      expect(text(view.container, '.gantt-hint')).toContain('Clipboard unavailable')
    } finally {
      clearClipboard()
    }
  })

  it('reports context failures in the dialog', async () => {
    const failing = await renderPage({
      [CONTEXT]: () => jsonResponse({ ok: false, error: 'context is locked' }, 500),
    })
    expect(text(failing.view.container, '.gantt-form-error')).toBe('context is locked')
    expect(contextTextarea(failing.view)).toBeNull()
    expect(copyButton(failing.view).disabled).toBe(true)
    click(buttonByText(failing.view.container, 'Close'))
    expect(dialog(failing.view.container)).toBeNull()
    failing.view.unmount()

    const exploding = await renderPage({ [CONTEXT]: () => Promise.reject('context exploded') })
    expect(text(exploding.view.container, '.gantt-form-error')).toBe('context exploded')
  })

  it('ignores a context response that lands after the dialog closed', async () => {
    let resolveContext
    const fetchState = installFetch({
      [TREE]: () => jsonResponse(unifiedTreePayload()),
      [CONTEXT]: () => new Promise((resolve) => { resolveContext = resolve }),
    })
    const app = setupApp()
    const view = mount(createElement(app.page().component))
    await flush()
    click(buttonByText(view.container, 'Export context'))
    click(buttonByText(view.container, 'Close'))
    expect(dialog(view.container)).toBeNull()

    resolveContext(jsonResponse(contextPayload()))
    await flush()

    expect(dialog(view.container)).toBeNull()
    expect(view.container.textContent).not.toContain('个人任务树')
    expect(fetchState.calls.filter(call => call.path === CONTEXT)).toHaveLength(1)
  })

  it('ignores a context failure that lands after the dialog closed', async () => {
    let rejectContext
    const fetchState = installFetch({
      [TREE]: () => jsonResponse(unifiedTreePayload()),
      [CONTEXT]: () => new Promise((_resolve, reject) => { rejectContext = reject }),
    })
    const app = setupApp()
    const view = mount(createElement(app.page().component))
    await flush()
    click(buttonByText(view.container, 'Export context'))
    click(buttonByText(view.container, 'Close'))

    rejectContext(new Error('late context'))
    await flush()

    expect(dialog(view.container)).toBeNull()
    expect(view.container.textContent).not.toContain('late context')
    expect(fetchState.calls.filter(call => call.path === CONTEXT)).toHaveLength(1)
  })

  it('renders the Chinese dictionary for the context dialog', async () => {
    const { view } = await renderPage({}, { locale: 'zh' })

    expect(dialogTitle(view.container)).toBe('模型上下文')
    expect(text(view.container, '.gantt-dialog-note')).toContain('只读 Markdown')
    expect(text(view.container, '.gantt-context-meta')).toContain('字符')
    expect(copyButton(view).textContent).toBe('复制')
    expect(qa(view.container, '.gantt-dialog-foot .gantt-btn').length).toBeGreaterThan(1)
  })
})
