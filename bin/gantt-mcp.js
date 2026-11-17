#!/usr/bin/env node
// CLI entry for the dsh-gantt MCP server. Stdio is the default transport so a
// coding tool can spawn it directly; the optional HTTP transport serves a
// single JSON-RPC POST endpoint plus a health check. A network bind needs a
// bearer token, so a LAN address cannot expose task writes unauthenticated.

import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { assertHttpBinding, createMcpServer } from '../src/host/mcp.js'
import { GanttStore, resolveDatabasePath } from '../src/host/store.js'

const USAGE = `Usage: gantt-mcp [options]

Options:
  --transport <stdio|http>  Transport (default: stdio)
  --host <host>             HTTP bind host (default: 127.0.0.1)
  --port <port>             HTTP bind port (default: 8765)
  --db <path>               SQLite path (default: DSH_GANTT_DB or $DSH_HOME/gantt/tasks.db)
  --token <token>           Bearer token for HTTP (default: GANTT_MCP_TOKEN)
  --help                    Show this help

Environment:
  GANTT_MCP_HOST, GANTT_MCP_PORT, GANTT_MCP_TOKEN, DSH_GANTT_DB`

/** @typedef {'stdio' | 'http'} McpTransport */
/** @typedef {{ transport: McpTransport, host: string, port: number, db: string,
 * token: string, help: boolean }} CliOptions */

/**
 * Parse one option value, supporting both `--flag value` and `--flag=value`.
 * @param {string[]} argv
 * @returns {CliOptions}
 */
function parseArgs(argv) {
  /** @type {CliOptions} */
  const options = {
    transport: 'stdio',
    host: process.env.GANTT_MCP_HOST || '127.0.0.1',
    port: process.env.GANTT_MCP_PORT ? Number(process.env.GANTT_MCP_PORT) : 8765,
    db: resolveDatabasePath(),
    token: process.env.GANTT_MCP_TOKEN || '',
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const separator = argument.indexOf('=')
    const flag = separator === -1 ? argument : argument.slice(0, separator)
    const inline = separator === -1 ? undefined : argument.slice(separator + 1)
    /** @param {string} name @returns {string} */
    const value = (name) => {
      if (inline !== undefined) return inline
      index += 1
      if (index >= argv.length) throw new Error(`missing value for ${name}`)
      return argv[index]
    }
    if (flag === '--help' || flag === '-h') {
      options.help = true
    } else if (flag === '--transport') {
      const transport = value(flag)
      if (transport !== 'stdio' && transport !== 'http') throw new Error(`invalid transport: ${transport}`)
      options.transport = transport
    } else if (flag === '--host') {
      options.host = value(flag)
    } else if (flag === '--port') {
      const port = Number(value(flag))
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port must be an integer from 0 to 65535')
      options.port = port
    } else if (flag === '--db') {
      options.db = value(flag)
    } else if (flag === '--token') {
      options.token = value(flag)
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  return options
}

/** @param {unknown} payload @returns {void} */
function writeJsonLine(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

/** @param {string} line */
function handleLine(line) {
  if (line.trim() === '') return
  /** @type {unknown} */
  let message
  try {
    message = JSON.parse(line)
  } catch {
    writeJsonLine({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    return
  }
  if (!isObject(message)) {
    writeJsonLine({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } })
    return
  }
  if (message.id === undefined) {
    mcp?.handle(message)
    return
  }
  let response
  try {
    response = mcp?.handle(message) ?? null
  } catch (error) {
    writeJsonLine({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } })
    return
  }
  if (response !== null) writeJsonLine(response)
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @type {ReturnType<typeof createMcpServer> | null} */
let mcp = null

/** @param {CliOptions} options */
function startStdio(options) {
  const store = new GanttStore(options.db)
  mcp = createMcpServer({ store })
  const readline = createInterface({ input: process.stdin, crlfDelay: Infinity })
  let closed = false
  /** @param {number} [code] */
  const close = (code = 0) => {
    if (closed) return
    closed = true
    readline.close()
    store.close()
    process.exit(code)
  }
  readline.on('line', handleLine)
  readline.on('close', () => close(0))
  process.once('SIGINT', () => close(0))
  process.once('SIGTERM', () => close(0))
}

/** @param {CliOptions} options */
function startHttp(options) {
  assertHttpBinding(options.host, options.token)
  const store = new GanttStore(options.db)
  const server = createMcpServer({ store })
  const http = createServer((request, response) => {
    handleHttp(request, response, server, options.token).catch((error) => {
      sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    })
  })
  http.listen(options.port, options.host, () => {
    const address = http.address()
    const port = address !== null && typeof address === 'object' ? address.port : options.port
    console.log(`gantt-mcp listening on http://${options.host}:${port}`)
  })
  /** @param {number} [code] */
  const close = (code = 0) => {
    http.close(() => {
      store.close()
      process.exit(code)
    })
  }
  process.once('SIGINT', () => close(0))
  process.once('SIGTERM', () => close(0))
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {{ handle: (message: unknown) => unknown }} server
 * @param {string} token
 * @returns {Promise<void>}
 */
async function handleHttp(request, response, server, token) {
  const url = new URL(request.url ?? '/', 'http://localhost')
  if (request.method === 'GET' && url.pathname === '/healthz') {
    sendJson(response, 200, { ok: true, name: 'dsh-gantt' })
    return
  }
  if (request.method !== 'POST' || url.pathname !== '/mcp') {
    sendJson(response, 404, { ok: false, error: 'not found' })
    return
  }
  if (token !== '' && request.headers.authorization !== `Bearer ${token}`) {
    sendJson(response, 401, { ok: false, error: 'unauthorized' })
    return
  }
  /** @type {unknown} */
  let message
  try {
    message = JSON.parse(await readBody(request))
  } catch {
    sendJson(response, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    return
  }
  /** @type {unknown} */
  let result
  try {
    result = server.handle(message)
  } catch (error) {
    sendJson(response, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } })
    return
  }
  if (result === null || result === undefined) {
    response.writeHead(202)
    response.end()
    return
  }
  sendJson(response, 200, result)
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<string>}
 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 1_000_000) {
        reject(new Error('request body too large'))
        request.destroy()
      }
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function main() {
  /** @type {CliOptions} */
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    console.error(USAGE)
    process.exitCode = 1
    return
  }
  if (options.help) {
    console.log(USAGE)
    return
  }
  try {
    if (options.transport === 'http') startHttp(options)
    else startStdio(options)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

main()
