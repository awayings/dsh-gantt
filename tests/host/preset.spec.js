// The bundle's composition contract: the Loader row that declares the
// gantt-long-run preset must wire the mode exactly as designed — a complete
// dispatcher persona, the scoped knowledge plugin, web tools, one delegation
// tool pinned to the standard preset with no model-facing allowlist, and
// compaction. A renamed or drifted key would not fail at parse time; the mode
// would just silently lose a capability at activation, so the strings are
// pinned here. The persona block is also pinned byte-for-byte to its readable
// mirror in docs/long-run-persona.md.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')

describe('gantt-long-run preset wiring', () => {
  const patch = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

  /** The literal persona block in the patch, dedented. The mirror doc pins to
   * this exact text, so a persona edit that forgets the doc fails the gate. */
  function personaPrefix() {
    const lines = patch.split('\n')
    const marker = lines.findIndex(line => line.endsWith('prefix: |-'))
    if (marker < 0) throw new Error('cordis.patch.yml has no persona block')
    const indent = lines[marker].length - lines[marker].trimStart().length
    const body = []
    for (const line of lines.slice(marker + 1)) {
      if (line !== '' && !line.startsWith(' '.repeat(indent + 2))) break
      body.push(line.slice(indent + 2))
    }
    while (body.length > 0 && body[body.length - 1] === '') body.pop()
    return body.join('\n')
  }

  it('declares the preset row with the complete dispatcher persona', () => {
    expect(patch).toContain('- id: preset-gantt-long-run')
    expect(patch).toContain("name: '@deepseek-ai/dsh-agent-preset'")
    expect(patch).toContain('id: gantt-long-run')
    expect(patch).toContain('complete: true')
    expect(patch).toContain('gantt_knowledge_query')
    expect(patch).toContain('gantt_knowledge_save')
    expect(patch).toContain('gantt_execute')
    expect(patch).not.toContain('{{')
  })

  it('mounts the scoped knowledge plugin and pins children to the standard preset', () => {
    expect(manifest.exports['./long-run']).toBe('./src/host/long-run.js')
    expect(patch).toContain("name: '@local/dsh-gantt/long-run'")
    expect(patch).toContain('provider: spawn')
    expect(patch).toContain('toolName: gantt_execute')
    expect(patch).toContain('agentPreset: standard')
    expect(patch).not.toContain('allowedAgentPresets')
  })

  it('keeps the host row beside the preset row', () => {
    expect(patch).toContain('- id: gantt')
    expect(patch).toContain("name: '@local/dsh-gantt'")
    expect(patch).not.toContain('preset-standard')
  })

  it('mirrors the shipped persona in docs/long-run-persona.md', () => {
    const persona = personaPrefix()
    expect(persona).toContain('你是甘特图长运行分发者')
    const doc = fs.readFileSync(path.join(ROOT, 'docs/long-run-persona.md'), 'utf8')
    expect(doc).toContain(persona)
  })
})
