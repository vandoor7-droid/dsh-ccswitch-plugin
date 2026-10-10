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
 * An entry has the shape:
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
 * where `ctx` is `{ args, request }` — `args` is what the component passed, and
 * `request({ path, method, body })` performs one Host call, so an entry may
 * make a second one when it has to.
 *
 * **A command with no entry throws.** A silent no-op would read as success and
 * is the failure mode that costs the most to find, so the table is allowed to
 * be incomplete but never allowed to guess. `docs/ccswitch-command-map.md`
 * records the disposition of all 328 commands; entries are added here as the
 * corresponding surfaces are ported (M1 onward).
 *
 * Two projections are deliberately *not* expressed in this table, because they
 * belong to M1 rather than to the transport:
 *
 * - **cc-switch's `Provider` ↔ this plugin's record.** cc-switch's frontend type
 *   (`src/types.ts`) is `{ id, name, settingsConfig, … }`; the plugin's is
 *   `{ displayName, apiKeyEnv, models, api, baseURL, … }`, and it stores no
 *   `settingsConfig` at all. Until the components are copied in M1, `receive`
 *   returns the plugin's own shape and says so.
 * - **`id` ↔ `key`.** A cc-switch row id reaches this plugin only as
 *   `sourceProfileId`; the catalogue key is derived from it. Commands that take
 *   an `id` resolve it through `resolveKey`, which reads the catalogue once per
 *   call rather than keeping a session-long cache that a delete could stale.
 */

export const MANAGER_API = '/api/dsh-ccswitch-manager'
export const IMPORT_API = '/api/dsh-ccswitch'

/** Pick only the named fields, so an unexpected `args` key never reaches the Host. */
function bodyOf(args, fields) {
  const out = {}
  for (const [name, take] of Object.entries(fields)) {
    const value = take(args)
    if (value !== undefined) out[name] = value
  }
  return out
}

/** `{ app }` is deliberately absent: this plugin manages one app (decision #3). */

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
  const body = await ctx.request({ path: `${MANAGER_API}/providers`, method: 'GET' })
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

export const INVOKE_ROUTES = {
  /**
   * The whole catalogue, as this plugin stores it.
   *
   * `receive` returns the list **body** rather than only `providers` because
   * `order`, `revision` and `exists` are the parts a copied list component
   * still needs (row order, and "this namespace does not exist yet"). The
   * field-name projection onto cc-switch's `Provider` arrives with M1 — see the
   * module note above.
   */
  get_providers: {
    path: `${MANAGER_API}/providers`,
    method: 'GET',
    receive: (body) => body ?? {},
  },

  /**
   * Add a provider.
   *
   * `addToLive` maps straight onto the additive model: cc-switch defaults it to
   * `true`, meaning "and put it in the live config", which here means "and add
   * it to DSH's route table". `false` files it in the catalogue only. The two
   * stay separate calls on purpose — save writes one document and apply writes
   * the other, so a failure in the second still leaves a provider the user can
   * retry from, and can see as not-yet-applied.
   */
  add_provider: {
    path: `${MANAGER_API}/providers/save`,
    method: 'POST',
    send: (args) => bodyOf(args, {
      provider: (a) => a?.provider,
      apiKey: (a) => typeof a?.apiKey === 'string' && a.apiKey !== '' ? a.apiKey : undefined,
    }),
    receive: async (body, ctx) => {
      const key = body?.key
      if (typeof key !== 'string' || key === '') return undefined
      if (ctx.args?.addToLive === false) return key
      await ctx.request({
        path: `${MANAGER_API}/providers/apply`,
        method: 'POST',
        body: { key },
      })
      return key
    },
  },

  /** Edit one provider. The same route as the create; `id` selects the row. */
  update_provider: {
    path: `${MANAGER_API}/providers/save`,
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
    path: `${MANAGER_API}/providers/delete`,
    method: 'POST',
    send: async (args, ctx) => ({ key: await resolveKey(ctx, args?.id) }),
    receive: (body) => body?.status === 'removed',
  },

  /**
   * Deliberately absent: `switch_provider`.
   *
   * cc-switch's `switch_provider` makes one row current **and every other one
   * not**. The additive model has no displacement to perform — `apply` only
   * adds — so routing it to `apply` would answer `true` to a caller that
   * expects the previous provider to have been taken out, which is exactly the
   * kind of silent semantic change this module refuses to make. It is recorded
   * as `不适用` in `docs/ccswitch-command-map.md` for the same reason.
   *
   * M1 decides for real: the additive list (`buildAdditiveSections`) is what
   * gets copied, and whatever it actually calls for "put this back in" is what
   * gets a route — `switch_provider` only if that turns out to be it.
   */

  /** Take one provider back out of DSH's route table. */
  remove_provider_from_live_config: {
    path: `${MANAGER_API}/providers/withdraw`,
    method: 'POST',
    send: async (args, ctx) => ({ key: await resolveKey(ctx, args?.id) }),
    receive: (body) => body?.status === 'withdrawn',
  },
}
