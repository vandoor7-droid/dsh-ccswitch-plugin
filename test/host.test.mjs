// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject, name, Config } from '../src/host/index.mjs'

// --- fakes for driving a registered route -----------------------------------

function fakeRequest(method, path, body) {
  const request = {
    method,
    url: path,
    // Loopback + a same-origin marker, so methodFence lets a state-changing
    // POST through without an Origin header.
    headers: { host: '127.0.0.1:5624', 'x-dsh-ccswitch-origin': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  if (body !== undefined) {
    request[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(body)) }
  }
  return request
}

function fakeResponse() {
  const calls = []
  return {
    calls,
    writeHead(status, headers) { calls.push(['head', status, headers]) },
    end(payload) { calls.push(['end', payload]) },
  }
}

function statusOf(res) {
  return res.calls.find((call) => call[0] === 'head')[1]
}

function bodyOf(res) {
  return JSON.parse(res.calls.find((call) => call[0] === 'end')[1])
}

/**
 * A stand-in for `ctx.settings` holding both namespaces the manager routes
 * touch: this plugin's catalogue, and `llm-pi-ai` — the route table whose
 * membership *is* "applied". `describe()` hands out a snapshot per namespace
 * and `mutate()` applies path ops against a compare-and-set on the revision,
 * which is what makes an apply/withdraw observable from the outside.
 */
function fakeSettings(docs, configured) {
  const mutations = []
  return {
    mutations,
    docs,
    async get() { return { providers: {} } },
    configure(presentation, owner) {
      configured.push([presentation, owner])
      return () => {}
    },
    async describe() {
      return Object.entries(docs).map(([ns, doc]) => ({
        ns,
        revision: doc.revision,
        value: structuredClone(doc.value),
      }))
    },
    async mutate(ns, ops, expectedRevision) {
      const doc = docs[ns]
      assert.ok(doc, `unexpected namespace ${ns}`)
      if (expectedRevision !== undefined && expectedRevision !== doc.revision) {
        throw Object.assign(new Error(`settings namespace "${ns}" changed since it was read`), { code: 'SETTINGS_CONFLICT' })
      }
      mutations.push({ ns, ops, expectedRevision })
      for (const op of ops) {
        assert.equal(op.path[0], 'providers', `unexpected op path ${op.path.join('.')}`)
        if (op.path.length === 1) {
          doc.value.providers = structuredClone(op.value)
          continue
        }
        const key = op.path[1]
        if (op.op === 'unset') delete doc.value.providers[key]
        else doc.value.providers[key] = structuredClone(op.value)
      }
      doc.revision += 1
    },
  }
}

const LIVE_KEY = 'ccs-live-11111111'
const COLD_KEY = 'ccs-cold-22222222'

test('Host apply registers injected routes and disposes them', async () => {
  const registered = []
  const disposed = []
  const effects = []
  const configured = []
  let routeCleanup
  // Two providers in the catalogue; only one of them is a member of
  // `llm-pi-ai`'s route table, so `inUse` has both answers to give.
  const settings = fakeSettings({
    'dsh-ccswitch-plugin': {
      revision: 3,
      value: {
        providers: {
          [LIVE_KEY]: {
            displayName: 'Live One',
            api: 'openai-completions',
            baseURL: 'https://api.live.test',
            models: [{ id: 'm-1' }],
            apiKeyEnv: 'DSH_CCSWITCH_11111111_API_KEY',
          },
          [COLD_KEY]: {
            displayName: 'Cold Two',
            api: 'openai-completions',
            baseURL: 'https://cold.test',
            models: [{ id: 'm-2' }],
            apiKeyEnv: 'DSH_CCSWITCH_22222222_API_KEY',
          },
        },
      },
    },
    'llm-pi-ai': {
      revision: 11,
      value: {
        providers: {
          [LIVE_KEY]: { displayName: 'Live One', baseURL: 'https://api.live.test' },
        },
      },
    },
  }, configured)
  const ctx = {
    settings,
    credentials: {},
    fiber: { id: 'root' },
    webServer: {
      register(route) {
        registered.push(route)
        return () => disposed.push(route.path)
      },
    },
    // The plugin owns a settings namespace, so apply asks for `settings` a
    // second time in a scoped child. The fake has to hand back a child whose
    // `settings` is the same object, or the configure() call never happens.
    inject(names, callback) {
      assert.deepEqual(names, ['settings'])
      callback({ ...this, effect: this.effect })
    },
    effect(effect, label) {
      effects.push(label)
      const cleanup = effect()
      if (label === 'dsh-ccswitch-plugin: routes') routeCleanup = cleanup
    },
  }

  assert.equal(name, 'dsh-ccswitch-plugin')
  assert.deepEqual(inject, ['webServer', 'settings', 'credentials'])
  apply(ctx)
  assert.deepEqual(registered.map((route) => route.path), [
    '/api/dsh-ccswitch/scan',
    '/api/dsh-ccswitch/import',
    '/api/dsh-ccswitch/probe',
    '/api/dsh-ccswitch-manager/providers',
    '/api/dsh-ccswitch-manager/providers/save',
    '/api/dsh-ccswitch-manager/providers/delete',
    '/api/dsh-ccswitch-manager/providers/apply',
    '/api/dsh-ccswitch-manager/providers/withdraw',
    '/api/dsh-ccswitch-manager/providers/reorder',
    '/api/dsh-ccswitch-manager/presets',
  ])

  // The three membership deps apply() injects into makeManagerRoutes must be
  // the ones actually wired through — driving the registered handlers is the
  // only assertion that reaches the composition half rather than the routes
  // in isolation.
  const routes = new Map(registered.map((route) => [route.path, route]))
  const call = async (path, request) => {
    const route = routes.get(path)
    assert.ok(route, `no route for ${path}`)
    const res = fakeResponse()
    await route.handler(request, res)
    return res
  }

  // readLiveProviders: membership is read back from `llm-pi-ai` on every list.
  const list = bodyOf(await call('/api/dsh-ccswitch-manager/providers', fakeRequest('GET', '/api/dsh-ccswitch-manager/providers')))
  assert.equal(list.providers[LIVE_KEY].inUse, true)
  assert.equal(list.providers[COLD_KEY].inUse, false)

  // applyProvider: a POST to the apply route must write the member into the
  // route table, through the injected helper, at the revision it read.
  const applied = await call(
    '/api/dsh-ccswitch-manager/providers/apply',
    fakeRequest('POST', '/api/dsh-ccswitch-manager/providers/apply', { key: COLD_KEY }),
  )
  assert.equal(statusOf(applied), 200)
  assert.deepEqual(bodyOf(applied), { key: COLD_KEY, status: 'applied', warnings: [] })
  assert.deepEqual(settings.mutations.at(-1), {
    ns: 'llm-pi-ai',
    ops: [{ op: 'set', path: ['providers', COLD_KEY], value: settings.docs['llm-pi-ai'].value.providers[COLD_KEY] }],
    expectedRevision: 11,
  })
  assert.equal(Object.hasOwn(settings.docs['llm-pi-ai'].value.providers, COLD_KEY), true)

  // withdrawProvider: the same for taking the member back out.
  const withdrawn = await call(
    '/api/dsh-ccswitch-manager/providers/withdraw',
    fakeRequest('POST', '/api/dsh-ccswitch-manager/providers/withdraw', { key: LIVE_KEY }),
  )
  assert.equal(statusOf(withdrawn), 200)
  assert.deepEqual(bodyOf(withdrawn), { key: LIVE_KEY, status: 'withdrawn', inCatalogue: true })
  assert.deepEqual(settings.mutations.at(-1), {
    ns: 'llm-pi-ai',
    ops: [{ op: 'unset', path: ['providers', LIVE_KEY] }],
    expectedRevision: 12,
  })
  assert.equal(Object.hasOwn(settings.docs['llm-pi-ai'].value.providers, LIVE_KEY), false)

  routeCleanup()
  assert.deepEqual(disposed, registered.map((route) => route.path))
})

test('the plugin declares its own settings namespace', () => {
  // Without an exported `Config` carrying a volatile field there is no
  // descriptor for `dsh-ccswitch-plugin` in SettingsForms.describe(), so the
  // browser would have no namespace to write a provider into.
  assert.ok(Config, 'the host half must export a Config schema')
  const parsed = Config({
    providers: {
      'ccs-deepseek-abc12345': {
        displayName: 'DeepSeek',
        api: 'openai-completions',
        baseURL: 'https://api.deepseek.com',
        models: [{ id: 'deepseek-chat' }],
      },
    },
  })
  // The live field must come back as a cosmokit `Volatile` reference — that is
  // the whole mechanism: the Loader commits live edits by walking these, and a
  // schema built by the wrong schemastery copy would hand back a plain object.
  assert.equal(typeof parsed.providers?.get, 'function', 'providers must be a Volatile reference')
  assert.equal(parsed.providers.get()['ccs-deepseek-abc12345'].displayName, 'DeepSeek')
  // The root is ordinary config, not a reference: only the catalogue is
  // live-editable, and marking the root would expose it as one opaque field.
  assert.equal(typeof parsed.get, 'undefined')
})

test('apply suppresses the generated settings page but keeps the namespace', () => {
  // The plugin ships its own management UI, so the auto-generated form would
  // be a duplicate. `auto: false` is presentation only — it must not be
  // mistaken for dropping read/write access to the namespace.
  const configured = []
  const effects = []
  const ctx = {
    settings: {
      configure(presentation, owner) {
        configured.push([presentation, owner])
        return () => {}
      },
    },
    credentials: {},
    fiber: { marker: 'owner-fiber' },
    webServer: { register() { return () => {} } },
    inject(names, callback) {
      callback({ ...this, effect: this.effect })
    },
    effect(effect) {
      effects.push(effect())
    },
  }
  apply(ctx)
  assert.deepEqual(configured, [[{ auto: false }, ctx.fiber]])
})
