// jsdom bootstrap for the end-to-end suite.
//
// Same contract as tests/client/setup.js: client.js is the browser artifact and
// calls `window.__ModuleLoader__.load({ id, factory })` at module scope, so the
// stub below captures the descriptor and lets specs instantiate the real plugin
// factory with the real React. Unlike the unit suite, the end-to-end suite then
// points `fetch` at a real HTTP server (see tests/e2e/server.js) instead of a
// stub, so the shipped client and the shipped host talk to each other for real.
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
  document.body.replaceChildren()
})
