// Session labels shared by the host trajectory renderer and the browser panel:
// one compact form keeps a durable UUID traceable without printing all 36
// characters, and one display form puts the conversation title in front of it.
// No imports here — keep it safe for Node and the browser.

const SESSION_PREFIX = 'session-'
const SHORT_LENGTH = 8

/**
 * Compact conversation label: `session-b1f72425-d0d8-…` → `b1f72425`.
 * Unknown shapes keep their first eight characters.
 * @param {unknown} sessionId
 * @returns {string}
 */
export function shortSessionId(sessionId) {
  if (typeof sessionId !== 'string') return ''
  const id = sessionId.trim()
  if (id === '') return ''
  const uuid = id.startsWith(SESSION_PREFIX) ? id.slice(SESSION_PREFIX.length) : id
  return uuid.slice(0, SHORT_LENGTH)
}

/**
 * Label shown on one trajectory row: `标题（b1f72425）` when the host resolved a
 * title, otherwise just the short id.
 * @param {unknown} sessionId
 * @param {unknown} title
 * @returns {string}
 */
export function sessionDisplay(sessionId, title) {
  const short = shortSessionId(sessionId)
  const text = typeof title === 'string' ? title.trim() : ''
  if (text === '') return short
  return short === '' ? text : `${text}（${short}）`
}
