#!/usr/bin/env node
// Forward one shell command to a remote host over SSH after passing it through
// `scripts/remote-guard.mjs`. Two things matter here and nowhere else:
//
// 1. The safety gate runs *before* SSH is spawned, so a refused command never
//    leaves this machine. The refusal is still written to the audit log.
// 2. Every attempt — allowed, refused or failed — appends a redacted JSON line
//    to `.tmp/remote-exec.log` (or --audit-log), so a token in a `--header`
//    argument is never persisted verbatim and the remote history is traceable.
//
// Usage: node scripts/remote-exec.mjs --target user@host|alias [options] -- command...

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectCommand, redactCommand } from './remote-guard.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const USAGE = `Forward a shell command to a remote host over SSH, refusing destructive commands.

Usage:
  node scripts/remote-exec.mjs --target user@host|alias [options] -- <command...>

Options:
  -t, --target <user@host|alias>
                               Remote target, or an ~/.ssh/config alias (env REMOTE_TARGET; required)
  -i, --identity <file>        SSH private key (env REMOTE_SSH_IDENTITY, else ~/.ssh/id_rsa if present)
  -p, --port <port>            SSH port (env REMOTE_SSH_PORT, default 22)
      --timeout <seconds>      Kill the remote command after N seconds (default 120)
      --stdin                  Forward this process's stdin to the remote command
      --dry-run                Print the SSH command and the guard verdict; do not connect
      --allow-recursive-delete Permit rm -r/-rf, except on structural directories
      --known-hosts <file>     known_hosts file (env REMOTE_KNOWN_HOSTS, else ~/.ssh/known_hosts)
      --audit-log <file>       JSONL audit log (env REMOTE_AUDIT_LOG, else .tmp/remote-exec.log)
      --help                   Show this help

Exit codes: 0 remote success, 2 usage error, 3 refused by the guard, 124 timeout,
otherwise the remote command's exit status.

Examples:
  node scripts/remote-exec.mjs -t k3s-node -- claude mcp list
  node scripts/remote-exec.mjs -t mac -- shasum -a 256 ~/.config/gantt-mcp/token
  node scripts/remote-exec.mjs -t k3s-node --allow-recursive-delete -- rm -rf /tmp/build
  node scripts/remote-exec.mjs -t k3s-node --dry-run -- rm -rf /`

/** @typedef {{ target: string, identity: string, port: number, timeout: number, stdin: boolean, dryRun: boolean, allowRecursiveDelete: boolean, knownHosts: string, auditLog: string, command: string }} Options */

/** @returns {never} */
function fatal(message) {
  process.stderr.write(`remote-exec: ${message}\n`)
  process.exit(2)
}

/**
 * @param {string[]} argv
 * @returns {Options}
 */
function parseArgs(argv) {
  /** @type {Partial<Options> & { command?: string }} */
  const options = {}
  let index = 0
  while (index < argv.length) {
    const arg = argv[index]
    if (arg === '--') {
      index += 1
      break
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE + '\n')
      process.exit(0)
    }
    const takeValue = () => {
      const value = argv[index + 1]
      if (value === undefined) fatal(`${arg} needs a value`)
      index += 2
      return value
    }
    if (arg === '-t' || arg === '--target') options.target = takeValue()
    else if (arg === '-i' || arg === '--identity') options.identity = takeValue()
    else if (arg === '-p' || arg === '--port') options.port = Number(takeValue())
    else if (arg === '--timeout') options.timeout = Number(takeValue())
    else if (arg === '--known-hosts') options.knownHosts = takeValue()
    else if (arg === '--audit-log') options.auditLog = takeValue()
    else if (arg === '--stdin') {
      options.stdin = true
      index += 1
    } else if (arg === '--dry-run') {
      options.dryRun = true
      index += 1
    } else if (arg === '--allow-recursive-delete') {
      options.allowRecursiveDelete = true
      index += 1
    } else fatal(`unknown option ${arg} (put the remote command after --)`)
  }
  const command = argv.slice(index).join(' ')
  if (command.trim() === '') fatal('no command given (put it after --)')
  if (!argv.slice(0, index).includes('--')) fatal('separate the remote command from the options with --')
  const target = options.target ?? process.env.REMOTE_TARGET ?? ''
  if (target === '') fatal('--target user@host|alias (or REMOTE_TARGET) is required')
  if (!/^[A-Za-z0-9._-]+(@[A-Za-z0-9._:][A-Za-z0-9._:-]*)?$/.test(target)) fatal(`invalid target ${target}`)
  const port = options.port ?? Number(process.env.REMOTE_SSH_PORT ?? 22)
  if (!Number.isInteger(port) || port < 1 || port > 65535) fatal('invalid port')
  const timeout = options.timeout ?? 120
  if (!Number.isInteger(timeout) || timeout < 1) fatal('invalid timeout')
  const identity = options.identity ?? process.env.REMOTE_SSH_IDENTITY ?? defaultIdentity()
  if (identity !== '' && !existsSync(identity)) fatal(`identity file not found: ${identity}`)
  const knownHosts = options.knownHosts ?? process.env.REMOTE_KNOWN_HOSTS ?? join(homedir(), '.ssh', 'known_hosts')
  const auditLog = options.auditLog ?? process.env.REMOTE_AUDIT_LOG ?? join(REPO_ROOT, '.tmp', 'remote-exec.log')
  return {
    target,
    identity,
    port,
    timeout,
    stdin: options.stdin === true,
    dryRun: options.dryRun === true,
    allowRecursiveDelete: options.allowRecursiveDelete === true,
    knownHosts,
    auditLog,
    command,
  }
}

/** @returns {string} */
function defaultIdentity() {
  const candidate = join(homedir(), '.ssh', 'id_rsa')
  return existsSync(candidate) ? candidate : ''
}

/**
 * @param {string} command
 * @returns {string}
 */
function sha256(command) {
  return createHash('sha256').update(command).digest('hex')
}

/**
 * Append one JSONL audit entry. The command is redacted and hashed so the log
 * stays committable even when the command carries a bearer token.
 * @param {string} auditLog
 * @param {Record<string, unknown>} entry
 * @returns {void}
 */
function audit(auditLog, entry) {
  try {
    mkdirSync(dirname(auditLog), { recursive: true })
    appendFileSync(auditLog, JSON.stringify(entry) + '\n')
  } catch (error) {
    process.stderr.write(`remote-exec: cannot write audit log ${auditLog}: ${String(error)}\n`)
  }
}

/**
 * @param {Options} options
 * @returns {string[]}
 */
function sshArgs(options) {
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4']
  args.push('-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${options.knownHosts}`)
  if (options.identity !== '') args.push('-i', options.identity)
  if (options.port !== 22) args.push('-p', String(options.port))
  args.push(options.target, options.command)
  return args
}

/**
 * @param {Options} options
 * @param {string} decision
 * @param {string} rule
 * @returns {void}
 */
function record(options, decision, rule) {
  audit(options.auditLog, {
    ts: new Date().toISOString(),
    target: options.target,
    decision,
    rule,
    sha256: sha256(options.command),
    command: redactCommand(options.command),
  })
}

/**
 * @param {Options} options
 * @returns {Promise<number>}
 */
async function run(options) {
  const refusal = inspectCommand(options.command, { allowRecursiveDelete: options.allowRecursiveDelete })
  if (refusal !== null) {
    record(options, 'refused', refusal.rule)
    process.stderr.write(`remote-exec: refused (${refusal.rule}): ${refusal.reason}\n`)
    process.stderr.write('remote-exec: the command was not sent; see --help for the guard rules\n')
    return 3
  }
  const redacted = redactCommand(options.command)
  if (options.dryRun) {
    process.stdout.write(`remote-exec: target ${options.target}\n`)
    process.stdout.write(`remote-exec: identity ${options.identity === '' ? '(ssh default)' : options.identity}\n`)
    process.stdout.write(`remote-exec: audit ${options.auditLog}\n`)
    process.stdout.write(`remote-exec: guard allowed\n`)
    process.stdout.write(`remote-exec: ssh ${options.target} '${redacted}'\n`)
    return 0
  }
  record(options, 'allowed', '')
  const started = Date.now()
  const child = spawn('ssh', sshArgs(options), {
    stdio: [options.stdin ? 'inherit' : 'ignore', 'inherit', 'inherit'],
  })
  const timer = setTimeout(() => {
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 5000).unref()
  }, options.timeout * 1000)
  const code = await new Promise((resolveExit) => {
    child.on('error', (error) => {
      process.stderr.write(`remote-exec: cannot run ssh: ${String(error)}\n`)
      resolveExit(127)
    })
    child.on('close', (exitCode) => resolveExit(exitCode ?? (child.killed ? 124 : 1)))
  })
  clearTimeout(timer)
  const timedOut = code === 124 || code === 137
  audit(options.auditLog, {
    ts: new Date().toISOString(),
    target: options.target,
    decision: 'finished',
    rule: timedOut ? 'timeout' : '',
    sha256: sha256(options.command),
    command: redacted,
    exit: code,
    duration_ms: Date.now() - started,
  })
  if (timedOut) process.stderr.write(`remote-exec: timed out after ${options.timeout}s\n`)
  return code
}

const options = parseArgs(process.argv.slice(2))
process.exitCode = await run(options)
