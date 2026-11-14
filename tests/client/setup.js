// jsdom bootstrap for the Gantt client suite.
//
// client.js is the browser half of the plugin: at module scope it calls
// `window.__ModuleLoader__.load({ id, factory })`. The stub below keeps the
// descriptor so specs can call `factory(require)` with the real React, and lets
// the module evaluate without a host runtime. Everything after `await import`
// is deterministic: no network, no real timers, one fresh document per spec.
import { afterEach, vi } from 'vitest'

// React 18 only flushes act() work when it sees this flag.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

window.__ModuleLoader__ = {
  load(descriptor) {
    globalThis.__ganttPluginModule = descriptor
  },
}

await vi.importActual('../../client.js')

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})
