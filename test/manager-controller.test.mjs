// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
//
// The manager controller is where three failure modes would be invisible until
// the user hit them: a Host that answers with a shape nobody expected, a
// revision conflict that silently overwrites someone else's edit, and a
// rejected operation that leaves the table spinning forever. Each gets a test.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCCSwitchManagerController, moveInOrder, sanitizeAppTypes } from '../src/client/manager-controller.mjs'

const PROVIDERS = '/api/dsh-ccswitch-manager/providers'
const PRESETS = '/api/dsh-ccswitch-manager/presets'

/** A fetch stub that answers from a routing table and records every request. */
function stubFetch(routes) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const route = routes[url]
    if (route === undefined) throw new Error(`unexpected request to ${url}`)
    const result = typeof route === 'function' ? await route(init) : route
    if (result instanceof Error) throw result
    return {
      ok: result.status === undefined || (result.status >= 200 && result.status < 300),
      status: result.status ?? 200,
      async json() { return result.body },
    }
  }
  fetchImpl.calls = calls
  return fetchImpl
}

/** A provider payload as the Host sends one. */
function hostProvider(overrides = {}) {
  return {
    key: 'ccs-deepseek-ab12cd34',
    displayName: 'DeepSeek',
    api: 'anthropic-messages',
    baseURL: 'https://api.deepseek.com/anthropic',
    credential: 'found',
    models: [{ id: 'deepseek-chat' }],
    isCurrent: false,
    inUse: false,
    inFailoverQueue: false,
    ...overrides,
  }
}

function providersBody(overrides = {}) {
  return {
    body: {
      exists: true,
      revision: 7,
      order: ['ccs-deepseek-ab12cd34'],
      notice: undefined,
      providers: { 'ccs-deepseek-ab12cd34': hostProvider() },
      apiProtocols: ['openai-completions', 'openai-responses', 'anthropic-messages'],
      ...overrides,
    },
  }
}

test('refresh populates the snapshot and carries the Host protocol list', async () => {
  const fetchImpl = stubFetch({ [PROVIDERS]: providersBody() })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.exists, true)
  assert.equal(snapshot.revision, 7)
  assert.deepEqual(snapshot.order, ['ccs-deepseek-ab12cd34'])
  assert.equal(snapshot.providers['ccs-deepseek-ab12cd34'].displayName, 'DeepSeek')
  assert.equal(snapshot.providers['ccs-deepseek-ab12cd34'].credential, 'found')
  // The protocol select is populated from the Host, not hardcoded.
  assert.deepEqual(snapshot.apiProtocols, ['openai-completions', 'openai-responses', 'anthropic-messages'])
  assert.equal(fetchImpl.calls[0].url, PROVIDERS)
})

test('a Host that omits apiProtocols still leaves a usable select', async () => {
  const fetchImpl = stubFetch({ [PROVIDERS]: providersBody({ apiProtocols: undefined }) })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  assert.deepEqual(controller.getSnapshot().apiProtocols, [
    'openai-completions', 'openai-responses', 'anthropic-messages',
  ])
})

// The Host half may be older than this bundle. Every field below is one it could
// legitimately not send; none of them may throw or render as `undefined`.
test('malformed provider payloads degrade instead of throwing', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: {
      body: {
        exists: 'yes',
        revision: 'seven',
        order: ['ghost', 42, 'ccs-real-ab12cd34'],
        providers: {
          'ccs-real-ab12cd34': { displayName: 5, models: 'nope', credential: 'maybe' },
          'ccs-partial-ab12cd34': null,
        },
      },
    },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.status, 'ready')
  // A non-boolean `exists` reads as absent rather than truthy.
  assert.equal(snapshot.exists, false)
  assert.equal(snapshot.revision, undefined)
  // Every provider present is listed exactly once, and no unknown key invents a row.
  assert.deepEqual([...snapshot.order].sort(), ['ccs-partial-ab12cd34', 'ccs-real-ab12cd34'])
  const real = snapshot.providers['ccs-real-ab12cd34']
  assert.equal(real.displayName, '5')
  assert.deepEqual(real.models, [])
  // Anything other than an explicit `found` reads as missing.
  assert.equal(real.credential, 'missing')
  // `inUse` is what the membership control binds to; a Host that omits it
  // reads as not in the route table rather than as truthy.
  assert.equal(real.inUse, false)
  assert.equal(snapshot.providers['ccs-partial-ab12cd34'].displayName, '')
})

test('a provider missing from order is still listed, and order never repeats one', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: {
      body: {
        exists: true,
        revision: 1,
        order: ['a', 'a', 'b'],
        providers: { b: hostProvider({ key: 'b' }), c: hostProvider({ key: 'c' }) },
      },
    },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  // 'a' is in `order` but not in `providers`; 'c' is in `providers` but not in
  // `order`. Both must resolve to exactly one row each.
  assert.deepEqual(controller.getSnapshot().order, ['b', 'c'])
})

test('a failed refresh reports an error rather than hanging in loading', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: { status: 500, body: { error: 'could not read the provider catalogue' } },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await assert.rejects(() => controller.refresh(), /could not read the provider catalogue/)
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.status, 'error')
  assert.equal(snapshot.error, 'could not read the provider catalogue')
})

test('save posts the draft with the revision it was read at and the same-origin marker', async () => {
  const routes = {
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/save`]: (init) => ({ body: { key: 'ccs-new-ab12cd34', status: 'created' } }),
  }
  const fetchImpl = stubFetch(routes)
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await controller.save({
    provider: { displayName: 'Kimi', api: 'anthropic-messages', baseURL: 'https://x.test', models: [{ id: 'k2' }] },
    apiKey: 'sk-secret',
    expectedRevision: 7,
  })
  const save = fetchImpl.calls.find((call) => call.url === `${PROVIDERS}/save`)
  assert.ok(save, 'the save route was not called')
  assert.equal(save.init.method, 'POST')
  // Without this header the Host answers 403 for every state-changing request.
  assert.equal(save.init.headers['x-dsh-ccswitch-origin'], 'same-origin')
  assert.equal(save.init.headers['content-type'], 'application/json')
  const body = JSON.parse(save.init.body)
  assert.equal(body.expectedRevision, 7)
  assert.equal(body.apiKey, 'sk-secret')
  assert.equal(body.key, undefined)
  assert.equal(body.provider.displayName, 'Kimi')
})

test('save falls back to the snapshot revision when the caller names none', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/save`]: { body: { key: 'k', status: 'updated' } },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await controller.save({ key: 'k', provider: { displayName: 'X', api: 'openai-completions', baseURL: 'https://x.test', models: [{ id: 'm' }] } })
  const body = JSON.parse(fetchImpl.calls.find((call) => call.url === `${PROVIDERS}/save`).init.body)
  assert.equal(body.expectedRevision, 7)
  assert.equal(body.key, 'k')
  // A blank key input must not be sent as an empty string: the Host would read
  // it as "update the provider named ''" rather than "create one".
  assert.equal(Object.hasOwn(body, 'apiKey'), false)
})

test('a 409 marks a conflict, re-reads the document, and does not wedge the snapshot', async () => {
  let revision = 7
  const fetchImpl = stubFetch({
    [PROVIDERS]: () => providersBody({ revision }),
    [`${PROVIDERS}/save`]: () => {
      // Someone else moved the document between the read and the write.
      revision = 9
      return { status: 409, body: { error: 'the settings document changed; reload and retry' } }
    },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await assert.rejects(
    () => controller.save({ provider: { displayName: 'X', api: 'openai-completions', baseURL: 'https://x.test', models: [{ id: 'm' }] } }),
    /changed/,
  )
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.conflict, true)
  assert.equal(snapshot.status, 'conflict')
  // The re-read happened, so retrying acts on the current revision.
  assert.equal(snapshot.revision, 9)
  // And the table is usable again rather than stuck mid-operation.
  assert.equal(snapshot.pendingKey, undefined)
  assert.equal(snapshot.pendingAction, undefined)
})

test('refusing to delete a provider DSH still routes to is not a conflict', async () => {
  // Both answers are 409, but they mean opposite things: a conflict says the
  // document moved and a retry may succeed, while this says the provider is in
  // use and no retry ever will. Folding them together would show the "reload
  // and retry" banner and hide the row error that names the real problem.
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/delete`]: {
      status: 409,
      body: { reason: 'in-use', error: 'DSH still routes to this provider; withdraw it first' },
    },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await assert.rejects(() => controller.remove('k'), (error) => {
    assert.equal(error.status, 409)
    assert.equal(error.conflict, false)
    return /withdraw it first/.test(error.message)
  })
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.conflict, false, 'a fact about the provider is not a stale document')
  assert.equal(snapshot.status, 'error')

  // A plain 409 — no reason at all — is still the staleness signal, so the
  // banner must invite the reload-and-retry it means.
  const plain = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/delete`]: { status: 409, body: { error: 'the settings document changed' } },
  })
  const other = createCCSwitchManagerController({ fetchImpl: plain })
  await other.refresh()
  await assert.rejects(() => other.remove('k'), (error) => {
    assert.equal(error.status, 409)
    assert.equal(error.conflict, true)
    return /changed/.test(error.message)
  })
  assert.equal(other.getSnapshot().conflict, true)
  assert.equal(other.getSnapshot().status, 'conflict')
})

test('a rejected save surfaces the Host validation list and clears the busy state', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/save`]: {
      status: 400,
      body: { error: 'provider is not usable', errors: ['displayName is required', 'baseURL is not a URL'] },
    },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await assert.rejects(() => controller.save({ provider: {} }), /not usable/)
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.status, 'error')
  assert.deepEqual(snapshot.saveErrors, ['displayName is required', 'baseURL is not a URL'])
  assert.equal(snapshot.pendingKey, undefined)
  // A plain validation failure is not a conflict; the form must not claim the
  // document moved when it did not.
  assert.equal(snapshot.conflict, false)
})

test('a successful save clears the previous attempt’s validation errors', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/save`]: { body: { key: 'k', status: 'created' } },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await controller.save({ provider: { displayName: 'X', api: 'openai-completions', baseURL: 'https://x.test', models: [{ id: 'm' }] } })
  assert.deepEqual(controller.getSnapshot().saveErrors, [])
})

test('delete sends the key and removes the row on the re-read', async () => {
  let providers = { 'ccs-a-ab12cd34': hostProvider({ key: 'ccs-a-ab12cd34' }), 'ccs-b-ab12cd34': hostProvider({ key: 'ccs-b-ab12cd34' }) }
  const fetchImpl = stubFetch({
    [PROVIDERS]: () => providersBody({ providers, order: Object.keys(providers) }),
    [`${PROVIDERS}/delete`]: () => {
      providers = { 'ccs-b-ab12cd34': hostProvider({ key: 'ccs-b-ab12cd34' }) }
      return { body: { key: 'ccs-a-ab12cd34', status: 'removed' } }
    },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await controller.remove('ccs-a-ab12cd34')
  const body = JSON.parse(fetchImpl.calls.find((call) => call.url === `${PROVIDERS}/delete`).init.body)
  assert.equal(body.key, 'ccs-a-ab12cd34')
  assert.deepEqual(controller.getSnapshot().order, ['ccs-b-ab12cd34'])
})

test('remove publishes a notice only when the row was actually in use', async () => {
  const quiet = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/delete`]: { body: { key: 'ccs-deepseek-ab12cd34', status: 'removed' } },
  })
  const controller = createCCSwitchManagerController({ fetchImpl: quiet })
  await controller.refresh()
  await controller.remove('ccs-deepseek-ab12cd34')
  // An ordinary delete says nothing the badge did not already say, so no
  // banner is published and nothing has to be dismissed.
  assert.equal(controller.getSnapshot().notice, undefined)

  const live = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/delete`]: { body: { key: 'ccs-deepseek-ab12cd34', status: 'removed', wasInUse: true } },
  })
  const other = createCCSwitchManagerController({ fetchImpl: live })
  await other.refresh()
  await other.remove('ccs-deepseek-ab12cd34')
  const { notice } = other.getSnapshot()
  // The name is captured before the re-read drops the row, so the banner can
  // still say which provider went.
  assert.equal(notice.action, 'delete')
  assert.equal(notice.wasInUse, true)
  assert.equal(notice.key, 'ccs-deepseek-ab12cd34')
  assert.equal(notice.name, 'DeepSeek')
})

test('remove, apply and withdraw refuse an empty key without touching the network', async () => {
  const fetchImpl = stubFetch({ [PROVIDERS]: providersBody() })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await assert.rejects(() => controller.remove(''), /requires a provider key/)
  await assert.rejects(() => controller.apply('   '), /requires a provider key/)
  await assert.rejects(() => controller.withdraw('   '), /requires a provider key/)
  assert.equal(fetchImpl.calls.length, 1, 'only the initial refresh should have been sent')
})

test('apply surfaces the warnings the Host returned', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/apply`]: {
      body: {
        key: 'ccs-deepseek-ab12cd34',
        status: 'applied',
        warnings: ['llm-pi-ai is not installed, so DSH has no route to use it', '  ', 42],
      },
    },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await controller.apply('ccs-deepseek-ab12cd34')
  const { notice } = controller.getSnapshot()
  assert.equal(notice.key, 'ccs-deepseek-ab12cd34')
  assert.equal(notice.name, 'DeepSeek')
  assert.equal(notice.action, 'apply')
  // Blank and non-string entries are dropped, not rendered as "42".
  assert.deepEqual(notice.warnings, ['llm-pi-ai is not installed, so DSH has no route to use it'])
})

test('withdraw reports whether the key was an orphan the catalogue never knew', async () => {
  const orphan = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/withdraw`]: { body: { key: 'ghost', status: 'withdrawn', inCatalogue: false } },
  })
  const a = createCCSwitchManagerController({ fetchImpl: orphan })
  await a.refresh()
  await a.withdraw('ghost')
  assert.equal(a.getSnapshot().notice.action, 'withdraw')
  assert.equal(a.getSnapshot().notice.orphan, true)

  const known = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/withdraw`]: { body: { key: 'ccs-deepseek-ab12cd34', status: 'withdrawn', inCatalogue: true } },
  })
  const b = createCCSwitchManagerController({ fetchImpl: known })
  await b.refresh()
  await b.withdraw('ccs-deepseek-ab12cd34')
  assert.equal(b.getSnapshot().notice.action, 'withdraw')
  assert.equal(b.getSnapshot().notice.orphan, false)
})

test('an apply response with no warnings still reports the membership change', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/apply`]: { body: { key: 'k', status: 'applied' } },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await controller.apply('k')
  const { notice } = controller.getSnapshot()
  // A Host that omits `warnings` still succeeded; the banner is published
  // with an empty list rather than not at all.
  assert.equal(notice.action, 'apply')
  assert.equal(notice.key, 'k')
  assert.deepEqual(notice.warnings, [])
})

test('dismissNotice clears the report', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/apply`]: { body: { key: 'k', status: 'applied', warnings: ['w'] } },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await controller.apply('k')
  controller.dismissNotice()
  assert.equal(controller.getSnapshot().notice, undefined)
})

test('clearSaveFeedback drops the previous attempt’s errors without touching the table', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/save`]: {
      status: 400,
      body: { error: 'provider is not usable', errors: ['displayName is required'] },
    },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await controller.save({ provider: {} }).catch(() => {})
  assert.equal(controller.getSnapshot().status, 'error')
  assert.deepEqual(controller.getSnapshot().saveErrors, ['displayName is required'])

  controller.clearSaveFeedback()
  const snapshot = controller.getSnapshot()
  // A fresh dialog must not open showing errors from the attempt the user
  // already abandoned — they may name fields that have since been fixed.
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.error, null)
  assert.equal(snapshot.conflict, false)
  assert.deepEqual(snapshot.saveErrors, [])
  // The catalogue behind the table is untouched: the read that produced it did
  // succeed, so the rows and the revision it was read at must survive.
  assert.equal(snapshot.order.length, 1)
  assert.equal(snapshot.revision, 7)
})

test('clearSaveFeedback does not republish a snapshot that is already clean', async () => {
  const fetchImpl = stubFetch({ [PROVIDERS]: providersBody() })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  const before = controller.getSnapshot()
  let notified = 0
  controller.subscribe(() => { notified += 1 })
  controller.clearSaveFeedback()
  // Publishing an identical snapshot would re-render every subscriber for
  // nothing, and `useSyncExternalStore` would see a new reference each time.
  assert.equal(notified, 0)
  assert.equal(controller.getSnapshot(), before)
})

test('clearSaveFeedback also clears a conflict', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/apply`]: { status: 409, body: { error: 'the settings document changed' } },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await controller.apply('k').catch(() => {})
  assert.equal(controller.getSnapshot().conflict, true)
  controller.clearSaveFeedback()
  assert.equal(controller.getSnapshot().conflict, false)
  assert.equal(controller.getSnapshot().status, 'ready')
})

test('loadPresets sanitizes the catalogue and reports its own failure separately', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [PRESETS]: {
      body: { presets: [
        { key: 'deepseek-claude', displayName: 'DeepSeek', api: 'anthropic-messages', baseURL: 'https://api.deepseek.com/anthropic', models: ['a', '', 7], appType: 'claude' },
        { key: '', displayName: 'nameless' },
        'not an object',
        { key: 'kimi-claude', displayName: 'Kimi', models: 'nope' },
      ] },
    },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await controller.loadPresets()
  const presets = controller.getSnapshot().presets
  // Entries without a key or a name are dropped; only the models that are
  // non-empty strings survive.
  assert.deepEqual(presets.map((preset) => preset.key), ['deepseek-claude', 'kimi-claude'])
  assert.deepEqual(presets[0].models, ['a'])
  assert.deepEqual(presets[1].models, [])
  assert.equal(controller.getSnapshot().presetsError, null)
})

test('a failed preset load does not disturb the provider list', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [PRESETS]: { status: 404, body: { error: 'not found' } },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await assert.rejects(() => controller.loadPresets(), /not found/)
  const snapshot = controller.getSnapshot()
  // The presets are optional; the table the user already has must survive.
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.error, null)
  assert.equal(snapshot.presetsError, 'not found')
  assert.equal(snapshot.order.length, 1)
})

test('operations are serialized, so two clicks cannot interleave their writes', async () => {
  const order = []
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/save`]: async (init) => {
      order.push(`save:${JSON.parse(init.body).provider.displayName}`)
      await gate
      return { body: { key: 'k', status: 'created' } }
    },
    [`${PROVIDERS}/delete`]: () => {
      order.push('delete')
      return { body: { key: 'k', status: 'removed' } }
    },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  const first = controller.save({ provider: { displayName: 'A', api: 'openai-completions', baseURL: 'https://x.test', models: [{ id: 'm' }] } })
  const second = controller.remove('k')
  release()
  await Promise.all([first, second])
  // The delete is queued behind the save that was still in flight.
  assert.deepEqual(order, ['save:A', 'delete'])
})

test('onChanged runs after a successful write and never fails it', async () => {
  let changed = 0
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/save`]: { body: { key: 'k', status: 'created' } },
  })
  const controller = createCCSwitchManagerController({
    fetchImpl,
    onChanged: () => {
      changed += 1
      // A listener that throws must not turn a completed write into an error.
      throw new Error('listener exploded')
    },
  })
  await controller.refresh()
  const snapshot = await controller.save({ provider: { displayName: 'X', api: 'openai-completions', baseURL: 'https://x.test', models: [{ id: 'm' }] } })
  assert.equal(changed, 1)
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.error, null)
})

test('a failed write never calls onChanged', async () => {
  let changed = 0
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/save`]: { status: 500, body: { error: 'boom' } },
  })
  const controller = createCCSwitchManagerController({ fetchImpl, onChanged: () => { changed += 1 } })
  await controller.refresh()
  await assert.rejects(() => controller.save({ provider: {} }), /boom/)
  assert.equal(changed, 0)
})

test('a re-read that fails after a successful write does not fail the operation', async () => {
  let reads = 0
  const fetchImpl = stubFetch({
    [PROVIDERS]: () => {
      reads += 1
      // The write lands, then the follow-up read dies.
      if (reads > 1) return { status: 500, body: { error: 'read exploded' } }
      return providersBody()
    },
    [`${PROVIDERS}/save`]: { body: { key: 'k', status: 'created' } },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  const snapshot = await controller.save({ provider: { displayName: 'X', api: 'openai-completions', baseURL: 'https://x.test', models: [{ id: 'm' }] } })
  // The write is the durable fact; the failed re-read must not report it as lost.
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.error, null)
})

test('subscribers are notified on every publish and can unsubscribe', async () => {
  const fetchImpl = stubFetch({ [PROVIDERS]: providersBody() })
  const controller = createCCSwitchManagerController({ fetchImpl })
  let notifications = 0
  const unsubscribe = controller.subscribe(() => { notifications += 1 })
  await controller.refresh()
  assert.ok(notifications >= 2, 'loading then ready should each notify')
  const seen = notifications
  unsubscribe()
  await controller.refresh()
  assert.equal(notifications, seen)
})

test('getSnapshot returns a stable reference between publishes', async () => {
  const fetchImpl = stubFetch({ [PROVIDERS]: providersBody() })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  // useSyncExternalStore calls this in a loop and re-renders forever if the
  // reference changes on every read.
  assert.equal(controller.getSnapshot(), controller.getSnapshot())
})

// --- preset sanitization: the CC Switch fields the picker groups by ---------
//
// The picker groups and labels presets from data rather than from literals, so
// these fields have to survive the Host boundary intact — a `category` dropped
// here would silently file every preset under one heading.

test('sanitizePresets carries the CC Switch fields the picker groups and labels by', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [PRESETS]: { body: { presets: [
      {
        key: 'kimi-claude',
        displayName: 'Kimi',
        api: 'anthropic-messages',
        baseURL: 'https://api.moonshot.cn/anthropic',
        models: ['kimi-k2.7-code'],
        family: 'kimi',
        planKey: 'payg',
        regionKey: 'cn',
        category: 'cn_official',
        isPartner: true,
        icon: 'kimi',
        iconColor: '#6366F1',
      },
      // A preset carrying none of them must come through with them absent
      // rather than dropped or given invented values.
      { key: 'plain', displayName: 'Plain', api: 'openai-completions', baseURL: 'https://x.test', models: ['m'] },
    ] } },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await controller.loadPresets()
  const [kimi, plain] = controller.getSnapshot().presets

  assert.equal(kimi.family, 'kimi')
  assert.equal(kimi.planKey, 'payg')
  assert.equal(kimi.regionKey, 'cn')
  assert.equal(kimi.category, 'cn_official')
  assert.equal(kimi.isPartner, true)
  assert.equal(kimi.icon, 'kimi')
  assert.equal(kimi.iconColor, '#6366F1')

  assert.equal(plain.family, undefined)
  assert.equal(plain.category, undefined)
  // Anything other than an explicit `true` is not a partner flag.
  assert.equal(plain.isPartner, false)
})

// --- reordering --------------------------------------------------------------
//
// The route existed and was tested before this, but nothing called it: the
// table rendered from `order` and the user had no way to change it. These
// tests cover the two things that were missing — the arithmetic that turns a
// click into a new order, and the request that writes it.

test('moveInOrder shifts one row and takes its target slot, not a swap', () => {
  const order = ['a', 'b', 'c', 'd']
  assert.deepEqual(moveInOrder(order, 'b', -1), ['b', 'a', 'c', 'd'])
  assert.deepEqual(moveInOrder(order, 'b', 1), ['a', 'c', 'b', 'd'])
  assert.deepEqual(moveInOrder(order, 'a', 1), ['b', 'a', 'c', 'd'])
  assert.deepEqual(moveInOrder(order, 'd', -1), ['a', 'b', 'd', 'c'])
  assert.equal(order.join(), 'a,b,c,d', 'the input must not be mutated')
})

test('moveInOrder is total: every out-of-range move returns the order unchanged', () => {
  const order = ['a', 'b', 'c']
  // The buttons are disabled at the ends, but a background refresh between the
  // render and the click can still land one of these.
  for (const [key, delta] of [
    ['a', -1], ['c', 1], ['missing', 1], ['missing', -1],
    ['a', 0], ['b', 9], ['b', -9],
  ]) {
    assert.equal(moveInOrder(order, key, delta), order, `${key} ${delta}`)
  }
  // A non-integer delta is not a move.
  assert.equal(moveInOrder(order, 'b', 1.5), order)
  assert.equal(moveInOrder(order, 'b', NaN), order)
  // A missing or malformed list is empty, not a throw.
  assert.deepEqual(moveInOrder(undefined, 'a', 1), [])
  assert.deepEqual(moveInOrder(null, 'a', 1), [])
})

test('reorder posts the complete order, not a list of moves', async () => {
  const routes = {
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/reorder`]: { body: { status: 'reordered', order: ['b', 'a'] } },
  }
  const fetchImpl = stubFetch(routes)
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await controller.reorder(['b', 'a'])
  const call = fetchImpl.calls.find((entry) => entry.url === `${PROVIDERS}/reorder`)
  assert.ok(call, 'the reorder route was not called')
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.headers['x-dsh-ccswitch-origin'], 'same-origin')
  const body = JSON.parse(call.init.body)
  // The whole list: the Host re-indexes every row by position, so a partial
  // list would leave the unnamed rows holding numbers the user never saw.
  assert.deepEqual(body.keys, ['b', 'a'])
  assert.equal(body.expectedRevision, 7)
})

test('reorder refuses an empty order without a round trip', async () => {
  // The Host would answer 400 for this. Catching it here means a mis-wired
  // button cannot blank the catalogue's ordering with a request that was
  // never going to be accepted.
  let called = false
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/reorder`]: () => { called = true; return { body: {} } },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await assert.rejects(() => controller.reorder([]), /complete order/)
  await assert.rejects(() => controller.reorder(undefined), /complete order/)
  assert.equal(called, false)
})

test('a rejected reorder reports the failure and leaves the table usable', async () => {
  const fetchImpl = stubFetch({
    [PROVIDERS]: providersBody(),
    [`${PROVIDERS}/reorder`]: {
      status: 400,
      body: { error: 'keys must name every provider exactly once' },
    },
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  await assert.rejects(() => controller.reorder(['a', 'b']), /exactly once/)
  const snapshot = controller.getSnapshot()
  assert.equal(snapshot.status, 'error')
  assert.equal(snapshot.conflict, false)
  assert.match(snapshot.error, /exactly once/)
  // Not wedged mid-operation: the buttons come back.
  assert.equal(snapshot.pendingKey, undefined)
  assert.equal(snapshot.pendingAction, undefined)
})

// The fallback mirrors SUPPORTED_APP_TYPES in lib/core/scan.js, which cannot be
// imported here (it reaches node:sqlite), so the test carries its own copy —
// the point of pinning it is that an older Host still offers every type.
const FALLBACK_APP_TYPES = [
  'codex',
  'claude',
  'claude-desktop',
  'opencode',
  'gemini',
  'hermes',
  'grokbuild',
  'pi',
  'mcode',
  'openclaw',
]

test('the app-type list is carried from the Host, with a fallback for an older one', async () => {
  const withHost = stubFetch({ [PROVIDERS]: providersBody({ appTypes: ['claude', 'codex'] }) })
  const a = createCCSwitchManagerController({ fetchImpl: withHost })
  await a.refresh()
  assert.deepEqual(a.getSnapshot().appTypes, ['claude', 'codex'])

  // A Host that predates the field still leaves a usable select rather than an
  // empty one, which would make the app type unsettable.
  const older = stubFetch({ [PROVIDERS]: providersBody({ appTypes: undefined }) })
  const b = createCCSwitchManagerController({ fetchImpl: older })
  await b.refresh()
  assert.deepEqual(b.getSnapshot().appTypes, FALLBACK_APP_TYPES)
})

test('sanitizeAppTypes drops non-strings and never returns an empty list', () => {
  assert.deepEqual(sanitizeAppTypes(['claude', 'codex']), ['claude', 'codex'])
  assert.deepEqual(sanitizeAppTypes(['claude', 'claude']), ['claude'])
  assert.deepEqual(sanitizeAppTypes(['claude', '', '  ', 42, null]), ['claude'])
  assert.deepEqual(sanitizeAppTypes('claude'), FALLBACK_APP_TYPES)
  assert.deepEqual(sanitizeAppTypes([]), FALLBACK_APP_TYPES)
  assert.deepEqual(sanitizeAppTypes(undefined), FALLBACK_APP_TYPES)
})
