// Best-effort "open this conversation in a new browser window" support.
//
// A window is opened blank inside the click gesture (browsers refuse a popup
// started after an await) and then navigated to the app URL. The target
// conversation travels through a short-lived localStorage handoff, because the
// app has no per-session URL; the app boot in the new window consumes the
// handoff and selects the conversation once the session catalog is ready.

/** localStorage key carrying one pending session between two windows. */
export const HANDOFF_KEY = 'gantt.pendingSession'

/** A handoff older than this is stale and ignored. */
const HANDOFF_TTL_MS = 30_000

/** How long a fresh window keeps waiting for the session catalog. */
const RESUME_TIMEOUT_MS = 10_000

/**
 * Open a blank browser window while the click gesture is still active.
 * @returns {Window | null} the window, or null when the browser refused it.
 */
export function openSessionWindow() {
  try {
    const win = globalThis.open('', '_blank')
    if (!win) return null
    try {
      win.opener = null
    } catch {
      // A cross-origin or already-closed window cannot be detached; the handoff
      // still works through localStorage.
    }
    return win
  } catch {
    return null
  }
}

/**
 * Hand a conversation to an already-open blank window and load the app there.
 * @param {Window | null} win
 * @param {string} sessionId
 * @returns {boolean} whether the window is navigating to the conversation.
 */
export function sendSessionToWindow(win, sessionId) {
  if (win === null || typeof sessionId !== 'string' || sessionId === '') return false
  try {
    globalThis.localStorage.setItem(HANDOFF_KEY, JSON.stringify({ sessionId, at: Date.now() }))
  } catch {
    return false
  }
  try {
    win.location.replace(globalThis.location.href)
    return true
  } catch {
    discardSessionHandoff()
    return false
  }
}

/**
 * Take the pending handoff exactly once; stale, malformed, or absent handoffs
 * yield null.
 * @param {number} [now] epoch milliseconds, for tests.
 * @returns {string | null}
 */
export function takeSessionHandoff(now = Date.now()) {
  try {
    const raw = globalThis.localStorage.getItem(HANDOFF_KEY)
    if (raw === null) return null
    globalThis.localStorage.removeItem(HANDOFF_KEY)
    const parsed = JSON.parse(raw)
    if (typeof parsed?.sessionId !== 'string' || parsed.sessionId === '') return null
    if (typeof parsed.at !== 'number' || now - parsed.at > HANDOFF_TTL_MS) return null
    return parsed.sessionId
  } catch {
    return null
  }
}

/**
 * Consume a handoff written by the window that opened this one and select that
 * conversation after the session catalog lists it.
 * @param {any} ctx client root context
 * @returns {boolean} whether a handoff was waiting for this window.
 */
export function resumeHandedSession(ctx) {
  const sessionId = takeSessionHandoff()
  if (sessionId === null) return false
  if (typeof ctx?.inject !== 'function') return false
  ctx.inject(['sessions', 'uiWorkspace'], (injected) => {
    const store = injected.sessions?.list
    const tryOpen = () => {
      const snapshot = store?.getSnapshot?.()
      if (snapshot?.phase !== 'ready' || snapshot.byId?.[sessionId] === undefined) return false
      injected.uiWorkspace.openSession(sessionId)
      return true
    }
    if (tryOpen()) return
    const stop = () => {
      clearTimeout(timer)
      unsubscribe?.()
    }
    const timer = setTimeout(stop, RESUME_TIMEOUT_MS)
    /** @type {(() => void) | null} */
    let unsubscribe = null
    if (typeof store?.subscribe === 'function') {
      unsubscribe = store.subscribe(() => {
        if (tryOpen()) stop()
      })
    }
  })
  return true
}

/** Remove a handoff that can no longer be delivered. */
function discardSessionHandoff() {
  try {
    globalThis.localStorage.removeItem(HANDOFF_KEY)
  } catch {
    // Nothing else can be done when storage is unavailable.
  }
}
