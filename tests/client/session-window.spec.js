// Cross-window session handoff: the blank popup, the localStorage handoff with
// its TTL, and the catalog-aware resume that selects the conversation in the
// window that was just opened.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HANDOFF_KEY,
  SELECTION_KEY,
  WINDOW_NAME_PREFIX,
  openSessionWindow,
  resumeHandedSession,
  sendSessionToWindow,
  takeSessionHandoff,
} from '../../src/client/session-window.js'

/** Window-shaped globalThis for `window.name` access in tests. */
const winScope = /** @type {any} */ (globalThis)

function fakeWindow() {
  return /** @type {any} */ ({
    opener: {},
    location: {
      replaced: '',
      replace(target) {
        this.replaced = target
      },
    },
  })
}

function stubOpen(result) {
  const calls = []
  vi.stubGlobal('open', (...args) => {
    calls.push(args)
    return result
  })
  return calls
}

function catalog(phase = 'ready', ids = ['session-1']) {
  let snapshot = {
    phase,
    byId: Object.fromEntries(ids.map(id => [id, { id }])),
  }
  const listeners = new Set()
  return {
    store: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    ready(next = ids) {
      snapshot = { phase: 'ready', byId: Object.fromEntries(next.map(id => [id, { id }])) }
      for (const listener of [...listeners]) listener()
    },
  }
}

function resumeCtx(services, { inject = true } = {}) {
  const ctx = {}
  if (inject) ctx.inject = (names, callback) => callback(services)
  return ctx
}

function stash(sessionId, at = Date.now()) {
  localStorage.setItem(HANDOFF_KEY, JSON.stringify({ sessionId, at }))
}

afterEach(() => {
  localStorage.clear()
  winScope.name = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('openSessionWindow', () => {
  it('opens a blank window and detaches it from the opener', () => {
    const win = fakeWindow()
    const calls = stubOpen(win)
    expect(openSessionWindow()).toBe(win)
    expect(calls).toEqual([['', '_blank']])
    expect(win.opener).toBeNull()
  })

  it('returns null when the browser refuses the popup or throws', () => {
    stubOpen(null)
    expect(openSessionWindow()).toBeNull()

    vi.stubGlobal('open', () => {
      throw new Error('blocked')
    })
    expect(openSessionWindow()).toBeNull()
  })

  it('keeps the window when it cannot be detached from the opener', () => {
    const win = fakeWindow()
    Object.defineProperty(win, 'opener', {
      set() {
        throw new Error('sealed')
      },
    })
    stubOpen(win)
    expect(openSessionWindow()).toBe(win)
  })
})

describe('sendSessionToWindow', () => {
  it('stores both handoffs, seeds the selection, and navigates the window', () => {
    const win = fakeWindow()
    expect(sendSessionToWindow(win, 'session-1')).toBe(true)
    expect(JSON.parse(localStorage.getItem(HANDOFF_KEY))).toMatchObject({ sessionId: 'session-1' })
    expect(JSON.parse(localStorage.getItem(SELECTION_KEY))).toEqual({ sessionId: 'session-1' })
    expect(win.name).toMatch(new RegExp(`^${WINDOW_NAME_PREFIX}\\d+:session-1$`))
    expect(win.location.replaced).toBe(globalThis.location.href)
  })

  it('keeps navigating when the per-window name is sealed', () => {
    const win = fakeWindow()
    Object.defineProperty(win, 'name', {
      set() {
        throw new Error('sealed')
      },
    })
    expect(sendSessionToWindow(win, 'session-1')).toBe(true)
    expect(win.location.replaced).toBe(globalThis.location.href)
  })

  it('refuses a missing window or an unusable session id', () => {
    expect(sendSessionToWindow(null, 'session-1')).toBe(false)
    expect(sendSessionToWindow(fakeWindow(), '')).toBe(false)
    expect(sendSessionToWindow(fakeWindow(), undefined)).toBe(false)
    expect(localStorage.getItem(HANDOFF_KEY)).toBeNull()
  })

  it('reports storage failures without navigating', () => {
    const win = fakeWindow()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(sendSessionToWindow(win, 'session-1')).toBe(false)
    expect(win.location.replaced).toBe('')
  })

  it('discards the handoff when navigation fails', () => {
    const win = fakeWindow()
    win.location.replace = () => {
      throw new Error('closed')
    }
    stash('stale-target')
    expect(sendSessionToWindow(win, 'session-1')).toBe(false)
    expect(localStorage.getItem(HANDOFF_KEY)).toBeNull()
  })
})

describe('takeSessionHandoff', () => {
  it('returns and removes a live handoff', () => {
    stash('session-1')
    expect(takeSessionHandoff()).toBe('session-1')
    expect(localStorage.getItem(HANDOFF_KEY)).toBeNull()
  })

  it('prefers and clears the per-window handoff', () => {
    winScope.name = `${WINDOW_NAME_PREFIX}${Date.now()}:session-window`
    stash('session-storage')
    expect(takeSessionHandoff()).toBe('session-window')
    expect(winScope.name).toBe('')
    expect(JSON.parse(localStorage.getItem(HANDOFF_KEY))).toMatchObject({ sessionId: 'session-storage' })
  })

  it('ignores a stale or malformed per-window handoff', () => {
    winScope.name = `${WINDOW_NAME_PREFIX}1:session-window`
    expect(takeSessionHandoff()).toBeNull()
    expect(winScope.name).toBe('')

    winScope.name = `${WINDOW_NAME_PREFIX}now:session-window`
    expect(takeSessionHandoff()).toBeNull()

    winScope.name = `${WINDOW_NAME_PREFIX}session-window`
    expect(takeSessionHandoff()).toBeNull()

    winScope.name = `${WINDOW_NAME_PREFIX}${Date.now()}:`
    expect(takeSessionHandoff()).toBeNull()

    Object.defineProperty(globalThis, 'name', {
      configurable: true,
      get() {
        throw new Error('sealed')
      },
    })
    expect(takeSessionHandoff()).toBeNull()
    delete winScope.name
  })

  it('ignores an absent, malformed, or stale handoff', () => {
    expect(takeSessionHandoff()).toBeNull()

    localStorage.setItem(HANDOFF_KEY, '{not json')
    expect(takeSessionHandoff()).toBeNull()
    expect(localStorage.getItem(HANDOFF_KEY)).toBeNull()

    localStorage.setItem(HANDOFF_KEY, JSON.stringify({ at: Date.now() }))
    expect(takeSessionHandoff()).toBeNull()

    localStorage.setItem(HANDOFF_KEY, JSON.stringify({ sessionId: '', at: Date.now() }))
    expect(takeSessionHandoff()).toBeNull()

    localStorage.setItem(HANDOFF_KEY, JSON.stringify({ sessionId: 'session-1', at: 'now' }))
    expect(takeSessionHandoff()).toBeNull()

    stash('session-1', Date.now() - 31_000)
    expect(takeSessionHandoff()).toBeNull()
    expect(localStorage.getItem(HANDOFF_KEY)).toBeNull()
  })

  it('treats a storage read failure as no handoff', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(takeSessionHandoff()).toBeNull()
  })
})

describe('resumeHandedSession', () => {
  it('reports false without a handoff or without injection', () => {
    expect(resumeHandedSession({ inject: () => {} })).toBe(false)

    stash('session-1')
    expect(resumeHandedSession({})).toBe(false)
    expect(localStorage.getItem(HANDOFF_KEY)).toBeNull()
  })

  it('selects the conversation once the catalog lists it', () => {
    stash('session-1')
    const opened = []
    const services = {
      sessions: { list: catalog().store },
      uiWorkspace: { openSession: id => opened.push(id) },
    }
    expect(resumeHandedSession(resumeCtx(services))).toBe(true)
    expect(opened).toEqual(['session-1'])
  })

  it('leaves a conversation that the seeded selection already restored alone', () => {
    stash('session-1')
    const opened = []
    const services = {
      sessions: {
        list: catalog().store,
        retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 1 } }) }),
      },
      uiWorkspace: { openSession: id => opened.push(id) },
    }
    expect(resumeHandedSession(resumeCtx(services))).toBe(true)
    expect(opened).toEqual([])
  })

  it('selects the conversation when retention reports no main view', () => {
    stash('session-1')
    const opened = []
    const services = {
      sessions: {
        list: catalog().store,
        retainInfo: () => ({ getSnapshot: () => ({ retainedBy: { mainView: 0 } }) }),
      },
      uiWorkspace: { openSession: id => opened.push(id) },
    }
    resumeHandedSession(resumeCtx(services))
    expect(opened).toEqual(['session-1'])
  })

  it('waits for a catalog that is still loading', () => {
    stash('session-1')
    const opened = []
    const sessions = catalog('loading', [])
    const services = {
      sessions: { list: sessions.store },
      uiWorkspace: { openSession: id => opened.push(id) },
    }
    expect(resumeHandedSession(resumeCtx(services))).toBe(true)
    expect(opened).toEqual([])

    sessions.ready(['session-1'])
    expect(opened).toEqual(['session-1'])
  })

  it('stops waiting when the resume timeout expires', () => {
    vi.useFakeTimers()
    stash('session-1')
    const opened = []
    const sessions = catalog('loading', [])
    const services = {
      sessions: { list: sessions.store },
      uiWorkspace: { openSession: id => opened.push(id) },
    }
    resumeHandedSession(resumeCtx(services))
    vi.advanceTimersByTime(10_000)
    sessions.ready()
    expect(opened).toEqual([])
  })

  it('waits on the timeout alone when the catalog has no subscription', () => {
    vi.useFakeTimers()
    stash('session-1')
    const opened = []
    const services = {
      sessions: { list: { getSnapshot: () => ({ phase: 'loading', byId: {} }) } },
      uiWorkspace: { openSession: id => opened.push(id) },
    }
    resumeHandedSession(resumeCtx(services))
    vi.advanceTimersByTime(10_000)
    expect(opened).toEqual([])
  })

  it('never opens a session the ready catalog does not list', () => {
    stash('session-1')
    const opened = []
    const sessions = catalog('ready', ['other'])
    const services = {
      sessions: { list: sessions.store },
      uiWorkspace: { openSession: id => opened.push(id) },
    }
    resumeHandedSession(resumeCtx(services))
    sessions.ready(['other'])
    expect(opened).toEqual([])
  })

  it('tolerates a missing catalog snapshot', () => {
    vi.useFakeTimers()
    stash('session-1')
    const opened = []
    const services = {
      sessions: {},
      uiWorkspace: { openSession: id => opened.push(id) },
    }
    resumeHandedSession(resumeCtx(services))
    vi.advanceTimersByTime(10_000)
    expect(opened).toEqual([])
  })
})
