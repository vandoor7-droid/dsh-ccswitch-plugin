// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The provider-manager HTTP surface: add, edit, delete and activate the
 * providers this plugin owns.
 *
 * These routes sit beside the importer rather than replacing it. The importer
 * answers "what is in CC Switch's database, and bring these across"; the
 * manager answers "what does this plugin own, and change it" — which has to
 * work with no CC Switch installed at all.
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
  activateCCSProvider,
  currentKeysByApp,
  effectiveAppType,
  emptyCCSProvider,
  normalizeCCSProvider,
  orderProviders,
  validateCCSProvider,
} from '../domain/ccs-provider.mjs'
import { credentialRefForProviderKey, newProviderKey } from '../../lib/core/ids.js'
import { redactText } from '../../lib/core/safety.js'
import { isLoopbackRequest, methodFence, readJsonBody, writeJson } from './routes.mjs'
import { WRITER_APP_TYPES, WriterError, writeProviderConfig } from './writers.js'

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

const SAFE_REASONS = new Set(['new', 'updated', 'unchanged', 'removed', 'activated', 'created'])

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
 * The key of the provider marked current, optionally within one app type.
 *
 * With an app type this answers CC Switch's `get_current_provider(app_type)`;
 * without one it answers "is anything active at all", which is what the list
 * route reports as `current` for callers that predate the per-app model.
 */
function currentKeyOf(providers, appType) {
  const current = currentKeysByApp(providers)
  if (typeof appType === 'string' && appType !== '') return current[appType]
  return Object.values(current)[0]
}

/**
 * A provider as the browser is allowed to see it.
 *
 * The stored record already holds only an `apiKeyEnv` reference and never key
 * material, but this rebuilds the object field by field rather than spreading
 * it: a field added to the record later must be opted in here, so a future
 * `apiKey` cannot leak by simply existing. `credential` reports configuredness
 * without the value.
 */
function publicProvider(key, provider, credentialConfigured) {
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
    isCurrent: provider?.isCurrent === true,
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

/**
 * Which writer should handle a provider.
 *
 * The body's `appType` wins when it names one, so the UI can push a provider to
 * a tool other than the one it was filed under. Otherwise the provider's own
 * `appType` decides, and a provider that carries neither falls back to
 * `claude`: that is what CC Switch itself defaults an unlabelled row to, and it
 * is the more forgiving of the two (Claude Code accepts an arbitrary base URL,
 * whereas a Codex route only works for an OpenAI-shaped endpoint).
 */
function resolveAppType(provider, override) {
  if (typeof override === 'string' && override !== '') return override
  const own = provider?.appType
  return typeof own === 'string' && own !== '' ? own : 'claude'
}

export function makeManagerRoutes(deps = {}) {
  const settings = deps.settings
  const credentials = deps.credentials
  const isLoopback = deps.isLoopback ?? isLoopbackRequest
  const presets = Array.isArray(deps.presets) ? deps.presets : []
  /**
   * Where the external tools keep their config. Injected so tests can point the
   * writers at a temp directory; production leaves it undefined and the writers
   * fall back to `os.homedir()`.
   */
  const home = deps.home
  /**
   * Project a provider into the namespace DSH itself reads, so activating one
   * here actually changes which model DSH talks to. Injected rather than
   * imported because the projection belongs to the importer's mapper, and the
   * two must agree on what a provider looks like.
   */
  const applyProvider = deps.applyProvider ?? (async () => {})

  /** Serialise a write so two in-flight requests cannot interleave revisions. */
  let queue = Promise.resolve()
  const serialize = (work) => {
    const next = queue.then(work, work)
    queue = next.then(() => undefined, () => undefined)
    return next
  }

  /**
   * Resolve the provider's key and rewrite the app's live configuration.
   *
   * Shared by the writers route and by activation, so the two can never
   * disagree about what a write does. Callers map the thrown codes to
   * responses instead of doing their own detection.
   *
   * @throws an error carrying `code: 'UNSUPPORTED'` when no writer exists for
   *   the app type, `code: 'NO_CREDENTIAL'` when the provider has no key
   *   stored, or a {@link WriterError} when the target file was refused.
   */
  const runWriter = async (provider, appType, outgoing) => {
    if (!WRITER_APP_TYPES.includes(appType)) {
      throw Object.assign(new Error('unsupported app type'), { code: 'UNSUPPORTED' })
    }
    // A config naming a provider with no key leaves the external tool broken in
    // a way the user cannot see from here: Claude Code falls back to its own
    // login, Codex refuses to start. Refusing the write is the only outcome
    // that leaves the tool working.
    const resolved = await credentials?.resolve?.(provider?.apiKeyEnv)
    const apiKey = typeof resolved?.value === 'string' ? resolved.value : ''
    if (apiKey === '') {
      throw Object.assign(new Error('credential is not set'), { code: 'NO_CREDENTIAL' })
    }
    const written = await writeProviderConfig({ appType, provider, apiKey, home, previous: outgoing })
    return {
      appType,
      files: written.files.map((file) => ({
        path: file.path,
        keys: file.keys.slice(0, 60).map((key) => redactText(key).slice(0, 120)),
        removed: file.removed.slice(0, 60).map((key) => redactText(key).slice(0, 120)),
      })),
      warnings: written.warnings.slice(0, 20).map((text) => redactText(text).slice(0, 200)),
    }
  }

  return [
    {
      kind: 'exact',
      path: `${MANAGER_API_BASE}/providers`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, 'GET')) return
        try {
          const { providers, revision, exists } = await readCatalogue(settings)
          // CC Switch's own row order, not the document's insertion order.
          const order = orderProviders(providers)
          const entries = await Promise.all(
            order.map(async (key) => [
              key,
              publicProvider(key, providers[key], await credentialState(credentials, providers[key]?.apiKeyEnv)),
            ]),
          )
          writeJson(response, 200, {
            exists,
            revision,
            order,
            // Which provider is active is only answerable per app (CC Switch's
            // `is_current` is a per-app singleton), so the map is the real
            // answer. `current` stays for a browser half that predates it.
            current: currentKeyOf(providers),
            currentByApp: currentKeysByApp(providers),
            providers: Object.fromEntries(entries),
            apiProtocols: [...CCS_API_PROTOCOLS],
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
            provider: publicProvider(result.key, result.record, await credentialState(credentials, result.record.apiKeyEnv)),
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
            // CC Switch refuses to delete the provider that is in use —
            // `services/provider/mod.rs` rejects it with "无法删除当前正在使用的
            // 供应商" whenever the local record, the database or the proxy route
            // still points at the row. Here the catalogue is the only pointer,
            // but the reason carries over: the provider's live configuration is
            // already written into the other tool, and activation is the only
            // thing that rewrites it, so removing the row would leave those
            // files naming a provider this plugin can no longer switch away
            // from.
            // The row's OWN app type decides this, matching CC Switch, whose
            // `is_referenced` check is scoped to `app_type`. A global test
            // would refuse to delete a Claude provider merely because some
            // Codex provider happened to be the active one.
            const deleted = providers[body.key]
            if (currentKeyOf(providers, effectiveAppType(deleted)) === body.key) return { active: true }
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
            return { missing: false }
          })
          if (outcome.missing) {
            writeJson(response, 404, { error: 'no such provider' })
            return
          }
          if (outcome.active) {
            // 409 because the request conflicts with the row's current state,
            // but `reason` separates it from the stale-revision 409 the client
            // already reserves for "the document moved": this one is a fact
            // about the provider, and retrying it can never succeed.
            writeJson(response, 409, {
              reason: 'active-provider',
              error: 'this provider is active; activate another one before deleting it',
            })
            return
          }
          writeJson(response, 200, { key: body.key, status: 'removed' })
        } catch (err) {
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
      path: `${MANAGER_API_BASE}/providers/activate`,
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
            // CC Switch keeps the active provider as a per-app singleton, so
            // activation is a whole-catalogue edit: the chosen row is marked
            // and every other row is cleared in the same write, which is the
            // only way the invariant survives a concurrent edit.
            // The provider this one displaces, for its own app type. Needed
            // because a provider-exclusive key may only be removed while the
            // file still holds the value that provider wrote, so the writer
            // has to know who its predecessor was.
            const outgoingKey = currentKeyOf(providers, effectiveAppType(providers[body.key]))
            const outgoing = outgoingKey === undefined ? undefined : providers[outgoingKey]
            const next = activateCCSProvider(providers, body.key)
            await settings.mutate(
              MANAGER_NAMESPACE,
              [{ op: 'set', path: ['providers'], value: next }],
              revisionOf(body) ?? revision,
            )
            return { missing: false, provider: next[body.key], outgoing }
          })
          if (outcome.missing) {
            writeJson(response, 404, { error: 'no such provider' })
            return
          }
          // Two independent projections follow the catalogue write, and neither
          // may undo it: "this provider is active" is already the durable fact,
          // so a failure here is reported rather than rolled back, and a retry
          // finishes whichever half did not take.
          const provider = outcome.provider
          const appType = resolveAppType(provider)
          const warnings = []

          // 1. Make DSH itself route to it. Without this the row would light up
          //    while every model request kept going to the old route.
          let applied = true
          try {
            warnings.push(...((await applyProvider(body.key, provider)) ?? []))
          } catch (err) {
            applied = false
            console.error('[dsh-ccswitch-plugin] projecting the provider into DSH failed:', redactText(err))
            warnings.push('DSH did not accept the route, so model requests still use the previous one')
          }

          // 2. Rewrite the tool's own configuration, which is what activating a
          //    provider means in CC Switch. An app type with no writer yet is
          //    named rather than skipped: the user asked to activate it, and a
          //    silent no-op would read as success.
          let written
          if (WRITER_APP_TYPES.includes(appType)) {
            try {
              written = await runWriter(provider, appType, outcome.outgoing)
              warnings.push(...written.warnings)
            } catch (err) {
              console.error('[dsh-ccswitch-plugin] writing the tool configuration failed:', redactText(err))
              warnings.push(err?.code === 'NO_CREDENTIAL'
                ? 'no key is stored for this provider, so its configuration was not written'
                : writerRefusalMessage(err))
            }
          } else {
            warnings.push(`nothing writes a "${appType}" configuration yet; supported: ${WRITER_APP_TYPES.join(', ')}`)
          }

          writeJson(response, 200, {
            key: body.key,
            status: 'activated',
            applied,
            written,
            warnings: warnings.slice(0, 20).map((text) => redactText(text).slice(0, 200)),
          })
        } catch (err) {
          const conflict = /conflict/i.test(String(err?.code ?? '')) || /conflict/i.test(String(err?.message ?? ''))
          console.error('[dsh-ccswitch-plugin] manager activate failed:', redactText(err))
          writeJson(response, conflict ? 409 : 500, {
            error: conflict ? 'the settings document changed; reload and retry' : 'could not activate the provider',
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
    {
      kind: 'exact',
      path: `${MANAGER_API_BASE}/writers/run`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, 'POST', { requireSameOrigin: true })) return
        const body = await readJsonBody(request)
        if (!isRecord(body) || typeof body.key !== 'string' || body.key === '') {
          writeJson(response, 400, { error: 'body must be { key: string, appType?: "claude" | "codex" }' })
          return
        }
        try {
          // Serialised with every other write: two pushes racing would each
          // read the target file, and the loser's edits would be computed
          // against a version that no longer exists.
          const outcome = await serialize(async () => {
            const { providers } = await readCatalogue(settings)
            if (!Object.hasOwn(providers, body.key)) {
              throw Object.assign(new Error('no such provider'), { code: 'NOT_FOUND' })
            }
            const provider = providers[body.key]
            return runWriter(provider, resolveAppType(provider, body.appType))
          })
          writeJson(response, 200, {
            key: body.key,
            appType: outcome.appType,
            // Already redacted and clamped by runWriter.
            written: outcome.files,
            warnings: outcome.warnings,
          })
        } catch (err) {
          if (err?.code === 'NOT_FOUND') {
            writeJson(response, 404, { error: 'no such provider' })
            return
          }
          if (err?.code === 'NO_CREDENTIAL') {
            writeJson(response, 400, {
              error: 'this provider has no key stored, so writing it would leave the tool unable to authenticate',
            })
            return
          }
          if (err?.code === 'UNSUPPORTED' || err instanceof WriterError) {
            console.error('[dsh-ccswitch-plugin] writer refused:', redactText(err))
            writeJson(response, 400, {
              error: writerRefusalMessage(err),
            })
            return
          }
          console.error('[dsh-ccswitch-plugin] writer failed:', redactText(err))
          writeJson(response, 500, { error: 'could not write the tool configuration' })
        }
      },
    },
  ]
}

/**
 * Explain a refused write without leaking a path the user did not name.
 *
 * A `parse`/`shape` refusal is the important one: it means the target file
 * exists and this plugin will not touch it. That has to read as a deliberate
 * refusal rather than a bug, because the file is unchanged and the user's next
 * move is to fix or move it.
 */
function writerRefusalMessage(err) {
  if (!(err instanceof WriterError)) {
    return `no writer for that app type; supported: ${WRITER_APP_TYPES.join(', ')}`
  }
  if (err.kind === 'unsupported') {
    return `no writer for that app type; supported: ${WRITER_APP_TYPES.join(', ')}`
  }
  if (err.kind === 'credential') {
    return 'this provider has no key stored, so writing it would leave the tool unable to authenticate'
  }
  if (err.kind === 'parse') {
    const where = err.line === undefined ? '' : ` (line ${err.line} column ${err.column})`
    return `the existing configuration is not valid JSON${where}, so it was left untouched`
  }
  return 'the existing configuration has an unexpected shape, so it was left untouched'
}
