import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { appendAudit, defaultIdentityFile, shellQuote, sshForwardArgs, SSH_TARGET_PATTERN } from '../../src/host/remote.js'
import { makeTempDir, removeTempDir } from '../helpers/gantt.js'

describe('ssh forward args', () => {
  it('builds a batch-mode argv with the target and command last', () => {
    const args = sshForwardArgs({ target: 'k3s-node', command: 'lo -p' })
    expect(args.slice(0, 8)).toEqual([
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
    ])
    expect(args).toContain('-o')
    expect(args).toContain('StrictHostKeyChecking=accept-new')
    expect(args[args.length - 2]).toBe('k3s-node')
    expect(args[args.length - 1]).toBe('lo -p')
  })

  it('adds the identity, port, and known-hosts file when given', () => {
    const args = sshForwardArgs({ target: 'mac', command: 'co exec', identity: '/keys/id_rsa', port: 2222, knownHosts: '/tmp/known' })
    expect(args).toContain('-i')
    expect(args).toContain('/keys/id_rsa')
    expect(args).toContain('-p')
    expect(args).toContain('2222')
    expect(args).toContain('-o')
    expect(args).toContain('UserKnownHostsFile=/tmp/known')
  })

  it('validates targets the same way the manual CLI does', () => {
    expect(SSH_TARGET_PATTERN.test('k3s-node')).toBe(true)
    expect(SSH_TARGET_PATTERN.test('jason@192.168.1.5')).toBe(true)
    expect(SSH_TARGET_PATTERN.test('bad host')).toBe(false)
    expect(SSH_TARGET_PATTERN.test('jason@host;rm')).toBe(false)
    expect(SSH_TARGET_PATTERN.test('')).toBe(false)
  })
})

describe('shellQuote', () => {
  it('wraps text in single quotes', () => {
    expect(shellQuote('plain')).toBe("'plain'")
  })

  it('escapes embedded single quotes the POSIX way', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'")
    expect(shellQuote('a\nb')).toBe("'a\nb'")
  })
})

describe('defaultIdentityFile', () => {
  it('returns the default key only when it exists', () => {
    vi.stubEnv('HOME', '/nonexistent-dsh-gantt-home')
    expect(defaultIdentityFile()).toBe('')
    vi.unstubAllEnvs()
    const home = makeTempDir('dsh-gantt-remote-home-')
    try {
      mkdirSync(join(home, '.ssh'), { recursive: true })
      writeFileSync(join(home, '.ssh', 'id_rsa'), 'dummy-key')
      vi.stubEnv('HOME', home)
      expect(defaultIdentityFile()).toBe(join(home, '.ssh', 'id_rsa'))
      vi.unstubAllEnvs()
    } finally {
      removeTempDir(home)
    }
  })
})

describe('appendAudit', () => {
  it('appends one JSON line per entry, creating the directory', () => {
    const dir = makeTempDir('dsh-gantt-remote-')
    try {
      const log = join(dir, 'nested', 'audit.jsonl')
      appendAudit(log, { decision: 'allowed' })
      appendAudit(log, { decision: 'finished' })
      expect(readFileSync(log, 'utf8')).toBe('{"decision":"allowed"}\n{"decision":"finished"}\n')
    } finally {
      removeTempDir(dir)
    }
  })

  it('never throws when the log is unwritable', () => {
    const dir = makeTempDir('dsh-gantt-remote-')
    try {
      const blocker = join(dir, 'blocker')
      writeFileSync(blocker, 'not a directory')
      const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      expect(() => appendAudit(join(blocker, 'audit.jsonl'), { decision: 'allowed' })).not.toThrow()
      expect(stderr.mock.calls.some(call => String(call[0]).includes('cannot write audit log'))).toBe(true)
      stderr.mockRestore()
    } finally {
      removeTempDir(dir)
    }
  })
})
