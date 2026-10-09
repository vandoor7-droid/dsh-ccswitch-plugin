// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { pickClaudeExclusiveEnv } from '../../lib/core/claude-exclusive.js'

/**
 * The provider shape this plugin stores in its own settings namespace, plus the
 * pure functions that normalise and validate one.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * 1. **The schema is built by a factory, not at module scope.** A plugin
 *    declares its settings namespace by exporting a `Config` schema, and
 *    whether a field is live-editable is decided by schemastery's
 *    `.volatile()`. Only DSH's own schemastery build implements that: it is
 *    what wraps the marked node in a cosmokit `Volatile`, which the Loader's
 *    volatile-commit path walks. A schema built with the public `schemastery`
 *    package produces plain values instead, leaves the Loader nothing to
 *    commit, and silently drops every write — the save reports success and the
 *    value never changes. So `z` arrives as an argument and the host entry
 *    passes DSH's, rather than this module resolving one of its own.
 *
 * 2. **`apiKeyEnv` names a credential record; it never holds one.** The
 *    settings document is plaintext YAML under the user's profile, so a stored
 *    key would sit in the clear next to every other setting. The field carries
 *    the same `role('credential-ref')` mark `dsh-llm-pi-ai` puts on its own,
 *    which is what lets the settings layer treat it as a reference.
 */

/**
 * The three wire protocols `@deepseek-ai/dsh-llm-pi-ai` can actually serve.
 * Any other value produces a provider that registers and can never answer, so
 * this list is also the validation gate — it is not a display hint.
 */
export const CCS_API_PROTOCOLS = Object.freeze([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
])

/** Reasoning levels llm-pi-ai understands, in ascending depth. */
export const CCS_REASONING_LEVELS = Object.freeze([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

const PROTOCOL_SET = new Set(CCS_API_PROTOCOLS)
const LEVEL_SET = new Set(CCS_REASONING_LEVELS)

/** One model entry: id plus whatever the source row knew about it. */
export function defineCCSModel(z) {
  return z.object({
    id: z.string().required(),
    name: z.string(),
    contextWindow: z.number().step(1).min(1),
    maxTokens: z.number().step(1).min(1),
    // `false` disables reasoning for this model; a dict maps each level to the
    // wire spelling the endpoint expects, or null for "send nothing".
    reasoningEfforts: z.union([
      z.const(false),
      z.dict(z.union([z.string(), z.const(null)])),
    ]),
  })
}

/** One stored provider. */
export function defineCCSProvider(z) {
  return z.object({
    displayName: z.string(),
    api: z.union([...CCS_API_PROTOCOLS]),
    baseURL: z.string(),
    apiKeyEnv: z.string().role('credential-ref'),
    models: z.array(defineCCSModel(z)).default([]),
    // The provider's own Claude Code compatibility switches and window sizes.
    // Kept as a dict of primitives rather than a fixed key set so a value the
    // schema does not know yet survives a round-trip; `pickClaudeExclusiveEnv`
    // is what narrows it to keys this plugin is willing to write.
    exclusiveEnv: z.dict(z.union([z.string(), z.number(), z.boolean()])),
    notes: z.string(),
    icon: z.string(),
    iconColor: z.string(),
    appType: z.string(),
    sourceProfileId: z.string(),
    // CC Switch orders a provider list by `COALESCE(sort_index, 999999),
    // created_at ASC, id ASC`. Both columns are nullable there, so both fields
    // are optional here: a provider the user has never reordered has no index,
    // and a row imported from a database that predates the column has no
    // creation time.
    sortIndex: z.number().step(1).min(0),
    createdAt: z.number(),
    isCurrent: z.boolean().default(false),
    inFailoverQueue: z.boolean().default(false),
    costMultiplier: z.number().min(0),
    limitDailyUsd: z.number().min(0),
    limitMonthlyUsd: z.number().min(0),
  })
}

/**
 * The plugin's `Config` schema.
 *
 * `providers` is the volatile node and the *root* is not. `describe()` skips a
 * namespace whose projected form comes back empty, so marking nothing means
 * the namespace never appears in Settings at all; marking the root would
 * expose the whole dict as one opaque field. Marking exactly the field that
 * holds the catalogue is what makes a CRUD write land without a remount —
 * the same thing `dsh-llm-pi-ai` does with its own `providers`.
 */
export function defineCCSConfig(z) {
  return z.object({
    providers: z.dict(defineCCSProvider(z)).default({}).volatile(),
  })
}

/** A blank provider a "new provider" form can start from. */
export function emptyCCSProvider(overrides = {}) {
  return {
    displayName: '',
    api: CCS_API_PROTOCOLS[0],
    baseURL: '',
    apiKeyEnv: '',
    models: [],
    isCurrent: false,
    inFailoverQueue: false,
    ...overrides,
  }
}

/** Strip trailing slashes so two spellings of one endpoint compare equal. */
export function normalizeBaseUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/, '')
}

/** A finite number from a number or a numeric string, else undefined. */
function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function nonEmptyText(value) {
  const text = String(value ?? '').trim()
  return text === '' ? undefined : text
}

/**
 * Coerce one provider to the stored shape: known fields only, strings trimmed,
 * numeric strings resolved, models de-duplicated by id.
 *
 * Optional fields are omitted rather than stored empty. That is not cosmetic:
 * the settings layer diffs the projected form to decide whether a document
 * changed, so a field that round-trips as `""` instead of absent shows up as
 * a spurious edit on every save.
 *
 * This deliberately does not enforce the protocol allow-list or the model
 * requirement — gating a write is {@link validateCCSProvider}'s job, and a
 * value that is unusable should reach it intact so the error can name what was
 * actually wrong instead of what normalisation rewrote it to.
 */
export function normalizeCCSProvider(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const models = []
  const seen = new Set()
  for (const entry of Array.isArray(source.models) ? source.models : []) {
    const model = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry
      : typeof entry === 'string' ? { id: entry } : undefined
    if (model === undefined) continue
    const id = nonEmptyText(model.id)
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    const next = { id }
    const name = nonEmptyText(model.name)
    if (name !== undefined) next.name = name
    const contextWindow = finiteNumber(model.contextWindow)
    if (contextWindow !== undefined && contextWindow >= 1) next.contextWindow = truncate(contextWindow)
    const maxTokens = finiteNumber(model.maxTokens)
    if (maxTokens !== undefined && maxTokens >= 1) next.maxTokens = truncate(maxTokens)
    if (model.reasoningEfforts === false) next.reasoningEfforts = false
    else if (model.reasoningEfforts && typeof model.reasoningEfforts === 'object') {
      next.reasoningEfforts = { ...model.reasoningEfforts }
    }
    models.push(next)
  }

  const provider = {
    displayName: String(source.displayName ?? '').trim(),
    api: String(source.api ?? '').trim(),
    baseURL: normalizeBaseUrl(source.baseURL),
    apiKeyEnv: String(source.apiKeyEnv ?? '').trim(),
    models,
  }
  // Only known keys, only primitive values: this is what stops an edited
  // settings document from steering an arbitrary key into another tool's file.
  const exclusiveEnv = pickClaudeExclusiveEnv(source.exclusiveEnv)
  if (Object.keys(exclusiveEnv).length > 0) provider.exclusiveEnv = exclusiveEnv
  for (const field of ['notes', 'icon', 'iconColor', 'appType', 'sourceProfileId']) {
    const text = nonEmptyText(source[field])
    if (text !== undefined) provider[field] = text
  }
  // Only a real `true` sets a flag: a truthy string is a data error, not a yes.
  if (source.isCurrent === true) provider.isCurrent = true
  if (source.inFailoverQueue === true) provider.inFailoverQueue = true
  for (const field of ['costMultiplier', 'limitDailyUsd', 'limitMonthlyUsd']) {
    const amount = finiteNumber(source[field])
    if (amount !== undefined && amount >= 0) provider[field] = amount
  }
  // Ordering. `sortIndex` is an ordinal, so a negative or fractional value is a
  // data error rather than something to round; `createdAt` is an epoch stamp and
  // is carried as given, since only its relative order is ever used.
  const sortIndex = finiteNumber(source.sortIndex)
  if (sortIndex !== undefined && sortIndex >= 0) provider.sortIndex = truncate(sortIndex)
  const createdAt = finiteNumber(source.createdAt)
  if (createdAt !== undefined) provider.createdAt = createdAt
  return provider
}

/**
 * The catalogue's keys in CC Switch's own order.
 *
 * Mirrors `ORDER BY COALESCE(sort_index, 999999), created_at ASC, id ASC`
 * (`database/dao/providers.rs`). The index is a sparse ordinal the user sets by
 * reordering, so a provider that was never moved sorts after every one that
 * was; a missing creation time sorts before any real one, which is what SQLite
 * does with NULL in an ascending sort. The key is the final tiebreak so the
 * order is total and does not depend on the insertion order of the document.
 *
 * @param providers - the catalogue, keyed by provider key.
 * @returns an array of keys, never undefined.
 */
export function orderProviders(providers) {
  const UNSORTED = 999999
  return Object.entries(providers ?? {})
    .map(([key, provider]) => ({ key, provider }))
    .sort((a, b) => {
      const aIndex = Number.isInteger(a.provider?.sortIndex) ? a.provider.sortIndex : UNSORTED
      const bIndex = Number.isInteger(b.provider?.sortIndex) ? b.provider.sortIndex : UNSORTED
      if (aIndex !== bIndex) return aIndex - bIndex
      const aCreated = Number.isFinite(a.provider?.createdAt) ? a.provider.createdAt : Number.NEGATIVE_INFINITY
      const bCreated = Number.isFinite(b.provider?.createdAt) ? b.provider.createdAt : Number.NEGATIVE_INFINITY
      if (aCreated !== bCreated) return aCreated - bCreated
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
    })
    .map((entry) => entry.key)
}

/** Truncate a positive amount to an integer without importing Math semantics. */
function truncate(value) {
  return Number.isInteger(value) ? value : Math.trunc(value)
}

/**
 * Whether a normalised provider can be stored and later served.
 *
 * @returns `{ok: true}`, or `{ok: false, message}` naming the first problem.
 */
export function validateCCSProvider(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: 'provider must be an object' }
  }
  if (String(value.displayName ?? '').trim() === '') {
    return { ok: false, message: 'displayName is required' }
  }
  const api = String(value.api ?? '').trim()
  if (api === '') return { ok: false, message: 'api is required' }
  if (!PROTOCOL_SET.has(api)) {
    return { ok: false, message: `api "${api}" is not one of ${CCS_API_PROTOCOLS.join(', ')}` }
  }
  const baseURL = String(value.baseURL ?? '').trim()
  if (baseURL === '') return { ok: false, message: 'baseURL is required' }
  try {
    // A provider whose endpoint does not parse can never be served, and the
    // failure would otherwise surface much later as an opaque request error.
    new URL(baseURL)
  } catch {
    return { ok: false, message: `baseURL "${baseURL}" is not a URL` }
  }
  const models = Array.isArray(value.models) ? value.models : []
  if (models.length === 0) return { ok: false, message: 'at least one model is required' }
  for (const model of models) {
    const id = model && typeof model === 'object' ? String(model.id ?? '').trim() : ''
    if (id === '') return { ok: false, message: 'every model needs an id' }
    const efforts = model.reasoningEfforts
    if (efforts === undefined || efforts === false) continue
    if (typeof efforts !== 'object' || efforts === null || Array.isArray(efforts)) {
      return { ok: false, message: `model "${id}" reasoningEfforts must be false or an object` }
    }
    for (const [level, wire] of Object.entries(efforts)) {
      if (!LEVEL_SET.has(level)) {
        return { ok: false, message: `model "${id}" has an unknown reasoning level "${level}"` }
      }
      if (wire !== null && typeof wire !== 'string') {
        return { ok: false, message: `model "${id}" level "${level}" must be a string or null` }
      }
      // `off` may map to null ("send nothing"); any other level has to say what
      // to send, or it is indistinguishable from "leave it out".
      if (level !== 'off' && (wire === null || wire.trim() === '')) {
        return { ok: false, message: `model "${id}" level "${level}" needs a wire value` }
      }
    }
  }
  return { ok: true }
}

/**
 * The app type a stored provider belongs to.
 *
 * A record written before `appType` was captured carries none. Those can only
 * be Claude Code providers — it was the only app type this plugin wrote at the
 * time — so the default is `claude`. The manager route resolves an unspecified
 * app type the same way, and the two must agree: if they drifted, activating a
 * provider would clear the pointer for one app type while the row claimed
 * another, and the badge would sit on two providers at once.
 */
export const DEFAULT_APP_TYPE = 'claude'

export function effectiveAppType(provider) {
  const own = provider?.appType
  return typeof own === 'string' && own !== '' ? own : DEFAULT_APP_TYPE
}

/**
 * Mark one provider current **within its own app type**, leaving every other
 * app type's pointer alone.
 *
 * CC Switch keeps `is_current` as a per-app singleton — its
 * `set_current_provider` (<code>database/dao/providers.rs</code>) clears the
 * flag `WHERE app_type = ?` and then sets it on one row, so the active Claude
 * provider and the active Codex provider coexist and switching one never
 * disturbs the other. A single global flag would make activating a Codex
 * provider silently deactivate the Claude provider that the user's other tool
 * is still pointed at, which is why this is a whole-catalogue edit returning
 * the complete next state rather than a single field write.
 *
 * Providers of other app types are returned untouched, not rewritten with a
 * normalised `isCurrent` — a row this call has no opinion about must not show
 * up as a settings diff on every activation.
 *
 * @param providers - the current catalogue, keyed by provider key.
 * @param key - the provider to activate; must already be present.
 * @throws when the key is not in the catalogue.
 */
export function activateCCSProvider(providers, key) {
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    throw new Error('providers must be an object')
  }
  if (!Object.hasOwn(providers, key)) throw new Error(`unknown provider: ${key}`)
  const appType = effectiveAppType(providers[key])
  return Object.fromEntries(
    Object.entries(providers).map(([entryKey, provider]) => [
      entryKey,
      effectiveAppType(provider) === appType
        ? { ...provider, isCurrent: entryKey === key }
        : provider,
    ]),
  )
}

/**
 * The key marked current within each app type, as `{ <appType>: <key> }`.
 *
 * Mirrors `get_current_provider(app_type)`: the question "which provider is
 * active" only has an answer per app, so a caller that wants one global answer
 * is asking the wrong question.
 */
export function currentKeysByApp(providers) {
  const current = {}
  for (const [key, provider] of Object.entries(providers ?? {})) {
    if (provider?.isCurrent !== true) continue
    const appType = effectiveAppType(provider)
    // First wins, so the result does not depend on key order if a document
    // somehow carries two current rows for one app.
    if (!Object.hasOwn(current, appType)) current[appType] = key
  }
  return current
}
