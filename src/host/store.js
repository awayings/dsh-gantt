// Facade over the SQLite store: the GanttStore class, the schema and path
// helpers, the shared status vocabularies, and the tree helpers that the routes,
// the importer, and the tests import from this module.

export { GanttError } from './errors.js'
export { SCHEMA_VERSION, resolveDatabasePath } from './store/db.js'
export { GanttStore } from './store/gantt.js'
export { PLAN_STATUSES } from './store/plan.js'
export { STATUSES } from './store/tasks.js'
export { addDays, buildTree, dayToIso, deriveSummaryStatus, isoToDay, summarize, todayIso } from './tree.js'

/** @typedef {import('./store/context.js').ContextOptions} ContextOptions */
/** @typedef {import('./store/plan.js').BlockDraft} BlockDraft */
/** @typedef {import('./store/plan.js').BlockUpsertCounts} BlockUpsertCounts */
/** @typedef {import('./store/plan.js').DayPlanBundle} DayPlanBundle */
/** @typedef {import('./store/plan.js').PlanBlock} PlanBlock */
/** @typedef {import('./store/plan.js').PlanStatus} PlanStatus */
/** @typedef {import('./store/plan.js').ReplacePlanCounts} ReplacePlanCounts */
/** @typedef {import('./store/plan.js').ReplacePlanInput} ReplacePlanInput */
/** @typedef {import('./store/plan.js').ScheduleInput} ScheduleInput */
/** @typedef {import('./store/tasks.js').DecomposeChildInput} DecomposeChildInput */
/** @typedef {import('./store/tasks.js').SplitChild} SplitChild */
/** @typedef {import('./store/tasks.js').TaskInput} TaskInput */
/** @typedef {import('./store/tasks.js').TaskPatch} TaskPatch */
/** @typedef {import('./tree.js').Brief} Brief */
/** @typedef {import('./tree.js').LinkType} LinkType */
/** @typedef {import('./tree.js').SnapshotNode} SnapshotNode */
/** @typedef {import('./tree.js').SnapshotTrack} SnapshotTrack */
/** @typedef {import('./tree.js').TaskKind} TaskKind */
/** @typedef {import('./tree.js').TaskLink} TaskLink */
/** @typedef {import('./tree.js').TaskNode} TaskNode */
/** @typedef {import('./tree.js').TaskStatus} TaskStatus */
/** @typedef {import('./tree.js').TreeTask} TaskRow */
