// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The provider-manager HTTP surface: add, edit, delete and *member* the
 * providers this plugin owns.
 *
 * These routes sit beside the importer rather than replacing it. The importer
 * answers "what is in CC Switch's database, and bring these across"; the
 * manager answers "what does this plugin own, and change it" — which has to
 * work with no CC Switch installed at all.
 *
 * **Membership, not activation.** The catalogue this plugin owns and the route
 * table `dsh-llm-pi-ai` actually serves are two documents. A provider is
 * *applied* (added to that route table) or *withdrawn* (taken back out), and
 * several providers are applied at once — which is how CC Switch's additive
 * apps manage their live config (`opencode_config.rs`, `pi_config/mod.rs`)
 * and how `dsh-llm-pi-ai` is shaped, since its `providers` dict has no
 * "current" field to point at one. Membership is therefore never stored here:
 * it is read back from the route table on every list, so the two cannot drift.
 *
 * Three properties are deliberate and easy to lose in a rewrite:
 *
 * 1. **Loopback and same-origin only.** Every route runs through the same
 *    `methodFence` the import routes use, so there is one definition of "this
 *    request came from our own page" rather than a second copy that drifts.
 * 2. **No dynamic path segments.** DSH's web server matches routes by exact
 *    path or by prefix — there is no `:key` pattern. Every route here is an
 *    exact path and the provider key travels in the body, which is also why
 *    the collection is addressed as `/providers` with an `op` rather than as
 *    `/providers/<key>`.
 * 3. **The key never crosses the wire inward or outward.** A write accepts an
 *    `apiKey`, stores it through the credentials service and keeps only the
 *    reference in the settings document; a read reports whether a credential
 *    is configured and never its value or any field that could hold one.
 */
import {
  CCS_API_PROTOCOLS,
  emptyCCSProvider,
  normalizeCCSProvider,
  orderProviders,
  validateCCSProvider,
} from '../domain/ccs-provider.mjs'
import { credentialRefForProviderKey, newProviderKey } from '../../lib/core/ids.js'
import { redactText } from '../../lib/core/safety.js'
import { SUPPORTED_APP_TYPES } from '../../lib/core/scan.js'
import { isLoopbackRequest, methodFence, readJsonBody, writeJson } from './routes.mjs'

export const MANAGER_API_BASE = '/api/dsh-ccswitch-manager'

/**
 * The settings namespace this plugin owns. It is the plugin's loader row id
 * from `cordis.patch.yml`, because `SettingsForms.describe()` reports a
 * descriptor's `ns` as exactly that id.
 */
export const MANAGER_NAMESPACE = 'dsh-ccswitch-plugin'

/**
 * A ceiling on the catalogue. A provider list is hand-managed data, so this is
 * not a performance bound — it stops a runaway client (or a script) from
 * growing the settings document without limit, which would eventually take the
 * whole profile down with it.
 */
const MAX_PROVIDERS = 500

const SAFE_REASONS = new Set(['new', 'updated', 'unchanged', 'removed', 'applied', 'withdrawn', 'created'])

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read this plugin's own catalogue out of the settings document.
 *
 * `describe()` is the only reader available on 0.2.0-rc.2 — there is no
 * `get(ns)` — so a missing descriptor and an empty catalogue both mean "no
 * providers yet"; `exists` tells the caller which, because creating the first
 * provider is a different situation from editing the fiftieth.
 */
async function readCatalogue(settings) {
  try {
    const descriptors = await settings?.describe?.()
    const descriptor = (Array.isArray(descriptors) ? descriptors : [])
      .find((entry) => entry?.ns === MANAGER_NAMESPACE)
    if (descriptor === undefined) return { providers: {}, revision: undefined, exists: false }
    const providers = isRecord(descriptor.value?.providers) ? descriptor.value.providers : {}
    return { providers, revision: descriptor.revision, exists: true }
  } catch {
    return { providers: {}, revision: undefined, exists: false }
  }
}

/**
 * The keys of the providers `dsh-llm-pi-ai` is currently serving.
 *
 * Membership lives in *that* document, not in the catalogue: the route table's
 * `providers` dict is a set by construction, so "applied" and "not applied"
 * are read back rather than recorded. Storing a flag here would leave two
 * copies of one fact, and the copy that goes stale is always the one the user
 * is looking at.
 *
 * A route table this plugin cannot read must not take the list down with it —
 * the catalogue is still editable, and reporting every row as not applied
 * means the manager offers *apply* rather than *withdraw* for a route it
 * cannot see, which is the direction that cannot delete somebody's live
 * configuration by accident.
 */
async function readLiveKeys(readLiveProviders) {
  try {
    const live = await readLiveProviders()
    return new Set(Object.keys(isRecord(live) ? live : {}))
  } catch {
    return new Set()
  }
}

/**
 * A provider as the browser is allowed to see it.
 *
 * The stored record already holds only an `apiKeyEnv` reference and never key
 * material, but this rebuilds the object field by field rather than spreading
 * it: a field added to the record later must be opted in here, so a future
 * `apiKey` cannot leak by simply existing. `credential` reports configuredness
 * without the value, and `inUse` reports membership of the route table without
 * reading it — the caller read it once for the whole list.
 */
function publicProvider(key, provider, credentialConfigured, inUse) {
  const models = Array.isArray(provider?.models) ? provider.models : []
  return {
    key,
    displayName: String(provider?.displayName ?? ''),
    api: String(provider?.api ?? ''),
    baseURL: String(provider?.baseURL ?? ''),
    apiKeyEnv: typeof provider?.apiKeyEnv === 'string' ? provider.apiKeyEnv : undefined,
    credential: credentialConfigured ? 'found' : 'missing',
    models: models.slice(0, 200).map((model) => ({
      id: String(model?.id ?? ''),
      name: typeof model?.name === 'string' ? model.name : undefined,
      contextWindow: Number.isInteger(model?.contextWindow) ? model.contextWindow : undefined,
      maxTokens: Number.isInteger(model?.maxTokens) ? model.maxTokens : undefined,
      reasoningEfforts: model?.reasoningEfforts === false ? false : undefined,
    })),
    category: typeof provider?.category === 'string' ? provider.category : undefined,
    websiteUrl: typeof provider?.websiteUrl === 'string' ? provider.websiteUrl : undefined,
    notes: typeof provider?.notes === 'string' ? provider.notes : undefined,
    icon: typeof provider?.icon === 'string' ? provider.icon : undefined,
    iconColor: typeof provider?.iconColor === 'string' ? provider.iconColor : undefined,
    appType: typeof provider?.appType === 'string' ? provider.appType : undefined,
    sourceProfileId: typeof provider?.sourceProfileId === 'string' ? provider.sourceProfileId : undefined,
    // Ordering. The envelope also carries `order`, but cc-switch's list never
    // reads an envelope — it sorts rows itself from `sortIndex` then
    // `createdAt` (`useDragSort.sortedProviders`), so both have to be on the
    // row or the ported list would fall back to key order and a drag would
    // appear not to have happened.
    sortIndex: Number.isInteger(provider?.sortIndex) ? provider.sortIndex : undefined,
    createdAt: Number.isInteger(provider?.createdAt) ? provider.createdAt : undefined,
    // Two different questions that used to be one. `isCurrent` is CC Switch's
    // own flag, carried through so an imported row survives an edit intact;
    // `inUse` is whether *this* plugin has the provider in DSH's route table.
    // Only the second drives anything here.
    isCurrent: provider?.isCurrent === true,
    inUse: inUse === true,
    inFailoverQueue: provider?.inFailoverQueue === true,
    costMultiplier: typeof provider?.costMultiplier === 'number' ? provider.costMultiplier : undefined,
    limitDailyUsd: typeof provider?.limitDailyUsd === 'number' ? provider.limitDailyUsd : undefined,
    limitMonthlyUsd: typeof provider?.limitMonthlyUsd === 'number' ? provider.limitMonthlyUsd : undefined,
  }
}

/** Whether a credential reference currently resolves to a value. */
async function credentialState(credentials, ref) {
  if (typeof ref !== 'string' || ref === '') return false
  if (typeof credentials?.describe === 'function') {
    try {
      const described = await credentials.describe(ref)
      if (described?.configured === true) return true
    } catch { /* fall through to resolve */ }
  }
  if (typeof credentials?.resolve === 'function') {
    try {
      const resolved = await credentials.resolve(ref)
      return typeof resolved?.value === 'string' && resolved.value.length > 0
    } catch { /* treat an unresolvable reference as unset */ }
  }
  return false
}

/**
 * A provider key that is not already taken.
 *
 * The generated key is deterministic in shape but random in its tail, so a
 * collision is vanishingly unlikely; it is still checked, because two
 * providers sharing a key would share a credential reference, and the second
 * import would silently overwrite the first one's stored secret.
 */
function uniqueKey(displayName, providers) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = newProviderKey(displayName)
    if (!Object.hasOwn(providers, candidate)) return candidate
  }
  throw new Error('could not allocate a provider key')
}

/** Validate a revision the client sent, or undefined when it sent none. */
function revisionOf(body) {
  return Number.isInteger(body?.expectedRevision) ? body.expectedRevision : undefined
}

export function makeManagerRoutes(deps = {}) {
  const settings = deps.settings
  const credentials = deps.credentials
  const isLoopback = deps.isLoopback ?? isLoopbackRequest
  const presets = Array.isArray(deps.presets) ? deps.presets : []
  /**
   * Read `dsh-llm-pi-ai`'s route table — the definition of "applied". Injected
   * rather than read here because only the composition half should know which
   * namespace DSH routes through; this module works in terms of the set it
   * returns.
   */
  const readLiveProviders = deps.readLiveProviders ?? (async () => ({}))
  /**
   * Add one provider to that route table, so applying one here actually
   * changes what DSH serves. Injected because the projection belongs to the
   * importer's mapper, and the two must agree on what a provider looks like.
   */
  const applyProvider = deps.applyProvider ?? (async () => {})
  /** Take one provider back out of that route table. */
  const withdrawProvider = deps.withdrawProvider ?? (async () => {})

  /** Serialise a write so two in-flight requests cannot interleave revisions. */
  let queue = Promise.resolve()
  const serialize = (work) => {
    const next = queue.then(work, work)
    queue = next.then(() => undefined, () => undefined)
    return next
  }

  return [
    {
      kind: 'exact',
      path: `${MANAGER_API_BASE}/providers`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, 'GET')) return
        try {
          const { providers, revision, exists } = await readCatalogue(settings)
          // CC Switch's own row order, not the document's insertion order. That
          // order is also the failover queue, so the list is what the proxy
          // will walk.
          const order = orderProviders(providers)
          const live = await readLiveKeys(readLiveProviders)
          const entries = await Promise.all(
            order.map(async (key) => [
              key,
              publicProvider(
                key,
                providers[key],
                await credentialState(credentials, providers[key]?.apiKeyEnv),
                live.has(key),
              ),
            ]),
          )
          writeJson(response, 200, {
            exists,
            revision,
            order,
            // Membership, not activation: `inUse` is the set of catalogue keys
            // currently present in DSH's route table, derived on every read so
            // the two documents cannot drift. There is no "current" provider —
            // `dsh-llm-pi-ai` keeps a dict with no active pointer, and several
            // members are live at once.
            providers: Object.fromEntries(entries),
            apiProtocols: [...CCS_API_PROTOCOLS],
            // Every app type this plugin understands, taken from the scanner
            // rather than a second copy in the browser half. Nothing gates
            // capability any more (the writers that used to are retired), so
            // this is a labelling set for the form and for imported rows.
            appTypes: [...SUPPORTED_APP_TYPES],
          })
        } catch (err) {
          console.error('[dsh-ccswitch-plugin] manager list failed:', redactText(err))
          writeJson(response, 500, { error: 'could not read the provider catalogue' })
        }
      },
    },
    {
      kind: 'exact',
      path: `${MANAGER_API_BASE}/providers/save`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, 'POST', { requireSameOrigin: true })) return
        const body = await readJsonBody(request)
        if (!isRecord(body) || !isRecord(body.provider)) {
          writeJson(response, 400, { error: 'body must be { provider: object, key?: string }' })
          return
        }
        const draft = normalizeCCSProvider({
          ...emptyCCSProvider(),
          ...body.provider,
          // A key is never accepted from the body: it addresses the credential
          // reference, so letting a caller choose one would let it point a new
          // provider at an existing provider's stored secret.
          apiKeyEnv: undefined,
        })
        const check = validateCCSProvider(draft)
        if (!check.ok) {
          // A list, not a bare string, so the form can point at every offending
          // field at once instead of revealing them one failed save at a time.
          writeJson(response, 400, { error: 'provider is not usable', errors: [check.message] })
          return
        }
        const requestedKey = typeof body.key === 'string' && body.key !== '' ? body.key : undefined

        try {
          const result = await serialize(async () => {
            const { providers, revision } = await readCatalogue(settings)
            const existingKey = requestedKey !== undefined && Object.hasOwn(providers, requestedKey)
              ? requestedKey
              : undefined
            const key = existingKey ?? uniqueKey(draft.displayName, providers)
            if (existingKey === undefined && Object.keys(providers).length >= MAX_PROVIDERS) {
              throw Object.assign(new Error('too many providers'), { code: 'TOO_MANY' })
            }
            const apiKeyEnv = credentialRefForProviderKey(key)
            const existingRecord = existingKey === undefined ? undefined : providers[existingKey]
            const record = { ...draft, apiKeyEnv }
            // Ordering metadata belongs to the catalogue, not to the form: the
            // edit form rebuilds a provider from its editable fields and
            // carries none of it, so taking the draft at face value would
            // silently reset a provider's position — and its creation time —
            // on every edit. A brand-new provider is stamped now and takes the
            // last position, which is where CC Switch puts one too.
            if (record.sortIndex === undefined && existingRecord?.sortIndex !== undefined) {
              record.sortIndex = existingRecord.sortIndex
            }
            if (record.createdAt === undefined) {
              record.createdAt = existingRecord?.createdAt ?? Date.now()
            }
            // The secret is written first and the reference second. The other
            // order would leave the document naming a credential that does not
            // exist yet, which reads as "configured" in the UI while every
            // request fails.
            const apiKey = typeof body.apiKey === 'string' ? body.apiKey : undefined
            if (apiKey !== undefined && apiKey !== '') await credentials.set(apiKeyEnv, apiKey)
            await settings.mutate(
              MANAGER_NAMESPACE,
              [{ op: 'set', path: ['providers', key], value: record }],
              revisionOf(body) ?? revision,
            )
            return { key, record, created: existingKey === undefined }
          })
          writeJson(response, 200, {
            key: result.key,
            status: SAFE_REASONS.has(result.created ? 'created' : 'updated') ? (result.created ? 'created' : 'updated') : 'updated',
            provider: publicProvider(
              result.key,
              result.record,
              await credentialState(credentials, result.record.apiKeyEnv),
              (await readLiveKeys(readLiveProviders)).has(result.key),
            ),
          })
        } catch (err) {
          if (err?.code === 'TOO_MANY') {
            writeJson(response, 409, { error: `the catalogue is limited to ${MAX_PROVIDERS} providers` })
            return
          }
          const conflict = /conflict/i.test(String(err?.code ?? '')) || /conflict/i.test(String(err?.message ?? ''))
          console.error('[dsh-ccswitch-plugin] manager save failed:', redactText(err, [body.apiKey]))
          writeJson(response, conflict ? 409 : 500, {
            error: conflict ? 'the settings document changed; reload and retry' : 'could not save the provider',
          })
        }
      },
    },
    {
      kind: 'exact',
      path: `${MANAGER_API_BASE}/providers/delete`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, 'POST', { requireSameOrigin: true })) return
        const body = await readJsonBody(request)
        if (!isRecord(body) || typeof body.key !== 'string' || body.key === '') {
          writeJson(response, 400, { error: 'body must be { key: string }' })
          return
        }
        try {
          const outcome = await serialize(async () => {
            const { providers, revision } = await readCatalogue(settings)
            if (!Object.hasOwn(providers, body.key)) return { missing: true }
            // Withdraw before forgetting. A member still routed to by
            // `dsh-llm-pi-ai` would otherwise become a dangling entry: the
            // catalogue would no longer hold the row the route table points
            // at, so nothing could ever take it back out. Order matters here
            // for the same reason CC Switch's delete refuses while the local
            // record, the database and the proxy route all still point at the
            // row (`services/provider/mod.rs`).
            const live = await readLiveKeys(readLiveProviders)
            const wasInUse = live.has(body.key)
            if (wasInUse) {
              try {
                await withdrawProvider(body.key)
              } catch (err) {
                console.error('[dsh-ccswitch-plugin] withdrawing the provider from DSH failed:', redactText(err))
                throw Object.assign(new Error('DSH still routes to this provider'), { code: 'WITHDRAW_FAILED' })
              }
            }
            const ref = providers[body.key]?.apiKeyEnv
            await settings.mutate(
              MANAGER_NAMESPACE,
              [{ op: 'unset', path: ['providers', body.key] }],
              revisionOf(body) ?? revision,
            )
            // Only after the catalogue no longer names the reference: a
            // credential removed first would leave a provider that resolves to
            // nothing, and a failed mutate would have destroyed the secret for
            // a provider that is still listed.
            if (typeof ref === 'string' && ref !== '' && typeof credentials?.unset === 'function') {
              try {
                await credentials.unset(ref)
              } catch (err) {
                console.error('[dsh-ccswitch-plugin] credential cleanup failed:', redactText(err))
              }
            }
            return { missing: false, wasInUse }
          })
          if (outcome.missing) {
            writeJson(response, 404, { error: 'no such provider' })
            return
          }
          // Reported rather than refused: the withdraw above already removed
          // the member, so the conflict the response names has resolved by the
          // time the client reads it. `wasInUse` lets the UI say "and it was
          // live" instead of implying nothing was serving traffic.
          if (outcome.wasInUse) {
            writeJson(response, 200, { key: body.key, status: 'removed', wasInUse: true })
            return
          }
          writeJson(response, 200, { key: body.key, status: 'removed' })
        } catch (err) {
          if (err?.code === 'WITHDRAW_FAILED') {
            writeJson(response, 409, {
              reason: 'in-use',
              error: 'DSH still routes to this provider; withdraw it first',
            })
            return
          }
          const conflict = /conflict/i.test(String(err?.code ?? '')) || /conflict/i.test(String(err?.message ?? ''))
          console.error('[dsh-ccswitch-plugin] manager delete failed:', redactText(err))
          writeJson(response, conflict ? 409 : 500, {
            error: conflict ? 'the settings document changed; reload and retry' : 'could not delete the provider',
          })
        }
      },
    },
    {
      kind: 'exact',
      path: `${MANAGER_API_BASE}/providers/apply`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, 'POST', { requireSameOrigin: true })) return
        const body = await readJsonBody(request)
        if (!isRecord(body) || typeof body.key !== 'string' || body.key === '') {
          writeJson(response, 400, { error: 'body must be { key: string }' })
          return
        }
        try {
          const outcome = await serialize(async () => {
            const { providers } = await readCatalogue(settings)
            if (!Object.hasOwn(providers, body.key)) return undefined
            // No catalogue write at all: membership lives in DSH's own route
            // table, and the catalogue row is untouched by adding or removing
            // one. This is what makes the operation safe to repeat — it never
            // races the revision the editor is holding, and it never rewrites
            // the credential or the defaults alongside it (the rule CC Switch's
            // `pi_config` calls `provider_membership_never_changes_pi_auth_or_defaults`).
            const warnings = (await applyProvider(body.key, providers[body.key])) ?? []
            return { warnings: Array.isArray(warnings) ? warnings : [] }
          })
          if (outcome === undefined) {
            writeJson(response, 404, { error: 'no such provider' })
            return
          }
          writeJson(response, 200, {
            key: body.key,
            status: 'applied',
            warnings: outcome.warnings.slice(0, 20).map((text) => redactText(text).slice(0, 200)),
          })
        } catch (err) {
          const conflict = /conflict/i.test(String(err?.code ?? '')) || /conflict/i.test(String(err?.message ?? ''))
          console.error('[dsh-ccswitch-plugin] manager apply failed:', redactText(err))
          writeJson(response, conflict ? 409 : 500, {
            error: conflict ? 'the settings document changed; reload and retry' : 'could not apply the provider',
          })
        }
      },
    },
    {
      kind: 'exact',
      path: `${MANAGER_API_BASE}/providers/withdraw`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, 'POST', { requireSameOrigin: true })) return
        const body = await readJsonBody(request)
        if (!isRecord(body) || typeof body.key !== 'string' || body.key === '') {
          writeJson(response, 400, { error: 'body must be { key: string }' })
          return
        }
        try {
          const known = await serialize(async () => {
            const { providers } = await readCatalogue(settings)
            // A member the catalogue has forgotten about is still worth
            // withdrawing — an orphan in the route table is exactly the state
            // a failed delete used to leave behind — so "known" only steers
            // the 404, it does not gate the removal.
            await withdrawProvider(body.key)
            return Object.hasOwn(providers, body.key)
          })
          writeJson(response, 200, {
            key: body.key,
            status: 'withdrawn',
            // False means the route table held a key the catalogue does not:
            // useful for the UI to report rather than silently clean up.
            inCatalogue: known === true,
          })
        } catch (err) {
          const conflict = /conflict/i.test(String(err?.code ?? '')) || /conflict/i.test(String(err?.message ?? ''))
          console.error('[dsh-ccswitch-plugin] manager withdraw failed:', redactText(err))
          writeJson(response, conflict ? 409 : 500, {
            error: conflict ? 'the settings document changed; reload and retry' : 'could not withdraw the provider',
          })
        }
      },
    },
    {
      kind: 'exact',
      path: `${MANAGER_API_BASE}/providers/reorder`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, 'POST', { requireSameOrigin: true })) return
        const body = await readJsonBody(request)
        // The complete new order, not a list of moves. CC Switch's
        // `update_providers_sort_order` takes explicit per-row indices, which
        // lets a caller send a half-applied order and leaves the rows it did
        // not name interleaved with the ones it did. A drag produces a whole
        // order anyway, and requiring it makes "the list the user sees" and
        // "the order that gets written" the same list by construction.
        if (!isRecord(body) || !Array.isArray(body.keys) || body.keys.some((key) => typeof key !== 'string' || key === '')) {
          writeJson(response, 400, { error: 'body must be { keys: string[] }' })
          return
        }
        const requested = body.keys
        if (new Set(requested).size !== requested.length) {
          writeJson(response, 400, { error: 'keys must not repeat' })
          return
        }
        try {
          await serialize(async () => {
            const { providers, revision } = await readCatalogue(settings)
            const present = Object.keys(providers)
            // Every key exactly once. A shorter list would leave the unnamed
            // rows holding stale indices, so the resulting order would depend
            // on numbers the user never saw.
            if (requested.length !== present.length || requested.some((key) => !Object.hasOwn(providers, key))) {
              throw Object.assign(new Error('keys must name every provider exactly once'), { code: 'NOT_PERMUTATION' })
            }
            const next = Object.fromEntries(
              // Index by position, which is what CC Switch's `sort_index` is:
              // an ordinal the list is sorted by.
              requested.map((key, index) => [key, { ...providers[key], sortIndex: index }]),
            )
            await settings.mutate(
              MANAGER_NAMESPACE,
              [{ op: 'set', path: ['providers'], value: next }],
              revisionOf(body) ?? revision,
            )
            return next
          })
          writeJson(response, 200, { status: 'reordered', order: requested })
        } catch (err) {
          if (err?.code === 'NOT_PERMUTATION') {
            writeJson(response, 400, { error: 'keys must name every provider exactly once' })
            return
          }
          const conflict = /conflict/i.test(String(err?.code ?? '')) || /conflict/i.test(String(err?.message ?? ''))
          console.error('[dsh-ccswitch-plugin] manager reorder failed:', redactText(err))
          writeJson(response, conflict ? 409 : 500, {
            error: conflict ? 'the settings document changed; reload and retry' : 'could not reorder the providers',
          })
        }
      },
    },
    {
      kind: 'exact',
      path: `${MANAGER_API_BASE}/presets`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, 'GET')) return
        writeJson(response, 200, { presets })
      },
    },
  ]
}
