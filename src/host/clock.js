// The task-day clock: the tracker's dates and the 08:00 recompute are the
// user's wall-clock, while the host process may run in UTC (this container
// does). Resolve "today" and "next 08:00" through an explicit IANA zone so the
// server agrees with the browser and the scheduler fires on the user's morning.
//
// `DSH_GANTT_TZ` overrides the zone; an unusable value falls back to the
// tracker's home zone instead of failing every read.

/** Zone the tracker's plan dates belong to. */
export const DEFAULT_TIME_ZONE = 'Asia/Shanghai'

/** @type {Map<string, Intl.DateTimeFormat>} */
const FORMATTERS = new Map()

/**
 * @param {string} timeZone
 * @returns {Intl.DateTimeFormat}
 */
function formatterFor(timeZone) {
  const cached = FORMATTERS.get(timeZone)
  if (cached !== undefined) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  FORMATTERS.set(timeZone, formatter)
  return formatter
}

/**
 * The configured task-day zone, validated once per call. An invalid override
 * must not take the whole plugin down, so it falls back to the default.
 * @returns {string}
 */
export function taskTimeZone() {
  const override = typeof process.env.DSH_GANTT_TZ === 'string' ? process.env.DSH_GANTT_TZ.trim() : ''
  if (override === '') return DEFAULT_TIME_ZONE
  try {
    formatterFor(override)
    return override
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

/**
 * Wall-clock parts of one instant in a zone.
 * @param {Date} date
 * @param {string} [timeZone]
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, second: number }}
 */
export function zonedParts(date, timeZone = taskTimeZone()) {
  const parts = formatterFor(timeZone).formatToParts(date)
  /** @param {string} type */
  const pick = type => Number(/** @type {Intl.DateTimeFormatPart} */ (parts.find(part => part.type === type)).value)
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour') % 24,
    minute: pick('minute'),
    second: pick('second'),
  }
}

/** @param {number} value @returns {string} */
function pad(value) {
  return String(value).padStart(2, '0')
}

/**
 * The task-day date (`YYYY-MM-DD`) of one instant in the task-day zone.
 * @param {Date} [now]
 * @param {string} [timeZone]
 * @returns {string}
 */
export function todayIso(now = new Date(), timeZone = taskTimeZone()) {
  const parts = zonedParts(now, timeZone)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

/**
 * Milliseconds a zone's wall clock is ahead of UTC at one instant.
 * @param {number} instant
 * @param {string} timeZone
 * @returns {number}
 */
function offsetAt(instant, timeZone) {
  const parts = zonedParts(new Date(instant), timeZone)
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return wall - Math.floor(instant / 1000) * 1000
}

/**
 * The UTC instant of one wall-clock time in a zone. Two passes settle zones
 * whose offset changes across the target instant.
 * @param {number} year @param {number} month @param {number} day
 * @param {number} hour @param {number} minute
 * @param {string} timeZone
 * @returns {Date}
 */
function zonedInstant(year, month, day, hour, minute, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  let instant = wall
  for (let pass = 0; pass < 2; pass += 1) {
    const next = wall - offsetAt(instant, timeZone)
    if (next === instant) break
    instant = next
  }
  return new Date(instant)
}

/**
 * The next 08:00 strictly after `now` in the task-day zone. A `now` exactly at
 * 08:00 already belongs to the run that just happened, so it returns tomorrow.
 * @param {Date} [now]
 * @param {string} [timeZone]
 * @returns {Date}
 */
export function nextEightAm(now = new Date(), timeZone = taskTimeZone()) {
  const parts = zonedParts(now, timeZone)
  let year = parts.year
  let month = parts.month
  let day = parts.day
  if (parts.hour >= 8) {
    const next = new Date(Date.UTC(year, month - 1, day) + 86_400_000)
    year = next.getUTCFullYear()
    month = next.getUTCMonth() + 1
    day = next.getUTCDate()
  }
  return zonedInstant(year, month, day, 8, 0, timeZone)
}
