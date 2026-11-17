// Keep the plugin's global main panel selected across a client reload.
//
// DSH keeps the main-panel selection in the layout store's memory only. When a
// client bundle is rebuilt — `pnpm run check`, `pnpm run e2e`, `pnpm run build`
// and `prepare` all re-run scripts/build-client.mjs — client-hmr replaces this
// plugin's entry: unregistering its `main` entries makes the layout reset the
// selection (`retainMainPanels`) and the conversation takes the center column.
// The same happens after a full browser reload, because the shell does not
// persist global pages at all. Both read to the user as "the Gantt page jumped
// back to the conversation".
//
// The page that was on screen is remembered in sessionStorage (per tab) when
// the entry unloads or the page hides, and the next apply selects it again
// once the shell is up. The marker is short-lived so a tab that moved on does
// not resurrect an old page later.

/** sessionStorage key carrying the page to restore. */
export const PANEL_KEY = 'gantt.activePage'

/** The `main` slot keys this plugin owns. */
export const PANEL_IDS = ['gantt', 'today']

/** A marker older than this is stale; the next apply drops it. */
export const RESTORE_TTL_MS = 15_000

/**
 * The layout service, when the host provides a usable one. Absent (old host or
 * a boot that has not installed the frame yet) means the convenience restore is
 * skipped instead of failing the plugin.
 * @param {any} source a client context or an injected services object
 * @returns {any}
 */
function layoutOf(source) {
  if (source === null || source === undefined) return null
  const layout = typeof source.get === 'function' ? source.get('layout') : source.layout
  const usable = layout !== null && layout !== undefined
    && typeof layout.selectPanel === 'function'
    && typeof layout.panelInfo?.getSnapshot === 'function'
  return usable ? layout : null
}

/**
 * The selected global panel id, or null when the conversation is showing (or
 * the store cannot be read).
 * @param {any} layout
 * @returns {string | null}
 */
function activePanelId(layout) {
  try {
    const panel = layout.panelInfo.getSnapshot()?.activePanelId
    return typeof panel === 'string' ? panel : null
  } catch {
    return null
  }
}

/** The tab-local session storage, or null when the browser refuses it. @returns {Storage | null} */
function sessionStore() {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

/**
 * Remember one panel id for the next apply.
 * @param {string} panel
 * @returns {void}
 */
function writeMarker(panel) {
  const store = sessionStore()
  if (store === null) return
  try {
    store.setItem(PANEL_KEY, JSON.stringify({ panel, at: Date.now() }))
  } catch {
    // Refusing storage only costs the convenience restore, never the page.
  }
}

/**
 * Read and remove the marker. Malformed values count as absent.
 * @returns {{ panel?: unknown, at?: unknown } | null}
 */
function takeMarker() {
  const store = sessionStore()
  if (store === null) return null
  let raw = null
  try {
    raw = store.getItem(PANEL_KEY)
    store.removeItem(PANEL_KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

/**
 * Install the unload/pagehide capture. The layout service is resolved lazily:
 * this effect is registered before the `main` entries so its cleanup runs
 * before they unregister, when the selection still names the plugin's page.
 * @param {any} ctx client root context
 * @returns {boolean} whether the capture was installed
 */
export function installPanelCapture(ctx) {
  if (typeof ctx?.effect !== 'function') return false
  /** @type {any} */
  let layout = layoutOf(ctx)
  const resolve = () => {
    if (layout === null) layout = layoutOf(ctx)
    return layout
  }
  ctx.effect(() => {
    const remember = () => {
      const target = resolve()
      if (target === null) return
      const panel = activePanelId(target)
      if (PANEL_IDS.includes(panel)) writeMarker(panel)
    }
    const onPageHide = () => remember()
    globalThis.addEventListener?.('pagehide', onPageHide)
    return () => {
      globalThis.removeEventListener?.('pagehide', onPageHide)
      remember()
    }
  }, 'gantt: remember the active page across reloads')
  if (layout === null && typeof ctx.inject === 'function') {
    ctx.inject(['layout'], (injected) => {
      layout = layoutOf(injected) ?? layout
    })
  }
  return true
}

/**
 * Select the remembered page again, when it is still fresh and the shell has
 * not selected a panel of its own. The selection is deferred by one task so a
 * boot-time navigation to the restored conversation (whose start aborts any
 * pending navigation) is not cancelled.
 * @param {any} ctx client root context
 * @returns {boolean} whether a restore was scheduled
 */
export function restorePanel(ctx) {
  const layout = layoutOf(ctx)
  if (layout === null) return false
  const marker = takeMarker()
  if (marker === null) return false
  const panel = marker.panel
  if (typeof panel !== 'string' || !PANEL_IDS.includes(panel)) return false
  if (typeof marker.at !== 'number' || !Number.isFinite(marker.at)) return false
  const age = Date.now() - marker.at
  if (age < 0 || age > RESTORE_TTL_MS) return false
  setTimeout(() => {
    if (activePanelId(layout) !== null) return
    try {
      layout.selectPanel(panel)
    } catch {
      // The keyed entry is not registered (an old host, or a partial boot):
      // stay on the conversation instead of failing the plugin load.
    }
  }, 0)
  return true
}
