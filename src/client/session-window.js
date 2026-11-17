// Best-effort "open this conversation in a new browser window" support.
//
// A window is opened blank inside the click gesture (browsers refuse a popup
// started after an await) and then navigated to the app URL. The target
// conversation travels through two short-lived carriers, because the app has no
// per-session URL: `window.name` (per-window, survives the navigation) and a
// localStorage handoff for the plugin boot. Before navigating we also seed the
// app's own last-selection key, so the new window's initial restoration picks
// the target instead of racing the plugin's `openSession`. The window that
// consumes the per-window carrier also clears the shared fallback, so the
// opener (whose plugin entry a rebuild may reload) cannot pick it up later and
// jump away from the page the user is on.

/** localStorage key carrying one pending session between two windows. */
export const HANDOFF_KEY = 'gantt.pendingSession'

/** localStorage key the workspace plugin persists the current session under. */
export const SELECTION_KEY = 'dsh.sessions.current'

/** Prefix of the per-window handoff written to `window.name`. */
export const WINDOW_NAME_PREFIX = 'gantt-session:'

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
 * The selection seed must succeed as well: without it the new window can
 * finish its own restoration after the plugin selected the target.
 * @param {Window | null} win
 * @param {string} sessionId
 * @returns {boolean} whether the window is navigating to the conversation.
 */
export function sendSessionToWindow(win, sessionId) {
  if (win === null || typeof sessionId !== 'string' || sessionId === '') return false
  try {
    globalThis.localStorage.setItem(HANDOFF_KEY, JSON.stringify({ sessionId, at: Date.now() }))
    globalThis.localStorage.setItem(SELECTION_KEY, JSON.stringify({ sessionId }))
  } catch {
    discardSessionHandoff()
    return false
  }
  try {
    win.name = `${WINDOW_NAME_PREFIX}${Date.now()}:${sessionId}`
  } catch {
    // A sealed window still gets the target through the localStorage carriers.
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
 * Read and clear the per-window handoff. Stale or malformed names are cleared
 * and fall through to the localStorage carrier.
 * @param {number} now epoch milliseconds, for tests.
 * @returns {string | null}
 */
function takeWindowHandoff(now) {
  try {
    const scope = /** @type {any} */ (globalThis)
    const raw = scope.name
    if (typeof raw !== 'string' || !raw.startsWith(WINDOW_NAME_PREFIX)) return null
    scope.name = ''
    const rest = raw.slice(WINDOW_NAME_PREFIX.length)
    const separator = rest.indexOf(':')
    if (separator <= 0) return null
    const at = Number(rest.slice(0, separator))
    const sessionId = rest.slice(separator + 1)
    if (!Number.isFinite(at) || now - at > HANDOFF_TTL_MS) return null
    return sessionId === '' ? null : sessionId
  } catch {
    return null
  }
}

/**
 * Take the pending handoff exactly once; stale, malformed, or absent handoffs
 * yield null.
 * @param {number} [now] epoch milliseconds, for tests.
 * @returns {string | null}
 */
export function takeSessionHandoff(now = Date.now()) {
  const fromName = takeWindowHandoff(now)
  if (fromName !== null) {
    // This window was the one that was handed the target; the shared fallback
    // must not linger for another window (the opener reloading its plugin).
    discardSessionHandoff()
    return fromName
  }
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
 * conversation after the session catalog lists it. A window whose seeded
 * selection already restored the target leaves the selection alone.
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
      const retained = injected.sessions?.retainInfo?.(sessionId)?.getSnapshot?.()?.retainedBy?.mainView
      if (retained === 0 || retained === undefined) injected.uiWorkspace.openSession(sessionId)
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
