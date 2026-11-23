import React, { useEffect, useState } from 'react'
import { STATUSES } from '../../shared/vocabulary.js'
import { agentLabel, loadAgentNames, reportText } from '../agent-labels.js'
import { addDays, todayIso } from '../dates.js'
import { requestJson } from '../hooks.js'
import { rowNumber } from '../view.js'
import { Dialog, Field } from './primitives.js'
import { h } from '../dom.js'

/** The most tags one task may carry; the server enforces the same cap. */
const MAX_TAGS = 20

/** The longest tag the dialog accepts, matching the server. */
const MAX_TAG_LENGTH = 40

/** Id of the datalist that suggests every tag already in the tree. */
const TAG_SUGGESTIONS_ID = 'gantt-tag-suggestions'

/** One read-only row of the dialog's completion write-back block. */
function writebackRow(field, label, value, multiline = false) {
  return h('div', { className: 'gantt-writeback-row', 'data-field': field },
    h('span', { className: 'gantt-writeback-label' }, label),
    h('span', { className: `gantt-writeback-value${multiline ? ' gantt-writeback-report' : ''}` }, value),
  )
}

/** Create or edit task dialog. */
export function TaskDialog({ mode, task, parentTask, parentOptions, allTags, today, t, onClose, onSaved, onSplit }) {
  const hasChildren = Boolean(task && task.hasChildren)
  // A new task starts on its creation day, even under a parent whose range began
  // earlier; only an edit reopens the task's own dates.
  const initialStart = mode === 'create' ? today ?? todayIso() : task?.startDate
  const initialEnd = mode === 'create' ? addDays(initialStart, 3) : task?.endDate
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [doneWhen, setDoneWhen] = useState(task?.doneWhen ?? '')
  const [inspiration, setInspiration] = useState(task?.inspiration ?? '')
  const [parent, setParent] = useState(task?.parentId ?? parentTask?.id ?? '')
  const [startDate, setStartDate] = useState(initialStart)
  const [endDate, setEndDate] = useState(initialEnd)
  const [status, setStatus] = useState(task?.status ?? 'todo')
  const [progress, setProgress] = useState(task?.progress ?? 0)
  // The dialog owns the tag list until Save; a create starts empty and an edit
  // reopens the task's own tags.
  const [tags, setTags] = useState(() => (Array.isArray(task?.tags) ? [...task.tags] : []))
  const [tagInput, setTagInput] = useState('')
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
    const cleanDoneWhen = doneWhen.trim()
    const cleanInspiration = inspiration.trim()
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
            doneWhen: cleanDoneWhen,
            inspiration: cleanInspiration,
            parentId: parent || null,
            startDate,
            endDate,
            status,
            progress: Number(progress),
            tags: [...tags],
          }),
        })
        onSaved(t('notice.created'), result.task.id)
      } else {
        const body = {
          id: task.id,
          title: cleanTitle,
          description,
          // Both ride every save, empty included, so an edit can clear either
          // one in the store; emptying doneWhen un-shapes the idea again.
          doneWhen: cleanDoneWhen,
          inspiration: cleanInspiration,
          parentId: parent || null,
          tags: [...tags],
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
  // An empty, already added or over-the-cap tag is ignored; only a real append
  // clears the input, so a rejected duplicate stays visible for editing.
  const addTag = () => {
    const tag = tagInput.trim()
    if (tag.length === 0 || tags.includes(tag) || tags.length >= MAX_TAGS) return
    setTags([...tags, tag])
    setTagInput('')
  }
  const removeTag = (tag) => {
    setTags(tags.filter(item => item !== tag))
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
        'data-field': 'description',
        placeholder: t('field.descriptionPlaceholder'),
        onChange: event => setDescription(event.target.value),
      }),
    ),
    h(Field, { label: t('field.doneWhen'), full: true },
      h('textarea', {
        className: 'gantt-textarea',
        value: doneWhen,
        maxLength: 4000,
        'data-field': 'doneWhen',
        placeholder: t('field.doneWhenPlaceholder'),
        onChange: event => setDoneWhen(event.target.value),
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
    h(Field, { label: t('field.tags'), full: true, hint: t('field.tagsHint') },
      h('div', { className: 'gantt-tag-editor' },
        tags.length === 0
          ? null
          : h('div', { className: 'gantt-tag-list' },
            tags.map(tag => h('span', { key: tag, className: 'gantt-tag-chip' },
              h('span', { className: 'gantt-tag-name' }, `#${tag}`),
              h('button', {
                className: 'gantt-tag-remove',
                type: 'button',
                title: `${t('dialog.removeTag')}: ${tag}`,
                'aria-label': `${t('dialog.removeTag')}: ${tag}`,
                onClick: () => removeTag(tag),
              }, '×'),
            )),
          ),
        h('div', { className: 'gantt-tag-add' },
          h('input', {
            className: 'gantt-input gantt-tag-input',
            type: 'text',
            value: tagInput,
            maxLength: MAX_TAG_LENGTH,
            list: TAG_SUGGESTIONS_ID,
            placeholder: t('field.tagsPlaceholder'),
            onChange: event => setTagInput(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              addTag()
            },
          }),
          h('button', {
            className: 'gantt-btn',
            type: 'button',
            'data-action': 'add-tag',
            onClick: addTag,
          }, t('dialog.addTag')),
        ),
        h('datalist', { id: TAG_SUGGESTIONS_ID },
          allTags.map(tag => h('option', { key: tag, value: tag })),
        ),
      ),
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
