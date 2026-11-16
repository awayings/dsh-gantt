// The HTTP-friendly error class shared by the store, the tracker import, and the
// route table. It lives in a leaf module so they can all throw it without
// importing each other.

/** A validation or lookup failure with an HTTP-friendly status. */
export class GanttError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 400) {
    super(message)
    this.name = 'GanttError'
    this.status = status
  }
}
