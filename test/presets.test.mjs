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
import {
  CCS_PROVIDER_CATEGORIES,
  PRESET_GROUP_ORDER,
  PRESET_PLAN_KEYS,
  PRESET_REGION_KEYS,
  PROVIDER_PRESETS,
  groupPresetsByCategory,
  presetByKey,
  presetGroup,
  presetVersionKeys,
  providerFromPreset,
} from '../src/domain/presets.mjs'
import { CCS_API_PROTOCOLS, validateCCSProvider, normalizeCCSProvider } from '../src/domain/ccs-provider.mjs'

const PROTOCOLS = new Set(CCS_API_PROTOCOLS)

test('the catalogue is non-empty and keys are unique', () => {
  assert.ok(PROVIDER_PRESETS.length >= 10, `only ${PROVIDER_PRESETS.length} presets`)
  const keys = PROVIDER_PRESETS.map((preset) => preset.key)
  assert.equal(new Set(keys).size, keys.length, 'duplicate preset key')
})

test('no two presets render the same label in the picker', () => {
  // cc-switch can give the Claude and Codex halves of a vendor the same name,
  // because its picker is scoped to one app at a time. This plugin renders one
  // flat list, so a repeated name is two options the user cannot tell apart —
  // and they need telling apart, since the two write different config files.
  // The convention that avoids it, inherited from the hand-written block, is a
  // " (Codex)" suffix on the Codex side.
  const byName = new Map()
  for (const preset of PROVIDER_PRESETS) {
    byName.set(preset.displayName, [...(byName.get(preset.displayName) ?? []), preset])
  }
  const collisions = [...byName]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => `${name} (${list.map((preset) => preset.key).join(', ')})`)
  assert.deepEqual(collisions, [], `presets share a display name: ${collisions.join('; ')}`)
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

  // Looked up by key, not by display name: every Codex-side entry carries a
  // " (Codex)" suffix so one flat picker list cannot show "DeepSeek" twice, and
  // a name-based lookup would silently start failing the moment that convention
  // changed.
  const codex = presetByKey('deepseek-codex')
  assert.ok(codex, 'the DeepSeek codex preset is missing')
  assert.equal(codex.displayName, 'DeepSeek (Codex)')
  // The Codex half points at the bare host, not at `/v1`. cc-switch 4.0.6 writes
  // `base_url = "https://api.deepseek.com"` with `wire_api = "responses"`, and its
  // own comment records that DeepSeek serves Responses natively from that base.
  // This assertion used to be dead code — no Codex-side DeepSeek preset existed,
  // so the `if` never ran — which is how the `/v1` spelling stayed unverified.
  assert.equal(codex.baseURL, 'https://api.deepseek.com')
  assert.equal(codex.api, 'openai-responses')
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

// --- the CC Switch category / family / plan / region model ------------------
//
// CC Switch's Rust side types `category` as a free-form `Option<String>`, but
// its frontend constrains it to exactly eight values (`src/types.ts`) and maps
// them onto the five sections the "add provider" list is grouped into
// (`src/components/providers/forms/presetGroups.ts`). Both are transcribed
// here, and both are asserted, because a category that drifts stops the picker
// from grouping rather than failing loudly.

test('the category vocabulary is exactly the eight CC Switch declares', () => {
  assert.deepEqual([...CCS_PROVIDER_CATEGORIES], [
    'official',
    'cn_official',
    'cloud_provider',
    'aggregator',
    'third_party',
    'custom',
    'omo',
    'omo-slim',
  ])
})

test('every preset carries a category from that vocabulary', () => {
  // A typo would not throw — `presetGroup` falls through to `thirdparty` — so
  // the value is checked against the list rather than only its presence.
  const known = new Set(CCS_PROVIDER_CATEGORIES)
  for (const preset of PROVIDER_PRESETS) {
    assert.ok(known.has(preset.category), `${preset.key}: category "${preset.category}" is not one of the eight`)
  }
})

test('presetGroup reproduces presetGroups.ts', () => {
  const group = (category) => presetGroup({ category })
  // `official` is the account-sign-in section; the other two CC Switch sends
  // there (`requiresOAuth`, `providerType`) have no entry in this catalogue —
  // every preset here authenticates with an API key.
  assert.equal(group('official'), 'login')
  assert.equal(group('cn_official'), 'vendor')
  assert.equal(group('cloud_provider'), 'cloud')
  assert.equal(group('omo'), 'plugin')
  assert.equal(group('omo-slim'), 'plugin')
  // `third_party`, `aggregator`, `custom` and anything unrecognised all land in
  // the third-party section, which is CC Switch's own `default` case.
  assert.equal(group('third_party'), 'thirdparty')
  assert.equal(group('aggregator'), 'thirdparty')
  assert.equal(group('custom'), 'thirdparty')
  assert.equal(group(undefined), 'thirdparty', 'a preset with no category still groups')
})

test('presetVersionKeys names the plan before the region', () => {
  // CC Switch's `presetVersionLabel` joins plan then region with " · ", so the
  // order is part of the contract rather than an accident of this catalogue.
  assert.deepEqual(presetVersionKeys({ planKey: 'payg', regionKey: 'cn' }), ['manager.plan.payg', 'manager.region.cn'])
  assert.deepEqual(presetVersionKeys({ planKey: 'coding' }), ['manager.plan.coding'])
  assert.deepEqual(presetVersionKeys({ regionKey: 'intl' }), ['manager.region.intl'])
  // Neither dimension: no suffix. Every such preset here is the only one for
  // its vendor, so there is no sibling to be told apart from.
  assert.deepEqual(presetVersionKeys({}), [])
  assert.deepEqual(presetVersionKeys(undefined), [])
  // An empty string is absence, not a dimension worth labelling.
  assert.deepEqual(presetVersionKeys({ planKey: '', regionKey: '' }), [])
})

test('groupPresetsByCategory sections the catalogue in CC Switch order', () => {
  const sections = groupPresetsByCategory(PROVIDER_PRESETS)
  const order = sections.map((section) => section.group)
  // `PRESET_GROUP_ORDER` is a fixed display order, and the sections that come
  // back keep it rather than the catalogue's own order.
  assert.deepEqual(order, [...PRESET_GROUP_ORDER].filter((group) => order.includes(group)))
  // Empty sections are dropped: a heading with nothing under it is worse than
  // no heading.
  assert.ok(sections.every((section) => section.presets.length > 0))
  // Every preset appears exactly once.
  const seen = sections.flatMap((section) => section.presets.map((preset) => preset.key))
  assert.equal(seen.length, PROVIDER_PRESETS.length)
  assert.equal(new Set(seen).size, PROVIDER_PRESETS.length)
})

test('groupPresetsByCategory tolerates an empty or malformed catalogue', () => {
  assert.deepEqual(groupPresetsByCategory([]), [])
  assert.deepEqual(groupPresetsByCategory(undefined), [])
})

// --- the CC Switch fields transcribed onto each preset ----------------------

test('every preset declares a category, and the vendors declare their family', () => {
  for (const preset of PROVIDER_PRESETS) {
    const label = preset.key
    assert.ok(CCS_PROVIDER_CATEGORIES.includes(preset.category), `${label}: category`)
    // A family with a single version is deliberately absent: CC Switch only
    // tags a vendor when that app really serves several versions of it, because
    // the tag is what merges them into one row.
    if (preset.family !== undefined) {
      assert.equal(typeof preset.family, 'string', `${label}: family must be a string`)
      assert.ok(preset.family.length > 0, `${label}: empty family`)
    }
    if (preset.planKey !== undefined) {
      assert.ok(PRESET_PLAN_KEYS.includes(preset.planKey), `${label}: planKey "${preset.planKey}" is not a CC Switch plan`)
    }
    if (preset.regionKey !== undefined) {
      assert.ok(PRESET_REGION_KEYS.includes(preset.regionKey), `${label}: regionKey "${preset.regionKey}" is not a CC Switch region`)
    }
  }
})

test('the vendors CC Switch shares across apps carry the same family here', () => {
  // The family is what tells the picker two presets are versions of one vendor.
  // If the Claude and Codex halves of a vendor disagreed, they would render as
  // two unrelated rows — the exact thing the family exists to prevent.
  const byFamily = new Map()
  for (const preset of PROVIDER_PRESETS) {
    if (preset.family === undefined) continue
    byFamily.set(preset.family, [...(byFamily.get(preset.family) ?? []), preset])
  }
  assert.ok(byFamily.size > 0, 'no preset declares a family at all')
  for (const [family, presets] of byFamily) {
    // A family that merged only one preset would be a tag with no effect, which
    // means the transcription is wrong rather than merely redundant.
    assert.ok(presets.length > 1, `family "${family}" groups only ${presets[0].key}`)
    // A family is deliberately NOT required to agree on a category. cc-switch's
    // own `presetFamilies.ts` says the family is "只是显示用的分组，不影响请求和
    // category", and its OpenCode entry uses one family across `third_party` (Go)
    // and `aggregator` (Zen). Asserting agreement would fail on cc-switch's real
    // data, so the family is checked for grouping only.
  }
})

test('the version fields match the CC Switch presets they were read from', () => {
  // Spot checks against `src/config/claudeProviderPresets.ts` and
  // `codexProviderPresets.ts`. These are the entries whose family, plan or
  // region is most likely to be "tidied" by a later edit, and getting one wrong
  // silently merges or splits a row in the picker.
  const claudeKimi = presetByKey('kimi-claude')
  assert.equal(claudeKimi.family, 'kimi')
  assert.equal(claudeKimi.planKey, 'payg')
  assert.equal(claudeKimi.regionKey, 'cn')
  assert.equal(claudeKimi.category, 'cn_official')

  // The Codex half of the same vendor carries the same family, so the two
  // merge — but a different plan, because CC Switch's Codex list serves the
  // pay-as-you-go endpoint where its Claude list serves the coding one.
  const codexKimi = presetByKey('kimi-codex')
  assert.equal(codexKimi.family, 'kimi')

  // StepFun differs between the two apps: the Codex preset is the `stepPlan`
  // tier while the Claude one is the vendor default, so only the Codex half
  // carries a planKey.
  assert.equal(presetByKey('stepfun-codex').planKey, 'stepPlan')
  assert.equal(presetByKey('stepfun-claude').planKey, undefined)
  assert.equal(presetByKey('stepfun-claude').family, 'stepfun')
  assert.equal(presetByKey('stepfun-codex').family, 'stepfun')

  // Volcengine is the vendor CC Switch files as three plans; only one of them
  // is transcribed here, and it is the pay-as-you-go one.
  const doubao = presetByKey('volcengine-doubao-claude')
  assert.equal(doubao.family, 'volcengine')
  assert.equal(doubao.planKey, 'payg')
  // CC Switch marks it a partner; the flag is carried so the picker can say so.
  assert.equal(doubao.isPartner, true)

  // A vendor with a single version carries no family at all.
  assert.equal(presetByKey('deepseek-claude').family, undefined)
  assert.equal(presetByKey('deepseek-claude').category, 'cn_official')
})
