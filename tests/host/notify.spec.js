import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NOTICE_INTERVAL_MS,
  buildNoticeMessage,
  drainDispatchNotices,
  noticeMessageId,
  renderDispatchNotice,
  startNotifyDrainer,
} from '../../src/host/notify.js'
import { armDispatchNotice, completeDispatchNotice } from '../../src/host/store/notify.js'
import { GanttStore } from '../../src/host/store.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** Seed one track (ref T1) with one child task (number 1.1). */
function seedTask(title = 'Run the probe') {
  const track = store.create({ title: 'Lab', kind: 'track', ref: 'T1' })
  const task = store.create({ title, parentId: track.id, doneWhen: 'Probe output saved' })
  return { track, task }
}

/** Arm and complete one notice, returning the completed row. */
function completedNotice(taskId, status = 'done', agentName = 'pve-oc') {
  armDispatchNotice(store, taskId, 'session-a')
  return completeDispatchNotice(store, taskId, { status, agentName })
}

/** A fake agents registry: `get` maps the session ids it holds to spies. */
function agentsRegistry() {
  const agents = new Map()
  return {
    register(sessionId) {
      const agent = { steer: vi.fn(/** @param {unknown} _message */ (_message) => {}) }
      agents.set(sessionId, agent)
      return agent
    },
    get: sessionId => agents.get(sessionId),
  }
}

describe('notice message', () => {
  it('prefixes the message id with the producer', () => {
    expect(noticeMessageId('abc')).toBe('dsh-gantt:notify:abc')
  })

  it('builds a frozen user message carrying the relay source', () => {
    const { task } = seedTask()
    const notice = completedNotice(task.id)
    const text = renderDispatchNotice(notice, store.getNode(task.id))
    const message = buildNoticeMessage(notice, text)
    expect(message).toEqual({
      id: noticeMessageId(notice.id),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'dsh-gantt', form: 'relay' },
    })
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.content[0])).toBe(true)
    expect(Object.isFrozen(message.source)).toBe(true)
  })
})

describe('renderDispatchNotice', () => {
  it('carries the label, title, status, agent, and notice id — never the report', () => {
    const { task } = seedTask('Ship the probe')
    const notice = completedNotice(task.id, 'done', 'pve-oc')
    store.update(task.id, { report: 'SECRET-EVIDENCE-xyz verified in tests/report.spec.js' })
    const text = renderDispatchNotice(notice, store.getNode(task.id))
    expect(text).toContain('【甘特远程状态通知】')
    expect(text).toContain('任务：1.1 Ship the probe（状态：done）')
    expect(text).toContain('汇报人：pve-oc（经 gantt MCP 写回）')
    expect(text).toContain(`notice_id: ${notice.id}`)
    expect(text).toContain('本通知不含报告正文')
    expect(text).toContain('照抄执行者上报的结论')
    expect(text).not.toContain('SECRET-EVIDENCE-xyz')
  })

  it('prefers the external ref over the point number and names an unregistered reporter', () => {
    const track = store.create({ title: 'Lab', kind: 'track', ref: 'T1' })
    const task = store.create({ title: 'Run the probe', parentId: track.id, ref: 'ops:probe' })
    const notice = completedNotice(task.id, 'blocked', '')
    const text = renderDispatchNotice(notice, store.getNode(task.id))
    expect(text).toContain('任务：ops:probe Run the probe（状态：blocked）')
    expect(text).toContain('汇报人：（未登记）（经 gantt MCP 写回）')
  })
})

describe('drainDispatchNotices', () => {
  it('steers a completed notice into the resident dispatch conversation, exactly once', () => {
    const { task } = seedTask()
    const notice = completedNotice(task.id)
    const agents = agentsRegistry()
    const agent = agents.register('session-a')
    const first = drainDispatchNotices(store, agents)
    expect(first).toMatchObject({ steered: 1, skipped: 0, expired: 0 })
    expect(agent.steer).toHaveBeenCalledTimes(1)
    const message = /** @type {any} */ (agent.steer.mock.calls[0][0])
    expect(message.id).toBe(noticeMessageId(notice.id))
    expect(message.content[0].text).toContain('任务：1.1 Run the probe（状态：done）')
    // The delivered mark makes the second pass a no-op.
    const second = drainDispatchNotices(store, agents)
    expect(second).toMatchObject({ steered: 0, skipped: 0 })
    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('leaves a notice pending while its conversation is not resident, then delivers on arrival', () => {
    const { task } = seedTask()
    completedNotice(task.id)
    const agents = agentsRegistry()
    expect(drainDispatchNotices(store, agents)).toMatchObject({ steered: 0, skipped: 1 })
    expect(pendingRows()).toBe(1)
    const agent = agents.register('session-a')
    expect(drainDispatchNotices(store, agents)).toMatchObject({ steered: 1, skipped: 0 })
    expect(agent.steer).toHaveBeenCalledTimes(1)
  })

  it('keeps a notice pending when steer throws, and retries on the next pass', () => {
    const { task } = seedTask()
    completedNotice(task.id)
    const agents = agentsRegistry()
    const agent = agents.register('session-a')
    agent.steer.mockImplementationOnce(() => { throw new Error('disposed') })
    expect(drainDispatchNotices(store, agents)).toMatchObject({ steered: 0, skipped: 1 })
    expect(pendingRows()).toBe(1)
    expect(drainDispatchNotices(store, agents)).toMatchObject({ steered: 1, skipped: 0 })
  })

  it('skips every notice without an agents service and sweeps expired rows', () => {
    const { task } = seedTask()
    const notice = completedNotice(task.id)
    expect(drainDispatchNotices(store, undefined)).toMatchObject({ steered: 0, skipped: 1 })
    store.db.prepare('UPDATE dispatch_notices SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', notice.id)
    expect(drainDispatchNotices(store, undefined)).toMatchObject({ steered: 0, skipped: 0, expired: 1 })
    expect(pendingRows()).toBe(0)
  })

  /** Count of completed-but-undelivered rows. */
  function pendingRows() {
    return store.db.prepare('SELECT COUNT(*) AS count FROM dispatch_notices WHERE completed_at IS NOT NULL AND delivered_at IS NULL').get().count
  }
})

describe('startNotifyDrainer', () => {
  it('drains on the interval and stops on dispose', () => {
    vi.useFakeTimers()
    try {
      const { task } = seedTask()
      completedNotice(task.id)
      const agents = agentsRegistry()
      const agent = agents.register('session-a')
      const stop = startNotifyDrainer(store, agents)
      expect(agent.steer).not.toHaveBeenCalled()
      vi.advanceTimersByTime(NOTICE_INTERVAL_MS)
      expect(agent.steer).toHaveBeenCalledTimes(1)
      stop()
      vi.advanceTimersByTime(NOTICE_INTERVAL_MS * 3)
      expect(agent.steer).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
