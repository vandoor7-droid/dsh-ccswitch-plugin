// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
//
// The schema module takes `z` as an argument so these tests can run without a
// DSH runtime. A minimal stand-in is used rather than the real schemastery:
// the repo's transitive copy is 3.18.1, which predates `.volatile()` entirely,
// and the only build that implements it (DSH's own 3.18.4) is not a dependency
// here. What is worth testing is the shape this module asks for and the
// normalisation it does, neither of which depends on schemastery's internals.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CCS_API_PROTOCOLS,
  CCS_REASONING_LEVELS,
  activateCCSProvider,
  defineCCSConfig,
  defineCCSProvider,
  emptyCCSProvider,
  normalizeBaseUrl,
  normalizeCCSProvider,
  validateCCSProvider,
} from '../src/domain/ccs-provider.mjs'

/**
 * A recording stand-in for schemastery. Every builder returns the same node
 * shape so a test can walk the schema and assert what was declared, including
 * which node carries `.volatile()`.
 */
function fakeZ() {
  const node = (type, extra = {}) => {
    const schema = {
      type,
      dict: undefined,
      inner: undefined,
      list: undefined,
      meta: { ...(extra.meta ?? {}) },
      calls: [],
      // The real builder returns a live schema; these record instead.
      required(required = true) { schema.calls.push(['required', required]); return schema },
      default(value) { schema.calls.push(['default', value]); return schema },
      role(role) { schema.calls.push(['role', role]); return schema },
      min(value) { schema.calls.push(['min', value]); return schema },
      max(value) { schema.calls.push(['max', value]); return schema },
      step(value) { schema.calls.push(['step', value]); return schema },
      volatile() { schema.calls.push(['volatile']); schema.meta.volatile = true; return schema },
      ...extra,
    }
    return schema
  }
  const z = {
    string: () => node('string'),
    number: () => node('number'),
    boolean: () => node('boolean'),
    const: (value) => node('const', { value }),
    array: (inner) => node('array', { inner }),
    dict: (inner) => node('dict', { inner }),
    union: (list) => node('union', { list: [...(list ?? [])] }),
    object: (dict) => node('object', { dict }),
  }
  return z
}

test('the provider schema declares exactly the CC Switch fields', () => {
  const schema = defineCCSProvider(fakeZ())
  assert.equal(schema.type, 'object')
  assert.deepEqual(Object.keys(schema.dict).sort(), [
    'api',
    'apiKeyEnv',
    'appType',
    'baseURL',
    'costMultiplier',
    'displayName',
    'icon',
    'iconColor',
    'inFailoverQueue',
    'isCurrent',
    'limitDailyUsd',
    'limitMonthlyUsd',
    'models',
    'notes',
    'sourceProfileId',
  ])
  // The three booleans/numbers that a form toggles carry a default so an
  // untouched new provider still round-trips through the settings document.
  assert.ok(schema.dict.isCurrent.calls.some(([name, value]) => name === 'default' && value === false))
  assert.ok(schema.dict.inFailoverQueue.calls.some(([name, value]) => name === 'default' && value === false))
  assert.ok(schema.dict.models.calls.some(([name, value]) => name === 'default'))
})

test('apiKeyEnv is marked as a credential reference, never a literal key', () => {
  // Same role llm-pi-ai puts on its own `apiKeyEnv`: the settings document is
  // stored in plaintext YAML, so it must name a credential record rather than
  // hold key material. Nothing here may become an inline secret.
  const schema = defineCCSProvider(fakeZ())
  assert.ok(schema.dict.apiKeyEnv.calls.some(([name, value]) => name === 'role' && value === 'credential-ref'))
})

test('the api union offers exactly the three protocols llm-pi-ai can serve', () => {
  const schema = defineCCSProvider(fakeZ())
  assert.equal(schema.dict.api.type, 'union')
  assert.deepEqual(schema.dict.api.list, [...CCS_API_PROTOCOLS])
  assert.deepEqual([...CCS_API_PROTOCOLS], ['openai-completions', 'openai-responses', 'anthropic-messages'])
})

test('providers is the volatile node, and the root is not', () => {
  // This is the whole mechanism: describe() skips a namespace whose form comes
  // back empty, and only a volatile field survives that filter. Marking the
  // root instead would expose the dict itself as a single field.
  const schema = defineCCSConfig(fakeZ())
  assert.equal(schema.type, 'object')
  assert.deepEqual(Object.keys(schema.dict), ['providers'])
  assert.equal(schema.dict.providers.type, 'dict')
  assert.equal(schema.dict.providers.meta.volatile, true)
  assert.equal(schema.meta.volatile, undefined)
  assert.ok(schema.dict.providers.calls.some(([name, value]) => name === 'default' && typeof value === 'object'))
  // And the value type really is the provider schema.
  assert.deepEqual(Object.keys(schema.dict.providers.inner.dict).includes('apiKeyEnv'), true)
})

test('normalizing trims, drops unknown fields, and de-duplicates models', () => {
  const provider = normalizeCCSProvider({
    displayName: '  DeepSeek  ',
    api: 'openai-completions',
    baseURL: 'https://api.deepseek.com/v1/',
    apiKeyEnv: 'DSH_CCSWITCH_ABCD1234_API_KEY',
    notes: '   ',
    isCurrent: 'yes',
    inFailoverQueue: true,
    costMultiplier: '1.5',
    limitDailyUsd: -1,
    somethingElse: 'dropped',
    models: [
      { id: 'deepseek-chat', name: 'Chat', contextWindow: '64000' },
      { id: 'deepseek-chat', name: 'duplicate' },
      'deepseek-reasoner',
      { name: 'no id' },
    ],
  })
  assert.equal(provider.displayName, 'DeepSeek')
  assert.equal(provider.baseURL, 'https://api.deepseek.com/v1')
  assert.deepEqual(provider.models, [
    { id: 'deepseek-chat', name: 'Chat', contextWindow: 64000 },
    { id: 'deepseek-reasoner' },
  ])
  // Omitted rather than stored empty, so describe() does not report an edit.
  assert.equal(Object.hasOwn(provider, 'notes'), false)
  // A truthy non-boolean is not coerced: only a real `true` marks the flag.
  assert.equal(Object.hasOwn(provider, 'isCurrent'), false)
  assert.equal(provider.inFailoverQueue, true)
  assert.equal(provider.costMultiplier, 1.5)
  assert.equal(Object.hasOwn(provider, 'limitDailyUsd'), false)
  assert.equal(Object.hasOwn(provider, 'somethingElse'), false)
})

test('normalizing preserves a reasoningEfforts map and a false opt-out', () => {
  const off = normalizeCCSProvider({ models: [{ id: 'm', reasoningEfforts: false }] })
  assert.equal(off.models[0].reasoningEfforts, false)
  const efforts = { low: 'low', high: 'high', off: null }
  const on = normalizeCCSProvider({ models: [{ id: 'm', reasoningEfforts: efforts }] })
  assert.deepEqual(on.models[0].reasoningEfforts, efforts)
  assert.notEqual(on.models[0].reasoningEfforts, efforts)
})

test('normalizeBaseUrl only strips trailing slashes', () => {
  assert.equal(normalizeBaseUrl('https://x.test/v1/'), 'https://x.test/v1')
  assert.equal(normalizeBaseUrl('https://x.test/v1///'), 'https://x.test/v1')
  assert.equal(normalizeBaseUrl('https://x.test/'), 'https://x.test')
  assert.equal(normalizeBaseUrl(undefined), '')
})

test('a complete provider validates', () => {
  const provider = normalizeCCSProvider({
    displayName: 'DeepSeek',
    api: 'openai-completions',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DSH_CCSWITCH_ABCD1234_API_KEY',
    models: [{ id: 'deepseek-chat' }],
  })
  assert.deepEqual(validateCCSProvider(provider), { ok: true })
})

test('validation names the first unusable field', () => {
  const base = {
    displayName: 'X',
    api: 'openai-completions',
    baseURL: 'https://x.test',
    models: [{ id: 'm' }],
  }
  const cases = [
    [{ ...base, displayName: '' }, 'displayName is required'],
    [{ ...base, api: '' }, 'api is required'],
    [{ ...base, api: 'gemini-native' }, 'api "gemini-native" is not one of openai-completions, openai-responses, anthropic-messages'],
    [{ ...base, baseURL: '' }, 'baseURL is required'],
    [{ ...base, baseURL: 'not a url' }, 'baseURL "not a url" is not a URL'],
    [{ ...base, models: [] }, 'at least one model is required'],
    [{ ...base, models: [{ id: '' }] }, 'every model needs an id'],
    [{ ...base, models: [{ id: 'm', reasoningEfforts: 'high' }] }, 'model "m" reasoningEfforts must be false or an object'],
    [{ ...base, models: [{ id: 'm', reasoningEfforts: { turbo: 'x' } }] }, 'model "m" has an unknown reasoning level "turbo"'],
    [{ ...base, models: [{ id: 'm', reasoningEfforts: { high: 5 } }] }, 'model "m" level "high" must be a string or null'],
    [{ ...base, models: [{ id: 'm', reasoningEfforts: { high: null } }] }, 'model "m" level "high" needs a wire value'],
  ]
  for (const [provider, message] of cases) {
    assert.deepEqual(validateCCSProvider(provider), { ok: false, message }, message)
  }
  assert.deepEqual(validateCCSProvider(null), { ok: false, message: 'provider must be an object' })
})

test('reasoningEfforts accepts null only for the off level', () => {
  // `off: null` is how a provider says "send no reasoning field"; a level that
  // means something must spell out the wire value it maps to.
  const provider = (efforts) => ({
    displayName: 'X',
    api: 'openai-completions',
    baseURL: 'https://x.test',
    models: [{ id: 'm', reasoningEfforts: efforts }],
  })
  assert.deepEqual(validateCCSProvider(provider({ off: null })), { ok: true })
  assert.deepEqual(validateCCSProvider(provider({ high: 'high', off: null })), { ok: true })
  assert.equal(validateCCSProvider(provider({ high: null })).ok, false)
})

test('every reasoning level the schema names is one llm-pi-ai accepts', () => {
  assert.deepEqual([...CCS_REASONING_LEVELS], ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
})

test('emptyCCSProvider is a usable skeleton that overrides cleanly', () => {
  const skeleton = emptyCCSProvider()
  assert.deepEqual(skeleton.models, [])
  assert.equal(skeleton.isCurrent, false)
  assert.equal(skeleton.inFailoverQueue, false)
  assert.equal(skeleton.api, CCS_API_PROTOCOLS[0])
  const seeded = emptyCCSProvider({ displayName: 'X', api: 'anthropic-messages' })
  assert.equal(seeded.displayName, 'X')
  assert.equal(seeded.api, 'anthropic-messages')
  assert.equal(emptyCCSProvider().displayName, '', 'must not share state between calls')
})

test('activating one provider clears every other one', () => {
  const providers = {
    a: { displayName: 'A', isCurrent: true },
    b: { displayName: 'B', isCurrent: false },
    c: { displayName: 'C' },
  }
  const next = activateCCSProvider(providers, 'b')
  // CC Switch's is_current is a per-app singleton, so the write is the whole
  // catalogue rather than one field.
  assert.deepEqual(next, {
    a: { displayName: 'A', isCurrent: false },
    b: { displayName: 'B', isCurrent: true },
    c: { displayName: 'C', isCurrent: false },
  })
  assert.equal(providers.a.isCurrent, true, 'the input must not be mutated')
  assert.throws(() => activateCCSProvider(providers, 'missing'), /unknown provider: missing/)
})
