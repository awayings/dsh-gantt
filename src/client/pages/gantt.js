import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BriefStrip } from '../brief.js'
import { ChatPanel } from '../chat.js'
import { STATUS_COLOR } from '../constants.js'
import { addDays, addMonths, todayIso } from '../dates.js'
import { ApiDialog } from '../dialogs/api.js'
import { ContextDialog } from '../dialogs/context.js'
import { DecomposeDialog } from '../dialogs/decompose.js'
import { ScheduleDialog } from '../dialogs/schedule.js'
import { SplitDialog } from '../dialogs/split.js'
import { TaskDialog } from '../dialogs/task.js'
import { requestJson, useGanttData, useLocale } from '../hooks.js'
import { GanttGlyph, InfoGlyph } from '../icons.js'
import { GanttRow, GridLines, TimelineHeader } from '../rows.js'
import { CSS } from '../styles/index.js'
import { buildWindow, windowTitle } from '../timeline.js'
import { collapseForLevel, collectSubtree, filterTree, flattenTree, rowNumber, taskOptions, taskPath, visibleRows } from '../view.js'
import { h } from '../dom.js'

/** The Gantt tree page: brief strip, filter, timeline and AI sidebar. */
export function GanttPage({ ctx }) {
  const { locale, t } = useLocale(ctx)
  const { status, data, error, refresh } = useGanttData()
  const [scale, setScale] = useState('week')
  const [anchor, setAnchor] = useState(() => todayIso())
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [level, setLevel] = useState(99)
  const [filter, setFilter] = useState('all')
  const [recomputing, setRecomputing] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [focusId, setFocusId] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatFocusId, setChatFocusId] = useState(null)
  const [messages, setMessages] = useState(/** @type {any[]} */ ([]))
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState(null)
  const [appliedProposalKey, setAppliedProposalKey] = useState(null)
  const initialized = useRef(false)
  const pageRef = useRef(null)
  useEffect(() => {
    if (data && !initialized.current) {
      initialized.current = true
      setAnchor(data.today || todayIso())
    }
  }, [data])
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
  const options = useMemo(() => taskOptions(tasks), [tasks])
  const chatFocusTask = chatFocusId ? byId.get(chatFocusId) ?? null : null
  const chatFocusDepth = chatFocusTask ? rowNumber(chatFocusTask).split('.').length : 0
  const focusIds = useMemo(() => {
    const ids = new Set()
    for (const lane of data?.brief?.lanes ?? []) {
      if (lane?.frontier) ids.add(lane.frontier.id)
      if (lane?.next) ids.add(lane.next.id)
    }
    for (const item of dailyBrief?.items ?? []) ids.add(item.taskId)
    return ids
  }, [data?.brief, dailyBrief])
  const doneIds = useMemo(
    () => new Set(allTasks.filter(task => task.status === 'done').map(task => task.id)),
    [allTasks],
  )
  const filterIds = useMemo(() => {
    if (filter === 'todo') return focusIds
    if (filter === 'done') return doneIds
    return null
  }, [filter, focusIds, doneIds])
  const filterCount = filterIds === null ? 0 : [...filterIds].filter(id => byId.has(id)).length
  const filteredTasks = useMemo(
    () => (filterIds === null ? tasks : filterTree(tasks, filterIds)),
    [tasks, filterIds],
  )
  const visibleTaskCount = useMemo(() => flattenTree(filteredTasks).length, [filteredTasks])
  const rows = useMemo(() => visibleRows(filteredTasks, collapsed), [filteredTasks, collapsed])
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
  const cycleStatus = useCallback(async (task) => {
    const base = task.status === 'blocked' ? 'todo' : task.status
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
      refresh()
    } catch (failure) {
      setToast({ text: failure instanceof Error ? failure.message : String(failure), kind: 'error' })
    } finally {
      setRecomputing(false)
    }
  }, [refresh, today])
  const toggleCollapse = useCallback((id) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const changeLevel = useCallback((next) => {
    setLevel(next)
    setCollapsed(collapseForLevel(tasks, next))
  }, [tasks])
  const changeFilter = useCallback((next) => {
    setFilter(next)
    setCollapsed(next === 'all' ? collapseForLevel(tasks, level) : new Set())
  }, [tasks, level])
  const revealTask = useCallback((id) => {
    const path = taskPath(tasks, id)
    if (path === null) return
    setCollapsed((current) => {
      const next = new Set(current)
      for (const ancestor of path.slice(0, -1)) next.delete(ancestor.id)
      return next
    })
    setSelectedId(id)
    setFocusId(id)
  }, [tasks])
  const openChatFor = useCallback((task) => {
    revealTask(task.id)
    setChatFocusId(task.id)
    setChatOpen(true)
  }, [revealTask])
  const openCreate = useCallback((parentTask) => {
    setDialog({ type: 'create', parentId: parentTask?.id ?? null })
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
  const sendChat = useCallback(async (message) => {
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }))
    const body = chatFocusId ? { message, history, taskId: chatFocusId } : { message, history }
    setChatBusy(true)
    setChatError(null)
    setMessages(current => [...current, { role: 'user', content: message }])
    try {
      const payload = await requestJson('api/gantt/chat', { method: 'POST', body: JSON.stringify(body) })
      const reply = typeof payload.reply === 'string' ? payload.reply : ''
      const proposal = payload.proposal ?? null
      if (reply === '' && proposal === null) {
        setChatError(t('chat.error'))
        return
      }
      setMessages(current => [...current, { role: 'assistant', content: reply, proposal }])
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : String(failure)
      setChatError(failure.status === 503 ? `${t('chat.noModel')} ${detail}` : `${t('chat.error')} ${detail}`)
    } finally {
      setChatBusy(false)
    }
  }, [messages, chatFocusId, t])
  const applyChatProposal = useCallback(async (message, index) => {
    const proposal = message.proposal
    const body = proposal.planDate
      ? { id: chatFocusId, planDate: proposal.planDate, children: proposal.children }
      : { id: chatFocusId, children: proposal.children }
    setChatBusy(true)
    setChatError(null)
    try {
      await requestJson('api/gantt/task/decompose', { method: 'POST', body: JSON.stringify(body) })
      setAppliedProposalKey(index)
      refresh()
      setToast({ text: t('chat.applied'), kind: 'ok' })
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : String(failure)
      setChatError(`${t('chat.error')} ${detail}`)
    } finally {
      setChatBusy(false)
    }
  }, [chatFocusId, refresh, t])
  const clearChat = useCallback(() => {
    setMessages([])
    setChatError(null)
    setAppliedProposalKey(null)
  }, [])
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
        h('div', { className: 'gantt-empty-title' }, t(`filter.empty.${filter}`)),
        h('p', { className: 'gantt-hint' }, t(`filter.hint.${filter}`)),
      )
      : h('div', { className: 'gantt-body' },
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
            onSelect: openEdit,
            onToggle: toggleCollapse,
            onAddChild: openCreate,
            onCycleStatus: cycleStatus,
            onDecompose: openDecompose,
            onSchedule: openSchedule,
            onAiDecompose: openChatFor,
          })),
        ),
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
        h('button', {
          className: 'gantt-btn',
          type: 'button',
          'data-action': 'chat-toggle',
          'data-active': chatOpen ? 'true' : undefined,
          onClick: () => setChatOpen(current => !current),
        }, t('actions.ai')),
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
      h('div', { className: 'gantt-stat-progress' },
        h('span', null, `${t('stats.progress')} ${stats.progress}%`),
        h('div', { className: 'gantt-progress' }, h('span', { style: { width: `${stats.progress}%` } })),
      ),
    ),
    h('div', { className: 'gantt-work' },
      h('div', { className: 'gantt-work-main' },
        error && data ? h('div', { className: 'gantt-banner' },
          h('span', null, error),
          h('button', { className: 'gantt-btn', type: 'button', onClick: refresh }, t('error.retry')),
        ) : null,
        h(BriefStrip, {
          dailyBrief,
          pending: data?.brief?.pending,
          t,
          locale,
          onReveal: revealTask,
          onRecompute: recomputeBrief,
          recomputing,
        }),
        tasks.length > 0
          ? h('section', { className: 'gantt-filter' },
            h('span', { className: 'gantt-filter-label' }, t('filter.label')),
            h('div', { className: 'gantt-seg', role: 'group', 'aria-label': t('filter.label') },
              [['all', 'filter.all'], ['todo', 'filter.todo'], ['done', 'filter.done']].map(([value, key]) => h('button', {
                key: value,
                className: 'gantt-seg-btn',
                type: 'button',
                'data-filter': value,
                'data-active': filter === value ? 'true' : undefined,
                onClick: () => changeFilter(value),
              }, t(key))),
            ),
            filterCount > 0
              ? h('span', { className: 'gantt-filter-count' }, `${filterCount} ${t('filter.paths')}`)
              : null,
          )
          : null,
        content,
      ),
      chatOpen
        ? h(ChatPanel, {
          t,
          focusTask: chatFocusTask,
          focusRef: chatFocusTask ? rowNumber(chatFocusTask) : '',
          focusDepth: chatFocusDepth,
          messages,
          busy: chatBusy,
          error: chatError,
          appliedKey: appliedProposalKey,
          onClose: () => setChatOpen(false),
          onClearFocus: () => setChatFocusId(null),
          onClear: clearChat,
          onSend: sendChat,
          onApply: applyChatProposal,
        })
        : null,
    ),
    dialogNode,
    toast ? h('div', {
      className: 'gantt-toast',
      'data-error': toast.kind === 'error' ? 'true' : undefined,
      role: 'status',
    }, toast.text) : null,
  ))
}
