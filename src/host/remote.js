// Shared plumbing for forwarding one guarded shell command to a remote host
// over SSH. Two callers share it: `scripts/remote-exec.mjs` (the manual CLI)
// and `src/host/dispatch.js` (the `gantt_delegate` tool). Nothing here spawns
// a process, so unit tests exercise it directly; the callers own spawn, the
// ack window, and the lifetime of the connection.

import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** An ssh target as the CLI accepts it: `user@host` or an `~/.ssh/config`
 * alias. Colons stay out of the user part; the host part tolerates them the
 * way the manual wrapper always has. */
export const SSH_TARGET_PATTERN = /^[A-Za-z0-9._-]+(@[A-Za-z0-9._:][A-Za-z0-9._:-]*)?$/

/**
 * The argv that forwards one command: batch mode so an unattended run never
 * blocks on a password prompt, a bounded connect timeout, keepalives so a
 * silent network drop cannot hang the channel, and host-key accept-new so a
 * first connection to a fresh host still succeeds without a TTY.
 * `configFile` matters in containers: ssh resolves its default config
 * through the passwd database, whose home is ephemeral there, so the
 * persistent `$HOME/.ssh/config` (aliases, per-host key algorithms) must be
 * passed explicitly.
 * @param {{ target: string, command: string, identity?: string, port?: number, knownHosts?: string, configFile?: string }} options
 * @returns {string[]}
 */
export function sshForwardArgs({ target, command, identity = '', port = 22, knownHosts = '', configFile = '' }) {
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4']
  if (configFile !== '') args.push('-F', configFile)
  if (knownHosts !== '') args.push('-o', `UserKnownHostsFile=${knownHosts}`)
  args.push('-o', 'StrictHostKeyChecking=accept-new')
  if (identity !== '') args.push('-i', identity)
  if (port !== 22) args.push('-p', String(port))
  args.push(target, command)
  return args
}

/**
 * `~/.ssh/id_rsa` when present, else '' (ssh then falls back to its own
 * defaults: config identities and the agent).
 * @returns {string}
 */
export function defaultIdentityFile() {
  const candidate = join(homedir(), '.ssh', 'id_rsa')
  return existsSync(candidate) ? candidate : ''
}

/**
 * The ssh config file under the ambient home, '' when there is none. See
 * {@link sshForwardArgs} for why callers pass it explicitly.
 * @returns {string}
 */
export function defaultSshConfigFile() {
  const candidate = join(homedir(), '.ssh', 'config')
  return existsSync(candidate) ? candidate : ''
}

/**
 * An identity ssh will actually load. ssh refuses keys readable beyond their
 * owner, and PVC-backed homes typically carry 0660 keys, so a loose key is
 * copied once — content-hashed name, owner-only mode — to the temp directory,
 * the same accommodation k3s-lab's sync-workers.sh makes. A missing requested
 * path passes through unchanged and ssh reports it.
 * @param {string} requested the identity the caller resolved, '' for none
 * @returns {string}
 */
export function usableIdentityFile(requested = '') {
  const identity = requested === '' ? defaultIdentityFile() : requested
  if (identity === '' || !existsSync(identity)) return identity
  const mode = statSync(identity).mode & 0o777
  if ((mode & 0o077) === 0) return identity
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 16)
  const copy = join(tmpdir(), `dsh-gantt-key-${digest}`)
  if (!existsSync(copy) || (statSync(copy).mode & 0o777) !== 0o600) {
    copyFileSync(identity, `${copy}.tmp`)
    chmodSync(`${copy}.tmp`, 0o600)
    renameSync(`${copy}.tmp`, copy)
  }
  return copy
}

/**
 * One POSIX single-quoted literal: no character of the wrapped text can
 * break out of the quotes, so a task brief substituted into a remote command
 * stays an argument.
 * @param {string} text
 * @returns {string}
 */
export function shellQuote(text) {
  return `'${String(text).replaceAll("'", "'\\''")}'`
}

/**
 * Append one JSON line to the audit log so every remote attempt — allowed,
 * refused, finished — stays traceable. A logging failure is written to
 * stderr but never thrown: the dispatch must not die on its own bookkeeping.
 * @param {string} auditLog
 * @param {Record<string, unknown>} entry
 * @returns {void}
 */
export function appendAudit(auditLog, entry) {
  try {
    mkdirSync(dirname(auditLog), { recursive: true })
    appendFileSync(auditLog, JSON.stringify(entry) + '\n')
  } catch (error) {
    process.stderr.write(`remote-exec: cannot write audit log ${auditLog}: ${String(error)}\n`)
  }
}
