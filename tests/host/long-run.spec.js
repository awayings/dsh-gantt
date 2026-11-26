import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import { apply, inject, name } from '../../src/host/long-run.js'
import { KNOWLEDGE_TOOL_NAMES } from '../../src/host/knowledge.js'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'

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

let dir
let previousDb

beforeEach(() => {
  dir = makeTempDir('dsh-gantt-longrun-')
  previousDb = process.env.DSH_GANTT_DB
  process.env.DSH_GANTT_DB = path.join(dir, 'tasks.db')
})

afterEach(() => {
  process.env.DSH_GANTT_DB = previousDb
  removeTempDir(dir)
  dir = undefined
})

describe('gantt/long-run preset plugin', () => {
  it('declares the plugin shape', () => {
    expect(name).toBe('gantt/long-run')
    expect(inject).toEqual(['tools'])
    expect(typeof apply).toBe('function')
  })

  it('registers the knowledge tools over its own store handle and closes it on dispose', async () => {
    const service = new FakeToolsService()
    /** @type {Array<() => void>} */
    const effects = []
    const ctx = {
      get: contextName => (contextName === 'tools' ? service : undefined),
      effect: (fn) => {
        effects.push(fn())
      },
    }
    apply(/** @type {any} */ (ctx))
    expect(service.layers.map(definition => definition.name)).toEqual([KNOWLEDGE_TOOL_NAMES.save, KNOWLEDGE_TOOL_NAMES.query])
    // The handle behind the registration is a real store on the shared schema.
    const save = /** @type {any} */ (service.layers[0])
    const value = await save.execute({ title: 'A', content: 'B' }, {})
    expect(value.ok).toBe(true)
    // Effects: the store close first, then the tools disposer.
    expect(effects).toHaveLength(2)
    effects[1]()
    expect(service.layers).toEqual([])
    effects[0]()
    await expect(save.execute({ title: 'C', content: 'D' }, {})).rejects.toThrow()
  })

  it('opens the store even when the scope has no tools service', () => {
    /** @type {Array<() => void>} */
    const effects = []
    apply(/** @type {any} */ ({ effect: (fn) => { effects.push(fn()) } }))
    expect(effects).toHaveLength(1)
    expect(() => effects[0]()).not.toThrow()
  })
})
