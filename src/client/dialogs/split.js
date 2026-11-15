import React, { useState } from 'react'
import { DAY_MS } from '../constants.js'
import { addDays, isoToDay } from '../dates.js'
import { requestJson } from '../hooks.js'
import { rowNumber } from '../view.js'
import { Dialog } from './primitives.js'
import { h } from '../dom.js'

let splitRowSequence = 0
function defaultSplitRows(task) {
  const total = Math.max(1, Math.round((isoToDay(task.endDate) - isoToDay(task.startDate)) / DAY_MS) + 1)
  if (total <= 1) {
    return [
      { key: `row-${splitRowSequence += 1}`, title: '', startDate: task.startDate, endDate: task.endDate },
    ]
  }
  const firstHalf = Math.max(1, Math.floor(total / 2))
  const middle = addDays(task.startDate, firstHalf - 1)
  return [
    { key: `row-${splitRowSequence += 1}`, title: '', startDate: task.startDate, endDate: middle },
    { key: `row-${splitRowSequence += 1}`, title: '', startDate: addDays(middle, 1), endDate: task.endDate },
  ]
}

/** Split a task into child subtasks dialog. */
export function SplitDialog({ task, t, onClose, onSaved }) {
  const [rows, setRows] = useState(() => defaultSplitRows(task))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const updateRow = (key, patch) => {
    setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)))
  }
  const addRow = () => {
    const last = rows[rows.length - 1]
    const startDate = addDays(last.endDate, 1)
    const endDate = task.endDate > startDate ? task.endDate : addDays(startDate, 1)
    setRows(current => [...current, {
      key: `row-${splitRowSequence += 1}`,
      title: '',
      startDate,
      endDate,
    }])
  }
  const removeRow = (key) => {
    setRows(current => current.filter(row => row.key !== key))
  }
  const submit = async () => {
    for (const row of rows) {
      if (row.title.trim().length === 0 || row.endDate < row.startDate) {
        setError(t('validation.splitChild'))
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      const result = await requestJson('api/gantt/task/split', {
        method: 'POST',
        body: JSON.stringify({
          id: task.id,
          children: rows.map(row => ({
            title: row.title.trim(),
            startDate: row.startDate,
            endDate: row.endDate,
            status: 'todo',
            progress: 0,
          })),
        }),
      })
      onSaved(t('notice.split'), result.parent.id)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }
  return h(Dialog, {
    title: `${t('dialog.splitTitle')} · ${rowNumber(task)} ${task.title}`,
    closeLabel: t('actions.close'),
    onClose,
    wide: true,
    footer: h(React.Fragment, null,
      h('div', { className: 'gantt-dialog-foot-left' },
        h('button', { className: 'gantt-btn', type: 'button', disabled: saving, onClick: addRow }, `+ ${t('dialog.addRow')}`),
      ),
      h('div', { className: 'gantt-dialog-foot-right' },
        h('button', { className: 'gantt-btn', type: 'button', disabled: saving, onClick: onClose }, t('dialog.cancel')),
        h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', disabled: saving, onClick: submit }, saving ? '…' : t('dialog.split')),
      ),
    ),
  },
  error ? h('div', { className: 'gantt-form-error' }, error) : null,
  h('p', { className: 'gantt-dialog-note' }, t('dialog.splitHint')),
  h('div', { className: 'gantt-split-head' },
    h('span', null, t('dialog.splitChildTitle')),
    h('span', null, t('field.start')),
    h('span', null, t('field.end')),
    h('span', null, ''),
  ),
  rows.map(row => h('div', { className: 'gantt-split-row', key: row.key },
    h('input', {
      className: 'gantt-input',
      'aria-label': t('dialog.splitChildTitle'),
      value: row.title,
      autoFocus: row === rows[0],
      placeholder: t('dialog.splitChildTitle'),
      onChange: event => updateRow(row.key, { title: event.target.value }),
    }),
    h('input', {
      className: 'gantt-input',
      type: 'date',
      'aria-label': t('field.start'),
      value: row.startDate,
      onChange: (event) => {
        const next = event.target.value
        updateRow(row.key, {
          startDate: next,
          endDate: next > row.endDate ? next : row.endDate,
        })
      },
    }),
    h('input', {
      className: 'gantt-input',
      type: 'date',
      'aria-label': t('field.end'),
      value: row.endDate,
      min: row.startDate,
      onChange: event => updateRow(row.key, { endDate: event.target.value }),
    }),
    h('button', {
      className: 'gantt-btn gantt-icon-btn',
      type: 'button',
      title: t('dialog.removeRow'),
      'aria-label': t('dialog.removeRow'),
      disabled: rows.length <= 1,
      onClick: () => removeRow(row.key),
    }, '×'),
  )),
  )
}
