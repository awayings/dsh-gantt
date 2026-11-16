// End-to-end migration: a deterministic v2 database fixture is served through the
// real host routes, so the schema upgrade is proved over HTTP rather than only
// in-process. The fixture is built in code (tests/helpers/v2.js), so this runs in
// a clean checkout without the gitignored `.tmp/v2-copy.db`.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startServer } from './server.js'
import { V2_BLOCK_ID, writeV2Database } from '../helpers/v2.js'

let dir
let server

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-gantt-e2e-migrate-'))
  const dbPath = writeV2Database(path.join(dir, 'tasks.db'))
  server = await startServer({ dbPath })
})

afterEach(async () => {
  if (server) await server.close()
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  server = undefined
  dir = undefined
})

describe('v2 database over HTTP', () => {
  it('serves 2 track roots and 4 nested nodes with a non-empty brief', async () => {
    const tree = await fetch(`${server.origin}/api/gantt/tree`).then(response => response.json())
    expect(tree.tasks).toHaveLength(2)
    const flat = []
    const walk = (node) => {
      flat.push(node)
      node.children.forEach(walk)
    }
    tree.tasks.forEach(walk)
    expect(flat.filter(node => node.kind === 'node')).toHaveLength(4)
    expect(tree.brief.pending).toBe(2)
    expect(tree.brief.lanes).toHaveLength(2)
    const child = flat.find(node => node.ref === 'node:1.8.1')
    const parent = flat.find(node => node.id === child?.parentId)
    expect(parent?.ref).toBe('node:1.8')
    const track = flat.find(node => node.id === parent?.parentId)
    expect(track?.ref).toBe('track:1')
    expect(track?.status).toBe('in_progress')
    expect(flat.find(node => node.ref === 'track:2')?.status).toBe('blocked')
  })

  it('reports schema v5, the preserved plan day, and a context export', async () => {
    const meta = await fetch(`${server.origin}/api/gantt/meta`).then(response => response.json())
    expect(meta.schemaVersion).toBe(5)
    expect(meta.taskCount).toBe(6)
    const day = await fetch(`${server.origin}/api/gantt/day?date=2026-11-15`).then(response => response.json())
    expect(day.blocks.map(block => block.id)).toEqual([V2_BLOCK_ID])
    expect(day.day).toMatchObject({ date: '2026-11-15', coreGoal: '收表' })
    expect(day.tracks.map(track => track.ref)).toEqual(['track:1', 'track:2'])
    const block = day.blocks[0]
    expect(day.nodes.find(node => node.ref === 'node:1.8.1')?.trackId).toBe(day.tracks[0].id)
    const context = await fetch(`${server.origin}/api/gantt/context?date=2026-11-15`).then(response => response.json())
    expect(context.counts).toMatchObject({ tracks: 2, nodes: 4 })
    expect(context.markdown).toContain('投资系统')
    expect(context.markdown).toContain('S2 每日交易仓读数')
    expect(context.markdown).toContain('完成标准 每天一句读数')
    expect(block.source).toBe('schedule')
  })
})
