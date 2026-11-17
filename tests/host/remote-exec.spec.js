import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The wrapper has to be tested as a process, not as a function: the contract is
// "a refused command never reaches ssh" and "the audit log never stores a
// token". Both are only observable by spawning the CLI with a fake ssh on PATH.

const SCRIPT = 'scripts/remote-exec.mjs'

let dir
let sshLog
let auditLog

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remote-exec-'))
  mkdirSync(join(dir, 'bin'))
  writeFileSync(
    join(dir, 'bin', 'ssh'),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$@" >> "$FAKE_SSH_LOG"\necho "fake-ssh-ok"\nexit "${FAKE_SSH_EXIT:-0}"\n',
  )
  chmodSync(join(dir, 'bin', 'ssh'), 0o755)
  writeFileSync(join(dir, 'identity'), 'dummy-key')
  sshLog = join(dir, 'ssh.log')
  auditLog = join(dir, 'audit.log')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Run the CLI with the fake ssh first on PATH.
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
function run(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      FAKE_SSH_LOG: sshLog,
      ...env,
    },
  })
}

/** The options shared by every case: a throwaway identity, known_hosts and audit log. */
function common() {
  return ['--target', 'jason@example.test', '--identity', join(dir, 'identity'), '--known-hosts', join(dir, 'known_hosts'), '--audit-log', auditLog]
}

/** @param {string} file */
function readLines(file) {
  return readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line))
}

describe('remote-exec CLI', () => {
  it('forwards an allowed command to ssh and records both audit entries', () => {
    const result = run([...common(), '--', 'claude mcp list'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('fake-ssh-ok')
    const sshArgs = readFileSync(sshLog, 'utf8')
    expect(sshArgs).toContain('jason@example.test')
    expect(sshArgs).toContain('claude mcp list')
    const entries = readLines(auditLog)
    expect(entries.map(entry => entry.decision)).toEqual(['allowed', 'finished'])
    expect(entries[1].exit).toBe(0)
    expect(entries[1].command).toBe('claude mcp list')
  })

  it('refuses a destructive command before ssh is spawned', () => {
    const result = run([...common(), '--', 'rm -rf /'])
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('refused (rm-recursive)')
    expect(existsSync(sshLog)).toBe(false)
    const entries = readLines(auditLog)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ decision: 'refused', rule: 'rm-recursive' })
  })

  it('allows a recursive delete only on a scoped path with the explicit flag', () => {
    const refused = run([...common(), '--', 'rm -rf /tmp/build'])
    expect(refused.status).toBe(3)
    const allowed = run([...common(), '--allow-recursive-delete', '--', 'rm -rf /tmp/build'])
    expect(allowed.status).toBe(0)
  })

  it('never lets --allow-recursive-delete reach a structural directory', () => {
    const result = run([...common(), '--allow-recursive-delete', '--', 'rm -rf /data'])
    expect(result.status).toBe(3)
    expect(result.stderr).toContain('refused (rm-protected)')
    expect(existsSync(sshLog)).toBe(false)
  })

  it('dry-run prints the plan and does not connect', () => {
    const result = run([...common(), '--dry-run', '--', 'claude mcp list'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('guard allowed')
    expect(result.stdout).toContain('ssh jason@example.test')
    expect(existsSync(sshLog)).toBe(false)
    expect(existsSync(auditLog)).toBe(false)
  })

  it('redacts bearer tokens in the audit log', () => {
    const result = run([
      ...common(),
      '--',
      'claude mcp add -H "Authorization: Bearer topsecret123456" http://example.test/mcp',
    ])
    expect(result.status).toBe(0)
    const raw = readFileSync(auditLog, 'utf8')
    expect(raw).not.toContain('topsecret123456')
    expect(raw).toContain('Bearer ***')
  })

  it('passes the remote exit status through and records it', () => {
    const result = run([...common(), '--', 'false'], { FAKE_SSH_EXIT: '9' })
    expect(result.status).toBe(9)
    const entries = readLines(auditLog)
    expect(entries[1].exit).toBe(9)
  })

  it('accepts an ~/.ssh/config alias as the target', () => {
    const result = run(['--target', 'mac', '-i', join(dir, 'identity'), '--known-hosts', join(dir, 'known_hosts'), '--audit-log', auditLog, '--dry-run', '--', 'true'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('ssh mac')
  })

  it('rejects a target that could be read as an ssh option', () => {
    const result = run(['--target', '-oProxyCommand=x', '--', 'true'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('invalid target')
  })

  it('requires a target and an explicit -- before the command', () => {
    const noTarget = run(['--', 'true'])
    expect(noTarget.status).toBe(2)
    expect(noTarget.stderr).toContain('--target')
    const noSeparator = run(['--target', 'jason@example.test', '-i', join(dir, 'identity'), 'echo', 'hi'])
    expect(noSeparator.status).toBe(2)
    expect(noSeparator.stderr).toContain('--')
  })
})
