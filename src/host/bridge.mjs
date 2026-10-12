// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The bridge route: one path every cc-switch command travels on its way to the
 * sidecar.
 *
 * DSH's web server matches `exact` and `prefix` paths only — there are no path
 * parameters — so a route per command would mean ~300 registrations for no
 * gain. One route whose body names the command fits the constraint the rest of
 * this plugin already follows (the provider key travels in the body too).
 *
 * The browser never talks to the sidecar. It talks to this plugin's route, and
 * this route talks to the sidecar: that keeps the sidecar's bearer token on the
 * host side only, keeps DSH's same-origin fence in front of every call, and
 * gives one place to answer for a sidecar that is still starting or has gone
 * away — rather than a network error surfacing in a table cell.
 *
 * What travels through here is cc-switch's own payload, unchanged: the sidecar
 * speaks `{"ok": true, "data"}` / `{"ok": false, "error"}` and the client
 * expects exactly that. Nothing is projected on the way through, because the
 * point of not rewriting cc-switch's backend is that its shapes are already
 * right.
 *
 * **Secrets.** cc-switch stores provider keys inline in `settingsConfig`, and
 * its editor shows that JSON. DSH's standing rule is that a secret never
 * reaches the browser, so responses are redacted here before they go out (see
 * {@link redactSecrets}) and writes are filled back in from the host's own
 * credential store. That costs the raw JSON editor its view of a key — the user
 * retypes to change one — and it is the one place this port knowingly departs
 * from the desktop experience.
 */

import {
  isLoopbackRequest,
  methodFence,
  readJsonBody,
  writeJson,
} from './routes.mjs'

/**
 * The single path the client half posts to.
 *
 * Spelled out here as well as in `src/client/tauri-shim/core.mjs` because those
 * two files cannot import each other (the client half is a browser bundle, this
 * one reaches `node:sqlite`), and a silent mismatch would show up as every
 * command 404ing — which reads like the sidecar is down. `test/client-host-contract.test.mjs`
 * asserts the two copies agree.
 */
export const BRIDGE_PATH = '/api/dsh-ccswitch-bridge'

/** The body this route accepts, matching `src/client/tauri-shim/core.mjs`. */
export function parseBridgeBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const cmd = body.cmd
  if (typeof cmd !== 'string' || cmd.trim() === '') return null
  const args = body.args === undefined ? {} : body.args
  return { cmd, args: args === null || typeof args === 'object' ? args : {} }
}

/**
 * Replace any value that looks like an API key with a presence marker.
 *
 * cc-switch inlines keys into `settingsConfig`, so a provider row cannot be
 * returned to the browser without walking it. The marker keeps what the UI
 * actually needs — "is there a key" — and drops the value itself. A key is
 * matched by the field name, not by shape: a regex over values would have to
 * decide what a key looks like across a dozen providers and would leak the
 * ones that look unusual.
 */
const SECRET_KEYS = new Set([
  'apikey',
  'api_key',
  'api-key',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'clientsecret',
  'client_secret',
  'password',
  'secret',
  'anthropic_auth_token',
  'anthropic_api_key',
])

/** The marker substituted for a redacted value. */
export const REDACTED = '<redacted>'

function isSecretKey(key) {
  return SECRET_KEYS.has(String(key).toLowerCase().replaceAll('-', '_').replaceAll('-', '_'))
}

/**
 * Deep-copy `value`, replacing every secret-bearing field with {@link REDACTED}.
 *
 * An empty or absent key is left as-is: "not configured" is information the
 * form needs, and a placeholder there would say a key exists when it does not.
 */
export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (isSecretKey(key) && typeof entry === 'string' && entry !== '') {
      out[key] = REDACTED
    } else {
      out[key] = redactSecrets(entry)
    }
  }
  return out
}

/**
 * Redact only what this route returns to the browser.
 *
 * Errors are left alone: cc-switch's messages name fields and files, and a
 * redacted error is a useless one. This is why the redaction lives here rather
 * than in the client — the client cannot tell a payload from a message.
 */
function redactEnvelope(payload) {
  if (payload === null || typeof payload !== 'object') return payload
  if (payload.ok === true) return { ...payload, data: redactSecrets(payload.data) }
  return payload
}

/**
 * Build the routes this plugin registers.
 *
 * @param {object} deps
 * @param {() => Promise<{ origin: string, token: string } | null>} deps.sidecar -
 *   resolves the running sidecar's origin and bearer token, or `null` when it
 *   is not up yet.
 * @param {typeof fetch} [deps.fetchImpl]
 */
export function makeBridgeRoutes({ sidecar, fetchImpl = globalThis.fetch }) {
  if (typeof sidecar !== 'function') throw new TypeError('makeBridgeRoutes: sidecar resolver is required')

  return [
    {
      kind: 'exact',
      path: BRIDGE_PATH,
      handler: async (request, response) => {
        // `methodFence` answers the request itself and returns `true` only when
        // the caller may proceed.
        const allowed = methodFence(request, response, isLoopbackRequest, 'POST', {
          requireSameOrigin: true,
        })
        if (!allowed) return

        const target = await sidecar()
        if (!target) {
          // Distinguish "not up" from "up and said no": the first is a wait,
          // the second is a real answer, and the UI should not blur them.
          writeJson(response, 503, {
            ok: false,
            error: 'sidecar is not ready yet',
            reason: 'sidecar-starting',
          })
          return
        }

        const body = await readJsonBody(request)
        const parsed = parseBridgeBody(body)
        if (!parsed) {
          writeJson(response, 400, {
            ok: false,
            error: 'bridge body must carry a non-empty string `cmd`',
            reason: 'bad-bridge-body',
          })
          return
        }

        let upstream
        try {
          upstream = await fetchImpl(`${target.origin}/api/invoke`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${target.token}`,
            },
            body: JSON.stringify({ cmd: parsed.cmd, args: parsed.args }),
          })
        } catch {
          // A sidecar that vanished mid-flight is the same as one that is not
          // up: the caller waits and retries. Neither is a 500 from *us*.
          writeJson(response, 503, {
            ok: false,
            error: 'sidecar is not reachable',
            reason: 'sidecar-unreachable',
          })
          return
        }

        const payload = await upstream.json().catch(() => null)
        writeJson(response, upstream.status, redactEnvelope(payload) ?? { ok: false, error: 'empty reply' })
      },
    },
  ]
}
