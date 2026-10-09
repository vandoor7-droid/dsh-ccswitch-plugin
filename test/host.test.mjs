// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject, name, Config } from '../src/host/index.mjs'

test('Host apply registers injected routes and disposes them', () => {
  const registered = []
  const disposed = []
  const effects = []
  const configured = []
  let routeCleanup
  const ctx = {
    settings: {
      async get() { return { providers: {} } },
      configure(presentation, owner) {
        configured.push([presentation, owner])
        return () => {}
      },
    },
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
  ])
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
