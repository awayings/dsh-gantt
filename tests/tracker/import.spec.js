import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importTaskTracker, readTracker, resolveTrackerDir } from '../../tracker.js'
import { DAILY_MD, SCHEDULE_MD, TREE_MD, writeTrackerFixture } from './fixtures.js'
import { expectGanttError, makeTempDir, memoryStore, removeTempDir, snapshotEnv } from '../helpers/gantt.js'

let dir
let store

beforeEach(() => {
  dir = makeTempDir('dsh-gantt-tracker-')
  store = memoryStore()
})

afterEach(() => {
  store?.close()
  store = undefined
  if (dir) removeTempDir(dir)
  dir = undefined
})

describe('resolveTrackerDir', () => {
  it('prefers DSH_GANTT_TRACKER_DIR and falls back to the documented default', () => {
    const restore = snapshotEnv('DSH_GANTT_TRACKER_DIR')
    try {
      delete process.env.DSH_GANTT_TRACKER_DIR
      expect(resolveTrackerDir()).toBe('/data/home/clawd/projects/task-tracker')
      process.env.DSH_GANTT_TRACKER_DIR = '/tmp/elsewhere'
      expect(resolveTrackerDir()).toBe('/tmp/elsewhere')
    } finally {
      restore()
    }
  })
})

describe('readTracker', () => {
  const DAILY_14_MD = '---\ndate: 2026-11-14\n---\n\n## 🎯 今天核心目标\n\n> 昨天的目标。\n'

  it('reads the schedule, tree, and every dated daily card', () => {
    writeTrackerFixture(dir, { 'daily/2026-11-14.md': DAILY_14_MD })
    const sources = readTracker(dir)
    expect(sources.schedule).toBe(SCHEDULE_MD)
    expect(sources.tree).toBe(TREE_MD)
    expect([...sources.daily.entries()]).toEqual([
      ['2026-11-14', DAILY_14_MD],
      ['2026-11-15', DAILY_MD],
    ])
  })

  it('degrades missing files to empty results', () => {
    const empty = readTracker(dir)
    expect(empty.schedule).toBe('')
    expect(empty.tree).toBe('')
    expect(empty.daily.size).toBe(0)
    fs.mkdirSync(path.join(dir, 'daily'))
    expect(readTracker(dir).daily.size).toBe(0)
    fs.writeFileSync(path.join(dir, 'daily', 'template.md'), 'x')
    fs.writeFileSync(path.join(dir, 'daily', 'notes.txt'), 'x')
    expect(readTracker(dir).daily.size).toBe(0)
  })

  it('caps daily cards at the 31 newest file names', () => {
    fs.mkdirSync(path.join(dir, 'daily'), { recursive: true })
    const names = []
    for (let day = 1; day <= 31; day += 1) names.push(`daily/2026-01-${String(day).padStart(2, '0')}.md`)
    for (let day = 1; day <= 9; day += 1) names.push(`daily/2026-02-${String(day).padStart(2, '0')}.md`)
    for (const name of names) {
      writeTrackerFixture(dir, { [name]: `---\ndate: ${path.basename(name, '.md')}\n---\n` })
    }
    const daily = readTracker(dir).daily
    expect(daily.size).toBe(31)
    expect(daily.has('2026-01-11')).toBe(true)
    expect(daily.has('2026-01-10')).toBe(false)
    expect(daily.has('2026-02-09')).toBe(true)
  })

  it('rejects a missing directory, an empty path, and a file path', () => {
    const missing = path.join(dir, 'nope')
    expectGanttError(() => readTracker(missing), `tracker directory ${missing} was not found`)
    expectGanttError(() => readTracker(''), 'tracker directory is required')
    const file = path.join(dir, 'SCHEDULE.md')
    fs.writeFileSync(file, 'x')
    expectGanttError(() => readTracker(file), `tracker path ${file} is not a directory`)
  })
})

describe('importTaskTracker', () => {
  it('imports tracks, nodes, days, and blocks', () => {
    writeTrackerFixture(dir)
    const counts = importTaskTracker(store, { dir, year: 2026 })
    expect(counts).toEqual({ dir, tracks: 3, nodes: 7, days: 4, blocks: 10 })
    const bundle = store.dayPlan('2026-11-15')
    expect(bundle.day).toMatchObject({ weekday: '周日', dayKind: 'weekend', marketOpen: false, source: 'schedule' })
    expect(bundle.day?.coreGoal).toBe('把 1.8.1 这一周的读数收成一张表。')
    expect(bundle.blocks.map(block => block.id)).toEqual(['2026-11-15|09:00|0', '2026-11-15|21:00|1'])
    expect(bundle.tracks).toHaveLength(3)
    expect(bundle.nodes.map(node => node.id)).toEqual(['2.3', '1.8.1', '1.8.2', '1.9'])
    expect(bundle.integrity).toEqual([])
    expect(bundle.stats).toEqual({ total: 2, done: 0, inProgress: 0, skipped: 0, remaining: 2 })
    expect(store.dayPlan('2026-11-14').integrity).toEqual([{ code: 'inspiration-missing', blockId: '2026-11-14|21:00|2' }])
  })

  it('keeps user status and notes across a re-import', () => {
    writeTrackerFixture(dir)
    const first = importTaskTracker(store, { dir, year: 2026 })
    const blockId = '2026-11-15|09:00|0'
    store.setBlockStatus(blockId, 'done', 'shipped')
    const second = importTaskTracker(store, { dir, year: 2026 })
    expect(second).toEqual(first)
    const block = store.dayPlan('2026-11-15').blocks[0]
    expect(block).toMatchObject({ id: blockId, status: 'done', notes: 'shipped' })
  })

  it('deletes schedule rows that disappeared and never touches manual rows', () => {
    writeTrackerFixture(dir)
    importTaskTracker(store, { dir, year: 2026 })
    store.db.prepare(`INSERT INTO plan_blocks (id, plan_date, start_time, end_time, slot, title, source, created_at, updated_at)
      VALUES ('manual|1', '2026-11-15', '12:00', '13:00', 'daytime', 'Manual block', 'manual', 'now', 'now')`).run()
    const schedule = [SCHEDULE_MD.split('### 11/15')[0], '### 11/15 日 —— 周末（休市）· 主攻片（≥4h）\n'].join('')
    writeTrackerFixture(dir, { 'SCHEDULE.md': schedule })
    const counts = importTaskTracker(store, { dir, year: 2026 })
    expect(counts.blocks).toBe(3)
    expect(store.dayPlan('2026-11-15').blocks.map(block => block.id)).toEqual(['manual|1'])
    const kept = /** @type {{ count: number }} */ (store.db.prepare("SELECT COUNT(*) AS count FROM plan_blocks WHERE source = 'manual'").get())
    expect(kept.count).toBe(1)
  })

  it('gives each day the core goal of its own card', () => {
    writeTrackerFixture(dir, {
      'daily/2026-11-14.md': '---\ndate: 2026-11-14\n---\n\n## 🎯 今天核心目标\n\n> 昨天的目标。\n',
    })
    importTaskTracker(store, { dir, year: 2026 })
    expect(store.dayPlan('2026-11-14').day?.coreGoal).toBe('昨天的目标。')
    expect(store.dayPlan('2026-11-15').day?.coreGoal).toBe('把 1.8.1 这一周的读数收成一张表。')
    expect(store.dayPlan('2026-11-16').day?.coreGoal).toBe('')
  })

  it('leaves the core goal empty when the day has no card', () => {
    writeTrackerFixture(dir)
    fs.rmSync(path.join(dir, 'daily', '2026-11-15.md'))
    importTaskTracker(store, { dir, year: 2026 })
    expect(store.dayPlan('2026-11-15').day?.coreGoal).toBe('')
  })

  it('rejects a missing directory and an empty directory path', () => {
    const missing = path.join(dir, 'nope')
    expectGanttError(() => importTaskTracker(store, { dir: missing }), `tracker directory ${missing} was not found`)
    expectGanttError(() => importTaskTracker(store, {}), 'tracker directory is required')
  })
})
