// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * The plugin's flat provider record, projected into cc-switch's `Provider`.
 *
 * cc-switch's frontend type (`src/types.ts`) is
 * `{ id, name, settingsConfig, websiteUrl?, category?, createdAt?, sortIndex?,
 * notes?, isPartner?, meta?, icon?, iconColor?, inFailoverQueue? }` — one
 * opaque config blob plus metadata. The plugin's record is the *flattened*
 * form of that blob (`displayName`, `baseURL`, `api`, `models[]`, …) because it
 * has to map straight onto `dsh-llm-pi-ai`'s `PiAiProviderProfile`, which has no
 * `settingsConfig` to speak of.
 *
 * The two cannot be made identical here without either storing the blob
 * alongside the fields derived from it (two sources of truth) or rewriting
 * every component that reads it. So the blob is **synthesized on the way out**:
 * enough shape for cc-switch's readers to find what they ask for, and nothing
 * that would be mistaken for stored state.
 *
 * What that buys, concretely:
 *
 * - `extractProviderBaseUrl()` finds `baseUrl` / `env.ANTHROPIC_BASE_URL`, so
 *   the card's second line shows the endpoint without touching `notes`.
 * - `isOfficialProvider()` reads `env.ANTHROPIC_BASE_URL` for the `claude`
 *   app id and returns `true` when it is missing — an empty blob would mark
 *   **every** provider official, which disables the API-key field and the
 *   connectivity check. Carrying the endpoint is what stops that.
 *
 * What it deliberately does **not** carry: any secret. The credential lives
 * behind a reference in the credentials service and never crosses this
 * boundary in either direction.
 *
 * ## The two fields that are *not* verbatim
 *
 * **`meta.liveConfigManaged`** is how cc-switch's `ProviderList` decides
 * membership for the `mcode` app id:
 *
 * ```ts
 * case "mcode": return provider.meta?.liveConfigManaged === true;
 * ```
 *
 * That predicate *is* this plugin's `inUse` — "is this provider in the route
 * table DSH serves". The card's `Added` / `Available` split therefore reads our
 * membership through the one field upstream already has for it, instead of a
 * new branch in the copied component. Every other `meta` key stays absent, so
 * `meta.usage_script` remains `undefined` and the quota column renders empty
 * rather than querying a route that does not exist.
 *
 * **`sortIndex`** is taken from the catalogue's `order` rather than from the
 * stored field when the key appears there. The two agree on ranking but not on
 * tie-breaks — the Host breaks ties by row id and `sortedProviders` breaks them
 * by name — and the list must match the order `/providers/reorder` requires as
 * its input, or a drag would send back a permutation of a list the user never
 * saw.
 */

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value) {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * The config blob a reader of `settingsConfig` expects, derived from the
 * endpoint cc-switch would have written.
 *
 * Both spellings are emitted because cc-switch looks in two places depending
 * on which app id it was handed: `extractProviderBaseUrl` accepts either, but
 * `isOfficialProvider` only understands `env.ANTHROPIC_BASE_URL` when the
 * caller passes `claude`.
 */
export function synthesizeSettingsConfig(record) {
  const baseURL = optionalString(record?.baseURL)
  if (baseURL === undefined) return {}
  const config = { baseUrl: baseURL }
  config.env = { ANTHROPIC_BASE_URL: baseURL }
  return config
}

/**
 * One catalogue row as cc-switch's list and card code expect it.
 *
 * @param key - the catalogue key, which becomes the row's `id`. Everything
 *   that addresses a row (`apply`, `withdraw`, `delete`, `reorder`) resolves
 *   this id back through `sourceProfileId`, so the two names have to stay
 *   paired — see `resolveKey` in `src/client/tauri-shim/commands.mjs`.
 * @param record - the plugin's stored provider.
 * @param order - the catalogue's `order`, when the caller has it; see the note
 *   on `sortIndex` above.
 */
export function toCardProvider(key, record, order) {
  const source = isRecord(record) ? record : {}
  const position = Array.isArray(order) ? order.indexOf(key) : -1
  return {
    id: String(key),
    name: String(source.displayName ?? key),
    settingsConfig: synthesizeSettingsConfig(source),
    websiteUrl: optionalString(source.websiteUrl),
    category: optionalString(source.category),
    createdAt: Number.isInteger(source.createdAt) ? source.createdAt : undefined,
    sortIndex: position >= 0 ? position : (Number.isInteger(source.sortIndex) ? source.sortIndex : undefined),
    notes: optionalString(source.notes),
    icon: optionalString(source.icon),
    iconColor: optionalString(source.iconColor),
    inFailoverQueue: source.inFailoverQueue === true,
    meta: { liveConfigManaged: source.inUse === true },
    // `isPartner` is intentionally absent: partner promotion is a storefront
    // concern this plugin does not have.
  }
}

/** The whole catalogue, keyed as cc-switch's `get_providers` returns it. */
export function toCardProviders(providers, order) {
  const source = isRecord(providers) ? providers : {}
  const out = {}
  for (const [key, record] of Object.entries(source)) {
    if (key === '') continue
    out[key] = toCardProvider(key, record, order)
  }
  return out
}
