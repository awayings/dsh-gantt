// Resolve conversation titles for trajectory rows through the host session
// query service. The plugin records only the durable session id, so the title
// lives in the session log; reading it is a best-effort enrichment: a host
// without `sessionQuery`, a missing session, or a timeout keeps the short-id
// fallback instead of failing the route or the assistant tool.
//
// `readTitleSnapshots` observes live-preferred storage and folds the latest
// `session/title` event without loading the model, so it also works for
// conversations that have been closed for a while. Results are cached because
// the right-rail panel refetches on every focus change and window focus.

const TITLE_TTL_MS = 5 * 60 * 1000
const MISS_TTL_MS = 30 * 1000
const MAX_ENTRIES = 500
const READ_TIMEOUT_MS = 2000

/**
 * @typedef {{ title: string, at: number, ttl: number }} TitleEntry
 * @typedef {{ resolve: (sessionIds: string[]) => Promise<Map<string, string>> }} SessionTitles
 */

/**
 * Build a plugin-scoped title resolver. `get` is the Cordis service getter, so
 * the lookup stays lazy and a host that mounts the service later still works.
 * @param {(name: string) => unknown} [get]
 * @returns {SessionTitles}
 */
export function createSessionTitles(get) {
  /** @type {Map<string, TitleEntry>} */
  const cache = new Map()

  /** Drop the oldest entries once the cache is over its cap. */
  function prune() {
    for (const id of cache.keys()) {
      if (cache.size <= MAX_ENTRIES) break
      cache.delete(id)
    }
  }

  /**
   * @param {string[]} sessionIds
   * @returns {Promise<Map<string, string>>}
   */
  async function resolve(sessionIds) {
    const unique = [...new Set((Array.isArray(sessionIds) ? sessionIds : [])
      .filter(id => typeof id === 'string' && id !== ''))]
    if (unique.length === 0) return new Map()
    const now = Date.now()
    const missing = unique.filter((id) => {
      const entry = cache.get(id)
      return entry === undefined || now - entry.at > entry.ttl
    })
    if (missing.length > 0) {
      const query = typeof get === 'function' ? /** @type {any} */ (get('sessionQuery')) : undefined
      if (query !== undefined && query !== null && typeof query.readTitleSnapshots === 'function') {
        try {
          const results = await query.readTitleSnapshots(missing, AbortSignal.timeout(READ_TIMEOUT_MS))
          for (const id of missing) cache.set(id, { title: '', at: now, ttl: MISS_TTL_MS })
          for (const result of Array.isArray(results) ? results : []) {
            const title = result?.status === 'fulfilled' ? result.value?.title?.title : undefined
            if (typeof title === 'string' && title.trim() !== '') {
              cache.set(result.sessionId, { title: title.trim(), at: now, ttl: TITLE_TTL_MS })
            }
          }
          prune()
        } catch {
          // A timed-out or failed observation only costs the title; the caller
          // still renders the recorded session id.
        }
      }
    }
    return new Map(unique.map(id => [id, cache.get(id)?.title ?? '']))
  }

  return { resolve }
}
