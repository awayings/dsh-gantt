// Locate and read the tracker workspace: SCHEDULE.md, TREE.md, and the daily cards.

import fs from 'node:fs'
import path from 'node:path'
import { GanttError } from '../errors.js'

const DAILY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/
const MAX_DAILY_CARDS = 31
export const SCHEDULE_FILE = 'SCHEDULE.md'
const TREE_FILE = 'TREE.md'
const DAILY_DIR = 'daily'
const DEFAULT_TRACKER_DIR = '/data/home/clawd/projects/task-tracker'

/**
 * Resolve the tracker directory: the environment override or the documented default.
 * @returns {string}
 */
export function resolveTrackerDir() {
  return process.env.DSH_GANTT_TRACKER_DIR || DEFAULT_TRACKER_DIR
}

/**
 * @param {string} file
 * @returns {string}
 */
function readFileOrEmpty(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Read every dated daily card, keeping the 31 newest file names.
 * @param {string} dir
 * @returns {Map<string, string>}
 */
function readDailies(dir) {
  /** @type {string[]} */
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return new Map()
  }
  const dated = names.filter(name => DAILY_FILE_RE.test(name)).sort().slice(-MAX_DAILY_CARDS)
  return new Map(dated.map(name => [name.slice(0, 10), readFileOrEmpty(path.join(dir, name))]))
}

/**
 * Read the tracker sources. A missing directory is a `400`; a missing individual
 * file degrades to an empty string, and `daily` maps each date to its card text.
 * @param {string} dir
 * @returns {{ schedule: string, tree: string, daily: Map<string, string> }}
 */
export function readTracker(dir) {
  if (typeof dir !== 'string' || dir === '') throw new GanttError('tracker directory is required')
  /** @type {import('node:fs').Stats} */
  let stats
  try {
    stats = fs.statSync(dir)
  } catch {
    throw new GanttError(`tracker directory ${dir} was not found`, 400)
  }
  if (!stats.isDirectory()) throw new GanttError(`tracker path ${dir} is not a directory`, 400)
  return {
    schedule: readFileOrEmpty(path.join(dir, SCHEDULE_FILE)),
    tree: readFileOrEmpty(path.join(dir, TREE_FILE)),
    daily: readDailies(path.join(dir, DAILY_DIR)),
  }
}
