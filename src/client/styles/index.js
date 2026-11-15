import { CSS_BASE } from './base.js'
import { CSS_BRIEF } from './brief.js'
import { CSS_CHAT } from './chat.js'
import { CSS_DIALOG } from './dialog.js'
import { CSS_EMPTY } from './empty.js'
import { CSS_GRID } from './grid.js'
import { CSS_HEAD } from './head.js'
import { CSS_MISC } from './misc.js'
import { CSS_RESPONSIVE } from './responsive.js'
import { CSS_STATS } from './stats.js'

// Joined stylesheets: the Gantt page renders `CSS`; the Today page also
// renders its compact `CSS_TODAY` block.
/** Compact stylesheet for the Today page. */
export { CSS_TODAY } from './today.js'
/** Full stylesheet for the Gantt page (and shared base classes for Today). */
export const CSS = [
  CSS_BASE,
  CSS_HEAD,
  CSS_STATS,
  CSS_GRID,
  CSS_EMPTY,
  CSS_DIALOG,
  CSS_MISC,
  CSS_BRIEF,
  CSS_RESPONSIVE,
  CSS_CHAT,
].join('\n')
