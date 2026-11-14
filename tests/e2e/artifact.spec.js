// The shipped client artifact contract.
//
// DSH loads `exports["./client"]` as a single browser chunk: the file is fetched
// by URL, executed as a classic script, and must register itself through
// `window.__ModuleLoader__.load`. The artifact revision is derived only from
// that entry file's metadata, so the entry cannot delegate to runtime-required
// chunks — an `import` or a second loader call would break the cache contract
// described in docs/compatibility.md. There is no build step to catch that, so
// this suite pins it.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SOURCE = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')

describe('client artifact', () => {
  it('registers itself through the module loader exactly once', () => {
    const loads = SOURCE.match(/^window\.__ModuleLoader__\.load\(/gm) ?? []
    expect(loads).toHaveLength(1)
  })

  it('stays a single classic script with no module syntax', () => {
    // Any top-level import/export turns the artifact into an ES module, which
    // the loader does not fetch. React still arrives through the `require` the
    // loader injects into `factory`, so that call is expected.
    expect(SOURCE).not.toMatch(/^\s*(?:import|export)\b/m)
  })
})
