// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createLoaderBundle } from '../scripts/build.mjs'

test('creates the canonical ModuleLoader registration', () => {
  const bundle = createLoaderBundle('dsh-ccswitch-plugin', 'module.exports = { apply() {} };')
  assert.match(bundle, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(bundle, /id:\s*[\"']dsh-ccswitch-plugin[\"']/)
  assert.match(bundle, /factory:\s*\(require\)\s*=>/)
})

test('package points at the bundled Host and Client entries', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.main, 'dist/index.mjs')
  assert.equal(packageJson.exports['./client'], './dist/client.js')
  assert.equal(packageJson.scripts.build, 'node scripts/build.mjs')
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-credentials'], '^0.2.0-rc.2')
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-host-webserver'], '^0.2.0-rc.2')
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-settings'], '^0.2.0-rc.2')
  const clientBundle = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
  const hostBundle = await readFile(new URL('../dist/index.mjs', import.meta.url), 'utf8')
  assert.match(clientBundle, /CCSwitch/)
  assert.match(hostBundle, /\/api\/dsh-ccswitch/)
})

test('every declared export points at an artefact that actually builds', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const entries = Object.entries(packageJson.exports)
  assert.ok(entries.length > 0)
  for (const [subpath, target] of entries) {
    const relative = typeof target === 'string' ? target : (target.import ?? target.default)
    assert.equal(typeof relative, 'string', `export ${subpath} has no resolvable string target`)
    assert.ok(relative.startsWith('./'), `export ${subpath} must stay inside the package`)
    if (relative === './package.json') continue
    await assert.doesNotReject(
      readFile(new URL(relative, new URL('../', import.meta.url)), 'utf8'),
      `export ${subpath} -> ${relative} is missing from the build`,
    )
  }
})
