// The gantt plugin's host entry: one SQLite store, its task-day 08:00 daily
// recompute, the nineteen authenticated `/api/gantt/*` JSON routes, the
// assistant tools a DSH conversation uses to read and decompose tasks, and the
// background context that puts the focused task chain into each conversation.

import { GanttStore, resolveDatabasePath } from './store.js'
import { installPrompt } from './prompt.js'
import { registerRoutes } from './routes/index.js'
import { registerTools } from './tools.js'

/** @typedef {import('./routes/http.js').GanttContext} GanttContext */
/** @typedef {import('./routes/http.js').GanttEndpoint} GanttEndpoint */
/** @typedef {import('./routes/http.js').GanttRoute} GanttRoute */
/** @typedef {import('./store.js').PlanStatus} PlanStatus */
/** @typedef {import('./store.js').SplitChild} SplitChild */
/** @typedef {import('./store.js').TaskInput} TaskInput */
/** @typedef {import('./store.js').TaskPatch} TaskPatch */
/** @typedef {import('./store.js').TaskStatus} TaskStatus */

export const name = 'gantt'
export const inject = ['connection']

/**
 * Register the store, the scheduler effect, the route table, and the assistant
 * tools (which no-op when the host runs without a tools service).
 * @param {GanttContext} ctx
 * @returns {void}
 */
export function apply(ctx) {
  const store = new GanttStore(resolveDatabasePath())
  ctx.effect(() => () => store.close(), 'gantt: close SQLite database')
  ctx.effect(() => store.startScheduler(), 'gantt: recompute the daily brief at 08:00')
  registerRoutes(ctx, store)
  // The prompt and tools services may mount after this plugin, so wait for them
  // explicitly. Unit harnesses and headless profiles have no inject seam; they
  // register against whatever the context already exposes.
  if (typeof ctx.inject === 'function') {
    /** @param {GanttContext} promptCtx */
    const onPrompt = promptCtx => installPrompt(promptCtx, store)
    ctx.inject(['systemPrompt'], onPrompt)
    /** @param {GanttContext} toolsCtx */
    const onTools = toolsCtx => registerTools(toolsCtx, store)
    ctx.inject(['tools'], onTools)
  } else {
    registerTools(ctx, store)
  }
}
