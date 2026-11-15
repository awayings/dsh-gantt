// Facade over the daily 该动 engine: window templates and role budgets, the
// deterministic selection, the persisted report shape, and the context section.

export { nextEightAm } from './clock.js'
export { appendBriefSection, computeDailyBrief, parseDailyReport } from './daily/report.js'
export { buildWindows, parseEstimate, trackRole, windowKindOf } from './daily/windows.js'

/** @typedef {import('./daily/report.js').DailyReport} DailyReport */
/** @typedef {import('./daily/windows.js').BriefDayKind} BriefDayKind */
/** @typedef {import('./daily/windows.js').BriefRole} BriefRole */
/** @typedef {import('./daily/windows.js').BriefSlot} BriefSlot */
/** @typedef {import('./daily/windows.js').BriefWindow} BriefWindow */
