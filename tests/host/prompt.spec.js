import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GanttStore } from '../../src/host/store.js'
import { PROTOCOL_SECTION, installPrompt, renderFocusContext } from '../../src/host/prompt.js'

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** Seed track → node → task and focus the task for one conversation. */
function focusTask() {
  const track = store.create({ title: 'Content platform', kind: 'track', ref: 'T1' })
  const node = store.create({ title: 'Weekly report', parentId: track.id })
  const task = store.create({ title: 'Collect data', parentId: node.id, doneWhen: 'Data table ready' })
  store.setFocus('session-a', task.id)
  return { track, node, task }
}

describe('focused task prompt context', () => {
  it('renders nothing without a conversation or a focus', () => {
    expect(renderFocusContext(store, undefined)).toBe('')
    expect(renderFocusContext(store, 5)).toBe('')
    expect(renderFocusContext(store, '')).toBe('')
    expect(renderFocusContext(store, 'session-a')).toBe('')
  })

  it('renders the ancestor chain, the focus detail, and an empty trajectory', () => {
    const { task } = focusTask()
    const text = renderFocusContext(store, 'session-a')
    expect(text).toContain('# 甘特图聚焦上下文')
    expect(text).toContain('## 聚焦任务链路（从支线根到聚焦任务）')
    expect(text).toContain('T1 Content platform（支线 · 待办）')
    expect(text).toContain('Weekly report')
    expect(text).toContain(`${task.number} Collect data`)
    expect(text).toContain('## 当前聚焦任务（拆解对象）')
    expect(text).toContain('完成标准：Data table ready')
    expect(text).toContain('## 任务轨迹（会话与轮次）')
    expect(text).toContain('（暂无会话记录）')
  })

  it('renders recorded events so a new conversation can read them', async () => {
    const { task } = focusTask()
    await store.update(task.id, { status: 'in_progress', progress: 60 }, { sessionId: 'session-old', turn: 3, summary: 'rows pulled' })
    const text = renderFocusContext(store, 'session-a')
    expect(text).toContain('会话 session-old')
    expect(text).toContain('第 3 轮')
    expect(text).toContain('rows pulled')
    expect(text).toContain('更新 · 会话 session-old')
  })

  it('never fails prompt assembly for a malformed conversation id', () => {
    focusTask()
    expect(renderFocusContext(store, 's'.repeat(201))).toBe('')
  })
})

describe('task protocol section', () => {
  it('makes one round-closing tool call mandatory', () => {
    expect(PROTOCOL_SECTION).toContain('## 甘特图任务协议')
    expect(PROTOCOL_SECTION).toContain('内容专用主会话')
    expect(PROTOCOL_SECTION).toContain('每一轮都必须以下面四个工具调用之一收尾')
    expect(PROTOCOL_SECTION).toContain('只回复文字、不以这四个工具之一收尾是不允许的')
    for (const tool of ['gantt_track', 'gantt_update_task', 'gantt_decompose', 'gantt_create_task']) {
      expect(PROTOCOL_SECTION).toContain(tool)
    }
  })

  it('records provenance automatically and keeps the completion guidance', () => {
    expect(PROTOCOL_SECTION).toContain('不要把这些值写进标题、描述或完成标准')
    expect(PROTOCOL_SECTION).toContain('status 设为 `done`')
    expect(PROTOCOL_SECTION).toContain('gantt_decompose` 拆成可独立验证的子任务')
    expect(PROTOCOL_SECTION).toContain('`blocked`')
  })
})

describe('prompt registration', () => {
  /** @returns {{ ctx: any, sections: any[], contexts: any[], effects: any[] }} */
  function fakeContext() {
    const sections = []
    const contexts = []
    const effects = []
    const ctx = {
      effect(fn, hint) {
        effects.push([fn, hint])
        return fn()
      },
      systemPrompt: {
        section: (section) => {
          sections.push(section)
          return () => {}
        },
        context: (context) => {
          contexts.push(context)
          return () => {}
        },
      },
    }
    return { ctx, sections, contexts, effects }
  }

  it('registers the static protocol section and the dynamic focus context', () => {
    const { ctx, sections, contexts, effects } = fakeContext()
    installPrompt(ctx, store)
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ name: 'gantt:protocol', order: 700, interpolate: false })
    expect(sections[0].text).toBe(PROTOCOL_SECTION)
    expect(contexts).toHaveLength(1)
    expect(contexts[0]).toMatchObject({ name: 'gantt:focus', order: 530, interpolate: false })
    expect(effects.map(([, hint]) => hint)).toEqual(['gantt: task protocol section', 'gantt: focused task context'])
  })

  it('resolves the context text from the assembling conversation', () => {
    const { ctx, contexts } = fakeContext()
    const { task } = focusTask()
    installPrompt(ctx, store)
    const text = contexts[0].text
    expect(text({ agent: { session: { id: 'session-a' } } })).toContain(task.title)
    expect(text({})).toBe('')
    expect(text(undefined)).toBe('')
  })

  it('disposes both registrations with the plugin context', () => {
    const sectionDispose = vi.fn()
    const contextDispose = vi.fn()
    const ctx = {
      effect(fn) {
        return fn()
      },
      systemPrompt: {
        section: () => sectionDispose,
        context: () => contextDispose,
      },
      connection: { fetch: { register: () => {} } },
    }
    installPrompt(ctx, store)
    const disposers = [sectionDispose, contextDispose]
    expect(disposers.every(dispose => typeof dispose === 'function')).toBe(true)
  })
})
