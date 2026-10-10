// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * `@tauri-apps/api/core` for a plugin that has no Tauri.
 *
 * `scripts/build.mjs` aliases this module onto `@tauri-apps/api/core`, so a
 * component copied verbatim out of cc-switch keeps its
 * `import { invoke } from '@tauri-apps/api/core'` and simply ends up here. The
 * only thing that changes is what `invoke` does: instead of an IPC round trip
 * into the Rust backend it issues one HTTP request to this plugin's own routes
 * (`./commands.mjs` holds the table).
 *
 * Three properties matter more than the plumbing:
 *
 * 1. **An unmapped command throws.** `UnmappedCommandError` names the command
 *    and points at `docs/ccswitch-command-map.md`. Returning `undefined` would
 *    be indistinguishable from "the backend answered with nothing", and the
 *    component would render a blank row as though it were real data.
 * 2. **A Host error rejects.** cc-switch's `invoke` rejects with the Rust
 *    error string; this does the same with the Host's `error` field, carrying
 *    `status` and `reason` so a caller can still tell a conflict from a bad
 *    request — the distinction the plugin's own controllers depend on.
 * 3. **No state.** The table is data and the transport is one function, so a
 *    test can drive any command with a fake `fetch` and assert the exact
 *    request that went out.
 */
import { readJson, writeHeaders } from '../http.mjs'
import { INVOKE_ROUTES } from './commands.mjs'

/** Raised when a command has no entry in the route table. */
export class UnmappedCommandError extends Error {
  constructor(command) {
    super(
      `no route is mapped for the cc-switch command "${command}"; `
      + 'see docs/ccswitch-command-map.md for its disposition and '
      + 'src/client/tauri-shim/commands.mjs to add it',
    )
    this.name = 'UnmappedCommandError'
    this.command = command
  }
}

function defaultFetch(url, init) {
  return globalThis.fetch(url, init)
}

/**
 * One Host request.
 *
 * Method and headers are decided here rather than by each caller: a GET must
 * not carry the same-origin marker (it is only meaningful on a state-changing
 * request, and sending it would suggest a proof the request is not making), and
 * every POST must, or the Host's fence refuses it.
 */
async function requestOnce({ path, method = 'POST', body }, fetchImpl) {
  const init = { method }
  if (method !== 'GET') init.headers = writeHeaders()
  if (body !== undefined) init.body = JSON.stringify(body)
  const response = await fetchImpl(path, init)
  const payload = await readJson(response)
  if (!response.ok) {
    const message = typeof payload?.error === 'string' && payload.error !== ''
      ? payload.error
      : `HTTP ${response.status}`
    throw Object.assign(new Error(message), {
      status: response.status,
      reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
      errors: Array.isArray(payload?.errors) ? payload.errors : undefined,
    })
  }
  return payload ?? {}
}

/**
 * Build an `invoke` bound to one `fetch`.
 *
 * Exported so a test can drive the whole table with a fake without reaching for
 * the global, and so a future caller could scope a different transport (a
 * `ctx.remote` bridge, say) without touching the table.
 */
export function createInvoke({ fetchImpl = defaultFetch, routes = INVOKE_ROUTES } = {}) {
  const request = (spec) => requestOnce(spec, fetchImpl)
  return async function invoke(command, args = {}) {
    const route = Object.hasOwn(routes, command) ? routes[command] : undefined
    if (route === undefined) throw new UnmappedCommandError(command)
    const ctx = { args: args ?? {}, request }
    const isRead = (route.method ?? 'POST') === 'GET'
    const body = isRead
      ? undefined
      : typeof route.send === 'function'
        ? await route.send(ctx.args, ctx)
        : ctx.args
    const payload = await request({ path: route.path, method: route.method ?? 'POST', body })
    return typeof route.receive === 'function' ? await route.receive(payload, ctx) : payload
  }
}

/** The instance the aliased `@tauri-apps/api/core` hands to copied components. */
export const invoke = createInvoke()
