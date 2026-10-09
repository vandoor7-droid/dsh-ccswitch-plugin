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
  assert.equal(body.current, 'ccs-a-11111111')
  assert.deepEqual(body.order, ['ccs-a-11111111'])
  assert.equal(body.providers['ccs-a-11111111'].credential, 'found')
  assert.equal(body.providers['ccs-a-11111111'].displayName, 'DeepSeek')
  // The whole response, serialized, must not contain the secret anywhere.
  assert.doesNotMatch(JSON.stringify(body), /sk-secret-value/)
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

// --- activate --------------------------------------------------------------

test('activating one provider clears every other one', async () => {
  const settings = fakeSettings({
    a: { ...SAMPLE, isCurrent: true },
    b: { ...SAMPLE, displayName: 'B' },
  })
  const applied = []
  const routes = makeManagerRoutes({
    settings,
    credentials: fakeCredentials(),
    isLoopback: () => true,
    applyProvider: async (key, provider) => { applied.push([key, provider.displayName]) },
  })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/activate`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { key: 'b' }),
    res,
  )
  assert.equal(statusOf(res), 200)
  assert.equal(bodyOf(res).applied, true)
  assert.equal(settings.providers.a.isCurrent, false)
  assert.equal(settings.providers.b.isCurrent, true)
  assert.deepEqual(applied, [['b', 'B']])
})

test('a failed projection still reports the activation it did commit', async () => {
  // The catalogue write and the projection into DSH are separate steps. Once
  // the catalogue says "b is active" that is the durable fact; reporting it as
  // a failure would send the user to retry something that already happened.
  const settings = fakeSettings({ a: { ...SAMPLE, isCurrent: true }, b: { ...SAMPLE } })
  const routes = makeManagerRoutes({
    settings,
    credentials: fakeCredentials(),
    isLoopback: () => true,
    applyProvider: async () => { throw new Error('llm-pi-ai rejected the route') },
  })
  const res = fakeRes()
  await routeOf(routes, `${MANAGER_API_BASE}/providers/activate`).handler(
    withBody(fakeReq({ method: 'POST', headers: { host: '127.0.0.1:5624', ...POST_HEADERS } }), { key: 'b' }),
    res,
  )
  assert.equal(statusOf(res), 200)
  assert.equal(bodyOf(res).applied, false)
  assert.equal(settings.providers.b.isCurrent, true)
  assert.match(bodyOf(res).warnings.join(' '), /did not accept/)
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
    `${MANAGER_API_BASE}/providers/activate`,
    `${MANAGER_API_BASE}/presets`,
    `${MANAGER_API_BASE}/writers/run`,
  ])
})
