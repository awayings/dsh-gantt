import { afterEach, describe, expect, it } from 'vitest'
import { ROUTES, bootPlugin, disposeAll, invoke } from '../helpers/host.js'

let boot

function start() {
  boot = bootPlugin()
  return boot
}

afterEach(() => {
  if (boot) disposeAll(boot.disposers)
  boot = undefined
})

async function createTask(routes, body = { title: 'Task' }) {
  const result = await invoke(routes, ROUTES.tasks, body)
  expect(result.status).toBe(201)
  return result.payload.task
}

function flatten(nodes) {
  const flat = []
  const walk = (node) => {
    flat.push(node)
    node.children.forEach(walk)
  }
  nodes.forEach(walk)
  return flat
}

describe('POST /api/gantt/tasks with tracker metadata', () => {
  it('accepts the new fields and links, and maps a duplicate ref to 409', async () => {
    const { routes } = start()
    const created = await invoke(routes, ROUTES.tasks, {
      title: 'Track',
      kind: 'track',
      ref: 'track:1',
      lane: '赚钱',
      dep: '1.8',
      doneWhen: 'done',
      landing: 'a.md',
      estimate: '2h',
      category: 'A',
      inspiration: '#21',
      links: [{ type: 'memory', ref: 'key/x', label: 'memory' }],
    })
    expect(created.status).toBe(201)
    expect(created.payload.task).toMatchObject({ kind: 'track', ref: 'track:1', lane: '赚钱', source: 'manual', links: [{ type: 'memory', ref: 'key/x', label: 'memory' }] })
    const duplicate = await invoke(routes, ROUTES.tasks, { title: 'Track 2', kind: 'track', ref: 'track:1' })
    expect(duplicate.status).toBe(409)
    expect(duplicate.payload).toEqual({ ok: false, error: 'task with kind track and ref track:1 already exists' })
    const invalidLinks = await invoke(routes, ROUTES.tasks, { title: 'Bad links', links: [{ type: 'nope', ref: 'x' }] })
    expect(invalidLinks.status).toBe(400)
    expect(invalidLinks.payload.error).toBe('links[0].type must be one of memory, file, url, task, note')
  })

  it('updates the new fields and ignores kind and ref', async () => {
    const { routes } = start()
    const task = await createTask(routes, { title: 'Task', kind: 'node', ref: 'node:1.1' })
    const updated = await invoke(routes, ROUTES.update, {
      id: task.id,
      lane: '生活',
      doneWhen: 'later',
      links: [{ type: 'note', ref: 'n1' }],
      kind: 'track',
      ref: 'track:9',
    })
    expect(updated.status).toBe(200)
    expect(updated.payload.task).toMatchObject({ kind: 'node', ref: 'node:1.1', lane: '生活', doneWhen: 'later', links: [{ type: 'note', ref: 'n1' }] })
  })
})

describe('POST /api/gantt/task/decompose', () => {
  it('creates children and their plan cells', async () => {
    const { routes } = start()
    const parent = await createTask(routes, { title: 'Parent', startDate: '2024-01-01', endDate: '2024-01-31' })
    const result = await invoke(routes, ROUTES.decompose, {
      id: parent.id,
      planDate: '2024-02-10',
      children: [{ title: 'Child', doneWhen: 'done', plan: { date: '2024-02-10', startTime: '21:00', endTime: '22:00' } }],
    })
    expect(result.status).toBe(200)
    expect(result.payload.ok).toBe(true)
    expect(result.payload.parent.children).toHaveLength(1)
    expect(result.payload.children[0]).toMatchObject({ title: 'Child', kind: 'task', startDate: '2024-02-10', endDate: '2024-02-13' })
    expect(result.payload.blocks[0]).toMatchObject({
      planDate: '2024-02-10',
      slot: 'evening',
      source: 'task',
      title: 'Child',
      detail: 'done',
      sourceRef: `task:${result.payload.children[0].id}`,
    })
  })

  it('requires an id and maps validation and depth failures to 400', async () => {
    const { routes } = start()
    expect((await invoke(routes, ROUTES.decompose, { children: [] })).payload).toEqual({ ok: false, error: 'id is required' })
    const parent = await createTask(routes, { title: 'Parent' })
    const empty = await invoke(routes, ROUTES.decompose, { id: parent.id })
    expect(empty.status).toBe(400)
    expect(empty.payload.error).toBe('children must be a non-empty array')
    const child = await createTask(routes, { title: 'Child', parentId: parent.id })
    const grandchild = await createTask(routes, { title: 'Grandchild', parentId: child.id })
    const deep = await createTask(routes, { title: 'Deep', parentId: grandchild.id })
    const tooDeep = await invoke(routes, ROUTES.decompose, { id: deep.id, children: [{ title: 'One more' }] })
    expect(tooDeep.status).toBe(400)
    expect(tooDeep.payload.error).toBe('decompose would exceed 4 levels')
    const badPlan = await invoke(routes, ROUTES.decompose, { id: parent.id, children: [{ title: 'c', plan: { date: 'nope' } }] })
    expect(badPlan.status).toBe(400)
    expect(badPlan.payload.error).toBe('children[0].plan.date must be a YYYY-MM-DD date')
    const unknown = await invoke(routes, ROUTES.decompose, { id: 'ghost', children: [{ title: 'c' }] })
    expect(unknown.status).toBe(404)
  })
})

describe('POST /api/gantt/task/schedule', () => {
  it('schedules a task and returns the refreshed task and block', async () => {
    const { routes } = start()
    const task = await createTask(routes, { title: 'Task', doneWhen: 'done', landing: 'a.md', estimate: '1h', category: 'A', inspiration: '#1' })
    const result = await invoke(routes, ROUTES.schedule, { id: task.id, date: '2024-02-10', startTime: '21:00', endTime: '22:00' })
    expect(result.status).toBe(200)
    expect(result.payload.ok).toBe(true)
    expect(result.payload.task.id).toBe(task.id)
    expect(result.payload.block).toMatchObject({
      id: `task|${task.id}|2024-02-10`,
      slot: 'evening',
      title: 'Task',
      detail: 'done',
      landing: 'a.md',
      source: 'task',
    })
  })

  it('requires an id and maps input failures to 400', async () => {
    const { routes } = start()
    expect((await invoke(routes, ROUTES.schedule, { date: '2024-02-10' })).payload.error).toBe('id is required')
    const task = await createTask(routes, { title: 'Task' })
    const missingDate = await invoke(routes, ROUTES.schedule, { id: task.id })
    expect(missingDate.status).toBe(400)
    expect(missingDate.payload.error).toBe('date must be a YYYY-MM-DD date')
    const badTime = await invoke(routes, ROUTES.schedule, { id: task.id, date: '2024-02-10', startTime: '9:00' })
    expect(badTime.status).toBe(400)
    expect((await invoke(routes, ROUTES.schedule, { id: 'ghost', date: '2024-02-10' })).status).toBe(404)
  })
})

describe('GET /api/gantt/context', () => {
  it('exports the tree and the requested day with counts', async () => {
    const { routes } = start()
    const parent = await createTask(routes, { title: 'Parent', startDate: '2024-01-01', endDate: '2024-01-31' })
    await invoke(routes, ROUTES.schedule, { id: parent.id, date: '2024-02-10' })
    const result = await invoke(routes, `${ROUTES.context}?date=2024-02-10`)
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(result.payload).toMatchObject({
      ok: true,
      date: '2024-02-10',
      truncated: false,
      counts: { tracks: 0, nodes: 0, tasks: 1, blocks: 1 },
    })
    expect(result.payload.chars).toBe(result.payload.markdown.length)
    expect(result.payload.markdown).toContain('## 今日 2024-02-10')
    expect(result.payload.markdown).toContain('- [todo] other Parent')
  })

  it('defaults blank query parameters and accepts a root subtree and limit', async () => {
    const { routes } = start()
    const tree = await invoke(routes, ROUTES.tree)
    const today = tree.payload.today
    expect((await invoke(routes, `${ROUTES.context}?date=&root=&limit=`)).payload.date).toBe(today)
    const root = await createTask(routes, { title: 'Root', kind: 'track' })
    await createTask(routes, { title: 'Child', parentId: root.id })
    const subtree = await invoke(routes, `${ROUTES.context}?root=${root.id}&limit=2000`)
    expect(subtree.payload.counts).toEqual({ tracks: 1, nodes: 0, tasks: 1, blocks: 0 })
    expect(subtree.payload.markdown).toContain('Child')
  })

  it('maps an unknown root to 404 and a bad date or limit to 400', async () => {
    const { routes } = start()
    const unknown = await invoke(routes, `${ROUTES.context}?root=ghost`)
    expect(unknown.status).toBe(404)
    expect(unknown.payload.error).toBe('task ghost was not found')
    const badDate = await invoke(routes, `${ROUTES.context}?date=2024-02-30`)
    expect(badDate.status).toBe(400)
    expect(badDate.payload.error).toBe('date is not a valid calendar date')
    for (const limit of ['999', '60001', 'abc', '1000.5']) {
      const invalid = await invoke(routes, `${ROUTES.context}?limit=${limit}`)
      expect(invalid.status).toBe(400)
      expect(invalid.payload.error).toBe('limit must be an integer from 1000 to 60000')
    }
  })
})

describe('GET /api/gantt/tree brief', () => {
  it('reports lanes, pending leaves, frontier, and next from the unified tree', async () => {
    const { routes } = start()
    const track = await createTask(routes, { title: 'Track', kind: 'track', ref: 'track:1', lane: '赚钱', state: '进行' })
    await createTask(routes, { title: 'Node one', kind: 'node', ref: 'node:1.1', parentId: track.id })
    await createTask(routes, { title: 'Node two', kind: 'node', ref: 'node:1.2', parentId: track.id })
    const tree = await invoke(routes, ROUTES.tree)
    expect(tree.payload.brief).toMatchObject({
      pending: 2,
      frontier: [{ ref: 'node:1.2', title: 'Node two', trackName: 'Track' }],
      next: [{ ref: 'node:1.1', title: 'Node one', trackName: 'Track' }],
    })
    expect(tree.payload.brief.lanes).toHaveLength(1)
    expect(tree.payload.brief.lanes[0]).toMatchObject({ ref: 'track:1', lane: '赚钱', state: '' })
    const flat = flatten(tree.payload.tasks)
    expect(flat.find(node => node.ref === 'node:1.1')).toMatchObject({ kind: 'node', source: 'manual', links: [] })
  })
})
