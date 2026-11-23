import React, { useState } from 'react'
import { requestJson } from '../hooks.js'
import { Dialog, Field } from './primitives.js'
import { h } from '../dom.js'

/** Capture one unshaped idea into the tree. Deliberately lighter than create:
 * a one-line title plus the words that sparked it (required — those words are
 * what mark the row as an idea) — no completion standard and no dates (the
 * server parks today→+3 as placeholders), because shaping is a later,
 * deliberate step done from the row once the idea is picked up. */
export function CaptureDialog({ parentOptions, defaultParent, t, onClose, onSaved }) {
  const [title, setTitle] = useState('')
  const [parent, setParent] = useState(defaultParent)
  const [inspiration, setInspiration] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const submit = async () => {
    const cleanTitle = title.trim()
    if (cleanTitle.length === 0) {
      setError(t('validation.title'))
      return
    }
    const cleanInspiration = inspiration.trim()
    if (cleanInspiration.length === 0) {
      setError(t('validation.inspiration'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await requestJson('api/gantt/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: cleanTitle,
          parentId: parent || null,
          status: 'todo',
          inspiration: cleanInspiration,
        }),
      })
      onSaved(t('notice.captured'), result.task.id)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }
  return h(Dialog, {
    title: t('capture.title'),
    closeLabel: t('actions.close'),
    onClose,
    footer: h('div', { className: 'gantt-dialog-foot-right' },
      h('button', {
        className: 'gantt-btn',
        type: 'button',
        disabled: saving,
        onClick: onClose,
      }, t('dialog.cancel')),
      h('button', {
        className: 'gantt-btn gantt-btn-primary',
        type: 'button',
        'data-action': 'capture-submit',
        disabled: saving,
        onClick: submit,
      }, saving ? '…' : t('capture.submit')),
    ),
  },
  error ? h('div', { className: 'gantt-form-error' }, error) : null,
  h('p', { className: 'gantt-hint' }, t('capture.hint')),
  h('div', { className: 'gantt-form-grid' },
    h(Field, { label: t('capture.parent'), full: true },
      h('select', {
        className: 'gantt-select',
        value: parent,
        onChange: event => setParent(event.target.value),
      },
      h('option', { value: '' }, t('field.parentNone')),
      parentOptions.map(option => h('option', {
        key: option.id,
        value: option.id,
      }, `${'\u00a0\u00a0'.repeat(option.depth)}${option.label}`)),
      ),
    ),
    h(Field, { label: t('field.title'), full: true },
      h('input', {
        className: 'gantt-input',
        value: title,
        autoFocus: true,
        maxLength: 200,
        placeholder: t('capture.titlePlaceholder'),
        onChange: event => setTitle(event.target.value),
      }),
    ),
    h(Field, { label: t('field.inspiration'), full: true },
      h('textarea', {
        className: 'gantt-textarea',
        value: inspiration,
        maxLength: 4000,
        'data-field': 'inspiration',
        placeholder: t('capture.inspirationPlaceholder'),
        onChange: event => setInspiration(event.target.value),
      }),
    ),
  ),
  )
}
