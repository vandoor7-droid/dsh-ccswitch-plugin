// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import test from 'node:test'
import assert from 'node:assert/strict'
import { extractProfile } from '../lib/core/extract.js'
import { toProviderProfile } from '../lib/core/mapper.js'
import { catalogFieldsFor, isThinkingModel, isKnownModel } from '../src/domain/model-catalog.mjs'
import { probeModels } from '../lib/core/probe.js'
import { scanProfiles } from '../lib/core/scan.js'

test('opencode rows map to openai-completions with full model list', () => {
  const row = {
    id: 'justwoker-oc', name: 'JustWoker', app_type: 'opencode', is_current: 0,
    settings_config: JSON.stringify({
      npm: '@ai-sdk/openai-compatible',
      options: { baseURL: 'https://api.justwoker.icu/v1', apiKey: 'sk-TESTKEY12345678' },
      models: { 'claude-opus-5-thinking': { name: 'Claude Opus 5 Thinking' }, 'gpt-x': {} },
    }),
  }
  const profile = extractProfile(row)
  assert.equal(profile.blocked, false)
  assert.equal(profile.api, 'openai-completions')
  assert.equal(profile.baseURL, 'https://api.justwoker.icu/v1')
  assert.deepEqual(profile.models.map((m) => m.id), ['claude-opus-5-thinking', 'gpt-x'])
  assert.equal(profile.models[0].name, 'Claude Opus 5 Thinking')
})

test('opencode rows with unknown npm adapter are blocked with a reason', () => {
  const profile = extractProfile({
    id: 'x', name: 'X', app_type: 'opencode',
    settings_config: JSON.stringify({ npm: '@ai-sdk/anthropic', options: { baseURL: 'https://x', apiKey: 'sk-TESTKEY12345678' }, models: {} }),
  })
  assert.equal(profile.blocked, true)
  assert.match(profile.blockedReason, /@ai-sdk\/anthropic/)
})

test('unsupported app types still blocked', () => {
  const profile = extractProfile({ id: 'g', name: 'G', app_type: 'gemini', settings_config: '{"env":{},"config":{}}' })
  assert.equal(profile.blocked, true)
})

test('anthropic thinking models get forceAdaptiveThinking compat on import', () => {
  const profile = {
    profileId: 'c', profileName: 'C', baseURL: 'https://x/v1', api: 'anthropic-messages',
    apiKey: 'sk-TESTKEY12345678',
    models: [{ id: 'claude-opus-5-thinking' }, { id: 'claude-sonnet-4-5' }],
  }
  const mapped = toProviderProfile(profile, undefined, 'ccs-c')
  assert.equal(mapped.models[0].compat.forceAdaptiveThinking, true)
  assert.equal(mapped.models[1].compat, undefined)
})

test('model catalog fills contextWindow/input only when missing', () => {
  assert.equal(isKnownModel('claude-sonnet-4-5'), true)
  const exact = catalogFieldsFor('claude-sonnet-4-5')
  assert.equal(exact.contextWindow, 204800)
  assert.deepEqual(exact.input, ['text', 'image'])
  // family fallback for relay-only ids
  const fallback = catalogFieldsFor('gpt-6.1-sol')
  assert.ok(fallback.contextWindow > 0)
  // unknown ids get the conservative default
  const unknown = catalogFieldsFor('totally-unknown-model')
  assert.equal(unknown.contextWindow, 131072)
  assert.deepEqual(unknown.input, ['text'])
  assert.equal(isThinkingModel('deepseek-reasoner'), true)
  assert.equal(isThinkingModel('o3'), true)
  assert.equal(isThinkingModel('gpt-4o'), false)
})

test('probeModels merges discovered ids and degrades on failure', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers })
    if (String(url).includes('good')) {
      return { ok: true, json: async () => ({ data: [{ id: 'model-a' }, { id: 'claude-sonnet-4-5' }] }) }
    }
    throw new Error('network down')
  }
  try {
    const good = await probeModels({
      profileId: 'g', baseURL: 'https://good.example/v1', api: 'openai-completions',
      apiKey: 'sk-TESTKEY12345678', models: [{ id: 'seed-model' }],
    })
    assert.equal(good.warnings.length, 1)
    assert.match(good.warnings[0], /新增 2/)
    assert.ok(good.profile.models.some((m) => m.id === 'model-a'))
    assert.ok(good.profile.models.some((m) => m.id === 'claude-sonnet-4-5' && m.name))
    // seed model preserved, no duplicates
    assert.equal(good.profile.models.filter((m) => m.id === 'seed-model').length, 1)

    const bad = await probeModels({
      profileId: 'b', baseURL: 'https://bad.example/v1', api: 'openai-completions',
      apiKey: 'sk-TESTKEY12345678', models: [{ id: 'seed-model' }],
    })
    assert.equal(bad.profile.models.length, 1)
    assert.match(bad.warnings[0], /网络错误/)
    // authorization header was sent (never logged, just verified present)
    assert.match(calls[0].headers.authorization, /^Bearer sk-/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('claude fallback model with thinking display name gets forceAdaptiveThinking', () => {
  const profile = extractProfile({
    id: 'jt', name: 'JustWoker · Claude Opus 5 Thinking', app_type: 'claude-desktop', is_current: 1,
    settings_config: JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://x/v1', ANTHROPIC_AUTH_TOKEN: 'sk-TESTKEY12345678' } }),
  })
  assert.equal(profile.models[0].id, 'claude-sonnet-4-5')
  assert.equal(profile.models[0].fallbackThinking, true)
  const mapped = toProviderProfile(profile, undefined, 'ccs-jt')
  assert.equal(mapped.models[0].compat.forceAdaptiveThinking, true)
  assert.equal(mapped.models[0].fallbackThinking, undefined)
  // non-thinking display name stays clean
  const plain = extractProfile({
    id: 'p2', name: 'Plain Claude', app_type: 'claude',
    settings_config: JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://y/v1', ANTHROPIC_API_KEY: 'sk-TESTKEY12345678' } }),
  })
  const plainMapped = toProviderProfile(plain, undefined, 'ccs-p2')
  assert.equal(plainMapped.models[0].compat, undefined)
})

test('existing compat does not shadow derived forceAdaptiveThinking', () => {
  const profile = extractProfile({
    id: 'jt2', name: 'JustWoker · Claude Opus 5 Thinking', app_type: 'claude-desktop', is_current: 1,
    settings_config: JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://x/v1', ANTHROPIC_AUTH_TOKEN: 'sk-TESTKEY12345678' } }),
  })
  const existing = {
    displayName: 'JustWoker · Claude Opus 5 Thinking', baseURL: 'https://x/v1', api: 'anthropic-messages',
    apiKeyEnv: 'DSH_CCSWITCH_JT2_API_KEY',
    models: [{ id: 'claude-sonnet-4-5', contextWindow: 204800, compat: { chatTemplateKwargs: {} }, reasoningEfforts: false }],
  }
  const mapped = toProviderProfile(profile, existing, 'ccs-jt2')
  assert.equal(mapped.models[0].compat.forceAdaptiveThinking, true)
  assert.equal(mapped.models[0].compat.chatTemplateKwargs !== undefined, true)
})

test('jsonEqual ignores key order from the YAML round-trip', async () => {
  const { jsonEqual } = await import('../lib/core/json-equal.js')
  const yamlShaped = {
    apiKeyEnv: 'K', displayName: 'D', api: 'anthropic-messages',
    models: [{ contextWindow: 204800, input: ['text', 'image'], id: 'claude-sonnet-4-5', compat: { forceAdaptiveThinking: true, chatTemplateKwargs: {} } }],
  }
  const mappedShaped = {
    displayName: 'D', api: 'anthropic-messages', apiKeyEnv: 'K',
    models: [{ id: 'claude-sonnet-4-5', contextWindow: 204800, compat: { chatTemplateKwargs: {}, forceAdaptiveThinking: true }, input: ['text', 'image'] }],
  }
  assert.equal(jsonEqual(yamlShaped, mappedShaped), true)
  assert.equal(jsonEqual(yamlShaped, { ...mappedShaped, models: [{ ...mappedShaped.models[0], contextWindow: 1 }] }), false)
})
