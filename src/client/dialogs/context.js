import React, { useEffect, useRef, useState } from 'react'
import { requestJson } from '../hooks.js'
import { Dialog } from './primitives.js'
import { h } from '../dom.js'

/** Model context export dialog with a copy fallback. */
export function ContextDialog({ t, onClose }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const [copyState, setCopyState] = useState('idle')
  const textareaRef = useRef(null)
  useEffect(() => {
    let active = true
    requestJson('api/gantt/context')
      .then((body) => {
        if (active) setState({ status: 'ready', data: body, error: null })
      })
      .catch((failure) => {
        if (active) {
          setState({
            status: 'error',
            data: null,
            error: failure instanceof Error ? failure.message : String(failure),
          })
        }
      })
    return () => {
      active = false
    }
  }, [])
  const copy = async () => {
    const markdown = state.data?.markdown ?? ''
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('clipboard unavailable')
      }
      await navigator.clipboard.writeText(markdown)
      setCopyState('copied')
    } catch {
      textareaRef.current?.select()
      setCopyState('fallback')
    }
  }
  const data = state.data
  const chars = data ? (typeof data.chars === 'number' ? data.chars : String(data.markdown ?? '').length) : 0
  return h(Dialog, {
    title: t('dialog.contextTitle'),
    closeLabel: t('actions.close'),
    onClose,
    wide: true,
    footer: h('div', { className: 'gantt-dialog-foot-right' },
      h('button', { className: 'gantt-btn', type: 'button', onClick: onClose }, t('actions.close')),
      h('button', {
        className: 'gantt-btn gantt-btn-primary',
        'data-action': 'copy',
        type: 'button',
        disabled: !data,
        onClick: copy,
      }, t('context.copy')),
    ),
  },
  state.status === 'loading' ? h('p', { className: 'gantt-hint' }, t('context.loading')) : null,
  state.error ? h('div', { className: 'gantt-form-error' }, state.error) : null,
  data
    ? h(React.Fragment, null,
      h('p', { className: 'gantt-dialog-note' }, t('context.intro')),
      h('textarea', {
        className: 'gantt-textarea gantt-context-text',
        ref: textareaRef,
        readOnly: true,
        value: data.markdown ?? '',
        rows: 14,
        'aria-label': t('dialog.contextTitle'),
      }),
      h('div', { className: 'gantt-context-meta' },
        h('span', null, t('context.chars').replace('{n}', String(chars))),
        data.truncated ? h('span', { className: 'gantt-context-truncated' }, t('context.truncated')) : null,
      ),
    )
    : null,
  copyState === 'copied' ? h('p', { className: 'gantt-hint' }, t('context.copied')) : null,
  copyState === 'fallback' ? h('p', { className: 'gantt-hint' }, t('context.copyFallback')) : null,
  )
}
