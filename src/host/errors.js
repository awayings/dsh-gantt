// HTTP-friendly error classes shared by the store, the tracker import, and the
// route table. They live in a leaf module so the store, the routes, and the
// chat service can all throw them without importing each other.

/** A validation or lookup failure with an HTTP-friendly status. */
export class GanttError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 400) {
    super(message)
    this.name = 'GanttError'
    this.status = status
  }
}

/** A chat failure with an HTTP-friendly status: 400 invalid input, 502 upstream, 503 unavailable. */
export class ChatError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 400) {
    super(message)
    this.name = 'ChatError'
    this.status = status
  }
}
