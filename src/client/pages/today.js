import React, { useCallback, useState } from 'react'
import { SLOT_ORDER } from '../constants.js'
import { addDays, formatDate, formatDateTime, formatWeekdayLong, todayIso } from '../dates.js'
import { requestJson, useLocale, useTodayData } from '../hooks.js'
import { TodayGlyph } from '../icons.js'
import { nextPlanStatus } from '../status.js'
import { CSS, CSS_TODAY } from '../styles/index.js'
import { TodayBlock, TodayNode } from '../today.js'
import { briefTimeRange, briefWindows, refIdOf } from '../view.js'
import { h } from '../dom.js'

/** The Today page: day plan blocks, status and nodes in play. */
export function TodayPage({ ctx }) {
  const { locale, t } = useLocale(ctx)
  const [date, setDate] = useState(() => todayIso())
  const { status, data, error, refresh } = useTodayData(date)
  const [notice, setNotice] = useState(null)
  const [writeError, setWriteError] = useState(null)
  const [importing, setImporting] = useState(false)
  const [briefBusy, setBriefBusy] = useState(false)
  const day = data?.day ?? null
  const blocks = data?.blocks ?? []
  const nodes = data?.nodes ?? []
  const integrity = data?.integrity ?? []
  const stats = data?.stats ?? { total: 0, done: 0, inProgress: 0, skipped: 0, remaining: 0 }
  const percent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
  const serverToday = data?.today || todayIso()
  const unplanned = day === null && blocks.length === 0
  const brief = data?.brief ?? null
  const briefRows = briefWindows(brief)
  const shiftDay = useCallback(direction => setDate(current => addDays(current, direction)), [])
  const goToday = useCallback(() => setDate(serverToday), [serverToday])
  const cycleStatus = useCallback(async (block) => {
    setNotice(null)
    setWriteError(null)
    try {
      await requestJson('api/gantt/plan/status', {
        method: 'POST',
        body: JSON.stringify({ id: block.id, status: nextPlanStatus(block.status) }),
      })
      refresh()
    } catch (failure) {
      setWriteError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [refresh])
  const importPlan = useCallback(async () => {
    setNotice(null)
    setWriteError(null)
    setImporting(true)
    try {
      await requestJson('api/gantt/plan/import', { method: 'POST', body: '{}' })
      setNotice(t('today.importDone'))
      refresh()
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      setWriteError(`${t('today.importFailed')}: ${message}`)
    } finally {
      setImporting(false)
    }
  }, [refresh, t])
  const recomputeBrief = useCallback(async () => {
    setNotice(null)
    setWriteError(null)
    setBriefBusy(true)
    try {
      await requestJson('api/gantt/brief/compute', {
        method: 'POST',
        body: JSON.stringify({ date }),
      })
      refresh()
    } catch (failure) {
      setWriteError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBriefBusy(false)
    }
  }, [date, refresh])
  const shell = children => h('div', { className: 'gantt-page today-page' },
    h('style', { key: 'gantt-css' }, CSS),
    h('style', { key: 'today-css' }, CSS_TODAY),
    children,
  )
  if (status === 'loading' && data === null) {
    return shell(h('div', { className: 'gantt-center' },
      h('span', { className: 'gantt-spinner' }),
      h('span', null, t('loading')),
    ))
  }
  if (status === 'error' && data === null) {
    return shell(h('div', { className: 'gantt-center' },
      h('div', { className: 'gantt-empty-title' }, t('error.title')),
      h('div', { className: 'gantt-empty-body' }, error),
      h('div', { className: 'gantt-empty-actions' },
        h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', onClick: refresh }, t('error.retry')),
        h('button', { className: 'gantt-btn', type: 'button', onClick: importPlan }, t('today.import')),
      ),
    ))
  }
  const header = h('header', { className: 'gantt-head' },
    h('div', { className: 'gantt-brand' },
      h('span', { className: 'gantt-brand-mark' }, h(TodayGlyph, { size: 22 })),
      h('div', { className: 'gantt-brand-text' },
        h('h1', { className: 'gantt-title' }, t('today.title')),
        h('p', { className: 'gantt-subtitle' }, t('today.subtitle')),
      ),
    ),
    h('div', { className: 'gantt-actions' },
      h('button', {
        className: 'gantt-btn gantt-icon-btn',
        type: 'button',
        title: t('today.prevDay'),
        'aria-label': t('today.prevDay'),
        onClick: () => shiftDay(-1),
      }, '‹'),
      h('span', { className: 'today-nav-date' }, formatDate(date, locale)),
      h('button', {
        className: 'gantt-btn gantt-icon-btn',
        type: 'button',
        title: t('today.nextDay'),
        'aria-label': t('today.nextDay'),
        onClick: () => shiftDay(1),
      }, '›'),
      h('button', { className: 'gantt-btn', type: 'button', onClick: goToday }, t('today.todayButton')),
      h('button', {
        className: 'gantt-btn gantt-icon-btn',
        type: 'button',
        title: t('today.refresh'),
        'aria-label': t('today.refresh'),
        disabled: status === 'refreshing',
        onClick: refresh,
      }, status === 'refreshing' ? '…' : '⟳'),
      h('button', {
        className: 'gantt-btn gantt-btn-primary',
        type: 'button',
        disabled: importing,
        onClick: importPlan,
      }, t('today.import')),
    ),
  )
  const meta = h('section', { className: 'gantt-stats today-meta' },
    h('div', { className: 'today-meta-date' },
      h('strong', null, formatDate(date, locale)),
      h('span', { className: 'today-weekday', title: t('today.weekdayLabel') }, formatWeekdayLong(date, locale)),
    ),
    day?.label ? h('span', { className: 'today-meta-label' }, day.label) : null,
    h('span', { className: 'today-market', 'data-open': day?.marketOpen ? 'true' : 'false' },
      day?.marketOpen ? t('today.open') : t('today.closed')),
    h('div', { className: 'gantt-stat-progress' },
      h('span', null, `${t('today.doneCount')} ${stats.done}/${stats.total}`),
      h('div', { className: 'gantt-progress' }, h('span', { style: { width: `${percent}%` } })),
      h('span', null, `${t('today.remaining')} ${stats.remaining}`),
    ),
  )
  const goal = day && day.coreGoal
    ? h('section', { className: 'today-goal' },
      h('span', { className: 'gantt-label' }, t('today.coreGoal')),
      h('p', { className: 'today-goal-text' }, day.coreGoal),
    )
    : null
  const briefGenerated = brief ? formatDateTime(brief.generatedAt, locale) : ''
  const briefMeta = [
    briefGenerated ? `${t('today.brief.generated')} ${briefGenerated}` : '',
    brief && brief.source ? t(`today.brief.source.${brief.source}`) : '',
  ].filter(Boolean).join(' · ')
  const briefSection = h('section', { className: 'today-brief', 'data-block': 'today-brief' },
    h('div', { className: 'today-brief-head' },
      h('h2', { className: 'today-section-title' }, t('today.brief.title')),
      h('div', { className: 'today-brief-actions' },
        briefMeta ? h('span', { className: 'today-brief-meta' }, briefMeta) : null,
        h('button', {
          className: 'gantt-btn',
          'data-action': 'recompute-brief',
          type: 'button',
          disabled: briefBusy,
          onClick: recomputeBrief,
        }, briefBusy ? '…' : t('today.brief.recompute')),
      ),
    ),
    !brief
      ? h('p', { className: 'today-muted' }, t('today.brief.empty'))
      : briefRows.length === 0
        ? h('p', { className: 'today-muted' }, t('brief.emptyWindows'))
        : h('div', { className: 'today-brief-list' },
          briefRows.map(({ window, item }, index) => {
            const role = item ? item.role : window.kind
            return h('div', {
              key: index,
              className: 'today-brief-row',
              'data-filled': item ? 'true' : 'false',
              'data-role': role,
            },
            h('span', { className: 'today-brief-time' }, briefTimeRange(window)),
            h('span', { className: 'today-brief-role', 'data-role': role }, t(`brief.role.${role}`)),
            h('span', { className: 'today-brief-track', title: item ? item.trackName : '' }, item ? item.trackName : '—'),
            item
              ? h('span', { className: 'today-brief-task', title: item.title },
                `${item.ref ? refIdOf(item.ref) : item.taskId} ${item.title}`)
              : h('span', { className: 'today-brief-unfilled' }, t('today.brief.unfilled')),
            )
          }),
        ),
  )
  const integritySection = integrity.length > 0
    ? h('section', { className: 'today-integrity' },
      h('div', { className: 'today-integrity-head' },
        h('h2', { className: 'today-section-title' }, t('today.integrityTitle')),
        h('button', { className: 'gantt-btn', type: 'button', disabled: importing, onClick: importPlan }, t('today.import')),
      ),
      h('ul', { className: 'today-integrity-list' },
        integrity.map(item => h('li', {
          key: `${item.code}:${item.blockId || ''}`,
          className: 'today-integrity-item',
          'data-code': item.code,
        }, t(`today.integrity.${item.code}`))),
      ),
    )
    : null
  const content = unplanned
    ? h('div', { className: 'gantt-empty-wrap' },
      h('div', { className: 'gantt-empty' },
        h('span', { className: 'gantt-empty-icon' }, h(TodayGlyph, { size: 26 })),
        h('div', { className: 'gantt-empty-title' }, t('today.emptyTitle')),
        h('div', { className: 'gantt-empty-body' }, t('today.emptyHint')),
        h('div', { className: 'gantt-empty-actions' },
          h('button', { className: 'gantt-btn gantt-btn-primary', type: 'button', disabled: importing, onClick: importPlan }, t('today.emptyAction')),
        ),
      ),
    )
    : h(React.Fragment, null,
      h('section', { className: 'today-blocks' },
        h('h2', { className: 'today-section-title' }, t('today.blocks')),
        blocks.length === 0
          ? h('p', { className: 'today-muted' }, t('today.emptyDay'))
          : SLOT_ORDER.map((slot) => {
            const list = blocks.filter(block => block.slot === slot)
            return list.length === 0 ? null : h('section', {
              key: slot,
              className: 'today-slot',
              'data-slot': slot,
            },
            h('h3', { className: 'today-slot-title' },
              h('span', null, t(`slot.${slot}`)),
              h('span', { className: 'today-slot-count' }, list.length),
            ),
            list.map(block => h(TodayBlock, { key: block.id, block, t, onCycle: cycleStatus })),
            )
          }),
      ),
      h('section', { className: 'today-nodes' },
        h('h2', { className: 'today-section-title' }, t('today.nodes')),
        nodes.length === 0
          ? h('p', { className: 'today-muted' }, t('today.nodesEmpty'))
          : h('ul', { className: 'today-node-list' },
            nodes.map(node => h(TodayNode, { key: node.id, node, t })),
          ),
      ),
    )
  return shell(h(React.Fragment, null,
    header,
    h('div', { className: 'today-body' },
      meta,
      error && data
        ? h('div', { className: 'gantt-banner' },
          h('span', null, error),
          h('button', { className: 'gantt-btn', type: 'button', onClick: refresh }, t('error.retry')),
        )
        : null,
      writeError ? h('div', { className: 'gantt-banner' }, h('span', null, writeError)) : null,
      goal,
      briefSection,
      integritySection,
      content,
    ),
    notice ? h('div', { className: 'gantt-toast', role: 'status' }, notice) : null,
  ))
}
