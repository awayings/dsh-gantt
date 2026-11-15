import { useEffect } from 'react'
import { h } from '../dom.js'

/** Labeled dialog field wrapper. */
export function Field({ label, hint, children, full }) {
  return h('label', { className: `gantt-field${full ? ' gantt-field-full' : ''}` },
    h('span', { className: 'gantt-label' }, label),
    children,
    hint ? h('span', { className: 'gantt-hint' }, hint) : null,
  )
}

/** Modal dialog shell with a backdrop, header, body and footer. */
export function Dialog({ title, children, footer, onClose, closeLabel, wide }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return h('div', {
    className: 'gantt-backdrop',
    onMouseDown: (event) => {
      if (event.target === event.currentTarget) onClose()
    },
  },
  h('div', {
    className: `gantt-dialog${wide ? ' gantt-dialog-wide' : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  },
  h('div', { className: 'gantt-dialog-head' },
    h('h2', { className: 'gantt-dialog-title' }, title),
    h('button', {
      className: 'gantt-btn gantt-icon-btn',
      type: 'button',
      'aria-label': closeLabel,
      title: closeLabel,
      onClick: onClose,
    }, '×'),
  ),
  h('div', { className: 'gantt-dialog-body' }, children),
  h('div', { className: 'gantt-dialog-foot' }, footer),
  ),
  )
}
