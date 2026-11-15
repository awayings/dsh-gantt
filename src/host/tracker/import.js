// Read, parse, and import the whole tracker workspace into the task store.

import { parseDaily } from './daily.js'
import { readTracker } from './files.js'
import { parseSchedule } from './schedule.js'
import { parseTree } from './tree.js'

/** @typedef {import('../store.js').GanttStore} GanttStore */

/**
 * Read, parse, and import the whole tracker. Idempotent: re-importing rewrites
 * content fields and keeps user status/notes.
 * @param {GanttStore} store
 * @param {{ dir?: string, year?: number }} [options]
 * @returns {{ dir: string, tracks: number, nodes: number, days: number, blocks: number }}
 */
export function importTaskTracker(store, options = {}) {
  const dir = options.dir || ''
  const { schedule, tree, daily } = readTracker(dir)
  const { days } = parseSchedule(schedule, { year: options.year })
  const { tracks, nodes } = parseTree(tree)
  const plans = days.map((day) => {
    const card = daily.get(day.date)
    return { ...day, coreGoal: card === undefined ? '' : parseDaily(card).coreGoal }
  })
  store.replacePlan({ tracks, nodes, days: plans })
  let blocks = 0
  for (const plan of plans) {
    store.upsertPlanBlocks(plan.date, plan.blocks)
    blocks += plan.blocks.length
  }
  return { dir, tracks: tracks.length, nodes: nodes.length, days: plans.length, blocks }
}
