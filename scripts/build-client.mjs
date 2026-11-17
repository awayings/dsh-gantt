// Bundle the browser half into lib/client.js.
//
// The DSH client module loader expects one classic script per package: it calls
// `window.__ModuleLoader__.load({ id, factory })` and later invokes `factory`
// with a `require` that resolves the shell's platform modules. The bundle is
// therefore CommonJS with `react` left external, wrapped in that factory: the
// same shape the reference plugin's tsdown build emits.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const outFile = resolve(root, 'lib/client.js')

const bundle = await rolldown({
  input: resolve(root, 'src/client/index.js'),
  external: ['react'],
  platform: 'browser',
  logLevel: 'warn',
})
const { output } = await bundle.generate({ format: 'cjs', exports: 'named' })
await bundle.close()

const chunk = output.find(item => item.type === 'chunk' && item.isEntry)
if (!chunk) throw new Error('build-client: the entry chunk is missing')

const source = [
  `/* ${pkg.name} v${pkg.version} browser half — bundled from src/client/ by scripts/build-client.mjs; do not edit. */`,
  'window.__ModuleLoader__.load({',
  `  id: '${pkg.name}',`,
  '  factory(require) {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  chunk.code,
  '    return module.exports.plugin;',
  '  },',
  '});',
  '',
].join('\n')

await mkdir(dirname(outFile), { recursive: true })
// Write-then-rename: the artifact is read while a rebuild is in flight (a page
// load, the e2e suite, `pnpm run package`), and a reader must never see a
// truncated bundle. An unchanged artifact is left alone: client-hmr reloads an
// entry when this file's mtime/size changes, so rewriting identical bytes would
// reload every open page for no reason (the check gate rebuilds on every run).
const existing = await readFile(outFile, 'utf8').catch(() => null)
if (existing === source) {
  console.log('build-client: lib/client.js unchanged')
} else {
  const tempFile = `${outFile}.${process.pid}.tmp`
  await writeFile(tempFile, source)
  await rename(tempFile, outFile)
  console.log(`build-client: lib/client.js (${(Buffer.byteLength(source) / 1024).toFixed(1)} KiB)`)
}
