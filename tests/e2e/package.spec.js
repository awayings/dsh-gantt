// The release artifact contract: `pnpm run package` must produce one tarball
// that serves both deployment units — the DSH plugin bundle and the gantt-mcp
// sidecar — plus the checksums a release publishes next to it. The plugin is
// private, so this tarball is what an operator installs from; a missing entry
// here is a broken release, not a missing feature.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')
const DIST = path.join(ROOT, '.tmp', 'dist')
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const TARBALL = path.join(DIST, `dsh-gantt-${VERSION}.tgz`)

/** The entries one of the two deployment units needs inside the tarball. */
const REQUIRED = [
  'package.json',
  'cordis.patch.yml',
  'icon.svg',
  'README.md',
  'bin/gantt-mcp.js',
  'lib/client.js',
  'src/host/index.js',
  'src/host/store.js',
  'src/host/mcp.js',
  'src/host/long-run.js',
  'src/host/knowledge.js',
  'src/host/store/knowledge.js',
  'src/client/index.js',
  'deploy/gantt-mcp.service',
  'deploy/mcp.env.example',
  'deploy/k3s/gantt-mcp-entrypoint.sh',
  'deploy/k3s/sidecar-patch.yaml',
  'deploy/k3s/upgrade-mcp.sh',
  'deploy/k3s/README.md',
  'docs/deployment.md',
  'docs/mcp.md',
  'docs/long-run-persona.md',
]

const FORBIDDEN = ['tests/', 'node_modules/', 'coverage/', 'scripts/', '.github/', '.husky/']

/** Run a command and return its stdout; a non-zero exit fails the test. */
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
}

/** A fresh temporary directory for unpacking or installing the artifact. */
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-gantt-artifact-'))
}

describe('release tarball', () => {
  it('packs both deployment units and nothing from the dev tree', () => {
    const stdout = run(process.execPath, [path.join(ROOT, 'scripts', 'package.mjs')], { cwd: ROOT })
    expect(stdout).toContain('==> package: tarball:')

    const packed = run('tar', ['-tzf', TARBALL])
      .trim()
      .split('\n')
      .map(entry => entry.replace(/^(?:\.\/)?package\//, ''))
    for (const required of REQUIRED) expect(packed, required).toContain(required)
    for (const forbidden of FORBIDDEN) {
      expect(packed.filter(entry => entry.startsWith(forbidden)), forbidden).toEqual([])
    }
    expect(packed.filter(entry => entry.startsWith('lib/'))).toEqual(['lib/client.js'])

    // `sha256sum -c SHA256SUMS` is the check an operator runs after downloading.
    const [digest, name] = fs
      .readFileSync(path.join(DIST, 'SHA256SUMS'), 'utf8')
      .trim()
      .split(/\s+/)
    expect(name).toBe(path.basename(TARBALL))
    expect(digest).toBe(createHash('sha256').update(fs.readFileSync(TARBALL)).digest('hex'))
  })

  it('starts the MCP sidecar from the unpacked artifact alone', () => {
    const dir = tempDir()
    try {
      run('tar', ['-xzf', TARBALL, '-C', dir])
      const packageDir = path.join(dir, 'package')
      const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
      // The two entries DSH resolves when the bundle is mounted.
      expect(manifest.name).toBe('@local/dsh-gantt')
      expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
      expect(manifest.exports['./client']).toBe('./lib/client.js')
      // The subpath the gantt-long-run preset declaration mounts.
      expect(manifest.exports['./long-run']).toBe('./src/host/long-run.js')

      // The sidecar half has no DSH runtime dependency: resolving its imports
      // from the tarball alone must work, without this checkout on the path.
      const help = run(process.execPath, [path.join(packageDir, 'bin', 'gantt-mcp.js'), '--help'], { cwd: dir })
      expect(help).toContain('Usage: gantt-mcp')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('installs into a profile directory as a package dependency', () => {
    const dir = tempDir()
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'artifact-profile', private: true })}\n`)
      const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
      run(pnpm, ['add', '--ignore-scripts', `file:${TARBALL}`], { cwd: dir })
      const installed = path.join(dir, 'node_modules', '@local', 'dsh-gantt')
      const manifest = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'))
      expect(manifest.version).toBe(VERSION)
      expect(fs.existsSync(path.join(installed, 'deploy', 'gantt-mcp.service'))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
