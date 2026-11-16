import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { STATUS_COLOR } from '../constants.js'
import { h } from '../dom.js'
import { requestJson, useGanttData, useLocale } from '../hooks.js'
import { CSS_PANEL } from '../styles/panel.js'
import { flattenTree, rowNumber } from '../view.js'

function failureMessage(failure) {
  return failure instanceof Error ? failure.message : String(failure)
}

/**
 * Compact task-tree panel for the native conversation sidebar tab.
 *
 * Clicking a row writes the conversation's focused task through
 * `POST api/gantt/focus/set`; the header restores it with `GET api/gantt/focus`.
 * Auto-refresh pauses while the tab is not visible.
 */
export function GanttPanel({ ctx, scope, visible = true }) {
  const { t } = useLocale(ctx)
  const { status, data, error, refresh } = useGanttData({ enabled: visible })
  const [focusId, setFocusId] = useState(null)
  const [focusError, setFocusError] = useState(null)
  const [saving, setSaving] = useState(false)
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

  useEffect(() => {
    if (!visible) return undefined
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [visible, refresh])

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
      onClick: refresh,
    }, status === 'refreshing' ? '…' : '⟳'),
  )

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
