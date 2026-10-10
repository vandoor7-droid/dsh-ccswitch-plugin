// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The projection between the plugin's flat provider record and cc-switch's
 * `{ id, name, settingsConfig, … }`.
 *
 * The interesting assertion here is the integration one: the synthesized
 * `settingsConfig` has to satisfy *cc-switch's own reader*, not a hand-written
 * expectation of it. Getting that wrong is not a missing field — it is
 * `isOfficialProvider()` deciding every provider is an official account, which
 * disables the API-key field and hides the connectivity check across the whole
 * list. So the real `extractProviderBaseUrl` is imported and run against the
 * projection rather than re-implemented in the test.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

import { clientBuildOptions } from '../scripts/build.mjs'
import { synthesizeSettingsConfig, toCardProvider, toCardProviders } from '../src/client/provider-shape.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const RECORD = {
  displayName: 'DeepSeek',
  api: 'anthropic-messages',
  baseURL: 'https://api.deepseek.com/anthropic',
  apiKeyEnv: 'DSH_CCSWITCH_11111111_API_KEY',
  models: [{ id: 'deepseek-chat' }],
  category: 'thirdparty',
  websiteUrl: 'https://www.deepseek.com',
  notes: 'imported from cc-switch',
  icon: 'deepseek',
  iconColor: '#4D6BFE',
  appType: 'claude',
  sourceProfileId: 'row-7',
  sortIndex: 3,
  createdAt: 1728000000000,
  inFailoverQueue: true,
}

test('row order comes from the catalogue order, not from a competing tie-break', () => {
  const providers = toCardProviders(
    { a: RECORD, b: { ...RECORD, sortIndex: 7 }, c: { ...RECORD, createdAt: undefined } },
    ['c', 'a', 'b'],
  )
  // The Host tie-breaks by row id and cc-switch's `sortedProviders` tie-breaks
  // by name. Folding `order` in means the list the user sees is exactly the
  // permutation `/providers/reorder` demands as its input — otherwise a drag
  // would submit an order built from a ranking the user never saw.
  assert.deepEqual(
    [providers.a.sortIndex, providers.b.sortIndex, providers.c.sortIndex],
    [1, 2, 0],
  )
  // A key the order does not name keeps whatever the record carried.
  assert.equal(toCardProvider('z', RECORD, ['a']).sortIndex, 3)
})

test('a record becomes the row shape cc-switch reads', () => {
  const provider = toCardProvider('ccs-deepseek-11111111', RECORD)

  // The id is the catalogue key: every command that addresses a row resolves
  // it back through `sourceProfileId`, so the two must stay paired.
  assert.equal(provider.id, 'ccs-deepseek-11111111')
  assert.equal(provider.name, 'DeepSeek')
  assert.equal(provider.websiteUrl, 'https://www.deepseek.com')
  assert.equal(provider.category, 'thirdparty')
  assert.equal(provider.sortIndex, 3)
  assert.equal(provider.createdAt, 1728000000000)
  assert.equal(provider.notes, 'imported from cc-switch')
  assert.equal(provider.icon, 'deepseek')
  assert.equal(provider.iconColor, '#4D6BFE')
  assert.equal(provider.inFailoverQueue, true)
})

test('no credential ever reaches the projected row', () => {
  const provider = toCardProvider('k', RECORD)
  const serialized = JSON.stringify(provider)
  assert.ok(!serialized.includes('apiKeyEnv'), 'the reference must not travel either')
  assert.ok(!serialized.includes('DSH_CCSWITCH'), 'nor the reference by another name')
  assert.equal('apiKey' in provider, false)
  assert.deepEqual(
    Object.keys(provider.settingsConfig),
    ['baseUrl', 'env'],
    'the blob holds the endpoint and nothing that could hold a secret',
  )
})

test('membership is carried on the one field upstream reads it from', () => {
  const applied = toCardProvider('k', { ...RECORD, inUse: true })
  const available = toCardProvider('k', { ...RECORD, inUse: false })
  // `ProviderList` decides the Added/Available split with
  // `provider.meta?.liveConfigManaged === true` for the app id we mount under.
  // That predicate is this plugin's `inUse`, so membership travels through the
  // field cc-switch already has rather than a new branch in the copied code.
  assert.deepEqual(applied.meta, { liveConfigManaged: true })
  assert.deepEqual(available.meta, { liveConfigManaged: false })

  // Everything else under `meta` stays absent. `usage_script` drives the quota
  // column's queries and `providerType` drives the Copilot/Codex/xAI badges —
  // inventing either would claim a route this plugin does not have, and the
  // quota column would render a cell that can never answer.
  assert.equal('usage_script' in applied.meta, false)
  assert.equal('providerType' in applied.meta, false)
  assert.equal('isPartner' in applied, false)
  assert.equal('appType' in applied, false, 'cc-switch has no such field')
  assert.equal('apiKeyEnv' in applied, false, 'nor this one')
})

test('a blank record projects to a blank row instead of throwing', () => {
  const provider = toCardProvider('k', undefined)
  assert.equal(provider.id, 'k')
  assert.equal(provider.name, 'k', 'falls back to the key so a row is never nameless')
  assert.deepEqual(provider.settingsConfig, {})
  assert.equal(provider.sortIndex, undefined)
  assert.equal(provider.inFailoverQueue, false)
})

test('the whole catalogue is keyed by catalogue key', () => {
  const providers = toCardProviders({ 'ccs-a-11111111': RECORD, '': RECORD, 'ccs-b-22222222': RECORD })
  assert.deepEqual(Object.keys(providers).sort(), ['ccs-a-11111111', 'ccs-b-22222222'])
  assert.equal(providers['ccs-a-11111111'].id, 'ccs-a-11111111')
  assert.deepEqual(toCardProviders(undefined), {})
})

test('the endpoint survives into cc-switch\'s own reader', async () => {
  // Built with the same options the client bundle uses, so the `@/` alias and
  // the vendored TypeScript resolve exactly as they do in production.
  const built = await build({
    ...clientBuildOptions(),
    // ESM, because the result is loaded through a `data:` import; the client
    // bundle itself stays CJS for DSH's module loader.
    format: 'esm',
    outfile: 'provider-shape-probe.mjs',
    stdin: {
      contents: [
        'export { extractProviderBaseUrl } from "@/utils/providerConfigUtils";',
        'export { synthesizeSettingsConfig } from "./src/client/provider-shape.mjs";',
      ].join('\n'),
      resolveDir: ROOT,
      loader: 'js',
    },
    write: false,
  })
  const module = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)

  const config = module.synthesizeSettingsConfig(RECORD)
  assert.equal(
    module.extractProviderBaseUrl(config),
    RECORD.baseURL,
    'cc-switch must find the endpoint in the synthesized blob',
  )
  // The condition `isOfficialProvider()` tests for the `claude` app id: a
  // missing or blank `ANTHROPIC_BASE_URL` marks the row official, which would
  // disable the API-key field and the connectivity check on every row.
  assert.equal(
    typeof config.env.ANTHROPIC_BASE_URL === 'string' && config.env.ANTHROPIC_BASE_URL.trim() !== '',
    true,
  )
  assert.equal(module.extractProviderBaseUrl({}), undefined, 'an endpoint-less row reports none')
})
