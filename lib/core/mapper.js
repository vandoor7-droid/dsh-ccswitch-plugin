// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { credentialRefForProviderKey, providerKey, variantKey } from './ids.js'
import { normalizeImportedEffort, seedReasoning } from '../../src/domain/import-reasoning.mjs'
import { catalogFieldsFor, isThinkingModel } from '../../src/domain/model-catalog.mjs'
import { normalizeCCSProvider, validateCCSProvider } from '../../src/domain/ccs-provider.mjs'
import { jsonEqual } from './json-equal.js'

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Enrich one source model with static-catalog fields. Existing per-model
 * fields always win; the catalog only fills what the source row lacked.
 */
function enrichModel(sourceModel, profile) {
  const catalog = catalogFieldsFor(sourceModel.id)
  const next = { ...catalog, ...sourceModel }
  const thinking = sourceModel.fallbackThinking === true || isThinkingModel(sourceModel.id)
  if (profile.api === 'anthropic-messages' && thinking) {
    const currentCompat = isObject(next.compat) ? next.compat : {}
    if (currentCompat.forceAdaptiveThinking === undefined) {
      next.compat = { ...currentCompat, forceAdaptiveThinking: true }
    }
  }
  delete next.fallbackThinking
  return next
}

function profileWarnings(profile, extra = []) {
  const modelId = profile.models?.find((model) => typeof model?.id === 'string')?.id
  const seed = modelId === undefined ? { warnings: [] } : seedReasoning(modelId, profile.modelReasoningEffort)
  return [...new Set([...(profile.warnings ?? []), ...(seed.warnings ?? []), ...extra])]
}

function preservationWarnings(profile, existing) {
  if (!isObject(existing)) return []
  const warnings = []
  const primaryModel = profile.models?.find((model) => typeof model?.id === 'string')
  if (existing.reasoning !== undefined && primaryModel) {
    const importedDefault = seedReasoning(primaryModel.id, profile.modelReasoningEffort).defaultEffort
    if (importedDefault !== undefined && existing.reasoning !== importedDefault) {
      warnings.push(`已保留现有 route reasoning ${existing.reasoning}，未覆盖导入值 ${importedDefault}`)
    }
  }
  const existingModels = Array.isArray(existing.models) ? existing.models : []
  for (const sourceModel of (profile.models ?? [])) {
    const current = existingModels.find((model) => model?.id === sourceModel?.id)
    if (!current || current.reasoningEfforts === undefined) continue
    const importedEfforts = seedReasoning(sourceModel.id, profile.modelReasoningEffort).efforts
    if (importedEfforts !== undefined && JSON.stringify(current.reasoningEfforts) !== JSON.stringify(importedEfforts)) {
      warnings.push(`已保留模型 ${sourceModel.id} 的现有 reasoningEfforts`)
    }
  }
  return warnings
}

export function normalizeBaseUrl(url) {
  return String(url ?? '').replace(/\/+$/, '')
}

/** A profile's source models, as objects, minus the ones with no usable id. */
function sourceModelsOf(profile) {
  return (profile.models ?? [])
    .map((model) => (typeof model === 'string' ? { id: model } : model))
    .filter((model) => typeof model?.id === 'string' && model.id.length > 0)
}

/**
 * Project a profile's models onto a target's existing model list.
 *
 * Both namespaces are built from this one function on purpose. The route and
 * the catalogue have to agree about which models a provider serves — the
 * manager table would otherwise show a provider that routes somewhere else.
 */
function buildModels(profile, existingModels) {
  const existing = Array.isArray(existingModels) ? existingModels : []
  const sourceModels = sourceModelsOf(profile)
  const sourceIds = new Set(sourceModels.map((model) => model.id))
  const models = sourceModels.map((sourceModel) => {
    const current = existing.find((model) => model?.id === sourceModel.id)
    const enriched = enrichModel(sourceModel, profile)
    // Existing manual fields win over catalog fills; catalog only fills gaps.
    // Internal flags (fallbackThinking) never reach the output.
    const { fallbackThinking: _flag, ...source } = sourceModel
    const next = { ...enriched, ...(isObject(current) ? current : {}), ...source }
    delete next.fallbackThinking
    // Merge compat instead of letting an existing compat object shadow the
    // thinking flag that enrichModel just derived (e.g. forceAdaptiveThinking).
    if (isObject(enriched.compat) || isObject(next.compat)) {
      next.compat = { ...(enriched.compat ?? {}), ...(isObject(next.compat) ? next.compat : {}) }
    }
    if (current?.reasoningEfforts === undefined) {
      next.reasoningEfforts = seedReasoning(sourceModel.id, profile.modelReasoningEffort).efforts
    }
    return next
  })
  for (const model of existing) {
    if (isObject(model) && typeof model.id === 'string' && !sourceIds.has(model.id)) models.push({ ...model })
  }
  return { models, sourceModels }
}

export function toProviderProfile(profile, existing, providerKeyValue) {
  const previous = isObject(existing) ? existing : {}
  const resolvedKey = providerKeyValue ?? providerKey(profile.profileId, profile.profileName)
  const key = credentialRefForProviderKey(resolvedKey)
  const { models, sourceModels } = buildModels(profile, previous.models)
  const mapped = {
    ...previous,
    displayName: profile.profileName,
    baseURL: normalizeBaseUrl(profile.baseURL),
    api: profile.api,
    apiKeyEnv: key,
    models,
  }
  const primaryModel = sourceModels[0]
  if (mapped.reasoning === undefined && primaryModel) {
    const defaultEffort = seedReasoning(primaryModel.id, profile.modelReasoningEffort).defaultEffort
    if (defaultEffort !== undefined) mapped.reasoning = defaultEffort
  }
  return mapped
}

/**
 * The same profile as a record in this plugin's own catalogue.
 *
 * An import has to land in two namespaces, and they are not redundant:
 * `llm-pi-ai` is the route DSH calls, while the catalogue is what the
 * provider-manager UI lists. A provider in only the first cannot be seen or
 * edited; in only the second it cannot be called. So both projections are
 * derived here, side by side, from one profile.
 *
 * `notes`, `icon`, `iconColor` and the failover/cost columns are hand-managed
 * in DSH, so they ride along from `existing` untouched. `apiKeyEnv` is a
 * credential *reference*: the catalogue never holds key material, which is also
 * why `apiKey` on the profile is never read here.
 */
export function toCCSProvider(profile, existing, providerKeyValue) {
  const previous = isObject(existing) ? existing : {}
  const resolvedKey = providerKeyValue ?? providerKey(profile.profileId, profile.profileName)
  return normalizeCCSProvider({
    ...previous,
    displayName: profile.profileName,
    api: profile.api,
    baseURL: normalizeBaseUrl(profile.baseURL),
    apiKeyEnv: credentialRefForProviderKey(resolvedKey),
    models: buildModels(profile, previous.models).models,
    ...(profile.appType === undefined ? {} : { appType: profile.appType }),
    ...(profile.profileId === undefined ? {} : { sourceProfileId: profile.profileId }),
    ...(profile.notes === undefined ? {} : { notes: profile.notes }),
    ...(profile.icon === undefined ? {} : { icon: profile.icon }),
    ...(profile.iconColor === undefined ? {} : { iconColor: profile.iconColor }),
    // Carried through the catalogue so activation can put the provider's own
    // compatibility switches into the file it rewrites. `normalizeCCSProvider`
    // filters the key set, so a row cannot smuggle an arbitrary key in here.
    ...(profile.exclusiveEnv === undefined ? {} : { exclusiveEnv: profile.exclusiveEnv }),
    // The vendor site and CC Switch's own grouping. Both are hand-editable in
    // the manager, so an existing value is kept when the row carries none —
    // which is what the spread-over-`previous` order already does.
    ...(profile.websiteUrl === undefined ? {} : { websiteUrl: profile.websiteUrl }),
    ...(profile.category === undefined ? {} : { category: profile.category }),
  })
}

export function redactSummary(profile, key, status, extraWarnings = []) {
  return {
    profileId: profile.profileId,
    profileName: profile.profileName,
    sourceLabel: 'CCSwitch',
    providerKey: key,
    baseURL: normalizeBaseUrl(profile.baseURL),
    api: profile.api,
    modelCount: (profile.models ?? []).length,
    modelIds: (profile.models ?? []).map((m) => m.id),
    credential: profile.apiKey !== undefined ? 'found' : 'missing',
    reasoningEffort: normalizeImportedEffort(profile.modelReasoningEffort),
    status,
    warnings: profileWarnings(profile, extraWarnings),
    blockedReason: profile.blocked ? profile.blockedReason : undefined,
    // The code/detail pair travels next to the Host-facing prose so the browser
    // can label the row in its own locale without parsing Chinese.
    blockedCode: profile.blocked ? profile.blockedCode : undefined,
    blockedDetail: profile.blocked ? profile.blockedDetail : undefined,
  }
}

export function resolveProviderKey(profile, existingProviders) {
  const existing = existingProviders ?? {}
  const baseKey = providerKey(profile.profileId, profile.profileName)
  let key = baseKey
  const sameRoute = (entry) => entry?.displayName === profile.profileName && entry?.baseURL === normalizeBaseUrl(profile.baseURL)
  let collisionWarning
  if (existing[key] !== undefined && !sameRoute(existing[key])) {
    let index = 1
    while (existing[variantKey(baseKey, index)] !== undefined) {
      const candidate = variantKey(baseKey, index)
      if (sameRoute(existing[candidate])) {
        key = candidate
        break
      }
      index += 1
    }
    if (key === baseKey) key = variantKey(baseKey, index)
    collisionWarning = `已存在同名 provider，将使用 ${key} 导入，不覆盖现有配置`
  }
  const warnings = profileWarnings(profile, [
    ...(collisionWarning ? [collisionWarning] : []),
    ...preservationWarnings(profile, existing[key]),
  ])
  return { key, warnings }
}

/**
 * Classify each profile for the preview list.
 *
 * `existingCatalogue` is this plugin's own provider map. Pass it whenever the
 * caller can read it: an import writes BOTH namespaces, so a profile whose route
 * is already correct but whose catalogue entry is missing is not "up to date" —
 * reporting it as unchanged would promise the user nothing would happen and then
 * write on import. Omit it and only the route is considered, which is what a
 * caller that cannot read the catalogue namespace still gets.
 */
export function classifyProfiles(profiles, existingProviders, existingCatalogue) {
  const existing = existingProviders ?? {}
  const catalogue = existingCatalogue ?? {}
  const checkCatalogue = existingCatalogue !== undefined
  const seen = new Map()
  return profiles.map((profile) => {
    if (profile.skipped || profile.blocked) {
      return {
        profileId: profile.profileId,
        profileName: profile.profileName,
        status: 'blocked',
        summary: redactSummary(profile, '', 'blocked'),
      }
    }
    const { key, warnings } = resolveProviderKey(profile, existing)
    if (seen.has(key)) {
      const duplicateWarning = `provider 键 ${key} 重复，仅导入第一条`
      return {
        profileId: profile.profileId,
        profileName: profile.profileName,
        status: 'blocked',
        providerKey: key,
        warnings: [...warnings, duplicateWarning],
        summary: redactSummary(profile, key, 'blocked', [...warnings, duplicateWarning]),
      }
    }
    seen.set(key, true)
    const existingEntry = existing[key]
    const mapped = toProviderProfile(profile, existingEntry, key)
    const catalogueEntry = catalogue[key]
    const catalogueRecord = checkCatalogue
      ? toCCSProvider(profile, catalogueEntry, key)
      : undefined
    // A record the catalogue would refuse is not drift the import can correct, so
    // it does not hold the status back — it travels as a warning instead, exactly
    // as the importer treats it.
    const catalogueSettled = !checkCatalogue
      || !validateCCSProvider(catalogueRecord).ok
      || (catalogueEntry !== undefined && jsonEqual(normalizeCCSProvider(catalogueEntry), catalogueRecord))
    const status = existingEntry === undefined && (!checkCatalogue || catalogueEntry === undefined)
      ? 'new'
      : jsonEqual(existingEntry, mapped) && catalogueSettled
        ? 'unchanged'
        : 'update'
    return {
      profileId: profile.profileId,
      profileName: profile.profileName,
      status,
      providerKey: key,
      warnings,
      summary: redactSummary(profile, key, status, warnings),
    }
  })
}
