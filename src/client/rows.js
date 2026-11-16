import { DAY_MS, STATUS_COLOR } from './constants.js'
import { formatMonth, formatMonthYear, formatWeekday, formatYear, isoToDay } from './dates.js'
import { StatusPill } from './status.js'
import { rowNumber } from './view.js'
import { h } from './dom.js'

function barRange(task, timeline) {
  const start = Math.max(isoToDay(task.startDate), timeline.startMs)
  const end = Math.min(isoToDay(task.endDate) + DAY_MS, timeline.endMs)
  if (end <= start) return null
  return {
    left: ((start - timeline.startMs) / DAY_MS) * timeline.pxPerDay,
    width: Math.max(task.hasChildren ? 2 : 3, ((end - start) / DAY_MS) * timeline.pxPerDay),
  }
}
function MetaChips({ task, t }) {
  const chips = []
  const push = (key, label, title) => {
    chips.push(h('span', { key, className: 'gantt-row-chip', title }, label))
  }
  if (task.kind === 'track') {
    if (task.lane) push('lane', task.lane, `${t('field.lane')}: ${task.lane}`)
    if (task.state) push('state', task.state, `${t('field.state')}: ${task.state}`)
  } else {
    if (task.state) push('state', task.state, `${t('field.state')}: ${task.state}`)
    if (task.doneWhen) push('doneWhen', task.doneWhen, `${t('field.doneWhen')}: ${task.doneWhen}`)
    if (task.landing) push('landing', `⤷ ${task.landing}`, `${t('field.landing')}: ${task.landing}`)
    if (task.estimate) push('estimate', task.estimate, `${t('field.estimate')}: ${task.estimate}`)
    if (task.category) push('category', task.category, `${t('field.category')}: ${task.category}`)
    if (task.inspiration) push('inspiration', task.inspiration, `${t('field.inspiration')}: ${task.inspiration}`)
    for (const link of Array.isArray(task.links) ? task.links : []) {
      push(`link:${link.ref}`, link.label || link.ref, `${t('field.links')}: ${link.type}:${link.ref}`)
    }
  }
  if (chips.length === 0) return null
  return h('div', { className: 'gantt-task-meta' }, chips)
}
function TaskBar({ task, timeline, onSelect }) {
  const range = barRange(task, timeline)
  if (range === null) return null
  const overdue = task.status !== 'done' && task.endDate < timeline.today
  return h('button', {
    type: 'button',
    className: 'gantt-bar',
    'data-status': task.status,
    'data-summary': task.hasChildren ? 'true' : undefined,
    'data-overdue': overdue ? 'true' : undefined,
    style: {
      left: `${range.left}px`,
      width: `${range.width}px`,
      '--st': STATUS_COLOR[task.status] || STATUS_COLOR.todo,
    },
    title: `${rowNumber(task)} ${task.title}\n${task.startDate} → ${task.endDate} · ${task.progress}%`,
    onClick: (event) => {
      event.stopPropagation()
      onSelect(task)
    },
  },
  h('span', { className: 'gantt-bar-fill', style: { width: `${task.progress}%` } }),
  !task.hasChildren && range.width > 58
    ? h('span', { className: 'gantt-bar-label' }, task.title)
    : null,
  )
}

/** One task row: tree cell, metadata chips and the timeline track. */
export function GanttRow({
  task,
  depth,
  timeline,
  selected,
  collapsed,
  t,
  onSelect,
  onToggle,
  onAddChild,
  onCycleStatus,
  onDecompose,
  onSchedule,
  work = false,
  onEdit,
}) {
  const hasChildren = task.hasChildren
  const number = rowNumber(task)
  const isTrack = task.kind === 'track'
  return h('div', {
    className: 'gantt-row',
    'data-selected': selected ? 'true' : undefined,
    'data-depth': depth,
    'data-kind': task.kind,
    'data-task-id': task.id,
    'data-work': work ? 'true' : undefined,
    onClick: () => onSelect(task),
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onSelect(task)
      }
    },
    role: 'button',
    tabIndex: 0,
    'aria-label': `${number} ${task.title}`,
  },
  h('div', { className: 'gantt-task-cell', style: { paddingLeft: `${10 + depth * 16}px` } },
    h('div', { className: 'gantt-task-line' },
      hasChildren
        ? h('button', {
          className: 'gantt-chevron',
          type: 'button',
          'aria-label': collapsed ? t('tree.expand') : t('tree.collapse'),
          'aria-expanded': collapsed ? 'false' : 'true',
          onClick: (event) => {
            event.stopPropagation()
            onToggle(task.id)
          },
        }, collapsed ? '▸' : '▾')
        : h('span', { className: 'gantt-chevron gantt-chevron-empty', 'aria-hidden': 'true' }),
      h('span', { className: 'gantt-number', title: task.ref || number }, number),
      h('span', { className: 'gantt-task-title', title: task.title }, task.title),
      h(StatusPill, {
        status: task.status,
        label: t(`status.${task.status}`),
        interactive: !hasChildren,
        title: hasChildren ? t('status.summaryHint') : t('status.cycleHint'),
        onClick: () => onCycleStatus(task),
      }),
      h('div', { className: 'gantt-row-actions' },
        work ? h('button', {
          className: 'gantt-row-action',
          type: 'button',
          'data-action': 'edit',
          title: t('dialog.editTitle'),
          'aria-label': t('dialog.editTitle'),
          onClick: (event) => {
            event.stopPropagation()
            onEdit(task)
          },
        }, '✎') : null,
        isTrack ? null : h('button', {
          className: 'gantt-row-action',
          type: 'button',
          'data-action': 'decompose',
          title: t('tree.decompose'),
          'aria-label': t('tree.decompose'),
          onClick: (event) => {
            event.stopPropagation()
            onDecompose(task)
          },
        }, '⋔'),
        isTrack ? null : h('button', {
          className: 'gantt-row-action',
          type: 'button',
          'data-action': 'schedule',
          title: t('tree.schedule'),
          'aria-label': t('tree.schedule'),
          onClick: (event) => {
            event.stopPropagation()
            onSchedule(task)
          },
        }, '▦'),
        h('button', {
          className: 'gantt-add-child',
          type: 'button',
          title: t('tree.addChild'),
          'aria-label': t('tree.addChild'),
          onClick: (event) => {
            event.stopPropagation()
            onAddChild(task)
          },
        }, '+'),
      ),
    ),
    h(MetaChips, { task, t }),
  ),
  h('div', { className: 'gantt-track', style: { width: `${timeline.totalWidth}px` } },
    h(TaskBar, { task, timeline, onSelect }),
  ),
  )
}

/** Timeline header with group and unit cells. */
export function TimelineHeader({ timeline, t, locale, taskCount }) {
  return h('div', { className: 'gantt-header' },
    h('div', { className: 'gantt-corner' },
      h('span', { className: 'gantt-corner-title' }, t('tree.task')),
      h('span', { className: 'gantt-corner-sub' }, `${taskCount} ${t('stats.tasks')}`),
    ),
    h('div', { className: 'gantt-header-timeline', style: { width: `${timeline.totalWidth}px` } },
      h('div', { className: 'gantt-group-row' },
        timeline.groups.map(group => h('div', {
          key: group.key,
          className: 'gantt-group-cell',
          style: { width: `${group.width}px` },
        }, timeline.scale === 'week'
          ? formatMonthYear(group.startIso, locale)
          : formatYear(group.startIso, locale))),
      ),
      h('div', { className: 'gantt-unit-row' },
        timeline.units.map(unit => h('div', {
          key: unit.key,
          className: 'gantt-unit-cell',
          'data-today': unit.isToday ? 'true' : undefined,
          'data-weekend': unit.isWeekend ? 'true' : undefined,
          style: { width: `${unit.width}px` },
        },
        h('span', { className: 'gantt-unit-main' }, timeline.scale === 'week'
          ? String(Number(unit.startIso.slice(8, 10)))
          : formatMonth(unit.startIso, locale)),
        timeline.scale === 'week'
          ? h('span', { className: 'gantt-unit-sub' }, formatWeekday(unit.startIso, locale))
          : null,
        )),
      ),
    ),
  )
}

/** Background grid lines and the today marker. */
export function GridLines({ timeline }) {
  return h('div', {
    className: 'gantt-grid-lines',
    style: { left: 'var(--gantt-left)', width: `${timeline.totalWidth}px` },
    'aria-hidden': 'true',
  },
  timeline.boundaries.map((line, index) => h('span', {
    key: index,
    className: 'gantt-vline',
    'data-strong': line.strong ? 'true' : undefined,
    style: { left: `${line.x}px` },
  })),
  timeline.todayX !== null
    ? h('span', { className: 'gantt-today-line', style: { left: `${timeline.todayX}px` } })
    : null,
  )
}
