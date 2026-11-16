import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WORK_CWD, resolveWorkCwd } from '../../src/host/store.js'
import { snapshotEnv } from '../helpers/gantt.js'

let restoreEnv

beforeEach(() => {
  restoreEnv = snapshotEnv('DSH_GANTT_WORK_CWD')
})

afterEach(() => {
  restoreEnv()
})

describe('resolveWorkCwd', () => {
  it('falls back to the documented default without an override', () => {
    delete process.env.DSH_GANTT_WORK_CWD
    expect(DEFAULT_WORK_CWD).toBe('/data/home/ws-plugin')
    expect(resolveWorkCwd()).toBe('/data/home/ws-plugin')
  })

  it('uses the trimmed override and ignores a blank one', () => {
    process.env.DSH_GANTT_WORK_CWD = '  /srv/work  '
    expect(resolveWorkCwd()).toBe('/srv/work')
    process.env.DSH_GANTT_WORK_CWD = '   '
    expect(resolveWorkCwd()).toBe(DEFAULT_WORK_CWD)
  })
})
