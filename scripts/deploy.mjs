#!/usr/bin/env node

// Deploy helper. The package is private and shipped as source, so "deploy"
// means one pnpm `link:` dependency in a DSH profile plus the bundle selection
// that `dsh plugin add` records. Nothing is copied and nothing is built: the
// profile keeps resolving this checkout, so edits to `index.js` / `store.js`
// are live after a `dsh web` restart and edits to `client.js` after a reload.
//
//   pnpm run deploy                        # link this checkout and verify it
//   pnpm run deploy --check                # verify only, change no dependency
//   pnpm run deploy --uninstall            # remove the bundle from the profile
//   pnpm run deploy --profile tui --home ~/.dsh
//
// The profile lives outside the repository, so the command needs write access
// to `$DSH_HOME/profiles/<profile>`; a sandboxed agent session must run it with
// full filesystem access.
//
// Exit codes: 0 on success, 1 on any failed validation or command.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const packageName = manifest.name
const packageVersion = manifest.version

const USAGE = `usage: pnpm run deploy [--check | --uninstall] [--profile <name>] [--home <dir>]

  --check        verify that the profile links to this checkout; change nothing
  --uninstall    remove the bundle from the profile
  --profile <n>  DSH profile to deploy into (default: $DSH_PROFILE, else web)
  --home <dir>   DSH home that holds the profiles (default: $DSH_HOME, else ~/.dsh)
  --help         print this message`

function info(message) {
  console.log(`==> deploy: ${message}`)
}

function fail(message) {
  console.error(`==> deploy: ${message}`)
  process.exit(1)
}

/** Expand a leading `~` so `--home ~/.dsh` behaves like the shell. */
function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith(`~${path.sep}`)) return path.join(homedir(), value.slice(2))
  return value
}

/** Compare two paths, tolerating case differences and Windows long-path prefixes. */
function sameDirectory(left, right) {
  const canonicalize = value => {
    const resolved = path.resolve(value).replace(/^\\\\\?\\/, '')
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  return canonicalize(left) === canonicalize(right)
}

/** Run a command and return its stdout; exit the script unless the call is allowed to fail. */
function capture(command, args, env, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error !== undefined) {
    if (allowFailure) return null
    fail(`${command} could not run: ${result.error.message}`)
  }
  if (result.status !== 0) {
    if (allowFailure) return null
    const detail = String(result.stderr ?? '').trim()
    fail(`${command} ${args.join(' ')} failed${detail === '' ? '' : `: ${detail}`}`)
  }
  return result.stdout
}

/** Run a command with inherited output; exit the script on a non-zero status. */
function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error !== undefined) fail(`${command} could not run: ${result.error.message}`)
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`)
}

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE)
  process.exit(0)
}

const options = { check: false, uninstall: false }
for (let index = 0; index < argv.length; index += 1) {
  const argument = argv[index]
  if (argument === '--check' || argument === '--uninstall') {
    options[argument.slice(2)] = true
    continue
  }
  if (argument === '--profile' || argument === '--home') {
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) fail(`${argument} needs a value\n\n${USAGE}`)
    options[argument.slice(2)] = value
    index += 1
    continue
  }
  fail(`unknown argument ${argument}\n\n${USAGE}`)
}
if (options.check && options.uninstall) fail('--check and --uninstall are mutually exclusive')

const home = path.resolve(expandHome(options.home ?? process.env.DSH_HOME ?? path.join(homedir(), '.dsh')))
const profile = options.profile ?? process.env.DSH_PROFILE ?? 'web'
const profileDir = path.join(home, 'profiles', profile)
const env = { ...process.env, DSH_HOME: home }
const dsh = process.env.DSH_GANTT_DSH ?? (process.platform === 'win32' ? 'dsh.cmd' : 'dsh')

/** The profile manifest, or undefined before the profile is initialized. */
function profileManifest() {
  const file = path.join(profileDir, 'package.json')
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`)
  }
}

/** The dependency value the profile records for this package. */
function recordedSpec(document) {
  return document?.dependencies?.[packageName]
}

/** The directory the profile's node_modules entry resolves to, or undefined. */
function linkedDirectory() {
  try {
    return realpathSync(path.join(profileDir, 'node_modules', ...packageName.split('/')))
  } catch {
    return undefined
  }
}

/** Prove the profile records, selects, links, and composes this checkout. */
function verifyInstalled() {
  const document = profileManifest()
  if (document === undefined) fail(`profile '${profile}' is not initialized at ${profileDir}; run \`dsh plugin --profile ${profile} add ${root}\` first`)
  const spec = recordedSpec(document)
  if (spec !== `link:${root}`) fail(`profile '${profile}' records ${packageName} as ${spec ?? 'nothing'}, not link:${root}; run \`pnpm run deploy\` to link this checkout`)
  if (!(document.dsh?.profile?.bundles ?? []).includes(packageName)) fail(`profile '${profile}' does not select ${packageName} as a bundle; run \`pnpm run deploy\``)
  const linked = linkedDirectory()
  if (linked === undefined) fail(`profile '${profile}' has no installed ${packageName} under ${path.join(profileDir, 'node_modules')}; run \`pnpm run deploy\``)
  if (!sameDirectory(linked, root)) fail(`profile '${profile}' links ${packageName} to ${linked}, not ${root}; run \`pnpm run deploy\``)
  if (!capture(dsh, ['--profile', profile, '--dump-config'], env).includes(packageName)) {
    fail(`the composed '${profile}' tree does not contain ${packageName}; check ${path.join(profileDir, 'cordis.patch.yml')}`)
  }
}

/** Print where the deployment points and what to do next. */
function report() {
  info(`profile '${profile}' links ${packageName} ${packageVersion} to ${root} and composes it`)
  info(`database: ${path.join(home, 'gantt', 'tasks.db')} (override before start with DSH_GANTT_DB)`)
  info('reload the Web page for client.js changes; restart "dsh web" for index.js/store.js changes')
}

function deploy() {
  const document = profileManifest()
  const linked = linkedDirectory()
  if (recordedSpec(document) === `link:${root}` && linked !== undefined && sameDirectory(linked, root)) {
    info(`already linked: ${packageName} -> ${root}`)
  } else {
    if (document === undefined) info(`initializing profile '${profile}' at ${profileDir}`)
    info(`linking ${root} into profile '${profile}'`)
    run(dsh, ['plugin', '--profile', profile, 'add', root], env)
  }
  verifyInstalled()
  report()
}

function check() {
  if (profileManifest() === undefined) fail(`profile '${profile}' is not initialized at ${profileDir}; run \`pnpm run deploy\` to create and link it`)
  verifyInstalled()
  report()
}

function uninstall() {
  if (recordedSpec(profileManifest()) === undefined) {
    info(`profile '${profile}' does not install ${packageName}; nothing to remove`)
    return
  }
  info(`removing ${packageName} from profile '${profile}'`)
  run(dsh, ['plugin', '--profile', profile, 'remove', packageName], env)
  const document = profileManifest()
  if (recordedSpec(document) !== undefined) fail(`${profileDir}/package.json still records ${packageName}`)
  if ((document?.dsh?.profile?.bundles ?? []).includes(packageName)) fail(`${profileDir}/package.json still selects ${packageName} as a bundle`)
  info(`removed ${packageName}; the database at ${path.join(home, 'gantt', 'tasks.db')} stays on disk`)
}

if (capture(dsh, ['--version'], env, { allowFailure: true }) === null) {
  fail(`'${dsh}' was not found or exited non-zero; install @deepseek-ai/dsh, or set DSH_GANTT_DSH to its executable`)
}

if (options.check) check()
else if (options.uninstall) uninstall()
else deploy()
