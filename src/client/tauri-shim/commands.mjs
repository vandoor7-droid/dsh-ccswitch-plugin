// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * The route each cc-switch Tauri command is answered by.
 *
 * cc-switch's frontend calls `invoke("<command>", args)` from
 * `@tauri-apps/api/core`. The plugin has no Tauri IPC, so that call is
 * redirected here by an esbuild `alias` (see `scripts/build.mjs`) onto the
 * plugin's own HTTP routes. **This is the one layer that must change**; every
 * other line of a copied component compiles untouched, which is what decision
 * #7 ("reuse the original code unless the stack forces a rewrite") asks for.
 *
 * An entry has one of two shapes — either it goes to a Host route:
 *
 * ```js
 * {
 *   path: '/api/…',          // exact route; DSH has no path parameters
 *   method: 'GET' | 'POST',
 *   send?:    (args, ctx) => body | undefined   // defaults to `args`
 *   receive?: (body, ctx) => result             // defaults to the body as-is
 * }
 * ```
 *
 * or it is answered locally, because there is no route and inventing a round
 * trip to hide that would be worse than saying so:
 *
 * ```js
 * { run: (args, ctx) => result }
 * ```
 *
 * For either shape, `ctx` is `{ args, request }` — `args` is what the component
 * passed, and `request({ path, method, body })` performs one Host call, so an
 * entry may make a second one when it has to.
 *
 * **A command with no entry throws.** A silent no-op would read as success and
 * is the failure mode that costs the most to find, so the table is allowed to
 * be incomplete but never allowed to guess. `docs/ccswitch-command-map.md`
 * records the disposition of all 328 commands; entries are added here as the
 * corresponding surfaces are ported.
 *
 * Two translation rules run through every entry:
 *
 * - **`id` ↔ `key`.** cc-switch addresses a row by its UUID; the plugin
 *   addresses it by a key derived from the display name. `resolveKey` reads
 *   the catalogue once per call rather than keeping a session-long cache a
 *   delete could stale, and `add_provider` stamps `sourceProfileId` so a row
 *   created through the copied form is addressable on the next call.
 * - **`{ app }` is dropped.** This plugin manages one app (decision #3), so no
 *   entry forwards it; the per-app branches in the copied components are
 *   reached only through `appType`, which is a label and drives nothing.
 */

// The one place a flat record becomes cc-switch's `Provider`; see the note on
// `get_providers` below.
import { toCardProviders } from '../provider-shape.mjs'

export const MANAGER_API = '/api/dsh-ccswitch-manager'
export const IMPORT_API = '/api/dsh-ccswitch'
export const PROVIDERS_PATH = `${MANAGER_API}/providers`

/**
 * cc-switch's `StreamCheckConfig::degraded_threshold_ms` default.
 *
 * `services/stream_check.rs` classifies `latency <= threshold` as operational
 * and anything above it as degraded; the default is 6000 ms, with an 8 s
 * timeout (the comment there notes both were cut down from an older real-
 * request check). Transcribed rather than tuned, so a probe that cc-switch
 * calls degraded is called degraded here too.
 */
export const DEGRADED_THRESHOLD_MS = 6000

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Pick only the named fields, so an unexpected `args` key never reaches the Host. */
function bodyOf(args, fields) {
  const out = {}
  for (const [name, take] of Object.entries(fields)) {
    const value = take(args)
    if (value !== undefined) out[name] = value
  }
  return out
}

/**
 * Resolve a cc-switch row id to the catalogue key that carries it.
 *
 * The catalogue is read rather than cached because a cache would outlive the
 * delete that emptied it, and the failure mode — acting on the wrong row — is
 * worse than the extra round trip. As a convenience a caller that already holds
 * a catalogue key (a row this plugin created by hand, which has no cc-switch
 * id) is accepted too.
 */
async function resolveKey(ctx, id) {
  if (typeof id !== 'string' || id === '') {
    throw Object.assign(new Error('this command requires an "id"'), { code: 'MISSING_ID' })
  }
  const body = await ctx.request({ path: PROVIDERS_PATH, method: 'GET' })
  const providers = body?.providers ?? {}
  for (const [key, provider] of Object.entries(providers)) {
    if (provider?.sourceProfileId === id) return key
  }
  if (Object.hasOwn(providers, id)) return id
  throw Object.assign(
    new Error(`no catalogue provider has sourceProfileId "${id}"`),
    { code: 'UNKNOWN_PROVIDER' },
  )
}

/** Read the whole catalogue once and index it both ways (`id` ↔ `key`). */
async function readCatalogue(ctx) {
  const body = await ctx.request({ path: PROVIDERS_PATH, method: 'GET' })
  const providers = isRecord(body?.providers) ? body.providers : {}
  const order = Array.isArray(body?.order) ? body.order.filter((key) => Object.hasOwn(providers, key)) : []
  for (const key of Object.keys(providers)) if (!order.includes(key)) order.push(key)
  return { providers, order }
}

export const INVOKE_ROUTES = {
  /**
   * The whole catalogue, in cc-switch's row shape.
   *
   * cc-switch's command returns `IndexMap<String, Provider>` and every caller
   * does `Object.values(result)` / `result[id]`, so this is where the plugin's
   * flat record becomes that shape — the one layer the port is allowed to
   * change. Doing it here rather than in each component is what lets a copied
   * file stay verbatim: `ProviderList`, `ProviderCard` and `useDragSort` all
   * receive rows they recognise.
   *
   * `order` rides along only to be folded into each row's `sortIndex`, because
   * the envelope itself is not part of cc-switch's return type and
   * `sortedProviders` would tie-break by name where the Host tie-breaks by id.
   * See `src/client/provider-shape.mjs` for why that matters to a drag.
   *
   * Note this only shapes what a *caller* receives: `resolveKey` and
   * `update_providers_sort_order` read the envelope through `ctx.request`
   * directly, so they still see `sourceProfileId` and the raw ordering.
   */
  get_providers: {
    path: PROVIDERS_PATH,
    method: 'GET',
    receive: (body) => toCardProviders(
      isRecord(body?.providers) ? body.providers : {},
      Array.isArray(body?.order) ? body.order : [],
    ),
  },

  /**
   * Create a provider.
   *
   * Two things happen here that cc-switch does not have to think about:
   *
   * - **`sourceProfileId` is stamped.** The form mints a UUID for `id`, and
   *   the plugin's catalogue key is derived from the display name, so without
   *   this the row would be unaddressable afterwards — every later
   *   `update`/`delete`/`switch` resolves `id` through `sourceProfileId` and
   *   would come back `UNKNOWN_PROVIDER`.
   * - **`addToLive` maps onto the additive model.** cc-switch defaults it to
   *   `true`, meaning "and put it in the live config"; here that means "and
   *   add it to DSH's route table". `false` files it in the catalogue only.
   *   The two stay separate calls on purpose — save writes one document and
   *   apply writes the other, so a failure in the second still leaves a
   *   provider the user can retry from, and can see as not-yet-applied.
   */
  add_provider: {
    // Composite: it saves the row **and** applies it to `llm-pi-ai` unless
    // `addToLive` is false. The sidecar owns the catalogue half but knows
    // nothing of DSH's route table, so forwarding this would create the row
    // and silently skip the membership. Split it before removing this flag.
    local: true,
    path: `${PROVIDERS_PATH}/save`,
    method: 'POST',
    send: (args) => {
      const provider = isRecord(args?.provider) ? args.provider : {}
      const stamped = typeof provider.sourceProfileId === 'string' && provider.sourceProfileId !== ''
        ? provider.sourceProfileId
        : (typeof args?.id === 'string' && args.id !== '' ? args.id : undefined)
      return bodyOf(args, {
        provider: () => ({ ...provider, ...(stamped === undefined ? {} : { sourceProfileId: stamped }) }),
        apiKey: (a) => typeof a?.apiKey === 'string' && a.apiKey !== '' ? a.apiKey : undefined,
      })
    },
    receive: async (body, ctx) => {
      const key = body?.key
      if (typeof key !== 'string' || key === '') return undefined
      if (ctx.args?.addToLive === false) return key
      await ctx.request({ path: `${PROVIDERS_PATH}/apply`, method: 'POST', body: { key } })
      return key
    },
  },

  /** Edit one provider. The same route as the create; `id` selects the row. */
  update_provider: {
    path: `${PROVIDERS_PATH}/save`,
    method: 'POST',
    send: async (args, ctx) => ({
      key: await resolveKey(ctx, args?.id),
      ...bodyOf(args, {
        provider: (a) => a?.provider,
        apiKey: (a) => typeof a?.apiKey === 'string' && a.apiKey !== '' ? a.apiKey : undefined,
      }),
    }),
    receive: (body) => body?.key,
  },

  /**
   * Delete a catalogue row.
   *
   * The Host withdraws the member before forgetting the row, so this is safe
   * even while DSH routes to it; if the withdraw fails it answers
   * `409 reason: 'in-use'` and leaves everything in place.
   */
  delete_provider: {
    // Composite for the same reason: the Host withdraws the member before
    // forgetting the row. On the sidecar only the row would go.
    local: true,
    path: `${PROVIDERS_PATH}/delete`,
    method: 'POST',
    send: async (args, ctx) => ({ key: await resolveKey(ctx, args?.id) }),
    receive: (body) => body?.status === 'removed',
  },

  /**
   * Put a provider into the live configuration — the additive branch's "Add".
   *
   * cc-switch uses one command for both families, and only the *additive*
   * meaning applies here. `ProviderList.tsx:340` wires `actions.add` to
   * `onSwitch`, and `services/provider/mod.rs:6622` is explicit about what
   * that means for an additive app:
   *
   * ```rust
   * // Additive mode apps skip setting is_current (no such concept).
   * if !app_type.is_additive_mode() { … set_current_provider … }
   * write_live_for_state(state, &app_type, provider)?;
   * ```
   *
   * i.e. no pointer is moved and nothing else is displaced — which is exactly
   * what `POST /providers/apply` does. The displacement this module used to
   * refuse to map only exists in the switch-type branch, and that branch is
   * cut (decision #3).
   */
  switch_provider: {
    // `local` keeps this on the plugin even when a sidecar is running: it writes
    // DSH's route table (`llm-pi-ai`), which the sidecar does not know exists.
    // Sent to the sidecar it would report success and change no routing.
    local: true,
    path: `${PROVIDERS_PATH}/apply`,
    method: 'POST',
    send: async (args, ctx) => ({ key: await resolveKey(ctx, args?.id) }),
    receive: (body) => body?.status === 'applied',
  },

  /** Take one provider back out of DSH's route table; the row stays in the catalogue. */
  remove_provider_from_live_config: {
    // Membership, not catalogue - see `switch_provider` above.
    local: true,
    path: `${PROVIDERS_PATH}/withdraw`,
    method: 'POST',
    send: async (args, ctx) => ({ key: await resolveKey(ctx, args?.id) }),
    receive: (body) => body?.status === 'withdrawn',
  },

  /**
   * Reorder the list — which is also the failover queue's priority order.
   *
   * The payloads do not match: cc-switch sends a **partial** list of
   * `{ id, sortIndex }` pairs, while `POST /providers/reorder` requires the
   * complete order and refuses anything else (`NOT_PERMUTATION`), because it
   * rewrites every row's index by position. So the partial update is merged
   * onto the catalogue's current order first and the whole thing is sent.
   *
   * Rows the caller did not name keep their relative order; a row it did name
   * takes the new index. Ties fall back to the current order, which is the
   * same preference `COALESCE(sort_index, 999999), created_at, id` gives a
   * document that has never been reordered.
   */
  update_providers_sort_order: {
    path: `${PROVIDERS_PATH}/reorder`,
    method: 'POST',
    send: async (args, ctx) => {
      const updates = Array.isArray(args?.updates) ? args.updates : []
      const { providers, order } = await readCatalogue(ctx)
      const keyOf = new Map()
      for (const [key, provider] of Object.entries(providers)) {
        keyOf.set(key, key)
        if (typeof provider?.sourceProfileId === 'string' && provider.sourceProfileId !== '') {
          keyOf.set(provider.sourceProfileId, key)
        }
      }
      const renamed = new Map()
      const position = new Map(order.map((key, index) => [key, index]))
      for (const update of updates) {
        const key = keyOf.get(update?.id)
        if (key === undefined) continue
        renamed.set(key, Number.isInteger(update?.sortIndex) ? update.sortIndex : 0)
      }
      const rows = order.map((key, index) => {
        const existing = Number.isInteger(providers[key]?.sortIndex)
          ? providers[key].sortIndex
          // Unreordered rows sort after every explicitly indexed one, matching
          // cc-switch's `999999` sentinel, and keep their original rank.
          : 999999 + index
        return { key, sortIndex: renamed.get(key) ?? existing, rank: position.get(key) ?? index }
      })
      rows.sort((a, b) => (a.sortIndex - b.sortIndex) || (a.rank - b.rank))
      return { keys: rows.map((row) => row.key) }
    },
    receive: (body) => body?.status === 'reordered',
  },

  /**
   * Refresh the tray menu. **An explicit no-op, not an omission.**
   *
   * cc-switch calls this after every successful mutation, so leaving the
   * command unmapped would make every successful add, reorder or switch throw
   * *after* it had already worked — the worst possible place for a false
   * failure. DSH has no tray (decision #3 cut it), so the honest answer is the
   * `true` the command would have returned anyway. Answered locally rather
   * than through a route: there is no route, and inventing one that reads the
   * catalogue just to return `true` would hide that.
   */
  update_tray_menu: {
    run: () => true,
  },

  /**
   * Which provider is current. Always empty: the additive model has no
   * current pointer (`mod.rs:6622` — "Additive mode apps skip setting
   * is_current (no such concept)"), and this plugin retired its own
   * `isCurrent` flag for the same reason. Callers treat `""` as "none", which
   * is the accurate answer.
   */
  get_current_provider: {
    run: () => '',
  },

  /**
   * The card's "Connectivity check", answered by the importer's probe route.
   *
   * cc-switch probes `base_url` with a header-only request and classifies the
   * result as `operational` / `degraded` / `failed` against a 6000 ms threshold
   * (`services/stream_check.rs` — `latency <= threshold` is operational, the
   * `Default` impl pins `degraded_threshold_ms: 6000`). This plugin already
   * probes endpoints for the import preview, so the same measurement is reused
   * rather than a second probe written.
   *
   * Two things differ, both handled here:
   *
   * - The probe route is addressed by **CC Switch profile id**, not by the
   *   catalogue key, so the row is looked up first. A provider added by hand
   *   has no CC Switch row to probe; it answers `failed` with a reason rather
   *   than throwing, because the caller turns a throw into "检查出错: Error:
   *   …" and that reads like a bug instead of a limit.
   * - Anything slower than the threshold is `degraded`, exactly as upstream
   *   classifies it.
   */
  stream_check_provider: {
    run: async (args, ctx) => {
      const unprobeable = (message) => ({
        status: 'failed',
        success: false,
        message,
        testedAt: Math.floor(Date.now() / 1000),
        retryCount: 0,
      })
      let profileId
      try {
        const { providers } = await readCatalogue(ctx)
        profileId = providers[args?.providerId]?.sourceProfileId
      } catch (error) {
        return unprobeable(String(error?.message ?? error))
      }
      if (typeof profileId !== 'string' || profileId === '') {
        return unprobeable('this provider was added here, so there is no CC Switch row to probe')
      }
      let results
      try {
        const body = await ctx.request({
          path: `${IMPORT_API}/probe`,
          method: 'POST',
          body: { profileIds: [profileId] },
        })
        results = Array.isArray(body?.results) ? body.results : []
      } catch (error) {
        return unprobeable(String(error?.message ?? error))
      }
      const result = results.find((entry) => entry?.profileId === profileId)
      if (result === undefined) {
        return unprobeable('the probe had no answer for this provider')
      }
      const latency = Number.isInteger(result.latencyMs) ? result.latencyMs : undefined
      if (result.ok !== true) {
        return {
          status: 'failed',
          success: false,
          message: String(result.message ?? result.detail ?? result.reason ?? 'unreachable'),
          testedAt: Math.floor(Date.now() / 1000),
          retryCount: 0,
        }
      }
      return {
        status: latency !== undefined && latency > DEGRADED_THRESHOLD_MS ? 'degraded' : 'operational',
        success: true,
        message: 'Reachable',
        responseTimeMs: latency,
        httpStatus: Number.isInteger(result.httpStatus) ? result.httpStatus : undefined,
        testedAt: Math.floor(Date.now() / 1000),
        retryCount: 0,
      }
    },
  },
}
