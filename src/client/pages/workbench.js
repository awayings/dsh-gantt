// Workbench tab body: the focused task's dedicated work conversation and its
// trajectory, plus the host skills and the conversation's subagent team. In
// work mode a task click focuses the task and reveals this tab instead of
// navigating away, so the panel also hosts the execute/decompose entry points
// that create the conversation, queue the starting prompt (with the user's
// optional instructions), and open it in a new browser window. A Send entry
// delivers the editor text alone. Data is read
// through the authenticated JSON API plus the client session snapshots; the
// component never polls and never throws into render, so a failing endpoint is
// a panel-level message instead of a crashed sidebar.
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { sessionDisplay } from '../../shared/session.js'
import { agentLabel, loadAgentNames, reportPreview, reportText } from '../agent-labels.js'
import { localeTag } from '../dates.js'
import { h } from '../dom.js'
import { requestJson, useLocale } from '../hooks.js'
import { Markdown } from '../markdown.js'
import { CSS_WORKBENCH } from '../styles/workbench.js'
import { conversationState, useSessionStatuses } from '../session-status.js'
import { openSessionWindow, sendSessionToWindow } from '../session-window.js'
import {
  loadWork,
  openWorkTask,
  sendWorkPrompt,
  subscribeWorkFocus,
  workFocusRevisionSnapshot,
} from '../work-nav.js'

/** Sub-tab identifiers, in presentation order. */
const WORK_TABS = ['task', 'skills', 'team']

/** Empty trajectory payload for a workbench without a focused task. */
const NO_TRAJECTORY = { events: [], error: null }

function failureMessage(failure) {
  return failure instanceof Error ? failure.message : String(failure)
}

/** Compose the fixed starting prompt with the user's optional instructions. A
 * blank editor contributes nothing, so the base prompt stays byte-identical to
 * the pre-editor behavior and tests keep their stable expectation. */
function composePrompt(base, extra) {
  return extra === '' ? base : `${base}\n\n${extra}`
}

/** Localized wall-clock time for an ISO timestamp or epoch milliseconds. */
function shortTime(value, locale) {
  if (value === null || value === undefined || value === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(localeTag(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

async function fetchTrajectory(taskId) {
  try {
    const body = await requestJson(`api/gantt/trajectory?taskId=${encodeURIComponent(taskId)}&limit=20`)
    return { events: Array.isArray(body.events) ? body.events : [], error: null }
  } catch (failure) {
    return { events: [], error: failureMessage(failure) }
  }
}

async function fetchSkills() {
  try {
    const body = await requestJson('api/gantt/work/skills')
    return {
      available: body.available !== false,
      skills: Array.isArray(body.skills) ? body.skills : [],
      error: null,
    }
  } catch (failure) {
    return { available: true, skills: [], error: failureMessage(failure) }
  }
}

async function fetchTeam(sessionId) {
  try {
    const body = await requestJson(`api/gantt/work/team?sessionId=${encodeURIComponent(sessionId)}`)
    return {
      available: body.available !== false,
      agents: Array.isArray(body.agents) ? body.agents : [],
      error: typeof body.error === 'string' ? body.error : null,
    }
  } catch (failure) {
    return { available: true, agents: [], error: failureMessage(failure) }
  }
}

function optionalService(ctx, name) {
  if (!ctx) return undefined
  if (typeof ctx.get === 'function') return ctx.get(name)
  return ctx[name]
}

/** The dedicated conversation's list row, or null when it is not listed yet. */
function sessionSummary(ctx, sessionId) {
  if (sessionId === null || sessionId === '') return null
  const sessions = optionalService(ctx, 'sessions')
  if (sessions === undefined) return null
  return sessions.list.getSnapshot().byId[sessionId] ?? null
}

function sessionTitle(summary) {
  if (summary === null) return ''
  return summary.displayTitle || summary.title || ''
}

/** Compact trajectory list; a session label opens that conversation in place. */
function trajectoryList(trajectory, t, locale, openSession) {
  if (trajectory.error !== null) {
    return h('p', { className: 'gantt-workbench-error', role: 'status' }, t('workbench.error.trajectory'))
  }
  if (trajectory.events.length === 0) {
    return h('p', { className: 'gantt-workbench-empty' }, t('workbench.task.noTrajectory'))
  }
  return trajectory.events.map((event, index) => h('div', {
    key: String(index),
    className: 'gantt-workbench-row',
    'data-action': event.action,
    title: event.sessionId,
  },
  h('span', { className: 'gantt-workbench-row-action' }, t(`panel.action.${event.action}`)),
  typeof event.turn === 'number'
    ? h('span', { className: 'gantt-workbench-row-turn' }, t('panel.turn').replace('{n}', String(event.turn)))
    : null,
  h('span', { className: 'gantt-workbench-row-time' }, shortTime(event.at, locale)),
  event.sessionId === ''
    ? null
    : openSession === null
      ? h('span', { className: 'gantt-workbench-row-session', title: event.sessionId },
        sessionDisplay(event.sessionId, event.sessionTitle))
      : h('button', {
        className: 'gantt-workbench-row-session',
        type: 'button',
        title: t('panel.openSession'),
        'aria-label': t('panel.openSession'),
        onClick: () => openSession(event.sessionId),
      }, sessionDisplay(event.sessionId, event.sessionTitle)),
  event.detail
    ? h('span', { className: 'gantt-workbench-row-detail', title: event.detail }, event.detail)
    : null,
  ))
}

/** One read-only write-back row: a field label and its resolved value. */
function writebackRow(field, label, value, title = value) {
  return h('div', { className: 'gantt-workbench-writeback-row', 'data-field': field },
    h('span', { className: 'gantt-workbench-writeback-label' }, label),
    h('span', { className: 'gantt-workbench-writeback-value', title }, value),
  )
}

/** The operator, the completer, and the completion report of a task. */
function writebackBlock(task, names, t) {
  const report = reportText(task.report, t)
  return h('section', { className: 'gantt-workbench-writeback', 'data-block': 'writeback' },
    writebackRow('operator', t('field.operator'), agentLabel(names, task.operatorId, t)),
    writebackRow('completedBy', t('field.completedBy'), agentLabel(names, task.completedById, t)),
    writebackRow('report', t('field.report'), reportPreview(report, 160), report),
  )
}

/** Read-only markdown task description with a fixed-height scroll area. */
function descriptionBlock(task, t) {
  return h('section', { className: 'gantt-workbench-description', 'data-block': 'description' },
    h('div', { className: 'gantt-workbench-chat-head' },
      h('span', { className: 'gantt-workbench-chat-title' }, t('workbench.task.description')),
    ),
    h(Markdown, {
      text: task.description,
      className: 'gantt-workbench-description-body',
      empty: h('p', { className: 'gantt-workbench-empty' }, t('workbench.task.noDescription')),
    }),
  )
}

/** Full task view: the bound conversation (or its execute entry), the editable
 * prompt, the markdown description, the read-only write-back rows, and the
 * trajectory. */
function taskPanel({
  work, trajectory, names, action, locale, t, statuses, prompt, openSession,
  onPromptChange, onExecute, onDecompose, onSend, onOpenWindow,
}) {
  if (work.task === null) {
    return section('task', h('p', { className: 'gantt-workbench-empty' }, t('workbench.focusNone')))
  }
  const summary = sessionSummary(work.ctx, work.sessionId)
  const conversation = work.sessionId === null ? null : conversationState(statuses, work.sessionId, summary?.running === true)
  const conversationBlock = work.sessionId === null
    ? h('div', { className: 'gantt-workbench-chat-block', 'data-block': 'chat-session' },
      h('span', { className: 'gantt-workbench-chat-title' }, t('workbench.task.noConversation')),
    )
    : h('div', { className: 'gantt-workbench-chat-block', 'data-block': 'chat-session' },
      h('span', { className: 'gantt-workbench-chat-title' }, sessionDisplay(work.sessionId, sessionTitle(summary))),
      h('span', {
        className: 'gantt-workbench-chat-state',
        'data-running': conversation === 'running' ? 'true' : 'false',
        'data-waiting': conversation === 'waiting' ? 'true' : undefined,
      }, t(`workbench.task.state.${conversation}`)),
      h('span', { className: 'gantt-workbench-chat-updated' },
        t('workbench.task.updated').replace('{time}', shortTime(summary?.updatedAt, locale))),
    )
  const buttons = h(React.Fragment, null,
    h('button', {
      className: 'gantt-workbench-btn',
      type: 'button',
      'data-action': 'execute',
      disabled: action.busy,
      onClick: onExecute,
    }, action.busy && action.kind === 'execute'
      ? t('workbench.task.executing')
      : t('workbench.task.execute')),
    h('button', {
      className: 'gantt-workbench-btn',
      type: 'button',
      'data-action': 'decompose',
      disabled: action.busy,
      onClick: onDecompose,
    }, action.busy && action.kind === 'decompose'
      ? t('workbench.task.decomposing')
      : t('workbench.task.decompose')),
    h('button', {
      className: 'gantt-workbench-btn',
      type: 'button',
      'data-action': 'send',
      disabled: action.busy || prompt.trim() === '',
      onClick: onSend,
    }, action.busy && action.kind === 'send'
      ? t('workbench.task.sending')
      : t('workbench.task.send')),
    work.sessionId === null
      ? null
      : h(React.Fragment, null,
        h('button', {
          className: 'gantt-workbench-btn',
          type: 'button',
          'data-action': 'open-conversation',
          disabled: action.busy,
          onClick: () => openSession?.(work.sessionId),
        }, t('workbench.task.open')),
        h('button', {
          className: 'gantt-workbench-btn',
          type: 'button',
          'data-action': 'open-window',
          disabled: action.busy,
          onClick: onOpenWindow,
        }, t('workbench.task.openWindow')),
      ),
  )
  return section('task', h('div', { className: 'gantt-workbench-task' },
    h('section', { className: 'gantt-workbench-conversation', 'data-block': 'conversation' },
      h('div', { className: 'gantt-workbench-chat-head' },
        h('span', { className: 'gantt-workbench-chat-title' }, t('workbench.task.conversation')),
      ),
      conversationBlock,
      action.error !== null
        ? h('p', { className: 'gantt-workbench-error', role: 'status' },
          `${t(action.stage === 'prompt' ? 'workbench.task.promptError' : 'work.error')} ${action.error}`)
        : null,
      h('label', { className: 'gantt-workbench-prompt' },
        h('span', { className: 'gantt-workbench-prompt-label' }, t('workbench.task.promptLabel')),
        h('textarea', {
          className: 'gantt-workbench-prompt-input',
          'data-field': 'prompt',
          rows: 3,
          value: prompt,
          placeholder: t('workbench.task.promptPlaceholder'),
          onChange: event => onPromptChange(event.target.value),
        }),
      ),
      h('div', { className: 'gantt-workbench-chat-actions' }, buttons),
    ),
    descriptionBlock(work.task, t),
    writebackBlock(work.task, names, t),
    h('section', { className: 'gantt-workbench-conversation', 'data-block': 'trajectory' },
      h('div', { className: 'gantt-workbench-chat-head' },
        h('span', { className: 'gantt-workbench-chat-title' }, t('workbench.task.trajectory')),
      ),
      trajectoryList(trajectory, t, locale, openSession),
    ),
  ))
}

function skillsPanel(skills, t) {
  let content
  if (skills.error !== null) {
    content = h('p', { className: 'gantt-workbench-error', role: 'status' }, t('workbench.error.skills'))
  } else if (skills.available === false) {
    content = h('p', { className: 'gantt-workbench-empty' }, t('workbench.unavailable.skills'))
  } else if (skills.skills.length === 0) {
    content = h('p', { className: 'gantt-workbench-empty' }, t('workbench.empty.skills'))
  } else {
    content = h('ul', { className: 'gantt-workbench-list' }, skills.skills.map((skill, index) => h('li', {
      key: String(index),
      className: 'gantt-workbench-item',
      'data-skill-name': skill.name,
    },
    h('div', { className: 'gantt-workbench-item-head' },
      h('span', { className: 'gantt-workbench-item-name', title: skill.name }, skill.name),
      skill.source ? h('span', { className: 'gantt-workbench-item-source' }, skill.source) : null,
    ),
    skill.description
      ? h('p', { className: 'gantt-workbench-item-description' }, skill.description)
      : null,
    )))
  }
  return section('skills', content)
}

function teamPanel(team, t, openAgent) {
  let content
  if (team.error !== null) {
    content = h('p', { className: 'gantt-workbench-error', role: 'status' }, t('workbench.error.team'))
  } else if (team.available === false) {
    content = h('p', { className: 'gantt-workbench-empty' }, t('workbench.unavailable.team'))
  } else if (team.agents.length === 0) {
    content = h('p', { className: 'gantt-workbench-empty' }, t('workbench.empty.team'))
  } else {
    content = h('ul', { className: 'gantt-workbench-list' }, team.agents.map((agent, index) => h('li', {
      key: String(index),
      className: 'gantt-workbench-item',
      'data-agent-id': agent.id,
    },
    h('div', { className: 'gantt-workbench-item-head' },
      h('span', { className: 'gantt-workbench-item-name', title: agent.id }, agent.label || agent.id),
      h('span', { className: 'gantt-workbench-item-mode' }, t(`workbench.team.mode.${agent.mode}`)),
    ),
    openAgent === null
      ? null
      : h('div', { className: 'gantt-workbench-item-actions' },
        h('button', {
          className: 'gantt-workbench-btn',
          type: 'button',
          'data-action': 'open-agent',
          onClick: () => openAgent(agent.id),
        }, t('workbench.team.open')),
      ),
    )))
  }
  return section('team', content)
}

function section(name, content) {
  return h('section', { className: 'gantt-workbench-panel', 'data-panel': name }, content)
}

/**
 * Workbench body for the conversation sidebar and the Gantt page's task panel:
 * one task's dedicated conversation, its trajectory, the available skills, and
 * the subagent team. Without a `taskId` the panel follows the conversation's
 * focused task; the in-page panel pins the task the user just activated.
 * A valid `tab` turns the sub-tabs controlled: the rendered tab follows the
 * prop and a click only reports the requested name through `onTabChange`, so a
 * host can restore and persist the active tab. Without a valid `tab` the panel
 * keeps its own state.
 * @param {{
 *   ctx: any,
 *   scope?: { sessionId?: string },
 *   visible?: boolean,
 *   taskId?: string | null,
 *   onClose?: (() => void) | null,
 *   tab?: string | null,
 *   onTabChange?: ((name: string) => void) | null,
 * }} props
 * @returns {any} the rendered workbench element
 */
export function GanttWorkbench({
  ctx, scope, visible = true, taskId = null, onClose = null, tab = null, onTabChange = null,
}) {
  const { locale, t } = useLocale(ctx)
  const sessionId = scope?.sessionId ?? ''
  const targetTaskId = typeof taskId === 'string' && taskId !== '' ? taskId : null
  const statuses = useSessionStatuses(ctx)
  const focusRevision = useSyncExternalStore(subscribeWorkFocus, workFocusRevisionSnapshot, workFocusRevisionSnapshot)
  // A pinned task panel always shows the task the user activated; only the
  // conversation sidebar's workbench follows the focus revision.
  const followFocus = targetTaskId === null ? focusRevision : 0
  const [internalTab, setInternalTab] = useState('task')
  const controlledTab = typeof tab === 'string' && WORK_TABS.includes(tab)
  const activeTab = controlledTab ? tab : internalTab
  const [revision, setRevision] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [state, setState] = useState({ status: 'loading', work: null, panels: null, error: null })
  const [action, setAction] = useState({ busy: false, error: null, kind: null, stage: 'conversation' })
  const mounted = useRef(true)
  const refresh = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => () => {
    mounted.current = false
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    let active = true
    const load = async () => {
      try {
        const work = await loadWork(targetTaskId === null ? { sessionId } : { taskId: targetTaskId })
        if (!active) return
        const [trajectory, skills, team, names] = await Promise.all([
          work.task === null ? NO_TRAJECTORY : fetchTrajectory(work.task.id),
          fetchSkills(),
          fetchTeam(work.sessionId ?? sessionId),
          loadAgentNames(),
        ])
        if (!active) return
        setState({ status: 'ready', work, panels: { trajectory, skills, team, names }, error: null })
      } catch (failure) {
        if (active) setState({ status: 'error', work: null, panels: null, error: failureMessage(failure) })
      }
    }
    load()
    return () => {
      active = false
    }
  }, [sessionId, targetTaskId, revision, visible, followFocus])

  useEffect(() => {
    if (!visible) return undefined
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [visible, refresh])

  const workspace = optionalService(ctx, 'uiWorkspace')
  const openSession = typeof workspace?.openSession === 'function'
    ? target => workspace.openSession(target)
    : null
  /**
   * Start one task turn: reuse or create the bound conversation, queue the
   * composed prompt through the session scope, then hand the conversation to
   * a new window so the running turn is visible. The prompt reaches the Host
   * before navigation, so a blocked popup still starts the work. A successful
   * turn clears the optional editor; a failed one keeps the user's text.
   *
   * All three entries resolve the conversation through `openWorkTask({open:
   * false})` even when one is already bound: that call re-reads the binding and
   * refreshes the conversation's focus to this task before the prompt is queued.
   * Sending without it leaves the conversation focused on whatever task it saw
   * last, so the next runtime-context snapshot describes the wrong task.
   * @param {'execute' | 'decompose' | 'send'} kind
   * @param {string} text
   * @returns {Promise<void>}
   */
  const runPrompt = async (kind, text) => {
    const work = state.work
    if (work?.task === null || work?.task === undefined) return
    const win = openSessionWindow()
    setAction({ busy: true, error: null, kind, stage: 'conversation' })
    let stage = 'conversation'
    try {
      const target = (await openWorkTask(ctx, work.task, { open: false })).sessionId
      stage = 'prompt'
      await sendWorkPrompt(ctx, target, text)
      stage = 'open'
      if (!sendSessionToWindow(win, target)) {
        if (win) win.close()
        if (openSession === null) throw new Error(t('workbench.task.noWindow'))
        openSession(target)
      }
      if (!mounted.current) return
      setPrompt('')
      setAction({ busy: false, error: null, kind: null, stage: 'conversation' })
      refresh()
    } catch (failure) {
      if (win) win.close()
      if (mounted.current) setAction({ busy: false, error: failureMessage(failure), kind: null, stage })
    }
  }
  const extra = prompt.trim()
  const execute = () => runPrompt('execute', composePrompt(t('workbench.prompt.execute'), extra))
  const decompose = () => runPrompt('decompose', composePrompt(t('workbench.prompt.decompose'), extra))
  const send = () => (extra === '' ? undefined : runPrompt('send', extra))
  const openInWindow = () => {
    const work = state.work
    const win = openSessionWindow()
    if (!sendSessionToWindow(win, work.sessionId)) {
      if (win) win.close()
      openSession?.(work.sessionId)
    }
  }

  const work = state.work
  const task = work === null ? null : work.task
  const header = h('header', { className: 'gantt-workbench-head' },
    task === null
      ? h('span', { className: 'gantt-workbench-none' }, t('workbench.focusNone'))
      : h('span', { className: 'gantt-workbench-chip', title: task.title },
        h('span', { className: 'gantt-workbench-chip-ref' }, String(task.number ?? task.ref ?? '')),
        h('span', { className: 'gantt-workbench-chip-title', title: task.title }, task.title),
      ),
    h('button', {
      className: 'gantt-workbench-btn',
      type: 'button',
      'data-action': 'refresh',
      title: t('actions.refresh'),
      'aria-label': t('actions.refresh'),
      onClick: refresh,
    }, '⟳'),
    onClose === null
      ? null
      : h('button', {
        className: 'gantt-workbench-btn',
        type: 'button',
        'data-action': 'close-panel',
        title: t('actions.close'),
        'aria-label': t('actions.close'),
        onClick: onClose,
      }, '×'),
  )

  const tabs = h('nav', { className: 'gantt-workbench-tabs', role: 'tablist' },
    WORK_TABS.map(name => h('button', {
      key: name,
      className: 'gantt-workbench-tab',
      type: 'button',
      role: 'tab',
      'data-work-tab': name,
      'data-active': activeTab === name ? 'true' : undefined,
      'aria-selected': activeTab === name ? 'true' : 'false',
      onClick: () => (controlledTab ? onTabChange?.(name) : setInternalTab(name)),
    }, t(`workbench.tab.${name}`))),
  )

  let body
  if (state.status === 'error') {
    body = h('div', { className: 'gantt-workbench-state' },
      h('p', { className: 'gantt-workbench-message' }, t('workbench.error')),
      h('p', { className: 'gantt-workbench-error' }, state.error),
      h('button', {
        className: 'gantt-workbench-btn',
        type: 'button',
        'data-action': 'retry',
        onClick: refresh,
      }, t('workbench.retry')),
    )
  } else if (state.status === 'loading') {
    body = h('div', { className: 'gantt-workbench-state' },
      h('p', { className: 'gantt-workbench-message' }, t('workbench.loading')),
    )
  } else {
    body = h('div', { className: 'gantt-workbench-body' },
      activeTab === 'task'
        ? taskPanel({
          work: { ...state.work, ctx },
          trajectory: state.panels.trajectory,
          names: state.panels.names,
          action,
          locale,
          t,
          statuses,
          prompt,
          openSession,
          onPromptChange: setPrompt,
          onExecute: execute,
          onDecompose: decompose,
          onSend: send,
          onOpenWindow: openInWindow,
        })
        : activeTab === 'skills'
          ? skillsPanel(state.panels.skills, t)
          : teamPanel(state.panels.team, t, openSession),
    )
  }

  return h('div', { className: 'gantt-workbench' },
    h('style', { key: 'workbench-css' }, CSS_WORKBENCH),
    header,
    tabs,
    body,
  )
}
