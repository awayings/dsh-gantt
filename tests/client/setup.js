// jsdom bootstrap for the Gantt client suite.
//
// The suite drives the ESM sources under src/client directly (see harness.js);
// this file only configures React's act environment and per-test cleanup. The
// end-to-end suite still captures the built artifact through the module-loader
// stub; here that global stays unset so the source plugin is used.
import { afterEach, vi } from 'vitest'

// React 18 only flushes act() work when it sees this flag.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

delete globalThis.__ganttPluginModule

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  // The Gantt page remembers its view in localStorage; a clean slate keeps
  // each test's mount from restoring a view an earlier test left behind.
  globalThis.localStorage.clear()
  document.body.replaceChildren()
})
