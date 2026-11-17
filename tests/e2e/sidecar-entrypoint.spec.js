// The sidecar entrypoint is the one piece of shell that runs on every Pod
// start, and a bug there is a crash loop that takes the whole Pod unready —
// DSH included — so it gets a real execution test rather than a syntax check.
// Each case builds a throwaway GANTT_HOME on disk, packs a stub release, and
// runs the shipped script against it: version resolution, checksum verification,
// idempotency, and the final exec of bin/gantt-mcp.js.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')
const ENTRYPOINT = path.join(ROOT, 'deploy', 'k3s', 'gantt-mcp-entrypoint.sh')
/** Stands in for bin/gantt-mcp.js: proves the entrypoint exec'd the release. */
const STUB = 'console.log(`stub ${process.argv.slice(2).join(" ")}`)\n'

const homes = []

/** A GANTT_HOME with an empty releases directory, removed after the test. */
function newHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gantt-sidecar-'))
  fs.mkdirSync(path.join(home, 'releases'), { recursive: true })
  homes.push(home)
  return home
}

/** Pack dsh-gantt-<version>.tgz containing the stub server; return its digest. */
function packRelease(home, version, { sums = true } = {}) {
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'gantt-pack-'))
  const bin = path.join(build, 'package', 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'gantt-mcp.js'), STUB)
  const tarball = path.join(home, 'releases', `dsh-gantt-${version}.tgz`)
  const tar = spawnSync('tar', ['czf', tarball, '-C', build, 'package'], { encoding: 'utf8' })
  expect(tar.status, tar.stderr).toBe(0)
  fs.rmSync(build, { recursive: true, force: true })
  const digest = createHash('sha256').update(fs.readFileSync(tarball)).digest('hex')
  if (sums) {
    fs.writeFileSync(path.join(home, 'releases', 'SHA256SUMS'), `${digest}  dsh-gantt-${version}.tgz\n`)
  }
  return digest
}

/** Run the entrypoint as the container would, with stdio transport so no port. */
function runEntrypoint(home, env = {}) {
  return spawnSync('bash', [ENTRYPOINT], {
    encoding: 'utf8',
    env: { ...process.env, GANTT_HOME: home, GANTT_VERSION: '', GANTT_MCP_TRANSPORT: 'stdio', ...env },
  })
}

afterEach(() => {
  while (homes.length) fs.rmSync(homes.pop(), { recursive: true, force: true })
})

describe('sidecar entrypoint', () => {
  it('installs the release named by releases/desired and execs it', () => {
    const home = newHome()
    packRelease(home, '9.9.9')
    fs.writeFileSync(path.join(home, 'releases', 'desired'), '9.9.9\n')

    const result = runEntrypoint(home)

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('installed release 9.9.9 at runtime/9.9.9')
    expect(fs.readlinkSync(path.join(home, 'current'))).toBe('runtime/9.9.9')
    expect(result.stdout).toContain(`stub --transport stdio --db ${path.join(home, 'tasks.db')}`)
  })

  it('reactivates an already installed release without re-extracting', () => {
    const home = newHome()
    packRelease(home, '9.9.9')
    fs.writeFileSync(path.join(home, 'releases', 'desired'), '9.9.9\n')
    expect(runEntrypoint(home).status).toBe(0)

    const again = runEntrypoint(home)

    expect(again.status).toBe(0)
    expect(again.stdout).toContain('release 9.9.9 already installed')
    expect(again.stdout).not.toContain('installed release 9.9.9 at runtime')
    expect(again.stdout).toContain('stub --transport stdio')
  })

  it('falls back to the newest tarball when releases/desired is absent', () => {
    const home = newHome()
    packRelease(home, '1.2.3')
    packRelease(home, '1.2.10')

    const result = runEntrypoint(home)

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('installed release 1.2.10 at runtime/1.2.10')
  })

  it('pins GANTT_VERSION over releases/desired', () => {
    const home = newHome()
    packRelease(home, '1.2.3')
    packRelease(home, '9.9.9')
    fs.writeFileSync(path.join(home, 'releases', 'desired'), '1.2.3\n')

    const result = runEntrypoint(home, { GANTT_VERSION: '9.9.9' })

    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('installed release 9.9.9 at runtime/9.9.9')
  })

  it('refuses a tarball that does not match SHA256SUMS', () => {
    const home = newHome()
    packRelease(home, '9.9.9', { sums: false })
    fs.writeFileSync(path.join(home, 'releases', 'SHA256SUMS'), `${'0'.repeat(64)}  dsh-gantt-9.9.9.tgz\n`)
    fs.writeFileSync(path.join(home, 'releases', 'desired'), '9.9.9\n')

    const result = runEntrypoint(home)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('checksum mismatch for dsh-gantt-9.9.9.tgz')
    expect(fs.existsSync(path.join(home, 'current'))).toBe(false)
  })

  it('reports a missing release instead of starting an unknown version', () => {
    const home = newHome()
    fs.writeFileSync(path.join(home, 'releases', 'desired'), '9.9.9\n')

    const result = runEntrypoint(home)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('missing')
    expect(result.stderr).toContain('releases/dsh-gantt-9.9.9.tgz')
  })
})
