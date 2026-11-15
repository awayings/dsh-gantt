import { API_TEXT } from '../api-text.js'
import { requestJson } from '../hooks.js'
import { Dialog } from './primitives.js'
import { useEffect, useState } from 'react'
import { h } from '../dom.js'

/** Read-only endpoint catalog dialog. */
export function ApiDialog({ t, locale, onClose }) {
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let active = true
    requestJson('api/gantt/meta')
      .then((body) => {
        if (active) setMeta(body)
      })
      .catch((failure) => {
        if (active) setError(failure instanceof Error ? failure.message : String(failure))
      })
    return () => {
      active = false
    }
  }, [])
  return h(Dialog, {
    title: t('dialog.apiTitle'),
    closeLabel: t('actions.close'),
    onClose,
    wide: true,
    footer: h('div', { className: 'gantt-dialog-foot-right' },
      h('button', { className: 'gantt-btn', type: 'button', onClick: onClose }, t('actions.close')),
    ),
  },
  h('p', { className: 'gantt-dialog-note' }, t('dialog.apiIntro')),
  h('div', { className: 'gantt-api-meta' },
    h('div', null,
      h('span', { className: 'gantt-label' }, t('dialog.apiDb')),
      h('code', { className: 'gantt-code' }, meta?.dbPath ?? '—'),
    ),
    h('div', null,
      h('span', { className: 'gantt-label' }, 'Engine'),
      h('code', { className: 'gantt-code' }, meta?.engine ?? '—'),
    ),
  ),
  h('p', { className: 'gantt-hint' }, t('dialog.apiAuth')),
  error ? h('div', { className: 'gantt-form-error' }, error) : null,
  !meta && !error ? h('p', { className: 'gantt-hint' }, t('dialog.apiEmpty')) : null,
  meta
    ? h('div', { className: 'gantt-api-list' },
      (meta.endpoints ?? []).map(endpoint => h('div', { className: 'gantt-api-row', key: `${endpoint.method} ${endpoint.path}` },
        h('span', { className: 'gantt-method', 'data-method': endpoint.method }, endpoint.method),
        h('code', { className: 'gantt-code gantt-api-path' }, endpoint.path),
        h('span', { className: 'gantt-api-desc' }, API_TEXT[endpoint.path]
          ? API_TEXT[endpoint.path][String(locale).toLowerCase().startsWith('zh') ? 'zh' : 'en']
          : endpoint.description),
      )))
    : null,
  )
}
