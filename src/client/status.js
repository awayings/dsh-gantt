import { PLAN_STATUSES } from '../shared/vocabulary.js'
import { STATUS_COLOR } from './constants.js'
import { h } from './dom.js'

/** Next status in the plan-block cycle (unknown values restart at todo). */
export function nextPlanStatus(status) {
  const index = PLAN_STATUSES.indexOf(status)
  return PLAN_STATUSES[(index + 1) % PLAN_STATUSES.length]
}

/** Renders an interactive status pill. */
export function StatusPill({ status, label, interactive, onClick, title }) {
  const tag = interactive ? 'button' : 'span'
  return h(tag, {
    className: 'gantt-status',
    'data-status': status,
    'data-interactive': interactive ? 'true' : undefined,
    style: { '--st': STATUS_COLOR[status] || STATUS_COLOR.todo },
    type: interactive ? 'button' : undefined,
    onClick: interactive ? (event) => {
      event.stopPropagation()
      onClick()
    } : undefined,
    title,
  }, h('span', { className: 'gantt-status-dot' }), h('span', { className: 'gantt-status-label' }, label))
}
