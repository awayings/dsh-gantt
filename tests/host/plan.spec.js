import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { todayIso } from '../../src/host/store.js'
import { ROUTES, bootPlugin, disposeAll, invoke } from '../helpers/host.js'
import { makeTempDir, removeTempDir, snapshotEnv } from '../helpers/gantt.js'
import { writeTrackerFixture } from '../tracker/fixtures.js'

let boot
let dir

function start() {
  boot = bootPlugin()
  return boot
}

function fixtureDir() {
  dir = makeTempDir('dsh-gantt-host-plan-')
  writeTrackerFixture(dir)
  return dir
}

afterEach(() => {
  if (boot) disposeAll(boot.disposers)
  boot = undefined
  if (dir) removeTempDir(dir)
  dir = undefined
})

describe('GET /api/gantt/day', () => {
  it('defaults to today when the date is missing or blank', async () => {
    const { routes } = start()
    for (const apiPath of [ROUTES.day, `${ROUTES.day}?date=`, `${ROUTES.day}?date=%20`]) {
      const result = await invoke(routes, apiPath)
      expect(result.status).toBe(200)
      expect(result.headers.get('cache-control')).toBe('no-store')
      expect(result.payload).toMatchObject({ ok: true, today: todayIso(), date: todayIso(), day: null })
      expect(result.payload.blocks).toEqual([])
      expect(result.payload.integrity).toEqual([{ code: 'evening-missing' }, { code: 'unplanned-day' }])
      expect(result.payload.stats).toEqual({ total: 0, done: 0, inProgress: 0, skipped: 0, remaining: 0 })
    }
  })

  it('reads the requested date and maps an invalid one to 400', async () => {
    const { routes } = start()
    const empty = await invoke(routes, `${ROUTES.day}?date=2026-11-15`)
    expect(empty.status).toBe(200)
    expect(empty.payload).toMatchObject({ ok: true, date: '2026-11-15', day: null, blocks: [], nodes: [], tracks: [] })
    const invalid = await invoke(routes, `${ROUTES.day}?date=2026-02-30`)
    expect(invalid.status).toBe(400)
    expect(invalid.payload).toEqual({ ok: false, error: 'date is not a valid calendar date' })
  })

  it('returns imported blocks, nodes, tracks, integrity, and stats', async () => {
    const { routes } = start()
    const fixture = fixtureDir()
    await invoke(routes, ROUTES.planImport, { dir: fixture, year: 2026 })
    const result = await invoke(routes, `${ROUTES.day}?date=2026-11-15`)
    expect(result.status).toBe(200)
    expect(result.payload.day).toEqual({
      date: '2026-11-15',
      weekday: '周日',
      dayKind: 'weekend',
      marketOpen: false,
      label: '周末（休市）· 主攻片（≥4h）',
      coreGoal: '把 1.8.1 这一周的读数收成一张表。',
      source: 'schedule',
    })
    expect(result.payload.blocks).toHaveLength(2)
    expect(result.payload.blocks[0]).toMatchObject({
      id: '2026-11-15|09:00|0',
      planDate: '2026-11-15',
      source: 'schedule',
      sourceRef: 'SCHEDULE.md',
      status: 'todo',
    })
    expect(result.payload.tracks).toHaveLength(3)
    expect(result.payload.tracks[0]).toMatchObject({ name: '投资系统', lane: '赚钱', priority: '', state: '进行' })
    const nodes = result.payload.nodes
    expect(nodes.map(node => node.ref)).toEqual(expect.arrayContaining(['node:1.8.1', 'node:1.8.2', 'node:1.9', 'node:2.3']))
    expect(nodes.find(node => node.ref === 'node:1.8.1')).toMatchObject({
      kind: 'node',
      trackId: result.payload.tracks.find(track => track.ref === 'track:1')?.id,
      title: 'S2 每日交易仓读数',
      state: '未开始',
      startDate: '2026-11-09',
      endDate: '2026-11-15',
      dep: '',
      doneWhen: '每天一句读数',
      landing: '',
      estimate: '',
      category: '',
      inspiration: '',
      links: [],
    })
    expect(result.payload.integrity).toEqual([])
    expect(result.payload.stats).toEqual({ total: 2, done: 0, inProgress: 0, skipped: 0, remaining: 2 })
  })
})

describe('POST /api/gantt/plan/status', () => {
  it('updates a block status and notes', async () => {
    const { routes } = start()
    const fixture = fixtureDir()
    await invoke(routes, ROUTES.planImport, { dir: fixture, year: 2026 })
    const result = await invoke(routes, ROUTES.planStatus, { id: '2026-11-15|09:00|0', status: 'done', notes: 'shipped' })
    expect(result.status).toBe(200)
    expect(result.payload).toMatchObject({ ok: true, block: { id: '2026-11-15|09:00|0', status: 'done', notes: 'shipped' } })
    const day = await invoke(routes, `${ROUTES.day}?date=2026-11-15`)
    expect(day.payload.stats).toEqual({ total: 2, done: 1, inProgress: 0, skipped: 0, remaining: 1 })
  })

  it('maps validation failures to 400 and an unknown block to 404', async () => {
    const { routes } = start()
    const fixture = fixtureDir()
    await invoke(routes, ROUTES.planImport, { dir: fixture, year: 2026 })
    const missingId = await invoke(routes, ROUTES.planStatus, { status: 'done' })
    expect(missingId.status).toBe(400)
    expect(missingId.payload).toEqual({ ok: false, error: 'id is required' })
    const badStatus = await invoke(routes, ROUTES.planStatus, { id: '2026-11-15|09:00|0', status: 'blocked' })
    expect(badStatus.status).toBe(400)
    expect(badStatus.payload.error).toBe('status must be one of todo, in_progress, done, skipped')
    const longNotes = await invoke(routes, ROUTES.planStatus, { id: '2026-11-15|09:00|0', status: 'done', notes: 'x'.repeat(501) })
    expect(longNotes.status).toBe(400)
    const unknown = await invoke(routes, ROUTES.planStatus, { id: 'nope', status: 'done' })
    expect(unknown.status).toBe(404)
    expect(unknown.payload).toEqual({ ok: false, error: 'plan block nope was not found' })
  })

  it('rejects a non-object body and malformed JSON', async () => {
    const { routes } = start()
    expect((await invoke(routes, ROUTES.planStatus, '[]')).payload).toEqual({ ok: false, error: 'request body must be a JSON object' })
    expect((await invoke(routes, ROUTES.planStatus, '{oops')).payload).toEqual({ ok: false, error: 'request body must be valid JSON' })
  })
})

describe('POST /api/gantt/plan/import', () => {
  it('imports from an absolute directory and reports counts', async () => {
    const { routes } = start()
    const fixture = fixtureDir()
    const result = await invoke(routes, ROUTES.planImport, { dir: fixture, year: 2026 })
    expect(result.status).toBe(200)
    expect(result.payload).toEqual({
      ok: true,
      dir: fixture,
      imported: { dir: fixture, tracks: 3, nodes: 7, days: 4, blocks: 10 },
    })
  })

  it('uses DSH_GANTT_TRACKER_DIR when the body has no dir', async () => {
    const { routes } = start()
    const fixture = fixtureDir()
    const restore = snapshotEnv('DSH_GANTT_TRACKER_DIR')
    try {
      process.env.DSH_GANTT_TRACKER_DIR = fixture
      const result = await invoke(routes, ROUTES.planImport, {})
      expect(result.status).toBe(200)
      expect(result.payload.dir).toBe(fixture)
      expect(result.payload.imported.days).toBe(4)
    } finally {
      restore()
    }
  })

  it('maps dir and year validation failures to 400', async () => {
    const { routes } = start()
    const relative = await invoke(routes, ROUTES.planImport, { dir: 'relative/path' })
    expect(relative.status).toBe(400)
    expect(relative.payload).toEqual({ ok: false, error: 'dir must be an absolute path' })
    const nonString = await invoke(routes, ROUTES.planImport, { dir: 7 })
    expect(nonString.status).toBe(400)
    expect(nonString.payload.error).toBe('dir must be an absolute path')
    const fixture = fixtureDir()
    const missing = path.join(fixture, 'nope')
    const absent = await invoke(routes, ROUTES.planImport, { dir: missing })
    expect(absent.status).toBe(400)
    expect(absent.payload.error).toBe(`tracker directory ${missing} was not found`)
    for (const year of ['2026', 1969, 99999, 2026.5, null]) {
      const invalid = await invoke(routes, ROUTES.planImport, { dir: fixture, year })
      expect(invalid.status).toBe(400)
      expect(invalid.payload.error).toBe('year must be an integer from 1970 to 9999')
    }
  })

  it('imports without an explicit year for the current board', async () => {
    const { routes } = start()
    const fixture = fixtureDir()
    const result = await invoke(routes, ROUTES.planImport, { dir: fixture })
    expect(result.status).toBe(200)
    expect(result.payload.imported).toMatchObject({ tracks: 3, nodes: 7, days: 4, blocks: 10 })
  })
})
