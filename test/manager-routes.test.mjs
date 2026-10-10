// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
//
// The manager routes are the first place this plugin writes into a settings
// namespace it owns, so these tests care about two things beyond the happy
// path: that a credential never crosses the wire, and that the write ordering
// cannot leave the document naming a secret that does not exist.
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeManagerRoutes, MANAGER_NAMESPACE, MANAGER_API_BASE } from '../src/host/manager-routes.mjs'
import { isLoopbackRequest } from '../src/host/routes.mjs'

// --- fakes -----------------------------------------------------------------

function fakeReq(overrides = {}) {
  return {
    method: 'GET',
    url: `${MANAGER_API_BASE}/providers`,
    headers: { host: '127.0.0.1:5624' },
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  }
}

function fakeRes() {
  const calls = []
  return {
    calls,
    writeHead(status, headers) { calls.push(['head', status, headers]) },
    end(body) { calls.push(['end', body]) },
  }
}

function withBody(request, body) {
  return Object.assign(request, {
    [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(body)) },
  })
}

function statusOf(res) {
  return res.calls.find((call) => call[0] === 'head')[1]
}

function bodyOf(res) {
  return JSON.parse(res.calls.find((call) => call[0] === 'end')[1])
}

/**
 * A stand-in for `ctx.settings` that models the parts the routes rely on:
 * `describe()` returning a namespace view with a revision, and `mutate()`
 * applying path ops under a compare-and-set on that revision.
 */
function fakeSettings(providers = undefined) {
  let value = providers === undefined ? undefined : { providers: structuredClone(providers) }
  let revision = 0
  const mutations = []
  const fail = { mode: undefined }
  return {
    mutations,
    fail,
    get providers() { return value?.providers },
    get revision() { return revision },
    async describe() {
      if (value === undefined) return []
      // `describe()` reports the resolved value, not a live reference; a
      // caller that mutates it in place must not affect the document.
      return [{ ns: MANAGER_NAMESPACE, revision, value: structuredClone(value) }]
    },
    async mutate(ns, ops, expectedRevision) {
      if (ns !== MANAGER_NAMESPACE) throw new Error(`unexpected namespace ${ns}`)
      if (fail.mode === 'conflict') {
        throw Object.assign(new Error(`settings namespace "${ns}" changed since it was read`), { code: 'SETTINGS_CONFLICT' })
      }
      if (fail.mode === 'throw') throw new Error('boom')
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw Object.assign(new Error(`settings namespace "${ns}" changed since it was read`), { code: 'SETTINGS_CONFLICT' })
      }
      mutations.push({ ops, expectedRevision })
      for (const op of ops) {
        if (op.path.length === 1 && op.path[0] === 'providers') {
          value = { providers: structuredClone(op.value) }
          continue
        }
        assert.equal(op.path[0], 'providers', `unexpected op path ${op.path.join('.')}`)
        const key = op.path[1]
        const next = { ...(value?.providers ?? {}) }
        if (op.op === 'unset') delete next[key]
        else next[key] = structuredClone(op.value)
        value = { providers: next }
      }
      revision += 1
    },
  }
}

function fakeCredentials(initial = {}) {
  const store = new Map(Object.entries(initial))
  const calls = []
  return {
    store,
    calls,
    async set(ref, value) { calls.push(['set', ref]); store.set(ref, value) },
    async unset(ref) { calls.push(['unset', ref]); store.delete(ref) },
    async resolve(ref) { return store.has(ref) ? { value: store.get(ref) } : undefined },
    async describe(ref) { return { ref, configured: store.has(ref) } },
  }
}

const SAMPLE = {
  displayName: 'DeepSeek',
  api: 'openai-completions',
  baseURL: 'https://api.deepseek.com',
  models: [{ id: 'deepseek-chat' }],
}

function routeOf(routes, path) {
  const route = routes.find((item) => item.path === path)
  assert.ok(route, `no route for ${path}`)
  return route
}

const POST_HEADERS = { 'x-dsh-ccswitch-origin': 'same-origin' }

// --- the catalogue is readable and carries no secret ------------------------

test('listing providers reports configuredness, never the key', async () => {
  const settings = fakeSettings({ 'ccs-a-11111111': { ...SAMPLE, apiKeyEnv: 'DSH_CCSWITCH_11111111_API_KEY', isCurrent: true } })
  const credentials = fakeCredentials({ DSH_CCSWITCH_11111111_API_KEY: 'sk-secret-value' })
  const routes = makeManagerRoutes({ settings, credentials, isLoopback: () => true })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers`).handler(fakeReq(), res)
  const body = bodyOf(res)
  assert.equal(statusOf(res), 200)
  // There is no single "current" provider any more: membership is a set read
  // from the route table, not a pointer into the catalogue.
  assert.equal(body.current, undefined, 'the active-provider pointer is gone')
  assert.equal(body.currentByApp, undefined, 'and so is the per-app pointer')
  assert.deepEqual(body.order, ['ccs-a-11111111'])
  assert.equal(body.providers['ccs-a-11111111'].credential, 'found')
  assert.equal(body.providers['ccs-a-11111111'].displayName, 'DeepSeek')
  // The route table was never consulted, so nothing is a member yet.
  assert.equal(body.providers['ccs-a-11111111'].inUse, false)
  // The labelling set for the form, taken from the scanner's supported list.
  assert.deepEqual(body.appTypes, [
    'codex', 'claude', 'claude-desktop', 'opencode', 'gemini',
    'hermes', 'grokbuild', 'pi', 'mcode', 'openclaw',
  ])
  // The whole response, serialized, must not contain the secret anywhere.
  assert.doesNotMatch(JSON.stringify(body), /sk-secret-value/)

  // The same catalogue read against a route table that does serve the key.
  const memberRoutes = makeManagerRoutes({
    settings,
    credentials,
    isLoopback: () => true,
    readLiveProviders: async () => ({ 'ccs-a-11111111': { model: 'deepseek-chat' } }),
  })
  const memberRes = fakeRes()
  await routeOf(memberRoutes, `${MANAGER_API_BASE}/providers`).handler(fakeReq(), memberRes)
  assert.equal(statusOf(memberRes), 200)
  assert.equal(bodyOf(memberRes).providers['ccs-a-11111111'].inUse, true)
})

test('a missing namespace reads as empty rather than failing', async () => {
  // Before the first write there is no descriptor at all — that is a normal
  // first run, not an error, and `exists: false` is how the UI tells it apart
  // from "the catalogue exists and is empty".
  const routes = makeManagerRoutes({ settings: fakeSettings(), credentials: fakeCredentials(), isLoopback: () => true })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers`).handler(fakeReq(), res)
  assert.equal(statusOf(res), 200)
  assert.deepEqual(bodyOf(res).providers, {})
  assert.equal(bodyOf(res).exists, false)
})

// --- save ------------------------------------------------------------------

test('saving a new provider mints a key and stores the secret', async () => {
  const settings = fakeSettings({})
  const credentials = fakeCredentials()
  const routes = makeManagerRoutes({ settings, credentials, isLoopback: () => true })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/save`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { provider: SAMPLE, apiKey: 'sk-new-secret' }),
    res,
  )
  const body = bodyOf(res)
  assert.equal(statusOf(res), 200)
  assert.equal(body.status, 'created')
  assert.match(body.key, /^ccs-deepseek-[0-9a-f]{8}$/)
  // The stored record keeps only the reference; the value lives in credentials.
  const stored = settings.providers[body.key]
  assert.equal(stored.apiKeyEnv, `DSH_CCSWITCH_${body.key.split('-').pop().toUpperCase()}_API_KEY`)
  assert.equal(stored.apiKey, undefined)
  assert.equal(credentials.store.get(stored.apiKeyEnv), 'sk-new-secret')
  assert.doesNotMatch(JSON.stringify(body), /sk-new-secret/)
})

test('the credential is written before the reference that names it', async () => {
  // The other order leaves the document pointing at a secret that does not
  // exist, which the UI reads as "configured" while every request fails.
  const order = []
  const settings = fakeSettings({})
  const credentials = fakeCredentials()
  const routes = makeManagerRoutes({
    settings: {
      ...settings,
      async mutate(ns, ops, rev) { order.push('settings'); return settings.mutate(ns, ops, rev) },
    },
    credentials: {
      ...credentials,
      async set(ref, value) { order.push('credential'); return credentials.set(ref, value) },
    },
    isLoopback: () => true,
  })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/save`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { provider: SAMPLE, apiKey: 'sk-x' }),
    res,
  )
  assert.deepEqual(order, ['credential', 'settings'])
})

test('saving without a key updates in place and keeps the old secret', async () => {
  const settings = fakeSettings({ 'ccs-a-11111111': { ...SAMPLE, apiKeyEnv: 'DSH_CCSWITCH_11111111_API_KEY' } })
  const credentials = fakeCredentials({ DSH_CCSWITCH_11111111_API_KEY: 'sk-keep-me' })
  const routes = makeManagerRoutes({ settings, credentials, isLoopback: () => true })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/save`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), {
      key: 'ccs-a-11111111',
      provider: { ...SAMPLE, displayName: 'DeepSeek 改' },
    }),
    res,
  )
  assert.equal(statusOf(res), 200)
  assert.equal(bodyOf(res).status, 'updated')
  assert.equal(settings.providers['ccs-a-11111111'].displayName, 'DeepSeek 改')
  assert.equal(credentials.store.get('DSH_CCSWITCH_11111111_API_KEY'), 'sk-keep-me')
  assert.deepEqual(credentials.calls, [], 'no credential write when no key was sent')
})

test('a caller cannot choose the credential reference', async () => {
  // The key addresses a stored secret. Accepting one from the body would let a
  // caller point a new provider at another provider's credential.
  const settings = fakeSettings({})
  const credentials = fakeCredentials({ DSH_CCSWITCH_DEADBEEF_API_KEY: 'sk-victim' })
  const routes = makeManagerRoutes({ settings, credentials, isLoopback: () => true })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/save`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), {
      provider: { ...SAMPLE, apiKeyEnv: 'DSH_CCSWITCH_DEADBEEF_API_KEY' },
      apiKey: 'sk-attacker',
    }),
    res,
  )
  assert.equal(statusOf(res), 200)
  const key = bodyOf(res).key
  assert.notEqual(settings.providers[key].apiKeyEnv, 'DSH_CCSWITCH_DEADBEEF_API_KEY')
  assert.equal(credentials.store.get('DSH_CCSWITCH_DEADBEEF_API_KEY'), 'sk-victim', 'the other provider secret is untouched')
})

test('an unusable provider is rejected with per-field reasons', async () => {
  const settings = fakeSettings({})
  const routes = makeManagerRoutes({ settings, credentials: fakeCredentials(), isLoopback: () => true })
  for (const [provider, expected] of [
    [{ ...SAMPLE, displayName: '' }, /displayName/],
    [{ ...SAMPLE, api: 'gemini-native' }, /not one of/],
    [{ ...SAMPLE, baseURL: 'not a url' }, /is not a URL/],
    [{ ...SAMPLE, models: [] }, /at least one model/],
  ]) {
    const res = fakeRes()
    await routeOf(routes, `${MANAGER_API_BASE}/providers/save`).handler(
      withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { provider }),
      res,
    )
    assert.equal(statusOf(res), 400, JSON.stringify(provider))
    assert.match(bodyOf(res).errors.join('; '), expected)
  }
  assert.deepEqual(settings.mutations, [], 'nothing was written')
})

// --- delete ----------------------------------------------------------------

test('deleting removes the provider and then its secret', async () => {
  const settings = fakeSettings({ 'ccs-a-11111111': { ...SAMPLE, apiKeyEnv: 'DSH_CCSWITCH_11111111_API_KEY' } })
  const credentials = fakeCredentials({ DSH_CCSWITCH_11111111_API_KEY: 'sk-gone' })
  const routes = makeManagerRoutes({ settings, credentials, isLoopback: () => true })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/delete`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { key: 'ccs-a-11111111' }),
    res,
  )
  assert.equal(statusOf(res), 200)
  assert.equal(bodyOf(res).status, 'removed')
  assert.equal(settings.providers['ccs-a-11111111'], undefined)
  assert.equal(credentials.store.has('DSH_CCSWITCH_11111111_API_KEY'), false)
  // The catalogue is cleared first: the reverse order would destroy the secret
  // for a provider that a failed mutate left listed.
  assert.equal(settings.mutations.length, 1)
  assert.deepEqual(settings.mutations[0].ops[0].op, 'unset')
})

test('deleting an unknown provider is a 404, not a silent success', async () => {
  const routes = makeManagerRoutes({ settings: fakeSettings({}), credentials: fakeCredentials(), isLoopback: () => true })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/delete`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { key: 'nope' }),
    res,
  )
  assert.equal(statusOf(res), 404)
})

test('deleting a live provider withdraws it first, then forgets it and its secret', async () => {
  // Membership lives in DSH's route table, so the row cannot simply be
  // dropped: a member still routed to would become a dangling entry that
  // nothing could ever take back out. The withdraw happens before the
  // catalogue write, and the secret is dropped only after it.
  const settings = fakeSettings({
    'ccs-a-11111111': { ...SAMPLE, isCurrent: true, apiKeyEnv: 'DSH_CCSWITCH_11111111_API_KEY' },
    'ccs-b-22222222': { ...SAMPLE, displayName: 'B' },
  })
  const credentials = fakeCredentials({ DSH_CCSWITCH_11111111_API_KEY: 'sk-live' })
  const order = []
  const routes = makeManagerRoutes({
    settings: {
      ...settings,
      async mutate(ns, ops, rev) { order.push('mutate'); return settings.mutate(ns, ops, rev) },
    },
    credentials: {
      ...credentials,
      async unset(ref) { order.push('credential'); return credentials.unset(ref) },
    },
    isLoopback: () => true,
    readLiveProviders: async () => ({ 'ccs-a-11111111': {} }),
    withdrawProvider: async (key) => { order.push(`withdraw:${key}`) },
  })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/delete`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { key: 'ccs-a-11111111' }),
    res,
  )
  assert.equal(statusOf(res), 200)
  // `wasInUse` lets the UI say "and it was live" instead of implying nothing
  // was serving traffic — it is reported, not refused.
  assert.deepEqual(bodyOf(res), { key: 'ccs-a-11111111', status: 'removed', wasInUse: true })
  assert.deepEqual(order, ['withdraw:ccs-a-11111111', 'mutate', 'credential'],
    'withdraw first, then the catalogue write, and the secret only after that')
  assert.equal(settings.providers['ccs-a-11111111'], undefined)
  assert.equal(credentials.store.has('DSH_CCSWITCH_11111111_API_KEY'), false)
})

test('a withdraw that fails refuses the delete and leaves everything in place', async () => {
  // The row cannot be forgotten while DSH still routes to it: that would
  // strand the route table on a row the plugin no longer holds, so nothing
  // could ever take it back out.
  const settings = fakeSettings({
    'ccs-a-11111111': { ...SAMPLE, apiKeyEnv: 'DSH_CCSWITCH_11111111_API_KEY' },
  })
  const credentials = fakeCredentials({ DSH_CCSWITCH_11111111_API_KEY: 'sk-live' })
  const routes = makeManagerRoutes({
    settings,
    credentials,
    isLoopback: () => true,
    readLiveProviders: async () => ({ 'ccs-a-11111111': {} }),
    withdrawProvider: async () => { throw new Error('llm-pi-ai refused the removal') },
  })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/delete`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { key: 'ccs-a-11111111' }),
    res,
  )
  assert.equal(statusOf(res), 409)
  // The reason code keeps this 409 from reading as a stale document: the
  // client shows its own localized sentence for the row, because retrying
  // cannot help.
  assert.equal(bodyOf(res).reason, 'in-use')
  assert.match(bodyOf(res).error, /withdraw it first/)
  assert.ok(settings.providers['ccs-a-11111111'], 'the catalogue row survives')
  assert.equal(credentials.store.get('DSH_CCSWITCH_11111111_API_KEY'), 'sk-live', 'and so does its secret')
  assert.deepEqual(credentials.calls, [], 'nothing was unset')
  assert.deepEqual(settings.mutations, [], 'and the catalogue was not written')
})

test('a provider that is not live is deleted with no withdraw call', async () => {
  // The guard follows the route table, not the row: nothing is a member, so
  // there is nothing to take back out before the delete.
  const settings = fakeSettings({
    'ccs-a-11111111': { ...SAMPLE, isCurrent: true, apiKeyEnv: 'DSH_CCSWITCH_11111111_API_KEY' },
  })
  const credentials = fakeCredentials({ DSH_CCSWITCH_11111111_API_KEY: 'sk-old' })
  const withdrawn = []
  const routes = makeManagerRoutes({
    settings,
    credentials,
    isLoopback: () => true,
    readLiveProviders: async () => ({}),
    withdrawProvider: async (key) => { withdrawn.push(key) },
  })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/delete`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { key: 'ccs-a-11111111' }),
    res,
  )
  assert.equal(statusOf(res), 200)
  assert.deepEqual(bodyOf(res), { key: 'ccs-a-11111111', status: 'removed' })
  assert.equal(bodyOf(res).wasInUse, undefined, 'nothing was serving this row')
  assert.deepEqual(withdrawn, [], 'the route table was never touched')
  assert.equal(settings.providers['ccs-a-11111111'], undefined)
  assert.equal(credentials.store.has('DSH_CCSWITCH_11111111_API_KEY'), false)
})

test('deleting one provider never withdraws another, even while that one is live', async () => {
  // The withdraw addresses the key being deleted and no other: a live member
  // of an unrelated row must keep serving traffic.
  const settings = fakeSettings({
    'ccs-codex-22222222': { ...SAMPLE, appType: 'codex', apiKeyEnv: 'DSH_CCSWITCH_22222222_API_KEY' },
    'ccs-claude-11111111': { ...SAMPLE, appType: 'claude', apiKeyEnv: 'DSH_CCSWITCH_11111111_API_KEY' },
  })
  const credentials = fakeCredentials({ DSH_CCSWITCH_11111111_API_KEY: 'sk-claude' })
  const withdrawn = []
  const routes = makeManagerRoutes({
    settings,
    credentials,
    isLoopback: () => true,
    readLiveProviders: async () => ({ 'ccs-codex-22222222': {} }),
    withdrawProvider: async (key) => { withdrawn.push(key) },
  })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/delete`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { key: 'ccs-claude-11111111' }),
    res,
  )
  assert.equal(statusOf(res), 200)
  assert.deepEqual(bodyOf(res), { key: 'ccs-claude-11111111', status: 'removed' })
  assert.deepEqual(withdrawn, [], 'the other member stays in the route table')
  assert.ok(settings.providers['ccs-codex-22222222'], 'and its row is untouched')
})

// --- apply / withdraw -------------------------------------------------------

test('applying a provider writes nothing to the catalogue and can be repeated', async () => {
  const settings = fakeSettings({
    a: { ...SAMPLE, displayName: 'A', isCurrent: true },
    b: { ...SAMPLE, displayName: 'B' },
  })
  const applied = []
  const routes = makeManagerRoutes({
    settings,
    credentials: fakeCredentials(),
    isLoopback: () => true,
    applyProvider: async (key, provider) => { applied.push([key, provider.displayName]); return [] },
  })
  const before = structuredClone(settings.providers)
  const post = async (body) => {
    const res = fakeRes()
    await routeOf(routes, `${MANAGER_API_BASE}/providers/apply`).handler(
      withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), body),
      res,
    )
    return res
  }

  const first = await post({ key: 'b' })
  assert.equal(statusOf(first), 200)
  assert.equal(bodyOf(first).key, 'b')
  assert.equal(bodyOf(first).status, 'applied')
  assert.deepEqual(bodyOf(first).warnings, [])
  // Membership lives in DSH's route table, not here: a catalogue snapshot
  // before and after must be identical, so applying never races the revision
  // an open editor is holding and never rewrites credentials or defaults.
  assert.deepEqual(settings.providers, before, 'the catalogue is untouched')
  assert.deepEqual(settings.mutations, [], 'and no mutate was issued at all')
  assert.deepEqual(applied, [['b', 'B']])

  // Repeating it — even carrying a revision the server never issued, because
  // apply does not take one — is a no-op on the catalogue all the same.
  const second = await post({ key: 'b', expectedRevision: 999 })
  assert.equal(statusOf(second), 200)
  assert.equal(bodyOf(second).status, 'applied')
  assert.deepEqual(settings.providers, before)
  assert.deepEqual(settings.mutations, [])
  assert.deepEqual(applied, [['b', 'B'], ['b', 'B']])

  const missing = await post({ key: 'ghost' })
  assert.equal(statusOf(missing), 404)
  assert.equal(bodyOf(missing).error, 'no such provider')
  assert.deepEqual(applied, [['b', 'B'], ['b', 'B']], 'nothing was projected for a key that is not there')
})

test('apply surfaces the projection warnings, and a projection throw is a 500', async () => {
  const settings = fakeSettings({ a: { ...SAMPLE } })
  const warning = 'llm-pi-ai is not installed, nothing was written'
  const warned = makeManagerRoutes({
    settings,
    credentials: fakeCredentials(),
    isLoopback: () => true,
    applyProvider: async () => [warning],
  })
  const res = fakeRes()
  await routeOf(warned, `${MANAGER_API_BASE}/providers/apply`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { key: 'a' }),
    res,
  )
  assert.equal(statusOf(res), 200)
  assert.equal(bodyOf(res).status, 'applied')
  assert.deepEqual(bodyOf(res).warnings, [warning])

  // A projection that throws has committed nothing anywhere, so there is no
  // half-done state to report as success — this is a plain server error.
  const thrown = makeManagerRoutes({
    settings,
    credentials: fakeCredentials(),
    isLoopback: () => true,
    applyProvider: async () => { throw new Error('llm-pi-ai rejected the route') },
  })
  const errRes = fakeRes()
  await routeOf(thrown, `${MANAGER_API_BASE}/providers/apply`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { key: 'a' }),
    errRes,
  )
  assert.equal(statusOf(errRes), 500)
  assert.match(bodyOf(errRes).error, /could not apply/)
  assert.deepEqual(settings.mutations, [], 'the catalogue was never written either way')
})

test('the list shows every live member at once', async () => {
  // Several members are in the route table simultaneously — that is what
  // "applied" means now — so each row reports its own membership.
  const settings = fakeSettings({
    'ccs-claude-11111111': { ...SAMPLE, appType: 'claude', isCurrent: true },
    'ccs-codex-22222222': { ...SAMPLE, appType: 'codex' },
    'ccs-idle-33333333': { ...SAMPLE, displayName: 'Idle' },
  })
  const routes = makeManagerRoutes({
    settings,
    credentials: fakeCredentials(),
    isLoopback: () => true,
    readLiveProviders: async () => ({
      'ccs-claude-11111111': {},
      'ccs-codex-22222222': {},
    }),
  })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers`).handler(fakeReq(), res)
  assert.equal(statusOf(res), 200)
  const body = bodyOf(res)
  assert.equal(body.current, undefined)
  assert.equal(body.currentByApp, undefined)
  assert.equal(Object.keys(body.providers).length, 3)
  assert.equal(body.providers['ccs-claude-11111111'].inUse, true)
  assert.equal(body.providers['ccs-codex-22222222'].inUse, true)
  assert.equal(body.providers['ccs-idle-33333333'].inUse, false)
})

test('withdrawing removes the member and leaves the catalogue alone', async () => {
  const settings = fakeSettings({
    'ccs-a-11111111': { ...SAMPLE, apiKeyEnv: 'DSH_CCSWITCH_11111111_API_KEY' },
  })
  const credentials = fakeCredentials({ DSH_CCSWITCH_11111111_API_KEY: 'sk-keep' })
  const withdrawn = []
  const routes = makeManagerRoutes({
    settings,
    credentials,
    isLoopback: () => true,
    readLiveProviders: async () => ({ 'ccs-a-11111111': {}, 'ccs-orphan-99999999': {} }),
    withdrawProvider: async (key) => { withdrawn.push(key) },
  })
  const post = async (key) => {
    const res = fakeRes()
    await routeOf(routes, `${MANAGER_API_BASE}/providers/withdraw`).handler(
      withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { key }),
      res,
    )
    return res
  }

  const known = await post('ccs-a-11111111')
  assert.equal(statusOf(known), 200)
  assert.deepEqual(bodyOf(known), { key: 'ccs-a-11111111', status: 'withdrawn', inCatalogue: true })

  // A member the catalogue has forgotten is still worth removing — an orphan
  // in the route table is exactly the state a failed delete leaves behind.
  const orphan = await post('ccs-orphan-99999999')
  assert.equal(statusOf(orphan), 200)
  assert.deepEqual(bodyOf(orphan), { key: 'ccs-orphan-99999999', status: 'withdrawn', inCatalogue: false })

  assert.deepEqual(withdrawn, ['ccs-a-11111111', 'ccs-orphan-99999999'], 'withdraw is called with the key, known or not')
  assert.deepEqual(settings.mutations, [], 'the catalogue is never written by a withdraw')
  assert.ok(settings.providers['ccs-a-11111111'], 'the row stays, so apply is offered again')
  assert.equal(credentials.store.has('DSH_CCSWITCH_11111111_API_KEY'), true, 'and its secret is kept')
})

// --- fences ----------------------------------------------------------------

test('every manager route is loopback and method fenced', async () => {
  const settings = fakeSettings({ a: { ...SAMPLE } })
  // This is the one test that must NOT stub the fence: it is checking the real
  // `isLoopbackRequest` the Host passes in, so stubbing it would assert that a
  // predicate returning true returns true.
  const routes = makeManagerRoutes({ settings, credentials: fakeCredentials(), isLoopback: isLoopbackRequest })

  // Off-loopback on the read route.
  const offLoop = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers`).handler(
    fakeReq({ socket: { remoteAddress: '10.0.0.5' } }), offLoop,
  )
  assert.equal(statusOf(offLoop), 403)

  // Wrong method on the read route.
  const wrongMethod = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers`).handler(fakeReq({ method: 'POST' }), wrongMethod)
  assert.equal(statusOf(wrongMethod), 405)

  // A state-changing route with no same-origin proof at all is refused, and
  // says what it actually saw.
  const noProof = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/delete`).handler(
    withBody(fakeReq({ method: 'POST' }), { key: 'a' }), noProof,
  )
  assert.equal(statusOf(noProof), 403)
  assert.deepEqual(bodyOf(noProof).saw, { origin: false, site: null, marker: false })

  // Each of the three accepted proofs works.
  for (const headers of [
    { 'sec-fetch-site': 'same-origin' },
    POST_HEADERS,
    { origin: 'http://127.0.0.1:5624' },
  ]) {
    const res = fakeRes()
    await routeOf(routes, `${MANAGER_API_BASE}/providers/delete`).handler(
      withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...headers } }), { key: 'a' }),
      res,
    )
    assert.notEqual(statusOf(res), 403, JSON.stringify(headers))
  }
})

test('a settings conflict is reported as a conflict, not a server error', async () => {
  const settings = fakeSettings({ a: { ...SAMPLE } })
  settings.fail.mode = 'conflict'
  const routes = makeManagerRoutes({ settings, credentials: fakeCredentials(), isLoopback: () => true })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/delete`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { key: 'a' }),
    res,
  )
  assert.equal(statusOf(res), 409)
  assert.match(bodyOf(res).error, /reload and retry/)
})

test('the presets route is read-only and returns the catalogue', async () => {
  const routes = makeManagerRoutes({
    settings: fakeSettings({}),
    credentials: fakeCredentials(),
    isLoopback: () => true,
    presets: [{ key: 'deepseek', displayName: 'DeepSeek', api: 'openai-completions', baseURL: 'https://api.deepseek.com', models: [{ id: 'deepseek-chat' }] }],
  })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/presets`).handler(fakeReq({ url: `${MANAGER_API_BASE}/presets` }), res)
  assert.equal(statusOf(res), 200)
  assert.equal(bodyOf(res).presets.length, 1)
})

// --- no dynamic path segments ---------------------------------------------

test('no route uses a dynamic path segment', () => {
  // DSH matches routes by exact path or by prefix only; a `:key` pattern would
  // register cleanly and then never match, which reads as "the button does
  // nothing". The provider key therefore travels in the body.
  const routes = makeManagerRoutes({ settings: fakeSettings({}), credentials: fakeCredentials() })
  for (const route of routes) {
    assert.equal(route.kind, 'exact', `${route.path} must be an exact route`)
    assert.doesNotMatch(route.path, /[:*<>]/, `${route.path} looks like a dynamic route`)
  }
  assert.deepEqual(routes.map((route) => route.path), [
    `${MANAGER_API_BASE}/providers`,
    `${MANAGER_API_BASE}/providers/save`,
    `${MANAGER_API_BASE}/providers/delete`,
    `${MANAGER_API_BASE}/providers/apply`,
    `${MANAGER_API_BASE}/providers/withdraw`,
    `${MANAGER_API_BASE}/providers/reorder`,
    `${MANAGER_API_BASE}/presets`,
  ])
  // The retired subsystem must not come back: neither activation nor the
  // external-writer runner has a route any more.
  const paths = routes.map((route) => route.path)
  assert.ok(!paths.includes(`${MANAGER_API_BASE}/providers/activate`))
  assert.ok(!paths.includes(`${MANAGER_API_BASE}/writers/run`))
})

// --- reorder ---------------------------------------------------------------

test('reordering writes the position as an index and reports the new order', async () => {
  const settings = fakeSettings({
    a: { ...SAMPLE, displayName: 'A', sortIndex: 0 },
    b: { ...SAMPLE, displayName: 'B', sortIndex: 1 },
    c: { ...SAMPLE, displayName: 'C', sortIndex: 2 },
  })
  const routes = makeManagerRoutes({ settings, credentials: fakeCredentials(), isLoopback: () => true })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/reorder`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { keys: ['c', 'a', 'b'] }),
    res,
  )
  assert.equal(statusOf(res), 200)
  assert.deepEqual(bodyOf(res).order, ['c', 'a', 'b'])
  // Positions are the ordinals the list is sorted by, not the keys' document
  // order — that is what CC Switch's `sort_index` holds.
  assert.equal(settings.providers.c.sortIndex, 0)
  assert.equal(settings.providers.a.sortIndex, 1)
  assert.equal(settings.providers.b.sortIndex, 2)
})

test('a partial order is refused rather than leaving stale indices behind', async () => {
  // CC Switch's command takes per-row indices, so a caller may name only some
  // rows. Here that would interleave the rows it named with the ones it did
  // not, producing an order the user never saw.
  const settings = fakeSettings({ a: { ...SAMPLE }, b: { ...SAMPLE }, c: { ...SAMPLE } })
  const routes = makeManagerRoutes({ settings, credentials: fakeCredentials(), isLoopback: () => true })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/reorder`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { keys: ['a'] }),
    res,
  )
  assert.equal(statusOf(res), 400)
  assert.equal(settings.providers.a.sortIndex, undefined, 'nothing was written')
})

test('an order naming an unknown provider, or one twice, is refused', async () => {
  const settings = fakeSettings({ a: { ...SAMPLE }, b: { ...SAMPLE } })
  const routes = makeManagerRoutes({ settings, credentials: fakeCredentials(), isLoopback: () => true })
  const post = async (keys) => {
    const res = fakeRes()
    await routeOf(routes, `${MANAGER_API_BASE}/providers/reorder`).handler(
      withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { keys }),
      res,
    )
    return statusOf(res)
  }
  assert.equal(await post(['a', 'ghost']), 400, 'a key that names no provider')
  assert.equal(await post(['a', 'a']), 400, 'a repeated key')
  assert.equal(await post(['a']), 400, 'a partial order')
})

test('editing a provider keeps the position and creation time the form cannot carry', async () => {
  // The edit form rebuilds a provider from its editable fields and carries no
  // ordering metadata, and this route replaces the whole record — so a save
  // that took the draft at face value would silently reset a provider to the
  // end of the list on every edit.
  const settings = fakeSettings({
    a: { ...SAMPLE, sortIndex: 3, createdAt: 111, apiKeyEnv: 'DSH_CCSWITCH_11111111_API_KEY' },
  })
  const routes = makeManagerRoutes({ settings, credentials: fakeCredentials(), isLoopback: () => true })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/save`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), {
      key: 'a',
      provider: { ...SAMPLE, displayName: 'Renamed' },
    }),
    res,
  )
  assert.equal(statusOf(res), 200)
  assert.equal(settings.providers.a.displayName, 'Renamed')
  assert.equal(settings.providers.a.sortIndex, 3, 'the position survives an edit')
  assert.equal(settings.providers.a.createdAt, 111, 'and so does the creation time')
})

test('a brand-new provider is stamped and sorts last', async () => {
  const settings = fakeSettings({ a: { ...SAMPLE, sortIndex: 0 } })
  const routes = makeManagerRoutes({ settings, credentials: fakeCredentials(), isLoopback: () => true })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/save`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), {
      provider: { ...SAMPLE, displayName: 'Fresh' },
    }),
    res,
  )
  assert.equal(statusOf(res), 200)
  const created = settings.providers[bodyOf(res).key]
  assert.ok(Number.isFinite(created.createdAt), 'a creation time is stamped')
  assert.equal(created.sortIndex, undefined, 'and it has no position until it is ordered')
})
