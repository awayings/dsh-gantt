import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { parseSkillDocument, registerDispatchSkill } from '../../src/host/dispatch-skill.js'

/** The packaged manual, from this spec's own tree position. */
const SKILL_URL = new URL('../../skills/gantt-dispatch-flow/SKILL.md', import.meta.url)

/** A skills service whose registerProvider reads its own state: a detached
 * call throws, so the receiver-binding contract stays under test. */
class FakeSkillsService {
  constructor() {
    this.providers = []
  }

  registerProvider(create) {
    const provider = create({ invalidate() {}, signal: undefined })
    this.providers.push(provider)
    return () => {
      this.providers.splice(this.providers.indexOf(provider), 1)
    }
  }
}

describe('dispatch manual skill provider', () => {
  it('registers the packaged manual through the skills service receiver', () => {
    const service = new FakeSkillsService()
    /** @type {Array<() => void>} */
    const effects = []
    registerDispatchSkill(/** @type {any} */ ({
      get: contextName => (contextName === 'skills' ? service : undefined),
      effect: (fn) => { effects.push(fn()) },
    }))
    expect(service.providers).toHaveLength(1)
    expect(effects).toHaveLength(1)
    effects[0]()
    expect(service.providers).toEqual([])
  })

  it('keeps the provider registered when the context has no effect seam', () => {
    const service = new FakeSkillsService()
    registerDispatchSkill(/** @type {any} */ ({ get: () => service }))
    expect(service.providers).toHaveLength(1)
  })

  it('skips registration when the scope has no usable skills service', () => {
    expect(() => registerDispatchSkill(/** @type {any} */ ({}))).not.toThrow()
    expect(() => registerDispatchSkill(/** @type {any} */ ({ get: () => undefined }))).not.toThrow()
    expect(() => registerDispatchSkill(/** @type {any} */ ({ get: () => null }))).not.toThrow()
    expect(() => registerDispatchSkill(/** @type {any} */ ({ get: () => ({ registerProvider: 'detached' }) }))).not.toThrow()
  })

  it('lists the packaged manual as a bundled candidate the user can override', async () => {
    const service = new FakeSkillsService()
    registerDispatchSkill(/** @type {any} */ ({ get: () => service }))
    const [provider] = service.providers
    expect(provider.name).toBe('gantt-dispatch-skill')
    const candidates = await provider.list()
    expect(candidates).toHaveLength(1)
    const [candidate] = candidates
    expect(candidate.name).toBe('gantt-dispatch-flow')
    expect(candidate.description).toContain('甘特长城')
    expect(candidate.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(candidate.provider).toBe('gantt-dispatch-skill')
    expect(candidate.source).toBe('bundled')
    expect(candidate.rank).toBe(600)
    expect(candidate.path).toBe(fileURLToPath(SKILL_URL))
    expect(candidate.resourceBase).toEqual({ kind: 'directory', path: fileURLToPath(new URL('.', SKILL_URL)) })
  })

  it('serves the packaged body with the frontmatter stripped, byte for byte', async () => {
    const service = new FakeSkillsService()
    registerDispatchSkill(/** @type {any} */ ({ get: () => service }))
    const [provider] = service.providers
    const definition = await provider.get()
    expect(definition.name).toBe('gantt-dispatch-flow')
    expect(definition.content.startsWith('# gantt-dispatch-flow')).toBe(true)
    expect(definition.content.endsWith('提醒。\n')).toBe(true)
    // An independent extraction: everything past the closing delimiter.
    const text = await readFile(SKILL_URL, 'utf8')
    const closing = text.indexOf('---\n', 1)
    expect(closing).toBeGreaterThan(0)
    expect(definition.content).toBe(text.slice(closing + 4))
  })

  it('parses the frontmatter contract and rejects malformed documents', () => {
    expect(parseSkillDocument('---\ntitle: ignored\nname: good-skill\ndescription: A manual.\n---\n# Body\n')).toEqual({
      name: 'good-skill',
      description: 'A manual.',
      content: '# Body\n',
    })
    expect(() => parseSkillDocument('no frontmatter')).toThrow('frontmatter delimiter')
    expect(() => parseSkillDocument('---\nname: good-skill\n')).toThrow('closing frontmatter delimiter')
    expect(() => parseSkillDocument('---\nname: Bad_Name\ndescription: A manual.\n---\n')).toThrow('invalid name')
    expect(() => parseSkillDocument('---\nname: good-skill\ndescription:\n---\n')).toThrow('no description')
  })
})
