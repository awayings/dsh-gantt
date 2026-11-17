// A real HTTP server in front of the plugin's host routes.
//
// The unit suites call the registered `ctx.connection.fetch` handlers in-process
// with a fake context. The end-to-end suite instead boots the real `apply()`
// against a real SQLite file, puts the same handlers behind node:http, and lets
// the shipped client artifact call them over the wire. That covers what unit
// tests cannot: relative request URLs, JSON serialization, response headers,
// status codes, and data that survives closing and reopening the database.
import http from 'node:http'
import { apply } from '../../src/host/index.js'
import { createContext } from '../helpers/host.js'

/**
 * Boot the plugin against `dbPath`, then restore the caller's environment.
 * The env override is applied only while `apply` constructs the store, so the
 * real database location is never touched.
 * @param {string} dbPath
 */
function bootHost(dbPath) {
  const saved = process.env.DSH_GANTT_DB
  process.env.DSH_GANTT_DB = dbPath
  try {
    const { ctx, routes, disposers } = createContext()
    apply(ctx)
    return { routes, disposers }
  } finally {
    if (saved === undefined) delete process.env.DSH_GANTT_DB
    else process.env.DSH_GANTT_DB = saved
  }
}

/** Write a JSON response that never came from a registered route. */
function reject(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: message }))
}

/**
 * Translate one node request into a `Request`, dispatch it to the registered
 * handler, and copy the `Response` back out. This mirrors what the host
 * connection layer does for the plugin.
 * @param {Map<string, import('../../src/host/index.js').GanttRoute> & { get: (path: string, method?: string) => any }} routes
 * @param {{ origin: string }} state
 */
function createHandler(routes, state) {
  return async (req, res) => {
    const { pathname } = new URL(String(req.url), 'http://127.0.0.1')
    const definition = routes.get(pathname, String(req.method)) ?? routes.get(pathname)
    if (!definition) {
      reject(res, 404, `no route for ${pathname}`)
      return
    }
    if (!definition.methods.includes(String(req.method))) {
      reject(res, 405, `${req.method} is not allowed on ${pathname}`)
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const request = new Request(new URL(String(req.url), state.origin), {
      method: req.method,
      headers: /** @type {Record<string, string>} */ (req.headers),
      body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    })
    const response = await definition.fetch(request)
    /** @type {Record<string, string>} */
    const headers = {}
    for (const [name, value] of response.headers) headers[name] = value
    res.writeHead(response.status, headers)
    res.end(Buffer.from(await response.arrayBuffer()))
  }
}

/**
 * Start a disposable server on an ephemeral port.
 * @param {{ dbPath: string }} options
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
export async function startServer({ dbPath }) {
  const host = bootHost(dbPath)
  /** @type {{ origin: string }} */
  const state = { origin: '' }
  const server = http.createServer(createHandler(host.routes, state))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(undefined))
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  state.origin = `http://127.0.0.1:${port}`
  return {
    origin: state.origin,
    async close() {
      await new Promise(resolve => server.close(resolve))
      for (const dispose of host.disposers) dispose()
    },
  }
}

/**
 * Route the page's relative `fetch('api/gantt/tree')` calls to the real server.
 * Returns a function that puts the original fetch back.
 * @param {string} origin
 */
export function installFetch(origin) {
  const nodeFetch = globalThis.fetch
  globalThis.fetch = (input, init) =>
    nodeFetch(input instanceof Request ? input : new URL(String(input), origin), init)
  return () => {
    globalThis.fetch = nodeFetch
  }
}
