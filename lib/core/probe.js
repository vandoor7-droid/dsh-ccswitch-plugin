// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { isKnownModel } from '../../src/domain/model-catalog.mjs'

const PROBE_TIMEOUT_MS = 8000
const MAX_PROBED_MODELS = 100
const MAX_DETAIL_LENGTH = 200
// Statuses that do not prove the key is wrong: many relays simply do not
// expose `/models`, and answer 401/403/404/405 for it.
const MODELS_FALLBACK_STATUSES = new Set([401, 403, 404, 405, 501])
const MINIMAL_PROMPT = 'ping'

/** Machine-readable probe outcomes; the UI maps these to localized text. */
export const PROBE_REASON = {
  OK: 'ok',
  EMPTY: 'empty',
  HTTP_ERROR: 'http-error',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  NO_CREDENTIALS: 'no-credentials',
  UNKNOWN: 'network',
}

export const PROBE_REASONS = new Set(Object.values(PROBE_REASON))

/** Which request proved the connection. */
export const PROBE_CHECK = {
  MODELS: 'models',
  MINIMAL: 'minimal',
  NONE: 'none',
}

export const PROBE_CHECKS = new Set(Object.values(PROBE_CHECK))

function joinUrl(baseURL, path) {
  return `${String(baseURL).replace(/\/+$/, '')}${path}`
}

function headersFor(profile) {
  const headers = { accept: 'application/json' }
  // OpenAI-style bearer first; anthropic relays usually accept it too.
  headers.authorization = `Bearer ${profile.apiKey}`
  if (profile.api === 'anthropic-messages') {
    // Anthropic-native upstreams list models at /v1/models with x-api-key;
    // relays vary, so keep the same OpenAI-style attempt but expect failures.
    headers['x-api-key'] = profile.apiKey
    headers['anthropic-version'] = '2023-06-01'
  }
  return headers
}

/** First known model id of the source record, used for the minimal request. */
function firstModelId(profile) {
  const models = Array.isArray(profile?.models) ? profile.models : []
  for (const model of models) {
    const id = typeof model === 'string' ? model : model?.id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return undefined
}

/**
 * A single 1-token request against the endpoint the profile would really use.
 * Only sent when `/models` could not answer, so the free check stays free.
 */
function minimalRequestFor(profile, modelId) {
  const headers = { ...headersFor(profile), 'content-type': 'application/json' }
  if (profile.api === 'anthropic-messages') {
    return {
      url: joinUrl(profile.baseURL, '/messages'),
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelId,
          max_tokens: 1,
          messages: [{ role: 'user', content: MINIMAL_PROMPT }],
        }),
      },
    }
  }
  if (profile.api === 'openai-responses') {
    return {
      url: joinUrl(profile.baseURL, '/responses'),
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: modelId, input: MINIMAL_PROMPT, max_output_tokens: 1 }),
      },
    }
  }
  return {
    url: joinUrl(profile.baseURL, '/chat/completions'),
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: MINIMAL_PROMPT }],
        max_tokens: 1,
      }),
    },
  }
}

/**
 * Reach `{baseURL}/models` once and report what happened, without touching any
 * setting. Callers decide whether to merge the discovered ids (import path) or
 * only to show the outcome (the "test connection" button).
 * @param {object} profile scanned profile (needs `baseURL`; `apiKey` to authenticate)
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch, allowMinimalRequest?: boolean }} [options]
 * @returns {Promise<{
 *   ok: boolean, reason: string, check: string, httpStatus: number|undefined,
 *   detail: string|undefined, latencyMs: number, modelIds: string[],
 *   discoveredCount: number, addedCount: number, modelCount: number, message: string,
 * }>} `ok` means the connection was proven; `check` says by which request;
 *   `detail` is the upstream's own error text (unredacted — the route redacts);
 *   `message` is a Chinese fallback string, identical to the warnings
 *   `probeModels` has always produced.
 */
export async function probeConnection(profile, options = {}) {
  const startedAt = Date.now()
  const existing = new Set(
    (profile?.models ?? [])
      .map((model) => (typeof model === 'string' ? model : model?.id))
      .filter((id) => typeof id === 'string' && id.length > 0),
  )
  const base = {
    ok: false,
    reason: PROBE_REASON.NO_CREDENTIALS,
    check: PROBE_CHECK.NONE,
    httpStatus: undefined,
    detail: undefined,
    latencyMs: 0,
    modelIds: [],
    discoveredCount: 0,
    addedCount: 0,
    modelCount: existing.size,
    message: '缺少 API key 或 base URL，无法测试连接',
  }
  if (profile?.apiKey === undefined || !profile?.baseURL) return base

  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : PROBE_TIMEOUT_MS
  const allowMinimal = options.allowMinimalRequest !== false
  const doFetch = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let listing
    try {
      listing = await doFetch(joinUrl(profile.baseURL, '/models'), {
        headers: headersFor(profile),
        signal: controller.signal,
      })
    } catch (err) {
      // Unreachable upstream: a second request would only wait again.
      const reason = err?.name === 'AbortError' ? PROBE_REASON.TIMEOUT : PROBE_REASON.NETWORK
      return {
        ...base,
        reason,
        latencyMs: Date.now() - startedAt,
        message: `模型探测${reason === PROBE_REASON.TIMEOUT ? '超时' : '网络错误'}，保留源配置的模型列表`,
      }
    }
    if (listing.ok) {
      const latencyMs = Date.now() - startedAt
      const payload = await listing.json()
      const ids = extractModelIds(payload)
      if (ids.length === 0) {
        return {
          ...base,
          ok: true,
          reason: PROBE_REASON.EMPTY,
          check: PROBE_CHECK.MODELS,
          httpStatus: listing.status,
          latencyMs,
          message: '模型探测返回空列表，保留源配置的模型列表',
        }
      }
      const merged = mergeModels(profile.models, ids)
      return {
        ok: true,
        reason: PROBE_REASON.OK,
        check: PROBE_CHECK.MODELS,
        httpStatus: listing.status,
        detail: undefined,
        latencyMs,
        modelIds: ids,
        discoveredCount: ids.length,
        addedCount: merged.length - (profile.models?.length ?? 0),
        modelCount: merged.length,
        message: `模型探测成功：新增 ${merged.length - (profile.models?.length ?? 0)} 个模型（共 ${merged.length} 个）`,
      }
    }

    const httpStatus = listing.status
    const detail = await readErrorDetail(listing)
    const failed = {
      ...base,
      reason: PROBE_REASON.HTTP_ERROR,
      httpStatus,
      detail,
      latencyMs: Date.now() - startedAt,
      message: `模型探测失败（HTTP ${httpStatus}），保留源配置的模型列表`,
    }
    const modelId = firstModelId(profile)
    if (!allowMinimal || !MODELS_FALLBACK_STATUSES.has(httpStatus) || modelId === undefined) {
      return failed
    }
    // `/models` is not conclusive here — ask the real endpoint with 1 token.
    try {
      const { url, init } = minimalRequestFor(profile, modelId)
      const minimal = await doFetch(url, { ...init, signal: controller.signal })
      const latencyMs = Date.now() - startedAt
      if (minimal.ok) {
        return {
          ...base,
          ok: true,
          reason: PROBE_REASON.OK,
          check: PROBE_CHECK.MINIMAL,
          httpStatus: minimal.status,
          detail,
          latencyMs,
          message: `模型列表不可用（HTTP ${httpStatus}），最小请求验证连通`,
        }
      }
      return {
        ...failed,
        httpStatus: minimal.status,
        detail: (await readErrorDetail(minimal)) ?? detail,
        latencyMs,
        message: `模型探测失败（HTTP ${minimal.status}），保留源配置的模型列表`,
      }
    } catch {
      // Best effort: keep the more specific `/models` verdict.
      return { ...failed, latencyMs: Date.now() - startedAt }
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Probe `{baseURL}/models` and merge discovered ids into the profile.
 * Only used when the user opts in (probe: true); network failures degrade to
 * a warning, never block the import. The minimal-request fallback stays off:
 * it can prove a connection but cannot widen the model list.
 * @returns {Promise<{ profile, warnings }>} same profile (models possibly
 *   widened, `name` filled for known-but-unnamed ids) plus probe warnings.
 */
export async function probeModels(profile, options = {}) {
  const outcome = await probeConnection(profile, { ...options, allowMinimalRequest: false })
  // A profile with nothing to authenticate with stays silent, as before.
  if (outcome.reason === PROBE_REASON.NO_CREDENTIALS) return { profile, warnings: [] }
  if (!outcome.ok || outcome.reason === PROBE_REASON.EMPTY) {
    return { profile, warnings: [outcome.message] }
  }
  const merged = mergeModels(profile.models, outcome.modelIds)
  return {
    profile: { ...profile, models: merged.slice(0, MAX_PROBED_MODELS) },
    warnings: [outcome.message],
  }
}

/** Read an error body, never throwing, and reduce it to one short line. */
async function readErrorDetail(response) {
  if (typeof response?.text !== 'function') return undefined
  try {
    return extractDetail(await response.text())
  } catch {
    return undefined
  }
}

/** Pull a human-readable provider message out of a JSON or plain-text body. */
function extractDetail(text) {
  const raw = String(text ?? '').trim()
  if (raw.length === 0) return undefined
  let candidate
  try {
    candidate = firstMessage(JSON.parse(raw))
  } catch {
    // Relays prefix JSON with banners (`<upstream>{...}`), so retry from the
    // first brace, then fall back to the quoted `"message"` value.
    candidate = firstMessage(jsonSlice(raw)) ?? quotedMessage(raw)
  }
  const flat = String(candidate ?? raw).replace(/\s+/g, ' ').trim()
  return flat.length > 0 ? flat.slice(0, MAX_DETAIL_LENGTH) : undefined
}

function jsonSlice(raw) {
  const start = raw.search(/[[{]/)
  if (start < 0) return undefined
  try {
    return JSON.parse(raw.slice(start))
  } catch {
    return undefined
  }
}

function quotedMessage(raw) {
  const match = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (!match) return undefined
  return match[1].replace(/\\(.)/g, (_, char) =>
    char === 'n' || char === 'r' || char === 't' ? ' ' : char,
  )
}

function firstMessage(payload) {
  if (typeof payload === 'string') return payload
  if (payload === null || typeof payload !== 'object') return undefined
  const error = payload.error
  if (typeof error === 'string') return error
  if (error !== null && typeof error === 'object') {
    for (const key of ['message', 'msg', 'detail', 'code']) {
      if (typeof error[key] === 'string' && error[key].length > 0) return error[key]
    }
  }
  for (const key of ['message', 'msg', 'detail', 'error']) {
    if (typeof payload[key] === 'string' && payload[key].length > 0) return payload[key]
  }
  return undefined
}

/** Widen `models` with upstream ids, naming ids the catalog already knows. */
function mergeModels(models, ids) {
  const merged = [...(models ?? [])]
  const seen = new Set(merged.map((model) => model.id))
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(isKnownModel(id) ? { id, name: displayNameFor(id) } : { id })
  }
  return merged
}

/** Accept OpenAI `{data:[{id}]}` and bare `[{id}]` / `{models:[...]}` shapes. */
function extractModelIds(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : []
  return list
    .map((entry) => (typeof entry === 'string' ? entry : entry?.id))
    .filter((id) => typeof id === 'string' && id.length > 0)
    .slice(0, MAX_PROBED_MODELS)
}

/** `claude-sonnet-4-5` → `Claude Sonnet 4.5`-style display names for known ids. */
function displayNameFor(modelId) {
  return modelId
    .split(/[-_]/)
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}
