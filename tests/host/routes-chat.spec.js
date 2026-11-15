// The chat route is the only host path that leaves the process: it reads the
// optional llm / agentDefaultModel services, assembles the tree context and the
// daily brief, and maps ChatError statuses onto the JSON error envelope.
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../../src/host/index.js'
import { ROUTES, bootPlugin, createContext, disposeAll, invoke } from '../helpers/host.js'
import { failingLlm, fakeLlm, finish, textDelta } from '../helpers/llm.js'

let boot

function start(options = {}) {
  boot = bootPlugin(options)
  return boot
}

afterEach(() => {
  if (boot) disposeAll(boot.disposers)
  boot = undefined
})

function selection() {
  return { provider: 'deepseek-official', model: 'fast' }
}

function services(llm) {
  return { llm, agentDefaultModel: { currentSelection: selection } }
}

const PROPOSAL = [
  '可以拆成两步：',
  '```json',
  JSON.stringify({
    planDate: '2026-11-16',
    children: [
      {
        title: '列出读数口径',
        doneWhen: '口径表能直接贴进日报',
        estimate: '30min',
        plan: { date: '2026-11-16', startTime: '21:00', endTime: '21:30', slot: 'evening' },
      },
      { title: '跑一遍收口', doneWhen: '表里没有待填格' },
    ],
  }),
  '```',
].join('\n')

/** Create one task through the public route and return its id. */
async function createTask(routes, title, parentId = null) {
  const created = await invoke(routes, ROUTES.tasks, { title, parentId, doneWhen: '完成标准' })
  return created.payload.task.id
}

describe('POST /api/gantt/chat', () => {
  it('runs the streamed model call with the tree context and returns the proposal', async () => {
    const llm = fakeLlm([textDelta(PROPOSAL), finish()])
    const { routes } = start({ services: services(llm) })
    const parentId = await createTask(routes, '父任务')
    const result = await invoke(routes, ROUTES.chat, { message: '拆解父任务', taskId: parentId })

    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(result.payload).toMatchObject({
      ok: true,
      model: { provider: 'deepseek-official', model: 'fast' },
    })
    expect(result.payload.reply).toBe('可以拆成两步：')
    expect(result.payload.proposal).toMatchObject({
      planDate: '2026-11-16',
      children: [
        { title: '列出读数口径', doneWhen: '口径表能直接贴进日报', estimate: '30min' },
        { title: '跑一遍收口', doneWhen: '表里没有待填格' },
      ],
    })

    expect(llm.calls).toHaveLength(1)
    const options = llm.calls[0]
    expect(options.maxTokens).toBe(1500)
    expect(options.provider).toBe('deepseek-official')
    expect(options.model).toBe('fast')
    expect(/** @type {any} */ (options).tools).toBeUndefined()
    expect(options.system).toContain('父任务')
    expect(options.system).toContain('今日窗口')
    expect(options.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: '拆解父任务' }] })
  })

  it('passes validated history through as previous request messages', async () => {
    const llm = fakeLlm([textDelta('好的'), finish()])
    const { routes } = start({ services: services(llm) })
    const result = await invoke(routes, ROUTES.chat, {
      message: '继续',
      history: [
        { role: 'user', content: '先修数据' },
        { role: 'assistant', content: '已经修好' },
      ],
    })
    expect(result.status).toBe(200)
    expect(result.payload.proposal).toBeNull()
    expect(llm.calls[0].messages).toHaveLength(3)
    expect(llm.calls[0].messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: '先修数据' }] })
  })

  it('reports a missing llm service as 503', async () => {
    const { routes } = start()
    const result = await invoke(routes, ROUTES.chat, { message: '拆解' })
    expect(result.status).toBe(503)
    expect(result.payload).toEqual({ ok: false, error: 'model unavailable' })
  })

  it('reports a missing default model as 503', async () => {
    const { routes } = start({ services: { llm: fakeLlm() } })
    const result = await invoke(routes, ROUTES.chat, { message: '拆解' })
    expect(result.status).toBe(503)
    expect(result.payload.error).toBe('model unavailable')
  })

  it('reports a host without ctx.get as 503 instead of throwing', async () => {
    const saved = process.env.DSH_GANTT_DB
    process.env.DSH_GANTT_DB = ':memory:'
    try {
      const { ctx, routes, disposers } = createContext()
      delete ctx.get
      apply(ctx)
      const result = await invoke(routes, ROUTES.chat, { message: '拆解' })
      expect(result.status).toBe(503)
      expect(result.payload.error).toBe('model unavailable')
      disposeAll(disposers)
    } finally {
      if (saved === undefined) delete process.env.DSH_GANTT_DB
      else process.env.DSH_GANTT_DB = saved
    }
  })

  it('maps malformed JSON and invalid messages to 400', async () => {
    const { routes } = start({ services: services(fakeLlm()) })
    const malformed = await invoke(routes, ROUTES.chat, '{')
    expect(malformed.status).toBe(400)
    expect(malformed.payload.error).toBe('request body must be valid JSON')

    const empty = await invoke(routes, ROUTES.chat, { message: '   ' })
    expect(empty.status).toBe(400)
    expect(empty.payload.error).toBe('message is required')

    const missing = await invoke(routes, ROUTES.chat, {})
    expect(missing.status).toBe(400)
  })

  it('maps an unknown focused task to 400', async () => {
    const { routes } = start({ services: services(fakeLlm()) })
    const result = await invoke(routes, ROUTES.chat, { message: '拆解', taskId: 'no-such-task' })
    expect(result.status).toBe(400)
    expect(result.payload.error).toBe('task no-such-task was not found')
  })

  it('maps an upstream stream failure to 502', async () => {
    const { routes } = start({ services: services(failingLlm()) })
    const result = await invoke(routes, ROUTES.chat, { message: '拆解' })
    expect(result.status).toBe(502)
    expect(result.payload).toEqual({ ok: false, error: 'model request failed' })
  })
})
