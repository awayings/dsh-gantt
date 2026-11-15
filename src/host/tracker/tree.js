// The `TREE.md` track and node tables.

import { cellText, isRealDate, sectionLines, tableRows } from './markdown.js'

/** @typedef {{ id: string, name: string, lane: string, priority: string, state: string, blocker: string }} TrackInput */

/** @typedef {{ id: string, trackId: string, title: string, state: string, startDate: string | null,
 * endDate: string | null, dep: string, doneWhen: string }} NodeInput */

const TRACKS_SECTION = '三、六条支线'
const NODES_SECTION = '四、节点表'

/**
 * @param {string[]} lines
 * @returns {TrackInput[]}
 */
function parseTracks(lines) {
  /** @type {TrackInput[]} */
  const tracks = []
  /** @type {Set<string>} */
  const seen = new Set()
  for (const cells of tableRows(lines)) {
    const id = cellText(cells[0])
    const name = cellText(cells[1])
    if (id === 'id' || id === '' || name === '' || seen.has(id)) continue
    seen.add(id)
    tracks.push({
      id,
      name,
      lane: cellText(cells[2]),
      priority: cellText(cells[3]),
      state: cellText(cells[4]),
      blocker: cellText(cells[5]),
    })
  }
  return tracks
}

/**
 * @param {string | undefined} value
 * @returns {string | null}
 */
function parseDateCell(value) {
  const text = cellText(value)
  if (text === '' || text === '持续' || text === '—' || text === '-') return null
  return isRealDate(text) ? text : null
}

/**
 * @param {string[]} lines
 * @returns {NodeInput[]}
 */
function parseNodes(lines) {
  /** @type {NodeInput[]} */
  const nodes = []
  /** @type {Set<string>} */
  const seen = new Set()
  for (const cells of tableRows(lines)) {
    const id = cellText(cells[0])
    const title = cellText(cells[2])
    if (id === 'id' || id === '' || title === '' || seen.has(id)) continue
    seen.add(id)
    nodes.push({
      id,
      trackId: cellText(cells[1]),
      title,
      state: cellText(cells[3]),
      startDate: parseDateCell(cells[4]),
      endDate: parseDateCell(cells[5]),
      dep: cellText(cells[6]),
      doneWhen: cellText(cells[7]),
    })
  }
  return nodes
}

/**
 * Parse the `TREE.md` track and node tables.
 * @param {string} text
 * @returns {{ tracks: TrackInput[], nodes: NodeInput[] }}
 */
export function parseTree(text) {
  const source = typeof text === 'string' ? text : ''
  const lines = source.split(/\r?\n/)
  return {
    tracks: parseTracks(sectionLines(lines, TRACKS_SECTION)),
    nodes: parseNodes(sectionLines(lines, NODES_SECTION)),
  }
}
