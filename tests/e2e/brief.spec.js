// End-to-end: the daily 该动 report over real HTTP and a real SQLite file.
// The chat route has no model service in this harness, so it must answer 503
// rather than crash when the seam is absent.
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
  dir = makeTempDir('dsh-gantt-e2e-brief-')
  fs.mkdirSync(TMP, { recursive: true })
  fixture = fs.mkdtempSync(path.join(TMP, 'tracker-e2e-brief-'))
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

describe('daily brief end-to-end', () => {
  it('serves and recomputes the report for an imported day', async () => {
    await request('/api/gantt/plan/import', { dir: fixture, year: 2026 })

    const read = await request('/api/gantt/brief?date=2026-11-15')
    expect(read.status).toBe(200)
    expect(read.payload).toMatchObject({ ok: true, date: '2026-11-15', cached: false })
    expect(read.payload.brief).toMatchObject({ date: '2026-11-15', source: 'auto', dayKind: 'weekend' })
    expect(read.payload.brief.slots.map(slot => [slot.startTime, slot.endTime, slot.kind]))
      .toEqual([['09:00', '17:00', 'core'], ['21:00', '22:00', 'definition']])
    expect(read.payload.brief.items.length).toBeGreaterThan(0)
    expect(read.payload.brief.tracks.length).toBe(3)
    expect(read.payload.brief.tracks.map(track => track.role)).toContain('core')

    // Only today's report is cached by a read; a past date is rebuilt each time.
    const todayRead = await request('/api/gantt/brief')
    expect(todayRead.payload.cached).toBe(false)
    const todayAgain = await request('/api/gantt/brief')
    expect(todayAgain.payload.cached).toBe(true)

    const computed = await request('/api/gantt/brief/compute', { date: '2026-11-15' })
    expect(computed.status).toBe(200)
    expect(computed.payload).toMatchObject({ ok: true, date: '2026-11-15', cached: false })
    expect(computed.payload.brief.source).toBe('manual')
  })

  it('exposes the report through the tree snapshot and the day bundle', async () => {
    await request('/api/gantt/plan/import', { dir: fixture, year: 2026 })
    const tree = await request('/api/gantt/tree')
    expect(tree.payload.dailyBrief).toMatchObject({ date: tree.payload.today })
    const day = await request('/api/gantt/day?date=2026-11-15')
    expect(day.payload.brief).toMatchObject({ date: '2026-11-15' })
  })

  it('answers 503 for chat when the host has no model service', async () => {
    const result = await request('/api/gantt/chat', { message: '拆解' })
    expect(result.status).toBe(503)
    expect(result.payload).toEqual({ ok: false, error: 'model unavailable' })
  })
})
