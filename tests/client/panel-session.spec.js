// The plugin's global main panel is not persisted by the shell: a client
// reload (HMR entry replacement) or a browser reload drops the selection and
// shows the conversation. These cases pin the marker/restore pair that keeps
// the Gantt or Today page on screen.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setupApp } from './harness.js'
import {
  PANEL_KEY,
  RESTORE_TTL_MS,
  installPanelCapture,
  restorePanel,
} from '../../src/client/panel-session.js'

/** @type {{ dispose: () => void, disposed?: boolean }[]} */
const apps = []

/** Apply the plugin and remember the app so the unload listeners go away. */
function launch(options = {}) {
  const app = setupApp(options)
  apps.push(app)
  return app
}

/** Unload one plugin instance (the client reload teardown). */
function unload(app) {
  app.dispose()
  app.disposed = true
}

/** A layout store double: the shell's in-memory global-panel selection. */
function fakeLayout(activePanelId = null) {
  const state = { activePanelId }
  const listeners = new Set()
  return {
    selected: [],
    panelInfo: {
      getSnapshot: () => state,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    selectPanel(panelId) {
      this.selected.push(panelId)
      state.activePanelId = panelId
      for (const listener of [...listeners]) listener()
    },
  }
}

function marker() {
  const raw = sessionStorage.getItem(PANEL_KEY)
  return raw === null ? null : JSON.parse(raw)
}

function stashMarker(panel, at = Date.now()) {
  sessionStorage.setItem(PANEL_KEY, JSON.stringify({ panel, at }))
}

/** Let the deferred restore task run. */
function flushRestore() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

afterEach(() => {
  for (const app of apps) {
    if (app.disposed === true) continue
    try {
      app.dispose()
    } catch {
      // A case that deliberately breaks a disposer must not fail the cleanup.
    }
  }
  apps.length = 0
  sessionStorage.clear()
})

describe('installPanelCapture', () => {
  it('remembers the selected page when the plugin entry unloads', () => {
    const layout = fakeLayout('gantt')
    const app = launch({ services: { layout } })

    expect(marker()).toBeNull()
    unload(app)

    expect(marker()).toMatchObject({ panel: 'gantt' })
    expect(typeof marker().at).toBe('number')
  })

  it('stays silent while the conversation is showing', () => {
    const app = launch({ services: { layout: fakeLayout(null) } })
    unload(app)
    expect(marker()).toBeNull()
  })

  it('ignores a panel this plugin does not own', () => {
    const app = launch({ services: { layout: fakeLayout('plugins') } })
    unload(app)
    expect(marker()).toBeNull()
  })

  it('remembers the page on pagehide, before any unload cleanup', () => {
    const layout = fakeLayout('today')
    launch({ services: { layout } })

    window.dispatchEvent(new Event('pagehide'))

    expect(marker()).toMatchObject({ panel: 'today' })
  })

  it('resolves a layout service that arrives after the plugin applied', () => {
    const app = launch({ services: {} })

    app.services.layout = fakeLayout('gantt')
    unload(app)

    expect(marker()).toMatchObject({ panel: 'gantt' })
  })

  it('keeps running while the layout service is unusable', () => {
    const app = launch({ services: { layout: {} } })
    expect(installPanelCapture(app.ctx)).toBe(true)
    window.dispatchEvent(new Event('pagehide'))
    unload(app)
    expect(marker()).toBeNull()
  })

  it('requires a layout selection reader before writing a marker', () => {
    const app = launch({ services: { layout: { selectPanel: () => {} } } })
    window.dispatchEvent(new Event('pagehide'))
    unload(app)
    expect(marker()).toBeNull()
  })

  it('does nothing without a client context', () => {
    expect(installPanelCapture(undefined)).toBe(false)
    expect(installPanelCapture({})).toBe(false)
    expect(restorePanel(undefined)).toBe(false)
  })

  it('tolerates a layout store that throws on read', () => {
    const layout = fakeLayout('gantt')
    layout.panelInfo.getSnapshot = () => {
      throw new Error('detached store')
    }
    const app = launch({ services: { layout } })
    window.dispatchEvent(new Event('pagehide'))
    expect(() => unload(app)).not.toThrow()
    expect(marker()).toBeNull()
  })

  it('tolerates storage that refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const app = launch({ services: { layout: fakeLayout('gantt') } })
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow()
    expect(() => unload(app)).not.toThrow()
    expect(marker()).toBeNull()
  })

  it('survives a browser that refuses session storage', () => {
    const app = launch({ services: { layout: fakeLayout('gantt') } })
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('denied')
      },
    })
    try {
      expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow()
      expect(() => unload(app)).not.toThrow()
      expect(() => restorePanel(app.ctx)).not.toThrow()
    } finally {
      if (descriptor === undefined) delete globalThis.sessionStorage
      else Object.defineProperty(globalThis, 'sessionStorage', descriptor)
    }
  })

  it('treats an undefined session storage as absent', () => {
    const app = launch({ services: { layout: fakeLayout('gantt') } })
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: undefined })
    try {
      expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow()
      expect(() => unload(app)).not.toThrow()
    } finally {
      if (descriptor === undefined) delete globalThis.sessionStorage
      else Object.defineProperty(globalThis, 'sessionStorage', descriptor)
    }
  })

  it('reads a layout exposed directly on the context', () => {
    const layout = fakeLayout('gantt')
    let cleanup = null
    installPanelCapture({
      layout,
      effect: (fn) => {
        cleanup = fn()
      },
    })
    cleanup()
    expect(marker()).toMatchObject({ panel: 'gantt' })
  })

  it('ignores a non-string selection', () => {
    const layout = fakeLayout(42)
    const app = launch({ services: { layout } })
    unload(app)
    expect(marker()).toBeNull()
  })
})

describe('restorePanel', () => {
  it('selects the remembered page again after a reload', async () => {
    stashMarker('gantt')
    const layout = fakeLayout(null)
    launch({ services: { layout } })

    await flushRestore()

    expect(layout.selected).toEqual(['gantt'])
    expect(layout.panelInfo.getSnapshot().activePanelId).toBe('gantt')
    expect(marker()).toBeNull()
  })

  it('restores the Today page too', async () => {
    stashMarker('today')
    const layout = fakeLayout(null)
    launch({ services: { layout } })

    await flushRestore()

    expect(layout.selected).toEqual(['today'])
  })

  it('round-trips the page through an unload and the next apply', async () => {
    const first = launch({ services: { layout: fakeLayout('gantt') } })
    unload(first)

    const layout = fakeLayout(null)
    launch({ services: { layout } })
    await flushRestore()

    expect(layout.selected).toEqual(['gantt'])
  })

  it('ignores and drops a stale marker', async () => {
    stashMarker('gantt', Date.now() - RESTORE_TTL_MS - 1_000)
    const layout = fakeLayout(null)
    launch({ services: { layout } })

    await flushRestore()

    expect(layout.selected).toEqual([])
    expect(marker()).toBeNull()
  })

  it('ignores and drops a marker timestamped in the future', async () => {
    stashMarker('gantt', Date.now() + 60_000)
    const layout = fakeLayout(null)
    launch({ services: { layout } })

    await flushRestore()

    expect(layout.selected).toEqual([])
    expect(marker()).toBeNull()
  })

  it('ignores an unknown page and a malformed marker', async () => {
    stashMarker('plugins')
    const layout = fakeLayout(null)
    launch({ services: { layout } })
    await flushRestore()
    expect(layout.selected).toEqual([])
    expect(marker()).toBeNull()

    sessionStorage.setItem(PANEL_KEY, '{not json')
    launch({ services: { layout } })
    await flushRestore()
    expect(layout.selected).toEqual([])
    expect(marker()).toBeNull()
  })

  it('ignores a marker without a numeric timestamp', async () => {
    sessionStorage.setItem(PANEL_KEY, JSON.stringify({ panel: 'gantt', at: 'now' }))
    const layout = fakeLayout(null)
    launch({ services: { layout } })

    await flushRestore()

    expect(layout.selected).toEqual([])
  })

  it('ignores a non-finite timestamp and a non-object payload', async () => {
    sessionStorage.setItem(PANEL_KEY, '{"panel":"gantt","at":1e999}')
    const layout = fakeLayout(null)
    launch({ services: { layout } })
    await flushRestore()
    expect(layout.selected).toEqual([])

    sessionStorage.setItem(PANEL_KEY, '"gantt"')
    launch({ services: { layout } })
    await flushRestore()
    expect(layout.selected).toEqual([])
    expect(marker()).toBeNull()
  })

  it('treats a storage read failure as no marker', async () => {
    stashMarker('gantt')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const layout = fakeLayout(null)
    launch({ services: { layout } })

    await flushRestore()

    expect(layout.selected).toEqual([])
  })

  it('treats a storage removal failure as no marker', async () => {
    stashMarker('gantt')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const layout = fakeLayout(null)
    launch({ services: { layout } })

    await flushRestore()

    expect(layout.selected).toEqual([])
  })

  it('leaves a selection the shell made first', async () => {
    stashMarker('gantt')
    const layout = fakeLayout('plugins')
    launch({ services: { layout } })

    await flushRestore()

    expect(layout.selected).toEqual([])
    expect(marker()).toBeNull()
  })

  it('keeps the conversation when the keyed entry is missing', async () => {
    stashMarker('gantt')
    const layout = fakeLayout(null)
    layout.selectPanel = () => {
      throw new Error('main panel "gantt" is not registered')
    }
    launch({ services: { layout } })

    await flushRestore()

    expect(marker()).toBeNull()
  })

  it('keeps the marker when there is no layout service yet', async () => {
    stashMarker('gantt')
    const app = launch({ services: {} })
    await flushRestore()
    expect(marker()).toMatchObject({ panel: 'gantt' })

    const layout = fakeLayout(null)
    app.services.layout = layout
    launch({ services: app.services })
    await flushRestore()
    expect(layout.selected).toEqual(['gantt'])
    expect(marker()).toBeNull()
  })

  it('does nothing without a marker', async () => {
    const layout = fakeLayout(null)
    launch({ services: { layout } })

    await flushRestore()

    expect(layout.selected).toEqual([])
  })

  it('returns whether a restore was scheduled', () => {
    const layout = fakeLayout(null)
    const app = launch({ services: { layout } })
    expect(restorePanel(app.ctx)).toBe(false)

    stashMarker('gantt')
    expect(restorePanel(app.ctx)).toBe(true)
  })
})
