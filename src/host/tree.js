// Facade over the pure task-tree helpers: dates and dotted ids, tree building,
// link validation, tracker materialisation, the read-time brief, and the
// markdown context document. The store, the daily report, the chat prompt, and
// the importer all import the tree surface from here.

export { todayIso } from './clock.js'
export { computeBrief } from './tree/brief.js'
export { DECOMPOSE_MAX_DEPTH, buildTree, deriveSummaryStatus, flattenTree, summarize } from './tree/build.js'
export { CONTEXT_DEFAULT_LIMIT, CONTEXT_MAX_LIMIT, CONTEXT_MIN_LIMIT, renderContextDocument } from './tree/context.js'
export { LINK_TYPES, MAX_LINKS, parseLinks, parseLinksJson } from './tree/links.js'
export { materializeTracker, normalizeTrackerState, progressForStatus, statusForState } from './tree/materialize.js'
export { TASK_KINDS, addDays, compareDotIds, compareRefs, dayToIso, isoToDay, slotForStart } from './tree/refs.js'

/** @typedef {import('./tree/brief.js').Brief} Brief */
/** @typedef {import('./tree/brief.js').BriefEntry} BriefEntry */
/** @typedef {import('./tree/brief.js').BriefLane} BriefLane */
/** @typedef {import('./tree/build.js').TreeTask} TreeTask */
/** @typedef {import('./tree/build.js').TreeTaskNode} TaskNode */
/** @typedef {import('./tree/build.js').TreeTask} TaskRow */
/** @typedef {import('./tree/build.js').TreeTaskNode} TreeTaskNode */
/** @typedef {import('./tree/links.js').LinkType} LinkType */
/** @typedef {import('./tree/links.js').TaskLink} TaskLink */
/** @typedef {import('./tree/materialize.js').ExistingTask} ExistingTask */
/** @typedef {import('./tree/materialize.js').SnapshotNode} SnapshotNode */
/** @typedef {import('./tree/materialize.js').SnapshotTrack} SnapshotTrack */
/** @typedef {import('./tree/refs.js').TaskKind} TaskKind */
/** @typedef {import('./tree/refs.js').TaskStatus} TaskStatus */
