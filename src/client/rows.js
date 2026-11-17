import { useEffect, useRef } from 'react'
import { dragMode, dragRange, dragWeeks } from './bar-drag.js'
import { DAY_MS, STATUS_COLOR } from './constants.js'
import { formatMonth, formatMonthYear, formatWeekday, formatYear, isoToDay } from './dates.js'
import { StatusPill } from './status.js'
import { rowNumber } from './view.js'
import { h } from './dom.js'

/** Pointer travel before a press on a bar turns into a date drag. */
const DRAG_THRESHOLD = 4

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
function TaskBar({ task, timeline, onSelect, drag, onDragPreview, onDragCommit, t }) {
  const gesture = useRef(null)
  const detach = useRef(null)
  const suppressClick = useRef(false)
  useEffect(() => () => {
    if (detach.current !== null) detach.current()
  }, [])
  const editable = !task.hasChildren
  const previewStart = drag === null ? task.startDate : drag.startDate
  const previewEnd = drag === null ? task.endDate : drag.endDate
  const range = barRange({ ...task, startDate: previewStart, endDate: previewEnd }, timeline)
  if (range === null) return null
  const overdue = task.status !== 'done' && task.status !== 'cancelled' && task.endDate < timeline.today
  // The whole bar moves; the two edge zones resize. Window-level listeners keep
  // the gesture alive when the pointer leaves the selected row.
  const beginDrag = (event) => {
    if (!editable || event.button > 0 || gesture.current !== null) return
    suppressClick.current = false
    const mode = dragMode(event.target)
    const active = { mode, startX: event.clientX, startDate: task.startDate, endDate: task.endDate, latest: null }
    gesture.current = active
    const finish = () => {
      if (detach.current !== null) {
        detach.current()
        detach.current = null
      }
      gesture.current = null
    }
    const onMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - active.startX
      if (active.latest === null && Math.abs(deltaX) < DRAG_THRESHOLD) return
      const weeks = dragWeeks(deltaX, timeline.pxPerDay)
      if (weeks === 0) {
        if (active.latest !== null) {
          active.latest = null
          onDragPreview(task, null)
        }
        return
      }
      moveEvent.preventDefault()
      active.latest = dragRange({ mode, startDate: active.startDate, endDate: active.endDate, weeks })
      onDragPreview(task, { mode, ...active.latest })
    }
    const onUp = () => {
      finish()
      if (active.latest === null) {
        onDragPreview(task, null)
        return
      }
      suppressClick.current = true
      onDragCommit(task, active.latest)
    }
    const onCancel = () => {
      finish()
      onDragPreview(task, null)
    }
    const remove = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    detach.current = remove
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }
  return h('button', {
    type: 'button',
    className: 'gantt-bar',
    'data-status': task.status,
    'data-summary': task.hasChildren ? 'true' : undefined,
    'data-overdue': overdue ? 'true' : undefined,
    'data-editable': editable ? 'true' : undefined,
    'data-dragging': drag === null ? undefined : 'true',
    'data-range': drag === null ? undefined : `${drag.startDate} → ${drag.endDate}`,
    style: {
      left: `${range.left}px`,
      width: `${range.width}px`,
      '--st': STATUS_COLOR[task.status] || STATUS_COLOR.todo,
    },
    title: [
      `${rowNumber(task)} ${task.title}`,
      `${previewStart} → ${previewEnd} · ${task.progress}%`,
      editable ? t('bar.dragHint') : null,
    ].filter(Boolean).join('\n'),
    onPointerDown: beginDrag,
    onClick: (event) => {
      event.stopPropagation()
      if (suppressClick.current) {
        suppressClick.current = false
        return
      }
      onSelect(task)
    },
  },
  h('span', { className: 'gantt-bar-fill', style: { width: `${task.progress}%` } }),
  !task.hasChildren && range.width > 58
    ? h('span', { className: 'gantt-bar-label' }, task.title)
    : null,
  editable
    ? h('span', { className: 'gantt-bar-handle', 'data-edge': 'start', 'aria-hidden': 'true' })
    : null,
  editable
    ? h('span', { className: 'gantt-bar-handle', 'data-edge': 'end', 'aria-hidden': 'true' })
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
  activity = null,
  drag = null,
  onDragPreview,
  onDragCommit,
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
    'data-activity': activity ?? undefined,
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
      activity === null
        ? null
        : h('span', {
          className: 'gantt-row-activity',
          'data-state': activity,
          title: activity === 'waiting' ? t('work.waitingHint') : t('work.runningHint'),
          'aria-label': activity === 'waiting' ? t('work.waitingHint') : t('work.runningHint'),
        }, activity === 'waiting' ? '!' : '●'),
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
    h(TaskBar, { task, timeline, onSelect, drag, onDragPreview, onDragCommit, t }),
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
