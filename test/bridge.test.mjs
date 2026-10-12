// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The bridge route.
 *
 * Two things here are worth a test more than the plumbing is. The first is the
 * path: `src/client/tauri-shim/core.mjs` and this host half cannot import each
 * other, so they spell the same constant twice, and a mismatch would look like
 * a dead sidecar rather than a typo. The second is the redaction: cc-switch
 * inlines API keys into `settingsConfig`, so anything this route hands back has
 * to be walked before the browser sees it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { BRIDGE_PATH, makeBridgeRoutes, parseBridgeBody, redactSecrets, REDACTED } from '../src/host/bridge.mjs'
import { SAME_ORIGIN_HEADER, SAME_ORIGIN_VALUE } from '../src/host/routes.mjs'
import { BRIDGE_PATH as CLIENT_BRIDGE_PATH } from '../src/client/tauri-shim/core.mjs'

/** A request `readJsonBody` and `methodFence` accept. */
function fakeRequest({ method = 'POST', body = '{}', headers = {} } = {}) {
  const stream = Readable.from([Buffer.from(body)])
  stream.method = method
  stream.socket = { remoteAddress: '127.0.0.1' }
  stream.headers = {
    // `isLoopbackRequest` checks the Host header as well as the peer address —
    // both have to say loopback before anything else is looked at.
    host: '127.0.0.1:19387',
    [SAME_ORIGIN_HEADER]: SAME_ORIGIN_VALUE,
    'content-type': 'application/json',
    ...headers,
  }
  return stream
}

function fakeResponse() {
  return {
    statusCode: undefined,
    body: undefined,
    ended: false,
    writeHead(status, _headers) {
      this.statusCode = status
      return this
    },
    end(payload) {
      this.ended = true
      this.body = payload === undefined ? undefined : JSON.parse(payload)
    },
  }
}

function fakeFetch(handler) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    const result = await handler({ url, init }, calls.length - 1)
    return {
      status: result?.status ?? 200,
      json: async () => result?.body,
    }
  }
  fn.calls = calls
  return fn
}

test('the host and the client spell the bridge path identically', () => {
  // These two halves cannot import each other: the client is a browser bundle
  // and this one reaches node:sqlite. A silent mismatch turns every command
  // into a 404, which reads like "the sidecar is down".
  assert.equal(BRIDGE_PATH, CLIENT_BRIDGE_PATH)
  assert.equal(BRIDGE_PATH, '/api/dsh-ccswitch-bridge')
})

test('the bridge body needs a non-empty string cmd and passes args through', () => {
  assert.deepEqual(parseBridgeBody({ cmd: 'get_providers', args: { app: 'dsh' } }), {
    cmd: 'get_providers',
    args: { app: 'dsh' },
  })
  // No args is the common case for a read; it must not turn into a missing field.
  assert.deepEqual(parseBridgeBody({ cmd: 'get_providers' }), { cmd: 'get_providers', args: {} })
  assert.equal(parseBridgeBody({ args: {} }), null)
  assert.equal(parseBridgeBody({ cmd: '   ' }), null)
  assert.equal(parseBridgeBody([]), null)
  assert.equal(parseBridgeBody(null), null)
})

test('a command is forwarded to the sidecar and its answer comes back verbatim', async () => {
  const fetchImpl = fakeFetch(() => ({
    status: 200,
    body: { ok: true, data: { 'ccs-a-11111111': { name: 'DeepSeek' } } },
  }))
  const [route] = makeBridgeRoutes({
    sidecar: async () => ({ origin: 'http://127.0.0.1:15881', token: 'tok' }),
    fetchImpl,
  })

  const response = fakeResponse()
  await route.handler(fakeRequest({ body: JSON.stringify({ cmd: 'get_providers', args: { app: 'dsh' } }) }), response)

  assert.equal(response.statusCode, 200)
  assert.equal(fetchImpl.calls[0].url, 'http://127.0.0.1:15881/api/invoke')
  // The token lives on the host side only — it is never part of what the
  // browser sends or sees.
  assert.equal(fetchImpl.calls[0].init.headers.authorization, 'Bearer tok')
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), { cmd: 'get_providers', args: { app: 'dsh' } })
  assert.deepEqual(response.body, { ok: true, data: { 'ccs-a-11111111': { name: 'DeepSeek' } } })
})

test('a secret never reaches the browser, but its presence does', async () => {
  const fetchImpl = fakeFetch(() => ({
    status: 200,
    body: {
      ok: true,
      data: {
        'ccs-a-11111111': {
          name: 'DeepSeek',
          settingsConfig: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-live-abcdef', ANTHROPIC_BASE_URL: 'https://api.test' } },
          meta: { notes: 'keep me' },
        },
      },
    },
  }))
  const [route] = makeBridgeRoutes({
    sidecar: async () => ({ origin: 'http://127.0.0.1:15881', token: 'tok' }),
    fetchImpl,
  })

  const response = fakeResponse()
  await route.handler(fakeRequest({ body: '{"cmd":"get_providers"}' }), response)

  const row = response.body.data['ccs-a-11111111']
  assert.equal(row.settingsConfig.env.ANTHROPIC_AUTH_TOKEN, REDACTED)
  // The form still needs to know a key is set, and non-secret fields survive.
  assert.notEqual(row.settingsConfig.env.ANTHROPIC_AUTH_TOKEN, 'sk-live-abcdef')
  assert.equal(row.settingsConfig.env.ANTHROPIC_BASE_URL, 'https://api.test')
  assert.equal(row.meta.notes, 'keep me')
  assert.ok(!JSON.stringify(response.body).includes('sk-live-abcdef'), 'the key must not appear anywhere in the payload')
})

test('an empty key stays empty — "not configured" is information, not a secret', () => {
  const out = redactSecrets({ settingsConfig: { env: { ANTHROPIC_AUTH_TOKEN: '' } } })
  assert.equal(out.settingsConfig.env.ANTHROPIC_AUTH_TOKEN, '')
})

test('an error payload is not redacted', async () => {
  // Redacting a message leaves the user with nothing to act on; errors name
  // fields and files, not credentials.
  const fetchImpl = fakeFetch(() => ({
    status: 200,
    body: { ok: false, error: 'provider ccs-a-11111111 has no ANTHROPIC_AUTH_TOKEN' },
  }))
  const [route] = makeBridgeRoutes({
    sidecar: async () => ({ origin: 'http://127.0.0.1:15881', token: 'tok' }),
    fetchImpl,
  })

  const response = fakeResponse()
  await route.handler(fakeRequest({ body: '{"cmd":"get_providers"}' }), response)
  assert.equal(response.body.error, 'provider ccs-a-11111111 has no ANTHROPIC_AUTH_TOKEN')
})

test('a sidecar that is not up yet is 503, not a broken request', async () => {
  const fetchImpl = fakeFetch(() => {
    throw new Error('should not be called')
  })
  const [route] = makeBridgeRoutes({ sidecar: async () => null, fetchImpl })

  const response = fakeResponse()
  await route.handler(fakeRequest({ body: '{"cmd":"get_providers"}' }), response)

  assert.equal(response.statusCode, 503)
  assert.equal(response.body.reason, 'sidecar-starting')
  assert.equal(fetchImpl.calls.length, 0)
})

test('a sidecar that vanished mid-flight is 503 too', async () => {
  const fetchImpl = fakeFetch(() => {
    throw new Error('ECONNREFUSED')
  })
  const [route] = makeBridgeRoutes({
    sidecar: async () => ({ origin: 'http://127.0.0.1:15881', token: 'tok' }),
    fetchImpl,
  })

  const response = fakeResponse()
  await route.handler(fakeRequest({ body: '{"cmd":"get_providers"}' }), response)

  assert.equal(response.statusCode, 503)
  assert.equal(response.body.reason, 'sidecar-unreachable')
})

test('a body without a cmd is refused before anything is forwarded', async () => {
  const fetchImpl = fakeFetch(() => {
    throw new Error('should not be called')
  })
  const [route] = makeBridgeRoutes({
    sidecar: async () => ({ origin: 'http://127.0.0.1:15881', token: 'tok' }),
    fetchImpl,
  })

  const response = fakeResponse()
  await route.handler(fakeRequest({ body: '{"args":{}}' }), response)

  assert.equal(response.statusCode, 400)
  assert.equal(fetchImpl.calls.length, 0)
})

test('a request with no same-origin proof is refused by the shared fence', async () => {
  const fetchImpl = fakeFetch(() => {
    throw new Error('should not be called')
  })
  const [route] = makeBridgeRoutes({
    sidecar: async () => ({ origin: 'http://127.0.0.1:15881', token: 'tok' }),
    fetchImpl,
  })

  const response = fakeResponse()
  // No Origin, no sec-fetch-site, no marker: the fence has nothing to go on.
  await route.handler(fakeRequest({ body: '{"cmd":"get_providers"}', headers: { [SAME_ORIGIN_HEADER]: '' } }), response)

  assert.equal(response.statusCode, 403)
  assert.equal(fetchImpl.calls.length, 0)
})
