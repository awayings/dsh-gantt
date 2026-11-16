import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { STATUS_COLOR } from '../constants.js'
import { localeTag } from '../dates.js'
import { h } from '../dom.js'
import { requestJson, useGanttData, useLocale } from '../hooks.js'
import { CSS_PANEL } from '../styles/panel.js'
import { flattenTree, rowNumber } from '../view.js'

function failureMessage(failure) {
  return failure instanceof Error ? failure.message : String(failure)
}

function shortTime(iso, locale) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(localeTag(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

/**
 * Compact task-tree panel for the native conversation sidebar tab.
 *
 * Clicking a row writes the conversation's focused task through
 * `POST api/gantt/focus/set`; the header restores it with `GET api/gantt/focus`.
 * Auto-refresh pauses while the tab is not visible.
 */
export function GanttPanel({ ctx, scope, visible = true }) {
  const { locale, t } = useLocale(ctx)
  const { status, data, error, refresh } = useGanttData({ enabled: visible })
  const [focusId, setFocusId] = useState(null)
  const [focusError, setFocusError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [trajectory, setTrajectory] = useState({ taskId: null, events: [], error: null })
  const [trajectoryRevision, setTrajectoryRevision] = useState(0)
  const sessionId = scope?.sessionId ?? ''

  useEffect(() => {
    if (sessionId === '' || !visible) return undefined
    let active = true
    requestJson(`api/gantt/focus?sessionId=${encodeURIComponent(sessionId)}`)
      .then((body) => {
        if (active) setFocusId(body.taskId ?? null)
      })
      .catch((failure) => {
        if (active) setFocusError(failureMessage(failure))
      })
    return () => {
      active = false
    }
  }, [sessionId, visible])

  const refreshAll = useCallback(() => {
    refresh()
    setTrajectoryRevision(value => value + 1)
  }, [refresh])

  useEffect(() => {
    if (!visible) return undefined
    const onFocus = () => refreshAll()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [visible, refreshAll])

  useEffect(() => {
    if (!visible || focusId === null) return undefined
    let active = true
    requestJson(`api/gantt/trajectory?taskId=${encodeURIComponent(focusId)}&limit=5`)
      .then((body) => {
        if (active) {
          setTrajectory({
            taskId: focusId,
            events: Array.isArray(body.events) ? body.events : [],
            error: null,
          })
        }
      })
      .catch((failure) => {
        if (active) setTrajectory({ taskId: focusId, events: [], error: failureMessage(failure) })
      })
    return () => {
      active = false
    }
  }, [focusId, visible, trajectoryRevision])

  const rows = useMemo(() => {
    const tasks = data?.tasks ?? []
    const depths = new Map()
    const walk = (list, depth) => {
      for (const node of list) {
        depths.set(node.id, depth)
        walk(node.children, depth + 1)
      }
    }
    walk(tasks, 0)
    return flattenTree(tasks).map(task => ({ task, depth: depths.get(task.id) }))
  }, [data])
  const byId = useMemo(() => new Map(rows.map(({ task }) => [task.id, task])), [rows])
  const focusTask = focusId === null ? null : byId.get(focusId) ?? null

  const writeFocus = useCallback(async (taskId) => {
    if (sessionId === '') return
    setSaving(true)
    setFocusError(null)
    try {
      const body = await requestJson('api/gantt/focus/set', {
        method: 'POST',
        body: JSON.stringify({ sessionId, taskId }),
      })
      setFocusId(body.taskId ?? taskId)
    } catch (failure) {
      setFocusError(failureMessage(failure))
    } finally {
      setSaving(false)
    }
  }, [sessionId])

  const shell = children => h('div', { className: 'gantt-panel' },
    h('style', { key: 'panel-css' }, CSS_PANEL),
    children,
  )

  const header = h('header', { className: 'gantt-panel-head' },
    h('div', { className: 'gantt-panel-focus' },
      focusTask
        ? h(React.Fragment, null,
          h('span', { className: 'gantt-panel-focus-label' }, t('panel.focus')),
          h('span', { className: 'gantt-panel-chip' },
            h('span', { className: 'gantt-panel-chip-ref' }, rowNumber(focusTask)),
            h('span', { className: 'gantt-panel-chip-title', title: focusTask.title }, focusTask.title),
          ),
          h('button', {
            className: 'gantt-panel-btn gantt-panel-clear',
            type: 'button',
            disabled: saving,
            onClick: () => writeFocus(null),
          }, t('panel.clearFocus')),
        )
        : h('span', { className: 'gantt-panel-focus-none' }, t('panel.focusNone')),
    ),
    h('button', {
      className: 'gantt-panel-btn gantt-panel-btn-icon',
      type: 'button',
      title: t('panel.refresh'),
      'aria-label': t('panel.refresh'),
      disabled: status === 'refreshing',
      onClick: refreshAll,
    }, status === 'refreshing' ? '…' : '⟳'),
  )

  const trajectoryVisible = focusId !== null
    && trajectory.taskId === focusId
    && (trajectory.events.length > 0 || trajectory.error !== null)
  const trajectorySection = trajectoryVisible
    ? h('section', {
      className: 'gantt-panel-trajectory',
      'data-block': 'trajectory',
      'aria-label': t('panel.trajectory'),
    },
    h('div', { className: 'gantt-panel-trajectory-head' },
      h('span', { className: 'gantt-panel-trajectory-title' }, t('panel.trajectory')),
    ),
    trajectory.error
      ? h('p', { className: 'gantt-panel-trajectory-error', role: 'status' },
        `${t('panel.trajectoryError')} ${trajectory.error}`)
      : null,
    trajectory.events.slice(0, 5).map((event, index) => h('div', {
      key: index,
      className: 'gantt-panel-trajectory-row',
      'data-action': event.action,
      title: event.sessionId,
    },
    h('span', { className: 'gantt-panel-trajectory-action' }, t(`panel.action.${event.action}`)),
    typeof event.turn === 'number'
      ? h('span', { className: 'gantt-panel-trajectory-turn' }, t('panel.turn').replace('{n}', String(event.turn)))
      : null,
    h('span', { className: 'gantt-panel-trajectory-time' }, shortTime(event.at, locale)),
    event.detail
      ? h('span', { className: 'gantt-panel-trajectory-detail', title: event.detail }, event.detail)
      : null,
    )),
    )
    : null

  if (status === 'loading' && data === null) {
    return shell(h(React.Fragment, null, header,
      h('div', { className: 'gantt-panel-center' },
        h('span', { className: 'gantt-panel-spinner' }),
        h('p', { className: 'gantt-panel-message' }, t('loading')),
      ),
    ))
  }

  if (status === 'error' && data === null) {
    return shell(h(React.Fragment, null, header,
      h('div', { className: 'gantt-panel-center' },
        h('p', { className: 'gantt-panel-message' }, t('panel.error')),
        h('p', { className: 'gantt-panel-message' }, error),
        h('button', {
          className: 'gantt-panel-btn',
          type: 'button',
          onClick: refresh,
        }, t('error.retry')),
      ),
    ))
  }

  return shell(h(React.Fragment, null,
    header,
    trajectorySection,
    h('div', { className: 'gantt-panel-body' },
      focusError
        ? h('div', { className: 'gantt-panel-error', role: 'status' }, `${t('panel.focusError')} ${focusError}`)
        : null,
      rows.length === 0
        ? h('div', { className: 'gantt-panel-center' },
          h('p', { className: 'gantt-panel-message' }, t('panel.empty')),
        )
        : rows.map(({ task, depth }) => h('button', {
          key: task.id,
          type: 'button',
          className: 'gantt-panel-row',
          'data-task-id': task.id,
          'data-focused': task.id === focusId ? 'true' : undefined,
          'data-kind': task.kind,
          style: { paddingLeft: `${10 + depth * 14}px` },
          disabled: saving,
          title: `${rowNumber(task)} ${task.title}`,
          onClick: () => writeFocus(task.id),
        },
        h('span', {
          className: 'gantt-panel-dot',
          style: { '--st': STATUS_COLOR[task.status] || STATUS_COLOR.todo },
          title: t(`status.${task.status}`),
        }),
        h('span', { className: 'gantt-panel-ref' }, rowNumber(task)),
        h('span', { className: 'gantt-panel-title' }, task.title),
        h('span', { className: 'gantt-panel-kind' }, t(`panel.kind.${task.kind || 'task'}`)),
        )),
    ),
  ))
}
