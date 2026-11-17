// Restricted markdown renderer: every supported block and inline form, the
// link-protocol safety rule, raw-HTML inertness, malformed input, and the
// reusable Markdown preview component.
import { afterEach, describe, expect, it } from 'vitest'
import { h } from '../../src/client/dom.js'
import { Markdown, renderMarkdown } from '../../src/client/markdown.js'
import { mount, q, qa, text, unmountAll } from './harness.js'

/** Mount a markdown document inside a plain container. */
function render(source) {
  return mount(h('div', null, renderMarkdown(source)))
}

/** Mount the reusable preview component. */
function renderPreview(props) {
  return mount(h(Markdown, props))
}

afterEach(unmountAll)

describe('block elements', () => {
  it('renders the six ATX heading levels', () => {
    const view = render('# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six')
    expect(qa(view.container, 'h1, h2, h3, h4, h5, h6').map(element => element.tagName))
      .toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
    expect(text(view.container, 'h1')).toBe('One')
    expect(text(view.container, 'h6')).toBe('Six')
    expect(qa(view.container, 'p')).toHaveLength(0)
  })

  it('renders inline markdown inside a heading', () => {
    const view = render('## Use **bold** and `code`')
    expect(text(view.container, 'h2 strong')).toBe('bold')
    expect(text(view.container, 'h2 code')).toBe('code')
  })

  it('keeps malformed headings as paragraphs', () => {
    const view = render('#no space\n####### too deep')
    const paragraphs = qa(view.container, 'p')
    expect(paragraphs).toHaveLength(1)
    expect(q(view.container, 'h1, h2, h3, h4, h5, h6')).toBeNull()
    expect(paragraphs[0].textContent).toBe('#no space####### too deep')
    expect(qa(paragraphs[0], 'br')).toHaveLength(1)
  })

  it('groups consecutive unordered items into one list', () => {
    const view = render('- alpha\n* beta\n+ gamma')
    expect(qa(view.container, 'ul')).toHaveLength(1)
    expect(qa(view.container, 'li').map(element => element.textContent)).toEqual(['alpha', 'beta', 'gamma'])
    expect(qa(view.container, 'p')).toHaveLength(0)
  })

  it('starts a new list after a blank line and ends it at another block', () => {
    const view = render('- alpha\n\n- beta\n# after')
    expect(qa(view.container, 'ul')).toHaveLength(2)
    expect(text(view.container, 'h1')).toBe('after')
  })

  it('renders inline markdown inside list items', () => {
    const view = render('- **bold** item\n- `code` item')
    expect(text(view.container, 'li strong')).toBe('bold')
    expect(text(view.container, 'li code')).toBe('code')
  })

  it('groups consecutive ordered items into one list', () => {
    const view = render('1. first\n2. second\n10. tenth')
    expect(qa(view.container, 'ol')).toHaveLength(1)
    expect(qa(view.container, 'ol li').map(element => element.textContent)).toEqual(['first', 'second', 'tenth'])
  })

  it('keeps a numeric paragraph that is not a list item', () => {
    const view = render('1.not a list')
    expect(q(view.container, 'ol')).toBeNull()
    expect(text(view.container, 'p')).toBe('1.not a list')
  })

  it('renders a fenced code block verbatim and inert', () => {
    const view = render('```js\nconst a = 1\n  <b>raw</b>\n\nend\n```\n\nafter')
    const pre = q(view.container, 'pre')
    expect(pre).not.toBeNull()
    expect(text(view.container, 'pre code')).toBe('const a = 1\n  <b>raw</b>\n\nend')
    expect(q(view.container, 'pre b')).toBeNull()
    expect(text(view.container, 'p')).toBe('after')
  })

  it('runs an unclosed fence to the end and renders an empty fence', () => {
    const unclosed = render('```\nlet x = 1')
    expect(text(unclosed.container, 'pre code')).toBe('let x = 1')
    unclosed.unmount()

    const empty = render('```\n```')
    expect(text(empty.container, 'pre code')).toBe('')
  })

  it('renders blockquotes with line breaks and inline markdown', () => {
    const view = render('> quoted **one**\n> quoted two')
    expect(qa(view.container, 'blockquote')).toHaveLength(1)
    const quote = q(view.container, 'blockquote')
    expect(q(quote, 'strong').textContent).toBe('one')
    expect(qa(quote, 'br')).toHaveLength(1)
    expect(quote.textContent).toBe('quoted onequoted two')
  })

  it('ends a blockquote at the first non-quoted line', () => {
    const view = render('> quoted\nplain')
    expect(qa(view.container, 'blockquote')).toHaveLength(1)
    expect(text(view.container, 'p')).toBe('plain')
  })

  it('renders horizontal rules and keeps shorter hyphen runs as text', () => {
    const view = render('---\n----\n--')
    expect(qa(view.container, 'hr')).toHaveLength(2)
    expect(text(view.container, 'p')).toBe('--')
  })

  it('joins paragraph lines with line breaks', () => {
    const view = render('first line\nsecond line\n\ntwo')
    const paragraphs = qa(view.container, 'p')
    expect(paragraphs).toHaveLength(2)
    expect(qa(paragraphs[0], 'br')).toHaveLength(1)
    expect(paragraphs[0].textContent).toBe('first linesecond line')
    expect(paragraphs[1].textContent).toBe('two')
  })

  it('ends a paragraph at the next block and normalizes CRLF input', () => {
    const view = render('text\r\n- item\r\n\r\n1. ordered')
    expect(text(view.container, 'p')).toBe('text')
    expect(qa(view.container, 'li')).toHaveLength(2)
    expect(q(view.container, 'ol')).not.toBeNull()
  })

  it('skips blank lines and returns null without visible text', () => {
    expect(renderMarkdown('')).toBeNull()
    expect(renderMarkdown(' \n\t\n')).toBeNull()
  })

  it('returns null for non-string input', () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(renderMarkdown(value)).toBeNull()
    }
  })
})

describe('inline elements', () => {
  it('renders inline code and keeps an unmatched backtick as text', () => {
    const view = render('Use `h()` and `x` here, then `oops')
    expect(qa(view.container, 'code').map(element => element.textContent)).toEqual(['h()', 'x'])
    expect(text(view.container, 'p')).toBe('Use h() and x here, then `oops')
  })

  it('renders bold and italic spans with surrounding text', () => {
    const view = render('**bold** and *italic* and **unclosed')
    expect(text(view.container, 'strong')).toBe('bold')
    expect(text(view.container, 'em')).toBe('italic')
    expect(text(view.container, 'p')).toBe('bold and italic and **unclosed')
  })

  it('nests inline forms inside bold', () => {
    const view = render('**bold *italic* `code`**')
    expect(text(view.container, 'strong em')).toBe('italic')
    expect(text(view.container, 'strong code')).toBe('code')
  })

  it('renders anchors only for safe protocols', () => {
    const view = render([
      '[Example](https://example.com/a?b=1)',
      '[Mail](mailto:dev@example.com)',
      '[Upper](HTTPS://EXAMPLE.COM)',
      '[Ftp](ftp://example.com/x)',
      '[Relative](/local/path)',
    ].join('\n'))
    const links = qa(view.container, 'a')
    expect(links).toHaveLength(3)
    expect(links.map(element => element.getAttribute('href')))
      .toEqual(['https://example.com/a?b=1', 'mailto:dev@example.com', 'HTTPS://EXAMPLE.COM'])
    expect(links[0].getAttribute('target')).toBe('_blank')
    expect(links[0].getAttribute('rel')).toBe('noopener noreferrer')
    expect(text(view.container, 'p')).toBe('ExampleMailUpperFtpRelative')
  })

  it('trims a link target and renders its label markdown', () => {
    const view = render('[**fine**](  https://a.test  )')
    const link = q(view.container, 'a')
    expect(link.getAttribute('href')).toBe('https://a.test')
    expect(text(link, 'strong')).toBe('fine')
  })

  it('drops the anchor for an unsafe empty label', () => {
    const view = render('[](ftp://example.com/x)')
    expect(q(view.container, 'a')).toBeNull()
    expect(text(view.container, 'p')).toBe('')
  })

  it('keeps raw HTML inert', () => {
    const source = 'Hello <b>world</b> <script>alert(1)</script>'
    const view = render(source)
    expect(text(view.container, 'p')).toBe(source)
    expect(q(view.container, 'b')).toBeNull()
    expect(q(view.container, 'script')).toBeNull()
  })

  it('renders a mixed document as blocks in source order', () => {
    const view = render([
      '# Title',
      '',
      'Intro with **bold**.',
      '',
      '1. one',
      '2. two',
      '',
      '> note',
      '',
      '```',
      'code',
      '```',
      '',
      '---',
      '',
      '[link](https://example.com)',
    ].join('\n'))
    expect(qa(view.container, 'h1, p, ol, blockquote, pre, hr').map(element => element.tagName))
      .toEqual(['H1', 'P', 'OL', 'BLOCKQUOTE', 'PRE', 'HR', 'P'])
    expect(text(view.container, 'p a')).toBe('link')
  })
})

describe('Markdown preview component', () => {
  it('renders the body with the caller class and the markdown nodes', () => {
    const view = renderPreview({ text: '# Title\n\nbody', className: 'md-body' })
    const body = q(view.container, '.md-body')
    expect(body).not.toBeNull()
    expect(text(body, 'h1')).toBe('Title')
    expect(text(body, 'p')).toBe('body')
  })

  it('renders the caller empty node instead of an empty body', () => {
    const view = renderPreview({
      text: '   ',
      className: 'md-body',
      empty: h('p', { className: 'md-empty' }, 'nothing'),
    })
    expect(q(view.container, '.md-body')).toBeNull()
    expect(text(view.container, '.md-empty')).toBe('nothing')
  })

  it('renders nothing when there is no text and no empty node', () => {
    const view = renderPreview({ text: null, className: 'md-body' })
    expect(view.container.textContent).toBe('')
    expect(view.container.children).toHaveLength(0)
  })

  it('omits the body class when the caller does not pass one', () => {
    const view = renderPreview({ text: 'body' })
    const body = view.container.firstElementChild
    expect(body.tagName).toBe('DIV')
    expect(body.getAttribute('class')).toBeNull()
  })
})
