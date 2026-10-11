// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * The sidecar's `GET /api/env` — `{ name, version, homeDir, configDir }`.
 *
 * cc-switch's own headless fork asks the server for these rather than guessing
 * in the renderer, because in a browser neither the home directory nor the
 * config directory is knowable: they describe **the machine running the
 * sidecar**, which is the whole point of having one. We keep that contract.
 *
 * Transport is the plugin's own bridge route, never a direct call to the
 * sidecar — the token lives on the host side, and DSH's origin fence only
 * recognises the plugin's routes. `{ cmd: '__env' }` is the one body the bridge
 * resolves by GET-ing `/api/env` instead of POST-ing `/api/invoke`.
 *
 * Two properties this must keep:
 *
 * 1. **Failures resolve, not throw.** Until the host registers the bridge
 *    route (P4) every call here fails, and `App.tsx` mounts long before that.
 *    A throwing `getVersion()` would blank the About page; a throwing
 *    `homeDir()` would take down the directory settings panel. Callers that
 *    need a value check for it; callers that already have a try/catch (the
 *    directory defaults, `useDirectorySettings.ts:67`) keep working with no
 *    defaults shown, which is the honest state — we do not know the path.
 * 2. **One request.** The env is immutable for the life of the process, so it
 *    is fetched once and reused; a page that reads it in ten places should not
 *    make ten round trips.
 */
import { readJson, writeHeaders } from '../http.mjs'
import { BRIDGE_PATH } from './core.mjs'

/** Resolved once; `undefined` means "not fetched yet", `null` means "failed". */
let inflight = null
let settled

function requestEnv(fetchImpl) {
  return fetchImpl(BRIDGE_PATH, {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify({ cmd: '__env' }),
  }).then(async (response) => {
    if (!response.ok) return null
    return await readJson(response)
  }).catch(() => null)
}

/**
 * The sidecar's environment, or `null` when it cannot be reached.
 *
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{name?: string, version?: string, homeDir?: string, configDir?: string} | null>}
 */
export function serverEnv(fetchImpl = (url, init) => globalThis.fetch(url, init)) {
  if (settled) return Promise.resolve(settled)
  if (!inflight) {
    inflight = requestEnv(fetchImpl).then((env) => {
      settled = env ?? null
      inflight = null
      return settled
    })
  }
  return inflight
}

/** Test seam: drop the memo so a fake `fetch` can observe the next call. */
export function resetServerEnv() {
  settled = undefined
  inflight = null
}
