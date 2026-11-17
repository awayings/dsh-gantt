// Restricted markdown renderer for task descriptions: ATX headings, unordered
// and ordered lists, fenced code, inline code, bold, italic, links, quotes,
// rules, and paragraphs (intra-paragraph newlines become <br>). Every element is
// built through h(); raw HTML stays inert text and a link becomes an anchor only
// for the http(s) and mailto protocols.
import React from 'react'
import { h } from './dom.js'

/** ATX heading: one to six `#` markers, a space, and the heading text. */
const HEADING = /^(#{1,6})\s+(.+)$/
/** Unordered list item: a `-`, `*`, or `+` marker, a space, and the item text. */
const UNORDERED_ITEM = /^[-*+]\s+(.*)$/
/** Ordered list item: a decimal marker, a dot, a space, and the item text. */
const ORDERED_ITEM = /^\d+\.\s+(.*)$/
/** Fenced code delimiter; an info string after the backticks is ignored. */
const FENCE = /^```/
/** Blockquote line: a `>` marker and the quoted text. */
const QUOTE = /^>\s?(.*)$/
/** Horizontal rule: three or more hyphens on their own line. */
const RULE = /^-{3,}$/
/** A line that begins a non-paragraph block, matching the block parsers below. */
const BLOCK_START = /^(?:```|#{1,6}\s|>|-{3,}$|[-*+]\s|\d+\.\s)/
/** One inline token: code span, bold span, italic span, or markdown link. */
const INLINE_TOKEN = /(`[^`]+`|\*\*[\s\S]+?\*\*|\*[^*\n]+?\*|\[[^\]]*\]\([^)\n]*\))/g
/** Protocols a rendered link may use; anything else degrades to plain text. */
const SAFE_PROTOCOL = /^(?:https?:\/\/|mailto:)/i

/**
 * Read a fenced code block starting at `start`; an unclosed fence runs to EOF.
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ code: string, next: number }}
 */
function readFence(lines, start) {
  const code = []
  let index = start + 1
  while (index < lines.length && !FENCE.test(lines[index].trim())) {
    code.push(lines[index])
    index += 1
  }
  return { code: code.join('\n'), next: index + 1 }
}

/**
 * Read the consecutive list items starting at `start`.
 * @param {string[]} lines
 * @param {number} start
 * @param {RegExp} marker
 * @returns {{ items: string[], next: number }}
 */
function readItems(lines, start, marker) {
  const items = []
  let index = start
  while (index < lines.length) {
    const item = marker.exec(lines[index].trim())
    if (item === null) break
    items.push(item[1].trim())
    index += 1
  }
  return { items, next: index }
}

/**
 * Read the consecutive blockquote lines starting at `start`, dropping each `>`.
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ quoted: string[], next: number }}
 */
function readQuote(lines, start) {
  const quoted = []
  let index = start
  while (index < lines.length) {
    const quote = QUOTE.exec(lines[index].trim())
    if (quote === null) break
    quoted.push(quote[1])
    index += 1
  }
  return { quoted, next: index }
}

/**
 * Render several source lines as one inline run, with `<br>` between lines.
 * @param {string[]} lines
 * @returns {any[]}
 */
function renderLines(lines) {
  const nodes = []
  for (const [index, line] of lines.entries()) {
    if (index > 0) nodes.push(h('br', { key: `${index}:br` }))
    nodes.push(...renderInline(line, `${index}:`))
  }
  return nodes
}

/**
 * Render one list block.
 * @param {'ul' | 'ol'} tag
 * @param {string[]} items
 * @param {string} key
 * @returns {any}
 */
function renderList(tag, items, key) {
  return h(tag, { key }, items.map((item, index) => h('li', { key: String(index) }, renderInline(item, `${index}:`))))
}

/**
 * Render one inline token. `link` is the only token whose target may be unsafe;
 * an unsafe or non-http(s)/mailto target keeps the label as plain text.
 * @param {string} token
 * @param {string} key
 * @returns {any}
 */
function inlineToken(token, key) {
  if (token.startsWith('`')) return h('code', { key }, token.slice(1, -1))
  if (token.startsWith('**')) return h('strong', { key }, renderInline(token.slice(2, -2)))
  if (token.startsWith('*')) return h('em', { key }, renderInline(token.slice(1, -1)))
  const label = token.slice(1, token.indexOf(']('))
  const url = token.slice(token.indexOf('](') + 2, -1).trim()
  if (!SAFE_PROTOCOL.test(url)) return label
  return h('a', { key, href: url, target: '_blank', rel: 'noopener noreferrer' }, renderInline(label))
}

/**
 * Render inline markdown into a keyed node list; unmatched markers stay text.
 * @param {string} text
 * @param {string} [prefix]
 * @returns {any[]}
 */
function renderInline(text, prefix = '') {
  const nodes = []
  let last = 0
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const index = /** @type {number} */ (match.index)
    if (index > last) nodes.push(text.slice(last, index))
    nodes.push(inlineToken(match[0], `${prefix}${index}`))
    last = index + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/**
 * Restricted markdown as React nodes.
 * @param {unknown} text
 * @returns {any | null} the rendered fragment, or null without visible text
 */
export function renderMarkdown(text) {
  if (typeof text !== 'string') return null
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (text.trim() === '') return null
  const blocks = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index].trim()
    if (line === '') {
      index += 1
      continue
    }
    if (FENCE.test(line)) {
      const fence = readFence(lines, index)
      blocks.push(h('pre', { key: String(blocks.length) }, h('code', null, fence.code)))
      index = fence.next
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push(h(`h${heading[1].length}`, { key: String(blocks.length) }, renderInline(heading[2])))
      index += 1
      continue
    }
    if (RULE.test(line)) {
      blocks.push(h('hr', { key: String(blocks.length) }))
      index += 1
      continue
    }
    if (QUOTE.test(line)) {
      const quote = readQuote(lines, index)
      blocks.push(h('blockquote', { key: String(blocks.length) }, renderLines(quote.quoted)))
      index = quote.next
      continue
    }
    const marker = UNORDERED_ITEM.test(line)
      ? UNORDERED_ITEM
      : ORDERED_ITEM.test(line) ? ORDERED_ITEM : null
    if (marker !== null) {
      const list = readItems(lines, index, marker)
      blocks.push(renderList(marker === UNORDERED_ITEM ? 'ul' : 'ol', list.items, String(blocks.length)))
      index = list.next
      continue
    }
    const paragraph = []
    while (index < lines.length) {
      const current = lines[index].trim()
      if (current === '' || BLOCK_START.test(current)) break
      paragraph.push(current)
      index += 1
    }
    blocks.push(h('p', { key: String(blocks.length) }, renderLines(paragraph)))
  }
  return h(React.Fragment, null, blocks)
}

/**
 * Reusable markdown preview: renders `text` inside a body element, or the
 * caller's `empty` node when there is no visible text. Callers own the
 * surrounding section and pass the body class their stylesheet targets, so any
 * panel can reuse the same restricted renderer.
 * @param {{ text: unknown, className?: string, empty?: any }} props
 * @returns {any | null}
 */
export function Markdown({ text, className, empty }) {
  const body = renderMarkdown(text)
  if (body === null) return empty ?? null
  return h('div', { className }, body)
}
