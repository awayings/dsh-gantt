// Agent label resolution: the registry map, its cache/retry rules, and the
// operator/completer/report fallbacks both client surfaces render.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installFetch, jsonResponse } from './harness.js'
import {
  agentLabel,
  loadAgentNames,
  reportPreview,
  reportText,
  resetAgentNames,
} from '../../src/client/agent-labels.js'

const AGENTS = 'api/gantt/agents'

/** The locale stub for the two fallback labels. */
function t(key) {
  return { 'agent.unassigned': 'Unassigned', 'agent.noReport': 'No report' }[key] ?? key
}

beforeEach(resetAgentNames)
afterEach(resetAgentNames)

describe('loadAgentNames', () => {
  it('maps ids to names, falls back to the id, and skips malformed rows', async () => {
    installFetch({
      [AGENTS]: () => jsonResponse({
        ok: true,
        agents: [
          { id: 'a1', name: 'reviewer' },
          { id: 'a2', name: '' },
          { id: 'a3' },
          { id: '' },
          { name: 'no-id' },
          { id: 42, name: 'numeric' },
          null,
        ],
      }),
    })
    const names = await loadAgentNames()
    expect([...names]).toEqual([['a1', 'reviewer'], ['a2', 'a2'], ['a3', 'a3']])
  })

  it('treats a payload without an agent list as an empty registry', async () => {
    installFetch({ [AGENTS]: () => jsonResponse({ ok: true, agents: 'not-a-list' }) })
    const names = await loadAgentNames()
    expect(names.size).toBe(0)
  })

  it('shares one in-flight request and caches the result', async () => {
    const { calls } = installFetch({
      [AGENTS]: () => jsonResponse({ ok: true, agents: [{ id: 'a1', name: 'reviewer' }] }),
    })
    const [first, second] = await Promise.all([loadAgentNames(), loadAgentNames()])
    expect(calls).toHaveLength(1)
    expect(first).toBe(second)
    expect((await loadAgentNames()).get('a1')).toBe('reviewer')
    expect(calls).toHaveLength(1)
  })

  it('degrades to an empty map on failure and retries on the next call', async () => {
    let attempts = 0
    const { calls } = installFetch({
      [AGENTS]: () => {
        attempts += 1
        return attempts === 1
          ? jsonResponse({ ok: false, error: 'registry down' }, 503)
          : jsonResponse({ ok: true, agents: [{ id: 'a1', name: 'reviewer' }] })
      },
    })
    expect((await loadAgentNames()).size).toBe(0)
    expect((await loadAgentNames()).get('a1')).toBe('reviewer')
    expect(calls).toHaveLength(2)
  })

  it('refetches after the cache is reset', async () => {
    const { calls } = installFetch({
      [AGENTS]: () => jsonResponse({ ok: true, agents: [] }),
    })
    await loadAgentNames()
    resetAgentNames()
    await loadAgentNames()
    expect(calls).toHaveLength(2)
  })
})

describe('agentLabel', () => {
  const names = new Map([['a1', 'reviewer']])

  it('prefers the registered name and keeps an unknown id visible', () => {
    expect(agentLabel(names, 'a1', t)).toBe('reviewer')
    expect(agentLabel(names, 'a9', t)).toBe('a9')
    expect(agentLabel(null, 'a9', t)).toBe('a9')
  })

  it('localizes an empty or missing id as unassigned', () => {
    expect(agentLabel(names, '', t)).toBe('Unassigned')
    expect(agentLabel(names, /** @type {any} */ (undefined), t)).toBe('Unassigned')
  })
})

describe('reportText', () => {
  it('returns the full report, or the localized empty label', () => {
    expect(reportText('done, verified in tests/host', t)).toBe('done, verified in tests/host')
    expect(reportText('', t)).toBe('No report')
    expect(reportText(/** @type {any} */ (null), t)).toBe('No report')
  })
})

describe('reportPreview', () => {
  it('picks the first non-blank line and trims it', () => {
    expect(reportPreview('\n\n  first line  \nsecond line')).toBe('first line')
    expect(reportPreview('')).toBe('')
    expect(reportPreview(/** @type {any} */ (null))).toBe('')
  })

  it('cuts a long line at the code-point limit', () => {
    expect(reportPreview('abcdef', 3)).toBe('abc…')
    expect(reportPreview('abcdef', 10)).toBe('abcdef')
  })
})
