// The gantt-long-run preset plugin, mounted by the bundle's preset
// declaration. It exists on the preset plane: the host gantt plugin keeps the
// tree, the routes, the scheduler, and the six task tools for every
// conversation, while this plugin registers the knowledge pair only inside the
// dispatch composition, so a standard conversation never sees it. The store
// handle is a second SQLite connection to the shared database — WAL plus the
// busy timeout let it sit beside the host plugin's connection, the same way
// the gantt-mcp sidecar's does — and it opens without the 08:00 scheduler,
// which stays owned by the host.

import { registerKnowledgeTools } from './knowledge.js'
import { GanttStore, resolveDatabasePath } from './store.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'gantt/long-run'

/** The preset composition always provides the tools service before apply. */
export const inject = ['tools']

/**
 * Open the shared store and register the knowledge tools in this preset's
 * tools layer; the fiber disposer closes the handle.
 * @param {{ get?: (name: string) => unknown, effect: (fn: () => () => void, hint?: string) => unknown }} ctx
 * @returns {void}
 */
export function apply(ctx) {
  const store = new GanttStore(resolveDatabasePath())
  ctx.effect(() => () => store.close(), 'gantt long-run: close the knowledge store')
  registerKnowledgeTools(ctx, store)
}
