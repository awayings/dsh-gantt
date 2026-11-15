import React, { useState } from 'react'
import { addDays, todayIso } from '../dates.js'
import { requestJson } from '../hooks.js'
import { rowNumber } from '../view.js'
import { Dialog } from './primitives.js'
import { h } from '../dom.js'

let decomposeRowSequence = 0
function newDecomposeRow() {
  const planDate = addDays(todayIso(), 1)
  return {
    key: `dec-${decomposeRowSequence += 1}`,
    title: '',
    doneWhen: '',
    landing: '',
    estimate: '',
    category: '',
    inspiration: '',
    startDate: planDate,
    endDate: planDate,
    planDate,
    planTime: '21:00',
  }
}

/** Decompose node dialog with plan fields per child. */
export function DecomposeDialog({ task, t, onClose, onSaved }) {
  const [rows, setRows] = useState(() => [newDecomposeRow()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const updateRow = (key, patch) => {
    setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)))
  }
  const addRow = () => setRows(current => [...current, newDecomposeRow()])
  const removeRow = (key) => {
    setRows(current => current.filter(row => row.key !== key))
  }
  const submit = async () => {
    for (const row of rows) {
      if (row.title.trim().length === 0 || row.doneWhen.trim().length === 0) {
        setError(t('validation.decomposeChild'))
        return
      }
      if (row.startDate && row.endDate && row.endDate < row.startDate) {
        setError(t('validation.dates'))
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      const children = rows.map((row) => {
        const child = {
          title: row.title.trim(),
          doneWhen: row.doneWhen.trim(),
          landing: row.landing.trim(),
          estimate: row.estimate.trim(),
          category: row.category.trim(),
          inspiration: row.inspiration.trim(),
          startDate: row.startDate || undefined,
          endDate: row.endDate || undefined,
        }
        if (row.planDate) {
          child.plan = { date: row.planDate }
          if (row.planTime) child.plan.startTime = row.planTime
        }
        return child
      })
      const result = await requestJson('api/gantt/task/decompose', {
        method: 'POST',
        body: JSON.stringify({ id: task.id, children }),
      })
      const planned = children.filter(child => child.plan).length
      const planDay = children.find(child => child.plan)?.plan.date ?? ''
      const message = planned === 0
        ? t('notice.decomposedNoPlan').replace('{n}', String(children.length))
        : t('notice.decomposed')
          .replace('{n}', String(children.length))
          .replace('{m}', String(planned))
          .replace('{date}', planDay)
      onSaved(message, result.parent?.id ?? task.id)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }
  const fieldInput = (row, key, options = {}) => h('input', {
    className: 'gantt-input',
    'data-field': key,
    type: options.type,
    'aria-label': options.label,
    placeholder: options.placeholder,
    maxLength: options.maxLength,
    value: row[key],
    onChange: event => updateRow(row.key, { [key]: event.target.value }),
  })
  return h(Dialog, {
    title: `${t('dialog.decomposeTitle')} · ${rowNumber(task)} ${task.title}`,
    closeLabel: t('actions.close'),
    onClose,
    wide: true,
    footer: h(React.Fragment, null,
      h('div', { className: 'gantt-dialog-foot-left' },
        h('button', { className: 'gantt-btn', type: 'button', disabled: saving, onClick: addRow }, `+ ${t('dialog.addRow')}`),
      ),
      h('div', { className: 'gantt-dialog-foot-right' },
        h('button', { className: 'gantt-btn', type: 'button', disabled: saving, onClick: onClose }, t('dialog.cancel')),
        h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', disabled: saving, onClick: submit }, saving ? '…' : t('dialog.decompose')),
      ),
    ),
  },
  error ? h('div', { className: 'gantt-form-error' }, error) : null,
  h('p', { className: 'gantt-dialog-note' }, t('dialog.decomposeHint')),
  h('div', { className: 'gantt-parent-summary' },
    h('span', { className: 'gantt-label' }, t('dialog.decomposeParent')),
    h('span', { className: 'gantt-number' }, rowNumber(task)),
    h('span', { className: 'gantt-task-title' }, task.title),
    task.state ? h('span', { className: 'gantt-row-chip' }, task.state) : null,
    task.doneWhen ? h('span', { className: 'gantt-row-chip', title: task.doneWhen }, task.doneWhen) : null,
  ),
  rows.map((row, index) => h('div', { className: 'gantt-decompose-row', key: row.key },
    h('div', { className: 'gantt-decompose-head' },
      h('span', { className: 'gantt-decompose-index' }, `#${index + 1}`),
      fieldInput(row, 'title', { label: t('dialog.splitChildTitle'), placeholder: t('dialog.splitChildTitle'), maxLength: 200 }),
      fieldInput(row, 'doneWhen', { label: t('field.doneWhen'), placeholder: t('field.doneWhenPlaceholder') }),
      h('button', {
        className: 'gantt-btn gantt-icon-btn',
        type: 'button',
        title: t('dialog.removeRow'),
        'aria-label': t('dialog.removeRow'),
        disabled: rows.length <= 1,
        onClick: () => removeRow(row.key),
      }, '×'),
    ),
    h('div', { className: 'gantt-decompose-fields' },
      fieldInput(row, 'landing', { label: t('field.landing'), placeholder: t('field.landing') }),
      fieldInput(row, 'estimate', { label: t('field.estimate'), placeholder: t('field.estimate') }),
      fieldInput(row, 'category', { label: t('field.category'), placeholder: t('field.category') }),
      fieldInput(row, 'inspiration', { label: t('field.inspiration'), placeholder: t('field.inspiration') }),
      fieldInput(row, 'startDate', { type: 'date', label: t('field.start') }),
      fieldInput(row, 'endDate', { type: 'date', label: t('field.end') }),
      fieldInput(row, 'planDate', { type: 'date', label: t('field.planDate') }),
      fieldInput(row, 'planTime', { type: 'time', label: t('field.planTime') }),
    ),
  )),
  )
}
