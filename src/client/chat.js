import React, { useState } from 'react'
import { h } from './dom.js'

function chatPlanLabel(plan) {
  const range = [plan.startTime, plan.endTime].filter(Boolean).join('–')
  return [plan.date, range].filter(Boolean).join(' ')
}

function ChatProposal({ message, index, appliedKey, busy, canApply, t, onApply }) {
  const { proposal } = message
  const applied = appliedKey === index
  return h('div', {
    className: 'gantt-chat-proposal',
    'data-applied': applied ? 'true' : undefined,
  },
  h('div', { className: 'gantt-chat-proposal-head' },
    h('span', null, t('chat.proposal')),
    proposal.planDate ? h('span', { className: 'gantt-chat-proposal-date' }, proposal.planDate) : null,
  ),
  proposal.children.map((child, childIndex) => h('div', { key: childIndex, className: 'gantt-chat-child' },
    h('span', { className: 'gantt-chat-child-title' }, child.title),
    h('span', { className: 'gantt-chat-child-done' }, child.doneWhen),
    h('div', { className: 'gantt-chat-child-meta' },
      child.estimate ? h('span', null, child.estimate) : null,
      child.plan ? h('span', null, chatPlanLabel(child.plan)) : null,
    ),
  )),
  applied
    ? h('span', { className: 'gantt-chat-applied' }, t('chat.applied'))
    : h(React.Fragment, null,
      h('button', {
        className: 'gantt-btn gantt-btn-primary',
        type: 'button',
        disabled: busy || !canApply,
        onClick: () => onApply(message, index),
      }, t('chat.apply')),
      canApply ? null : h('span', { className: 'gantt-chat-note' }, t('chat.empty')),
    ),
  )
}

/** Right-hand AI decompose chat sidebar. */
export function ChatPanel({
  t,
  focusTask,
  focusRef,
  focusDepth,
  messages,
  busy,
  error,
  appliedKey,
  onClose,
  onClearFocus,
  onClear,
  onSend,
  onApply,
}) {
  const [draft, setDraft] = useState('')
  const canApply = focusTask !== null
  const send = () => {
    const message = draft.trim()
    if (message === '' || busy) return
    setDraft('')
    onSend(message)
  }
  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }
  return h('aside', { className: 'gantt-chat', 'aria-label': t('chat.title') },
    h('div', { className: 'gantt-chat-head' },
      h('span', { className: 'gantt-chat-title' }, t('chat.title')),
      h('button', {
        className: 'gantt-btn gantt-icon-btn',
        type: 'button',
        title: t('actions.close'),
        'aria-label': t('actions.close'),
        onClick: onClose,
      }, '×'),
    ),
    h('div', { className: 'gantt-chat-focus' },
      focusTask
        ? h(React.Fragment, null,
          h('span', { className: 'gantt-chat-focus-label' }, t('chat.focus')),
          h('span', { className: 'gantt-chat-chip' },
            h('span', { className: 'gantt-chat-chip-ref' }, focusRef),
            h('span', { className: 'gantt-chat-chip-title', title: focusTask.title }, focusTask.title),
          ),
          h('button', { className: 'gantt-btn gantt-chat-clear-focus', type: 'button', onClick: onClearFocus }, t('chat.clearFocus')),
        )
        : h('span', { className: 'gantt-chat-focus-none' }, t('chat.empty')),
      focusDepth >= 4 ? h('span', { className: 'gantt-chat-depth' }, t('chat.depth')) : null,
    ),
    h('div', { className: 'gantt-chat-body', role: 'log' },
      messages.length === 0 ? h('p', { className: 'gantt-chat-welcome' }, t('chat.welcome')) : null,
      messages.map((message, index) => h('div', {
        key: `${message.role}-${index}`,
        className: 'gantt-chat-msg',
        'data-role': message.role,
      },
      h('div', { className: 'gantt-chat-bubble' }, message.content),
      message.proposal
        ? h(ChatProposal, { message, index, appliedKey, busy, canApply, t, onApply })
        : null,
      )),
      error ? h('div', { className: 'gantt-chat-error' }, error) : null,
    ),
    h('div', { className: 'gantt-chat-compose' },
      h('textarea', {
        className: 'gantt-textarea gantt-chat-input',
        value: draft,
        placeholder: t('chat.placeholder'),
        'aria-label': t('chat.placeholder'),
        disabled: busy,
        onChange: event => setDraft(event.target.value),
        onKeyDown,
      }),
      h('div', { className: 'gantt-chat-compose-row' },
        busy ? h('span', { className: 'gantt-chat-sending' }, t('chat.sending')) : null,
        h('button', { className: 'gantt-btn', type: 'button', disabled: busy, onClick: onClear }, t('chat.clear')),
        h('button', {
          className: 'gantt-btn gantt-btn-primary',
          type: 'button',
          disabled: busy || draft.trim() === '',
          onClick: send,
        }, t('chat.send')),
      ),
    ),
  )
}
