// The bundle's composition contract: the Loader row that declares the
// gantt-long-run preset must wire the mode exactly as designed — a complete
// dispatcher persona, the scoped knowledge plugin, web tools, one delegation
// tool pinned to the standard preset with no model-facing allowlist, and
// compaction. A renamed or drifted key would not fail at parse time; the mode
// would just silently lose a capability at activation, so the strings are
// pinned here.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')

describe('gantt-long-run preset wiring', () => {
  const patch = fs.readFileSync(path.join(ROOT, 'cordis.patch.yml'), 'utf8')
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

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
})
