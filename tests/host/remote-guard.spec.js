import { describe, expect, it } from 'vitest'
import { RULES, inspectCommand, redactCommand } from '../../scripts/remote-guard.mjs'

/** @param {string} command @param {{ allowRecursiveDelete?: boolean }} [options] */
function ruleOf(command, options) {
  const refusal = inspectCommand(command, options)
  return refusal === null ? '' : refusal.rule
}

describe('remote guard: allowed commands', () => {
  it('allows ordinary remote commands', () => {
    expect(inspectCommand('claude mcp list')).toBeNull()
    expect(inspectCommand('claude mcp add --transport http gantt http://host:18765/mcp --scope user')).toBeNull()
    expect(inspectCommand('curl -sS http://100.83.77.65:18765/healthz')).toBeNull()
    expect(inspectCommand('npm install -g @anthropic-ai/claude-code')).toBeNull()
    expect(inspectCommand('git -C /home/jason/k3s-lab pull --ff-only')).toBeNull()
  })

  it('allows deleting files and empty-directory removes', () => {
    expect(inspectCommand('rm /tmp/report.json')).toBeNull()
    expect(inspectCommand('rmdir /tmp/empty')).toBeNull()
  })

  it('does not treat quoted text as a command', () => {
    expect(inspectCommand('grep -F "rm -rf /" /var/log/syslog')).toBeNull()
    expect(inspectCommand('echo "rm -rf /" > /tmp/note')).toBeNull()
  })

  it('allows a recursive delete under an allowed path only when explicitly enabled', () => {
    expect(ruleOf('rm -rf /tmp/build')).toBe('rm-recursive')
    expect(inspectCommand('rm -rf /tmp/build', { allowRecursiveDelete: true })).toBeNull()
    expect(inspectCommand('rm -r ./node_modules', { allowRecursiveDelete: true })).toBeNull()
    expect(inspectCommand('rm -rf /home/jason/.cache/pip', { allowRecursiveDelete: true })).toBeNull()
  })
})

describe('remote guard: destructive commands are refused', () => {
  it('refuses a recursive delete by default', () => {
    expect(ruleOf('rm -rf /tmp/build')).toBe('rm-recursive')
    expect(ruleOf('rm -fr /tmp/build')).toBe('rm-recursive')
    expect(ruleOf('rm --recursive --force /tmp/build')).toBe('rm-recursive')
  })

  it('still refuses structural directories even with the explicit flag', () => {
    for (const command of [
      'rm -rf /',
      'rm -rf /*',
      'rm -rf /data',
      'rm -rf /usr',
      'rm -rf /etc',
      'rm -rf /home',
      'rm -rf /home/jason',
      'rm -rf ~',
      'rm -rf $HOME',
      'rm -rf ./..',
      'rm -rf *',
      'rm -rf /data/*',
    ]) {
      expect(ruleOf(command, { allowRecursiveDelete: true })).toBe('rm-protected')
    }
  })

  it('sees through wrapper prefixes', () => {
    expect(ruleOf('sudo rm -rf /')).toBe('rm-recursive')
    expect(ruleOf('sudo -u root rm -rf /etc')).toBe('rm-recursive')
    expect(ruleOf('env A=1 rm -rf ~')).toBe('rm-recursive')
    expect(ruleOf('timeout 30s rm -rf /var')).toBe('rm-recursive')
    expect(ruleOf('nice -n 5 rm -rf /usr')).toBe('rm-recursive')
    expect(ruleOf('xargs -0 rm -rf /')).toBe('rm-recursive')
    expect(ruleOf('command rm -r /tmp/x')).toBe('rm-recursive')
    expect(ruleOf('time rm -rf /srv')).toBe('rm-recursive')
  })

  it('sees through shell -c payloads and command substitutions', () => {
    expect(ruleOf('bash -c "rm -rf /"')).toBe('rm-recursive')
    expect(ruleOf("sh -lc 'sudo rm -rf /data'")).toBe('rm-recursive')
    expect(ruleOf('eval "rm -rf /etc"')).toBe('rm-recursive')
    expect(ruleOf('echo "$(rm -rf /)"')).toBe('rm-recursive')
    expect(ruleOf('echo `rm -rf /`')).toBe('rm-recursive')
    expect(ruleOf('foo; rm -rf /var; bar')).toBe('rm-recursive')
    expect(ruleOf('true && rm -rf /opt || echo no')).toBe('rm-recursive')
    expect(ruleOf('echo ok | rm -rf /mnt')).toBe('rm-recursive')
  })

  it('refuses disk wipes and block-device writes', () => {
    expect(ruleOf('mkfs.ext4 /dev/sdb1')).toBe('disk-wipe')
    expect(ruleOf('sudo mkfs -t ext4 /dev/sdb1')).toBe('disk-wipe')
    expect(ruleOf('wipefs -a /dev/sdc')).toBe('disk-wipe')
    expect(ruleOf('dd if=/dev/zero of=/dev/sda bs=1M')).toBe('device-write')
    expect(ruleOf('dd if=/dev/zero of=/dev/nvme0n1')).toBe('device-write')
    expect(ruleOf('echo garbage > /dev/sda')).toBe('device-write')
  })

  it('refuses host-wide kills and power commands', () => {
    expect(ruleOf('kill -9 -1')).toBe('kill-all')
    expect(ruleOf('killall5 -9')).toBe('kill-all')
    expect(ruleOf('shutdown -h now')).toBe('power')
    expect(ruleOf('sudo reboot')).toBe('power')
    expect(ruleOf('systemctl poweroff')).toBe('power')
    expect(ruleOf('init 0')).toBe('power')
  })

  it('refuses recursive permission rewrites on structural directories', () => {
    expect(ruleOf('chmod -R 777 /')).toBe('permissions-root')
    expect(ruleOf('chown -R nobody /home')).toBe('permissions-root')
  })

  it('refuses find -delete on structural directories', () => {
    expect(ruleOf('find / -delete')).toBe('find-delete-protected')
    expect(ruleOf('find /var -name "*.log" -exec rm {} +')).toBe('find-delete-protected')
  })

  it('refuses fork bombs', () => {
    expect(ruleOf(':(){ :|:& };:')).toBe('fork-bomb')
  })

  it('refuses empty or absurd input', () => {
    expect(inspectCommand('')).toMatchObject({ rule: 'empty' })
    expect(ruleOf('echo ' + 'a'.repeat(10_000))).toBe('invalid')
  })

  it('reports every refusal rule with a description', () => {
    expect(Object.keys(RULES).length).toBeGreaterThanOrEqual(9)
    for (const reason of Object.values(RULES)) expect(reason.length).toBeGreaterThan(10)
  })
})

describe('redactCommand', () => {
  it('hides bearer tokens and assignments', () => {
    const redacted = redactCommand('claude mcp add -H "Authorization: Bearer abc123def456" -- env GANTT_MCP_TOKEN=deadbeef')
    expect(redacted).not.toContain('abc123def456')
    expect(redacted).not.toContain('deadbeef')
    expect(redacted).toContain('Bearer ***')
    expect(redacted).toContain('GANTT_MCP_TOKEN=***')
  })

  it('keeps ordinary text intact', () => {
    expect(redactCommand('claude mcp list')).toBe('claude mcp list')
  })
})
