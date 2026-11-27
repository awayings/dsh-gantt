#!/usr/bin/env node

// Release packaging: one tarball, two deployment units.
//
// The artifact is this private package packed from the checkout: the DSH plugin
// bundle (src/, skills/, lib/client.js, cordis.patch.yml, icon.svg) and the MCP
// sidecar CLI (bin/gantt-mcp.js) ship together, `deploy/` carries the systemd
// unit and environment template an operator installs beside it, and `docs/`
// lets the installed copy open its own deployment page. A release publishes
// this tarball plus its SHA256SUMS, and the release workflow attaches both to
// the GitHub Release.
//
//   pnpm run package
//
// Output: .tmp/dist/dsh-gantt-<version>.tgz and .tmp/dist/SHA256SUMS.
// Exit codes: 0 on success, 1 on any failed build or validation.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const dist = path.join(root, '.tmp', 'dist')

// Entries one of the two deployment units needs from inside the tarball. The
// `files` field in package.json decides the packaged tree, but pnpm drops a
// missing pattern silently; failing here turns "deploy/ was never listed" into a
// red release instead of an operator without a systemd unit.
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
  'src/client/index.js',
  'src/shared/vocabulary.js',
  'deploy/gantt-mcp.service',
  'deploy/mcp.env.example',
  'deploy/k3s/gantt-mcp-entrypoint.sh',
  'deploy/k3s/sidecar-patch.yaml',
  'deploy/k3s/upgrade-mcp.sh',
  'deploy/k3s/README.md',
  'docs/deployment.md',
  'docs/mcp.md',
  'skills/gantt-dispatch-flow/SKILL.md',
]

// Dev-only trees that must never reach an operator's machine.
const FORBIDDEN = ['.github/', '.husky/', 'coverage/', 'node_modules/', 'scripts/', 'tests/', '.tmp/']

/** Print an informational line in the same shape the other scripts use. */
function info(message) {
  console.log(`==> package: ${message}`)
}

/** Print an error and stop; the release must not proceed on a partial artifact. */
function fail(message) {
  console.error(`==> package: ${message}`)
  process.exit(1)
}

/** Run a command with inherited output, failing the script on a non-zero exit. */
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error !== undefined) fail(`${command} could not run: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
}

if (process.argv.length > 2) {
  fail(`unexpected argument ${process.argv.slice(2).join(' ')}; run "pnpm run package" without arguments`)
}

info('building the browser half from src/client')
run(process.execPath, [path.join(root, 'scripts', 'build-client.mjs')])

// A stale tarball from an earlier version would be uploaded to the next release
// by the workflow's glob, so every run starts from an empty output directory.
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

info('packing the release tarball')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const packed = spawnSync(
  pnpm,
  ['--silent', 'pack', '--pack-destination', dist, '--ignore-scripts', '--json'],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)
if (packed.error !== undefined) fail(`'${pnpm}' could not run: ${packed.error.message}; install pnpm first`)
if (packed.status !== 0) {
  const detail = String(packed.stderr ?? '').trim()
  fail(`pnpm pack failed with exit code ${String(packed.status)}${detail === '' ? '' : `: ${detail}`}`)
}

/** The pack manifest pnpm prints with `--json`; some versions wrap it in an array. */
function parsePackOutput(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    return Array.isArray(parsed) ? parsed[0] : parsed
  } catch (error) {
    return fail(`pnpm pack did not print JSON (${error.message}); check the pnpm version`)
  }
}

const result = parsePackOutput(packed.stdout)
if (result?.name !== manifest.name || result?.version !== manifest.version) {
  fail(`the tarball is ${String(result?.name)}@${String(result?.version)}, not ${manifest.name}@${manifest.version}`)
}

const files = (result.files ?? []).map(entry => entry.path)
const missing = REQUIRED.filter(required => !files.includes(required))
if (missing.length > 0) fail(`the tarball is missing ${missing.join(', ')}; check "files" in package.json`)

const forbidden = files.filter(file => FORBIDDEN.some(prefix => file.startsWith(prefix)))
if (forbidden.length > 0) fail(`the tarball carries dev-only files (${forbidden.slice(0, 3).join(', ')}); check "files" in package.json`)

const strayLib = files.filter(file => file.startsWith('lib/') && file !== 'lib/client.js')
if (strayLib.length > 0) fail(`lib/ may only ship the single bundled artifact lib/client.js; found ${strayLib.join(', ')}`)

// The scope prefix npm derives from the package name ("local-dsh-gantt-…") reads
// as a leftover in a download URL, so the release asset drops it.
const tarball = path.join(dist, `dsh-gantt-${manifest.version}.tgz`)
renameSync(result.filename, tarball)

const bytes = readFileSync(tarball)
if (bytes.length !== result.size) fail(`the tarball is ${bytes.length} bytes, but pnpm reported ${String(result.size)}`)

// `sha256sum -c SHA256SUMS` is the check an operator runs after downloading.
const digest = createHash('sha256').update(bytes).digest('hex')
writeFileSync(path.join(dist, 'SHA256SUMS'), `${digest}  ${path.basename(tarball)}\n`)

info(`tarball: ${path.relative(root, tarball)} (${(statSync(tarball).size / 1024).toFixed(1)} KiB, ${files.length} files)`)
info(`sha256: ${digest}`)
info(`install the plugin with "dsh plugin --profile web add file:${tarball}"`)
