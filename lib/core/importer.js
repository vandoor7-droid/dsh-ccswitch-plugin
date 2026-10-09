// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { credentialRefForProviderKey } from './ids.js'
import { toProviderProfile, resolveProviderKey } from './mapper.js'
import { jsonEqual } from './json-equal.js'
import { BLOCKED, IMPORT_FAILURE, isSettingsConflict, redactText } from './safety.js'

/** Import selected profiles into DSH. Secrets stay in the Host process. */
export async function importProfiles({ profiles, selectedIds, settings, credentials, expectedRevision }) {
  const selected = new Set(selectedIds ?? [])
  const results = []
  // Shallow copy: the source object is the live settings document, and we mirror
  // each successful write back into this map so a batch behaves exactly like the
  // same profiles imported one after another.
  const existing = { ...((await readExistingProviders(settings)) ?? {}) }
  const usedKeys = new Set()
  // The caller's revision says "this is the document I was looking at", which is
  // only meaningful for the first write. Every successful mutate advances the
  // document revision, so the next profile in the same batch must re-read it —
  // otherwise profiles 2..N are rejected as stale and never import.
  let revisionForNextWrite = expectedRevision

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
    if (wasConfigured && jsonEqual(existing[key], mapped)) {
      results.push({ profileId: profile.profileId, profileName: profile.profileName, providerKey: key, status: 'unchanged', warnings })
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
        warnings,
      })
      continue
    }

    try {
      await settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', key], value: mapped }], revisionForNextWrite)
    } catch (err) {
      const conflict = isSettingsConflict(err)
      const failure = {
        profileId: profile.profileId,
        profileName: profile.profileName,
        providerKey: key,
        status: 'failed',
        errorCode: conflict ? IMPORT_FAILURE.CONFLICT : IMPORT_FAILURE.SETTINGS,
        error: `设置写入失败：${redactText(err, [profile.apiKey])}`,
        warnings,
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
    revisionForNextWrite = await readRevision(settings)
    results.push({ profileId: profile.profileId, profileName: profile.profileName, providerKey: key, status: wasConfigured ? 'updated' : 'new', warnings })
  }
  return results
}

async function readExistingProviders(settings) {
  try {
    // 0.2.0 SettingsForms: no get(); describe() returns per-namespace views.
    if (typeof settings?.describe === 'function') {
      const namespaces = await settings.describe()
      const namespace = (Array.isArray(namespaces) ? namespaces : []).find((entry) => entry.ns === 'llm-pi-ai')
      if (namespace?.value?.providers) return namespace.value.providers
    }
    if (typeof settings?.get === 'function') {
      const value = await settings.get('llm-pi-ai')
      if (value && typeof value === 'object' && value.providers) return value.providers
    }
  } catch { /* fall through */ }
  return undefined
}

/**
 * Current document revision for the compare-and-set precondition. Returns
 * `undefined` when the service cannot report one, which makes `mutate` skip the
 * check — the same behaviour the first write has when the client sends none.
 */
async function readRevision(settings) {
  try {
    if (typeof settings?.describe === 'function') {
      const namespaces = await settings.describe()
      const namespace = (Array.isArray(namespaces) ? namespaces : []).find((entry) => entry.ns === 'llm-pi-ai')
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
