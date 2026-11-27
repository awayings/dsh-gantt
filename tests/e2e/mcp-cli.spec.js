// End-to-end transport checks for the shipped MCP CLI. The unit suite calls
// `createMcpServer` in-process; this spec spawns the real `bin/gantt-mcp.js`
// process, waits for its bind line, and drives it over HTTP and stdio — the two
// transports a deployment actually starts. It also proves the network-bind
// guard refuses to serve a LAN address without a bearer token.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore, SCHEMA_VERSION } from '../../src/host/store.js'

const CLI = path.resolve(import.meta.dirname, '../../bin/gantt-mcp.js')
const TOKEN = 'e2e-mcp-token'
// The initialize answer must carry the version of the bytes actually running.
const manifest = /** @type {{ version: string }} */ (JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8'),
))

let dir
/** @type {import('node:child_process').ChildProcess[]} */
let children

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-gantt-e2e-mcp-'))
  children = []
})

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
  await Promise.all(children.map(child => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve(undefined)
    else child.once('close', () => resolve(undefined))
  })))
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  children = []
  dir = undefined
})

/** The SQLite path one case uses. */
function dbPath() {
  return path.join(dir, 'tasks.db')
}

/**
 * Spawn the CLI and collect stdout/stderr lines.
 * @param {string[]} args
 * @returns {{ child: import('node:child_process').ChildProcess, lines: string[], errors: string[], closed: Promise<number | null> }}
 */
function startCli(args) {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(child)
  const lines = []
  const errors = []
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    lines.push(...stdout.split('\n').slice(0, -1))
    stdout = stdout.slice(stdout.lastIndexOf('\n') + 1)
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
    errors.push(...stderr.split('\n').slice(0, -1))
    stderr = stderr.slice(stderr.lastIndexOf('\n') + 1)
  })
  const closed = new Promise(resolve => child.once('close', code => resolve(code)))
  return { child, lines, errors, closed }
}

/**
 * Resolve once the CLI prints its bind line.
 * @param {{ lines: string[], closed: Promise<number | null> }} cli
 * @returns {Promise<string>} the origin it listens on
 */
async function waitForOrigin(cli) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const line = cli.lines.find(value => value.startsWith('gantt-mcp listening on '))
    if (line) return line.slice('gantt-mcp listening on '.length).trim()
    const code = await Promise.race([cli.closed, sleep(100).then(() => null)])
    if (code !== null) throw new Error(`the CLI exited before listening (code ${code})`)
  }
  throw new Error('the CLI did not print its bind line')
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** POST one JSON-RPC message to the MCP endpoint. */
async function rpc(origin, message, token = TOKEN) {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(message),
  })
  return { status: response.status, payload: await response.json() }
}

describe('gantt-mcp CLI over HTTP', () => {
  it('serves health, enforces the token, and answers MCP', async () => {
    const cli = startCli(['--transport', 'http', '--host', '127.0.0.1', '--port', '0', '--db', dbPath(), '--token', TOKEN])
    const origin = await waitForOrigin(cli)

    const health = await fetch(`${origin}/healthz`)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true, name: 'dsh-gantt' })

    const unauthorized = await rpc(origin, { jsonrpc: '2.0', id: 1, method: 'initialize' }, '')
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.payload).toEqual({ ok: false, error: 'unauthorized' })

    const init = await rpc(origin, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'e2e', version: '0' } },
    })
    expect(init.status).toBe(200)
    expect(init.payload.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'dsh-gantt', version: manifest.version },
    })

    const tools = await rpc(origin, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(tools.payload.result.tools.map(tool => tool.name)).toEqual([
      'register_agent', 'list_agents', 'list_ready_tasks', 'search_tasks', 'get_tree_overview', 'get_task_context',
      'create_task', 'decompose_task', 'update_task', 'track_task', 'report_completion',
      'get_worker_guide',
    ])

    const notification = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })
    expect(notification.status).toBe(202)

    const missing = await fetch(`${origin}/nope`)
    expect(missing.status).toBe(404)
    const malformed = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: '{not json',
    })
    expect(malformed.status).toBe(400)
    expect((await malformed.json()).error.code).toBe(-32700)
  })

  it('refuses a database written by a newer build', async () => {
    const seed = new GanttStore(dbPath())
    seed.close()
    const newer = new DatabaseSync(dbPath())
    newer.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    newer.close()

    const cli = startCli(['--db', dbPath()])
    expect(await cli.closed).toBe(1)
    expect(cli.errors.join('\n')).toContain(`schema v${SCHEMA_VERSION + 1} is newer than this build supports`)
  })

  it('refuses a network bind without a bearer token', async () => {
    const cli = startCli(['--transport', 'http', '--host', '0.0.0.0', '--port', '0', '--db', dbPath()])
    const code = await cli.closed
    expect(code).toBe(1)
    expect(cli.errors.join('\n')).toContain('without a bearer token')
    expect(cli.lines.some(line => line.startsWith('gantt-mcp listening on'))).toBe(false)
  })
})

describe('gantt-mcp CLI over stdio', () => {
  it('answers initialize and tools/list on newline-delimited JSON', async () => {
    const cli = startCli(['--db', dbPath()])
    const expected = 2
    const responses = []
    let buffer = ''
    cli.child.stdout.setEncoding('utf8')
    cli.child.stdout.on('data', (chunk) => {
      buffer += chunk
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        if (part.trim() !== '') responses.push(JSON.parse(part))
      }
    })
    cli.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`)
    cli.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
    for (let attempt = 0; attempt < 100 && responses.length < expected; attempt += 1) await sleep(100)
    expect(responses.map(response => response.id)).toEqual([1, 2])
    expect(responses[0].result.serverInfo.name).toBe('dsh-gantt')
    expect(responses[1].result.tools).toHaveLength(12)
    expect(cli.errors).toEqual([])
  })
})
