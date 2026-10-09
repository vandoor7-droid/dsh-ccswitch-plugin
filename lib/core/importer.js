// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { credentialRefForProviderKey } from './ids.js'
import { toProviderProfile, toCCSProvider, resolveProviderKey } from './mapper.js'
import { jsonEqual } from './json-equal.js'
import { BLOCKED, IMPORT_FAILURE, isSettingsConflict, redactText } from './safety.js'
import { normalizeCCSProvider, validateCCSProvider } from '../../src/domain/ccs-provider.mjs'

/**
 * DSH's own routing table: a provider projected here is one DSH itself can call.
 */
const ROUTE_NAMESPACE = 'llm-pi-ai'

/**
 * This plugin's provider catalogue, which the manager UI in DSH Settings reads.
 *
 * It is the plugin's loader row id from `cordis.patch.yml`, because
 * `SettingsForms.describe()` reports a descriptor's `ns` as exactly that id.
 * Spelled out rather than imported from `src/host/manager-routes.mjs`: that
 * module imports this one, so taking it from there would be a cycle, and it
 * would drag the writer stack into every caller of the importer.
 */
const CCS_NAMESPACE = 'dsh-ccswitch-plugin'

/**
 * Reported when the route landed but the catalogue did not.
 *
 * The two halves fail independently, and this one means "DSH can call this
 * provider, the manager table just cannot see it" — a different thing to tell
 * the user than "nothing was written".
 */
const CATALOGUE_FAILURE = IMPORT_FAILURE.CATALOGUE

/** Import selected profiles into DSH. Secrets stay in the Host process. */
export async function importProfiles({ profiles, selectedIds, settings, credentials, expectedRevision }) {
  const selected = new Set(selectedIds ?? [])
  const results = []
  // Shallow copy: the source object is the live settings document, and we mirror
  // each successful write back into this map so a batch behaves exactly like the
  // same profiles imported one after another.
  const existing = { ...((await readProviders(settings, ROUTE_NAMESPACE)) ?? {}) }
  const catalogue = { ...((await readProviders(settings, CCS_NAMESPACE)) ?? {}) }
  const usedKeys = new Set()
  // The caller's revision says "this is the document I was looking at", which is
  // only meaningful for the first write. Every successful mutate advances the
  // document revision, so the next profile in the same batch must re-read it —
  // otherwise profiles 2..N are rejected as stale and never import.
  let revisionForNextWrite = expectedRevision
  // Revisions are per namespace, not per document, so the catalogue needs its
  // own counter. The caller's revision is the `llm-pi-ai` one and must never be
  // replayed here: it would name a revision of a different document entirely.
  let catalogueRevisionForNextWrite = await readRevision(settings, CCS_NAMESPACE)

  for (const profile of profiles) {
    if (profile.skipped) {
      results.push({ profileId: profile.profileId, profileName: profile.profileName, status: 'skipped', skipReason: profile.skipReason })
      continue
    }
    if (!selected.has(profile.profileId)) {
      results.push({ profileId: profile.profileId, profileName: profile.profileName, status: 'skipped', skipReason: '未选择' })
      continue
    }
    if (profile.blocked) {
      results.push({
        profileId: profile.profileId,
        profileName: profile.profileName,
        status: 'blocked',
        error: profile.blockedReason,
        blockedCode: profile.blockedCode ?? BLOCKED.UNKNOWN,
        blockedDetail: profile.blockedDetail,
      })
      continue
    }

    const { key, warnings } = resolveProviderKey(profile, existing)
    const ref = credentialRefForProviderKey(key)
    if (usedKeys.has(key)) {
      results.push({
        profileId: profile.profileId,
        profileName: profile.profileName,
        status: 'blocked',
        error: `provider 键 ${key} 重复`,
        blockedCode: BLOCKED.DUPLICATE_PROVIDER_KEY,
        blockedDetail: key,
        warnings,
      })
      continue
    }
    usedKeys.add(key)

    const wasConfigured = existing[key] !== undefined
    const mapped = toProviderProfile(profile, existing[key], key)

    // The catalogue is a second projection of the same profile, and the two can
    // disagree — a provider imported before this namespace existed is correct in
    // the route and absent from the catalogue, and the manager table would show
    // nothing to edit. So a profile is only up to date when BOTH halves already
    // match; anything else has to be written.
    const catalogueExisting = catalogue[key]
    const catalogueRecord = toCCSProvider(profile, catalogueExisting, key)
    // A record the manager UI cannot load is worse than no record: it lists with
    // no models, or activates a provider that can never answer. Refusing the
    // catalogue half leaves the route — the thing DSH actually calls — intact.
    const catalogueCheck = validateCCSProvider(catalogueRecord)
    const catalogueWarnings = catalogueCheck.ok
      ? []
      : [`未写入 provider 目录：${catalogueCheck.message}`]
    // Compare normalised against normalised: the schema round-trip fills defaults
    // (`isCurrent: false`) that the writer omits, so a raw comparison would call
    // every already-imported provider stale and rewrite it on every import.
    const catalogueUpToDate = catalogueExisting !== undefined
      && jsonEqual(normalizeCCSProvider(catalogueExisting), catalogueRecord)
    // An unwritable record is not drift to be corrected — writing the route again
    // would not make it valid — so it settles the comparison and travels as a
    // warning instead.
    const catalogueSettled = !catalogueCheck.ok || catalogueUpToDate
    const routeSettled = wasConfigured && jsonEqual(existing[key], mapped)

    if (routeSettled && catalogueSettled) {
      results.push({
        profileId: profile.profileId,
        profileName: profile.profileName,
        providerKey: key,
        status: 'unchanged',
        warnings: mergeWarnings(warnings, catalogueWarnings),
      })
      continue
    }

    const previousCredential = await readCredential(credentials, ref)
    try {
      await credentials.set(ref, profile.apiKey)
    } catch (err) {
      results.push({
        profileId: profile.profileId,
        profileName: profile.profileName,
        providerKey: key,
        status: 'failed',
        errorCode: IMPORT_FAILURE.CREDENTIAL,
        error: `凭据写入失败：${redactText(err, [profile.apiKey])}`,
        warnings: mergeWarnings(warnings, catalogueWarnings),
      })
      continue
    }

    // The route goes first and keeps the caller's revision: it is the write whose
    // compare-and-set the browser established, and the one existing clients
    // already depend on failing loudly and rolling the credential back. A route
    // that already matches is left alone rather than rewritten — re-sending it
    // would re-test a precondition the caller's stale revision can fail, turning
    // a catalogue-only repair into a conflict.
    if (!routeSettled) {
      try {
        await settings.mutate(ROUTE_NAMESPACE, [{ op: 'set', path: ['providers', key], value: mapped }], revisionForNextWrite)
      } catch (err) {
        const conflict = isSettingsConflict(err)
        const failure = {
          profileId: profile.profileId,
          profileName: profile.profileName,
          providerKey: key,
          status: 'failed',
          errorCode: conflict ? IMPORT_FAILURE.CONFLICT : IMPORT_FAILURE.SETTINGS,
          error: `设置写入失败：${redactText(err, [profile.apiKey])}`,
          warnings: mergeWarnings(warnings, catalogueWarnings),
        }
        try {
          await restoreCredential(credentials, ref, previousCredential)
        } catch (cleanupErr) {
          results.push({
            ...failure,
            errorCode: IMPORT_FAILURE.ROLLBACK,
            error: `${failure.error}；且凭据回滚失败：${redactText(cleanupErr, [profile.apiKey])}`,
          })
          continue
        }
        results.push(failure)
        continue
      }
      existing[key] = mapped
      // Re-read after every write: a successful mutate advances the document
      // revision. If the service cannot report one, drop the precondition for the
      // rest of the batch instead of re-sending a revision we know is now stale.
      revisionForNextWrite = await readRevision(settings, ROUTE_NAMESPACE)
    }

    if (catalogueCheck.ok && !catalogueUpToDate) {
      try {
        await settings.mutate(CCS_NAMESPACE, [{ op: 'set', path: ['providers', key], value: catalogueRecord }], catalogueRevisionForNextWrite)
      } catch (err) {
        // The route already landed, so the credential stays. Undoing it would
        // leave DSH calling a provider whose key no longer exists — broken in a
        // way neither screen shows. Report the half that landed and the half
        // that did not, and let the user retry; the next import repairs it.
        results.push({
          profileId: profile.profileId,
          profileName: profile.profileName,
          providerKey: key,
          status: 'failed',
          errorCode: CATALOGUE_FAILURE,
          error: `provider 路由已写入，但 provider 目录写入失败：${redactText(err, [profile.apiKey])}`,
          warnings: mergeWarnings(warnings, catalogueWarnings),
        })
        continue
      }
      catalogue[key] = catalogueRecord
      catalogueRevisionForNextWrite = await readRevision(settings, CCS_NAMESPACE)
    }

    results.push({
      profileId: profile.profileId,
      profileName: profile.profileName,
      providerKey: key,
      status: wasConfigured ? 'updated' : 'new',
      warnings: mergeWarnings(warnings, catalogueWarnings),
    })
  }
  return results
}

function mergeWarnings(warnings, extra) {
  return extra.length === 0 ? warnings : [...new Set([...warnings, ...extra])]
}

/**
 * The `providers` map of one namespace, or undefined when it has none.
 *
 * 0.2.0 SettingsForms: no get(); describe() returns per-namespace views.
 */
async function readProviders(settings, ns) {
  try {
    if (typeof settings?.describe === 'function') {
      const namespaces = await settings.describe()
      const namespace = (Array.isArray(namespaces) ? namespaces : []).find((entry) => entry.ns === ns)
      if (namespace?.value?.providers) return namespace.value.providers
    }
    if (typeof settings?.get === 'function') {
      const value = await settings.get(ns)
      if (value && typeof value === 'object' && value.providers) return value.providers
    }
  } catch { /* fall through */ }
  return undefined
}

/**
 * Current revision of one namespace for the compare-and-set precondition.
 * Returns `undefined` when the service cannot report one, which makes `mutate`
 * skip the check — the same behaviour the first write has when the client sends
 * none.
 */
async function readRevision(settings, ns) {
  try {
    if (typeof settings?.describe === 'function') {
      const namespaces = await settings.describe()
      const namespace = (Array.isArray(namespaces) ? namespaces : []).find((entry) => entry.ns === ns)
      if (namespace?.revision !== undefined) return namespace.revision
    }
  } catch { /* compare-and-set unavailable */ }
  return undefined
}

async function readCredential(credentials, ref) {
  if (typeof credentials?.resolve === 'function') {
    try {
      const resolved = await credentials.resolve(ref)
      if (resolved?.value !== undefined) return { configured: true, value: resolved.value }
    } catch { /* use describe fallback */ }
  }
  if (typeof credentials?.describe === 'function') {
    try {
      const described = await credentials.describe(ref)
      return { configured: described?.configured === true, value: undefined }
    } catch { /* treat unavailable state as absent */ }
  }
  return { configured: false, value: undefined }
}

async function restoreCredential(credentials, ref, previous) {
  if (previous.value !== undefined) return credentials.set(ref, previous.value)
  if (!previous.configured) return credentials.unset(ref)
}
