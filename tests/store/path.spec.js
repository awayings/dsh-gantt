import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDatabasePath } from '../../src/host/store.js'
import { clearDatabaseEnv, snapshotEnv } from '../helpers/gantt.js'

let restore = () => {}

afterEach(() => {
  clearDatabaseEnv()
  restore()
  restore = () => {}
})

function saveEnv() {
  restore = snapshotEnv('DSH_GANTT_DB', 'DSH_HOME')
  clearDatabaseEnv()
}

describe('resolveDatabasePath', () => {
  it('returns DSH_GANTT_DB verbatim when it is set', () => {
    saveEnv()
    process.env.DSH_GANTT_DB = '/var/lib/gantt/custom.db'
    process.env.DSH_HOME = '/elsewhere'
    expect(resolveDatabasePath()).toBe('/var/lib/gantt/custom.db')
  })

  it('returns the in-memory marker verbatim', () => {
    saveEnv()
    process.env.DSH_GANTT_DB = ':memory:'
    expect(resolveDatabasePath()).toBe(':memory:')
  })

  it('builds the path under DSH_HOME when that is the only override', () => {
    saveEnv()
    process.env.DSH_HOME = path.join('/tmp', 'dsh-home')
    expect(resolveDatabasePath()).toBe(path.join('/tmp', 'dsh-home', 'gantt', 'tasks.db'))
  })

  it('falls back to the home directory plus .dsh', () => {
    saveEnv()
    expect(resolveDatabasePath()).toBe(path.join(os.homedir(), '.dsh', 'gantt', 'tasks.db'))
  })

  it('treats empty overrides as unset', () => {
    saveEnv()
    process.env.DSH_GANTT_DB = ''
    process.env.DSH_HOME = ''
    expect(resolveDatabasePath()).toBe(path.join(os.homedir(), '.dsh', 'gantt', 'tasks.db'))
  })
})
