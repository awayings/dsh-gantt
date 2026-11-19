// End-to-end: the tag query parameters over a real HTTP server and a real
// SQLite file. The unit suites cover the filter branch by branch; this case
// proves the wire contract: the unfiltered snapshot is unchanged, tree pruning
// keeps ancestor paths and full-tree numbers, ready narrows rows and returns
// their tags, and the MCP tool exposes the same tag/mode parameters.
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMcpServer } from '../../src/host/mcp.js'
import { GanttStore } from '../../src/host/store.js'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'
import { installFetch, startServer } from './server.js'

const TREE = '/api/gantt/tree'
const READY = '/api/gantt/ready'
const TASKS = '/api/gantt/tasks'

let dir
let dbPath
let server
let restoreFetch
let store
let mcp

/** POST one JSON body through the shipped write route. */
async function post(pathname, body) {
  return fetch(`${server.origin}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Create one task through the shipped write route. */
async function createTask(body) {
  const response = await post(TASKS, body)
  expect(response.status).toBe(201)
  return (await response.json()).task
}

/** GET one path and return the parsed JSON with its status. */
async function get(pathname) {
  const response = await fetch(`${server.origin}${pathname}`)
  return { status: response.status, payload: await response.json() }
}

/** Flatten a response tree into `[title, number]` pairs in document order. */
function rendered(nodes) {
  const flat = []
  const walk = (list) => {
    for (const node of list) {
      flat.push([node.title, node.number])
      walk(node.children)
    }
  }
  walk(nodes)
  return flat
}

beforeEach(async () => {
  dir = makeTempDir('dsh-gantt-e2e-api-tags-')
  dbPath = path.join(dir, 'tasks.db')
  server = await startServer({ dbPath })
  restoreFetch = installFetch(server.origin)
})

afterEach(async () => {
  store?.close()
  store = undefined
  mcp = undefined
  if (restoreFetch) restoreFetch()
  if (server) await server.close()
  if (dir) removeTempDir(dir)
})

describe('tag filters over the HTTP API', () => {
  /** One track with tagged and untagged descendants plus one untagged root. */
  async function tagFixture() {
    const track = await createTask({ title: 'Track', tags: ['ops'] })
    await createTask({ title: 'UI', parentId: track.id, tags: ['ui'], status: 'done', progress: 100 })
    const ops = await createTask({ title: 'Ops', parentId: track.id, tags: ['ops'] })
    await createTask({ title: 'Infra', parentId: ops.id, tags: ['ops', 'infra'] })
    await createTask({ title: 'Both', parentId: track.id, tags: ['ops', 'ui'] })
    await createTask({ title: 'Plain' })
  }

  it('leaves the unfiltered snapshot untouched and prunes the tree with ancestor paths', async () => {
    await tagFixture()
    const full = await get(TREE)
    expect(full.status).toBe(200)
    expect(full.payload).not.toHaveProperty('filter')
    expect(rendered(full.payload.tasks)).toEqual([
      ['Track', '1'], ['UI', '1.1'], ['Ops', '1.2'], ['Infra', '1.2.1'], ['Both', '1.3'], ['Plain', '2'],
    ])

    const any = await get(`${TREE}?tags=ops`)
    expect(any.status).toBe(200)
    expect(any.payload.filter).toEqual({ tags: ['ops'], mode: 'any' })
    expect(rendered(any.payload.tasks)).toEqual([
      ['Track', '1'], ['Ops', '1.2'], ['Infra', '1.2.1'], ['Both', '1.3'],
    ])
    expect(any.payload.stats.total).toBe(4)
    expect(any.payload.brief).toEqual(full.payload.brief)
    expect(any.payload.dailyBrief).toEqual(full.payload.dailyBrief)

    const and = await get(`${TREE}?tags=ops,ui&mode=and`)
    expect(and.payload.filter).toEqual({ tags: ['ops', 'ui'], mode: 'and' })
    expect(rendered(and.payload.tasks)).toEqual([['Track', '1'], ['Both', '1.3']])

    const repeated = await get(`${TREE}?tags=ops&tags=ui`)
    expect(repeated.payload.filter).toEqual({ tags: ['ops', 'ui'], mode: 'any' })
  })

  it('rejects invalid tag and mode query parameters with 400', async () => {
    for (const [query, error] of [
      ['tags=', 'tags[0] must not be empty'],
      ['tags=ops,,ui', 'tags[1] must not be empty'],
      ['mode=all', 'mode must be one of any, and'],
    ]) {
      const invalid = await get(`${TREE}?${query}`)
      expect(invalid.status).toBe(400)
      expect(invalid.payload).toEqual({ ok: false, error })
    }
  })

  it('filters the ready list over the wire and returns each task tags', async () => {
    await createTask({ title: 'Ops', tags: ['ops'] })
    await createTask({ title: 'Ops db', tags: ['ops', 'db'] })
    await createTask({ title: 'Db', tags: ['db'] })
    await createTask({ title: 'Plain' })

    const all = await get(READY)
    expect(all.payload.tasks.map(task => task.title)).toEqual(['Ops', 'Ops db', 'Db', 'Plain'])
    expect(all.payload.tasks.map(task => task.tags)).toEqual([['ops'], ['ops', 'db'], ['db'], []])

    const any = await get(`${READY}?tags=ops`)
    expect(any.payload.tasks.map(task => task.title)).toEqual(['Ops', 'Ops db'])
    const and = await get(`${READY}?tags=ops,db&mode=and`)
    expect(and.payload.tasks.map(task => task.title)).toEqual(['Ops db'])
    const limited = await get(`${READY}?tags=db&limit=1`)
    expect(limited.payload.tasks.map(task => task.title)).toEqual(['Ops db'])

    const invalid = await get(`${READY}?mode=all`)
    expect(invalid.status).toBe(400)
    expect(invalid.payload).toEqual({ ok: false, error: 'mode must be one of any, and' })
  })

  it('mirrors the tag filter in the list_ready_tasks MCP tool', async () => {
    await createTask({ title: 'Ops', tags: ['ops'] })
    await createTask({ title: 'Both', tags: ['ops', 'ui'] })
    store = new GanttStore(dbPath)
    mcp = createMcpServer({ store })
    const call = args => /** @type {any} */ (mcp.handle({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'list_ready_tasks', arguments: args },
    }))
    const toolJson = response => JSON.parse(response.result.content[0].text)

    const any = toolJson(call({ tags: ['ops'] }))
    expect(any.tag).toBe('ready')
    expect(any.tasks.map(task => [task.title, task.tags])).toEqual([['Ops', ['ops']], ['Both', ['ops', 'ui']]])
    const and = toolJson(call({ tags: ['ops', 'ui'], mode: 'and' }))
    expect(and.tasks.map(task => task.title)).toEqual(['Both'])
    for (const [args, message] of [
      [{ tags: 'ops' }, 'tags must be an array'],
      [{ mode: 'all' }, 'mode must be one of any, and'],
    ]) {
      expect(call(args).result).toEqual({ content: [{ type: 'text', text: message }], isError: true })
    }
  })
})
