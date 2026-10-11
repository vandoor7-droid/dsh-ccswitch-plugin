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

/**
 * The single route every command travels once the sidecar bridge is live.
 *
 * DSH's web server matches only `exact` and `prefix` — there are no path
 * parameters — so "one exact route per command" would mean 328 registrations
 * for no gain. One route whose body carries `{ cmd, args }` fits the same
 * constraint the rest of this plugin already follows (the provider key travels
 * in the body, never in the path).
 *
 * The switch is `bridge: true` in {@link createInvoke}; it stays `false` until
 * `src/host` registers this route and supervises the sidecar (P2), because
 * flipping it early would point every list read at a route that answers 404.
 * Under `bridge` the table's `send`/`receive` projections are skipped
 * deliberately: the sidecar speaks cc-switch's own argument and result shapes
 * natively, which is the whole point of not rewriting it.
 */
export const BRIDGE_PATH = '/api/dsh-ccswitch-bridge'

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
 * the global, and so a caller can scope a different transport without touching
 * the table.
 *
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {object} [options.routes] - defaults to {@link INVOKE_ROUTES}.
 * @param {boolean} [options.bridge] - send every non-local command to
 *   {@link BRIDGE_PATH} as `{ cmd, args }` and return the sidecar's answer
 *   verbatim. Local `run` entries still win: they are this plugin's DSH-specific
 *   overrides (`update_tray_menu`, `get_current_provider`, the probe), and the
 *   sidecar's answers to those either do not apply to DSH or are the very
 *   semantics we retired.
 */
export function createInvoke({ fetchImpl = defaultFetch, routes = INVOKE_ROUTES, bridge = false } = {}) {
  const request = (spec) => requestOnce(spec, fetchImpl)
  return async function invoke(command, args = {}) {
    const route = Object.hasOwn(routes, command) ? routes[command] : undefined
    if (route === undefined) throw new UnmappedCommandError(command)
    const ctx = { args: args ?? {}, request }
    // A local answer, for the commands that have no route — see the note on
    // `update_tray_menu` in ./commands.mjs. These stay local even in bridge
    // mode; see the `bridge` option above.
    if (typeof route.run === 'function') return await route.run(ctx.args, ctx)
    if (bridge) {
      // No `send`/`receive`: the sidecar already speaks cc-switch's own shapes,
      // which is the entire reason for not rewriting its backend in JS.
      return request({ path: BRIDGE_PATH, method: 'POST', body: { cmd: command, args: ctx.args } })
    }
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

/**
 * Whether this is running inside Tauri. It is not, and saying so is the truth
 * rather than a stub — code branches on it to choose a native path or a web
 * one, and the web path is the correct one inside a DSH settings page.
 */
export function isTauri() {
  return false
}

/**
 * Tauri's streaming channel: Rust pushes chunks into `channel.onmessage`.
 *
 * There is no Rust on the other side and no event bus to carry the chunks yet
 * (`./event.mjs` is the same story), so the constructor refuses rather than
 * accepting a handler it will never call — a session reader given an inert
 * channel would wait forever on an empty transcript, which is a silent failure
 * dressed up as an empty result. M6 builds the `ctx.remote` bridge this needs;
 * until then the only caller (`lib/api/sessions.ts`) fails loudly on use, not
 * on import.
 */
export class Channel {
  constructor() {
    throw new Error(
      'Tauri Channels are not available in this plugin: session streaming has to be '
      + 'bridged over ctx.remote first (M6), see src/client/tauri-shim/event.mjs',
    )
  }
}
