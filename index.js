/**
 * Host half of the Gantt plugin.
 *
 * Provides the authenticated JSON API under `/api/gantt/*`. The Client half
 * calls these routes with the browser's existing signed session cookie; no
 * second server, port, or token is involved.
 */
import { GanttError, GanttStore, resolveDatabasePath } from './store.js'

export const name = 'gantt'
export const inject = ['connection']

const ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/gantt/tree',
    description: 'Read the hierarchical task tree with numbers, rollups, and stats.',
  },
  {
    method: 'GET',
    path: '/api/gantt/meta',
    description: 'Read the database location, status vocabulary, and this endpoint catalog.',
  },
  {
    method: 'POST',
    path: '/api/gantt/tasks',
    description: 'Create a task. Body: { title, parentId?, startDate?, endDate?, status?, progress?, description? }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/task/update',
    description: 'Update task fields. Body: { id, title?, description?, parentId?, startDate?, endDate?, status?, progress? }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/task/status',
    description: 'Change only status and/or progress. Body: { id, status, progress? }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/task/split',
    description: 'Split a task into child subtasks. Body: { id, children: [{ title, startDate?, endDate?, status?, progress? }] }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/task/delete',
    description: 'Delete a task and all of its descendants. Body: { id }.',
  },
  {
    method: 'POST',
    path: '/api/gantt/seed',
    description: 'Insert a small demo tree when the database is empty.',
  },
]

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

async function readBody(request) {
  let body
  try {
    body = await request.json()
  } catch {
    throw new GanttError('request body must be valid JSON')
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new GanttError('request body must be a JSON object')
  }
  return body
}

export function apply(ctx) {
  const store = new GanttStore(resolveDatabasePath())
  ctx.effect(() => () => store.close(), 'gantt: close SQLite database')

  const route = (method, path, handler) => {
    ctx.connection.fetch.register({
      path,
      methods: [method],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          return await handler(request)
        } catch (error) {
          const status = error instanceof GanttError ? error.status : 500
          const message = error instanceof Error ? error.message : String(error)
          return json({ ok: false, error: message }, status)
        }
      },
    })
  }

  route('GET', '/api/gantt/meta', async () => json({
    ok: true,
    ...store.meta(),
    endpoints: ENDPOINTS,
  }))

  route('GET', '/api/gantt/tree', async () => json({
    ok: true,
    ...store.snapshot(),
  }))

  route('POST', '/api/gantt/tasks', async (request) => {
    const body = await readBody(request)
    const task = store.create(body)
    return json({ ok: true, task }, 201)
  })

  route('POST', '/api/gantt/task/update', async (request) => {
    const body = await readBody(request)
    if (typeof body.id !== 'string' || body.id.length === 0) throw new GanttError('id is required')
    const { id, ...patch } = body
    const task = store.update(id, patch)
    return json({ ok: true, task })
  })

  route('POST', '/api/gantt/task/status', async (request) => {
    const body = await readBody(request)
    if (typeof body.id !== 'string' || body.id.length === 0) throw new GanttError('id is required')
    const task = store.setStatus(body.id, body.status, body.progress)
    return json({ ok: true, task })
  })

  route('POST', '/api/gantt/task/split', async (request) => {
    const body = await readBody(request)
    if (typeof body.id !== 'string' || body.id.length === 0) throw new GanttError('id is required')
    const result = store.split(body.id, body.children)
    return json({ ok: true, ...result })
  })

  route('POST', '/api/gantt/task/delete', async (request) => {
    const body = await readBody(request)
    if (typeof body.id !== 'string' || body.id.length === 0) throw new GanttError('id is required')
    const result = store.delete(body.id)
    return json({ ok: true, ...result })
  })

  route('POST', '/api/gantt/seed', async () => {
    const result = store.seed()
    return json({
      ok: true,
      ...result,
      ...(result.seeded ? store.snapshot() : {}),
    })
  })
}
