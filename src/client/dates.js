import { DAY_MS } from './constants.js'

function pad(value) {
  return String(value).padStart(2, '0')
}

/** Task-day aware ISO date for a Date object (local calendar fields). */
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** UTC epoch milliseconds for an ISO date, used for date-only maths. */
export function isoToDay(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/** ISO date for UTC epoch milliseconds. */
export function dayToIso(day) {
  const date = new Date(day)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** Shift an ISO date by whole days. */
export function addDays(iso, days) {
  return dayToIso(isoToDay(iso) + days * DAY_MS)
}

/** Monday of the ISO date week. */
export function startOfWeek(iso) {
  const day = isoToDay(iso)
  const weekday = new Date(day).getUTCDay()
  return dayToIso(day - ((weekday + 6) % 7) * DAY_MS)
}

/** First day of the ISO date month. */
export function startOfMonth(iso) {
  return `${iso.slice(0, 7)}-01`
}

/** Number of days in the ISO date month. */
export function daysInMonth(iso) {
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Shift an ISO date by whole months, clamping the day. */
export function addMonths(iso, months) {
  const date = new Date(isoToDay(iso))
  const targetMonth = date.getUTCMonth() + months
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  const first = `${targetYear}-${pad(normalizedMonth + 1)}-01`
  const day = Math.min(date.getUTCDate(), daysInMonth(first))
  return `${targetYear}-${pad(normalizedMonth + 1)}-${pad(day)}`
}

/** BCP 47 tag for the plugin two_locale surface. */
export function localeTag(locale) {
  return String(locale || 'en').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

/** Localized short date, optionally with the year. */
export function formatDate(iso, locale) {
  return new Intl.DateTimeFormat(localeTag(locale), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(isoToDay(iso)))
}

/** Localized short date and time for an ISO timestamp. */
export function formatDateTime(iso, locale) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date)
}

/** Localized month name. */
export function formatMonth(iso, locale) {
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(isoToDay(iso)))
}

/** Localized month and year. */
export function formatMonthYear(iso, locale) {
  return new Intl.DateTimeFormat(localeTag(locale), {
    year: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(isoToDay(iso)))
}

/** Localized year. */
export function formatYear(iso, locale) {
  return new Intl.DateTimeFormat(localeTag(locale), {
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(isoToDay(iso)))
}

/** Narrow localized weekday. */
export function formatWeekday(iso, locale) {
  return new Intl.DateTimeFormat(localeTag(locale), {
    weekday: 'narrow',
    timeZone: 'UTC',
  }).format(new Date(isoToDay(iso)))
}

/** Full localized weekday. */
export function formatWeekdayLong(iso, locale) {
  return new Intl.DateTimeFormat(localeTag(locale), {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(isoToDay(iso)))
}
