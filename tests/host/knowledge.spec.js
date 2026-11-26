import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanttStore } from '../../src/host/store.js'
import { KNOWLEDGE_TOOL_NAMES, knowledgeToolDefinitions, registerKnowledgeTools } from '../../src/host/knowledge.js'

/** @typedef {import('../../src/host/tools.js').GanttTool} GanttTool */

let store

beforeEach(() => {
  store = new GanttStore(':memory:')
})

afterEach(() => {
  store?.close()
  store = undefined
})

/** @param {GanttTool[]} tools @param {string} name @returns {GanttTool} */
function tool(tools, name) {
  const found = tools.find(candidate => candidate.name === name)
  if (found === undefined) throw new Error(`tool ${name} was not defined`)
  return found
}

/** Seed one track (ref T1) with one child task (number 1.1). */
function seedTask() {
  const track = store.create({ title: 'Content platform', kind: 'track', ref: 'T1' })
  const task = store.create({ title: 'Collect data', parentId: track.id, doneWhen: 'Data ready' })
  return { track, task }
}

/** Tool exec context carrying a session with a current turn. */
const execWithTurn = (turn = 4) => /** @type {any} */ ({
  agent: { session: { id: 'session-a', snapshotEvents: () => [{ type: 'turn/start', data: { turn } }] } },
})

describe('knowledge tool definitions', () => {
  it('defines the two model-facing tools with output schemas', () => {
    const tools = knowledgeToolDefinitions(store)
    expect(tools.map(entry => entry.name)).toEqual([KNOWLEDGE_TOOL_NAMES.save, KNOWLEDGE_TOOL_NAMES.query])
    for (const entry of tools) {
      expect(typeof entry.description).toBe('string')
      expect(entry.output.schema.type).toBe('object')
      expect(typeof entry.output.render).toBe('function')
    }
    const save = /** @type {any} */ (tool(tools, KNOWLEDGE_TOOL_NAMES.save))
    expect(save.parameters.properties.kind.enum).toEqual(['lesson', 'feedback', 'note'])
    expect(save.parameters.required).toEqual(['title', 'content'])
    const query = /** @type {any} */ (tool(tools, KNOWLEDGE_TOOL_NAMES.query))
    expect(query.parameters.required).toBeUndefined()
  })

  it('saves with task resolution by point number and provenance', async () => {
    const { task } = seedTask()
    const save = tool(knowledgeToolDefinitions(store), KNOWLEDGE_TOOL_NAMES.save)
    const value = /** @type {any} */ (await save.execute(
      { title: '判定', content: '落在数据采集下', taskId: '1.1', tags: ['归档'] },
      execWithTurn(3),
    ))
    expect(value.ok).toBe(true)
    expect(value.message).toContain('已保存知识「判定」（lesson，关联 1.1）。')
    expect(value.message).toContain('已自动记录会话与轮次索引')
    expect(save.output.render({}, value)).toEqual([{ type: 'text', text: value.message }])
    expect(store.db.prepare('SELECT session_id AS sessionId, turn FROM knowledge_entries').get()).toEqual({ sessionId: 'session-a', turn: 3 })
    expect(store.db.prepare('SELECT task_id AS taskId FROM knowledge_entries').get()).toEqual({ taskId: task.id })
  })

  it('saves with task resolution by ref and no session provenance', async () => {
    seedTask()
    const save = tool(knowledgeToolDefinitions(store), KNOWLEDGE_TOOL_NAMES.save)
    const value = /** @type {any} */ (await save.execute({ title: 'A', content: 'B', taskId: 'T1' }, {}))
    expect(value.message).toContain('已保存知识「A」（lesson，关联 T1）。')
    expect(value.message).not.toContain('已自动记录会话与轮次索引')
    // A blank taskId string is no link, not a lookup.
    const blank = /** @type {any} */ (await save.execute({ title: 'C', content: 'D', taskId: '   ' }, {}))
    expect(blank.message).toContain('已保存知识「C」（lesson，未关联任务）。')
  })

  it('replaces an entry by id through the tool', async () => {
    const save = tool(knowledgeToolDefinitions(store), KNOWLEDGE_TOOL_NAMES.save)
    await save.execute({ title: 'A', content: 'B' }, {})
    const before = /** @type {any} */ (store.db.prepare('SELECT id, created_at FROM knowledge_entries').get())
    const replaced = /** @type {any} */ (await save.execute({ id: before.id, kind: 'note', title: 'A2', content: 'B2' }, {}))
    expect(replaced.message).toContain('已保存知识「A2」（note，未关联任务）。')
    const rows = store.db.prepare('SELECT id, title, created_at FROM knowledge_entries').all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: before.id, title: 'A2', created_at: before.created_at })
  })

  it('reports hostile saves', async () => {
    const { task } = seedTask()
    const save = tool(knowledgeToolDefinitions(store), KNOWLEDGE_TOOL_NAMES.save)
    await expectToolError(save.execute({ content: 'B' }, {}), 'title is required')
    await expectToolError(save.execute({ title: 'A' }, {}), 'content is required')
    await expectToolError(save.execute({ title: 'A', content: 'B', kind: 'bad' }, {}), 'kind must be one of lesson, feedback, note')
    await expectToolError(save.execute({ title: 'A', content: 'B', taskId: 'missing' }, {}), 'task missing was not found', 404)
    await expectToolError(save.execute({ title: 'A', content: 'B', tags: [''] }, {}), 'tags[0] must not be empty')
    expect(task.title).toBe('Collect data')
  })

  it('queries by keyword and renders ids, links, tags, and excerpts', async () => {
    seedTask()
    const tools = knowledgeToolDefinitions(store)
    const save = tool(tools, KNOWLEDGE_TOOL_NAMES.save)
    await save.execute({ title: '资金流判定', content: 'あ'.repeat(300), taskId: '1.1', tags: ['归档', 'dispatch'] }, {})
    await save.execute({ title: '无关条目', content: '无关' }, {})
    const query = tool(tools, KNOWLEDGE_TOOL_NAMES.query)
    const value = /** @type {any} */ (await query.execute({ query: '资金流', limit: 1 }, {}))
    expect(value.ok).toBe(true)
    const rowId = store.db.prepare('SELECT id FROM knowledge_entries WHERE title = ?').get('资金流判定').id
    expect(value.markdown).toContain('# 知识库查询结果（1 条）')
    expect(value.markdown).toContain(`[lesson] 资金流判定（${rowId} · 任务 1.1 ·`)
    expect(value.markdown).toContain('归档/dispatch')
    expect(value.markdown).toContain('あ'.repeat(240))
    expect(value.markdown).toContain('…')
    expect(query.output.render({}, value)).toEqual([{ type: 'text', text: value.markdown }])
  })

  it('queries by task through a point number and reports empty results', async () => {
    seedTask()
    const tools = knowledgeToolDefinitions(store)
    const save = tool(tools, KNOWLEDGE_TOOL_NAMES.save)
    await save.execute({ title: 'A', content: 'B', taskId: '1.1' }, {})
    await save.execute({ title: '无关条目', content: '无关' }, {})
    const query = tool(tools, KNOWLEDGE_TOOL_NAMES.query)
    const value = /** @type {any} */ (await query.execute({ taskId: '1.1' }, {}))
    expect(value.markdown).toContain('[lesson] A（')
    // An unlinked entry renders without a task label.
    const unlinked = /** @type {any} */ (await query.execute({ query: '无关' }, {}))
    expect(unlinked.markdown).toContain('[lesson] 无关条目（')
    expect(unlinked.markdown).toContain(' · 未关联任务 · ')
    // A blank taskId string is no task filter.
    const blank = /** @type {any} */ (await query.execute({ taskId: '' }, {}))
    expect(blank.markdown).toContain('[lesson] A（')
    const empty = /** @type {any} */ (await query.execute({ query: 'zzz' }, {}))
    expect(empty.markdown).toBe('（知识库暂无匹配条目。）')
  })

  it('reports hostile queries', async () => {
    const query = tool(knowledgeToolDefinitions(store), KNOWLEDGE_TOOL_NAMES.query)
    await expectToolError(query.execute({ query: 5 }, {}), 'query must be a string')
    await expectToolError(query.execute({ kind: 'bad' }, {}), 'kind must be one of lesson, feedback, note')
    await expectToolError(query.execute({ tag: '' }, {}), 'tag must not be empty')
    await expectToolError(query.execute({ limit: 0 }, {}), 'limit must be an integer between 1 and 50')
    await expectToolError(query.execute({ taskId: 'missing' }, {}), 'task missing was not found', 404)
  })
})

describe('registerKnowledgeTools', () => {
  /** A tools service whose register reads its own state: a detached call throws,
   * so the receiver-binding contract stays under test. */
  class FakeToolsService {
    constructor() {
      this.layers = []
    }

    register(definition) {
      this.layers.push(definition)
      return () => {
        this.layers.splice(this.layers.indexOf(definition), 1)
      }
    }
  }

  it('registers through the service receiver and disposes with the scope', () => {
    const service = new FakeToolsService()
    /** @type {Array<() => void>} */
    const disposers = []
    const ctx = {
      get: name => (name === 'tools' ? service : undefined),
      effect: (fn) => {
        disposers.push(fn())
      },
    }
    registerKnowledgeTools(/** @type {any} */ (ctx), store)
    expect(service.layers.map(definition => definition.name)).toEqual([KNOWLEDGE_TOOL_NAMES.save, KNOWLEDGE_TOOL_NAMES.query])
    expect(disposers).toHaveLength(1)
    disposers[0]()
    expect(service.layers).toEqual([])
  })

  it('registers even when the scope has no effect hook', () => {
    const service = new FakeToolsService()
    const ctx = { get: () => service }
    registerKnowledgeTools(/** @type {any} */ (ctx), store)
    expect(service.layers).toHaveLength(2)
  })

  it('tolerates a missing tools service', () => {
    registerKnowledgeTools(/** @type {any} */ ({ get: () => undefined }), store)
    registerKnowledgeTools(/** @type {any} */ ({ get: () => null }), store)
    registerKnowledgeTools(/** @type {any} */ ({ get: () => ({}) }), store)
    registerKnowledgeTools(/** @type {any} */ ({}), store)
  })
})

/** Assert an async tool rejection carries a GanttError status. */
async function expectToolError(promise, message, status = 400) {
  const caught = await promise.then(() => null, error => error)
  expect(caught).toBeInstanceOf(Error)
  expect(caught.message).toBe(message)
  expect(caught.status).toBe(status)
}
