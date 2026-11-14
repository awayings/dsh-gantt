import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GanttStore } from '../../store.js'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'

let tempDir
let store

afterEach(() => {
  store?.close()
  store = undefined
  vi.restoreAllMocks()
  if (tempDir) {
    removeTempDir(tempDir)
    tempDir = undefined
  }
})

describe('file-backed database', () => {
  it('creates missing parent directories and a 0600 database file', () => {
    tempDir = makeTempDir()
    const file = path.join(tempDir, 'nested', 'deeper', 'tasks.db')
    expect(fs.existsSync(file)).toBe(false)
    store = new GanttStore(file)
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.existsSync(path.dirname(file))).toBe(true)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(store.meta().dbPath).toBe(path.resolve(file))
    expect(store.db.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal')
  })

  it('persists tasks across store instances', () => {
    tempDir = makeTempDir()
    const file = path.join(tempDir, 'tasks.db')
    store = new GanttStore(file)
    const created = store.create({ title: 'Persisted', startDate: '2024-01-01', endDate: '2024-01-02' })
    store.close()
    store = new GanttStore(file)
    expect(store.count()).toBe(1)
    expect(store.getNode(created.id).title).toBe('Persisted')
  })

  it('survives a filesystem that refuses to chmod the database', () => {
    tempDir = makeTempDir()
    const file = path.join(tempDir, 'tasks.db')
    vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
      throw new Error('EPERM: operation not permitted')
    })
    store = new GanttStore(file)
    expect(fs.existsSync(file)).toBe(true)
    expect(store.count()).toBe(0)
    expect(store.create({ title: 'Still usable' }).title).toBe('Still usable')
  })

  it('asks for owner-only permissions on creation', () => {
    tempDir = makeTempDir()
    const file = path.join(tempDir, 'tasks.db')
    const chmod = vi.spyOn(fs, 'chmodSync')
    store = new GanttStore(file)
    expect(chmod).toHaveBeenCalledWith(file, 0o600)
  })
})
