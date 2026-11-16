import { h } from './dom.js'
/** Gantt page glyph. */
export function GanttGlyph({ size = 22 }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
    style: { display: 'block' },
  },
  h('rect', { x: 3.5, y: 4.5, width: 9, height: 3.4, rx: 1.7, fill: 'currentColor' }),
  h('rect', { x: 8.5, y: 10.3, width: 12, height: 3.4, rx: 1.7, fill: 'currentColor', opacity: 0.72 }),
  h('rect', { x: 5.5, y: 16.1, width: 8, height: 3.4, rx: 1.7, fill: 'currentColor', opacity: 0.46 }),
  h('path', { d: 'M3.5 2.8v18.4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', opacity: 0.42 }),
  )
}

/** Info glyph for the page intro popover; fixed 14px. */
export function InfoGlyph() {
  return h('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    'aria-hidden': 'true',
    style: { display: 'block' },
  },
  h('circle', { cx: 12, cy: 12, r: 9 }),
  h('path', { d: 'M12 11v6', strokeLinecap: 'round' }),
  h('circle', { cx: 12, cy: 7.6, r: 1.1, fill: 'currentColor', stroke: 'none' }),
  )
}

/** Sidebar icon for the Gantt panel. */
export function SidebarIcon({ size = 18, active = false }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: active ? 2 : 1.8,
    strokeLinecap: 'round',
    'aria-hidden': 'true',
    style: { display: 'block', opacity: active ? 1 : 0.85 },
  },
  h('rect', { x: 4, y: 4, width: 9, height: 3.4, rx: 1.7 }),
  h('rect', { x: 9, y: 10.3, width: 11, height: 3.4, rx: 1.7 }),
  h('rect', { x: 6, y: 16.6, width: 8, height: 3.4, rx: 1.7 }),
  h('path', { d: 'M3.5 3v18', opacity: 0.4 }),
  )
}

/** Sidebar icon for the Today panel. */
export function TodayGlyph({ size = 18, active = false }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: active ? 2 : 1.8,
    strokeLinecap: 'round',
    'aria-hidden': 'true',
    style: { display: 'block', opacity: active ? 1 : 0.85 },
  },
  h('rect', { x: 4, y: 5, width: 16, height: 15, rx: 3.2 }),
  h('path', { d: 'M4 9.6h16', opacity: 0.55 }),
  h('path', { d: 'M8 3v3.4M16 3v3.4' }),
  h('circle', { cx: 12, cy: 14.6, r: 2.3, fill: 'currentColor', stroke: 'none' }),
  )
}
