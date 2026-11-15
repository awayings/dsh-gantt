// Fake llm services for host tests: record the stream options and yield a
// scripted chunk sequence, fail before/while streaming, or hang forever so the
// timeout and abort paths can be tested without a provider.

/** @typedef {import('../../src/host/chat.js').ChatStreamOptions} ChatStreamOptions */

/** Build one text-delta chunk. @param {string} text */
export function textDelta(text) {
  return { type: 'text-delta', index: 0, text }
}

/** Build one reasoning-delta chunk (the reply must ignore it). @param {string} text */
export function reasoningDelta(text) {
  return { type: 'reasoning-delta', index: 0, text }
}

/** Build one terminal finish chunk. @param {string} [kind] */
export function finish(kind = 'stop') {
  return { type: 'finish', reason: { kind } }
}

/**
 * Fake llm service that records every `stream` call and yields `chunks`.
 * @param {any[]} [chunks]
 * @returns {{ calls: ChatStreamOptions[], stream: (options: ChatStreamOptions) => AsyncIterable<any> }}
 */
export function fakeLlm(chunks = [textDelta('ok'), finish()]) {
  /** @type {ChatStreamOptions[]} */
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      return (async function* () {
        for (const chunk of chunks) yield chunk
      })()
    },
  }
}

/**
 * Fake llm whose `stream` throws synchronously before yielding anything.
 * @param {any} [error]
 */
export function failingLlm(error = new Error('upstream failed')) {
  return {
    calls: [],
    stream() {
      throw error
    },
  }
}

/**
 * Fake llm whose stream fails on its first pull.
 * @param {any} [error]
 */
export function brokenLlm(error = new Error('stream broke')) {
  return {
    calls: [],
    stream() {
      return {
        [Symbol.asyncIterator]() {
          return { next: () => Promise.reject(error) }
        },
      }
    },
  }
}

/**
 * Fake llm whose stream never yields and never finishes, so only the module's
 * own timeout and abort handling can settle the call.
 * @returns {{ calls: ChatStreamOptions[], stream: (options: ChatStreamOptions) => AsyncIterable<any> }}
 */
export function hangingLlm() {
  /** @type {ChatStreamOptions[]} */
  const calls = []
  return {
    calls,
    stream(options) {
      calls.push(options)
      return (async function* () {
        await new Promise(() => {})
      })()
    },
  }
}
