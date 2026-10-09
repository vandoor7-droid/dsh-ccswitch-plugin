// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeRoutes, readJsonBody, isLoopbackRequest } from '../src/host/routes.mjs'

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

function statusOf(res) {
  return res.calls.find((call) => call[0] === 'head')[1]
}

function bodyOf(res) {
  return JSON.parse(res.calls.find((call) => call[0] === 'end')[1])
}

test('scan route returns redacted summaries without secrets', async () => {
  const routes = makeRoutes({
    scan: async () => [{
      profileId: 'p-1', profileName: 'P1', baseURL: 'https://user:secret@example.test/v1?token=secret', api: 'openai-responses',
      models: [{ id: 'm' }], modelReasoningEffort: 'high', apiKey: 'sk-SECRET-X', warnings: [],
    }],
    getProviders: async () => ({}),
    isLoopback: () => true,
  })
  const route = routes.find((item) => item.path === '/api/dsh-ccswitch/scan')
  const res = fakeRes()
  await route.handler(fakeReq(), res)
  const body = bodyOf(res)
  assert.ok(!JSON.stringify(body).includes('sk-SECRET-X'))
  assert.equal(body.profiles[0].credential, 'found')
  assert.equal(body.profiles[0].reasoningEffort, 'high')
  assert.equal(body.profiles[0].baseURL, 'https://example.test/v1')
  assert.ok(!JSON.stringify(body).includes('secret'))
})

test('scan surfaces why it found nothing, and drops unknown reasons', async () => {
  const notInstalled = makeRoutes({
    scan: async () => ({ profiles: [], reason: 'not-installed', dbPath: '/Users/u/.cc-switch/cc-switch.db' }),
    isLoopback: () => true,
  }).find((item) => item.path === '/api/dsh-ccswitch/scan')
  const res = fakeRes()
  await notInstalled.handler(fakeReq(), res)
  assert.equal(bodyOf(res).source, 'not-installed')
  assert.equal(bodyOf(res).probedPath, '/Users/u/.cc-switch/cc-switch.db')

  const bogus = makeRoutes({
    scan: async () => ({ profiles: [], reason: 'i-am-not-a-reason', dbPath: '/x' }),
    isLoopback: () => true,
  }).find((item) => item.path === '/api/dsh-ccswitch/scan')
  const bogusRes = fakeRes()
  await bogus.handler(fakeReq(), bogusRes)
  assert.equal(bodyOf(bogusRes).source, undefined)
  assert.equal(bodyOf(bogusRes).probedPath, undefined)
})

test('route failures return fixed safe messages', async () => {
  const routes = makeRoutes({
    scan: async () => { throw new Error('provider token=not-sk-shaped-secret') },
    isLoopback: () => true,
  })
  const route = routes.find((item) => item.path === '/api/dsh-ccswitch/scan')
  const res = fakeRes()
  await route.handler(fakeReq(), res)
  assert.deepEqual(bodyOf(res), { error: 'scan failed' })
})

test('import route forwards only selected IDs and revision', async () => {
  let received
  const routes = makeRoutes({
    scan: async () => [{ profileId: 'p-1', profileName: 'P1', apiKey: 'sk-SECRET-X', models: [] }],
    settings: {},
    credentials: {},
    importProfiles: async (args) => { received = args; return [{ profileId: 'p-1', providerKey: 'ccs-p1-aaaaaaaa', status: 'new' }] },
    isLoopback: () => true,
  })
  const route = routes.find((item) => item.path === '/api/dsh-ccswitch/import')
  const req = withBody(fakeReq({ method: 'POST', url: '/api/dsh-ccswitch/import', headers: { host: '127.0.0.1:5624', origin: 'http://127.0.0.1:5624', 'content-type': 'application/json' } }), JSON.stringify({ profileIds: ['p-1'], expectedRevision: 3, profile: { apiKey: 'sk-DO-NOT-TRUST' } }))
  const res = fakeRes()
  await route.handler(req, res)
  assert.deepEqual(received.selectedIds, ['p-1'])
  assert.equal(received.expectedRevision, 3)
  assert.ok(!JSON.stringify(received).includes('sk-DO-NOT-TRUST'))
  assert.equal(bodyOf(res).results[0].status, 'new')
})

test('import errors redact credentials by value, not just by shape', async () => {
  // Deliberately short and not `sk-` shaped: only value-based redaction catches it.
  const relayKey = 'relay-key-ABCdef123'
  const routes = makeRoutes({
    scan: async () => [{ profileId: 'p-1', profileName: 'P1', apiKey: relayKey, models: [] }],
    settings: {},
    credentials: {},
    importProfiles: async () => ([{
      profileId: 'p-1', providerKey: 'ccs-p1-aaaaaaaa', status: 'failed',
      error: `设置写入失败：relay rejected ${relayKey} for tenant`,
    }]),
    isLoopback: () => true,
  })
  const route = routes.find((item) => item.path === '/api/dsh-ccswitch/import')
  const req = withBody(fakeReq({ method: 'POST', url: '/api/dsh-ccswitch/import', headers: { host: '127.0.0.1:5624', origin: 'http://127.0.0.1:5624' } }), JSON.stringify({ profileIds: ['p-1'] }))
  const res = fakeRes()
  await route.handler(req, res)
  const raw = res.calls.find((call) => call[0] === 'end')[1]
  assert.ok(!raw.includes(relayKey), 'import response leaked an unknown-shaped credential')
  assert.ok(raw.includes('[redacted]'))
  assert.equal(bodyOf(res).results[0].status, 'failed')
})

test('import errors still fall back to shape redaction for unknown profiles', async () => {
  const longToken = 'A'.repeat(40)
  const routes = makeRoutes({
    scan: async () => [{ profileId: 'other', profileName: 'Other', apiKey: 'sk-x-aaaaaaaaaaaa', models: [] }],
    settings: {},
    credentials: {},
    importProfiles: async () => ([{ profileId: 'p-1', status: 'failed', error: `boom ${longToken}` }]),
    isLoopback: () => true,
  })
  const route = routes.find((item) => item.path === '/api/dsh-ccswitch/import')
  const req = withBody(fakeReq({ method: 'POST', url: '/api/dsh-ccswitch/import', headers: { host: '127.0.0.1:5624', origin: 'http://127.0.0.1:5624' } }), JSON.stringify({ profileIds: ['p-1'] }))
  const res = fakeRes()
  await route.handler(req, res)
  assert.ok(!res.calls.find((call) => call[0] === 'end')[1].includes(longToken))
})

test('a state-changing request may prove it is same-origin in three ways', async () => {
  const routes = makeRoutes({
    scan: async () => [],
    importProfiles: async () => [],
    isLoopback: () => true,
  })
  const route = routes.find((item) => item.path === '/api/dsh-ccswitch/import')
  const post = async (headers) => {
    const req = withBody(
      fakeReq({ method: 'POST', url: '/api/dsh-ccswitch/import', headers: { host: '127.0.0.1:5624', ...headers } }),
      JSON.stringify({ profileIds: [] }),
    )
    const res = fakeRes()
    await route.handler(req, res)
    return res
  }

  // Browsers may omit `Origin` on a same-origin POST but always set this.
  assert.equal(statusOf(await post({ 'sec-fetch-site': 'same-origin' })), 200)
  // Both our own client writes send this marker.
  assert.equal(statusOf(await post({ 'x-dsh-ccswitch-origin': 'same-origin' })), 200)
  assert.equal(statusOf(await post({ origin: 'http://127.0.0.1:5624' })), 200)

  // No proof at all: rejected, and the body says what actually arrived.
  const bare = await post({})
  assert.equal(statusOf(bare), 403)
  assert.match(bodyOf(bare).error, /app page/)
  assert.deepEqual(bodyOf(bare).saw, { origin: false, site: null, marker: false })
})

test('a probe request never delays the plain import path', async () => {
  let probed = false
  const routes = makeRoutes({
    scan: async () => [{ profileId: 'p-1', profileName: 'P1', apiKey: 'sk-a-aaaaaaaaaaaa', baseURL: 'https://x/v1', api: 'openai-completions', models: [{ id: 'm' }] }],
    settings: {},
    credentials: {},
    importProfiles: async () => { probed = true; return [{ profileId: 'p-1', status: 'new' }] },
    isLoopback: () => true,
  })
  const route = routes.find((item) => item.path === '/api/dsh-ccswitch/import')
  const req = withBody(fakeReq({ method: 'POST', url: '/api/dsh-ccswitch/import', headers: { host: '127.0.0.1:5624', origin: 'http://127.0.0.1:5624' } }), JSON.stringify({ profileIds: ['p-1'] }))
  const res = fakeRes()
  await route.handler(req, res)
  assert.equal(probed, true)
  assert.equal(statusOf(res), 200)
})

test('loopback and same-origin fences reject unsafe requests', () => {
  assert.equal(isLoopbackRequest(fakeReq()), true)
  assert.equal(isLoopbackRequest(fakeReq({ socket: { remoteAddress: '10.0.0.5' } })), false)
  assert.equal(isLoopbackRequest(fakeReq({ headers: {} })), false)
  assert.equal(isLoopbackRequest(fakeReq({ headers: { host: '127.0.0.1:5624', 'sec-fetch-site': 'cross-site' } })), false)
  assert.equal(isLoopbackRequest(fakeReq({ headers: { host: '127.0.0.1:5624', origin: 'http://127.0.0.1:9999' } })), false)
})

test('readJsonBody caps size and tolerates garbage', async () => {
  const big = { [Symbol.asyncIterator]: async function* () { yield Buffer.alloc(64 * 1024 + 1, 'a') } }
  assert.equal(await readJsonBody(big), undefined)
  const garbage = { [Symbol.asyncIterator]: async function* () { yield Buffer.from('not json') } }
  assert.equal(await readJsonBody(garbage), undefined)
  const ok = { [Symbol.asyncIterator]: async function* () { yield Buffer.from('{"a":1}') } }
  assert.deepEqual(await readJsonBody(ok), { a: 1 })
})

test('readJsonBody tears down the socket on an oversized body', async () => {
  let destroyed = false
  const big = {
    destroy() { destroyed = true },
    [Symbol.asyncIterator]: async function* () { yield Buffer.alloc(64 * 1024 + 1, 'a') },
  }
  assert.equal(await readJsonBody(big), undefined)
  assert.equal(destroyed, true)
})
