// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
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
    notes: z.string(),
    icon: z.string(),
    iconColor: z.string(),
    appType: z.string(),
    sourceProfileId: z.string(),
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
  return provider
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
 * Mark one provider current and clear every other one.
 *
 * CC Switch treats the active provider as a per-app singleton and keeps the
 * flag on each row, so activating one is a whole-catalogue edit rather than a
 * single field write. Returning the complete next catalogue keeps that
 * invariant in one place instead of at each call site.
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
  return Object.fromEntries(
    Object.entries(providers).map(([entryKey, provider]) => [
      entryKey,
      { ...provider, isCurrent: entryKey === key },
    ]),
  )
}
