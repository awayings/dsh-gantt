import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STATUS_COLOR } from '../constants.js'
import { addDays, addMonths, todayIso } from '../dates.js'
import { ApiDialog } from '../dialogs/api.js'
import { CaptureDialog } from '../dialogs/capture.js'
import { ContextDialog } from '../dialogs/context.js'
import { DecomposeDialog } from '../dialogs/decompose.js'
import { ScheduleDialog } from '../dialogs/schedule.js'
import { SplitDialog } from '../dialogs/split.js'
import { TaskDialog } from '../dialogs/task.js'
import { requestJson, useGanttData, useLocale } from '../hooks.js'
import { GanttGlyph, InfoGlyph } from '../icons.js'
import { PRESET_LABELS, presetLabel, tagLabel } from '../label-filter.js'
import { readPageState, writePageState } from '../page-state.js'
import { GanttRow, GridLines, TimelineHeader } from '../rows.js'
import { CSS } from '../styles/index.js'
import { buildWindow, windowTitle } from '../timeline.js'
import { collapseForLevel, collectSubtree, filterTree, flattenTree, taskOptions, visibleRows } from '../view.js'
import { activeSessionId, canExecuteWorkTask, noteWorkFocus } from '../work-nav.js'
import { taskActivity, useSessionStatuses } from '../session-status.js'
import { GanttWorkbench } from './workbench.js'
import { h } from '../dom.js'

/** Debounce for persisting the pane scroll offsets while a gesture is running. */
const SCROLL_WRITE_DELAY = 150

/** The Gantt tree page: perspective filter, recompute action and timeline. */
export function GanttPage({ ctx }) {
  const { locale, t } = useLocale(ctx)
  const { status, data, error, refresh } = useGanttData()
  const workAvailable = canExecuteWorkTask(ctx)
  // The view left by the previous visit, read once per mount; the page-state
  // module already normalized it, so every field is in range here.
  const [saved] = useState(readPageState)
  const [workMode, setWorkMode] = useState(() => saved?.workMode ?? false)
  const workOn = workMode && workAvailable
  // Work mode is what makes a panel task meaningful, so a panel recorded while
  // the switch was off is not restored.
  const [panelTaskId, setPanelTaskId] = useState(() => (saved?.workMode ? saved.panelTaskId ?? null : null))
  const [panelTab, setPanelTab] = useState(() => saved?.panelTab ?? 'task')
  const [scale, setScale] = useState(() => saved?.scale ?? 'week')
  const [anchor, setAnchor] = useState(() => saved?.anchor ?? todayIso())
  const [collapsed, setCollapsed] = useState(() => new Set(saved?.collapsed ?? []))
  const [level, setLevel] = useState(() => saved?.level ?? 99)
  // The one filter selection: encoded preset and tag labels, emptied by "All".
  const [labels, setLabels] = useState(() => new Set(saved?.labels ?? []))
  const [recomputing, setRecomputing] = useState(false)
  const [selectedId, setSelectedId] = useState(() => saved?.selectedId ?? null)
  const [focusId, setFocusId] = useState(null)
  // Set while a pointer gesture is dragging a task bar: the preview dates and
  // the gesture mode, keyed by task so only that row repaints the moved bar.
  const [barDrag, setBarDrag] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const statuses = useSessionStatuses(ctx)
  const initialized = useRef(false)
  const pageRef = useRef(null)
  // The pane is the only scroll container on the page; keeping its offsets in a
  // ref lets a scroll gesture write storage once per debounce window instead of
  // on every frame.
  const paneRef = useRef(null)
  const scrollRef = useRef({ top: saved?.scrollTop ?? 0, left: saved?.scrollLeft ?? 0 })
  const scrollTimer = useRef(null)
  const restored = useRef(false)
  // The whole persisted view lives in one ref so the debounced scroll write and
  // every state-driven write persist the same complete record.
  const viewRef = useRef({
    level, labels, collapsed, scale, anchor, selectedId, panelTaskId, panelTab, workMode,
  })
  const writePageStateNow = useCallback(() => {
    const view = viewRef.current
    const { top, left } = scrollRef.current
    writePageState({
      level: view.level,
      labels: [...view.labels],
      collapsed: [...view.collapsed],
      scrollTop: top,
      scrollLeft: left,
      scale: view.scale,
      anchor: view.anchor,
      selectedId: view.selectedId,
      panelTaskId: view.panelTaskId,
      panelTab: view.panelTab,
      workMode: view.workMode,
    })
  }, [])
  useEffect(() => {
    viewRef.current = {
      level, labels, collapsed, scale, anchor, selectedId, panelTaskId, panelTab, workMode,
    }
    writePageStateNow()
  }, [
    level, labels, collapsed, scale, anchor, selectedId, panelTaskId, panelTab, workMode,
    writePageStateNow,
  ])
  // A hide or an entry swap never waits for a debounce timer, so the latest
  // offsets are flushed synchronously instead of being lost.
  useEffect(() => {
    const flush = () => {
      if (scrollTimer.current !== null) {
        clearTimeout(scrollTimer.current)
        scrollTimer.current = null
      }
      writePageStateNow()
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [writePageStateNow])
  useEffect(() => {
    if (!data || initialized.current) return
    initialized.current = true
    // A saved anchor is the window the user left; only a first visit starts on
    // the task day. Restoring a saved view is a pure view update.
    if (!saved?.anchor) setAnchor(data.today || todayIso())
  }, [data, saved])
  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    if (!infoOpen) return undefined
    const onPointerDown = (event) => {
      if (event.target instanceof Element && event.target.closest('.gantt-info-wrap')) return
      setInfoOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setInfoOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [infoOpen])
  useEffect(() => {
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])
  const tasks = data?.tasks ?? []
  const stats = data?.stats ?? { total: 0, done: 0, inProgress: 0, blocked: 0, overdue: 0, progress: 0 }
  const today = data?.today ?? todayIso()
  const dailyBrief = data?.dailyBrief ?? null
  const allTasks = useMemo(() => flattenTree(tasks), [tasks])
  const byId = useMemo(() => new Map(allTasks.map(task => [task.id, task])), [allTasks])
  // The tag filter row and the dialog suggestions read the same index; tree
  // order keeps both stable between renders and refreshes.
  const tagIdsByName = useMemo(() => {
    const ids = new Map()
    for (const task of allTasks) {
      for (const tag of Array.isArray(task.tags) ? task.tags : []) {
        if (!ids.has(tag)) ids.set(tag, new Set())
        ids.get(tag).add(task.id)
      }
    }
    return ids
  }, [allTasks])
  /** @type {[string, number][]} */
  const tagStats = useMemo(() => [...tagIdsByName].map(([tag, ids]) => [tag, ids.size]), [tagIdsByName])
  const allTags = useMemo(() => [...tagIdsByName.keys()], [tagIdsByName])
  const options = useMemo(() => taskOptions(tasks), [tasks])
  const frontierIds = useMemo(() => {
    const ids = new Set()
    for (const lane of data?.brief?.lanes ?? []) {
      if (lane?.frontier) ids.add(lane.frontier.id)
    }
    return ids
  }, [data?.brief])
  const nextIds = useMemo(() => {
    const ids = new Set()
    for (const lane of data?.brief?.lanes ?? []) {
      if (lane?.next) ids.add(lane.next.id)
    }
    return ids
  }, [data?.brief])
  const todayIds = useMemo(() => new Set((dailyBrief?.items ?? []).map(item => item.taskId)), [dailyBrief])
  const doneIds = useMemo(
    () => new Set(allTasks.filter(task => task.status === 'done').map(task => task.id)),
    [allTasks],
  )
  const unfinishedIds = useMemo(
    () => new Set(allTasks.filter(task => task.status !== 'done' && task.status !== 'cancelled').map(task => task.id)),
    [allTasks],
  )
  // The inspiration pool: every node whose source-of-idea field is filled,
  // whatever branch it lives in.
  const inspirationIds = useMemo(
    () => new Set(allTasks.filter(task => task.inspiration).map(task => task.id)),
    [allTasks],
  )
  const activityByTask = useMemo(() => {
    const activities = new Map()
    for (const task of allTasks) {
      const activity = taskActivity(statuses, task)
      if (activity !== null) activities.set(task.id, activity)
    }
    return activities
  }, [allTasks, statuses])
  // Every label expands to the task ids it covers: a predefined one to its
  // status/perspective set, an artificial one to the tasks that carry the tag.
  // The selected labels are OR-ed (a union), and no selection means no filter.
  const presetIds = useMemo(() => ({
    unfinished: unfinishedIds,
    active: new Set(activityByTask.keys()),
    frontier: frontierIds,
    next: nextIds,
    today: todayIds,
    done: doneIds,
    inspiration: inspirationIds,
  }), [unfinishedIds, activityByTask, frontierIds, nextIds, todayIds, doneIds, inspirationIds])
  const effectiveIds = useMemo(() => {
    if (labels.size === 0) return null
    const ids = new Set()
    for (const preset of PRESET_LABELS) {
      if (!labels.has(presetLabel(preset))) continue
      for (const id of presetIds[preset]) ids.add(id)
    }
    for (const [tag, tagIds] of tagIdsByName) {
      if (!labels.has(tagLabel(tag))) continue
      for (const id of tagIds) ids.add(id)
    }
    return ids
  }, [labels, presetIds, tagIdsByName])
  const filterCount = effectiveIds === null ? 0 : [...effectiveIds].filter(id => byId.has(id)).length
  const filteredTasks = useMemo(
    () => (effectiveIds === null ? tasks : filterTree(tasks, effectiveIds)),
    [tasks, effectiveIds],
  )
  const visibleTaskCount = useMemo(() => flattenTree(filteredTasks).length, [filteredTasks])
  const rows = useMemo(() => visibleRows(filteredTasks, collapsed), [filteredTasks, collapsed])
  // Restore the saved pane offsets one time only, and only once the pane has
  // rows: a loading or filtered-empty view has no pane to move, so wait for one
  // instead of spending the one-shot restore on an empty view.
  useEffect(() => {
    if (restored.current || saved === null || rows.length === 0) return
    const el = paneRef.current
    if (!el) return
    restored.current = true
    el.scrollTop = saved.scrollTop
    el.scrollLeft = saved.scrollLeft
  }, [saved, rows])
  const timeline = useMemo(() => {
    const value = buildWindow(scale, anchor, today)
    return { ...value, today }
  }, [scale, anchor, today])
  useEffect(() => {
    if (!focusId || !pageRef.current) return
    const rowElement = pageRef.current.querySelector(`.gantt-row[data-task-id="${focusId}"]`)
    if (rowElement && typeof rowElement.scrollIntoView === 'function') {
      rowElement.scrollIntoView({ block: 'nearest' })
    }
  }, [focusId, rows])
  useEffect(() => {
    if (status === 'ready' && selectedId && !byId.has(selectedId)) setSelectedId(null)
  }, [status, selectedId, byId])
  useEffect(() => {
    if (status === 'ready' && panelTaskId !== null && !byId.has(panelTaskId)) setPanelTaskId(null)
  }, [status, panelTaskId, byId])
  useEffect(() => {
    if (!dialog) return
    if ((dialog.type === 'edit' || dialog.type === 'split' || dialog.type === 'decompose' || dialog.type === 'schedule')
      && dialog.id && !byId.has(dialog.id)) {
      setDialog(null)
    }
  }, [dialog, byId])
  const refreshWithToast = useCallback((message, errorMessage = undefined) => {
    refresh()
    setToast({ text: message, kind: errorMessage ? 'error' : 'ok' })
  }, [refresh])
  const handleSaved = useCallback((message, id) => {
    setDialog(null)
    if (id) setSelectedId(id)
    refresh()
    setToast({ text: message, kind: 'ok' })
  }, [refresh])
  // A bar gesture previews locally and only writes once the pointer is released,
  // so a slow round trip never moves the bar twice.
  const previewBarDrag = useCallback((task, preview) => {
    setBarDrag(preview === null ? null : {
      taskId: task.id,
      mode: preview.mode,
      startDate: preview.startDate,
      endDate: preview.endDate,
    })
  }, [])
  const commitBarDrag = useCallback(async (task, range) => {
    setBarDrag(null)
    // A clamp can land the bar back on its current range; that is not a write.
    if (range.startDate === task.startDate && range.endDate === task.endDate) return
    try {
      await requestJson('api/gantt/task/update', {
        method: 'POST',
        body: JSON.stringify({ id: task.id, startDate: range.startDate, endDate: range.endDate }),
      })
      refreshWithToast(t('notice.datesUpdated'))
    } catch (failure) {
      refreshWithToast(failure instanceof Error ? failure.message : String(failure), true)
    }
  }, [refreshWithToast, t])
  const cycleStatus = useCallback(async (task) => {
    const base = task.status === 'blocked' || task.status === 'cancelled' ? 'todo' : task.status
    const next = base === 'todo' ? 'in_progress' : base === 'in_progress' ? 'done' : 'todo'
    try {
      await requestJson('api/gantt/task/status', {
        method: 'POST',
        body: JSON.stringify({ id: task.id, status: next }),
      })
      refreshWithToast(t('notice.statusUpdated'))
    } catch (failure) {
      refreshWithToast(failure instanceof Error ? failure.message : String(failure), true)
    }
  }, [refreshWithToast, t])
  const seed = useCallback(async () => {
    try {
      await requestJson('api/gantt/seed', { method: 'POST', body: '{}' })
      refreshWithToast(t('notice.seeded'))
    } catch (failure) {
      refreshWithToast(failure instanceof Error ? failure.message : String(failure), true)
    }
  }, [refreshWithToast, t])
  const recomputeBrief = useCallback(async () => {
    setRecomputing(true)
    try {
      await requestJson('api/gantt/brief/compute', {
        method: 'POST',
        body: JSON.stringify({ date: today }),
      })
      refreshWithToast(t('filter.recomputeDone'))
    } catch (failure) {
      setToast({ text: failure instanceof Error ? failure.message : String(failure), kind: 'error' })
    } finally {
      setRecomputing(false)
    }
  }, [refreshWithToast, today, t])
  const toggleCollapse = useCallback((id) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const handlePaneScroll = useCallback(() => {
    const el = paneRef.current
    if (!el) return
    scrollRef.current = { top: el.scrollTop, left: el.scrollLeft }
    if (scrollTimer.current !== null) clearTimeout(scrollTimer.current)
    scrollTimer.current = setTimeout(() => {
      scrollTimer.current = null
      writePageStateNow()
    }, SCROLL_WRITE_DELAY)
  }, [writePageStateNow])
  const changeLevel = useCallback((next) => {
    setLevel(next)
    setCollapsed(collapseForLevel(tasks, next))
  }, [tasks])
  // Picking any label means the matching branches are the view, so the tree
  // expands; clearing the selection gives the current depth its folds back.
  const applyLabels = useCallback((next) => {
    setLabels(next)
    setCollapsed(next.size === 0 ? collapseForLevel(tasks, level) : new Set())
  }, [tasks, level])
  const toggleLabel = useCallback((label) => {
    const next = new Set(labels)
    if (next.has(label)) next.delete(label)
    else next.add(label)
    applyLabels(next)
  }, [labels, applyLabels])
  const clearLabels = useCallback(() => applyLabels(new Set()), [applyLabels])
  const openCreate = useCallback((parentTask) => {
    setDialog({ type: 'create', parentId: parentTask?.id ?? null })
  }, [])
  // Capture parks an unshaped idea: it opens the light dialog instead of the
  // full create form, and the selected row (if any) becomes the default parent.
  const openCapture = useCallback(() => {
    setDialog({ type: 'capture' })
  }, [])
  const openEdit = useCallback((task) => {
    setSelectedId(task.id)
    setDialog({ type: 'edit', id: task.id })
  }, [])
  const openDecompose = useCallback((task) => {
    setSelectedId(task.id)
    setDialog({ type: 'decompose', id: task.id })
  }, [])
  const openSchedule = useCallback((task) => {
    setSelectedId(task.id)
    setDialog({ type: 'schedule', id: task.id })
  }, [])
  const toggleWorkMode = useCallback(() => {
    const next = !workMode
    setWorkMode(next)
    if (!next) setPanelTaskId(null)
  }, [workMode])
  // Work-mode activation stays on the Gantt page: the task opens in the
  // in-page panel and the conversation on screen just follows its focus.
  const openWork = useCallback((task) => {
    setSelectedId(task.id)
    setFocusId(task.id)
    setPanelTaskId(task.id)
    const sessionId = activeSessionId(ctx)
    if (sessionId === null) return
    requestJson('api/gantt/focus/set', {
      method: 'POST',
      body: JSON.stringify({ sessionId, taskId: task.id }),
    }).then(() => noteWorkFocus(), (failure) => {
      const message = failure instanceof Error ? failure.message : String(failure)
      setToast({ text: `${t('work.error')} ${message}`, kind: 'error' })
    })
  }, [ctx, t])
  const shift = useCallback((direction) => {
    setAnchor(current => (scale === 'week'
      ? addDays(current, direction * 14)
      : addMonths(current, direction * 3)))
  }, [scale])
  const goToday = useCallback(() => setAnchor(today), [today])
  const shell = children => h('div', { className: 'gantt-page', ref: pageRef },
    h('style', { key: 'gantt-css' }, CSS),
    children,
  )
  if (status === 'loading' && data === null) {
    return shell(h('div', { className: 'gantt-center' },
      h('span', { className: 'gantt-spinner' }),
      h('span', null, t('loading')),
    ))
  }
  if (status === 'error' && data === null) {
    return shell(h('div', { className: 'gantt-center' },
      h('div', { className: 'gantt-empty-title' }, t('error.title')),
      h('div', { className: 'gantt-empty-body' }, error),
      h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', onClick: refresh }, t('error.retry')),
    ))
  }
  const dialogTask = dialog && dialog.id ? byId.get(dialog.id) : null
  const parentExcluded = dialogTask ? collectSubtree(dialogTask) : null
  const parentChoices = parentExcluded
    ? options.filter(option => !parentExcluded.has(option.id))
    : options
  let dialogNode = null
  if (dialog?.type === 'create') {
    dialogNode = h(TaskDialog, {
      key: 'create',
      mode: 'create',
      parentTask: dialog.parentId ? byId.get(dialog.parentId) : null,
      parentOptions: options,
      allTags,
      today,
      t,
      onClose: () => setDialog(null),
      onSaved: handleSaved,
    })
  } else if (dialog?.type === 'capture') {
    dialogNode = h(CaptureDialog, {
      key: 'capture',
      parentOptions: options,
      defaultParent: selectedId ?? '',
      t,
      onClose: () => setDialog(null),
      onSaved: handleSaved,
    })
  } else if (dialog?.type === 'edit' && dialogTask) {
    dialogNode = h(TaskDialog, {
      key: dialogTask.id,
      mode: 'edit',
      task: dialogTask,
      parentOptions: parentChoices,
      allTags,
      t,
      onClose: () => setDialog(null),
      onSaved: handleSaved,
      onSplit: task => setDialog({ type: 'split', id: task.id }),
    })
  } else if (dialog?.type === 'split' && dialogTask) {
    dialogNode = h(SplitDialog, {
      key: `split-${dialogTask.id}`,
      task: dialogTask,
      t,
      onClose: () => setDialog(null),
      onSaved: handleSaved,
    })
  } else if (dialog?.type === 'decompose' && dialogTask) {
    dialogNode = h(DecomposeDialog, {
      key: `decompose-${dialogTask.id}`,
      task: dialogTask,
      t,
      onClose: () => setDialog(null),
      onSaved: handleSaved,
    })
  } else if (dialog?.type === 'schedule' && dialogTask) {
    dialogNode = h(ScheduleDialog, {
      key: `schedule-${dialogTask.id}`,
      task: dialogTask,
      t,
      onClose: () => setDialog(null),
      onSaved: handleSaved,
    })
  } else if (dialog?.type === 'context') {
    dialogNode = h(ContextDialog, {
      key: 'context',
      t,
      onClose: () => setDialog(null),
    })
  } else if (dialog?.type === 'api') {
    dialogNode = h(ApiDialog, {
      key: 'api',
      t,
      locale,
      onClose: () => setDialog(null),
    })
  }
  const panelId = workOn && panelTaskId !== null && byId.has(panelTaskId) ? panelTaskId : null
  const content = tasks.length === 0
    ? h('div', { className: 'gantt-empty-wrap' },
      h('div', { className: 'gantt-empty' },
        h('span', { className: 'gantt-empty-icon' }, h(GanttGlyph, { size: 26 })),
        h('div', { className: 'gantt-empty-title' }, t('empty.title')),
        h('div', { className: 'gantt-empty-body' }, t('empty.body')),
        h('div', { className: 'gantt-empty-actions' },
          h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', onClick: () => openCreate(null) }, t('empty.new')),
          h('button', { className: 'gantt-btn', type: 'button', onClick: seed }, t('empty.seed')),
        ),
      ),
    )
    : filteredTasks.length === 0
      ? h('div', { className: 'gantt-filter-empty' },
        h('div', { className: 'gantt-empty-title' }, t('filter.empty.label')),
        h('p', { className: 'gantt-hint' }, t('filter.hint.label')),
      )
      : h('div', { className: 'gantt-body', 'data-panel': panelId === null ? undefined : 'work' },
        h('div', { className: 'gantt-main', ref: paneRef, onScroll: handlePaneScroll },
          h('div', {
            className: 'gantt-grid',
            style: { width: `calc(var(--gantt-left) + ${timeline.totalWidth}px)` },
          },
          h(TimelineHeader, { timeline, t, locale, taskCount: visibleTaskCount }),
          h('div', { className: 'gantt-rows' },
            h(GridLines, { timeline }),
            rows.map(({ task, depth }) => h(GanttRow, {
              key: task.id,
              task,
              depth,
              timeline,
              selected: task.id === selectedId,
              collapsed: collapsed.has(task.id),
              t,
              work: workOn,
              activity: activityByTask.get(task.id) ?? null,
              onSelect: workOn ? openWork : openEdit,
              onEdit: openEdit,
              onToggle: toggleCollapse,
              onAddChild: openCreate,
              onCycleStatus: cycleStatus,
              onDecompose: openDecompose,
              onSchedule: openSchedule,
              drag: barDrag !== null && barDrag.taskId === task.id ? barDrag : null,
              onDragPreview: previewBarDrag,
              onDragCommit: commitBarDrag,
            })),
          ),
          ),
        ),
        panelId === null
          ? null
          : h('aside', { className: 'gantt-task-panel', 'data-panel': 'work-task' },
            h(GanttWorkbench, {
              ctx,
              taskId: panelId,
              scope: { sessionId: activeSessionId(ctx) ?? '' },
              tab: panelTab,
              onTabChange: setPanelTab,
              onClose: () => setPanelTaskId(null),
            }),
          ),
      )
  return shell(h(React.Fragment, null,
    h('header', { className: 'gantt-head' },
      h('div', { className: 'gantt-brand' },
        h('span', { className: 'gantt-brand-mark' }, h(GanttGlyph, { size: 22 })),
        h('div', { className: 'gantt-brand-text' },
          h('div', { className: 'gantt-title-row' },
            h('h1', { className: 'gantt-title' }, t('page.title')),
            h('span', { className: 'gantt-info-wrap' },
              h('button', {
                className: 'gantt-info-btn',
                type: 'button',
                title: t('page.info'),
                'aria-label': t('page.info'),
                'aria-expanded': infoOpen,
                'aria-controls': 'gantt-info-pop',
                'data-active': infoOpen ? 'true' : undefined,
                onClick: () => setInfoOpen(current => !current),
              }, h(InfoGlyph)),
              infoOpen
                ? h('div', { id: 'gantt-info-pop', className: 'gantt-info-pop', role: 'tooltip' }, t('page.subtitle'))
                : null,
            ),
          ),
        ),
      ),
      h('div', { className: 'gantt-actions' },
        h('button', {
          className: 'gantt-btn',
          type: 'button',
          'data-action': 'work-mode',
          'data-active': workOn ? 'true' : undefined,
          'aria-pressed': workOn ? 'true' : 'false',
          disabled: !workAvailable,
          title: t('actions.workModeHint'),
          onClick: toggleWorkMode,
        }, t('actions.workMode')),
        h('div', { className: 'gantt-seg', role: 'group', 'aria-label': t('scale.label') },
          h('button', {
            className: 'gantt-seg-btn',
            type: 'button',
            'data-active': scale === 'week' ? 'true' : undefined,
            onClick: () => setScale('week'),
          }, t('scale.week')),
          h('button', {
            className: 'gantt-seg-btn',
            type: 'button',
            'data-active': scale === 'month' ? 'true' : undefined,
            onClick: () => setScale('month'),
          }, t('scale.month')),
        ),
        h('div', { className: 'gantt-seg', role: 'group', 'aria-label': t('level.label') },
          [['all', 99], ['two', 2], ['one', 1]].map(([key, depth]) => h('button', {
            key,
            className: 'gantt-seg-btn',
            type: 'button',
            'data-level': depth,
            'data-active': level === depth ? 'true' : undefined,
            onClick: () => changeLevel(depth),
          }, t(`level.${key}`))),
        ),
        h('button', { className: 'gantt-btn gantt-icon-btn', type: 'button', title: t('actions.prev'), 'aria-label': t('actions.prev'), onClick: () => shift(-1) }, '‹'),
        h('button', { className: 'gantt-btn', type: 'button', onClick: goToday }, t('actions.today')),
        h('button', { className: 'gantt-btn gantt-icon-btn', type: 'button', title: t('actions.next'), 'aria-label': t('actions.next'), onClick: () => shift(1) }, '›'),
        h('button', { className: 'gantt-btn', type: 'button', onClick: () => setDialog({ type: 'context' }) }, t('actions.context')),
        h('button', { className: 'gantt-btn', type: 'button', onClick: () => setDialog({ type: 'api' }) }, t('actions.api')),
        h('button', {
          className: 'gantt-btn gantt-icon-btn',
          type: 'button',
          title: t('actions.refresh'),
          'aria-label': t('actions.refresh'),
          disabled: status === 'refreshing',
          onClick: refresh,
        }, status === 'refreshing' ? '…' : '⟳'),
        h('button', {
          className: 'gantt-btn',
          type: 'button',
          'data-action': 'capture',
          title: t('capture.title'),
          onClick: openCapture,
        }, t('actions.capture')),
        h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', onClick: () => openCreate(null) }, `+ ${t('actions.new')}`),
      ),
    ),
    h('section', { className: 'gantt-stats' },
      h('div', { className: 'gantt-window' },
        h('span', { className: 'gantt-window-scale' }, scale === 'week' ? t('scale.weekShort') : t('scale.monthShort')),
        h('span', { className: 'gantt-window-label' }, windowTitle(timeline, locale)),
      ),
      h('div', { className: 'gantt-stat' },
        h('span', { className: 'gantt-dot', style: { '--st': 'var(--dsw-alias-label-secondary)' } }),
        t('stats.total'), h('b', null, stats.total),
      ),
      h('div', { className: 'gantt-stat' },
        h('span', { className: 'gantt-dot', style: { '--st': STATUS_COLOR.in_progress } }),
        t('stats.inProgress'), h('b', null, stats.inProgress),
      ),
      h('div', { className: 'gantt-stat' },
        h('span', { className: 'gantt-dot', style: { '--st': STATUS_COLOR.done } }),
        t('stats.done'), h('b', null, stats.done),
      ),
      h('div', { className: 'gantt-stat' },
        h('span', { className: 'gantt-dot', style: { '--st': STATUS_COLOR.blocked } }),
        t('stats.overdue'), h('b', null, stats.overdue),
      ),
      stats.cancelled > 0
        ? h('div', { className: 'gantt-stat' },
          h('span', { className: 'gantt-dot', style: { '--st': STATUS_COLOR.cancelled } }),
          t('stats.cancelled'), h('b', null, stats.cancelled),
        )
        : null,
      h('div', { className: 'gantt-stat-progress' },
        h('span', null, `${t('stats.progress')} ${stats.progress}%`),
        h('div', { className: 'gantt-progress' }, h('span', { style: { width: `${stats.progress}%` } })),
      ),
    ),
    error && data ? h('div', { className: 'gantt-banner' },
      h('span', null, error),
      h('button', { className: 'gantt-btn', type: 'button', onClick: refresh }, t('error.retry')),
    ) : null,
    tasks.length > 0
      ? h('section', { className: 'gantt-filter gantt-tag-filter' },
        h('span', { className: 'gantt-filter-label' }, t('filter.label')),
        h('div', { className: 'gantt-tag-options', role: 'group', 'aria-label': t('filter.label') },
          h('button', {
            className: 'gantt-tag-option gantt-tag-all',
            type: 'button',
            title: t('filter.presetHint'),
            'data-label': 'all',
            'data-kind': 'preset',
            'data-active': labels.size === 0 ? 'true' : undefined,
            'aria-pressed': labels.size === 0 ? 'true' : 'false',
            onClick: clearLabels,
          }, t('filter.all')),
          PRESET_LABELS.map(preset => h('button', {
            key: preset,
            className: 'gantt-tag-option',
            type: 'button',
            title: t('filter.presetHint'),
            'data-label': presetLabel(preset),
            'data-kind': 'preset',
            'data-active': labels.has(presetLabel(preset)) ? 'true' : undefined,
            'aria-pressed': labels.has(presetLabel(preset)) ? 'true' : 'false',
            onClick: () => toggleLabel(presetLabel(preset)),
          }, `${t(`filter.${preset}`)} (${[...presetIds[preset]].filter(id => byId.has(id)).length})`)),
          tagStats.map(([tag, count]) => h('button', {
            key: `tag:${tag}`,
            className: 'gantt-tag-option',
            type: 'button',
            'data-label': tagLabel(tag),
            'data-kind': 'tag',
            'data-active': labels.has(tagLabel(tag)) ? 'true' : undefined,
            'aria-pressed': labels.has(tagLabel(tag)) ? 'true' : 'false',
            onClick: () => toggleLabel(tagLabel(tag)),
          }, `#${tag} (${count})`)),
        ),
        filterCount > 0
          ? h('span', { className: 'gantt-filter-count' }, `${filterCount} ${t('filter.paths')}`)
          : null,
        labels.size > 0
          ? h('button', {
            className: 'gantt-btn gantt-tag-clear',
            type: 'button',
            'data-action': 'clear-tags',
            onClick: clearLabels,
          }, t('filter.tagsClear'))
          : null,
        h('button', {
          className: 'gantt-btn gantt-filter-recompute',
          type: 'button',
          'data-action': 'recompute-brief',
          disabled: recomputing,
          onClick: recomputeBrief,
        }, recomputing ? '…' : t('filter.recompute')),
      )
      : null,
    content,
    dialogNode,
    toast ? h('div', {
      className: 'gantt-toast',
      'data-error': toast.kind === 'error' ? 'true' : undefined,
      role: 'status',
    }, toast.text) : null,
  ))
}
