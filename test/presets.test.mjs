// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
//
// The preset catalogue is data, and data drifts: an endpoint gets a new
// sub-path, a model id is retired, someone transcribes a URL from a marketing
// page instead of the source. These tests pin the properties that make an
// entry *usable* in this plugin at all, plus a few values checked against
// CC Switch 4.0.4's own preset sources so a well-meaning edit cannot quietly
// change what a preset points at.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PROVIDER_PRESETS, presetByKey, providerFromPreset } from '../src/domain/presets.mjs'
import { CCS_API_PROTOCOLS, validateCCSProvider, normalizeCCSProvider } from '../src/domain/ccs-provider.mjs'

const PROTOCOLS = new Set(CCS_API_PROTOCOLS)

test('the catalogue is non-empty and keys are unique', () => {
  assert.ok(PROVIDER_PRESETS.length >= 10, `only ${PROVIDER_PRESETS.length} presets`)
  const keys = PROVIDER_PRESETS.map((preset) => preset.key)
  assert.equal(new Set(keys).size, keys.length, 'duplicate preset key')
})

test('every preset is immediately usable in this plugin', () => {
  for (const preset of PROVIDER_PRESETS) {
    const label = preset.key
    assert.equal(typeof preset.displayName, 'string', `${label}: displayName`)
    assert.ok(preset.displayName.length > 0, `${label}: empty displayName`)
    // Only the three protocols DSH can serve. A preset offering anything else
    // would produce a provider that registers and can never answer.
    assert.ok(PROTOCOLS.has(preset.api), `${label}: api "${preset.api}" is not servable`)
    assert.doesNotThrow(() => new URL(preset.baseURL), `${label}: baseURL "${preset.baseURL}" is not a URL`)
    assert.ok(Array.isArray(preset.models) && preset.models.length > 0, `${label}: no models`)
    for (const model of preset.models) {
      assert.equal(typeof model, 'string', `${label}: model id must be a string`)
      assert.ok(model.trim().length > 0, `${label}: blank model id`)
    }
  }
})

test('a preset never carries a credential reference', () => {
  // `apiKeyEnv` names a stored secret. A preset that shipped one would let two
  // providers address the same credential record, so importing the second
  // would silently repoint the first at a different key.
  const provider = providerFromPreset(PROVIDER_PRESETS[0])
  assert.equal(Object.hasOwn(provider, 'apiKeyEnv'), false)
  assert.equal(Object.hasOwn(provider, 'isCurrent'), false, 'a preset is not active by merely existing')
  assert.equal(Object.hasOwn(provider, 'inFailoverQueue'), false)
})

test('providerFromPreset produces a provider the schema accepts', () => {
  // The preset feeds the save path, so anything it produces has to pass the
  // same validation a hand-typed provider does. `apiKeyEnv` is filled in by
  // the save route, which is why the check is run after normalisation.
  for (const preset of PROVIDER_PRESETS) {
    const provider = normalizeCCSProvider({
      ...providerFromPreset(preset),
      apiKeyEnv: 'DSH_CCSWITCH_DEADBEEF_API_KEY',
    })
    const check = validateCCSProvider(provider)
    assert.equal(check.ok, true, `${preset.key}: ${check.ok ? '' : check.message}`)
  }
})

test('model ids carry no CC Switch display decoration', () => {
  // CC Switch annotates some ids for its own UI, e.g. "MiniMax-M3[1M]". The
  // bracketed part is not part of the model id the endpoint accepts, so a
  // preset that kept it would import a model that 404s on first use.
  for (const preset of PROVIDER_PRESETS) {
    for (const model of preset.models) {
      assert.doesNotMatch(model, /[[\]]/, `${preset.key}: model "${model}" carries a decoration`)
    }
  }
})

test('presetByKey finds a known entry and refuses an unknown one', () => {
  const found = presetByKey(PROVIDER_PRESETS[0].key)
  assert.equal(found, PROVIDER_PRESETS[0])
  assert.equal(presetByKey('no-such-preset'), undefined)
})

// --- values transcribed from CC Switch 4.0.4 ------------------------------
//
// These are the entries most likely to be edited by hand, and each one is a
// place where the obvious guess is wrong: DeepSeek serves Anthropic's protocol
// from an `/anthropic` sub-path while its OpenAI-compatible endpoint is the
// bare host, and the Codex-side preset appends `/v1` to that same bare host.
// Pinning them means a future edit that "tidies" a URL fails here first.

test('DeepSeek keeps its distinct Claude and Codex endpoints', () => {
  const claude = PROVIDER_PRESETS.find((preset) => preset.appType === 'claude' && preset.displayName === 'DeepSeek')
  assert.ok(claude, 'the DeepSeek claude preset is missing')
  assert.equal(claude.baseURL, 'https://api.deepseek.com/anthropic')
  assert.equal(claude.api, 'anthropic-messages')
  assert.deepEqual(claude.models, ['deepseek-flash', 'deepseek-v4-pro'])
  assert.equal(claude.icon, 'deepseek')
  assert.equal(claude.iconColor, '#1E88E5')

  const codex = PROVIDER_PRESETS.find((preset) => preset.appType === 'codex' && preset.displayName.startsWith('DeepSeek'))
  if (codex !== undefined) {
    assert.equal(codex.baseURL, 'https://api.deepseek.com/v1')
    assert.equal(codex.api, 'openai-responses')
  }
})

test('the Claude-side presets speak the Anthropic protocol', () => {
  for (const preset of PROVIDER_PRESETS.filter((entry) => entry.appType === 'claude')) {
    assert.equal(preset.api, 'anthropic-messages', `${preset.key} would not authenticate as Anthropic`)
  }
})

test('the Codex-side presets speak the Responses protocol', () => {
  // CC Switch writes `wire_api = "responses"` for these; anything else would
  // talk Chat Completions at an endpoint that only accepts Responses.
  for (const preset of PROVIDER_PRESETS.filter((entry) => entry.appType === 'codex')) {
    assert.equal(preset.api, 'openai-responses', `${preset.key} would not match its wire_api`)
  }
})
