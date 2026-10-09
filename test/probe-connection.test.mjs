// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
//
// The "test connection" button is three separate pieces — `probeConnection`
// (core), `POST /api/dsh-ccswitch/probe` (Host, probe-only, writes nothing) and
// `controller.probeOne` (client state) — so each is covered where it lives.
import test from 'node:test'
import assert from 'node:assert/strict'
import { probeConnection, probeModels, PROBE_REASON, PROBE_REASONS, PROBE_CHECK } from '../lib/core/probe.js'
import { makeRoutes } from '../src/host/routes.mjs'
import { createCCSwitchImportController } from '../src/client/import-controller.mjs'
import { MESSAGES } from '../src/client/messages.mjs'

const SECRET = 'sk-TESTKEY12345678'

function profileRow(overrides = {}) {
  return {
    profileId: 'p1',
    profileName: 'P1',
    baseURL: 'https://upstream.test/v1',
    api: 'openai-completions',
    apiKey: SECRET,
    models: [{ id: 'seed-model' }],
    ...overrides,
  }
}

function fakeReq(overrides = {}) {
  return {
    method: 'GET',
    url: '/api/dsh-ccswitch/probe',
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

function statusOf(res) {
  return res.calls.find((call) => call[0] === 'head')[1]
}

function bodyOf(res) {
  return JSON.parse(res.calls.find((call) => call[0] === 'end')[1])
}

function probeRoute(deps = {}) {
  return makeRoutes({ isLoopback: () => true, ...deps }).find((item) => item.path === '/api/dsh-ccswitch/probe')
}

/** POST the given body at the probe route and return the response recorder. */
async function postProbe(route, body, { omitOrigin = false, extraHeaders = {} } = {}) {
  const headers = { host: '127.0.0.1:5624', ...extraHeaders }
  // `omitOrigin` is a flag, not `origin: undefined`: a destructuring default
  // would quietly put the header back and the fence test would pass vacuously.
  if (!omitOrigin) headers.origin = 'http://127.0.0.1:5624'
  const request = withBody(fakeReq({ method: 'POST', headers }), body)
  const res = fakeRes()
  await route.handler(request, res)
  return res
}

test('probeConnection reports a reachable endpoint and the merged model count', async () => {
  let seen
  const outcome = await probeConnection(profileRow(), {
    fetchImpl: async (url, init) => {
      seen = { url, headers: init.headers }
      return { ok: true, status: 200, async json() { return { data: [{ id: 'model-a' }, { id: 'seed-model' }] } } }
    },
  })
  assert.equal(seen.url, 'https://upstream.test/v1/models')
  assert.equal(seen.headers.authorization, `Bearer ${SECRET}`)
  assert.equal(outcome.ok, true)
  assert.equal(outcome.reason, PROBE_REASON.OK)
  assert.equal(outcome.httpStatus, 200)
  assert.equal(typeof outcome.latencyMs, 'number')
  assert.deepEqual(outcome.modelIds, ['model-a', 'seed-model'])
  assert.equal(outcome.discoveredCount, 2)
  // seed-model was already known, so exactly one id is new.
  assert.equal(outcome.addedCount, 1)
  assert.equal(outcome.modelCount, 2)
  assert.match(outcome.message, /新增 1/)
})

test('probeConnection sends anthropic-style headers for anthropic profiles', async () => {
  let seen
  await probeConnection(profileRow({ api: 'anthropic-messages' }), {
    fetchImpl: async (url, init) => {
      seen = init.headers
      return { ok: true, status: 200, async json() { return { data: [{ id: 'x' }] } } }
    },
  })
  assert.equal(seen['x-api-key'], SECRET)
  assert.equal(seen['anthropic-version'], '2023-06-01')
  assert.equal(seen.authorization, `Bearer ${SECRET}`)
})

test('probeConnection distinguishes HTTP errors, empty lists, network errors and timeouts', async () => {
  const unauthorized = await probeConnection(profileRow(), {
    fetchImpl: async () => ({ ok: false, status: 401, async json() { return {} } }),
  })
  assert.equal(unauthorized.ok, false)
  assert.equal(unauthorized.reason, PROBE_REASON.HTTP_ERROR)
  assert.equal(unauthorized.httpStatus, 401)
  assert.match(unauthorized.message, /HTTP 401/)

  const empty = await probeConnection(profileRow(), {
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { data: [] } } }),
  })
  assert.equal(empty.ok, true)
  assert.equal(empty.reason, PROBE_REASON.EMPTY)
  assert.equal(empty.modelCount, 1)

  const offline = await probeConnection(profileRow(), {
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED') },
  })
  assert.equal(offline.ok, false)
  assert.equal(offline.reason, PROBE_REASON.NETWORK)
  assert.match(offline.message, /网络错误/)

  // Drives the real timer: the stub only settles once its signal aborts.
  const timedOut = await probeConnection(profileRow(), {
    timeoutMs: 5,
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    }),
  })
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.reason, PROBE_REASON.TIMEOUT)
  assert.match(timedOut.message, /超时/)
})

test('probeConnection without a credential says so instead of pretending to test', async () => {
  const outcome = await probeConnection(profileRow({ apiKey: undefined }), {
    fetchImpl: async () => { throw new Error('must not be called') },
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, PROBE_REASON.NO_CREDENTIALS)
  assert.equal(outcome.modelCount, 1)
  // The import path stays silent for such a row, exactly as before.
  const merged = await probeModels(profileRow({ apiKey: undefined }))
  assert.deepEqual(merged.warnings, [])
})

test('probeModels still degrades to a warning and widens models on success', async () => {
  const good = await probeModels(profileRow(), {
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { models: [{ id: 'claude-sonnet-4-5' }] } } }),
  })
  assert.equal(good.warnings.length, 1)
  assert.equal(good.profile.models.length, 2)
  assert.match(good.profile.models[1].name, /Claude Sonnet/)

  const bad = await probeModels(profileRow(), {
    fetchImpl: async () => { throw new Error('down') },
  })
  assert.equal(bad.profile.models.length, 1)
  assert.match(bad.warnings[0], /网络错误/)
})

test('the probe route is POST-only, same-origin-fenced and never imports anything', async () => {
  let imports = 0
  const route = probeRoute({
    scan: async () => [profileRow()],
    importProfiles: async () => { imports += 1; return [] },
    probe: async () => ({
      ok: true,
      reason: 'ok',
      check: 'minimal',
      httpStatus: 200,
      // The upstream's own words, echoing the key: the route must redact it.
      detail: `模型列表不可用：${SECRET}`,
      latencyMs: 12,
      discoveredCount: 1,
      addedCount: 0,
      modelCount: 1,
      message: '模型探测成功：新增 0 个模型（共 1 个）',
    }),
  })

  const noOrigin = await postProbe(route, JSON.stringify({ profileIds: ['p1'] }), { omitOrigin: true })
  assert.equal(statusOf(noOrigin), 403, 'a write with no same-origin proof is rejected')
  assert.match(bodyOf(noOrigin).error, /app page/)

  // Exactly how the browser calls it: no Origin, but our own marker header.
  const marked = await postProbe(route, JSON.stringify({ profileIds: ['p1'] }), {
    omitOrigin: true,
    extraHeaders: { 'x-dsh-ccswitch-origin': 'same-origin' },
  })
  assert.equal(statusOf(marked), 200)

  const get = fakeRes()
  await route.handler(fakeReq(), get)
  assert.equal(statusOf(get), 405)

  const ok = await postProbe(route, JSON.stringify({ profileIds: ['p1'] }))
  assert.equal(statusOf(ok), 200)
  assert.deepEqual(bodyOf(ok).results, [{
    profileId: 'p1',
    profileName: 'P1',
    ok: true,
    reason: 'ok',
    check: 'minimal',
    httpStatus: 200,
    // The actionability of a failure comes from the upstream's own message,
    // so it is forwarded verbatim — minus anything that looks like a key.
    detail: '模型列表不可用：[redacted]',
    latencyMs: 12,
    discoveredCount: 1,
    addedCount: 0,
    modelCount: 1,
    message: '模型探测成功：新增 0 个模型（共 1 个）',
  }])
  assert.equal(imports, 0, 'probing must never write settings')
})

test('the probe route rejects malformed bodies', async () => {
  const route = probeRoute({ scan: async () => [profileRow()], probe: async () => ({}) })
  for (const body of ['{}', '{"profileIds":"p1"}', '{"profileIds":[1]}', 'not json']) {
    const res = await postProbe(route, body)
    assert.equal(statusOf(res), 400, body)
    assert.equal(bodyOf(res).error, 'body must be { profileIds: string[] }')
  }
})

test('the probe route skips blocked and skipped rows and caps the fan-out', async () => {
  const probed = []
  const many = Array.from({ length: 60 }, (_, index) => profileRow({ profileId: `p${index}`, profileName: `P${index}` }))
  const route = probeRoute({
    scan: async () => [
      ...many,
      profileRow({ profileId: 'blocked-1', blocked: true, blockedReason: '缺少 API key' }),
      profileRow({ profileId: 'skipped-1', skipped: true }),
    ],
    probe: async (profile) => { probed.push(profile.profileId); return { ok: true, reason: 'ok' } },
  })
  const res = await postProbe(route, JSON.stringify({ profileIds: [...many.map((profile) => profile.profileId), 'blocked-1', 'skipped-1'] }))
  assert.equal(statusOf(res), 200)
  assert.equal(bodyOf(res).results.length, 50)
  assert.equal(probed.length, 50)
  assert.ok(!probed.includes('blocked-1'))
  assert.ok(!probed.includes('skipped-1'))
})

test('the probe route redacts the credentials it holds, in results and in errors', async () => {
  const leaking = probeRoute({
    scan: async () => [profileRow()],
    probe: async () => ({ ok: false, reason: 'http-error', httpStatus: 401, latencyMs: 3, message: `模型探测失败（HTTP 401） ${SECRET}` }),
  })
  const leaked = await postProbe(leaking, JSON.stringify({ profileIds: ['p1'] }))
  assert.equal(statusOf(leaked), 200)
  assert.ok(!JSON.stringify(bodyOf(leaked)).includes(SECRET))

  const throwing = probeRoute({
    scan: async () => [profileRow()],
    probe: async () => { throw new Error(`upstream echoed ${SECRET}`) },
  })
  const failed = await postProbe(throwing, JSON.stringify({ profileIds: ['p1'] }))
  assert.equal(statusOf(failed), 500)
  assert.deepEqual(bodyOf(failed), { error: 'probe failed' })
})

test('the probe route normalizes junk numbers and unknown reasons', async () => {
  const route = probeRoute({
    scan: async () => [profileRow()],
    probe: async () => ({ ok: 'yes', reason: 'i-am-not-a-reason', httpStatus: '401', latencyMs: -5, discoveredCount: 'x', addedCount: null, modelCount: 3 }),
  })
  const res = await postProbe(route, JSON.stringify({ profileIds: ['p1'] }))
  const [result] = bodyOf(res).results
  assert.equal(result.ok, false)
  assert.equal(result.reason, PROBE_REASON.NETWORK)
  assert.equal(result.httpStatus, undefined)
  assert.equal(result.latencyMs, 0)
  assert.equal(result.discoveredCount, 0)
  assert.equal(result.addedCount, 0)
  assert.equal(result.modelCount, 3)
})

test('every probe reason has localized text in both locales', () => {
  for (const reason of PROBE_REASONS) {
    for (const locale of ['zh', 'en']) {
      const value = MESSAGES[locale][`importer.probe.${reason}`]
      assert.equal(typeof value, 'string', `${locale} importer.probe.${reason}`)
      assert.ok(value.length > 0)
    }
  }
  // The UI's request-failure fallback has to be translatable too.
  for (const locale of ['zh', 'en']) {
    assert.equal(typeof MESSAGES[locale]['importer.probe.requestFailed'], 'string')
  }
})

function scanningController({ scanProfiles, onProbe, requests = [] }) {
  return createCCSwitchImportController({
    fetchImpl: async (url, init) => {
      if (url === '/api/dsh-ccswitch/scan') {
        return { ok: true, async json() { return { profiles: scanProfiles() } } }
      }
      requests.push({ url, body: JSON.parse(init.body) })
      return onProbe()
    },
  })
}

test('controller.probeOne posts one row, republishes the verdict and keeps the rest of its state', async () => {
  const requests = []
  const phases = []
  const controller = scanningController({
    requests,
    scanProfiles: () => [
      { profileId: 'p1', profileName: 'P1', status: 'new', credential: 'found', baseURL: 'https://a.test/v1' },
      { profileId: 'p2', profileName: 'P2', status: 'new', credential: 'found', baseURL: 'https://b.test/v1' },
    ],
    onProbe: async () => ({
      ok: true,
      async json() {
        return { results: [{ profileId: 'p1', profileName: 'P1', ok: true, reason: 'ok', httpStatus: 200, latencyMs: 20, discoveredCount: 4, addedCount: 1, modelCount: 5 }] }
      },
    }),
  })
  await controller.scan()
  controller.setSelectedIds(['p1'])
  const unsubscribe = controller.subscribe(() => phases.push(controller.getSnapshot().probes.p1?.phase))
  await controller.probeOne('p1')
  unsubscribe()

  assert.deepEqual(requests, [{ url: '/api/dsh-ccswitch/probe', body: { profileIds: ['p1'] } }])
  assert.ok(phases.includes('testing'))
  assert.ok(phases.includes('done'))
  const probe = controller.getSnapshot().probes.p1
  assert.equal(probe.phase, 'done')
  assert.equal(probe.ok, true)
  assert.equal(probe.reason, 'ok')
  assert.equal(probe.httpStatus, 200)
  assert.equal(probe.modelCount, 5)
  assert.equal(probe.latencyMs, 20)
  // Probing touches neither the selection nor the rows.
  assert.deepEqual(controller.getSnapshot().selectedIds, ['p1'])
  assert.equal(controller.getSnapshot().profiles.length, 2)
  // The other row keeps no verdict at all.
  assert.equal(controller.getSnapshot().probes.p2, undefined)
})

test('controller.probeOne refuses blocked rows and never fetches for them', async () => {
  const requests = []
  const controller = scanningController({
    requests,
    scanProfiles: () => [
      { profileId: 'p1', profileName: 'P1', status: 'blocked', credential: 'missing', baseURL: 'https://a.test/v1' },
      { profileId: 'p2', profileName: 'P2', status: 'new', credential: 'missing', baseURL: 'https://b.test/v1' },
    ],
    onProbe: async () => { throw new Error('must not be called') },
  })
  await controller.scan()
  assert.equal(await controller.probeOne('p1'), undefined)
  assert.equal(await controller.probeOne('p2'), undefined)
  assert.equal(await controller.probeOne('nope'), undefined)
  assert.deepEqual(requests, [])
  assert.deepEqual(controller.getSnapshot().probes, {})
})

test('controller.probeOne records failures and sanitizes whatever the Host sends', async () => {
  const requests = []
  let response = async () => ({
    ok: true,
    async json() { return { results: [{ profileId: 'p1', ok: 'sure', reason: 'weird', httpStatus: '401', latencyMs: -1, modelCount: 'x', message: 42 }] } },
  })
  const controller = scanningController({
    requests,
    scanProfiles: () => [{ profileId: 'p1', profileName: 'P1', status: 'new', credential: 'found', baseURL: 'https://a.test/v1' }],
    onProbe: () => response(),
  })
  await controller.scan()

  await controller.probeOne('p1')
  const sanitized = controller.getSnapshot().probes.p1
  assert.equal(sanitized.ok, false)
  assert.equal(sanitized.reason, 'network')
  assert.equal(sanitized.httpStatus, undefined)
  assert.equal(sanitized.latencyMs, 0)
  assert.equal(sanitized.modelCount, 0)
  assert.equal(sanitized.message, '')

  // A transport failure becomes an error verdict instead of an unhandled throw.
  response = async () => ({ ok: false, status: 500, async json() { return { error: 'probe failed' } } })
  assert.equal(await controller.probeOne('p1'), undefined)
  assert.equal(controller.getSnapshot().probes.p1.phase, 'error')
  assert.equal(controller.getSnapshot().probes.p1.message, 'probe failed')
  // A failed probe is not a failed panel.
  assert.equal(controller.getSnapshot().phase, 'ready')
})

test('re-scanning drops verdicts for rows that disappeared', async () => {
  const requests = []
  let rows = [
    { profileId: 'p1', profileName: 'P1', status: 'new', credential: 'found', baseURL: 'https://a.test/v1' },
    { profileId: 'p2', profileName: 'P2', status: 'new', credential: 'found', baseURL: 'https://b.test/v1' },
  ]
  const controller = scanningController({
    requests,
    scanProfiles: () => rows,
    onProbe: async () => ({ ok: true, async json() { return { results: [{ profileId: 'p1', ok: true, reason: 'ok', modelCount: 2 }] } } }),
  })
  await controller.scan()
  await controller.probeOne('p1')
  assert.equal(controller.getSnapshot().probes.p1.phase, 'done')

  rows = [{ profileId: 'p2', profileName: 'P2', status: 'new', credential: 'found', baseURL: 'https://b.test/v1' }]
  await controller.scan()
  assert.deepEqual(controller.getSnapshot().probes, {})
  assert.ok(!('p1' in controller.getSnapshot().probes))
})

// A healthy `/models` proves the key for free; when a relay refuses to list
// models, one 1-token request against the endpoint the profile really uses is
// the only honest way left to answer "does this connection work?".

test('a rejected /models falls back to one minimal request on the real endpoint', async () => {
  const calls = []
  const outcome = await probeConnection(profileRow({ api: 'openai-responses' }), {
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      if (url.endsWith('/models')) return { ok: false, status: 404, async text() { return 'no model list here' } }
      return { ok: true, status: 200, async text() { return '' } }
    },
  })

  assert.equal(outcome.ok, true)
  assert.equal(outcome.reason, PROBE_REASON.OK)
  assert.equal(outcome.check, PROBE_CHECK.MINIMAL)
  assert.deepEqual(calls.map((call) => call.url), [
    'https://upstream.test/v1/models',
    'https://upstream.test/v1/responses',
  ])
  assert.equal(calls[1].init.method, 'POST')
  assert.equal(calls[1].init.headers['content-type'], 'application/json')
  const body = JSON.parse(calls[1].init.body)
  assert.equal(body.model, 'seed-model')
  assert.equal(body.max_output_tokens, 1)
  // The listing failure is still reported — it is why the fallback ran.
  assert.equal(outcome.detail, 'no model list here')
  // No model list was read, so nothing new can be claimed.
  assert.equal(outcome.discoveredCount, 0)
  assert.equal(outcome.addedCount, 0)
})

test('each wire protocol falls back to its own endpoint and token cap', async () => {
  const cases = [
    ['openai-completions', '/chat/completions', 'max_tokens'],
    ['anthropic-messages', '/messages', 'max_tokens'],
    ['openai-responses', '/responses', 'max_output_tokens'],
  ]
  for (const [api, path, field] of cases) {
    const calls = []
    await probeConnection(profileRow({ api }), {
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return { ok: false, status: 405, async text() { return '' } }
      },
    })
    assert.equal(calls.length, 2, api)
    assert.equal(calls[1].url, `https://upstream.test/v1${path}`, api)
    const body = JSON.parse(calls[1].init.body)
    assert.equal(body.model, 'seed-model', api)
    assert.equal(body[field], 1, api)
  }
})

test('the fallback is skipped when the upstream is unreachable or has no model id', async () => {
  const offline = []
  await probeConnection(profileRow(), {
    fetchImpl: async (url) => { offline.push(url); throw new Error('connect ECONNREFUSED') },
  })
  // Retrying a dead host would only make the user wait twice as long.
  assert.deepEqual(offline, ['https://upstream.test/v1/models'])

  const noModel = []
  const outcome = await probeConnection(profileRow({ models: [] }), {
    fetchImpl: async (url) => { noModel.push(url); return { ok: false, status: 404, async text() { return '' } } },
  })
  assert.deepEqual(noModel, ['https://upstream.test/v1/models'])
  assert.equal(outcome.ok, false)
  assert.equal(outcome.check, PROBE_CHECK.NONE)
  assert.equal(outcome.httpStatus, 404)
})

test('the upstream reason survives the banner some relays print before JSON', async () => {
  // The exact shape this Host met on api.justwoker.icu.
  const body = '<upstream>{"error":{"code":"","message":"Invalid token (request id: 20261003095148)"}}'
  const calls = []
  const outcome = await probeConnection(profileRow(), {
    fetchImpl: async (url) => {
      calls.push(url)
      return { ok: false, status: 401, async text() { return body } }
    },
  })
  assert.equal(calls.length, 2, 'a 401 on /models alone is not conclusive')
  assert.equal(outcome.ok, false)
  assert.equal(outcome.check, PROBE_CHECK.NONE)
  assert.equal(outcome.httpStatus, 401)
  assert.equal(outcome.detail, 'Invalid token (request id: 20261003095148)')
  assert.match(outcome.message, /HTTP 401/)
})

test('the upstream error body is reduced to one short, plain line', async () => {
  const cases = [
    ['{"error":{"message":"bad key"}}', 'bad key'],
    ['{"error":"plain string"}', 'plain string'],
    ['{"message":"quota exceeded"}', 'quota exceeded'],
    ['unauthorized', 'unauthorized'],
    ['not json at all', 'not json at all'],
  ]
  for (const [body, expected] of cases) {
    const outcome = await probeConnection(profileRow(), {
      fetchImpl: async () => ({ ok: false, status: 403, async text() { return body } }),
    })
    assert.equal(outcome.detail, expected, body)
  }

  const long = await probeConnection(profileRow(), {
    fetchImpl: async () => ({ ok: false, status: 403, async text() { return 'x'.repeat(500) } }),
  })
  assert.equal(long.detail.length, 200, 'a chatty upstream must not flood the UI')
})

test('the import path never spends a minimal request', async () => {
  const calls = []
  const warned = await probeModels(profileRow(), {
    fetchImpl: async (url) => { calls.push(url); return { ok: false, status: 404, async text() { return 'no list' } } },
  })
  // Widening the model list needs a list; the fallback cannot provide one.
  assert.deepEqual(calls, ['https://upstream.test/v1/models'])
  assert.match(warned.warnings[0], /HTTP 404/)
})

test('the controller keeps the upstream detail and flags a Host that is behind', async () => {
  const requests = []
  const controller = scanningController({
    requests,
    scanProfiles: () => [{ profileId: 'p1', profileName: 'P1', status: 'new', credential: 'found', baseURL: 'https://a.test/v1' }],
    onProbe: async () => ({
      ok: true,
      async json() {
        return { results: [{ profileId: 'p1', ok: false, reason: 'http-error', check: 'none', httpStatus: 401, detail: 'Invalid token', latencyMs: 33, modelCount: 1, message: '模型探测失败（HTTP 401），保留源配置的模型列表' }] }
      },
    }),
  })
  await controller.scan()
  await controller.probeOne('p1')
  const verdict = controller.getSnapshot().probes.p1
  assert.equal(verdict.phase, 'done')
  assert.equal(verdict.check, 'none')
  assert.equal(verdict.detail, 'Invalid token')
  assert.equal(verdict.staleHost, undefined, 'a provider 401 is not a stale Host')

  // The Host half answering 401/404 means it never registered the route: the
  // page is running a newer client bundle than the running Host.
  for (const [status, expected] of [[401, true], [404, true], [500, false]]) {
    const stale = scanningController({
      requests: [],
      scanProfiles: () => [{ profileId: 'p1', profileName: 'P1', status: 'new', credential: 'found', baseURL: 'https://a.test/v1' }],
      onProbe: async () => ({ ok: false, status, async json() { throw new Error('not json') } }),
    })
    await stale.scan()
    await stale.probeOne('p1')
    const failed = stale.getSnapshot().probes.p1
    assert.equal(failed.phase, 'error', String(status))
    assert.equal(failed.message, `HTTP ${status}`, String(status))
    if (expected) {
      assert.equal(failed.staleHost, true, String(status))
    } else {
      assert.notEqual(failed.staleHost, true, String(status))
    }
    // A failed probe never becomes a failed panel.
    assert.equal(stale.getSnapshot().phase, 'ready')
  }
})
