// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * The one definition of "how this browser half talks to the Host half".
 *
 * Two things live here because they must never drift between callers:
 *
 * 1. **The same-origin header.** A browser is free to omit `Origin` on a
 *    same-origin POST, and the Host's `methodFence` accepts this header in its
 *    place. The value is duplicated from `src/host/routes.mjs` rather than
 *    imported: that module reaches the scan core and therefore `node:sqlite`,
 *    which cannot be bundled for the browser. `test/client-host-contract.test.mjs`
 *    is what keeps the two copies honest.
 * 2. **Body reading.** Every route answers JSON, and every caller wants the
 *    same "unreadable body is `undefined`, not a throw" behaviour so a 500 HTML
 *    page degrades to the status line instead of a parse error.
 */

/** The header the Host accepts in place of an `Origin` header. */
export const SAME_ORIGIN_HEADER = 'x-dsh-ccswitch-origin'
export const SAME_ORIGIN_VALUE = 'same-origin'

/**
 * Headers for every state-changing request.
 *
 * A browser is free to omit `Origin` on a same-origin POST — it does — so a
 * Host that *requires* one turns every click into `missing Origin`. The marker
 * header is the third of three equivalent proofs (the others are `Origin`
 * matching `Host` and the unforgeable `Sec-Fetch-Site: same-origin`). A
 * cross-site page cannot forge it: a custom header forces a CORS preflight that
 * the Host never answers.
 */
export function writeHeaders() {
  return { 'content-type': 'application/json', [SAME_ORIGIN_HEADER]: SAME_ORIGIN_VALUE }
}

/**
 * Read a response body as JSON, or `undefined` when there is nothing to read.
 *
 * Never throws: a proxy error page or an empty 204 is reported by the caller
 * through the status code, and inventing a parse failure on top of it would
 * name the wrong problem.
 */
export async function readJson(response) {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}
