// Safety gate for remote command forwarding: `scripts/remote-exec.mjs` (the
// manual CLI) and the host's `gantt_delegate` tool both pass one shell command
// through here before it reaches SSH, because a typo there runs with the
// remote user's full privileges. This module tokenises the command (quotes,
// pipes, `&&`/`;` chains, `sudo`/`env`/`timeout` wrappers and `bash -c`
// payloads) and refuses the handful of shapes that can destroy a machine:
// recursive deletes of large directories, block-device writes, disk
// formatting, permission rewrites of `/`, all-process kills, and power
// commands.
//
// The gate is deliberately a veto list, not a sandbox: it cannot see inside
// scripts that the remote command merely *calls*. Both callers therefore also
// record every attempt in an audit log so a refusal or a surprise is
// traceable after the fact.

/** Rules that always refuse, keyed by the rule id reported to the operator. */
export const RULES = /** @type {const} */ ({
  'rm-recursive': 'refuse a recursive delete unless --allow-recursive-delete is passed',
  'rm-protected': 'refuse a recursive delete of a large or structural directory even with --allow-recursive-delete',
  'find-delete-protected': 'refuse find -delete / -exec rm on a large or structural directory',
  'disk-wipe': 'refuse disk formatting and block-device wiping tools',
  'device-write': 'refuse writes to a block device',
  'permissions-root': 'refuse a recursive chmod/chown of a large or structural directory',
  'kill-all': 'refuse killing every process on the host',
  'power': 'refuse shutdown, reboot, halt, poweroff and systemctl equivalents',
  'fork-bomb': 'refuse a fork bomb',
})

/** Commands whose only purpose is to destroy a disk or its partition table. */
const DISK_WIPERS = new Set([
  'mkfs', 'mkswap', 'wipefs', 'blkdiscard', 'fdisk', 'parted', 'sgdisk', 'cfdisk', 'shred',
])

/** Tokens that are shell syntax rather than the command being run. */
const SHELL_KEYWORDS = new Set([
  '!', '{', '}', '(', ')', 'if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done', 'time', '!',
])

/** Wrappers that run the rest of the segment as a command. */
const COMMAND_WRAPPERS = new Set([
  'command', 'builtin', 'exec', 'nohup', 'setsid', 'eatmydata', 'chronic', 'unbuffer', 'doas', 'sudo', 'env',
  'timeout', 'nice', 'ionice', 'stdbuf', 'xargs', 'time',
])

/** Flags of a wrapper that consume the following token as their value. */
const WRAPPER_VALUE_FLAGS = /** @type {Record<string, Set<string>>} */ ({
  sudo: new Set(['-u', '-g', '-C', '-h', '-p', '-r', '-t', '-U', '-T', '--user', '--group', '--host', '--prompt', '--role', '--type', '--command-timeout', '--close-from', '--chdir']),
  env: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']),
  timeout: new Set(['-s', '--signal', '-k', '--kill-after']),
  nice: new Set(['-n', '--adjustment']),
  ionice: new Set(['-c', '--class', '-n', '--classdata', '-p', '--pid', '-P', '--pgid', '-u', '--uid']),
  stdbuf: new Set(['-i', '-o', '-e']),
  xargs: new Set(['-I', '-n', '-P', '-d', '-L', '-s', '-E', '-a', '-e', '-l', '-i', '--arg-file', '--delimiter', '--max-args', '--max-procs', '--max-chars']),
  time: new Set(['-f', '--format', '-o', '--output']),
})

/** Absolute paths that are structural: deleting any one of them breaks a host. */
const PROTECTED_ABSOLUTE = new Set([
  '/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib32', '/lib64', '/libx32', '/media', '/mnt',
  '/opt', '/proc', '/root', '/run', '/sbin', '/srv', '/sys', '/tmp', '/usr', '/var', '/data',
])

/** Home-directory spellings that mean "the whole home". */
const HOME_ROOTS = ['~', '~/', '$HOME', '${HOME}', '$HOME/', '${HOME}/']

/**
 * @typedef {Object} GuardRefusal
 * @property {string} rule
 * @property {string} reason
 */

/**
 * Inspect a shell command and decide whether it is safe to forward to a remote
 * host. Nested command substitutions, `bash -c` payloads and wrapper prefixes
 * (`sudo`, `env`, `timeout`, `xargs`, …) are inspected recursively; quoted text
 * that is merely an argument (for example `grep 'rm -rf /'`) is not.
 * @param {string} command the shell command as it would be typed on the remote
 * @param {{ allowRecursiveDelete?: boolean }} [options]
 * @returns {GuardRefusal | null} null when the command is allowed
 */
export function inspectCommand(command, options = {}) {
  const allowRecursiveDelete = options.allowRecursiveDelete === true
  if (typeof command !== 'string' || command.trim() === '') {
    return { rule: 'empty', reason: 'no command given' }
  }
  const text = command
  if (text.includes('\0')) return { rule: 'invalid', reason: 'command contains a NUL byte' }
  if (text.length > 10_000) return { rule: 'invalid', reason: 'command is longer than 10000 characters' }
  if (/:\(\)\s*\{[^}]*\|[^}]*&\s*;?\s*\}/.test(text)) return violation('fork-bomb', 'command looks like a fork bomb')
  const context = /** @type {Context} */ ({ allowRecursiveDelete, depth: 0 })
  const problem = inspectSource(text, context)
  return problem
}

/**
 * @typedef {{ allowRecursiveDelete: boolean, depth: number }} Context
 */

/**
 * @param {string} rule
 * @param {string} reason
 * @returns {GuardRefusal}
 */
function violation(rule, reason) {
  return { rule, reason }
}

/**
 * Lex and inspect one source string. Depth guards `bash -c` self-nesting.
 * @param {string} source
 * @param {Context} context
 * @returns {GuardRefusal | null}
 */
function inspectSource(source, context) {
  if (context.depth > 6) return violation('invalid', 'command nests too deeply to inspect')
  const next = /** @type {Context} */ ({ ...context, depth: context.depth + 1 })
  const { segments, nested } = lex(source)
  for (const inner of nested) {
    const problem = inspectSource(inner, next)
    if (problem) return problem
  }
  for (const tokens of segments) {
    const problem = inspectSegment(tokens, next)
    if (problem) return problem
  }
  return null
}

/**
 * Split a source string into simple commands. Quotes are removed, unquoted
 * separators (`;`, `&&`, `||`, `|`, newline, `&`) start a new command,
 * redirections become their own tokens, and `$(...)`/backtick payloads are
 * returned separately so they can be inspected as commands in their own right.
 * @param {string} source
 * @returns {{ segments: string[][], nested: string[] }}
 */
function lex(source) {
  /** @type {string[][]} */
  const segments = []
  /** @type {string[]} */
  const nested = []
  /** @type {string[]} */
  let tokens = []
  let current = ''
  let quote = ''
  let escaped = false
  const flushToken = () => {
    if (current !== '') {
      tokens.push(current)
      current = ''
    }
  }
  const flushSegment = () => {
    flushToken()
    if (tokens.length > 0) segments.push(tokens)
    tokens = []
  }
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote !== '') {
      if (char === quote) {
        quote = ''
      } else if (quote === '"' && char === '$' && source[i + 1] === '(') {
        const read = readBalanced(source, i + 1)
        nested.push(read.body)
        current += source.slice(i, i + 2 + read.body.length + 1)
        i += 2 + read.body.length
      } else if (quote === '"' && char === '`') {
        const end = source.indexOf('`', i + 1)
        if (end === -1) {
          current += char
        } else {
          nested.push(source.slice(i + 1, end))
          current += source.slice(i, end + 1)
          i = end
        }
      } else {
        current += char
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === '$' && source[i + 1] === '(') {
      const read = readBalanced(source, i + 1)
      nested.push(read.body)
      current += source.slice(i, i + 2 + read.body.length + 1)
      i += 2 + read.body.length
      continue
    }
    if (char === '`') {
      const end = source.indexOf('`', i + 1)
      if (end === -1) {
        current += char
      } else {
        nested.push(source.slice(i + 1, end))
        current += source.slice(i, end + 1)
        i = end
      }
      continue
    }
    if (char === ';' || char === '\n' || char === '&' || char === '|') {
      // `&&` and `||` are just two adjacent separators.
      flushSegment()
      continue
    }
    if (char === '<' || char === '>') {
      flushToken()
      if (char === '>' && source[i + 1] === '>') {
        tokens.push('>>')
        i += 1
      } else if (source[i + 1] === '&') {
        i += 1
      } else {
        tokens.push(char)
      }
      continue
    }
    if (char === ' ' || char === '\t' || char === '\r' || char === '(' || char === ')') {
      flushToken()
      continue
    }
    current += char
  }
  flushSegment()
  return { segments, nested }
}

/**
 * Read the balanced `$( ... )` body that starts at `start` (the index of `$`).
 * Quotes inside the substitution are respected so `$(echo "a)")` stays whole.
 * @param {string} source
 * @param {number} start
 * @returns {{ body: string }}
 */
function readBalanced(source, start) {
  let depth = 0
  let quote = ''
  let escaped = false
  for (let i = start; i < source.length; i += 1) {
    const char = source[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote !== '') {
      if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return { body: source.slice(start + 1, i) }
    }
  }
  return { body: source.slice(start + 1) }
}

/**
 * Inspect one simple command, peeling wrapper prefixes first.
 * @param {string[]} rawTokens
 * @param {Context} context
 * @returns {GuardRefusal | null}
 */
function inspectSegment(rawTokens, context) {
  let tokens = rawTokens.slice()
  while (tokens.length > 0 && (SHELL_KEYWORDS.has(tokens[0]) || tokens[0] === '')) tokens = tokens.slice(1)
  let wrap = 0
  while (tokens.length > 0 && wrap < 12) {
    const base = basename(tokens[0])
    if (!COMMAND_WRAPPERS.has(base)) break
    tokens = stripWrapper(tokens, base)
    wrap += 1
    while (tokens.length > 0 && SHELL_KEYWORDS.has(tokens[0])) tokens = tokens.slice(1)
  }
  if (tokens.length === 0) return null
  const base = basename(tokens[0])
  if (base === 'eval') {
    return inspectSource(tokens.slice(1).join(' '), context)
  }
  if (base === 'sh' || base === 'bash' || base === 'zsh' || base === 'dash' || base === 'ksh') {
    const script = scriptFromShellFlags(tokens.slice(1))
    if (script !== null) return inspectSource(script, context)
    return null
  }
  const args = tokens.slice(1)
  if (base === 'rm') return inspectRm(args, context)
  if (base === 'find') return inspectFind(tokens)
  if (base === 'dd') return inspectDd(args)
  if (DISK_WIPERS.has(base) || base.startsWith('mkfs')) return violation('disk-wipe', `${base} rewrites a disk or partition table`)
  if (base === 'chmod' || base === 'chown') return inspectPermissions(base, args)
  if (base === 'kill') return inspectKill(args)
  if (base === 'killall5' || base === 'skill') return violation('kill-all', `${base} signals every process`)
  if (base === 'shutdown' || base === 'reboot' || base === 'halt' || base === 'poweroff') {
    return violation('power', `${base} would take the host down`)
  }
  if (base === 'systemctl' && args.some(arg => /^(reboot|poweroff|halt|kexec|suspend|hibernate|rescue|emergency)$/.test(arg))) {
    return violation('power', 'systemctl would take the host down')
  }
  if (base === 'init' && args.some(arg => arg === '0' || arg === '6')) return violation('power', 'init 0/6 would take the host down')
  return inspectRedirections(tokens)
}

/**
 * Remove one wrapper and its flags from the front of `tokens`.
 * @param {string[]} tokens
 * @param {string} base
 * @returns {string[]}
 */
function stripWrapper(tokens, base) {
  // Index 0 is the wrapper itself; its flags and operands follow.
  let index = 1
  let sawCommand = false
  while (index < tokens.length) {
    const token = tokens[index]
    if (base === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1
      continue
    }
    if (token === '--') {
      index += 1
      continue
    }
    if (token.startsWith('-') && token !== '-') {
      index += 1
      const values = WRAPPER_VALUE_FLAGS[base]
      if (values && (values.has(token) || [...values].some(flag => flag.startsWith('--') && token.startsWith(flag + '=')))) {
        index += 1
      }
      continue
    }
    sawCommand = true
    break
  }
  if (base === 'timeout' && sawCommand && index < tokens.length) {
    // `timeout 30s cmd...`: the first operand is the duration.
    index += 1
  }
  if (base === 'nice' && sawCommand && index < tokens.length && /^-?\d+$/.test(tokens[index])) index += 1
  return tokens.slice(index)
}

/**
 * Extract the payload of `bash -c '<payload>'` / `bash -lc '<payload>'`.
 * @param {string[]} args
 * @returns {string | null}
 */
function scriptFromShellFlags(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--' || !arg.startsWith('-') || arg === '-') return null
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(arg)) return args[i + 1] ?? null
    if (arg === '-o' || arg === '+o') i += 1
  }
  return null
}

/**
 * @param {string[]} args
 * @param {Context} context
 * @returns {GuardRefusal | null}
 */
function inspectRm(args, context) {
  let recursive = false
  let force = false
  /** @type {string[]} */
  const operands = []
  let flags = true
  for (const arg of args) {
    if (flags && arg === '--') {
      flags = false
      continue
    }
    if (flags && arg.startsWith('-') && arg !== '-') {
      if (arg === '--recursive') recursive = true
      if (arg === '--force') force = true
      const cluster = arg.replace(/^--?/, '')
      if (/[rR]/.test(cluster) && !arg.startsWith('--')) recursive = true
      if (cluster.includes('f') && !arg.startsWith('--')) force = true
      continue
    }
    flags = false
    operands.push(arg)
  }
  if (!recursive) return null
  if (!context.allowRecursiveDelete) {
    return violation('rm-recursive', 'rm -r/-rf needs the explicit --allow-recursive-delete flag')
  }
  for (const operand of operands) {
    if (isProtectedTarget(operand)) {
      return violation('rm-protected', `refusing to delete ${operand}${force ? ' with -f' : ''}: large or structural directory`)
    }
  }
  return null
}

/**
 * @param {string[]} tokens
 * @returns {GuardRefusal | null}
 */
function inspectFind(tokens) {
  const args = tokens.slice(1)
  let root = ''
  for (const arg of args) {
    if (!arg.startsWith('-') && !arg.startsWith('(') && !arg.startsWith('!')) {
      root = arg
      break
    }
  }
  const destructive = args.includes('-delete') || args.some((arg, index) => arg === '-exec' && basename(args[index + 1] ?? '') === 'rm')
  if (!destructive) return null
  if (root === '' || isProtectedTarget(root)) {
    return violation('find-delete-protected', `find would delete files under ${root === '' ? 'the search root' : root}`)
  }
  return null
}

/**
 * @param {string[]} args
 * @returns {GuardRefusal | null}
 */
function inspectDd(args) {
  for (const arg of args) {
    if (/^of=\/dev\//.test(arg) || /^of=\/dev\/disk\//.test(arg)) {
      return violation('device-write', `dd would overwrite ${arg.slice(3)}`)
    }
  }
  return null
}

/**
 * @param {string} base
 * @param {string[]} args
 * @returns {GuardRefusal | null}
 */
function inspectPermissions(base, args) {
  let recursive = false
  /** @type {string[]} */
  const operands = []
  for (const arg of args) {
    if (arg.startsWith('-') && arg !== '-') {
      if (arg === '--recursive' || /^-[A-Za-z]*R/.test(arg)) recursive = true
      continue
    }
    operands.push(arg)
  }
  if (!recursive) return null
  for (const operand of operands) {
    if (isProtectedTarget(operand)) {
      return violation('permissions-root', `${base} -R on ${operand} would rewrite a structural directory`)
    }
  }
  return null
}

/**
 * @param {string[]} args
 * @returns {GuardRefusal | null}
 */
function inspectKill(args) {
  const signal = args.some(arg => /^-(9|KILL|SIGKILL)$/i.test(arg))
  const everyone = args.some(arg => arg === '-1' || arg === '-- -1')
  if (signal && everyone) return violation('kill-all', 'kill -9 -1 signals every process')
  return null
}

/**
 * @param {string[]} tokens
 * @returns {GuardRefusal | null}
 */
function inspectRedirections(tokens) {
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i]
    if (token !== '>' && token !== '>>') continue
    const target = tokens[i + 1]
    if (/^\/dev\/(sd|hd|vd|nvme|disk|mapper|md|dm-)/.test(target)) {
      return violation('device-write', `redirects output to the block device ${target}`)
    }
  }
  return null
}

/**
 * True when a delete target is a whole disk/dataset root, a top-level system
 * directory, a home directory, or a glob that would expand to one of those.
 * @param {string} target
 * @returns {boolean}
 */
function isProtectedTarget(target) {
  const path = target.trim()
  if (path === '*' || path === '/*' || path === '.' || path === '..' || path === './' || path === '../') return true
  if (HOME_ROOTS.includes(path)) return true
  for (const home of ['~', '$HOME', '${HOME}']) {
    if (path.startsWith(home + '/')) {
      const rest = path.slice(home.length)
      if (rest === '/' || rest === '/*' || rest === '/.*') return true
      if (/^\/[^/*]+$/.test(rest)) return true
    }
  }
  const normalized = path.replace(/\/+/g, '/').replace(/\/$/, '')
  if (normalized === '' || normalized === '/' || normalized === '.' || normalized === '..' || normalized.endsWith('/..')) return true
  if (PROTECTED_ABSOLUTE.has(normalized)) return true
  if (/^\/[^/]+$/.test(normalized)) return true
  if (/^\/home\/[^/]+$/.test(normalized)) return true
  if (/^\/[^/]+\/\*$/.test(normalized)) return true
  if (/^\/home\/[^/]+\/\*$/.test(normalized)) return true
  return false
}

/**
 * @param {string} value
 * @returns {string}
 */
function basename(value) {
  const slash = value.lastIndexOf('/')
  return slash === -1 ? value : value.slice(slash + 1)
}

/**
 * Redact bearer tokens, `*_TOKEN=`/`*_KEY=` assignments and `Authorization:`
 * headers so the audit log can be committed without leaking credentials.
 * @param {string} command
 * @returns {string}
 */
export function redactCommand(command) {
  return command
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1***')
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD))=("[^"]*"|'[^']*'|\S+)/gi, '$1=***')
    .replace(/((?:-H|--header)\s+["']?[^:]*:\s*[^"']*)/gi, match => match.replace(/:\s*\S+\s*$/, ': ***'))
}
