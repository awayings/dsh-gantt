import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { GanttStore, SCHEMA_VERSION } from '../../src/host/store.js'
import {
  DRAIN_BATCH_LIMIT,
  armDispatchNotice,
  completeDispatchNotice,
  expireDispatchNotices,
  markDispatchNoticeDelivered,
  pendingDispatchNotices,
} from '../../src/host/store/notify.js'
import { expectGanttError, makeTempDir, removeTempDir } from '../helpers/gantt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** Seed one track (ref T1) with one child task (number 1.1). */
function seedTask() {
  const track = store.create({ title: 'Lab', kind: 'track', ref: 'T1' })
  const task = store.create({ title: 'Run the probe', parentId: track.id, doneWhen: 'Probe output saved' })
  return { track, task }
}

describe('armDispatchNotice', () => {
  it('arms a row for the delegating session, uncompleted and undelivered', () => {
    const { task } = seedTask()
    const notice = armDispatchNotice(store, task.id, 'session-a')
    expect(notice).toMatchObject({
      taskId: task.id,
      sessionId: 'session-a',
      status: '',
      agentName: '',
      completedAt: null,
      deliveredAt: null,
      outcome: '',
    })
    expect(notice.id).not.toBe('')
    expect(notice.createdAt).not.toBe('')
    expect(pendingDispatchNotices(store)).toEqual([])
  })

  it('trims the session id and rejects a blank one and an unknown task', () => {
    const { task } = seedTask()
    expect(armDispatchNotice(store, task.id, ' session-a ').sessionId).toBe('session-a')
    expectGanttError(() => armDispatchNotice(store, task.id, '  '), 'sessionId is required')
    expectGanttError(() => armDispatchNotice(store, 'missing', 'session-a'), 'task missing was not found', 404)
  })
})

describe('completeDispatchNotice', () => {
  it('completes the newest armed row and lists it as pending', () => {
    const { task } = seedTask()
    armDispatchNotice(store, task.id, 'session-a')
    const notice = completeDispatchNotice(store, task.id, { status: 'done', agentName: 'pve-oc' })
    expect(notice).toMatchObject({ taskId: task.id, sessionId: 'session-a', status: 'done', agentName: 'pve-oc' })
    expect(notice.completedAt).not.toBe(null)
    expect(pendingDispatchNotices(store)).toEqual([notice])
  })

  it('completes only the latest delegation and leaves the earlier row armed', () => {
    const { task } = seedTask()
    armDispatchNotice(store, task.id, 'session-a')
    armDispatchNotice(store, task.id, 'session-b')
    const notice = completeDispatchNotice(store, task.id, { status: 'blocked', agentName: 'pve-oc' })
    expect(notice.sessionId).toBe('session-b')
    // The completed delegation is the one pending delivery; the superseded arm waits.
    expect(pendingDispatchNotices(store)).toEqual([notice])
    const rows = store.db.prepare('SELECT session_id AS sessionId, status FROM dispatch_notices ORDER BY created_at, rowid').all()
    expect(rows).toEqual([{ sessionId: 'session-a', status: '' }, { sessionId: 'session-b', status: 'blocked' }])
  })

  it('returns null for an unarmed task and validates the status', () => {
    const { task } = seedTask()
    expect(completeDispatchNotice(store, task.id, { status: 'done' })).toBe(null)
    armDispatchNotice(store, task.id, 'session-a')
    expectGanttError(
      () => completeDispatchNotice(store, task.id, { status: 'paused' }),
      'status must be one of todo, in_progress, blocked, done, cancelled',
    )
  })

  it('defaults a missing agent name to the empty string', () => {
    const { task } = seedTask()
    armDispatchNotice(store, task.id, 'session-a')
    expect(completeDispatchNotice(store, task.id, { status: 'done' }).agentName).toBe('')
  })
})

describe('pending and delivered bookkeeping', () => {
  it('lists completed rows oldest write-back first within the batch limit', () => {
    const track = store.create({ title: 'Lab', kind: 'track' })
    const tasks = Array.from({ length: DRAIN_BATCH_LIMIT + 2 }, (_unused, index) =>
      store.create({ title: `Task ${index}`, parentId: track.id }))
    for (const task of tasks) armDispatchNotice(store, task.id, 'session-a')
    for (const task of tasks) completeDispatchNotice(store, task.id, { status: 'done', agentName: 'w' })
    expect(pendingDispatchNotices(store).length).toBe(DRAIN_BATCH_LIMIT)
    expect(pendingDispatchNotices(store, 2).length).toBe(2)
  })

  it('marks one row delivered exactly once', () => {
    const { task } = seedTask()
    armDispatchNotice(store, task.id, 'session-a')
    const notice = completeDispatchNotice(store, task.id, { status: 'done' })
    markDispatchNoticeDelivered(store, notice.id, 'steered')
    const first = store.db.prepare('SELECT delivered_at AS deliveredAt, outcome FROM dispatch_notices WHERE id = ?').get(notice.id)
    expect(first.deliveredAt).not.toBe(null)
    expect(first.outcome).toBe('steered')
    // A second mark is a no-op, so a redelivered message can never move the row back.
    markDispatchNoticeDelivered(store, notice.id, 'expired')
    const second = store.db.prepare('SELECT delivered_at AS deliveredAt, outcome FROM dispatch_notices WHERE id = ?').get(notice.id)
    expect(second).toEqual(first)
    expect(pendingDispatchNotices(store)).toEqual([])
  })
})

describe('expireDispatchNotices', () => {
  it('expires armed and completed rows older than the cutoff, keeping fresh rows', () => {
    const { task } = seedTask()
    const staleArmed = armDispatchNotice(store, task.id, 'session-a')
    store.db.prepare('UPDATE dispatch_notices SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', staleArmed.id)
    // The newest arm is the one a write-back completes; backdate it after completing.
    armDispatchNotice(store, task.id, 'session-b')
    const staleCompleted = completeDispatchNotice(store, task.id, { status: 'done', agentName: 'w' })
    expect(staleCompleted.sessionId).toBe('session-b')
    store.db.prepare('UPDATE dispatch_notices SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', staleCompleted.id)
    const fresh = armDispatchNotice(store, task.id, 'session-c')
    expect(expireDispatchNotices(store, '2026-06-01T00:00:00.000Z')).toBe(2)
    const rows = store.db.prepare('SELECT id, delivered_at AS deliveredAt, outcome FROM dispatch_notices ORDER BY id').all()
    expect(rows.find(row => row.id === staleArmed.id).outcome).toBe('expired')
    expect(rows.find(row => row.id === staleCompleted.id).outcome).toBe('expired')
    expect(rows.find(row => row.id === fresh.id).outcome).toBe('')
  })
})

describe('cascade', () => {
  it('deletes its notices with the task', () => {
    const { track, task } = seedTask()
    armDispatchNotice(store, task.id, 'session-a')
    store.delete(task.id)
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM dispatch_notices').get().count).toBe(0)
    expect(store.getRow(track.id)).not.toBe(null)
  })
})

describe('v10 upgrade', () => {
  it('creates the notices table for a v10 database and bumps the version', () => {
    const dir = makeTempDir('dsh-gantt-notice-v10-')
    const file = path.join(dir, 'tasks.db')
    try {
      const seeded = new GanttStore(file)
      const { task } = { task: seeded.create({ title: 'Legacy task' }) }
      seeded.close()
      // Simulate a real v10 file: no notices table, version pinned at 10.
      const raw = new DatabaseSync(file)
      raw.exec('DROP TABLE dispatch_notices')
      raw.exec('PRAGMA user_version = 10')
      raw.close()

      store = new GanttStore(file)
      expect(store.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
      const notice = armDispatchNotice(store, task.id, 'session-a')
      expect(completeDispatchNotice(store, task.id, { status: 'done', agentName: 'w' })).toMatchObject({
        id: notice.id, status: 'done',
      })
      expect(store.meta().schemaVersion).toBe(SCHEMA_VERSION)
    } finally {
      store?.close()
      store = undefined
      removeTempDir(dir)
    }
  })
})
