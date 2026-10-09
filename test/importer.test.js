// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importProfiles } from '../lib/core/importer.js'
import { toProviderProfile, toCCSProvider } from '../lib/core/mapper.js'
import { providerKey, credentialRef, credentialRefForProviderKey, variantKey } from '../lib/core/ids.js'
import { validateCCSProvider } from '../src/domain/ccs-provider.mjs'

/**
 * The plugin's own catalogue namespace, spelled out rather than imported from
 * `src/host/manager-routes.mjs`. Taking it from there would make this file fail
 * whenever the Host is mid-edit, and the whole point of these tests is to pin
 * the namespace the import has to reach — a literal is the thing being asserted.
 */
const MANAGER_NS = 'dsh-ccswitch-plugin'

function makeSettings(initial, revision = 7, catalogue = { providers: {} }, catalogueRevision = 0) {
  // Two namespaces, two independent revision counters — which is what the real
  // service does: revisions are keyed per namespace (`this.revisions.get(entry.id)`
  // in dsh-settings), not per document. A harness with one shared counter would
  // hide the very bug this models, where a write to one namespace is compared
  // against the other namespace's revision.
  const state = {
    section: structuredClone(initial),
    revision,
    catalogue: structuredClone(catalogue),
    catalogueRevision,
  }
  const fieldFor = (ns) => (ns === 'llm-pi-ai' ? 'section' : ns === MANAGER_NS ? 'catalogue' : undefined)
  const counterFor = (ns) => (ns === 'llm-pi-ai' ? 'revision' : 'catalogueRevision')
  return {
    state,
    async get(ns) {
      // The real settings service exposes get(ns) — the importer reads existing
      // providers through it, so the mock must too.
      const field = fieldFor(ns)
      return field === undefined ? undefined : state[field]
    },
    async describe() {
      return [
        { ns: 'llm-pi-ai', revision: state.revision, value: structuredClone(state.section) },
        { ns: MANAGER_NS, revision: state.catalogueRevision, value: structuredClone(state.catalogue) },
      ]
    },
    async mutate(ns, ops, expectedRevision) {
      const field = fieldFor(ns)
      if (field === undefined) throw new Error(`unexpected namespace ${ns}`)
      const counter = counterFor(ns)
      if (expectedRevision !== undefined && expectedRevision !== state[counter]) {
        throw Object.assign(new Error('conflict'), { code: 'SETTINGS_CONFLICT' })
      }
      for (const op of ops) {
        if (op.op === 'set') {
          let cur = state[field]
          for (let i = 0; i < op.path.length - 1; i++) cur = cur[op.path[i]] ??= {}
          cur[op.path[op.path.length - 1]] = op.value
        } else if (op.op === 'unset') {
          let cur = state[field]
          for (let i = 0; i < op.path.length - 1; i++) cur = cur[op.path[i]]
          delete cur[op.path[op.path.length - 1]]
        }
      }
      state[counter] += 1
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
  const settings = makeSettings(
    {
      providers: {
        // An entry this importer previously wrote: toProviderProfile shape,
        // apiKeyEnv included (see mapper.test.js for the same convention).
        [key]: toProviderProfile(profile),
      },
    },
    7,
    // Both halves are current, which is the only state that counts as unchanged.
    { providers: { [key]: toCCSProvider(profile, undefined, key) } },
  )
  const credentials = makeCredentials()
  credentials.store.set(ref, 'existing')
  const results = await importProfiles({ profiles: [profile], selectedIds: [profile.profileId], settings, credentials })
  assert.equal(results[0].status, 'unchanged')
  // The batch must not have written anything at all: neither revision moved.
  assert.equal(settings.state.revision, 7)
  assert.equal(settings.state.catalogueRevision, 0)
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

// --- the plugin's own catalogue ------------------------------------------
// The importer writes two namespaces: `llm-pi-ai` is the route DSH calls, and
// `dsh-ccswitch-plugin` is the catalogue the manager UI lists. Writing only the
// first leaves the manager table empty, so the import silently does nothing the
// user can see. These tests fail if the catalogue write is removed.

test('an import lands in both the route table and the plugin catalogue', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const key = providerKey(profile.profileId, profile.profileName)

  await importProfiles({ profiles: [profile], selectedIds: [profile.profileId], settings, credentials })

  const route = settings.state.section.providers[key]
  const record = settings.state.catalogue.providers[key]
  assert.ok(route, 'the route entry is missing')
  assert.ok(record, 'the catalogue entry is missing')
  assert.equal(record.displayName, '星渡')
  assert.equal(record.api, 'openai-responses')
  assert.equal(record.baseURL, 'https://aiwtiaw.top')
  assert.equal(record.apiKeyEnv, credentialRefForProviderKey(key))
  assert.equal(record.appType, undefined)
  assert.equal(record.sourceProfileId, profile.profileId)
  assert.equal(record.models.length, 1)
  assert.equal(record.models[0].id, 'gpt-5.6-terra')
  // The catalogue is a settings document too, so it may not carry key material.
  assert.ok(!JSON.stringify(record).includes('sk-SECRET-1'))
  // Each namespace advanced its own counter.
  assert.equal(settings.state.revision, 8)
  assert.equal(settings.state.catalogueRevision, 1)
})

test('a record the manager UI could not load is never written to the catalogue', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const key = providerKey(profile.profileId, profile.profileName)
  // Parses as text, but is not a URL — llm-pi-ai stores any string, so only the
  // catalogue's validation catches it.
  const unparseable = { ...profile, baseURL: 'aiwtiaw.top' }

  const results = await importProfiles({ profiles: [unparseable], selectedIds: [profile.profileId], settings, credentials })

  assert.ok(settings.state.section.providers[key], 'the route half must still land')
  assert.equal(settings.state.catalogue.providers[key], undefined)
  assert.equal(results[0].status, 'new')
  assert.match(results[0].warnings.join('\n'), /未写入 provider 目录/)
  // The warning names the actual problem rather than the field name alone.
  assert.match(results[0].warnings.join('\n'), /baseURL/)
})

test('a route the importer already wrote is not rewritten to repair the catalogue', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const key = providerKey(profile.profileId, profile.profileName)
  // Route correct, catalogue absent: the state every provider imported before the
  // catalogue namespace existed is in. It must still count as needing work, or
  // the manager table stays empty forever.
  settings.state.section.providers[key] = toProviderProfile(profile)

  const results = await importProfiles({ profiles: [profile], selectedIds: [profile.profileId], settings, credentials })

  assert.equal(results[0].status, 'updated')
  assert.ok(settings.state.catalogue.providers[key], 'the catalogue repair did not happen')
  // The route was already right, so re-sending it would only re-test the
  // caller's precondition against a document nothing changed.
  assert.equal(settings.state.revision, 7)
  assert.equal(settings.state.catalogueRevision, 1)
})

test('a stale caller revision still repairs a catalogue-only import', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const key = providerKey(profile.profileId, profile.profileName)
  settings.state.section.providers[key] = toProviderProfile(profile)

  // Nothing writes the route namespace, so a stale llm-pi-ai revision guards
  // nothing and must not turn a catalogue repair into a conflict.
  const results = await importProfiles({
    profiles: [profile],
    selectedIds: [profile.profileId],
    settings,
    credentials,
    expectedRevision: 99,
  })

  assert.equal(results[0].status, 'updated')
  assert.ok(settings.state.catalogue.providers[key])
})

test('a catalogue write failure keeps the credential the landed route depends on', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const key = providerKey(profile.profileId, profile.profileName)
  const ref = credentialRefForProviderKey(key)
  const routeMutate = settings.mutate
  settings.mutate = async (ns, ops, expectedRevision) => {
    if (ns === MANAGER_NS) throw new Error('catalogue rejected')
    return routeMutate(ns, ops, expectedRevision)
  }

  const results = await importProfiles({ profiles: [profile], selectedIds: [profile.profileId], settings, credentials })

  // The route landed and names this credential. Removing it would leave DSH
  // calling a provider whose key does not exist — invisible from both screens.
  assert.equal(credentials.store.get(ref), 'sk-SECRET-1')
  assert.ok(settings.state.section.providers[key], 'the route write must be kept')
  assert.equal(settings.state.catalogue.providers[key], undefined)
  assert.equal(results[0].status, 'failed')
  assert.equal(results[0].errorCode, 'catalogue-write-failed')
  // The message says which half landed, not just that something failed.
  assert.match(results[0].error, /路由已写入/)
  assert.match(results[0].error, /目录写入失败/)
  assert.ok(!results[0].error.includes('sk-SECRET-1'))
})

test('a catalogue write failure does not disturb the rest of the batch', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const profiles = makeProfiles(3)
  const routeMutate = settings.mutate
  settings.mutate = async (ns, ops, expectedRevision) => {
    if (ns === MANAGER_NS) throw new Error('catalogue rejected')
    return routeMutate(ns, ops, expectedRevision)
  }

  const results = await importProfiles({
    profiles,
    selectedIds: profiles.map((p) => p.profileId),
    settings,
    credentials,
  })

  assert.deepEqual(results.map((r) => r.status), ['failed', 'failed', 'failed'])
  assert.deepEqual(results.map((r) => r.errorCode), Array(3).fill('catalogue-write-failed'))
  // Every route landed and every credential survived, so the batch is uniformly
  // half-applied rather than half-rolled-back.
  assert.equal(Object.keys(settings.state.section.providers).length, 3)
  assert.equal(credentials.store.size, 3)
})

test('the catalogue write is guarded by the catalogue revision, not the route one', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  // Deliberately different counters. Revisions are per namespace, so replaying
  // the route's revision against the catalogue would be compare-and-set against
  // a document that was never read — and with a value this far off, the write is
  // rejected as stale rather than silently landing.
  settings.state.revision = 7
  settings.state.catalogueRevision = 3
  const seen = []
  const routeMutate = settings.mutate
  settings.mutate = async (ns, ops, expectedRevision) => {
    seen.push({ ns, expectedRevision })
    return routeMutate(ns, ops, expectedRevision)
  }

  const results = await importProfiles({
    profiles: [profile],
    selectedIds: [profile.profileId],
    settings,
    credentials,
    expectedRevision: 7,
  })

  assert.equal(results[0].status, 'new')
  assert.deepEqual(seen, [
    { ns: 'llm-pi-ai', expectedRevision: 7 },
    { ns: MANAGER_NS, expectedRevision: 3 },
  ])
  // Each write advanced only its own counter.
  assert.equal(settings.state.revision, 8)
  assert.equal(settings.state.catalogueRevision, 4)
})

test('the catalogue record passes the manager UI validation', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const key = providerKey(profile.profileId, profile.profileName)

  await importProfiles({ profiles: [profile], selectedIds: [profile.profileId], settings, credentials })

  const check = validateCCSProvider(settings.state.catalogue.providers[key])
  assert.equal(check.ok, true, check.message)
})

test('a second import reports unchanged after the schema round-trip', async () => {
  const settings = makeSettings({ providers: {} })
  const credentials = makeCredentials()
  const key = providerKey(profile.profileId, profile.profileName)

  await importProfiles({ profiles: [profile], selectedIds: [profile.profileId], settings, credentials })
  // What the settings layer actually persists: the schema declares
  // `isCurrent`/`inFailoverQueue` with `.default(false)`, so the stored record
  // comes back carrying fields the writer never set. Comparing the raw objects
  // would call every provider stale on every import and rewrite it forever.
  const stored = settings.state.catalogue.providers[key]
  settings.state.catalogue.providers[key] = {
    ...stored,
    isCurrent: false,
    inFailoverQueue: false,
  }

  const results = await importProfiles({ profiles: [profile], selectedIds: [profile.profileId], settings, credentials })

  assert.equal(results[0].status, 'unchanged')
  assert.equal(settings.state.catalogueRevision, 1)
  assert.equal(settings.state.revision, 8)
})
