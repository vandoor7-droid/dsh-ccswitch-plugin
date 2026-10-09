// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
//
// The app types CC Switch 4.0.4 grew that this importer learned to read. The
// shapes below are modelled on cc-switch's own src/config/*ProviderPresets.ts
// and src-tauri/src/*_config.rs, not on any real database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractProfile } from '../lib/core/extract.js'
import { BLOCKED, BLOCKED_CODES } from '../lib/core/safety.js'
import { SUPPORTED_APP_TYPES } from '../lib/core/scan.js'
import { MESSAGES } from '../src/client/messages.mjs'

function row(appType, settings, overrides = {}) {
  return {
    id: `${appType}-row-1`,
    name: `${appType} provider`,
    app_type: appType,
    settings_config: typeof settings === 'string' ? settings : JSON.stringify(settings),
    ...overrides,
  }
}

const ALL_NEW_APP_TYPES = ['gemini', 'hermes', 'grokbuild', 'pi', 'mcode', 'openclaw']

test('every new app type is in SUPPORTED_APP_TYPES so the scan does not drop it', () => {
  for (const appType of ALL_NEW_APP_TYPES) {
    assert.ok(SUPPORTED_APP_TYPES.includes(appType), `${appType} missing from SUPPORTED_APP_TYPES`)
  }
  // The pre-existing four must survive the extension.
  for (const appType of ['codex', 'claude', 'claude-desktop', 'opencode']) {
    assert.ok(SUPPORTED_APP_TYPES.includes(appType), `${appType} was dropped from SUPPORTED_APP_TYPES`)
  }
})

// --- gemini: read the fields, then block on protocol grounds ---------------

test('gemini rows are always blocked and name the endpoint they would have used', () => {
  const profile = extractProfile(row('gemini', {
    env: {
      GEMINI_API_KEY: 'gm-secret-value',
      GOOGLE_GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com',
      GEMINI_MODEL: 'gemini-2.5-pro',
    },
  }))
  // Fields are still extracted so the blocked row can name the endpoint …
  assert.equal(profile.apiKey, 'gm-secret-value')
  assert.equal(profile.baseURL, 'https://generativelanguage.googleapis.com')
  assert.deepEqual(profile.models, [{ id: 'gemini-2.5-pro' }])
  // … but the row can never import: the Gemini CLI speaks a protocol DSH
  // cannot drive, so there is no `api` value that would work.
  assert.equal(profile.api, undefined)
  assert.equal(profile.blocked, true)
  assert.equal(profile.blockedCode, BLOCKED.UNSUPPORTED_GEMINI_PROTOCOL)
  assert.equal(profile.blockedDetail, 'generativelanguage.googleapis.com')
  assert.match(profile.blockedReason, /Gemini/)
})

test('gemini blockedDetail is the bare host and empty without a base URL', () => {
  const withPath = extractProfile(row('gemini', {
    env: { GEMINI_API_KEY: 'k', GOOGLE_GEMINI_BASE_URL: 'https://relay.example:8443/v1beta' },
  }))
  assert.equal(withPath.blockedDetail, 'relay.example:8443')
  // A host is what the row needs to explain itself; no base URL means no host.
  const noUrl = extractProfile(row('gemini', { env: { GEMINI_API_KEY: 'k' } }))
  assert.equal(noUrl.blocked, true)
  assert.equal(noUrl.blockedCode, BLOCKED.UNSUPPORTED_GEMINI_PROTOCOL)
  assert.equal(noUrl.blockedDetail, '')
})

test('gemini falls back to GOOGLE_API_KEY and to a default model', () => {
  const profile = extractProfile(row('gemini', { env: { GOOGLE_API_KEY: 'google-key' } }))
  assert.equal(profile.apiKey, 'google-key')
  assert.deepEqual(profile.models, [{ id: 'gemini-2.5-pro' }])
  assert.match(profile.warnings.join('\n'), /gemini-2\.5-pro/)
})

test('gemini-official and Google Official are skipped outright', () => {
  const byId = extractProfile({ id: 'gemini-official', name: 'X', app_type: 'gemini', settings_config: '{}' })
  assert.equal(byId.skipped, true)
  const byName = extractProfile({ id: 'whatever', name: 'Google Official', app_type: 'gemini', settings_config: '{}' })
  assert.equal(byName.skipped, true)
})

// --- claude-desktop: both carrier shapes -----------------------------------

test('claude-desktop reads the top-level baseUrl preset', () => {
  const profile = extractProfile(row('claude-desktop', {
    baseUrl: 'https://relay.example/api',
    apiKeyField: 'ANTHROPIC_AUTH_TOKEN',
    env: { ANTHROPIC_AUTH_TOKEN: 'sk-desktop-token', ANTHROPIC_MODEL: 'claude-opus-4-5' },
  }))
  assert.equal(profile.blocked, false)
  assert.equal(profile.baseURL, 'https://relay.example/api')
  assert.equal(profile.apiKey, 'sk-desktop-token')
  assert.equal(profile.api, 'anthropic-messages')
  // A row that names its own model keeps the bare-string shape the claude
  // extractor has always produced; the mapper normalizes it downstream.
  assert.deepEqual(profile.models, ['claude-opus-4-5'])
})

test('claude-desktop still reads the legacy env.ANTHROPIC_BASE_URL shape', () => {
  const profile = extractProfile(row('claude-desktop', {
    env: { ANTHROPIC_BASE_URL: 'https://legacy.example', ANTHROPIC_API_KEY: 'sk-legacy-key' },
  }))
  assert.equal(profile.blocked, false)
  assert.equal(profile.baseURL, 'https://legacy.example')
  assert.equal(profile.apiKey, 'sk-legacy-key')
  assert.equal(profile.api, 'anthropic-messages')
})

test('claude-desktop prefers the top-level baseUrl over the nested one', () => {
  const profile = extractProfile(row('claude-desktop', {
    baseUrl: 'https://top-level.example',
    env: { ANTHROPIC_BASE_URL: 'https://nested.example', ANTHROPIC_AUTH_TOKEN: 'sk-k' },
  }))
  assert.equal(profile.baseURL, 'https://top-level.example')
})

test('claude-desktop honours apiKeyField naming ANTHROPIC_API_KEY', () => {
  const profile = extractProfile(row('claude-desktop', {
    baseUrl: 'https://x.example',
    apiKeyField: 'ANTHROPIC_API_KEY',
    env: { ANTHROPIC_API_KEY: 'sk-from-api-key-field', ANTHROPIC_AUTH_TOKEN: 'sk-should-lose' },
  }))
  assert.equal(profile.apiKey, 'sk-from-api-key-field')
})

test('claude-desktop ignores an apiKeyField that names something else', () => {
  // An unrecognised field name must not be trusted, but the row is still
  // readable through the defensive lookup.
  const profile = extractProfile(row('claude-desktop', {
    baseUrl: 'https://x.example',
    apiKeyField: 'SOME_OTHER_KEY',
    env: { SOME_OTHER_KEY: 'nope', ANTHROPIC_AUTH_TOKEN: 'sk-right-one' },
  }))
  assert.equal(profile.apiKey, 'sk-right-one')
})

test('claude-desktop blocked paths name their own codes', () => {
  const noKey = extractProfile(row('claude-desktop', { baseUrl: 'https://x.example', env: {} }))
  assert.equal(noKey.blocked, true)
  assert.equal(noKey.blockedCode, BLOCKED.MISSING_CLAUDE_DESKTOP_KEY)

  const noUrl = extractProfile(row('claude-desktop', { env: { ANTHROPIC_AUTH_TOKEN: 'sk-k' } }))
  assert.equal(noUrl.blocked, true)
  assert.equal(noUrl.blockedCode, BLOCKED.MISSING_CLAUDE_DESKTOP_BASE_URL)
})

test('claude-desktop keeps the thinking hint on a fallback model', () => {
  const profile = extractProfile(row('claude-desktop', {
    baseUrl: 'https://x.example',
    env: { ANTHROPIC_AUTH_TOKEN: 'sk-k' },
  }, { name: 'Relay · Claude Opus 5 Thinking' }))
  assert.deepEqual(profile.models, [{ id: 'claude-sonnet-4-5', fallbackThinking: true }])
  assert.match(profile.warnings.join('\n'), /claude-sonnet-4-5/)
})

// --- hermes ----------------------------------------------------------------

test('hermes maps every api_mode onto a DSH protocol', () => {
  const cases = [
    ['chat_completions', 'openai-completions'],
    ['codex_responses', 'openai-responses'],
    ['anthropic_messages', 'anthropic-messages'],
    ['openai_messages', 'openai-completions'],
  ]
  for (const [apiMode, expected] of cases) {
    const profile = extractProfile(row('hermes', {
      name: 'Hermes',
      base_url: 'https://hermes.example/v1',
      api_key: 'sk-hermes',
      api_mode: apiMode,
      models: [{ id: 'm-1', name: 'Model One', context_length: 200000 }],
    }))
    assert.equal(profile.blocked, false, `${apiMode} should import`)
    assert.equal(profile.api, expected, `${apiMode} mapped wrongly`)
    assert.equal(profile.baseURL, 'https://hermes.example/v1')
    assert.equal(profile.apiKey, 'sk-hermes')
  }
})

test('hermes keeps id, name and contextWindow from the models array', () => {
  const profile = extractProfile(row('hermes', {
    base_url: 'https://hermes.example/v1',
    api_key: 'sk-hermes',
    api_mode: 'chat_completions',
    models: [
      { id: 'm-1', name: 'Model One', context_length: 200000 },
      { id: 'm-2' },
    ],
  }))
  // hermes spells it `context_length`; llm-pi-ai's model profile reads
  // `contextWindow`. An unmapped key would be dropped by the schema, so the
  // assertion is on the DSH spelling, not the source one.
  assert.deepEqual(profile.models, [
    { id: 'm-1', name: 'Model One', contextWindow: 200000 },
    { id: 'm-2' },
  ])
})

test('hermes warns on an unknown api_mode and falls back to openai-completions', () => {
  const profile = extractProfile(row('hermes', {
    base_url: 'https://hermes.example/v1',
    api_key: 'sk-hermes',
    api_mode: 'made-up-mode',
    models: [{ id: 'm-1' }],
  }))
  assert.equal(profile.blocked, false)
  assert.equal(profile.api, 'openai-completions')
  assert.match(profile.warnings.join('\n'), /made-up-mode/)
})

test('hermes blocked paths name their own codes', () => {
  const noKey = extractProfile(row('hermes', { base_url: 'https://h.example', api_mode: 'chat_completions' }))
  assert.equal(noKey.blockedCode, BLOCKED.MISSING_HERMES_KEY)
  const noUrl = extractProfile(row('hermes', { api_key: 'sk-k', api_mode: 'chat_completions' }))
  assert.equal(noUrl.blockedCode, BLOCKED.MISSING_HERMES_BASE_URL)
})

test('hermes with no models falls back to a default id', () => {
  const profile = extractProfile(row('hermes', {
    base_url: 'https://h.example', api_key: 'sk-k', api_mode: 'chat_completions',
  }))
  assert.deepEqual(profile.models, [{ id: 'gpt-4o' }])
  assert.match(profile.warnings.join('\n'), /gpt-4o/)
})

// --- grokbuild: the codex carrier ------------------------------------------

test('grokbuild rides the codex path and maps wire_api responses to openai-responses', () => {
  const profile = extractProfile(row('grokbuild', {
    auth: { OPENAI_API_KEY: 'sk-grok' },
    apiFormat: 'responses',
    config: [
      'model_provider = "custom"',
      'model = "grok-4"',
      '[model_providers.custom]',
      'name = "Grok"',
      'base_url = "https://grok.example/v1"',
      'wire_api = "responses"',
      'requires_openai_auth = true',
      '',
    ].join('\n'),
  }))
  assert.equal(profile.blocked, false)
  assert.equal(profile.api, 'openai-responses')
  assert.equal(profile.baseURL, 'https://grok.example/v1')
  assert.equal(profile.apiKey, 'sk-grok')
  assert.deepEqual(profile.models, [{ id: 'grok-4' }])
  // Proof it really is the codex extractor, warnings and all.
  assert.match(profile.warnings.join('\n'), /requires_openai_auth/)
})

test('grokbuild reports the codex blocked codes', () => {
  const noKey = extractProfile(row('grokbuild', { config: 'model = "m"\n' }))
  assert.equal(noKey.blockedCode, BLOCKED.MISSING_OPENAI_KEY)
  const noProvider = extractProfile(row('grokbuild', {
    auth: { OPENAI_API_KEY: 'sk-grok' },
    config: 'model = "m"\n',
  }))
  assert.equal(noProvider.blockedCode, BLOCKED.MISSING_CODEX_PROVIDER)
})

test('grok-official and Grok Official are skipped outright', () => {
  const byId = extractProfile({ id: 'grok-official', name: 'X', app_type: 'grokbuild', settings_config: '{}' })
  assert.equal(byId.skipped, true)
  const byName = extractProfile({ id: 'whatever', name: 'Grok Official', app_type: 'grokbuild', settings_config: '{}' })
  assert.equal(byName.skipped, true)
})

// --- pi --------------------------------------------------------------------

test('pi reads the camelCase carrier and passes a valid api through', () => {
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
    const profile = extractProfile(row('pi', {
      name: 'Pi',
      baseUrl: 'https://pi.example/v1',
      api,
      apiKey: 'sk-pi',
      headers: { 'x-custom': 'y' },
      models: [{ id: 'p-1', name: 'Pi One' }, { id: 'p-2' }],
    }))
    assert.equal(profile.blocked, false, `${api} should import`)
    assert.equal(profile.api, api)
    assert.equal(profile.baseURL, 'https://pi.example/v1')
    assert.equal(profile.apiKey, 'sk-pi')
    assert.deepEqual(profile.models, [{ id: 'p-1', name: 'Pi One' }, { id: 'p-2' }])
  }
})

test('pi blocks an api outside the three DSH protocols', () => {
  const profile = extractProfile(row('pi', {
    baseUrl: 'https://pi.example/v1', api: 'gemini-native', apiKey: 'sk-pi', models: [{ id: 'p-1' }],
  }))
  assert.equal(profile.blocked, true)
  assert.equal(profile.blockedCode, BLOCKED.UNSUPPORTED_PI_API)
  assert.equal(profile.blockedDetail, 'gemini-native')
})

test('pi blocks a missing api too', () => {
  const profile = extractProfile(row('pi', {
    baseUrl: 'https://pi.example/v1', apiKey: 'sk-pi', models: [{ id: 'p-1' }],
  }))
  assert.equal(profile.blockedCode, BLOCKED.UNSUPPORTED_PI_API)
  assert.equal(profile.blockedDetail, 'unknown')
})

test('pi blocked paths name their own codes', () => {
  const noKey = extractProfile(row('pi', { baseUrl: 'https://p.example', api: 'openai-completions' }))
  assert.equal(noKey.blockedCode, BLOCKED.MISSING_PI_KEY)
  const noUrl = extractProfile(row('pi', { apiKey: 'sk-k', api: 'openai-completions' }))
  assert.equal(noUrl.blockedCode, BLOCKED.MISSING_PI_BASE_URL)
})

test('pi with no models falls back to a default id', () => {
  const profile = extractProfile(row('pi', {
    baseUrl: 'https://p.example', api: 'openai-completions', apiKey: 'sk-k',
  }))
  assert.deepEqual(profile.models, [{ id: 'gpt-4o' }])
  assert.match(profile.warnings.join('\n'), /gpt-4o/)
})

// --- mcode -----------------------------------------------------------------

test('mcode reads options.baseURL / options.apiKey with a top-level api', () => {
  const profile = extractProfile(row('mcode', {
    name: 'MCode',
    kind: 'custom',
    enabled: true,
    api: 'openai-completions',
    options: { baseURL: 'https://mcode.example/v1', apiKey: 'sk-mcode', headers: { 'x-a': 'b' } },
    models: { 'm-1': { name: 'MCode One' }, 'm-2': {} },
  }))
  assert.equal(profile.blocked, false)
  assert.equal(profile.api, 'openai-completions')
  assert.equal(profile.baseURL, 'https://mcode.example/v1')
  assert.equal(profile.apiKey, 'sk-mcode')
  assert.deepEqual(profile.models, [{ id: 'm-1', name: 'MCode One' }, { id: 'm-2' }])
})

test('mcode needs no npm adapter field, unlike opencode', () => {
  const profile = extractProfile(row('mcode', {
    api: 'openai-completions',
    options: { baseURL: 'https://mcode.example/v1', apiKey: 'sk-mcode' },
    models: { 'm-1': {} },
  }))
  assert.equal(profile.blocked, false)
})

test('mcode blocks an api outside the three DSH protocols', () => {
  const bad = extractProfile(row('mcode', {
    api: 'minimax-native',
    options: { baseURL: 'https://mcode.example/v1', apiKey: 'sk-mcode' },
    models: { 'm-1': {} },
  }))
  assert.equal(bad.blocked, true)
  assert.equal(bad.blockedCode, BLOCKED.UNSUPPORTED_MCODE_API)
  assert.equal(bad.blockedDetail, 'minimax-native')

  const missing = extractProfile(row('mcode', {
    options: { baseURL: 'https://mcode.example/v1', apiKey: 'sk-mcode' },
    models: { 'm-1': {} },
  }))
  assert.equal(missing.blockedCode, BLOCKED.UNSUPPORTED_MCODE_API)
})

test('mcode blocked paths name their own codes', () => {
  const noKey = extractProfile(row('mcode', { api: 'openai-completions', options: { baseURL: 'https://m.example' } }))
  assert.equal(noKey.blockedCode, BLOCKED.MISSING_MCODE_KEY)
  const noUrl = extractProfile(row('mcode', { api: 'openai-completions', options: { apiKey: 'sk-k' } }))
  assert.equal(noUrl.blockedCode, BLOCKED.MISSING_MCODE_BASE_URL)
})

test('mcode with no models falls back to a default id', () => {
  const profile = extractProfile(row('mcode', {
    api: 'openai-completions', options: { baseURL: 'https://m.example', apiKey: 'sk-k' },
  }))
  assert.deepEqual(profile.models, [{ id: 'gpt-4o' }])
  assert.match(profile.warnings.join('\n'), /gpt-4o/)
})

// --- openclaw --------------------------------------------------------------

test('openclaw reads its flat carrier and passes a valid api through', () => {
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) {
    const profile = extractProfile(row('openclaw', {
      baseUrl: 'https://claw.example/v1',
      apiKey: 'sk-claw',
      api,
      models: [{ id: 'c-1', name: 'Claw One' }, { id: 'c-2' }],
    }))
    assert.equal(profile.blocked, false, `${api} should import`)
    assert.equal(profile.api, api)
    assert.equal(profile.baseURL, 'https://claw.example/v1')
    assert.equal(profile.apiKey, 'sk-claw')
    assert.deepEqual(profile.models, [{ id: 'c-1', name: 'Claw One' }, { id: 'c-2' }])
  }
})

test('openclaw blocks an api outside the three DSH protocols', () => {
  const profile = extractProfile(row('openclaw', {
    baseUrl: 'https://claw.example/v1', apiKey: 'sk-claw', api: 'acp', models: [{ id: 'c-1' }],
  }))
  assert.equal(profile.blocked, true)
  assert.equal(profile.blockedCode, BLOCKED.UNSUPPORTED_OPENCLAW_API)
  assert.equal(profile.blockedDetail, 'acp')
})

test('openclaw blocked paths name their own codes', () => {
  const noKey = extractProfile(row('openclaw', { baseUrl: 'https://c.example', api: 'openai-completions' }))
  assert.equal(noKey.blockedCode, BLOCKED.MISSING_OPENCLAW_KEY)
  const noUrl = extractProfile(row('openclaw', { apiKey: 'sk-k', api: 'openai-completions' }))
  assert.equal(noUrl.blockedCode, BLOCKED.MISSING_OPENCLAW_BASE_URL)
})

test('openclaw with no models falls back to a default id', () => {
  const profile = extractProfile(row('openclaw', {
    baseUrl: 'https://c.example', apiKey: 'sk-k', api: 'openai-completions',
  }))
  assert.deepEqual(profile.models, [{ id: 'gpt-4o' }])
  assert.match(profile.warnings.join('\n'), /gpt-4o/)
})

// --- the new codes are real, translatable, and always paired with prose ----

const NEW_CODES = [
  BLOCKED.UNSUPPORTED_GEMINI_PROTOCOL,
  BLOCKED.MISSING_CLAUDE_DESKTOP_KEY,
  BLOCKED.MISSING_CLAUDE_DESKTOP_BASE_URL,
  BLOCKED.MISSING_HERMES_KEY,
  BLOCKED.MISSING_HERMES_BASE_URL,
  BLOCKED.MISSING_PI_KEY,
  BLOCKED.MISSING_PI_BASE_URL,
  BLOCKED.UNSUPPORTED_PI_API,
  BLOCKED.MISSING_MCODE_KEY,
  BLOCKED.MISSING_MCODE_BASE_URL,
  BLOCKED.UNSUPPORTED_MCODE_API,
  BLOCKED.MISSING_OPENCLAW_KEY,
  BLOCKED.MISSING_OPENCLAW_BASE_URL,
  BLOCKED.UNSUPPORTED_OPENCLAW_API,
]

test('every new code is registered in BLOCKED and translatable in both locales', () => {
  for (const code of NEW_CODES) {
    assert.ok(BLOCKED_CODES.has(code), `${code} is not in BLOCKED`)
    for (const locale of ['zh', 'en']) {
      const key = `importer.blocked.${code}`
      assert.ok(Object.hasOwn(MESSAGES[locale], key), `${locale} is missing ${key}`)
      assert.ok(MESSAGES[locale][key].length > 0, `${locale}.${key} is empty`)
    }
  }
})

test('every blocked row from the new app types carries prose and a detail-free code', () => {
  const blockedRows = [
    row('gemini', { env: { GEMINI_API_KEY: 'k', GOOGLE_GEMINI_BASE_URL: 'https://g.example' } }),
    row('claude-desktop', { baseUrl: 'https://x.example', env: {} }),
    row('hermes', { base_url: 'https://h.example' }),
    row('pi', { baseUrl: 'https://p.example', api: 'nope', apiKey: 'sk-k' }),
    row('mcode', { api: 'nope', options: { baseURL: 'https://m.example', apiKey: 'sk-k' } }),
    row('openclaw', { baseUrl: 'https://c.example', api: 'nope', apiKey: 'sk-k' }),
    row('grokbuild', { config: 'model = "m"\n' }),
  ]
  for (const blockedRow of blockedRows) {
    const profile = extractProfile(blockedRow)
    assert.equal(profile.blocked, true, `${blockedRow.app_type} should be blocked`)
    assert.ok(BLOCKED_CODES.has(profile.blockedCode), `${blockedRow.app_type}: ${profile.blockedCode} is unknown`)
    assert.ok(typeof profile.blockedReason === 'string' && profile.blockedReason.length > 0, `${blockedRow.app_type}: no prose reason`)
  }
})
