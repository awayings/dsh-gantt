import { DAY_MS } from './constants.js'
import { addDays, addMonths, daysInMonth, formatDate, formatMonthYear, isoToDay, startOfMonth, startOfWeek } from './dates.js'

function groupUnits(units, keyLength) {
  const groups = []
  for (const unit of units) {
    const key = unit.startIso.slice(0, keyLength)
    let group = groups[groups.length - 1]
    if (!group || group.key !== key) {
      group = { key, startIso: unit.startIso, width: 0 }
      groups.push(group)
    }
    group.width += unit.width
  }
  return groups
}

/** Timeline window (week or month scale) anchored on an ISO date. */
export function buildWindow(scale, anchor, today) {
  const pxPerDay = scale === 'week' ? 36 : 3.2
  if (scale === 'week') {
    const start = addDays(startOfWeek(anchor), -7)
    const totalDays = 28
    const startMs = isoToDay(start)
    const endMs = startMs + totalDays * DAY_MS
    const units = []
    for (let index = 0; index < totalDays; index += 1) {
      const iso = addDays(start, index)
      const weekday = new Date(isoToDay(iso)).getUTCDay()
      units.push({
        key: iso,
        startIso: iso,
        width: pxPerDay,
        isWeekend: weekday === 0 || weekday === 6,
        isToday: iso === today,
      })
    }
    const groups = groupUnits(units, 7)
    const boundaries = []
    for (let index = 1; index < totalDays; index += 1) {
      const iso = addDays(start, index)
      const weekday = new Date(isoToDay(iso)).getUTCDay()
      boundaries.push({
        x: index * pxPerDay,
        strong: weekday === 1 || iso.endsWith('-01'),
      })
    }
    const todayMs = isoToDay(today)
    return {
      scale,
      start,
      endExclusive: addDays(start, totalDays),
      startMs,
      endMs,
      totalDays,
      pxPerDay,
      totalWidth: totalDays * pxPerDay,
      units,
      groups,
      boundaries,
      todayX: todayMs >= startMs && todayMs < endMs ? ((todayMs - startMs) / DAY_MS) * pxPerDay : null,
    }
  }
  const first = addMonths(startOfMonth(anchor), -3)
  const units = []
  const boundaries = []
  let totalWidth = 0
  let totalDays = 0
  for (let index = 0; index < 12; index += 1) {
    const iso = addMonths(first, index)
    const days = daysInMonth(iso)
    const width = days * pxPerDay
    if (index > 0) {
      boundaries.push({ x: totalWidth, strong: iso.slice(5, 7) === '01' })
    }
    units.push({
      key: iso,
      startIso: iso,
      width,
      isWeekend: false,
      isToday: today.slice(0, 7) === iso.slice(0, 7),
    })
    totalWidth += width
    totalDays += days
  }
  const groups = groupUnits(units, 4)
  const startMs = isoToDay(first)
  const endMs = startMs + totalDays * DAY_MS
  const todayMs = isoToDay(today)
  return {
    scale,
    start: first,
    endExclusive: addDays(first, totalDays),
    startMs,
    endMs,
    totalDays,
    pxPerDay,
    totalWidth,
    units,
    groups,
    boundaries,
    todayX: todayMs >= startMs && todayMs < endMs ? ((todayMs - startMs) / DAY_MS) * pxPerDay : null,
  }
}

/** Localized label for the visible timeline window. */
export function windowTitle(timeline, locale) {
  if (timeline.scale === 'week') {
    return `${formatDate(timeline.start, locale)} – ${formatDate(addDays(timeline.endExclusive, -1), locale)}`
  }
  return `${formatMonthYear(timeline.start, locale)} – ${formatMonthYear(addDays(timeline.endExclusive, -1), locale)}`
}
