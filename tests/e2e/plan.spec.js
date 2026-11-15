// End-to-end: import a tracker fixture from disk, then read it back through the
// real HTTP route and a real SQLite file. The fixture lives under `.tmp/` (the
// repo's only scratch area) and is removed afterwards.
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startServer } from './server.js'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'
import { writeTrackerFixture } from '../tracker/fixtures.js'

const ROOT = path.resolve(import.meta.dirname, '../..')
const TMP = path.join(ROOT, '.tmp')

let dir
let fixture
let server

/** @param {string} apiPath @param {unknown} [body] */
async function request(apiPath, body) {
  const response = await fetch(`${server.origin}${apiPath}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: await response.json() }
}

beforeEach(async () => {
  dir = makeTempDir('dsh-gantt-e2e-plan-')
  fs.mkdirSync(TMP, { recursive: true })
  fixture = fs.mkdtempSync(path.join(TMP, 'tracker-e2e-'))
  writeTrackerFixture(fixture)
  server = await startServer({ dbPath: path.join(dir, 'tasks.db') })
})

afterEach(async () => {
  if (server) await server.close()
  if (dir) removeTempDir(dir)
  if (fixture) removeTempDir(fixture)
  server = undefined
  dir = undefined
  fixture = undefined
})

describe('tracker import end-to-end', () => {
  it('imports a fixture directory and serves the day bundle over HTTP', async () => {
    const imported = await request('/api/gantt/plan/import', { dir: fixture, year: 2026 })
    expect(imported.status).toBe(200)
    expect(imported.payload).toEqual({
      ok: true,
      dir: fixture,
      imported: { dir: fixture, tracks: 3, nodes: 7, days: 4, blocks: 10 },
    })

    const day = await request('/api/gantt/day?date=2026-11-15')
    expect(day.status).toBe(200)
    expect(day.payload.day).toMatchObject({ date: '2026-11-15', weekday: '周日', dayKind: 'weekend', marketOpen: false })
    expect(day.payload.blocks.map(block => block.id)).toEqual(['2026-11-15|09:00|0', '2026-11-15|21:00|1'])
    expect(day.payload.blocks[1]).toMatchObject({ slot: 'evening', inspiration: '#21', sourceRef: 'SCHEDULE.md' })
    expect(day.payload.nodes.length).toBeGreaterThan(0)
    expect(day.payload.integrity).toEqual([])
  })

  it('persists a status update across the HTTP write and the next read', async () => {
    await request('/api/gantt/plan/import', { dir: fixture, year: 2026 })
    const updated = await request('/api/gantt/plan/status', { id: '2026-11-15|09:00|0', status: 'done', notes: 'e2e' })
    expect(updated.status).toBe(200)
    const day = await request('/api/gantt/day?date=2026-11-15')
    expect(day.payload.stats).toEqual({ total: 2, done: 1, inProgress: 0, skipped: 0, remaining: 1 })
    expect(day.payload.blocks[0]).toMatchObject({ status: 'done', notes: 'e2e' })
  })

  it('decomposes a tree node and reads the new block back from the day bundle', async () => {
    await request('/api/gantt/plan/import', { dir: fixture, year: 2026 })
    const tree = await request('/api/gantt/tree')
    const flat = []
    const walk = (node) => {
      flat.push(node)
      node.children.forEach(walk)
    }
    tree.payload.tasks.forEach(walk)
    expect(flat.filter(node => node.kind === 'track')).toHaveLength(3)
    const parent = flat.find(node => node.ref === 'node:1.8.1')
    expect(parent).toBeDefined()
    expect(tree.payload.brief.frontier.length).toBeGreaterThan(0)

    const decomposed = await request('/api/gantt/task/decompose', {
      id: parent.id,
      planDate: '2026-11-16',
      children: [{ title: 'S2.1 three legs', plan: { date: '2026-11-16', startTime: '21:00', endTime: '22:00' } }],
    })
    expect(decomposed.status).toBe(200)
    expect(decomposed.payload.children).toHaveLength(1)
    const blockId = decomposed.payload.blocks[0].id
    expect(decomposed.payload.blocks[0]).toMatchObject({ source: 'task', slot: 'evening' })

    const childId = decomposed.payload.children[0].id
    const scheduled = await request('/api/gantt/task/schedule', {
      id: childId,
      date: '2026-11-16',
      startTime: '22:00',
      endTime: '23:00',
      detail: 'scheduled over HTTP',
    })
    expect(scheduled.status).toBe(200)
    expect(scheduled.payload.block.source).toBe('task')
    expect(scheduled.payload.block.detail).toBe('scheduled over HTTP')
    const day = await request('/api/gantt/day?date=2026-11-16')
    expect(day.payload.blocks.map(block => block.id)).toContain(blockId)
    expect(day.payload.blocks.map(block => block.id)).toContain(scheduled.payload.block.id)
    expect(day.payload.blocks.find(block => block.id === blockId)).toMatchObject({ title: 'S2.1 three legs', source: 'task' })

    const context = await request('/api/gantt/context?date=2026-11-16')
    expect(context.status).toBe(200)
    expect(context.payload.counts.tasks).toBe(1)
    expect(context.payload.markdown).toContain('S2.1 three legs')
  })

  it('rejects an invalid day date and a missing tracker directory', async () => {
    const invalidDate = await request('/api/gantt/day?date=2026-02-30')
    expect(invalidDate.status).toBe(400)
    expect(invalidDate.payload).toEqual({ ok: false, error: 'date is not a valid calendar date' })
    const missing = await request('/api/gantt/plan/import', { dir: path.join(fixture, 'nope') })
    expect(missing.status).toBe(400)
    expect(missing.payload.ok).toBe(false)
  })
})
