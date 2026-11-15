import { StatusPill } from './status.js'
import { refIdOf } from './view.js'
import { h } from './dom.js'

/** One planned time block on the Today page. */
export function TodayBlock({ block, t, onCycle }) {
  const time = [block.startTime, block.endTime].filter(Boolean).join('–') || '—'
  return h('article', {
    className: 'today-block',
    'data-block-id': block.id,
    'data-slot': block.slot,
    'data-status': block.status,
    'data-source': block.source,
  },
  h('div', { className: 'today-block-time' }, time),
  h('div', { className: 'today-block-main' },
    h('div', { className: 'today-block-head' },
      block.source === 'task'
        ? h('span', { className: 'today-source-badge' }, t('today.fromTree'))
        : null,
      block.category ? h('span', { className: 'today-chip' }, block.category) : null,
      h('h4', { className: 'today-block-title', title: block.title }, block.title),
      h(StatusPill, {
        status: block.status,
        label: t(`planStatus.${block.status}`),
        interactive: true,
        title: t('today.statusHint'),
        onClick: () => onCycle(block),
      }),
    ),
    block.detail && block.detail !== block.title
      ? h('p', { className: 'today-block-detail' }, block.detail)
      : null,
    h('div', { className: 'today-block-meta' },
      block.landing ? h('span', { className: 'today-chip today-chip-muted' }, `⤷ ${block.landing}`) : null,
      block.estimate ? h('span', { className: 'today-chip today-chip-muted' }, block.estimate) : null,
      block.inspiration ? h('span', { className: 'today-chip today-chip-muted' }, block.inspiration) : null,
    ),
  ),
  )
}

/** One task-tree node in play on the Today page. */
export function TodayNode({ node, t }) {
  const range = [node.startDate, node.endDate].filter(Boolean).join(' – ')
  const links = Array.isArray(node.links) ? node.links : []
  return h('li', {
    className: 'today-node',
    'data-state': node.state || 'unknown',
    'data-kind': node.kind,
  },
  h('span', { className: 'today-node-id', title: node.ref || node.id }, node.ref ? refIdOf(node.ref) : node.id),
  h('span', { className: 'today-node-title', title: node.title }, node.title),
  node.state ? h('span', { className: 'today-chip' }, node.state) : null,
  node.lane ? h('span', { className: 'today-chip' }, node.lane) : null,
  range ? h('span', { className: 'today-node-range' }, range) : null,
  node.dep ? h('span', { className: 'today-chip today-chip-muted' }, node.dep) : null,
  node.landing
    ? h('span', { className: 'today-chip today-chip-muted', title: `${t('field.landing')}: ${node.landing}` }, `⤷ ${node.landing}`)
    : null,
  links.map(link => h('span', {
    key: `${link.type}:${link.ref}`,
    className: 'today-chip today-chip-muted',
    title: `${link.type}:${link.ref}`,
  }, link.label || link.ref)),
  )
}
