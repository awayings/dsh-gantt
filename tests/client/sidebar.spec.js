// Plugin registration, the sidebar glyph, locale wiring, and the defensive
// fallbacks the page keeps when the host releases its runtime context.
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import {
  NS,
  applyPlugin,
  buttonByText,
  click,
  createPlugin,
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
import { emptyTreePayload, metaPayload, treePayload } from './fixtures.js'

afterEach(unmountAll)

describe('plugin registration', () => {
  it('declares its injections and registers the sidebar icon and main page', () => {
    const plugin = createPlugin()
    expect(plugin.inject).toEqual(['slots', 'locale'])

    const app = setupApp()
    const sidebar = app.sidebar()
    expect(sidebar.def).toMatchObject({ name: 'sidebar.panellist', id: 'gantt', order: 20 })
    expect(sidebar.def.label()).toBe('Task Gantt')

    const page = app.page()
    expect(page.def).toEqual({ name: 'main', key: 'gantt' })
    expect(app.registrations.size).toBe(4)
  })

  it('registers a complete en/zh dictionary pair with no key drift', () => {
    const app = setupApp()
    const dictionaries = app.dicts[NS]
    expect(Object.keys(dictionaries).sort()).toEqual(['en', 'zh'])
    const englishKeys = Object.keys(dictionaries.en).sort()
    expect(englishKeys.length).toBeGreaterThan(70)
    expect(Object.keys(dictionaries.zh).sort()).toEqual(englishKeys)
  })

  it('releases the runtime context when the host disposes the plugin', () => {
    const app = setupApp()
    expect(() => app.dispose()).not.toThrow()
    expect(app.sidebar().def.label()).toBe('Task Gantt')
  })

  it('keeps the newest runtime binding when an earlier context is disposed', async () => {
    installFetch({ 'api/gantt/tree': () => jsonResponse(emptyTreePayload()) })
    const plugin = createPlugin()
    const first = applyPlugin(plugin)
    const second = applyPlugin(plugin)

    first.dispose()
    const view = mount(createElement(second.page().component))
    await flush()

    expect(text(view.container, '.gantt-title')).toBe('Task Gantt')
    expect(text(view.container, '.gantt-empty-title')).toBe('No tasks yet')
  })

  it('falls back to en-US formatting when the host locale is empty', async () => {
    installFetch({ 'api/gantt/tree': () => jsonResponse(treePayload()) })
    const app = setupApp({ locale: '' })
    const view = mount(createElement(app.page().component))
    await flush()

    expect(app.sidebar().def.label()).toBe('Task Gantt')
    expect(text(view.container, '.gantt-window-scale')).toBe('Weekly view')
    expect(text(view.container, '.gantt-window-label')).toContain('Nov')
  })

  it('renders the page with key fallbacks after the runtime was released', async () => {
    installFetch({ 'api/gantt/tree': () => jsonResponse(emptyTreePayload()) })
    const app = setupApp()
    const page = app.page()
    app.dispose()

    const view = mount(createElement(page.component))
    await flush()

    expect(text(view.container, '.gantt-title')).toBe('page.title')
    expect(text(view.container, '.gantt-empty-title')).toBe('empty.title')
    expect(text(view.container, '.gantt-window-scale')).toBe('scale.weekShort')
  })
})

describe('sidebar icon', () => {
  it('renders the idle glyph with the default size and active styling on demand', () => {
    const app = setupApp()
    const component = app.sidebar().component

    const idle = mount(createElement(component))
    const svg = q(idle.container, 'svg')
    expect(svg).not.toBeNull()
    expect(svg.getAttribute('width')).toBe('18')
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('stroke-width')).toBe('1.8')
    expect(svg.style.opacity).toBe('0.85')
    expect(qa(idle.container, 'rect')).toHaveLength(3)
    expect(qa(idle.container, 'path')).toHaveLength(1)

    idle.rerender(createElement(component, { size: 24, active: true }))
    const active = q(idle.container, 'svg')
    expect(active.getAttribute('width')).toBe('24')
    expect(active.getAttribute('stroke-width')).toBe('2')
    expect(active.style.opacity).toBe('1')
  })
})

describe('zh locale', () => {
  it('renders the Chinese dictionary, date formats, and localized API catalog', async () => {
    installFetch({
      'api/gantt/tree': () => jsonResponse(treePayload()),
      'api/gantt/meta': () => jsonResponse(metaPayload()),
    })
    const app = setupApp({ locale: 'zh' })
    expect(app.sidebar().def.label()).toBe('任务甘特图')

    const view = mount(createElement(app.page().component))
    await flush()

    expect(app.listeners.size).toBe(1)
    expect(text(view.container, '.gantt-title')).toBe('任务甘特图')
    expect(text(view.container, '.gantt-subtitle')).toContain('在周/月时间线上')
    expect(text(view.container, '.gantt-window-scale')).toBe('周视图')
    expect(text(view.container, '.gantt-window-label')).toContain('11月')
    expect(text(view.container, '.gantt-group-cell')).toContain('2026年11月')
    expect(qa(view.container, '.gantt-unit-cell[data-weekend="true"]').length).toBeGreaterThan(0)

    click(buttonByText(view.container, '接口'))
    await flush()
    const rows = qa(view.container, '.gantt-api-row')
    expect(rows).toHaveLength(5)
    expect(q(rows[0], '.gantt-api-desc').textContent).toBe('读取任务树，包含层级编号、汇总进度和统计。')
    expect(q(rows[4], '.gantt-api-desc').textContent).toBe('Custom endpoint from the host.')

    click(buttonByText(view.container, '关闭'))
    expect(q(view.container, '.gantt-dialog')).toBeNull()
  })
})
