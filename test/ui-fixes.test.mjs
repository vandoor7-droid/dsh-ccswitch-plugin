// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
//
// Regression cover for the review round that made blocked rows explain
// themselves, kept the import report alive across the post-import refresh, and
// stopped the save badge from claiming "saved" while the draft had diverged.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { BLOCKED, BLOCKED_CODES } from '../lib/core/safety.js'
import { extractProfile } from '../lib/core/extract.js'
import { MESSAGES } from '../src/client/messages.mjs'
import { createCCSwitchImportController } from '../src/client/import-controller.mjs'
import { BLOCKED_FALLBACK } from '../src/ui/CCSwitchImportSection.mjs'
import { makeRoutes } from '../src/host/routes.mjs'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')

const CODEX_TOML = [
  'model_provider = "custom"',
  'model = "gpt-5.6-terra"',
  '[model_providers.custom]',
  'name = "X"',
  'base_url = "https://x.test"',
  'wire_api = "responses"',
  '',
].join('\n')

// --- host route harness, same shape as test/routes.test.mjs -----------------

function fakeReq(overrides = {}) {
  return {
    method: 'GET',
    url: '/api/dsh-ccswitch/scan',
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
    [Symbol.asyncIterator]: async function* () { yield Buffer.from(body) },
  })
}

function bodyOf(res) {
  return JSON.parse(res.calls.find((call) => call[0] === 'end')[1])
}

function scanRoute(scan) {
  return makeRoutes({ scan, getProviders: async () => ({}), isLoopback: () => true })
    .find((item) => item.path === '/api/dsh-ccswitch/scan')
}

function importRoute(importProfiles, scan = async () => []) {
  return makeRoutes({ scan, importProfiles, settings: {}, credentials: {}, isLoopback: () => true })
    .find((item) => item.path === '/api/dsh-ccswitch/import')
}

function postImport(body) {
  return withBody(
    fakeReq({
      method: 'POST',
      url: '/api/dsh-ccswitch/import',
      headers: { host: '127.0.0.1:5624', origin: 'http://127.0.0.1:5624', 'content-type': 'application/json' },
    }),
    JSON.stringify(body),
  )
}

// --- blocked rows now carry a machine-readable reason ----------------------

const BLOCKED_CASES = [
  [
    'unsupported app type',
    // `gemini` used to stand in here. It is a known app type now — scanned,
    // and blocked on protocol grounds with its own code — so this case uses an
    // app type the importer genuinely does not know.
    { id: 'u-1', name: 'U', app_type: 'cursor', settings_config: '{"env":{},"config":{}}' },
    BLOCKED.UNSUPPORTED_APP_TYPE,
    'cursor',
  ],
  [
    'settings_config that is not JSON',
    { id: 'j-1', name: 'J', app_type: 'codex', settings_config: 'not json at all' },
    BLOCKED.INVALID_SETTINGS_JSON,
    undefined,
  ],
  [
    'codex row without auth.OPENAI_API_KEY',
    { id: 'c-1', name: 'C', app_type: 'codex', settings_config: JSON.stringify({ config: CODEX_TOML }) },
    BLOCKED.MISSING_OPENAI_KEY,
    undefined,
  ],
  [
    'codex row without [model_providers.custom]',
    {
      id: 'c-2',
      name: 'C2',
      app_type: 'codex',
      settings_config: JSON.stringify({
        auth: { OPENAI_API_KEY: 'sk-aaaaaaaaaaaa' },
        config: 'model_provider = "custom"\nmodel = "m"\n',
      }),
    },
    BLOCKED.MISSING_CODEX_PROVIDER,
    undefined,
  ],
  [
    'claude row without an env key',
    { id: 'a-1', name: 'A', app_type: 'claude', settings_config: JSON.stringify({ env: {} }) },
    BLOCKED.MISSING_ANTHROPIC_KEY,
    undefined,
  ],
  [
    'claude row without ANTHROPIC_BASE_URL',
    {
      id: 'a-2',
      name: 'A2',
      app_type: 'claude',
      settings_config: JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-aaaaaaaaaaaa' } }),
    },
    BLOCKED.MISSING_ANTHROPIC_BASE_URL,
    undefined,
  ],
  [
    'opencode row without options.apiKey',
    {
      id: 'o-1',
      name: 'O',
      app_type: 'opencode',
      settings_config: JSON.stringify({ npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://x.test' }, models: {} }),
    },
    BLOCKED.MISSING_OPENCODE_KEY,
    undefined,
  ],
  [
    'opencode row without options.baseURL',
    {
      id: 'o-2',
      name: 'O2',
      app_type: 'opencode',
      settings_config: JSON.stringify({ npm: '@ai-sdk/openai-compatible', options: { apiKey: 'sk-aaaaaaaaaaaa' }, models: {} }),
    },
    BLOCKED.MISSING_OPENCODE_BASE_URL,
    undefined,
  ],
  [
    'opencode row with a non-openai-compatible adapter',
    {
      id: 'o-3',
      name: 'O3',
      app_type: 'opencode',
      settings_config: JSON.stringify({
        npm: '@ai-sdk/anthropic',
        options: { baseURL: 'https://x.test', apiKey: 'sk-aaaaaaaaaaaa' },
        models: {},
      }),
    },
    BLOCKED.UNSUPPORTED_OPENCODE_ADAPTER,
    '@ai-sdk/anthropic',
  ],
]

test('every blocked extraction names a code the UI can translate', () => {
  for (const [label, row, code, detail] of BLOCKED_CASES) {
    const profile = extractProfile(row)
    assert.equal(profile.blocked, true, `${label}: expected a blocked profile`)
    assert.equal(profile.blockedCode, code, `${label}: wrong blockedCode`)
    assert.ok(BLOCKED_CODES.has(profile.blockedCode), `${label}: ${profile.blockedCode} is not a known code`)
    assert.equal(profile.blockedDetail, detail, `${label}: wrong blockedDetail`)
    // The prose reason stays: existing callers and tests read it, and it is the
    // fallback text when a translation is missing.
    assert.ok(typeof profile.blockedReason === 'string' && profile.blockedReason.length > 0, `${label}: lost blockedReason`)
  }
})

test('a healthy profile carries no blocked metadata', () => {
  const profile = extractProfile({
    id: 'ok-1',
    name: 'OK',
    app_type: 'codex',
    settings_config: JSON.stringify({ auth: { OPENAI_API_KEY: 'sk-aaaaaaaaaaaa' }, config: CODEX_TOML }),
  })
  assert.equal(profile.blocked, false)
  assert.equal(profile.blockedCode, undefined)
  assert.equal(profile.blockedDetail, undefined)
})

test('every blocked code has a translation, including the ones the UI builds dynamically', () => {
  // src/ui/CCSwitchImportSection.mjs asks for `importer.blocked.${code}` with a
  // template literal, so the static `tr("…")` scan in test/i18n.test.mjs never
  // sees these keys. Assert them here instead.
  const missing = []
  for (const code of BLOCKED_CODES) {
    for (const locale of ['zh', 'en']) {
      if (!Object.hasOwn(MESSAGES[locale], `importer.blocked.${code}`)) missing.push(`${locale}: ${code}`)
    }
  }
  assert.deepEqual(missing, [])

  // Codes whose reason embeds a variable part must take the {detail} placeholder
  // in both locales, otherwise the detail is silently dropped.
  for (const code of [BLOCKED.UNSUPPORTED_APP_TYPE, BLOCKED.UNSUPPORTED_OPENCODE_ADAPTER]) {
    for (const locale of ['zh', 'en']) {
      assert.match(MESSAGES[locale][`importer.blocked.${code}`], /\{detail\}/, `${locale}: ${code} lost {detail}`)
    }
  }
})

test('the UI fallback covers every blocked code', () => {
  // BLOCKED_FALLBACK is the last resort when the Host translator is unavailable.
  // A code missing from it does not fail loudly — the row just falls back to the
  // generic "该配置无法导入" and the user loses the specific reason. The message
  // catalogue is asserted above; this covers the other half.
  const missing = [...BLOCKED_CODES].filter((code) => !Object.hasOwn(BLOCKED_FALLBACK, code))
  assert.deepEqual(missing, [])
  // A code that embeds a variable part must interpolate it here too.
  for (const code of [BLOCKED.UNSUPPORTED_APP_TYPE, BLOCKED.UNSUPPORTED_OPENCODE_ADAPTER, BLOCKED.UNSUPPORTED_GEMINI_PROTOCOL, BLOCKED.UNSUPPORTED_PI_API, BLOCKED.UNSUPPORTED_MCODE_API, BLOCKED.UNSUPPORTED_OPENCLAW_API]) {
    assert.match(BLOCKED_FALLBACK[code], /\{detail\}/, `${code} lost {detail}`)
  }
})

// --- the host passes the code through, whitelisted ------------------------

// A realistic blocked row for the codes that carry no variable part.
const NO_KEY_ROW = { id: 'c-1', name: 'C', app_type: 'codex', settings_config: JSON.stringify({ config: CODEX_TOML }) }

test('scan exposes the blocked code and detail', async () => {
  const route = scanRoute(async () => [extractProfile(NO_KEY_ROW)])
  const res = fakeRes()
  await route.handler(fakeReq(), res)
  const profile = bodyOf(res).profiles[0]
  assert.equal(profile.status, 'blocked')
  assert.equal(profile.blockedCode, BLOCKED.MISSING_OPENAI_KEY)
  // The prose stays redacted into the fixed English sentence it always was.
  assert.equal(profile.blockedReason, 'source profile is blocked')
  assert.ok(!JSON.stringify(bodyOf(res)).includes('auth.OPENAI_API_KEY'))
})

test('scan carries the variable part of a blocked reason as detail', async () => {
  const row = { id: 'u-1', name: 'U', app_type: 'cursor', settings_config: '{"env":{},"config":{}}' }
  const route = scanRoute(async () => [extractProfile(row)])
  const res = fakeRes()
  await route.handler(fakeReq(), res)
  const profile = bodyOf(res).profiles[0]
  assert.equal(profile.blockedCode, BLOCKED.UNSUPPORTED_APP_TYPE)
  assert.equal(profile.blockedDetail, 'cursor')
})

test('an unknown blocked code degrades to the generic one', async () => {
  const blocked = extractProfile(NO_KEY_ROW)
  const route = scanRoute(async () => ([
    { ...blocked, blockedCode: 'i-made-this-up' },
    { ...blocked, blockedCode: undefined },
    { ...blocked, blockedCode: 'x', blockedReason: '' },
  ]))
  const res = fakeRes()
  await route.handler(fakeReq(), res)
  const [invented, codeless, reasonless] = bodyOf(res).profiles
  assert.equal(invented.blockedCode, BLOCKED.UNKNOWN)
  assert.equal(codeless.blockedCode, BLOCKED.UNKNOWN)
  // No reason and no code is not a blocking statement, so nothing is claimed.
  assert.equal(reasonless.blockedCode, undefined)
})

test('blocked rows keep their detail on the import report', async () => {
  const route = importRoute(async () => ([{
    profileId: 'b-1',
    profileName: 'B',
    status: 'blocked',
    blockedReason: '不支持的 app_type：gemini',
    blockedCode: BLOCKED.UNSUPPORTED_APP_TYPE,
    blockedDetail: 'gemini',
  }]), async () => [{ profileId: 'b-1', profileName: 'B', apiKey: 'sk-aaaaaaaaaaaa', models: [] }])
  const res = fakeRes()
  await route.handler(postImport({ profileIds: ['b-1'] }), res)
  const [result] = bodyOf(res).results
  assert.equal(result.status, 'blocked')
  assert.equal(result.blockedCode, BLOCKED.UNSUPPORTED_APP_TYPE)
  assert.equal(result.blockedDetail, 'gemini')
  assert.equal(result.profileName, 'B')
})

// --- the report survives the post-import refresh --------------------------

test('a post-import refresh keeps the report it is refreshing around', async () => {
  const profiles = [{ profileId: 'p1', profileName: 'P1', status: 'new', credential: 'found' }]
  const controller = createCCSwitchImportController({
    fetchImpl: async () => ({ ok: true, async json() { return { profiles } } }),
  })
  await controller.scan()
  assert.deepEqual(controller.getSnapshot().results, [])

  // Seed a report, the way importSelected does.
  const importing = createCCSwitchImportController({
    fetchImpl: async (url) => (url.endsWith('/import')
      ? { ok: true, async json() { return { results: [{ profileId: 'p1', profileName: 'P1', status: 'new' }] } } }
      : { ok: true, async json() { return { profiles } } }),
  })
  await importing.scan()
  await importing.importSelected()
  assert.equal(importing.getSnapshot().results.length, 1)

  await importing.scan({ keepResults: true })
  assert.equal(importing.getSnapshot().phase, 'ready')
  assert.equal(importing.getSnapshot().results.length, 1, 'the refresh dropped the report')

  // A user-initiated scan starts a new report instead.
  await importing.scan()
  assert.deepEqual(importing.getSnapshot().results, [])

  importing.clearResults()
  assert.deepEqual(importing.getSnapshot().results, [])
})

test('a failing post-import refresh does not turn a finished import into an error', async () => {
  const controller = createCCSwitchImportController({
    fetchImpl: async (url) => (url.endsWith('/import')
      ? { ok: true, async json() { return { results: [{ profileId: 'p1', profileName: 'P1', status: 'new' }] } } }
      : { ok: true, async json() { return { profiles: [] } } }),
    onImported: async () => { throw new Error('settings refresh exploded') },
  })
  await controller.scan()
  await controller.importSelected()
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.phase, 'done')
  assert.equal(snapshot.error, null)
  assert.equal(snapshot.results[0].status, 'new')
})

// --- UI sources keep the affordances that make the above visible -----------

test('the import panel renders why a row is blocked', async () => {
  const ui = await read('src/ui/CCSwitchImportSection.mjs')
  assert.match(ui, /dsh-ccswitch-import__blocked-reason/)
  assert.match(ui, /importer\.blocked\.\$\{code\}/)
  // The panel used to only know how to render warnings, so blocked rows said
  // nothing at all.
  assert.match(ui, /blockedLabel/)
  // First paint is `idle`, so an empty profile list is "loading", not "empty".
  assert.match(ui, /awaitingFirstScan/)
  assert.match(ui, /importer\.loading/)
  // Loading and importing are different states and must not share a label.
  assert.match(ui, /importer\.importing/)
  // The report names the profile instead of its raw id.
  assert.match(ui, /result\.profileName \|\| result\.profileId/)
})

test('the post-import refresh is wired to the import controller', async () => {
  const client = await read('src/client/index.mjs')
  assert.match(client, /onImported: async \(\) => \{/)
  assert.match(client, /importer\.scan\(\{ keepResults: true \}\)/)
})

test('the reasoning panel stops claiming "saved" once the draft diverges', async () => {
  const ui = await read('src/ui/ReasoningSettingsSection.mjs')
  assert.match(ui, /const STATUS_DIRTY = "dirty"/)
  assert.match(ui, /const dirty = draftSignature\(draft\) !== draftSignature\(baseline\)/)
  assert.match(ui, /reasoning\.unsaved/)
  // Saving an unchanged draft must not be possible.
  assert.match(ui, /disabled: !writable \|\| status === "saving" \|\| !dirty/)
  // Reloading must not silently discard local edits.
  assert.match(ui, /globalThis\.confirm/)
  assert.match(ui, /reasoning\.reloadDirty/)
  // Custom wire values are visible without expanding the row.
  assert.match(ui, /dsh-reasoning-levels__custom/)
})

test('the new affordances are styled', async () => {
  const css = await read('src/client/styles.mjs')
  for (const selector of [
    'dsh-ccswitch-import__blocked-reason',
    'dsh-ccswitch-import__badge--failed',
    'dsh-ccswitch-import__badge--skipped',
    'dsh-ccswitch-import__report-head',
    'dsh-ccswitch-import__link',
    'dsh-ccswitch-import__result-detail',
    'dsh-reasoning-levels__custom',
  ]) {
    assert.ok(css.includes(`.${selector}`), `styles.mjs is missing .${selector}`)
  }
})

test('the "test connection" button is wired into the row, not into a label', async () => {
  const ui = await read('src/ui/CCSwitchImportSection.mjs')
  // The row must be a container with a real <label> for the checkbox: a button
  // nested in a wrapping <label> would also toggle the checkbox when clicked.
  assert.match(ui, /h\("div", \{\s*key: profile\.profileId,\s*className: "dsh-ccswitch-import__row"/)
  assert.match(ui, /h\("label", \{ htmlFor: checkboxId, className: "dsh-ccswitch-import__content" \}/)
  assert.match(ui, /className: "dsh-ccswitch-import__row-extras"/)
  assert.match(ui, /controller\.probeOne\(profile\.profileId\)/)
  assert.match(ui, /importer\.probe\.test\b/)
  assert.match(ui, /importer\.probe\.testing/)
  assert.match(ui, /probeLabel/)
  assert.match(ui, /probeKind/)
  // Only a row with a credential and a base URL can be tested at all.
  assert.match(ui, /const canProbe = selectable && Boolean\(profile\.baseURL\)/)

  const css = await read('src/client/styles.mjs')
  for (const selector of [
    'dsh-ccswitch-import__row-extras',
    'dsh-ccswitch-import__probe',
    'dsh-ccswitch-import__probe--ok',
    'dsh-ccswitch-import__probe--error',
    'dsh-ccswitch-import__probe-btn',
  ]) {
    assert.ok(css.includes(`.${selector}`), `styles.mjs is missing .${selector}`)
  }
})

test('the import controller owns the probe verdict and prunes it on re-scan', async () => {
  const client = await read('src/client/import-controller.mjs')
  assert.match(client, /probeOne: async \(profileId\)/)
  assert.match(client, /'\/api\/dsh-ccswitch\/probe'/)
  assert.match(client, /probes: pruneProbes\(snapshot\.probes, profiles\)/)
  assert.match(client, /function sanitizeProbe\(result\)/)
})
