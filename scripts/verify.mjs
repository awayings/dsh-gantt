// Syntax-check every JavaScript source, test, and script file.
//
// `node --check` takes one file per call; this walks the tracked trees and must
// stay dependency-free (it backs `pnpm run verify` and the release script).
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const seeds = ['src', 'tests', 'scripts']

/** Every .js/.mjs file below `dir`, recursively. */
function walk(dir) {
  const entries = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) entries.push(...walk(path))
    else if (name.endsWith('.js') || name.endsWith('.mjs')) entries.push(path)
  }
  return entries
}

const files = seeds.flatMap(seed => walk(join(root, seed))).sort()
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    process.stderr.write(`${relative(root, file)}: ${String(error.stderr)}\n`)
    process.exit(1)
  }
}
console.log(`verify: ${files.length} files parse`)
