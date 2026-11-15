// jsdom component harness for the Gantt client plugin.
//
// Unit specs import the ESM plugin from src/client directly. The end-to-end
// suite captures the built artifact through the module-loader stub and keeps it
// on globalThis.__ganttPluginModule; when present it wins, so the same helpers
// drive both the sources and the shipped bundle. Fetch is always stubbed here,
// so no unit test touches the network.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'
import { plugin as sourcePlugin } from '../../src/client/index.js'

const NS = 'dsh-gantt'

/** The plugin under test: the captured artifact when present, else the sources. */
export function createPlugin() {
  const descriptor = globalThis.__ganttPluginModule
  if (descriptor) {
    return descriptor.factory((id) => {
      if (id === 'react') return React
      throw new Error(`unexpected require: ${id}`)
    })
  }
  return sourcePlugin
}

/** Apply the plugin to a stub host context and expose the captured registrations. */
export function applyPlugin(plugin, options = {}) {
  const dicts = {}
  const registrations = new Map()
  const effects = []
  const listeners = new Set()
  const locale = String(options.locale ?? 'en')
  const snapshot = { revision: 1, locale }
  const ctx = {
    inject: ['slots', 'locale'],
    effect(fn) {
      const disposer = fn()
      effects.push(disposer)
      return disposer
    },
    locale: {
      register(namespace, dictionaries) {
        dicts[namespace] = dictionaries
        return () => {}
      },
      bind(namespace) {
        return (key) => {
          const language = String(locale).toLowerCase().startsWith('zh') ? 'zh' : 'en'
          return dicts[namespace]?.[language]?.[key] ?? key
        }
      },
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    slots: {
      inject(name, fn) {
        return fn()
      },
      register(def, component) {
        registrations.set(`${def.name}:${def.id ?? def.key}`, { def, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  return {
    ctx,
    dicts,
    registrations,
    listeners,
    sidebar() {
      return registrations.get('sidebar.panellist:gantt')
    },
    page() {
      return registrations.get('main:gantt')
    },
    todaySidebar() {
      return registrations.get('sidebar.panellist:today')
    },
    todayPage() {
      return registrations.get('main:today')
    },
    dispose() {
      for (const disposer of effects) if (typeof disposer === 'function') disposer()
    },
  }
}

/** One-call setup: fresh plugin + stub ctx. */
export function setupApp(options = {}) {
  return applyPlugin(createPlugin(), options)
}

/** Response-like object matching what requestJson() reads. */
export function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => payload,
  }
}

/** A response whose body cannot be parsed (requestJson keeps the status failure). */
export function unparsableResponse(status = 503) {
  return {
    ok: false,
    status,
    headers: { get: () => 'text/html' },
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON')
    },
  }
}

/**
 * Install a fetch stub. `routes` maps a request path to a handler
 * `(call, calls) => response | Promise<response>`; any unexpected request fails.
 */
export function installFetch(routes) {
  const calls = []
  const stub = vi.fn(async (path, options = {}) => {
    const call = { path, options }
    calls.push(call)
    const handler = routes[path] ?? routes[path.split('?')[0]]
    if (typeof handler !== 'function') throw new Error(`unexpected fetch request: ${path}`)
    return handler(call, calls)
  })
  vi.stubGlobal('fetch', stub)
  return { calls, stub }
}

/** A promise plus its resolve/reject functions, for observing in-flight states. */
export function deferred() {
  let resolve
  let reject
  const promise = new Promise((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

/** All fetch calls for one path. */
export function callsTo(calls, path) {
  return calls.filter(call => call.path === path)
}

/** Parsed JSON body of a recorded POST. */
export function requestBody(call) {
  return JSON.parse(call.options.body)
}

const activeViews = []

/** Mount a React element inside act() and return handles for the test. */
export function mount(element) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  const view = {
    container,
    root,
    rerender(next) {
      act(() => root.render(next))
    },
    unmount() {
      if (view.unmounted) return
      view.unmounted = true
      act(() => root.unmount())
      container.remove()
    },
  }
  activeViews.push(view)
  return view
}

/** Unmount everything a test mounted (registered as afterEach by each spec). */
export function unmountAll() {
  while (activeViews.length > 0) activeViews.pop().unmount()
}

/** Flush promise/effect work: one macrotask inside act (0ms, deterministic). */
export async function flush() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

/** Flush microtasks only; safe while fake timers are installed. */
export async function flushMicrotasks() {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
  })
}

export function q(container, selector) {
  return container.querySelector(selector)
}

export function qa(container, selector) {
  return [...container.querySelectorAll(selector)]
}

export function text(container, selector) {
  const element = q(container, selector)
  return element ? element.textContent : null
}

/** First button whose trimmed text equals (then contains) `label`. */
export function buttonByText(container, label) {
  const buttons = qa(container, 'button')
  return buttons.find(element => element.textContent.trim() === label)
    ?? buttons.find(element => element.textContent.includes(label))
}

/** A task row by its accessible label (`"1.1 Write spec"`). */
export function row(container, label) {
  return q(container, `.gantt-row[aria-label="${label}"]`)
}

/** Click inside act() so React flushes synchronously. */
export function click(element) {
  if (!element) throw new Error('click target is missing')
  act(() => {
    element.click()
  })
}

/** Set a controlled form value and dispatch the event React listens to. */
export function setField(element, value, eventName = 'input') {
  if (!element) throw new Error('form field is missing')
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set
    if (setter) setter.call(element, value)
    else element.value = value
    element.dispatchEvent(new Event(eventName, { bubbles: true }))
  })
}

/** Dispatch a keyboard event inside act(). */
export function keydown(element, key) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

/** Dispatch a mouse event inside act(). */
export function mouseEvent(element, type) {
  act(() => {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
  })
}

/** The open dialog element (role=dialog) and its helper getters. */
export function dialog(container) {
  return q(container, '.gantt-dialog[role="dialog"]')
}

export function dialogTitle(container) {
  return text(container, '.gantt-dialog-title')
}

function field(container, selector) {
  return q(container, `.gantt-dialog ${selector}`)
}

/** Title/description/parent/status/progress fields of the task dialog. */
export function taskForm(container) {
  const dates = qa(container, '.gantt-dialog input[type="date"]')
  const selects = qa(container, '.gantt-dialog .gantt-select')
  return {
    title: field(container, 'input.gantt-input:not([type])'),
    description: field(container, 'textarea.gantt-textarea'),
    parent: selects[0],
    start: dates[0],
    end: dates[1],
    status: selects[1],
    progress: field(container, 'input[type="range"]'),
    error: text(container, '.gantt-form-error'),
    submit: buttonByText(container, 'Create') ?? buttonByText(container, 'Save'),
    cancel: buttonByText(container, 'Cancel'),
    remove: buttonByText(container, 'Delete') ?? buttonByText(container, 'Confirm delete'),
    split: buttonByText(container, 'Split'),
  }
}

export { NS }
