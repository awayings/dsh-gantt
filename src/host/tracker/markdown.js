// Markdown table, cell, section, and date primitives shared by the tracker
// parsers. The tracker is hand-maintained, so every helper here tolerates cells
// that drift: extra cells are ignored, missing cells read as empty.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** @type {string[]} */
const WEEKDAY_CHARS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * Strip the inline markdown the tracker writes inside table cells.
 * @param {string} value
 * @returns {string}
 */
export function stripMarkdown(value) {
  return value
    .replaceAll('**', '')
    .replaceAll('`', '')
    .replaceAll('⭐', '')
    .replaceAll('⚠️', '')
    .replaceAll('✅', '')
    .replaceAll('❌', '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string | undefined} value
 * @returns {string}
 */
export function cellText(value) {
  return value === undefined ? '' : stripMarkdown(value)
}

/**
 * Split one table row into cells, tolerating the leading `||` the tracker uses.
 * @param {string} line
 * @returns {string[]}
 */
export function splitCells(line) {
  const trimmed = line.trim()
  const lead = trimmed.startsWith('||') ? 2 : 1
  const tail = trimmed.endsWith('|') ? 1 : 0
  return trimmed.slice(lead, trimmed.length - tail).split('|')
}

/**
 * @param {string[]} cells
 * @returns {boolean}
 */
export function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()))
}

/**
 * Collect the lines of one `## ` section, stopping at the next `## ` heading.
 * @param {string[]} lines
 * @param {string} marker
 * @returns {string[]}
 */
export function sectionLines(lines, marker) {
  const start = lines.findIndex(line => /^##\s/.test(line) && line.includes(marker))
  if (start === -1) return []
  /** @type {string[]} */
  const section = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) break
    section.push(lines[index])
  }
  return section
}

/**
 * Read the table rows of a section, ignoring notes, separators, and prose.
 * @param {string[]} lines
 * @returns {string[][]}
 */
export function tableRows(lines) {
  /** @type {string[][]} */
  const rows = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('>')) continue
    if (!trimmed.startsWith('|')) {
      if (rows.length > 0) break
      continue
    }
    const cells = splitCells(trimmed)
    if (cells.length === 0 || isSeparatorRow(cells)) continue
    rows.push(cells)
  }
  return rows
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isRealDate(value) {
  if (!DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/**
 * @param {string} date
 * @returns {string}
 */
export function weekdayFor(date) {
  const [year, month, day] = date.split('-').map(Number)
  return `周${WEEKDAY_CHARS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]}`
}
