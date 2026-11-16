// The work mode's content directory: the folder a task's dedicated main
// conversation runs in and that the client matches to a registered Workspace.
// Resolved per request so a deployment can override it without a rebuild.

/** The documented default work directory. */
export const DEFAULT_WORK_CWD = '/data/home/ws-plugin'

/**
 * Resolve the content work directory: `DSH_GANTT_WORK_CWD` when set and
 * non-blank, else the documented default.
 * @returns {string}
 */
export function resolveWorkCwd() {
  return (process.env.DSH_GANTT_WORK_CWD || '').trim() || DEFAULT_WORK_CWD
}
