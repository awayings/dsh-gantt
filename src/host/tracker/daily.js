// One dated daily card: its frontmatter date and the first core-goal quote.

import { isRealDate, stripMarkdown } from './markdown.js'

/**
 * Parse one daily card: its frontmatter date and the first core-goal quote.
 * @param {string} text
 * @returns {{ date: string, coreGoal: string }}
 */
export function parseDaily(text) {
  const source = typeof text === 'string' ? text : ''
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  let date = ''
  if (frontmatter !== null) {
    const match = /^date:\s*(\S+)/m.exec(frontmatter[1])
    if (match !== null && isRealDate(match[1])) date = match[1]
  }
  const lines = source.split(/\r?\n/)
  const heading = lines.findIndex(line => /^##\s+(?:🎯\s*)?今天核心目标\s*$/.test(line.trim()))
  let coreGoal = ''
  if (heading !== -1) {
    for (let index = heading + 1; index < lines.length; index += 1) {
      const line = lines[index].trim()
      if (line === '') continue
      if (!line.startsWith('>')) break
      coreGoal = stripMarkdown(line.replace(/^>\s*/, '')).replace(/^一句话[:：]\s*/, '')
      break
    }
  }
  return { date, coreGoal }
}
