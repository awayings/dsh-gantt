import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ChatError,
  buildChatMessages,
  buildSystemPrompt,
  parseProposal,
  runChat,
} from '../../src/host/chat.js'
import { todayIso } from '../../src/host/tree.js'
import {
  brokenLlm,
  failingLlm,
  fakeLlm,
  finish,
  hangingLlm,
  reasoningDelta,
  textDelta,
} from '../helpers/llm.js'

const SELECTION = { provider: 'deepseek', model: 'deepseek-chat' }
const FENCE = '```'

/** Build one tree node with the fields chat.js reads. @param {Record<string, any>} [overrides] @returns {any} */
function node(overrides = {}) {
  return {
    id: 'node',
    parentId: null,
    number: '1',
    ref: '1',
    kind: 'node',
    title: 'Node',
    state: '',
    status: 'todo',
    doneWhen: '',
    dep: '',
    estimate: '',
    category: '',
    children: [],
    ...overrides,
  }
}

/** Depth 1 track: weekly (2) -> collect (3) -> export (4), plus sibling review (2). */
function sampleTasks() {
  return [
    node({
      id: 'track',
      ref: '1',
      number: '1',
      kind: 'track',
      title: '内容平台',
      children: [
        node({
          id: 'weekly',
          parentId: 'track',
          ref: '1.1',
          number: '1.1',
          title: '写周报',
          doneWhen: '周报已发送',
          children: [
            node({
              id: 'collect',
              parentId: 'weekly',
              ref: '1.1.1',
              number: '1.1.1',
              title: '收集数据',
              doneWhen: '数据表齐全',
              children: [
                node({
                  id: 'export',
                  parentId: 'collect',
                  ref: '1.1.1.1',
                  number: '1.1.1.1',
                  kind: 'task',
                  title: '导出表格',
                }),
              ],
            }),
          ],
        }),
        node({ id: 'review', parentId: 'track', ref: '1.2', number: '1.2', title: '复盘' }),
      ],
    }),
  ]
}

function sampleContext() {
  return { markdown: '# 个人任务树\n- 内容平台\n', tasks: sampleTasks() }
}

function sampleBrief() {
  return {
    date: '2026-11-16',
    slots: [
      { slot: 'morning', startTime: '09:00', endTime: '12:00', minutes: 180, kind: 'core', blockId: 'b1' },
      { slot: 'evening', startTime: '21:00', endTime: '22:00', minutes: 60, kind: 'definition', blockId: 'b2' },
      { slot: 'daytime', startTime: '', endTime: '', minutes: 0, kind: 'rotation', blockId: '' },
    ],
    items: [
      { slot: 'morning', startTime: '09:00', endTime: '12:00', minutes: 180, blockId: 'b1', taskId: 'weekly', ref: '1.1', title: '写周报', trackName: '内容平台', role: 'core' },
      { slot: 'evening', startTime: '21:00', endTime: '22:00', minutes: 60, blockId: 'b2', taskId: 'review', ref: '1.2', title: '复盘', trackName: '内容平台', role: 'definition' },
    ],
  }
}

function fence(value, reply = '拆解如下。') {
  const body = typeof value === 'string' ? value : JSON.stringify(value)
  return `${reply}\n\n${FENCE}json\n${body}\n${FENCE}`
}

/** Turn a promise rejection into the thrown value for assertions. */
async function rejectionOf(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to reject')
}

describe('ChatError', () => {
  it('defaults to 400 and carries a status for the route', () => {
    const error = new ChatError('bad input')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ChatError')
    expect(error.status).toBe(400)
    expect(new ChatError('upstream', 502).status).toBe(502)
    expect(new ChatError('unavailable', 503).status).toBe(503)
  })
})

describe('parseProposal', () => {
  it('returns the trimmed reply with no proposal when there is no json block', () => {
    const result = parseProposal('  只聊两句，不拆解。  ')
    expect(result).toEqual({ reply: '只聊两句，不拆解。', proposal: null })
    expect(parseProposal('')).toEqual({ reply: '', proposal: null })
  })

  it('validates and normalizes a complete proposal, stripping unknown fields', () => {
    const text = fence({
      planDate: '2026-11-17',
      unknownTop: true,
      children: [{
        title: '  收集数据  ',
        doneWhen: '  数据表齐全  ',
        landing: '  周报  ',
        estimate: ' 30min ',
        category: ' A ',
        inspiration: ' 灵感 ',
        startDate: '2026-11-17',
        endDate: '2026-11-18',
        unknownChild: 'strip',
        plan: { date: '2026-11-17', startTime: '21:00', endTime: '21:30', slot: 'evening', unknownPlan: true },
      }],
    })
    const result = parseProposal(text)
    expect(result.reply).toBe('拆解如下。')
    expect(result.proposal).toEqual({
      planDate: '2026-11-17',
      children: [{
        title: '收集数据',
        doneWhen: '数据表齐全',
        landing: '周报',
        estimate: '30min',
        category: 'A',
        inspiration: '灵感',
        startDate: '2026-11-17',
        endDate: '2026-11-18',
        plan: { date: '2026-11-17', startTime: '21:00', endTime: '21:30', slot: 'evening' },
      }],
    })
  })

  it('derives the plan slot from the start time and keeps optional plan fields empty', () => {
    const text = fence(validProposalText({
      planDate: null,
      children: [
        { title: 'A', doneWhen: 'a', plan: { date: '2026-11-17', startTime: '09:00' } },
        { title: 'B', doneWhen: 'b', plan: { date: '2026-11-17', slot: 'other' } },
        { title: 'C', doneWhen: 'c', plan: null },
        { title: 'D', doneWhen: 'd' },
        { title: 'E', doneWhen: 'e', landing: '', estimate: '', plan: { date: '2026-11-17', startTime: '', endTime: '' } },
      ],
    }))
    const { proposal } = parseProposal(text)
    expect(proposal.planDate).toBeNull()
    expect(proposal.children[0].plan).toEqual({ date: '2026-11-17', startTime: '09:00', endTime: '', slot: 'morning' })
    expect(proposal.children[1].plan).toEqual({ date: '2026-11-17', startTime: '', endTime: '', slot: 'other' })
    expect('plan' in proposal.children[2]).toBe(false)
    expect('plan' in proposal.children[3]).toBe(false)
    expect(proposal.children[4].landing).toBeUndefined()
    expect(proposal.children[4].estimate).toBeUndefined()
    expect(proposal.children[4].plan).toEqual({ date: '2026-11-17', startTime: '', endTime: '', slot: 'other' })
  })

  it('parses the last fenced block and keeps earlier blocks in the reply', () => {
    const first = fence(validProposalText({ planDate: '2026-11-16', children: [{ title: '旧', doneWhen: '旧' }] }), '第一段')
    const second = fence(validProposalText({ planDate: '2026-11-17', children: [{ title: '新', doneWhen: '新' }] }), '第二段')
    const result = parseProposal(`${first}\n中间\n${second}`)
    expect(result.proposal.planDate).toBe('2026-11-17')
    expect(result.proposal.children[0].title).toBe('新')
    expect(result.reply).toContain(`${FENCE}json`)
    expect(result.reply).toContain('第一段')
    expect(result.reply).toContain('第二段')
    expect(result.reply).not.toContain('"新"')
  })

  it('keeps invalid proposals out and leaves the reply untouched', () => {
    const cases = [
      ['not json', '{oops'],
      ['json scalar', 'null'],
      ['json array', '[]'],
      ['missing children', '{}'],
      ['empty children', '{"children":[]}'],
      ['too many children', JSON.stringify({ children: Array.from({ length: 9 }, () => ({ title: 'x', doneWhen: 'y' })) })],
      ['child is null', '{"children":[null]}'],
      ['child is a string', '{"children":["x"]}'],
      ['child is an array', '{"children":[[]]}'],
      ['missing title', '{"children":[{"doneWhen":"y"}]}'],
      ['empty title', '{"children":[{"title":"  ","doneWhen":"y"}]}'],
      ['long title', JSON.stringify({ children: [{ title: 'x'.repeat(201), doneWhen: 'y' }] })],
      ['missing doneWhen', '{"children":[{"title":"x"}]}'],
      ['empty doneWhen', '{"children":[{"title":"x","doneWhen":""}]}'],
      ['long doneWhen', JSON.stringify({ children: [{ title: 'x', doneWhen: 'y'.repeat(201) }] })],
      ['non-string optional text', '{"children":[{"title":"x","doneWhen":"y","landing":5}]}'],
      ['long optional text', JSON.stringify({ children: [{ title: 'x', doneWhen: 'y', category: 'z'.repeat(201) }] })],
      ['invalid startDate', '{"children":[{"title":"x","doneWhen":"y","startDate":"2026-13-01"}]}'],
      ['non-string startDate', '{"children":[{"title":"x","doneWhen":"y","startDate":20261101}]}'],
      ['invalid endDate', '{"children":[{"title":"x","doneWhen":"y","endDate":"2026-2-1"}]}'],
      ['reversed dates', '{"children":[{"title":"x","doneWhen":"y","startDate":"2026-11-18","endDate":"2026-11-17"}]}'],
      ['plan is a string', '{"children":[{"title":"x","doneWhen":"y","plan":"later"}]}'],
      ['plan is an array', '{"children":[{"title":"x","doneWhen":"y","plan":[]}]}'],
      ['plan missing date', '{"children":[{"title":"x","doneWhen":"y","plan":{"startTime":"21:00"}}]}'],
      ['plan bad date', '{"children":[{"title":"x","doneWhen":"y","plan":{"date":"2026-02-30"}}]}'],
      ['plan non-string start', '{"children":[{"title":"x","doneWhen":"y","plan":{"date":"2026-11-17","startTime":9}}]}'],
      ['plan bad start', '{"children":[{"title":"x","doneWhen":"y","plan":{"date":"2026-11-17","startTime":"9:00"}}]}'],
      ['plan non-string end', '{"children":[{"title":"x","doneWhen":"y","plan":{"date":"2026-11-17","endTime":22}}]}'],
      ['plan bad end', '{"children":[{"title":"x","doneWhen":"y","plan":{"date":"2026-11-17","endTime":"25:00"}}]}'],
      ['plan bad slot', '{"children":[{"title":"x","doneWhen":"y","plan":{"date":"2026-11-17","slot":"noon"}}]}'],
      ['invalid planDate', '{"planDate":"2026-2-3","children":[{"title":"x","doneWhen":"y"}]}'],
      ['non-string planDate', '{"planDate":20261117,"children":[{"title":"x","doneWhen":"y"}]}'],
    ]
    for (const [label, body] of cases) {
      const text = fence(body)
      const result = parseProposal(text)
      expect(result.proposal, label).toBeNull()
      expect(result.reply, label).toBe(text.trim())
    }
  })

  it('accepts one and eight children at the boundaries', () => {
    const one = parseProposal(fence(validProposalText({ children: [{ title: 'x', doneWhen: 'y' }] })))
    expect(one.proposal.children).toHaveLength(1)
    const eight = parseProposal(fence(validProposalText({
      children: Array.from({ length: 8 }, (_, index) => ({ title: `t${index}`, doneWhen: `d${index}` })),
    })))
    expect(eight.proposal.children).toHaveLength(8)
  })

  it('drops a valid proposal at the depth cap and appends a Chinese note', () => {
    const text = fence(validProposalText({ children: [{ title: 'x', doneWhen: 'y' }] }))
    const capped = parseProposal(text, { depth: 4 })
    expect(capped.proposal).toBeNull()
    expect(capped.reply).toContain('拆解如下。')
    expect(capped.reply).toContain('（当前任务已在第 4 层，达到 4 层拆解上限，不能再拆；请改拆更上层的任务。）')
    expect(capped.reply).not.toContain(`${FENCE}json`)
    expect(parseProposal(text, { depth: 3 }).proposal).not.toBeNull()
    expect(parseProposal(text, { depth: null }).proposal).not.toBeNull()
    const custom = parseProposal(text, { depth: 2, maxDepth: 2 })
    expect(custom.reply).toContain('达到 2 层拆解上限')
    const emptyProse = parseProposal(fence(validProposalText(), ''), { depth: 4 })
    expect(emptyProse.reply.startsWith('（当前任务已在第 4 层')).toBe(true)
  })
})

/** Minimal valid proposal body. */
function validProposalText({ planDate = '2026-11-17', children = [{ title: '收集数据', doneWhen: '数据表齐全' }] } = {}) {
  return { planDate, ...(children === null ? {} : { children }) }
}

describe('buildChatMessages', () => {
  it('maps history turns and appends the new user message', () => {
    const messages = buildChatMessages({
      history: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '在的' },
      ],
      message: '帮我拆',
    })
    expect(messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '你好' }] },
      { role: 'assistant', content: [{ type: 'text', text: '在的' }] },
      { role: 'user', content: [{ type: 'text', text: '帮我拆' }] },
    ])
  })

  it('defaults to just the new user message', () => {
    expect(buildChatMessages({ message: 'hi' })).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ])
  })
})

describe('buildSystemPrompt', () => {
  it('states the Hermes decomposition discipline and the json contract', () => {
    const prompt = buildSystemPrompt({ context: sampleContext() })
    expect(prompt).toContain('层级上限 4 层')
    expect(prompt).toContain('完成标准')
    expect(prompt).toContain('两个问题验证')
    expect(prompt).toContain('≤ 30 分钟')
    expect(prompt).toContain('A 类')
    expect(prompt).toContain('B 类')
    expect(prompt).toContain('占用一个时间窗')
    expect(prompt).toContain('兄弟任务默认并行')
    expect(prompt).toContain('只给一个依赖')
    expect(prompt).toContain('点号数字')
    expect(prompt).toContain(`${FENCE}json`)
    expect(prompt).toContain('children 必须有 1–8 项')
  })

  it('renders today\"s windows with role labels, task ids, and 未填 markers', () => {
    const prompt = buildSystemPrompt({ context: sampleContext(), dailyBrief: sampleBrief() })
    expect(prompt).toContain('- 今天：2026-11-16')
    expect(prompt).toContain('## 今日窗口')
    expect(prompt).toContain('- 09:00-12:00 核心：内容平台 1.1 写周报')
    expect(prompt).toContain('- 21:00-22:00 定义：内容平台 1.2 复盘')
    expect(prompt).toContain('- 时间未定 轮换：未填')
    expect(prompt).toContain('# 个人任务树')
  })

  it('falls back to today and a no-window note without a brief', () => {
    const prompt = buildSystemPrompt({ context: sampleContext(), dailyBrief: null })
    expect(prompt).toContain(`- 今天：${todayIso()}`)
    expect(prompt).toContain('（今天没有可用的窗口）')
    expect(prompt).not.toContain('## 当前聚焦任务')
  })

  it('handles an empty slot list and missing picks', () => {
    const empty = buildSystemPrompt({
      context: sampleContext(),
      dailyBrief: { date: '2026-11-16', slots: [] },
    })
    expect(empty).toContain('（今天没有可用的窗口）')
    const noItems = buildSystemPrompt({
      context: sampleContext(),
      dailyBrief: {
        date: 'not-a-date',
        slots: [{ slot: 'weird', startTime: '09:00', endTime: '10:00', kind: 'mystery', blockId: 'x' }],
      },
    })
    expect(noItems).toContain(`- 今天：${todayIso()}`)
    expect(noItems).toContain('- 09:00-10:00 任务：未填')
    const noSlots = buildSystemPrompt({
      context: sampleContext(),
      dailyBrief: { date: '2026-11-16' },
    })
    expect(noSlots).toContain('（今天没有可用的窗口）')
  })

  it('renders a pick without track name or ref by title only', () => {
    const prompt = buildSystemPrompt({
      context: sampleContext(),
      dailyBrief: {
        date: '2026-11-16',
        slots: [{ slot: 'morning', startTime: '09:00', endTime: '10:00', kind: 'core', blockId: 'b' }],
        items: [{ slot: 'morning', startTime: '09:00', endTime: '10:00', blockId: 'b', trackName: '', ref: '', title: '写周报', role: 'core' }],
      },
    })
    expect(prompt).toContain('- 09:00-10:00 核心：写周报')
  })

  it('describes the focused task with depth, done standard, and children', () => {
    const prompt = buildSystemPrompt({ context: sampleContext(), dailyBrief: sampleBrief(), taskId: 'weekly' })
    expect(prompt).toContain('## 当前聚焦任务（拆解对象）')
    expect(prompt).toContain('- 点号 id：1.1')
    expect(prompt).toContain('- 标题：写周报')
    expect(prompt).toContain('- 层级：第 2 层（上限 4 层）')
    expect(prompt).toContain('- 完成标准：周报已发送')
    expect(prompt).toContain('- 可以继续拆解。')
    expect(prompt).toContain('- 直接子任务：')
    expect(prompt).toContain('  - 1.1.1 收集数据（完成标准：数据表齐全）')
  })

  it('marks a depth-4 focus as capped and a childless task as having no children', () => {
    const prompt = buildSystemPrompt({ context: sampleContext(), taskId: 'export' })
    expect(prompt).toContain('- 层级：第 4 层（上限 4 层）')
    expect(prompt).toContain('- 已达层级上限，不能再拆解。')
    expect(prompt).toContain('- 直接子任务：无')
    const noStandard = buildSystemPrompt({ context: sampleContext(), taskId: 'track' })
    expect(noStandard).toContain('- 完成标准：（未填写）')
    expect(noStandard).toContain('  - 1.2 复盘')
    expect(noStandard).toContain('  - 1.1 写周报（完成标准：周报已发送）')
  })

  it('falls back to the hierarchy number when a task has no ref', () => {
    const context = {
      markdown: '',
      tasks: [node({
        id: 'manual',
        number: '7',
        ref: '',
        title: '手工任务',
        children: [node({ id: 'kid', parentId: 'manual', number: '7.1', ref: '', title: '子任务', doneWhen: '完成' })],
      })],
    }
    const prompt = buildSystemPrompt({ context, taskId: 'manual' })
    expect(prompt).toContain('- 点号 id：7')
    expect(prompt).toContain('  - 7.1 子任务（完成标准：完成）')
    expect(prompt).toContain('（暂无任务树）')
  })

  it('truncates the tree markdown to 9000 characters', () => {
    const exact = 'x'.repeat(9000)
    expect(buildSystemPrompt({ context: { markdown: exact, tasks: [] } })).toContain(exact)
    const long = 'y'.repeat(9001)
    const prompt = buildSystemPrompt({ context: { markdown: long, tasks: [] } })
    expect(prompt).toContain('y'.repeat(9000))
    expect(prompt).not.toContain('y'.repeat(9001))
    expect(prompt).toContain('任务树上下文过长，已截断')
  })
})

describe('runChat', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('streams text deltas, calls llm.stream with the documented options, and returns the model', async () => {
    const llm = fakeLlm([
      textDelta('先拆'),
      reasoningDelta('内部思考'),
      { type: 'block-start', index: 0, blockType: 'text' },
      textDelta('三步'),
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      finish(),
    ])
    const result = await runChat({
      llm,
      selection: SELECTION,
      message: '  帮我拆  ',
      history: [
        { role: 'user', content: ' 你好 ' },
        { role: 'assistant', content: ' 在的 ' },
      ],
      taskId: 'weekly',
      context: sampleContext(),
      dailyBrief: sampleBrief(),
    })
    expect(result).toEqual({
      reply: '先拆三步',
      proposal: null,
      model: { provider: 'deepseek', model: 'deepseek-chat' },
    })
    expect(llm.calls).toHaveLength(1)
    const call = llm.calls[0]
    expect(call.provider).toBe('deepseek')
    expect(call.model).toBe('deepseek-chat')
    expect(call.maxTokens).toBe(1500)
    expect(call.reasoningEffort).toBeUndefined()
    expect(call.signal).toBeInstanceOf(AbortSignal)
    expect('tools' in call).toBe(false)
    expect(call.system).toContain('## 当前聚焦任务')
    expect(call.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '你好' }] },
      { role: 'assistant', content: [{ type: 'text', text: '在的' }] },
      { role: 'user', content: [{ type: 'text', text: '帮我拆' }] },
    ])
  })

  it('passes reasoningEffort through when the selection has one', async () => {
    const llm = fakeLlm()
    await runChat({
      llm,
      selection: { ...SELECTION, reasoningEffort: 'high' },
      message: 'hi',
      context: sampleContext(),
    })
    expect(llm.calls[0].reasoningEffort).toBe('high')
  })

  it('returns the parsed proposal from the reply', async () => {
    const llm = fakeLlm([textDelta(fence(validProposalText())), finish()])
    const result = await runChat({ llm, selection: SELECTION, message: '拆', taskId: 'weekly', context: sampleContext() })
    expect(result.reply).toBe('拆解如下。')
    expect(result.proposal).toEqual({
      planDate: '2026-11-17',
      children: [{ title: '收集数据', doneWhen: '数据表齐全' }],
    })
  })

  it('returns a proposal without a focus, and omits the focus section from the prompt', async () => {
    const llm = fakeLlm([textDelta(fence(validProposalText())), finish()])
    const result = await runChat({ llm, selection: SELECTION, message: '拆', context: sampleContext() })
    expect(result.proposal).not.toBeNull()
    expect(llm.calls[0].system).not.toContain('## 当前聚焦任务')
  })

  it('caps a focused depth-4 task with proposal null but keeps the reply and route 200', async () => {
    const llm = fakeLlm([textDelta(fence(validProposalText(), '拆不动了。')), finish()])
    const result = await runChat({ llm, selection: SELECTION, message: '继续拆', taskId: 'export', context: sampleContext() })
    expect(result.proposal).toBeNull()
    expect(result.reply).toContain('拆不动了。')
    expect(result.reply).toContain('达到 4 层拆解上限')
    expect(result.model).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })

  it('returns an empty reply when the model produces no text deltas', async () => {
    const llm = fakeLlm([finish(), finish('max-tokens')])
    const result = await runChat({ llm, selection: SELECTION, message: 'hi', context: sampleContext() })
    expect(result.reply).toBe('')
    expect(result.proposal).toBeNull()
  })

  it('maps a missing llm or selection to a 503 ChatError', async () => {
    const context = sampleContext()
    const llms = /** @type {any[]} */ ([undefined, null, {}, { stream: 1 }])
    for (const llm of llms) {
      const error = await rejectionOf(runChat({ llm, selection: SELECTION, message: 'hi', context }))
      expect(error).toBeInstanceOf(ChatError)
      expect(error.message).toBe('model unavailable')
      expect(error.status).toBe(503)
    }
    const selections = /** @type {any[]} */ ([undefined, null, 'x', {}, { provider: 'p' }, { provider: 'p', model: '' }, { provider: 5, model: 'm' }, { provider: '', model: 'm' }])
    for (const selection of selections) {
      const error = await rejectionOf(runChat({ llm: fakeLlm(), selection, message: 'hi', context }))
      expect(error).toBeInstanceOf(ChatError)
      expect(error.message).toBe('model unavailable')
      expect(error.status).toBe(503)
    }
  })

  it('validates the message', async () => {
    const context = sampleContext()
    const base = /** @type {any} */ ({ llm: fakeLlm(), selection: SELECTION, context })
    for (const message of /** @type {any[]} */ ([undefined, null, 42, '', '   '])) {
      const error = await rejectionOf(runChat({ ...base, message }))
      expect(error.message).toBe('message is required')
      expect(error.status).toBe(400)
    }
    const long = await rejectionOf(runChat({ ...base, message: 'a'.repeat(2001) }))
    expect(long.message).toBe('message must be at most 2000 characters')
    expect(long.status).toBe(400)
    const boundary = await runChat({ ...base, message: 'a'.repeat(2000) })
    expect(boundary.reply).toBe('ok')
  })

  it('validates history turns', async () => {
    const context = sampleContext()
    const base = /** @type {any} */ ({ llm: fakeLlm(), selection: SELECTION, message: 'hi', context })
    const invalid = /** @type {[any, string][]} */ ([
      ['x', 'history must be an array'],
      [Array.from({ length: 9 }, () => ({ role: 'user', content: 'x' })), 'history must be at most 8 turns'],
      [[null], 'history[0] must be an object'],
      [['x'], 'history[0] must be an object'],
      [[[]], 'history[0] must be an object'],
      [[{ role: 'system', content: 'x' }], 'history[0].role must be user or assistant'],
      [[{ role: 'user', content: 1 }], 'history[0].content must be a string'],
      [[{ role: 'user', content: 'x'.repeat(2001) }], 'history[0].content must be at most 2000 characters'],
    ])
    for (const [history, message] of invalid) {
      const error = await rejectionOf(runChat({ ...base, history }))
      expect(error.message).toBe(message)
      expect(error.status).toBe(400)
    }
    const boundary = await runChat({
      ...base,
      history: Array.from({ length: 8 }, () => ({ role: 'assistant', content: 'x'.repeat(2000) })),
    })
    expect(boundary.reply).toBe('ok')
    expect(await runChat({ ...base, history: null })).toBeTruthy()
    expect(await runChat({ ...base, history: undefined })).toBeTruthy()
  })

  it('validates taskId and rejects unknown ids before calling the model', async () => {
    const context = sampleContext()
    const llm = fakeLlm()
    const base = /** @type {any} */ ({ llm, selection: SELECTION, message: 'hi', context })
    const badType = await rejectionOf(runChat({ ...base, taskId: 42 }))
    expect(badType.message).toBe('taskId must be a string')
    const unknown = await rejectionOf(runChat({ ...base, taskId: 'ghost' }))
    expect(unknown.message).toBe('task ghost was not found')
    expect(unknown.status).toBe(400)
    expect(llm.calls).toHaveLength(0)
    expect(await runChat({ ...base, taskId: null })).toBeTruthy()
    expect(await runChat({ ...base, taskId: '' })).toBeTruthy()
  })

  it('validates the context shape', async () => {
    const base = /** @type {any} */ ({ llm: fakeLlm(), selection: SELECTION, message: 'hi' })
    const invalid = /** @type {[any, string][]} */ ([
      [null, 'context must be an object'],
      ['x', 'context must be an object'],
      [[], 'context must be an object'],
      [{}, 'context.markdown must be a string'],
      [{ markdown: 5, tasks: [] }, 'context.markdown must be a string'],
      [{ markdown: '', tasks: 'x' }, 'context.tasks must be an array'],
    ])
    for (const [context, message] of invalid) {
      const error = await rejectionOf(runChat({ ...base, context }))
      expect(error.message).toBe(message)
      expect(error.status).toBe(400)
    }
  })

  it('maps upstream failures to a 502 ChatError', async () => {
    const context = sampleContext()
    const base = /** @type {any} */ ({ selection: SELECTION, message: 'hi', context })
    const failures = /** @type {[string, any][]} */ ([
      ['sync throw', failingLlm(new Error('boom'))],
      ['non-Error throw', failingLlm('plain failure')],
      ['broken stream', brokenLlm()],
      ['error finish', fakeLlm([textDelta('half'), finish('error')])],
      ['aborted finish', fakeLlm([finish('aborted')])],
    ])
    for (const [label, llm] of failures) {
      const error = await rejectionOf(runChat({ ...base, llm }))
      expect(error, label).toBeInstanceOf(ChatError)
      expect(error.message).toBe('model request failed')
      expect(error.status).toBe(502)
    }
  })

  it('rejects immediately when the caller signal is already aborted', async () => {
    const llm = fakeLlm()
    const controller = new AbortController()
    controller.abort()
    const error = await rejectionOf(runChat({
      llm,
      selection: SELECTION,
      message: 'hi',
      context: sampleContext(),
      signal: controller.signal,
    }))
    expect(error.message).toBe('model request aborted')
    expect(error.status).toBe(502)
    expect(llm.calls).toHaveLength(0)
  })

  it('aborts an in-flight call when the caller signal fires', async () => {
    const llm = hangingLlm()
    const controller = new AbortController()
    const pending = runChat({
      llm,
      selection: SELECTION,
      message: 'hi',
      context: sampleContext(),
      signal: controller.signal,
    })
    const rejection = rejectionOf(pending)
    expect(llm.calls).toHaveLength(1)
    controller.abort()
    const error = await rejection
    expect(error.message).toBe('model request aborted')
    expect(error.status).toBe(502)
  })

  it('times out after 60 seconds', async () => {
    vi.useFakeTimers()
    const llm = hangingLlm()
    const pending = runChat({ llm, selection: SELECTION, message: 'hi', context: sampleContext() })
    const rejection = rejectionOf(pending)
    await vi.advanceTimersByTimeAsync(60_000)
    const error = await rejection
    expect(error.message).toBe('model request timed out')
    expect(error.status).toBe(502)
    expect(llm.calls).toHaveLength(1)
    vi.useRealTimers()
  })

  it('clears the timeout after a successful call', async () => {
    vi.useFakeTimers()
    await runChat({ llm: fakeLlm(), selection: SELECTION, message: 'hi', context: sampleContext() })
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})
