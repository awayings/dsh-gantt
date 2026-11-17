import React, { useEffect, useState } from 'react'
import { STATUSES } from '../../shared/vocabulary.js'
import { agentLabel, loadAgentNames, reportText } from '../agent-labels.js'
import { addDays, todayIso } from '../dates.js'
import { requestJson } from '../hooks.js'
import { rowNumber } from '../view.js'
import { Dialog, Field } from './primitives.js'
import { h } from '../dom.js'

/** One read-only row of the dialog's completion write-back block. */
function writebackRow(field, label, value, multiline = false) {
  return h('div', { className: 'gantt-writeback-row', 'data-field': field },
    h('span', { className: 'gantt-writeback-label' }, label),
    h('span', { className: `gantt-writeback-value${multiline ? ' gantt-writeback-report' : ''}` }, value),
  )
}

/** Create or edit task dialog. */
export function TaskDialog({ mode, task, parentTask, parentOptions, t, onClose, onSaved, onSplit }) {
  const hasChildren = Boolean(task && task.hasChildren)
  const initialStart = task?.startDate ?? parentTask?.startDate ?? todayIso()
  const initialEnd = task?.endDate ?? parentTask?.endDate ?? addDays(initialStart, 3)
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [parent, setParent] = useState(task?.parentId ?? parentTask?.id ?? '')
  const [startDate, setStartDate] = useState(initialStart)
  const [endDate, setEndDate] = useState(initialEnd)
  const [status, setStatus] = useState(task?.status ?? 'todo')
  const [progress, setProgress] = useState(task?.progress ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [agentNames, setAgentNames] = useState(/** @type {Map<string, string> | null} */ (null))
  const writebackTask = mode === 'edit' ? task : null
  useEffect(() => {
    if (!writebackTask) return undefined
    let active = true
    loadAgentNames().then((names) => {
      if (active) setAgentNames(names)
    })
    return () => {
      active = false
    }
  }, [writebackTask])
  const submit = async () => {
    const cleanTitle = title.trim()
    if (cleanTitle.length === 0) {
      setError(t('validation.title'))
      return
    }
    if (endDate < startDate) {
      setError(t('validation.dates'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (mode === 'create') {
        const result = await requestJson('api/gantt/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: cleanTitle,
            description,
            parentId: parent || null,
            startDate,
            endDate,
            status,
            progress: Number(progress),
          }),
        })
        onSaved(t('notice.created'), result.task.id)
      } else {
        const body = {
          id: task.id,
          title: cleanTitle,
          description,
          parentId: parent || null,
        }
        if (!hasChildren) {
          body.startDate = startDate
          body.endDate = endDate
          body.status = status
          body.progress = Number(progress)
        }
        const result = await requestJson('api/gantt/task/update', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        onSaved(t('notice.saved'), result.task.id)
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await requestJson('api/gantt/task/delete', {
        method: 'POST',
        body: JSON.stringify({ id: task.id }),
      })
      onSaved(t('notice.deleted'), null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }
  const changeStatus = (next) => {
    setStatus(next)
    if (next === 'done') setProgress(100)
    else if (next === 'todo') setProgress(0)
    else if (next === 'in_progress' && (progress === 0 || progress === 100)) setProgress(50)
  }
  const changeProgress = (next) => {
    const value = Number(next)
    setProgress(value)
    if (value >= 100) setStatus('done')
    else if (value <= 0) setStatus('todo')
    else if (status === 'todo' || status === 'done') setStatus('in_progress')
  }
  const parentChoices = parentOptions
  return h(Dialog, {
    title: mode === 'create' ? t('dialog.createTitle') : `${t('dialog.editTitle')} · ${rowNumber(task)}`,
    closeLabel: t('actions.close'),
    onClose,
    footer: h(React.Fragment, null,
      h('div', { className: 'gantt-dialog-foot-left' },
        mode === 'edit'
          ? h('button', {
            className: 'gantt-btn gantt-btn-danger',
            type: 'button',
            disabled: saving,
            onClick: remove,
          }, confirmDelete ? t('dialog.deleteConfirm') : t('dialog.delete'))
          : null,
        mode === 'edit'
          ? h('button', {
            className: 'gantt-btn',
            type: 'button',
            disabled: saving,
            onClick: () => onSplit(task),
          }, t('dialog.split'))
          : null,
      ),
      h('div', { className: 'gantt-dialog-foot-right' },
        h('button', {
          className: 'gantt-btn',
          type: 'button',
          disabled: saving,
          onClick: onClose,
        }, t('dialog.cancel')),
        h('button', {
          className: 'gantt-btn gantt-btn-primary',
          type: 'button',
          disabled: saving,
          onClick: submit,
        }, saving ? '…' : (mode === 'create' ? t('dialog.create') : t('dialog.save'))),
      ),
    ),
  },
  error ? h('div', { className: 'gantt-form-error' }, error) : null,
  h('div', { className: 'gantt-form-grid' },
    h(Field, { label: t('field.title'), full: true },
      h('input', {
        className: 'gantt-input',
        value: title,
        autoFocus: true,
        maxLength: 200,
        placeholder: t('field.titlePlaceholder'),
        onChange: event => setTitle(event.target.value),
      }),
    ),
    h(Field, { label: t('field.description'), full: true },
      h('textarea', {
        className: 'gantt-textarea',
        value: description,
        maxLength: 4000,
        placeholder: t('field.descriptionPlaceholder'),
        onChange: event => setDescription(event.target.value),
      }),
    ),
    h(Field, { label: t('field.parent'), full: true, hint: hasChildren ? t('field.summaryDates') : null },
      h('select', {
        className: 'gantt-select',
        value: parent,
        onChange: event => setParent(event.target.value),
      },
      h('option', { value: '' }, t('field.parentNone')),
      parentChoices.map(option => h('option', {
        key: option.id,
        value: option.id,
      }, `${'\u00a0\u00a0'.repeat(option.depth)}${option.label}`)),
      ),
    ),
    h(Field, { label: t('field.start') },
      h('input', {
        className: 'gantt-input',
        type: 'date',
        value: startDate,
        disabled: hasChildren,
        onChange: (event) => {
          const next = event.target.value
          setStartDate(next)
          if (next > endDate) setEndDate(next)
        },
      }),
    ),
    h(Field, { label: t('field.end') },
      h('input', {
        className: 'gantt-input',
        type: 'date',
        value: endDate,
        disabled: hasChildren,
        min: startDate,
        onChange: event => setEndDate(event.target.value),
      }),
    ),
    h(Field, { label: t('field.status') },
      h('select', {
        className: 'gantt-select',
        value: status,
        disabled: hasChildren,
        onChange: event => changeStatus(event.target.value),
      },
      STATUSES.map(value => h('option', { key: value, value }, t(`status.${value}`))),
      ),
    ),
    h(Field, { label: `${t('field.progress')} · ${progress}%`, hint: hasChildren ? null : t('field.progressHint') },
      h('input', {
        className: 'gantt-range',
        type: 'range',
        min: 0,
        max: 100,
        step: 1,
        value: progress,
        disabled: hasChildren,
        onChange: event => changeProgress(event.target.value),
      }),
    ),
  ),
  writebackTask
    ? h('div', { className: 'gantt-writeback', 'data-block': 'writeback' },
      writebackRow('operator', t('field.operator'), agentLabel(agentNames, writebackTask.operatorId, t)),
      writebackRow('completedBy', t('field.completedBy'), agentLabel(agentNames, writebackTask.completedById, t)),
      writebackRow('report', t('field.report'), reportText(writebackTask.report, t), true),
    )
    : null,
  )
}
