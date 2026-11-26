# Remote command wrapper

`scripts/remote-exec.mjs` forwards one shell command to another machine over
SSH. It exists because the agent usually runs inside the DSH Pod while the
Claude Code / Codex clients live on the host: the Pod has no copy of the host's
files, so every host-side step is a remote command — and a mistyped remote
command runs with the host user's full privileges.

The wrapper puts three things in front of `ssh`:

1. **A veto list** (`src/host/remote-guard.js`, shared with the
   `gantt_delegate` tool) that inspects the command before SSH is spawned. A
   refused command never leaves the machine.
2. **A redacted audit log** of every attempt (allowed, refused, failed), so a
   remote change is traceable after the fact without storing bearer tokens.
   The manual CLI writes `.tmp/remote-exec.log`; the delegation tool writes
   beside the task database (override with `REMOTE_AUDIT_LOG`).
3. **A fixed SSH posture**: batch mode, connect timeout, keepalive, and
   `StrictHostKeyChecking=accept-new` against an explicit `known_hosts` file
   (`src/host/remote.js` builds the argv for both callers).

It is not a sandbox. It cannot see inside a script or binary that the remote
command merely invokes, so use it for small, explicit, read-mostly steps —
never as a substitute for reviewing a remote `bash deploy.sh`.

## Usage

```sh
node scripts/remote-exec.mjs --target k3s-node -- claude mcp list
node scripts/remote-exec.mjs -t k3s-node -i ~/.ssh/id_rsa --dry-run -- 'claude --version'
node scripts/remote-exec.mjs -t mac -- shasum -a 256 ~/.config/gantt-mcp/token
node scripts/remote-exec.mjs -t k3s-node --allow-recursive-delete -- rm -rf /tmp/build
node scripts/remote-exec.mjs -t k3s-node --stdin -- 'umask 077; cat > ~/.config/gantt-mcp/token'
```

| Option | Default | Meaning |
| --- | --- | --- |
| `-t, --target <user@host\|alias>` | `$REMOTE_TARGET` (required) | SSH destination; `~/.ssh/config` aliases (`k3s-node`, `mac`) are accepted |
| `-i, --identity <file>` | `$REMOTE_SSH_IDENTITY`, else `~/.ssh/id_rsa` when it exists | private key |
| `-p, --port <port>` | `$REMOTE_SSH_PORT`, else `22` | SSH port |
| `--timeout <seconds>` | `120` | kill the remote command after N seconds (exit `124`) |
| `--stdin` | off | forward this process's stdin (used to push secrets without argv) |
| `--dry-run` | off | print the guard verdict and the SSH command; do not connect |
| `--allow-recursive-delete` | off | permit `rm -r`/`rm -rf` on non-structural paths |
| `--known-hosts <file>` | `$REMOTE_KNOWN_HOSTS`, else `~/.ssh/known_hosts` | host key file |
| `--audit-log <file>` | `$REMOTE_AUDIT_LOG`, else `.tmp/remote-exec.log` | JSONL audit log |

The remote command must come after `--`; everything before it is parsed as an
option, so a command starting with `-` cannot be mistaken for a flag. Exit
codes: `0` success, `2` usage error, `3` refused by the guard, `124` timeout,
otherwise the remote command's exit status.

## What the guard refuses

The command is tokenised like a shell would (quotes, `;`/`&&`/`||`/`|` chains,
redirections) and each simple command is checked after peeling wrappers
(`sudo`, `env`, `timeout`, `nice`, `xargs`, `command`, …) and recursing into
`sh -c '<payload>'`, `eval`, `$(…)` and backticks.

| Rule | Refused shape |
| --- | --- |
| `rm-recursive` | `rm -r`/`rm -rf` anywhere, unless `--allow-recursive-delete` is passed |
| `rm-protected` | recursive delete of `/`, a top-level directory (`/data`, `/usr`, …), a home directory (`/home/jason`, `~`), or a glob over one (`*`, `/data/*`, `~/`) — **even with the flag** |
| `find-delete-protected` | `find <structual root> -delete` or `-exec rm` |
| `disk-wipe` | `mkfs*`, `mkswap`, `wipefs`, `blkdiscard`, `fdisk`, `parted`, `sgdisk`, `cfdisk`, `shred` |
| `device-write` | `dd of=/dev/…` and `> /dev/sd*` / `/dev/nvme*` / `/dev/disk/*` redirections |
| `permissions-root` | `chmod -R` / `chown -R` over `/`, `~` or another structural root |
| `kill-all` | `kill -9 -1`, `killall5` |
| `power` | `shutdown`, `reboot`, `halt`, `poweroff`, `systemctl reboot/poweroff/…`, `init 0/6` |
| `fork-bomb` | `:(){ :\|:& };:` and equivalents |

Quoted text that is merely an argument is not treated as a command:
`grep -F "rm -rf /" /var/log/syslog` passes. A recursive delete inside an
allowed path (`/tmp/build`, `~/…/node_modules`) needs the explicit flag, so the
operator has to mean it.

## Audit log

Each attempt appends JSON lines to `.tmp/remote-exec.log` (gitignored):

```json
{"ts":"…","target":"jason@192.168.1.5","decision":"allowed","rule":"","sha256":"…","command":"claude mcp list"}
{"ts":"…","target":"jason@192.168.1.5","decision":"finished","rule":"","sha256":"…","command":"claude mcp list","exit":0,"duration_ms":421}
{"ts":"…","target":"jason@192.168.1.5","decision":"refused","rule":"rm-recursive","sha256":"…","command":"rm -rf /"}
```

`command` is redacted before it is written: `Bearer <token>` becomes
`Bearer ***`, `*_TOKEN=`/`*_KEY=`/`*_SECRET=` assignments are masked, and
`--header` values are masked. `sha256` is the hash of the unredacted command, so
two runs of the same command are still correlatable.

## Tests

- `tests/host/remote-guard.spec.js` — classification table: ordinary commands,
  wrapper prefixes, `sh -c` payloads, command substitutions, each refusal rule.
- `tests/host/remote-exec.spec.js` — spawns the CLI with a fake `ssh` on `PATH`
  and asserts a refused command never invokes `ssh`, the audit log records both
  decisions, tokens are redacted, `--dry-run` does not connect, and the remote
  exit status passes through.

Run them with `pnpm exec vitest run --project host tests/host/remote-*.spec.js`.

## Real use

`k3s-lab/dsh/claude-http-mcp.sh` (private homelab repo) uses this wrapper to register the gantt MCP server in the host's Claude Code
over HTTP: the host and the DSH Pod share no directory, so the client connects
to the sidecar's tailnet endpoint with a bearer token instead of spawning
`bin/gantt-mcp.js` as a child process. That script also shows the two
non-obvious parts of the flow: the token is pushed over SSH stdin (not argv),
and the host's `lo` wrapper is called with its prompt on stdin because `lo`
expands `$@` unquoted.
