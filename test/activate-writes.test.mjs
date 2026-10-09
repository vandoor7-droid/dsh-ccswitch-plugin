// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
//
// Activating a provider is the one action in this plugin that reaches outside
// DSH: it rewrites another tool's live configuration. These tests pin the two
// halves of that promise — the tool's file really is rewritten, and a rewrite
// that cannot happen never rolls back the fact that the user chose the provider.
//
// The catalogue write and the file write are independent on purpose. Once the
// settings document says "this one is active" that is the durable fact; failing
// the request afterwards would send the user to retry something that already
// happened, and rolling the catalogue back would discard their choice.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeManagerRoutes, MANAGER_NAMESPACE, MANAGER_API_BASE } from '../src/host/manager-routes.mjs'

// --- harness ----------------------------------------------------------------

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-ccswitch-activate-'))
  return {
    home,
    cleanup() { rmSync(home, { recursive: true, force: true }) },
    read(relative) { return readFileSync(join(home, relative), 'utf8') },
    write(relative, text) {
      const path = join(home, relative)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, text)
    },
    exists(relative) {
      try { readFileSync(join(home, relative)); return true } catch { return false }
    },
  }
}

const POST_HEADERS = { 'x-dsh-ccswitch-origin': 'same-origin' }

function fakeReq(overrides = {}) {
  return {
    method: 'POST',
    url: `${MANAGER_API_BASE}/providers/activate`,
    headers: { host: '127.0.0.1:5624', ...POST_HEADERS },
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

function statusOf(res) { return res.calls.find((call) => call[0] === 'head')[1] }
function bodyOf(res) { return JSON.parse(res.calls.find((call) => call[0] === 'end')[1]) }

/** Mirrors the real namespace: whole-catalogue `set`, compare-and-set on revision. */
function fakeSettings(providers = {}) {
  let value = { providers: structuredClone(providers) }
  let revision = 0
  return {
    get providers() { return value.providers },
    get revision() { return revision },
    async describe() {
      return [{ ns: MANAGER_NAMESPACE, revision, value: structuredClone(value) }]
    },
    async mutate(ns, ops, expectedRevision) {
      if (ns !== MANAGER_NAMESPACE) throw new Error(`unexpected namespace ${ns}`)
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        throw Object.assign(new Error('changed since it was read'), { code: 'SETTINGS_CONFLICT' })
      }
      for (const op of ops) {
        assert.deepEqual(op.path, ['providers'], 'activation is a whole-catalogue edit')
        value = { providers: structuredClone(op.value) }
      }
      revision += 1
    },
  }
}

function fakeCredentials(values = {}) {
  return {
    async resolve(ref) {
      return Object.hasOwn(values, ref) ? { value: values[ref], source: 'test' } : undefined
    },
    async describe(ref) { return { ref, configured: Object.hasOwn(values, ref) } },
  }
}

function routeOf(routes) {
  const route = routes.find((item) => item.path === `${MANAGER_API_BASE}/providers/activate`)
  assert.ok(route, 'the activate route must be registered')
  return route
}

const KEY = 'ccs-deepseek-ab12cd34'
const REF = 'DSH_CCSWITCH_AB12CD34_API_KEY'

const CLAUDE_PROVIDER = {
  displayName: 'DeepSeek',
  appType: 'claude',
  api: 'anthropic-messages',
  baseURL: 'https://api.deepseek.com/anthropic',
  models: [{ id: 'deepseek-chat' }],
  apiKeyEnv: REF,
}

/** A settings.json that already carries a previous provider and user config. */
const CLAUDE_EXISTING = `{
  "env": {
    "ANTHROPIC_BASE_URL": "https://old.example",
    "ANTHROPIC_AUTH_TOKEN": "sk-old-value",
    "API_TIMEOUT_MS": "300000"
  },
  "hooks": {
    "Stop": []
  }
}
`

/** Build routes with a real home and a stubbed projection into DSH. */
function routesFor({ settings, credentials, home, applyProvider }) {
  return makeManagerRoutes({
    settings,
    credentials,
    isLoopback: () => true,
    home,
    applyProvider: applyProvider ?? (async () => []),
  })
}

// --- Claude -----------------------------------------------------------------

test('activating a Claude provider rewrites its settings.json', async () => {
  const fixture = makeHome()
  try {
    fixture.write('.claude/settings.json', CLAUDE_EXISTING)
    const settings = fakeSettings({ [KEY]: CLAUDE_PROVIDER })
    const routes = routesFor({
      settings,
      credentials: fakeCredentials({ [REF]: 'sk-new-secret' }),
      home: fixture.home,
    })

    const res = fakeRes()
    await routeOf(routes).handler(withBody(fakeReq(), { key: KEY }), res)

    assert.equal(statusOf(res), 200)
    const body = bodyOf(res)
    assert.equal(body.status, 'activated')
    assert.equal(body.applied, true)

    // It reports what it wrote...
    assert.equal(Array.isArray(body.written.files), true)
    assert.ok(body.written.files[0].path.endsWith('settings.json'))
    assert.deepEqual(body.written.files[0].keys, [
      'env.ANTHROPIC_BASE_URL',
      'env.ANTHROPIC_AUTH_TOKEN',
      'env.ANTHROPIC_MODEL',
    ])

    // ...and the file on disk really changed, with the user's keys intact.
    const doc = JSON.parse(fixture.read('.claude/settings.json'))
    assert.equal(doc.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic')
    assert.equal(doc.env.ANTHROPIC_AUTH_TOKEN, 'sk-new-secret')
    assert.equal(doc.env.API_TIMEOUT_MS, '300000', 'a key the user owns survives')
    assert.deepEqual(doc.hooks, { Stop: [] })

    // The catalogue agrees.
    assert.equal(settings.providers[KEY].isCurrent, true)

    // And the key never crossed the wire.
    assert.doesNotMatch(JSON.stringify(body), /sk-new-secret/, 'the key value never crosses the wire')
    assert.doesNotMatch(JSON.stringify(body), /sk-old-value/, 'nor the one it replaced')
  } finally {
    fixture.cleanup()
  }
})

// --- Codex ------------------------------------------------------------------

test('activating a Codex provider writes both of its files', async () => {
  const fixture = makeHome()
  try {
    const settings = fakeSettings({
      [KEY]: {
        displayName: 'DeepSeek',
        appType: 'codex',
        api: 'openai-completions',
        baseURL: 'https://api.deepseek.com/v1',
        models: [{ id: 'deepseek-chat' }],
        apiKeyEnv: REF,
      },
    })
    const routes = routesFor({
      settings,
      credentials: fakeCredentials({ [REF]: 'sk-new-secret' }),
      home: fixture.home,
    })

    const res = fakeRes()
    await routeOf(routes).handler(withBody(fakeReq(), { key: KEY }), res)

    assert.equal(statusOf(res), 200)
    const body = bodyOf(res)
    const paths = body.written.files.map((file) => file.path)
    assert.equal(paths.length, 2, 'Codex keeps its key and its routes in separate files')
    assert.ok(paths.some((path) => path.endsWith('auth.json')))
    assert.ok(paths.some((path) => path.endsWith('config.toml')))

    assert.ok(fixture.read('.codex/config.toml').includes('https://api.deepseek.com/v1'))
    // The credential belongs to the route table, not `auth.json`: Codex 0.149+
    // reads a custom provider's key from `experimental_bearer_token`, and a key
    // in `auth.json` would be read as an `apikey` credential that outranks the
    // official login living there.
    assert.ok(
      fixture.read('.codex/config.toml').includes('experimental_bearer_token = "sk-new-secret"'),
      'the key is written into the route table',
    )
    assert.ok(
      !fixture.read('.codex/auth.json').includes('sk-new-secret'),
      'auth.json is left for the official login and must not gain the key',
    )
  } finally {
    fixture.cleanup()
  }
})

// --- the branches that must not fail the activation -------------------------

test('a provider with no stored key is still activated, and says so', async () => {
  // The user's choice is the durable fact. What cannot happen is the config
  // write, because a file naming a provider with no key leaves the tool broken
  // in a way the user cannot see from inside DSH — so nothing is written.
  const fixture = makeHome()
  try {
    fixture.write('.claude/settings.json', CLAUDE_EXISTING)
    const settings = fakeSettings({ [KEY]: CLAUDE_PROVIDER })
    const routes = routesFor({ settings, credentials: fakeCredentials({}), home: fixture.home })

    const res = fakeRes()
    await routeOf(routes).handler(withBody(fakeReq(), { key: KEY }), res)

    assert.equal(statusOf(res), 200)
    const body = bodyOf(res)
    assert.equal(body.applied, true, 'the catalogue write is not undone by a missing key')
    assert.equal(settings.providers[KEY].isCurrent, true)
    assert.equal(body.written, undefined)
    assert.match(body.warnings.join(' '), /no key is stored/)

    // The file is byte-for-byte what it was.
    assert.equal(fixture.read('.claude/settings.json'), CLAUDE_EXISTING)
  } finally {
    fixture.cleanup()
  }
})

test('an app type with no writer yet names the ones that exist', async () => {
  // A silent no-op would read as success. The user asked to activate this
  // provider, so the response has to say that nothing will happen outside DSH.
  const fixture = makeHome()
  try {
    const settings = fakeSettings({
      [KEY]: { ...CLAUDE_PROVIDER, appType: 'gemini', api: 'openai-completions' },
    })
    const routes = routesFor({
      settings,
      credentials: fakeCredentials({ [REF]: 'sk-new-secret' }),
      home: fixture.home,
    })

    const res = fakeRes()
    await routeOf(routes).handler(withBody(fakeReq(), { key: KEY }), res)

    assert.equal(statusOf(res), 200)
    const body = bodyOf(res)
    assert.equal(body.applied, true)
    assert.equal(body.written, undefined)
    assert.match(body.warnings.join(' '), /nothing writes a "gemini" configuration yet/)
    assert.match(body.warnings.join(' '), /claude, codex/)
    assert.equal(settings.providers[KEY].isCurrent, true)
  } finally {
    fixture.cleanup()
  }
})

test('a refused write does not undo the activation', async () => {
  // A file this plugin cannot parse is refused rather than replaced. That
  // refusal is reported, but it must not turn the activation into a failure.
  const fixture = makeHome()
  try {
    const broken = '{ this is not json'
    fixture.write('.claude/settings.json', broken)
    const settings = fakeSettings({ [KEY]: CLAUDE_PROVIDER })
    const routes = routesFor({
      settings,
      credentials: fakeCredentials({ [REF]: 'sk-new-secret' }),
      home: fixture.home,
    })

    const res = fakeRes()
    await routeOf(routes).handler(withBody(fakeReq(), { key: KEY }), res)

    assert.equal(statusOf(res), 200)
    const body = bodyOf(res)
    assert.equal(body.applied, true, 'the catalogue write stands')
    assert.equal(body.written, undefined)
    assert.match(body.warnings.join(' '), /left untouched/)
    assert.equal(fixture.read('.claude/settings.json'), broken, 'the file is byte-identical')
    assert.equal(settings.providers[KEY].isCurrent, true)
  } finally {
    fixture.cleanup()
  }
})

test('a projection failure and a write failure are reported separately', async () => {
  // Both halves can fail at once and the user needs to be able to tell which
  // one did, because the fixes are different: one is a DSH settings problem,
  // the other is a file on disk.
  const fixture = makeHome()
  try {
    fixture.write('.claude/settings.json', '{ broken')
    const settings = fakeSettings({ [KEY]: CLAUDE_PROVIDER })
    const routes = routesFor({
      settings,
      credentials: fakeCredentials({ [REF]: 'sk-new-secret' }),
      home: fixture.home,
      applyProvider: async () => { throw new Error('llm-pi-ai rejected the route') },
    })

    const res = fakeRes()
    await routeOf(routes).handler(withBody(fakeReq(), { key: KEY }), res)

    assert.equal(statusOf(res), 200)
    const body = bodyOf(res)
    assert.equal(body.applied, false)
    const warnings = body.warnings.join(' ')
    assert.match(warnings, /did not accept/)
    assert.match(warnings, /left untouched/)
    assert.equal(settings.providers[KEY].isCurrent, true, 'both failures together still do not undo the choice')
  } finally {
    fixture.cleanup()
  }
})

test('activating an unknown provider writes nothing and 404s', async () => {
  const fixture = makeHome()
  try {
    const settings = fakeSettings({ [KEY]: CLAUDE_PROVIDER })
    const routes = routesFor({
      settings,
      credentials: fakeCredentials({ [REF]: 'sk-new-secret' }),
      home: fixture.home,
    })

    const res = fakeRes()
    await routeOf(routes).handler(withBody(fakeReq(), { key: 'ccs-nope-00000000' }), res)

    assert.equal(statusOf(res), 404)
    assert.equal(fixture.exists('.claude/settings.json'), false)
    assert.equal(settings.providers[KEY].isCurrent, undefined, 'nothing was activated')
  } finally {
    fixture.cleanup()
  }
})
