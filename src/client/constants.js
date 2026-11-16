/** The plugin namespace used for locale dictionaries and the module loader id. */
export const NS = 'dsh-gantt'
/** Milliseconds in one day, for date-only arithmetic. */
export const DAY_MS = 86_400_000
/** CSS colour per task status, expressed with theme tokens. */
export const STATUS_COLOR = {
  todo: 'var(--dsw-alias-state-idle-primary)',
  in_progress: 'var(--dsw-alias-brand-primary)',
  blocked: 'var(--dsw-alias-state-error-primary)',
  done: 'var(--dsw-alias-state-success-primary)',
  cancelled: 'var(--dsw-alias-label-secondary)',
  skipped: 'var(--dsw-alias-label-secondary)',
}

/** Chronological order of the day-plan slots. */
export const SLOT_ORDER = ['morning', 'daytime', 'evening', 'other']
