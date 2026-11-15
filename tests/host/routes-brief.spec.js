import { afterEach, describe, expect, it } from 'vitest'
import { todayIso } from '../../store.js'
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

/** A report-like shape check shared by the two brief routes. */
function expectReport(report, date) {
  expect(report).toMatchObject({
    date,
    source: expect.any(String),
    dayKind: expect.any(String),
    slots: expect.any(Array),
    items: expect.any(Array),
    tracks: expect.any(Array),
    unfilled: expect.any(Array),
    notes: expect.any(Array),
  })
  expect(typeof report.generatedAt).toBe('string')
  expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false)
}

describe('GET /api/gantt/brief', () => {
  it('computes and caches the report for today', async () => {
    const { routes } = start()
    const first = await invoke(routes, ROUTES.brief)
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect(first.payload).toMatchObject({ ok: true, today: todayIso(), date: todayIso(), cached: false })
    expectReport(first.payload.brief, todayIso())
    expect(first.payload.brief.source).toBe('auto')
    const second = await invoke(routes, ROUTES.brief)
    expect(second.payload.cached).toBe(true)
    expect(second.payload.brief).toEqual(first.payload.brief)
  })

  it('computes explicit dates without caching them', async () => {
    const { routes } = start()
    const first = await invoke(routes, `${ROUTES.brief}?date=2026-11-10`)
    expect(first.status).toBe(200)
    expect(first.payload).toMatchObject({ ok: true, date: '2026-11-10', cached: false })
    expectReport(first.payload.brief, '2026-11-10')
    const second = await invoke(routes, `${ROUTES.brief}?date=2026-11-10`)
    expect(second.payload.cached).toBe(false)
    const blank = await invoke(routes, `${ROUTES.brief}?date=%20`)
    expect(blank.payload).toMatchObject({ date: todayIso(), cached: false })
  })

  it('maps an invalid date to 400', async () => {
    const { routes } = start()
    for (const date of ['2026-02-30', 'nope']) {
      const result = await invoke(routes, `${ROUTES.brief}?date=${date}`)
      expect(result.status).toBe(400)
      expect(result.payload.ok).toBe(false)
      expect(result.payload.error).toContain('date')
    }
  })
})

describe('POST /api/gantt/brief/compute', () => {
  it('forces a manual recompute and caches the result', async () => {
    const { routes } = start()
    const computed = await invoke(routes, ROUTES.briefCompute, {})
    expect(computed.status).toBe(200)
    expect(computed.payload).toMatchObject({ ok: true, today: todayIso(), date: todayIso(), cached: false })
    expectReport(computed.payload.brief, todayIso())
    expect(computed.payload.brief.source).toBe('manual')
    const cached = await invoke(routes, ROUTES.brief)
    expect(cached.payload).toMatchObject({ cached: true, brief: { source: 'manual' } })
  })

  it('accepts an explicit date and reports it back', async () => {
    const { routes } = start()
    const computed = await invoke(routes, ROUTES.briefCompute, { date: '2026-11-12' })
    expect(computed.status).toBe(200)
    expect(computed.payload).toMatchObject({ date: '2026-11-12', cached: false, brief: { date: '2026-11-12', source: 'manual' } })
    const cached = await invoke(routes, `${ROUTES.brief}?date=2026-11-12`)
    expect(cached.payload.cached).toBe(true)
  })

  it('rejects invalid dates, malformed JSON, and non-object bodies', async () => {
    const { routes } = start()
    const badDate = await invoke(routes, ROUTES.briefCompute, { date: '2026-02-30' })
    expect(badDate.status).toBe(400)
    expect(badDate.payload.error).toBe('date is not a valid calendar date')
    const nonString = await invoke(routes, ROUTES.briefCompute, { date: 7 })
    expect(nonString.status).toBe(400)
    expect(nonString.payload.error).toBe('date must be a YYYY-MM-DD date')
    expect((await invoke(routes, ROUTES.briefCompute, '{oops')).payload).toEqual({ ok: false, error: 'request body must be valid JSON' })
    expect((await invoke(routes, ROUTES.briefCompute, '[]')).payload).toEqual({ ok: false, error: 'request body must be a JSON object' })
  })
})

describe('daily brief wiring into the existing reads', () => {
  it('adds dailyBrief to the tree snapshot and brief to the day bundle', async () => {
    const { routes } = start()
    await invoke(routes, ROUTES.tasks, { title: 'Tree task' })
    const tree = await invoke(routes, ROUTES.tree)
    expectReport(tree.payload.dailyBrief, todayIso())
    expect(tree.payload.dailyBrief.source).toBe('auto')
    const cached = await invoke(routes, ROUTES.brief)
    expect(cached.payload.brief).toEqual(tree.payload.dailyBrief)
    const day = await invoke(routes, `${ROUTES.day}?date=${todayIso()}`)
    expect(day.payload.brief).toEqual(tree.payload.dailyBrief)
    const otherDay = await invoke(routes, `${ROUTES.day}?date=2026-11-10`)
    expectReport(otherDay.payload.brief, '2026-11-10')
    expect(otherDay.payload.brief.source).toBe('auto')
  })
})
