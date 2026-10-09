// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { discoverSources, scanSource, defaultSourcePath, SCAN_REASON } from '../../lib/core/scan.js'
import { classifyProfiles } from '../../lib/core/mapper.js'
import { importProfiles as runImport } from '../../lib/core/importer.js'
import { probeModels, probeConnection, PROBE_REASON, PROBE_REASONS, PROBE_CHECK, PROBE_CHECKS } from '../../lib/core/probe.js'
import { redactText, BLOCKED, BLOCKED_CODES, IMPORT_FAILURE } from '../../lib/core/safety.js'

export const API_BASE = '/api/dsh-ccswitch'
const MAX_JSON_BODY_BYTES = 64 * 1024
// One "test connection" click probes one row; cap the fan-out so a crafted
// request cannot turn this endpoint into an outbound request storm.
const MAX_PROBE_TARGETS = 50
const SAFE_STATUSES = new Set(['new', 'update', 'updated', 'unchanged', 'blocked', 'failed', 'skipped'])
// Machine-readable failure kinds the browser is allowed to act on. Checked
// against a closed set rather than forwarded: `errorCode` reaches the client
// verbatim, and an unrecognised value would be an invitation to render it.
const SAFE_FAILURE_CODES = new Set(Object.values(IMPORT_FAILURE))
const SAFE_REASONING = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const SAFE_SCAN_REASONS = new Set(Object.values(SCAN_REASON))

export function isLoopbackRequest(request) {
  const address = request.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers?.host
  if (typeof host !== 'string') return false
  let hostUrl
  try { hostUrl = new URL(`http://${host}`) } catch { return false }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostUrl.hostname)) return false
  if (request.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers?.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === hostUrl.host } catch { return false }
}

function publicText(value) {
  return typeof value === 'string' ? value.slice(0, 200) : undefined
}

function publicEndpoint(value) {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return undefined
  }
}

function publicWarning(value) {
  const text = String(value ?? '')
  if (text.includes('requires_openai_auth')) return 'provider requires OpenAI authentication'
  if (text.includes('没有 model')) return 'model is missing from the source profile'
  if (text.startsWith('unknown reasoning effort')) return 'unknown reasoning effort; configure it in DSH'
  if (text.startsWith('reasoning effort')) return 'reasoning effort is outside the conservative catalog'
  if (text.includes('已保留模型')) return 'existing model reasoning settings were preserved'
  if (text.includes('已保留现有 route')) return 'existing route reasoning was preserved'
  if (text.includes('provider 键') || text.includes('同名 provider')) return 'provider key collision; existing provider was preserved'
  return 'source profile contains an import warning'
}

function publicWarnings(value) {
  return Array.isArray(value) ? value.slice(0, 20).map(publicWarning) : []
}

/**
 * Loopback-only API: surface the real failure reason, but never a credential.
 *
 * Shape matching alone is not enough — a relay key that does not start with
 * `sk-` would sail through — so the caller passes the concrete secrets for the
 * profile that failed and `redactText` removes them by value.
 */
function publicErrorDetail(value, secrets = []) {
  return redactText(value, secrets) || 'import failed'
}

function publicSummary(summary) {
  return {
    profileId: publicText(summary.profileId),
    profileName: publicText(summary.profileName),
    sourceLabel: 'CCSwitch',
    providerKey: publicText(summary.providerKey),
    baseURL: publicEndpoint(summary.baseURL),
    api: publicText(summary.api),
    modelCount: Number.isInteger(summary.modelCount) ? summary.modelCount : 0,
    modelIds: Array.isArray(summary.modelIds) ? summary.modelIds.filter((id) => typeof id === 'string').slice(0, 100) : [],
    credential: summary.credential === 'found' ? 'found' : 'missing',
    reasoningEffort: SAFE_REASONING.has(summary.reasoningEffort) ? summary.reasoningEffort : undefined,
    status: SAFE_STATUSES.has(summary.status) ? summary.status : 'blocked',
    warnings: publicWarnings(summary.warnings),
    // Kept for wire compatibility with consumers that only look for a flag.
    blockedReason: summary.blockedReason ? 'source profile is blocked' : undefined,
    // The browser labels the row from the code, not from the Chinese prose the
    // core builds for the log: one row per blocked profile, eight possible
    // reasons. `blockedDetail` carries the variable part (app type, npm name).
    blockedCode: BLOCKED_CODES.has(summary.blockedCode)
      ? summary.blockedCode
      : (summary.blockedReason ? BLOCKED.UNKNOWN : undefined),
    blockedDetail: publicText(summary.blockedDetail),
  }
}

function publicResult(result, secrets = []) {
  const status = SAFE_STATUSES.has(result?.status) ? result.status : 'failed'
  const output = {
    profileId: publicText(result?.profileId),
    profileName: publicText(result?.profileName),
    providerKey: publicText(result?.providerKey),
    status,
    warnings: publicWarnings(result?.warnings),
  }
  if (status === 'failed') {
    output.error = publicErrorDetail(result?.error, secrets)
    // The prose above is localized/redacted and meant for a human; the code is
    // what lets the caller tell "the key could not be stored" apart from "the
    // route landed but the catalogue did not", which need opposite responses —
    // retry the whole import, or just repair the catalogue.
    if (SAFE_FAILURE_CODES.has(result?.errorCode)) output.errorCode = result.errorCode
  }
  if (status === 'blocked') {
    output.error = 'profile blocked'
    output.blockedCode = BLOCKED_CODES.has(result?.blockedCode) ? result.blockedCode : BLOCKED.UNKNOWN
    output.blockedDetail = publicText(result?.blockedDetail)
  }
  if (status === 'skipped') output.skipReason = 'profile was not selected or is not importable'
  return output
}

export function writeJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  response.end(JSON.stringify(body))
}

export async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) {
      // Stop reading and tear the connection down: leaving the rest of an
      // oversized body in the socket would desync the next request on it.
      request.destroy?.()
      return undefined
    }
    chunks.push(buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function defaultScan() {
  const sources = discoverSources()
  if (sources.length === 0) {
    return { profiles: [], reason: SCAN_REASON.NOT_INSTALLED, dbPath: defaultSourcePath() }
  }
  return scanSource(sources[0])
}

function normalizeScanResult(scanned) {
  if (Array.isArray(scanned)) return { profiles: scanned, reason: undefined, dbPath: undefined }
  return {
    profiles: Array.isArray(scanned?.profiles) ? scanned.profiles : [],
    reason: scanned?.reason,
    dbPath: scanned?.dbPath,
  }
}

// A state-changing request must prove it came from this app's own page.
// Requiring an `Origin` header alone was wrong: a browser is allowed to omit it
// on same-origin POSTs, and the one that serves this app does — which is why
// "Test connection" answered `missing Origin`. Three independent proofs are
// accepted instead. A cross-site caller can produce none of them: `Origin` is
// compared against `Host` by isLoopbackRequest, `Sec-Fetch-Site` is set by the
// browser and cannot be forged by script, and a custom header forces a CORS
// preflight that this route never answers.
export const SAME_ORIGIN_HEADER = 'x-dsh-ccswitch-origin'
export const SAME_ORIGIN_VALUE = 'same-origin'

export function sameOriginSignals(request) {
  const headers = request.headers ?? {}
  const origin = typeof headers.origin === 'string' ? headers.origin.trim() : ''
  const site = typeof headers['sec-fetch-site'] === 'string' ? headers['sec-fetch-site'].trim().toLowerCase() : ''
  const marker = typeof headers[SAME_ORIGIN_HEADER] === 'string' ? headers[SAME_ORIGIN_HEADER].trim() : ''
  let proof
  if (origin.length > 0) proof = 'origin'
  else if (site === 'same-origin') proof = 'sec-fetch-site'
  else if (marker === SAME_ORIGIN_VALUE) proof = 'marker'
  return { origin, site, marker, proof }
}

/**
 * The shared request fence: loopback-only, one method, and — for anything that
 * changes state — proof the request came from this app's own page. Exported so
 * the manager routes enforce exactly the same rules rather than a second copy
 * that can drift away from this one.
 */
export function methodFence(request, response, isLoopback, method, { requireSameOrigin = false } = {}) {
  if (!isLoopback(request)) {
    writeJson(response, 403, { error: 'forbidden: loopback and same-origin only' })
    return false
  }
  if (request.method !== method) {
    writeJson(response, 405, { error: 'method not allowed' })
    return false
  }
  if (requireSameOrigin) {
    const { origin, site, marker, proof } = sameOriginSignals(request)
    if (proof === undefined) {
      // Report what actually arrived: a bare rejection here is very hard to
      // diagnose from the browser side.
      writeJson(response, 403, {
        error: 'forbidden: state-changing requests must come from the app page',
        saw: { origin: origin.length > 0, site: site.length > 0 ? site : null, marker: marker.length > 0 },
      })
      return false
    }
  }
  return true
}

export function makeRoutes(deps = {}) {
  const scan = deps.scan ?? defaultScan
  const getProviders = deps.getProviders ?? (async () => ({}))
  const importProfiles = deps.importProfiles ?? runImport
  /**
   * This plugin's own catalogue, for classifying a scan against BOTH halves.
   *
   * A profile can be correct in the DSH route and absent from the catalogue —
   * that is exactly the state a pre-manager import left behind — and
   * `classifyProfiles` reports "unchanged" for it unless it is given the
   * catalogue. Without this the preview promises "nothing to do" for the rows
   * the import is about to write.
   */
  const getCatalogue = deps.getCatalogue ?? (async () => undefined)
  const probe = deps.probe ?? probeConnection
  const isLoopback = deps.isLoopback ?? isLoopbackRequest
  const settings = deps.settings
  const credentials = deps.credentials
  return [
    {
      kind: 'exact',
      path: `${API_BASE}/scan`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, 'GET')) return
        try {
          const { profiles, reason, dbPath } = normalizeScanResult(await scan())
          const [route, catalogue] = await Promise.all([getProviders(), getCatalogue()])
          const classified = catalogue === undefined
            ? classifyProfiles(profiles, route)
            // Three arguments, so a profile that is already correct in the
            // route but missing from the catalogue reads as work to do.
            : classifyProfiles(profiles, route, catalogue)
          const body = { profiles: classified.map((item) => publicSummary(item.summary)) }
          if (SAFE_SCAN_REASONS.has(reason)) {
            body.source = reason
            // Only useful when we looked somewhere and found nothing.
            if (reason === SCAN_REASON.NOT_INSTALLED) body.probedPath = publicText(dbPath)
          }
          writeJson(response, 200, body)
        } catch {
          writeJson(response, 500, { error: 'scan failed' })
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_BASE}/import`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, 'POST', { requireSameOrigin: true })) return
        const body = await readJsonBody(request)
        if (!body || !Array.isArray(body.profileIds) || body.profileIds.some((id) => typeof id !== 'string')) {
          writeJson(response, 400, { error: 'body must be { profileIds: string[], expectedRevision?: number, probe?: boolean }' })
          return
        }
        if (body.expectedRevision !== undefined && (typeof body.expectedRevision !== 'number' || !Number.isInteger(body.expectedRevision))) {
          writeJson(response, 400, { error: 'expectedRevision must be an integer' })
          return
        }
        let knownSecrets = []
        try {
          let profiles = normalizeScanResult(await scan()).profiles
          // Opt-in model discovery: only probe profiles the user selected,
          // so a slow/unreachable relay never delays the plain import path.
          if (body.probe === true) {
            const selected = new Set(body.profileIds)
            const probed = await Promise.all(
              profiles
                .filter((profile) => !profile.skipped && !profile.blocked && selected.has(profile.profileId))
                .map((profile) => probeModels(profile)),
            )
            const probedById = new Map(probed.map((entry) => [entry.profile.profileId, entry]))
            profiles = profiles.map((profile) => {
              const entry = probedById.get(profile.profileId)
              return entry ? { ...profile, models: entry.profile.models, warnings: [...(profile.warnings ?? []), ...entry.warnings] } : profile
            })
          }
          const secretByProfileId = new Map()
          for (const profile of profiles) {
            if (typeof profile.apiKey === 'string' && profile.apiKey.length > 0) {
              secretByProfileId.set(profile.profileId, profile.apiKey)
            }
          }
          knownSecrets = [...secretByProfileId.values()]
          const results = await importProfiles({
            profiles,
            selectedIds: body.profileIds,
            settings,
            credentials,
            expectedRevision: body.expectedRevision,
          })
          writeJson(response, 200, { results: results.map((result) => publicResult(result, knownSecretsFor(result, secretByProfileId))) })
        } catch (err) {
          // Never log the raw error object: it can carry request bodies and
          // credentials straight past every redactor in this file.
          const label = err instanceof Error ? err.name : typeof err
          console.error('[dsh-ccswitch-plugin] import failed:', `${label}: ${redactText(err, knownSecrets)}`)
          writeJson(response, 500, { error: 'import failed' })
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_BASE}/probe`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, 'POST', { requireSameOrigin: true })) return
        const body = await readJsonBody(request)
        if (!body || !Array.isArray(body.profileIds) || body.profileIds.some((id) => typeof id !== 'string')) {
          writeJson(response, 400, { error: 'body must be { profileIds: string[] }' })
          return
        }
        // Probe-only: this endpoint never writes settings, it only reports
        // whether the stored endpoint answers and how long it took.
        let knownSecrets = []
        try {
          const profiles = normalizeScanResult(await scan()).profiles
          const selected = new Set(body.profileIds)
          const targets = profiles
            .filter((profile) => !profile.skipped && !profile.blocked && selected.has(profile.profileId))
            .slice(0, MAX_PROBE_TARGETS)
          knownSecrets = targets.map((profile) => profile.apiKey).filter((key) => typeof key === 'string' && key.length > 0)
          const results = await Promise.all(targets.map(async (profile) => {
            const outcome = await probe(profile)
            // The upstream's own error text is the most useful part of a
            // failure ("Invalid token" beats a bare 401), but relays sometimes
            // echo the key, so it goes through the same redaction as `message`.
            const detail = redactText(outcome?.detail, knownSecrets)
            return {
              profileId: publicText(profile.profileId),
              profileName: publicText(profile.profileName),
              ok: outcome?.ok === true,
              reason: PROBE_REASONS.has(outcome?.reason) ? outcome.reason : PROBE_REASON.NETWORK,
              check: PROBE_CHECKS.has(outcome?.check) ? outcome.check : PROBE_CHECK.NONE,
              httpStatus: Number.isInteger(outcome?.httpStatus) ? outcome.httpStatus : undefined,
              detail: detail ? detail.slice(0, 200) : undefined,
              latencyMs: Number.isInteger(outcome?.latencyMs) ? Math.min(Math.max(outcome.latencyMs, 0), 600000) : 0,
              discoveredCount: probeCount(outcome?.discoveredCount),
              addedCount: probeCount(outcome?.addedCount),
              modelCount: probeCount(outcome?.modelCount),
              message: redactText(outcome?.message, knownSecrets) || 'probe returned no detail',
            }
          }))
          writeJson(response, 200, { results })
        } catch (err) {
          const label = err instanceof Error ? err.name : typeof err
          console.error('[dsh-ccswitch-plugin] probe failed:', `${label}: ${redactText(err, knownSecrets)}`)
          writeJson(response, 500, { error: 'probe failed' })
        }
      },
    },
  ]
}

function probeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0
}

function knownSecretsFor(result, secretByProfileId) {
  const own = secretByProfileId.get(result?.profileId)
  return typeof own === 'string' ? [own] : []
}
