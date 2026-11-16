import { NS } from './constants.js'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

/** Fetch a JSON endpoint and throw the payload error message on failure. */
export async function requestJson(path, options = {}) {
  const { body, headers, ...rest } = options
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...rest,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(headers || {}),
    },
    ...(body !== undefined ? { body } : {}),
  })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    // keep the status-based failure below
  }
  if (!response.ok || payload === null || payload.ok !== true) {
    const message = payload && typeof payload.error === 'string' && payload.error.length > 0
      ? payload.error
      : `HTTP ${response.status}`
    const failure = /** @type {Error & { status: number }} */ (new Error(message))
    failure.status = response.status
    throw failure
  }
  return payload
}

/** Subscribe to the host locale service and bind the plugin dictionary. */
export function useLocale(ctx) {
  const subscribe = useCallback(
    listener => (ctx ? ctx.locale.subscribe(listener) : () => {}),
    [ctx],
  )
  const readRevision = useCallback(
    () => (ctx ? ctx.locale.getSnapshot().revision : 0),
    [ctx],
  )
  useSyncExternalStore(subscribe, readRevision, readRevision)
  if (!ctx) return { locale: 'en', t: key => key }
  const snapshot = ctx.locale.getSnapshot()
  return {
    locale: snapshot.locale,
    t: ctx.locale.bind(NS),
  }
}

/** Load the task tree snapshot, keeping the last payload on refresh failure. */
export function useGanttData(options = {}) {
  const enabled = options.enabled !== false
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    if (!enabled) return undefined
    const controller = new AbortController()
    let active = true
    setState(previous => ({
      ...previous,
      status: previous.data ? 'refreshing' : 'loading',
      error: null,
    }))
    requestJson('api/gantt/tree', { signal: controller.signal })
      .then((body) => {
        if (active) setState({ status: 'ready', data: body, error: null })
      })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return
        setState(previous => ({
          ...previous,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }))
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [revision, enabled])
  return { ...state, refresh }
}

/** Load one day bundle for the Today page. */
export function useTodayData(date) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState(previous => ({
      ...previous,
      status: previous.data ? 'refreshing' : 'loading',
      error: null,
    }))
    requestJson(`api/gantt/day?date=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then((body) => {
        if (active) setState({ status: 'ready', data: body, error: null })
      })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return
        setState(previous => ({
          ...previous,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }))
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [date, revision])
  return { ...state, refresh }
}
