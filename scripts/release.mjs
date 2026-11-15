#!/usr/bin/env node

// Release helper. The version bump lands on main first, through the push gate; this
// script refuses to tag anything else, runs the same gate the release workflow
// runs, then creates the annotated tag and optionally pushes it and waits for
// the workflow.
//
//   pnpm run release 1.1.0            # validate + tag locally
//   pnpm run release 1.1.0 --dry-run  # validate only
//   pnpm run release 1.1.0 --push     # validate + tag + push + wait for CI
//
// Exit codes: 0 on success, 1 on any failed validation or command.

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

const USAGE = `usage: pnpm run release <X.Y.Z> [--dry-run] [--push]

  X.Y.Z      version to release; must equal package.json "version"
  --dry-run  run every validation, then stop before creating the tag
  --push     push the tag and wait for the Release workflow`

const info = message => console.log(`==> release: ${message}`)

function fail(message) {
  console.error(`==> release: ${message}`)
  process.exit(1)
}

/** Runs a command and returns trimmed stdout; throws on a non-zero exit. */
function capture(command, args, { allowFailure = false } = {}) {
  try {
    return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    if (allowFailure) return null
    const detail = String(error.stderr ?? '').trim() || error.message
    fail(`${command} ${args.join(' ')} failed: ${detail}`)
  }
}

/** Runs a pnpm script with inherited output; exits with its status on failure. */
function runPnpm(scriptArgs) {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(command, ['run', ...scriptArgs], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function hasCommand(command) {
  return capture(command, ['--version'], { allowFailure: true }) !== null
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const argv = process.argv.slice(2)
const flags = argv.filter(arg => arg.startsWith('--'))
const positional = argv.filter(arg => !arg.startsWith('--'))
const unknown = flags.filter(flag => !['--dry-run', '--push'].includes(flag))

if (unknown.length > 0) fail(`unknown option ${unknown.join(', ')}\n\n${USAGE}`)
if (positional.length !== 1) fail(USAGE)

const version = positional[0]
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) fail(`not a semantic version: ${version}`)

const tag = `v${version}`
const dryRun = flags.includes('--dry-run')
const push = flags.includes('--push')

info(`checking ${tag}`)

if (capture('git', ['status', '--porcelain']) !== '') {
  fail('the worktree is not clean; commit or stash the changes first')
}

const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') fail(`releases are cut from main, currently on ${branch}`)

info('fetching origin/main')
capture('git', ['fetch', '--quiet', 'origin', 'main'])

const head = capture('git', ['rev-parse', 'HEAD'])
const remoteHead = capture('git', ['rev-parse', 'origin/main'])
if (head !== remoteHead) fail('local main differs from origin/main; push the release commit first')

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
if (pkg.version !== version) {
  fail(`package.json says ${pkg.version}, but the release would be ${tag}; land the version bump on main first`)
}

if (capture('git', ['tag', '--list', tag]) !== '') fail(`tag ${tag} already exists locally`)
if (capture('git', ['ls-remote', '--tags', 'origin', tag]) !== '') fail(`tag ${tag} already exists on origin`)

info('running pnpm run verify')
runPnpm(['verify'])

info('running the full gate (pnpm run check --full)')
runPnpm(['check', '--full'])

if (dryRun) {
  info(`dry run: all validations passed; would tag ${head.slice(0, 12)} as ${tag}${push ? ' and push it' : ''}`)
  process.exit(0)
}

info(`tagging ${head.slice(0, 12)} as ${tag}`)
capture('git', ['tag', '--annotate', tag, '--message', tag])

if (!push) {
  info(`tag ${tag} created locally; publish it with "git push origin ${tag}" or "pnpm run release ${version} --push"`)
  process.exit(0)
}

info(`pushing ${tag}`)
capture('git', ['push', 'origin', tag])

const rollback = `if the workflow failed, delete the tag with "git tag -d ${tag} && git push origin :${tag}", fix, and re-run this script`

if (!hasCommand('gh')) {
  info(`pushed; watch the Release workflow for ${tag} in the browser. ${rollback}`)
  process.exit(0)
}

let runId = ''
for (let attempt = 0; attempt < 12 && runId === ''; attempt += 1) {
  await sleep(attempt === 0 ? 2000 : 5000)
  const found = capture(
    'gh',
    ['run', 'list', '--workflow', 'release.yml', '--limit', '20', '--json', 'databaseId,headSha',
      '--jq', `.[] | select(.headSha == "${head}") | .databaseId`],
    { allowFailure: true },
  )
  runId = found?.split('\n')[0]?.trim() ?? ''
}

if (runId === '') {
  info(`tag pushed, but no Release workflow run was found for ${head.slice(0, 12)}; check the Actions tab. ${rollback}`)
  process.exit(0)
}

info(`watching Release workflow run ${runId}`)
const watched = spawnSync('gh', ['run', 'watch', runId, '--exit-status', '--interval', '10'], { cwd: root, stdio: 'inherit' })
if (watched.status !== 0) {
  fail(`the Release workflow failed; ${rollback}`)
}

info(`release ${tag} published: run "gh release view ${tag} --web" to review the notes`)
info(`polish the notes from .github/release_template.md with "gh release edit ${tag} --notes-file <file>"`)
info('run "pnpm run deploy --check" to confirm the served profile still links this checkout, then smoke-test the Gantt page before announcing the release')
