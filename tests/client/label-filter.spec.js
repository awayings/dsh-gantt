// The label codec behind the single Gantt filter row: every stored label is
// either a predefined status/perspective label or an artificial tag, and the
// sanitizer has to survive hand-edited localStorage without ever exceeding the
// caps the page and the server assume.
import { describe, expect, it } from 'vitest'
import {
  MAX_LABELS,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  PRESET_LABELS,
  parseLabel,
  presetLabel,
  sanitizeLabels,
  tagLabel,
} from '../../src/client/label-filter.js'

describe('label constants', () => {
  it('pins the predefined labels and the caps', () => {
    expect(PRESET_LABELS).toEqual(['unfinished', 'active', 'frontier', 'next', 'today', 'done', 'inspiration'])
    expect(MAX_TAGS).toBe(20)
    expect(MAX_TAG_LENGTH).toBe(40)
    expect(MAX_LABELS).toBe(27)
  })
})

describe('presetLabel and tagLabel', () => {
  it('encodes every predefined label', () => {
    for (const preset of PRESET_LABELS) expect(presetLabel(preset)).toBe(`preset:${preset}`)
  })

  it('encodes a tag with surrounding whitespace trimmed', () => {
    expect(tagLabel('docs')).toBe('tag:docs')
    expect(tagLabel('  docs  ')).toBe('tag:docs')
  })
})

describe('parseLabel', () => {
  it('decodes every predefined label', () => {
    for (const preset of PRESET_LABELS) {
      expect(parseLabel(presetLabel(preset))).toEqual({ kind: 'preset', preset })
    }
  })

  it('decodes a tag and trims it', () => {
    expect(parseLabel('tag:docs')).toEqual({ kind: 'tag', tag: 'docs' })
    expect(parseLabel('tag:  docs  ')).toEqual({ kind: 'tag', tag: 'docs' })
    expect(parseLabel(`tag:${'t'.repeat(MAX_TAG_LENGTH)}`)).toEqual({
      kind: 'tag',
      tag: 't'.repeat(MAX_TAG_LENGTH),
    })
  })

  it('rejects values that are not strings', () => {
    for (const value of [42, null, undefined, true, {}, [], ['tag:docs']]) {
      expect(parseLabel(value)).toBeNull()
    }
  })

  it('rejects unknown presets and blank tags', () => {
    for (const value of ['preset:', 'preset:nope', 'preset:ALL', 'tag:', 'tag:   ']) {
      expect(parseLabel(value)).toBeNull()
    }
  })

  it('rejects an over-long tag', () => {
    expect(parseLabel(`tag:${'x'.repeat(MAX_TAG_LENGTH + 1)}`)).toBeNull()
  })

  it('rejects another prefix, a bare value and a padded prefix', () => {
    for (const value of ['docs', '#docs', 'label:docs', 'tagdocs', ' tag:docs', 'preset:done ']) {
      expect(parseLabel(value)).toBeNull()
    }
  })
})

describe('sanitizeLabels', () => {
  it('treats a non-array selection as no filter', () => {
    for (const value of ['tag:docs', 42, null, undefined, { 0: 'tag:docs' }]) {
      expect(sanitizeLabels(value)).toEqual([])
    }
  })

  it('keeps recognized labels and drops everything else', () => {
    const value = [
      'tag:docs',
      'preset:frontier',
      'docs',
      42,
      null,
      '',
      'tag:',
      'preset:nope',
      'tag:' + 'x'.repeat(MAX_TAG_LENGTH + 1),
    ]
    expect(sanitizeLabels(value)).toEqual(['tag:docs', 'preset:frontier'])
  })

  it('canonicalizes tags and deduplicates in first-seen order', () => {
    const value = ['tag: docs ', 'preset:done', 'tag:docs', 'preset:unfinished', 'preset:done', 'tag:release']
    expect(sanitizeLabels(value)).toEqual([
      'tag:docs',
      'preset:done',
      'preset:unfinished',
      'tag:release',
    ])
  })

  it('caps the tags at twenty but still keeps a later preset', () => {
    const value = [
      ...Array.from({ length: MAX_TAGS }, (_value, index) => `tag:tag-${index}`),
      'tag:over-cap',
      'preset:done',
    ]
    const labels = sanitizeLabels(value)
    expect(labels).toHaveLength(MAX_TAGS + 1)
    expect(labels.at(-1)).toBe('preset:done')
    expect(labels).not.toContain('tag:over-cap')
  })

  it('caps the whole selection at 27 labels', () => {
    const value = [
      ...Array.from({ length: MAX_TAGS }, (_value, index) => `tag:tag-${index}`),
      ...PRESET_LABELS.map(preset => presetLabel(preset)),
    ]
    const labels = sanitizeLabels(value)
    expect(labels).toHaveLength(MAX_LABELS)
    expect(labels.at(-1)).toBe('preset:inspiration')
  })

  it('keeps an empty selection empty', () => {
    expect(sanitizeLabels([])).toEqual([])
  })
})
