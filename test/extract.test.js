// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractProfile } from '../lib/core/extract.js'
import { BLOCKED } from '../lib/core/safety.js'

const toml = `model_provider = "custom"
model = "gpt-5.6-terra"
model_reasoning_effort = "xhigh"
[model_providers.custom]
name = "星渡"
base_url = "https://aiwtiaw.top"
wire_api = "responses"
`

test('extracts a full api-key profile', () => {
  const row = {
    id: '星渡-1786264467316',
    name: '星渡',
    is_current: 1,
    settings_config: JSON.stringify({
      auth: { OPENAI_API_KEY: 'sk-secret-value' },
      config: toml,
    }),
  }
  const profile = extractProfile(row)
  assert.equal(profile.profileId, '星渡-1786264467316')
  assert.equal(profile.profileName, '星渡')
  assert.equal(profile.baseURL, 'https://aiwtiaw.top')
  assert.equal(profile.api, 'openai-responses')
  assert.deepEqual(profile.models, [{ id: 'gpt-5.6-terra' }])
  assert.equal(profile.modelReasoningEffort, 'xhigh')
  assert.equal(profile.apiKey, 'sk-secret-value')
  assert.equal(profile.isCurrent, true)
  assert.deepEqual(profile.warnings, [])
  assert.deepEqual(profile.unsupported, [])
})

test('maps wire_api chat to openai-completions', () => {
  const row = {
    id: 'p1',
    name: 'P1',
    settings_config: JSON.stringify({
      auth: { OPENAI_API_KEY: 'k' },
      config: `model = "m"\n[model_providers.custom]\nname = "p"\nbase_url = "https://x/v1"\nwire_api = "chat"\n`,
    }),
  }
  assert.equal(extractProfile(row).api, 'openai-completions')
})

test('missing api key is reported, profile is blocked', () => {
  const row = {
    id: 'p2',
    name: 'P2',
    settings_config: JSON.stringify({ auth: {}, config: toml }),
  }
  const profile = extractProfile(row)
  assert.equal(profile.apiKey, undefined)
  assert.ok(profile.blocked)
  assert.match(profile.blockedReason, /API key/i)
})

test('malformed settings_config json yields a blocked profile', () => {
  const profile = extractProfile({ id: 'p3', name: 'P3', settings_config: '{broken' })
  assert.ok(profile.blocked)
  assert.match(profile.blockedReason, /settings_config/i)
})

test('no usable model_providers.custom section blocks the profile', () => {
  const row = {
    id: 'p4',
    name: 'P4',
    settings_config: JSON.stringify({ auth: { OPENAI_API_KEY: 'k' }, config: 'model = "m"\n' }),
  }
  const profile = extractProfile(row)
  assert.ok(profile.blocked)
  assert.match(profile.blockedReason, /model_providers/i)
})

test('codex-official and default are skipped outright', () => {
  const official = extractProfile({ id: 'codex-official', name: 'OpenAI Official', settings_config: '{}' })
  assert.equal(official.skipped, true)
  assert.match(official.skipReason, /official/i)
  const fallback = extractProfile({ id: 'default', name: 'default', settings_config: '{}' })
  assert.equal(fallback.skipped, true)
})

test('warns when requires_openai_auth is set', () => {
  const row = {
    id: 'p5',
    name: 'P5',
    settings_config: JSON.stringify({
      auth: { OPENAI_API_KEY: 'k' },
      config: `model = "m"\n[model_providers.custom]\nname = "p"\nbase_url = "https://x/v1"\nwire_api = "responses"\nrequires_openai_auth = true\n`,
    }),
  }
  const profile = extractProfile(row)
  assert.deepEqual(profile.warnings, ['provider 标记 requires_openai_auth，导入后可能仍无法通过 API key 认证'])
})

test('blocked profile never carries the api key', () => {
  const row = {
    id: 'p6',
    name: 'P6',
    settings_config: JSON.stringify({
      auth: { OPENAI_API_KEY: 'sk-secret-value' },
      config: 'model = "m"\n', // no [model_providers.custom] section
    }),
  }
  const profile = extractProfile(row)
  assert.ok(profile.blocked)
  assert.equal(profile.apiKey, undefined)
})

test('plain claude rows stay on the env-only path', () => {
  const row = {
    id: 'c-1',
    name: 'C1',
    app_type: 'claude',
    settings_config: JSON.stringify({
      env: { ANTHROPIC_AUTH_TOKEN: 'sk-token', ANTHROPIC_BASE_URL: 'https://c.example' },
    }),
  }
  const profile = extractProfile(row)
  assert.equal(profile.blocked, false)
  assert.equal(profile.baseURL, 'https://c.example')
  assert.equal(profile.api, 'anthropic-messages')
})

test('a claude row is not read through the claude-desktop top-level baseUrl', () => {
  // The top-level `baseUrl` carrier belongs to claude-desktop. A plain claude
  // row that happens to carry one must still be reported as missing its base
  // URL rather than silently importing a field its app type never writes.
  const row = {
    id: 'c-2',
    name: 'C2',
    app_type: 'claude',
    settings_config: JSON.stringify({
      baseUrl: 'https://top-level.example',
      env: { ANTHROPIC_AUTH_TOKEN: 'sk-token' },
    }),
  }
  const profile = extractProfile(row)
  assert.equal(profile.blocked, true)
  assert.equal(profile.blockedCode, BLOCKED.MISSING_ANTHROPIC_BASE_URL)
})

test('an unknown app type is blocked with the type as detail', () => {
  const profile = extractProfile({ id: 'u-1', name: 'U', app_type: 'cursor', settings_config: '{}' })
  assert.equal(profile.blocked, true)
  assert.equal(profile.blockedCode, BLOCKED.UNSUPPORTED_APP_TYPE)
  assert.equal(profile.blockedDetail, 'cursor')
})
