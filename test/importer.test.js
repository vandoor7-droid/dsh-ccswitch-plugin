// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importProfiles } from '../lib/core/importer.js'
import { toProviderProfile } from '../lib/core/mapper.js'
import { providerKey, credentialRef, credentialRefForProviderKey, variantKey } from '../lib/core/ids.js'

function makeSettings(initial, revision = 7) {
  const state = { section: structuredClone(initial), revision }
  return {
    state,
    async get(ns) {
      // The real settings service exposes get(ns) — the importer reads existing
      // providers through it, so the mock must too.
      if (ns === 'llm-pi-ai') return state.section
      return undefined
    },
    async describe() {
      return [{ ns: 'llm-pi-ai', revision: state.revision }]
    },
    async mutate(ns, ops, expectedRevision) {
      if (expectedRevision !== undefined && expectedRevision !== state.revision) {
        throw Object.assign(new Error('conflict'), { code: 'SETTINGS_CONFLICT' })
      }
      for (const op of ops) {
        if (op.op === 'set') {
          let cur = state.section
          for (let i = 0; i < op.path.length - 1; i++) cur = cur[op.path[i]] ??= {}
          cur[op.path[op.path.length - 1]] = op.value
        } else if (op.op === 'unset') {
          let cur = state.section
          for (let i = 0; i < op.path.length - 1; i++) cur = cur[op.path[i]]
          delete cur[op.path[op.path.length - 1]]
        }
      }
      state.revision += 1
    },
  }
}

function makeCredentials() {
  const store = new Map()
  return {
    store,
    async set(ref, value) { store.set(ref, value) },
    async unset(ref) { store.delete(ref) },
    async resolve(ref) {
      const value = store.get(ref)
      return value === undefined ? undefined : { value, source: 'file' }
    },
  }
}

const profile = {
  profileId: '星渡-1786264467316',
  profileName: '星渡',
  baseURL: 'https://aiwtiaw.top',
  api: 'openai-responses',
  models: [{ id: 'gpt-5.6-terra' }],
  apiKey: 'sk-SECRET-1',
  warnings: [],
}

test('import writes credential then settings and returns redacted results', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const results = await importProfiles({
    profiles: [profile],
    selectedIds: [profile.profileId],
    settings,
    credentials,
  })
  const key = providerKey(profile.profileId, profile.profileName)
  const ref = credentialRef(profile.profileId, profile.profileName)
  assert.equal(credentials.store.get(ref), 'sk-SECRET-1')
  assert.ok(settings.state.section.providers[key])
  assert.equal(settings.state.section.providers[key].displayName, '星渡')
  const result = results.find((r) => r.profileId === profile.profileId)
  assert.equal(result.status, 'new')
  assert.ok(!JSON.stringify(result).includes('sk-SECRET-1'))
})

test('collision import isolates the variant credential from the base provider', async () => {
  const baseKey = providerKey(profile.profileId, profile.profileName)
  const variant = variantKey(baseKey, 1)
  const settings = makeSettings({
    providers: {
      [baseKey]: { displayName: '星渡', baseURL: 'https://different.example' },
    },
  })
  const credentials = makeCredentials()
  const baseRef = credentialRef(profile.profileId, profile.profileName)
  const variantRef = credentialRefForProviderKey(variant)
  credentials.store.set(baseRef, 'old-secret')

  const results = await importProfiles({ profiles: [profile], selectedIds: [profile.profileId], settings, credentials })

  assert.equal(credentials.store.get(baseRef), 'old-secret')
  assert.equal(credentials.store.get(variantRef), 'sk-SECRET-1')
  assert.equal(settings.state.section.providers[variant].apiKeyEnv, variantRef)
  assert.equal(results[0].providerKey, variant)
  assert.equal(results[0].status, 'new')
})

test('skips unselected profiles and does not touch credentials', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const results = await importProfiles({
    profiles: [profile],
    selectedIds: [],
    settings,
    credentials,
  })
  assert.equal(credentials.store.size, 0)
  assert.deepEqual(Object.keys(settings.state.section.providers), [])
  assert.equal(results[0].status, 'skipped')
})

test('credential failure blocks that profile and writes nothing to settings', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = {
    store: new Map(),
    async set() { throw new Error('credential rejected') },
    async unset() {},
  }
  const results = await importProfiles({ profiles: [profile], selectedIds: [profile.profileId], settings, credentials })
  assert.deepEqual(Object.keys(settings.state.section.providers), [])
  assert.equal(results[0].status, 'failed')
  assert.match(results[0].error, /credential/i)
})

test('settings conflict reports failure and rolls back the new credential', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const results = await importProfiles({
    profiles: [profile],
    selectedIds: [profile.profileId],
    settings,
    credentials,
    expectedRevision: 99, // stale
  })
  assert.equal(credentials.store.size, 0)
  assert.equal(results[0].status, 'failed')
  assert.match(results[0].error, /conflict/i)
})

test('settings conflict restores an existing credential', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const ref = credentialRef(profile.profileId, profile.profileName)
  credentials.store.set(ref, 'old-secret')
  const results = await importProfiles({
    profiles: [profile], selectedIds: [profile.profileId], settings, credentials, expectedRevision: 99,
  })
  assert.equal(credentials.store.get(ref), 'old-secret')
  assert.equal(results[0].status, 'failed')
})

test('unchanged profile is reported and not rewritten', async () => {
  const key = providerKey(profile.profileId, profile.profileName)
  const ref = credentialRef(profile.profileId, profile.profileName)
  const settings = makeSettings({
    providers: {
      // An entry this importer previously wrote: toProviderProfile shape,
      // apiKeyEnv included (see mapper.test.js for the same convention).
      [key]: toProviderProfile(profile),
    },
  })
  const credentials = makeCredentials()
  credentials.store.set(ref, 'existing')
  const results = await importProfiles({ profiles: [profile], selectedIds: [profile.profileId], settings, credentials })
  assert.equal(results[0].status, 'unchanged')
})

// --- batch import ---------------------------------------------------------
// Regression for the bug where the whole loop reused one expectedRevision, so
// every profile after the first was rejected as stale and never imported.

function makeProfiles(count) {
  return Array.from({ length: count }, (_, index) => ({
    ...profile,
    profileId: `batch-${index + 1}`,
    profileName: `Batch ${index + 1}`,
  }))
}

test('one batch imports every selected profile, not just the first', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const profiles = makeProfiles(4)
  const results = await importProfiles({
    profiles,
    selectedIds: profiles.map((p) => p.profileId),
    settings,
    credentials,
    expectedRevision: 7,
  })
  assert.deepEqual(results.map((r) => r.status), ['new', 'new', 'new', 'new'])
  assert.equal(Object.keys(settings.state.section.providers).length, 4)
  assert.equal(credentials.store.size, 4)
})

test('each batch write advances to the revision the previous write produced', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const profiles = makeProfiles(3)
  await importProfiles({
    profiles,
    selectedIds: profiles.map((p) => p.profileId),
    settings,
    credentials,
    expectedRevision: 7,
  })
  assert.equal(settings.state.revision, 10)
})

test('a batch without a caller revision still writes every profile', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const profiles = makeProfiles(3)
  const results = await importProfiles({ profiles, selectedIds: profiles.map((p) => p.profileId), settings, credentials })
  assert.deepEqual(results.map((r) => r.status), ['new', 'new', 'new'])
})

test('a stale caller revision fails loudly instead of importing partially', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const profiles = makeProfiles(2)
  const results = await importProfiles({
    profiles,
    selectedIds: profiles.map((p) => p.profileId),
    settings,
    credentials,
    expectedRevision: 99,
  })
  assert.deepEqual(results.map((r) => r.status), ['failed', 'failed'])
  assert.deepEqual(results.map((r) => r.errorCode), ['settings-conflict', 'settings-conflict'])
  assert.equal(Object.keys(settings.state.section.providers).length, 0)
})

test('a settings service that cannot report a revision still imports the whole batch', async () => {
  const settings = makeSettings({ providers: {} })
  // The document is readable, but there is no revision to compare-and-set against.
  settings.describe = async () => [{ ns: 'llm-pi-ai' }]
  const credentials = makeCredentials()
  const profiles = makeProfiles(3)
  const results = await importProfiles({
    profiles,
    selectedIds: profiles.map((p) => p.profileId),
    settings,
    credentials,
    expectedRevision: 7,
  })
  assert.deepEqual(results.map((r) => r.status), ['new', 'new', 'new'])
  assert.equal(Object.keys(settings.state.section.providers).length, 3)
  assert.equal(credentials.store.size, 3)
})

// --- credential redaction -------------------------------------------------

test('failure details redact the relay key by value, not just by shape', async () => {
  // Short and not `sk-` shaped on purpose: only value-based redaction catches it.
  const relayKey = 'relay-key-ABCdef123'
  const settings = makeSettings({ providers: {} })
  settings.mutate = async () => { throw new Error(`relay rejected ${relayKey}`) }
  const credentials = makeCredentials()
  const results = await importProfiles({
    profiles: [{ ...profile, apiKey: relayKey }],
    selectedIds: [profile.profileId],
    settings,
    credentials,
  })
  assert.equal(results[0].status, 'failed')
  assert.ok(!results[0].error.includes(relayKey))
  assert.match(results[0].error, /\[redacted\]/)
  assert.equal(credentials.store.size, 0)
})

test('failure details redact long opaque tokens without a known key', async () => {
  const settings = makeSettings({ providers: {} })
  settings.mutate = async () => { throw new Error(`boom ${'B'.repeat(40)}`) }
  const credentials = makeCredentials()
  const results = await importProfiles({ profiles: [profile], selectedIds: [profile.profileId], settings, credentials })
  assert.ok(!results[0].error.includes('B'.repeat(40)))
})

test('each failure kind carries a machine-readable error code', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = {
    store: new Map(),
    async set() { throw new Error('credential rejected') },
    async unset() {},
  }
  const results = await importProfiles({ profiles: [profile], selectedIds: [profile.profileId], settings, credentials })
  assert.equal(results[0].errorCode, 'credential-write-failed')
})
