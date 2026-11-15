import { addDays, todayIso } from '../dates.js'
import { requestJson } from '../hooks.js'
import { rowNumber } from '../view.js'
import { Dialog, Field } from './primitives.js'
import { useState } from 'react'
import { h } from '../dom.js'

/** Schedule a node into a day plan dialog. */
export function ScheduleDialog({ task, t, onClose, onSaved }) {
  const [date, setDate] = useState(() => addDays(todayIso(), 1))
  const [startTime, setStartTime] = useState('21:00')
  const [endTime, setEndTime] = useState('22:00')
  const [category, setCategory] = useState(task.category || '')
  const [landing, setLanding] = useState(task.landing || '')
  const [estimate, setEstimate] = useState(task.estimate || '')
  const [inspiration, setInspiration] = useState(task.inspiration || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    if (!date) {
      setError(t('validation.planDate'))
      return
    }
    if (startTime && endTime && endTime < startTime) {
      setError(t('validation.times'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = { id: task.id, date }
      if (startTime) body.startTime = startTime
      if (endTime) body.endTime = endTime
      if (category.trim()) body.category = category.trim()
      if (landing.trim()) body.landing = landing.trim()
      if (estimate.trim()) body.estimate = estimate.trim()
      if (inspiration.trim()) body.inspiration = inspiration.trim()
      const result = await requestJson('api/gantt/task/schedule', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      onSaved(t('notice.scheduled').replace('{date}', date), result.task?.id ?? task.id)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }
  return h(Dialog, {
    title: `${t('dialog.scheduleTitle')} · ${rowNumber(task)} ${task.title}`,
    closeLabel: t('actions.close'),
    onClose,
    footer: h('div', { className: 'gantt-dialog-foot-right' },
      h('button', { className: 'gantt-btn', type: 'button', disabled: saving, onClick: onClose }, t('dialog.cancel')),
      h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', disabled: saving, onClick: submit }, saving ? '…' : t('dialog.schedule')),
    ),
  },
  error ? h('div', { className: 'gantt-form-error' }, error) : null,
  h('p', { className: 'gantt-dialog-note' }, t('dialog.scheduleHint')),
  h('div', { className: 'gantt-form-grid' },
    h(Field, { label: t('field.planDate'), full: true },
      h('input', {
        className: 'gantt-input',
        'data-field': 'date',
        type: 'date',
        value: date,
        autoFocus: true,
        onChange: event => setDate(event.target.value),
      }),
    ),
    h(Field, { label: t('field.startTime') },
      h('input', {
        className: 'gantt-input',
        'data-field': 'startTime',
        type: 'time',
        value: startTime,
        onChange: event => setStartTime(event.target.value),
      }),
    ),
    h(Field, { label: t('field.endTime') },
      h('input', {
        className: 'gantt-input',
        'data-field': 'endTime',
        type: 'time',
        value: endTime,
        onChange: event => setEndTime(event.target.value),
      }),
    ),
    h(Field, { label: t('field.category') },
      h('input', {
        className: 'gantt-input',
        'data-field': 'category',
        value: category,
        onChange: event => setCategory(event.target.value),
      }),
    ),
    h(Field, { label: t('field.landing') },
      h('input', {
        className: 'gantt-input',
        'data-field': 'landing',
        value: landing,
        onChange: event => setLanding(event.target.value),
      }),
    ),
    h(Field, { label: t('field.estimate') },
      h('input', {
        className: 'gantt-input',
        'data-field': 'estimate',
        value: estimate,
        onChange: event => setEstimate(event.target.value),
      }),
    ),
    h(Field, { label: t('field.inspiration') },
      h('input', {
        className: 'gantt-input',
        'data-field': 'inspiration',
        value: inspiration,
        onChange: event => setInspiration(event.target.value),
      }),
    ),
  ),
  )
}
