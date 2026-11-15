import { useState } from 'react'
import { h } from './dom.js'
import { formatDateTime } from './dates.js'
import { briefTimeRange, briefWindows, refIdOf } from './view.js'

/** Frontier / next brief strip with today windows and the fold toggle. */
export function BriefStrip({ dailyBrief, pending, t, locale, onReveal, onRecompute, recomputing }) {
  const [collapsed, setCollapsed] = useState(false)
  if (!dailyBrief) return null
  const tracks = Array.isArray(dailyBrief.tracks) ? dailyBrief.tracks : []
  const windows = briefWindows(dailyBrief)
  const generated = formatDateTime(dailyBrief.generatedAt, locale)
  const frontierCount = tracks.filter(track => track.frontier).length
  const nextCount = tracks.filter(track => track.next).length
  const filledCount = windows.filter(({ item }) => item).length
  const pick = (entry, kind) => (entry
    ? h('button', {
      type: 'button',
      className: 'gantt-brief-pick',
      'data-kind': kind,
      title: `${entry.number || refIdOf(entry.ref)} ${entry.title}`,
      onClick: () => onReveal(entry.id),
    },
    h('span', { className: 'gantt-brief-tag' }, t(kind === 'frontier' ? 'brief.col.frontier' : 'brief.col.next')),
    h('span', { className: 'gantt-brief-id' }, entry.number || refIdOf(entry.ref)),
    h('span', { className: 'gantt-brief-name' }, entry.title),
    )
    : h('span', { className: 'gantt-brief-none' }, '—'))
  const lanes = tracks.length > 0
    ? h('div', { className: 'gantt-brief-lanes', role: 'table', 'aria-label': t('brief.title') },
      h('div', { className: 'gantt-brief-lanes-head', role: 'row' },
        h('span', { className: 'gantt-brief-col', role: 'columnheader', 'data-kind': 'track' }, t('brief.col.track')),
        h('span', { className: 'gantt-brief-col', role: 'columnheader', 'data-kind': 'frontier' }, t('brief.col.frontier')),
        h('span', { className: 'gantt-brief-col', role: 'columnheader', 'data-kind': 'next' }, t('brief.col.next')),
      ),
      tracks.map((track, index) => h('div', {
        key: index,
        className: 'gantt-brief-lane',
        role: 'row',
        'data-role': track.role,
      },
      h('span', { className: 'gantt-brief-lane-name', role: 'cell', title: track.name }, track.name),
      h('span', { className: 'gantt-brief-cell', role: 'cell' }, pick(track.frontier, 'frontier')),
      h('span', { className: 'gantt-brief-cell', role: 'cell' }, pick(track.next, 'next')),
      )),
    )
    : null
  const todayBlock = h('div', { className: 'gantt-brief-today', 'data-block': 'today' },
    h('span', { className: 'gantt-brief-title' }, t('brief.today')),
    windows.length === 0
      ? h('p', { className: 'gantt-brief-empty' }, t('brief.emptyWindows'))
      : h('div', { className: 'gantt-brief-windows' }, windows.map(({ window, item }, index) => {
        const role = item ? item.role : window.kind
        return h('div', {
          key: index,
          className: 'gantt-brief-window',
          'data-filled': item ? 'true' : 'false',
          'data-role': role,
        },
        h('div', { className: 'gantt-brief-window-head' },
          h('span', { className: 'gantt-brief-window-time' }, briefTimeRange(window)),
          h('span', { className: 'gantt-brief-role', 'data-role': role }, t(`brief.role.${role}`)),
        ),
        item
          ? h('button', {
            type: 'button',
            className: 'gantt-brief-window-task',
            title: `${item.ref || item.taskId} ${item.title}`,
            onClick: () => onReveal(item.taskId),
          },
          h('span', { className: 'gantt-brief-window-ref' }, refIdOf(item.ref)),
          h('span', { className: 'gantt-brief-window-name' }, item.title),
          )
          : h('span', { className: 'gantt-brief-unfilled' }, t('brief.unfilled')),
        )
      })),
  )
  return h('section', {
    className: 'gantt-brief',
    'data-collapsed': collapsed ? 'true' : 'false',
  },
  h('div', { className: 'gantt-brief-head', 'data-block': 'head' },
    h('button', {
      className: 'gantt-btn gantt-icon-btn gantt-brief-toggle',
      type: 'button',
      'data-action': 'brief-toggle',
      'aria-expanded': collapsed ? 'false' : 'true',
      title: collapsed ? t('brief.expand') : t('brief.collapse'),
      'aria-label': collapsed ? t('brief.expand') : t('brief.collapse'),
      onClick: () => setCollapsed(current => !current),
    }, collapsed ? '▸' : '▾'),
    h('span', { className: 'gantt-brief-title' }, t('brief.title')),
    typeof pending === 'number'
      ? h('span', { className: 'gantt-brief-pending' }, `${pending} ${t('brief.pending')}`)
      : null,
    generated ? h('span', { className: 'gantt-brief-computed' }, `${t('brief.computed')} ${generated}`) : null,
    collapsed
      ? h('span', { className: 'gantt-brief-summary' },
        h('span', { className: 'gantt-brief-summary-frontier' }, `${t('brief.col.frontier')} ${frontierCount}`),
        h('span', null, ' · '),
        h('span', { className: 'gantt-brief-summary-next' }, `${t('brief.col.next')} ${nextCount}`),
        h('span', null, ' · '),
        h('span', null, `${t('actions.today')} ${filledCount}/${windows.length}`),
      )
      : null,
    h('button', {
      className: 'gantt-btn gantt-brief-recompute',
      type: 'button',
      'data-action': 'recompute-brief',
      disabled: recomputing,
      onClick: onRecompute,
    }, recomputing ? '…' : t('brief.recompute')),
  ),
  collapsed ? null : lanes,
  collapsed ? null : todayBlock,
  )
}
