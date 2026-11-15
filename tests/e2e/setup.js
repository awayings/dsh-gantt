// jsdom bootstrap for the end-to-end suite.
//
// This suite drives the shipped browser artifact: tests/e2e/setup.js evaluates
// the built lib/client.js as a classic script, exactly like the DSH module
// loader does, and keeps the registered descriptor so harness.createPlugin()
// instantiates the bundle's factory with the real React. Fetch is then pointed
// at a real HTTP server (see tests/e2e/server.js) instead of a stub.
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, vi } from 'vitest'

// React 18 only flushes act() work when it sees this flag.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

window.__ModuleLoader__ = {
  load(descriptor) {
    globalThis.__ganttPluginModule = descriptor
  },
}

const artifact = path.resolve(import.meta.dirname, '../../lib/client.js')
const source = fs.readFileSync(artifact, 'utf8')
new Function(source)()

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
