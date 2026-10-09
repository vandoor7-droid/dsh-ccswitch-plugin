// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { parseCodexToml } from './toml.js'
import { BLOCKED } from './safety.js'

const SKIP_OFFICIAL = new Set([
  'codex-official',
  'claude-official',
  'claude-desktop-official',
  'gemini-official',
  'grok-official',
])
const SKIP_NAMES = new Set([
  'default',
  'OpenAI Official',
  'Claude Official',
  'Claude Desktop Official',
  'Google Official',
  'Grok Official',
])

/**
 * The only three protocols @deepseek-ai/dsh-llm-pi-ai can drive. Any other
 * value produces a provider that registers but can never answer, so a row
 * carrying an unknown protocol is blocked rather than imported broken.
 */
const DSH_PROTOCOLS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages'])

// llm-pi-ai strict validation rejects a provider whose models list resolves
// empty, so every extractor has to fall back to a widely-supported id the user
// can change in DSH afterwards. claude-desktop rows rarely carry
// ANTHROPIC_MODEL, and the newer 4.0.4 app types often ship without a model at
// all, hence one default per family.
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5'
const DEFAULT_CODEX_MODEL = 'gpt-5.1-codex'
const DEFAULT_OPENCODE_MODEL = 'gpt-4o'
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro'
const DEFAULT_HERMES_MODEL = 'gpt-4o'
const DEFAULT_PI_MODEL = 'gpt-4o'
const DEFAULT_MCODE_MODEL = 'gpt-4o'
const DEFAULT_OPENCLAW_MODEL = 'gpt-4o'

/** Non-empty string or undefined; the shape every extractor wants. */
function asText(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** cc-switch's `api_mode` values → the three llm-pi-ai protocols. */
const HERMES_API_MODES = {
  chat_completions: 'openai-completions',
  codex_responses: 'openai-responses',
  anthropic_messages: 'anthropic-messages',
  openai_messages: 'openai-completions',
}

function protocolsLabel() {
  return [...DSH_PROTOCOLS].join(' / ')
}

/**
 * Rows whose model list resolves empty are invalid for llm-pi-ai, so fall back
 * to the family default rather than importing a provider with no models.
 */
function withModelFallback(models, fallback, label, warnings) {
  if (models.length > 0) return models
  warnings.push(`${label} 配置中没有模型列表，已回退为 ${fallback}，导入后可在 DSH 中修改`)
  return [{ id: fallback }]
}

/** Array-shaped model lists (hermes / pi / openclaw): keep id, name, context. */
function modelsFromArray(list, { withContextLength = false } = {}) {
  if (!Array.isArray(list)) return []
  const models = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const id = asText(entry.id)
    if (id === undefined) continue
    const model = { id }
    const name = asText(entry.name)
    if (name !== undefined) model.name = name
    // hermes spells it `context_length` on the wire; llm-pi-ai's model profile
    // reads `contextWindow`. Leaving the source spelling in place would put an
    // unknown key on the stored model, which the schema does not carry.
    if (withContextLength) {
      const context = entry.context_length
      if (Number.isFinite(context) && context >= 1) model.contextWindow = Math.trunc(context)
    }
    models.push(model)
  }
  return models
}

/** Object-map model lists (mcode, like opencode): `{ id: { name } }`. */
function modelsFromMap(rawModels) {
  if (!rawModels || typeof rawModels !== 'object' || Array.isArray(rawModels)) return []
  return Object.entries(rawModels)
    .filter(([id]) => asText(id) !== undefined)
    .map(([id, meta]) => {
      const name = meta && typeof meta === 'object' ? asText(meta.name) : undefined
      return name ? { id, name } : { id }
    })
}

/**
 * Extract one CC Switch providers row into a Host-only profile.
 * Never serialize or return this object to the browser.
 */
export function extractProfile(row) {
  const profileId = String(row.id ?? '')
  const profileName = String(row.name ?? '')
  const appType = String(row.app_type ?? 'codex')

  if (SKIP_OFFICIAL.has(profileId)) {
    return { profileId, profileName, appType, skipped: true, skipReason: '官方登录态（official）不支持导入' }
  }
  if (SKIP_NAMES.has(profileName)) {
    return { profileId, profileName, appType, skipped: true, skipReason: '官方/默认 provider 不支持导入' }
  }

  const base = {
    profileId,
    profileName,
    appType,
    isCurrent: Boolean(row.is_current),
    blocked: false,
    blockedReason: '',
    blockedCode: undefined,
    blockedDetail: undefined,
    warnings: [],
    unsupported: [],
    apiKey: undefined,
    baseURL: '',
    api: undefined,
    models: [],
    modelReasoningEffort: undefined,
  }

  let parsed
  try {
    parsed = JSON.parse(String(row.settings_config ?? '{}'))
  } catch {
    return { ...base, blocked: true, blockedReason: 'settings_config 不是合法 JSON', blockedCode: BLOCKED.INVALID_SETTINGS_JSON }
  }

  if (appType === 'codex') return extractCodex(base, parsed)
  // grokbuild ships byte-for-byte the codex carrier (auth.OPENAI_API_KEY plus a
  // TOML config whose [model_providers.custom] carries wire_api = "responses"),
  // so it goes through the same extractor rather than a copy of it.
  if (appType === 'grokbuild') return extractCodex(base, parsed)
  if (appType === 'claude') return extractClaude(base, parsed)
  if (appType === 'claude-desktop') return extractClaudeDesktop(base, parsed)
  if (appType === 'opencode') return extractOpencode(base, parsed)
  if (appType === 'gemini') return extractGemini(base, parsed)
  if (appType === 'hermes') return extractHermes(base, parsed)
  if (appType === 'pi') return extractPi(base, parsed)
  if (appType === 'mcode') return extractMcode(base, parsed)
  if (appType === 'openclaw') return extractOpenclaw(base, parsed)
  return { ...base, blocked: true, blockedReason: `不支持的 app_type：${appType}`, blockedCode: BLOCKED.UNSUPPORTED_APP_TYPE, blockedDetail: appType }
}

/** codex rows: auth.OPENAI_API_KEY + TOML config. */
function extractCodex(base, parsed) {
  const auth = (parsed && typeof parsed === 'object' ? parsed.auth : undefined) ?? {}
  const apiKey = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0
    ? auth.OPENAI_API_KEY
    : undefined
  if (apiKey === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 API key（auth.OPENAI_API_KEY 缺失）', blockedCode: BLOCKED.MISSING_OPENAI_KEY }
  }

  const configText = typeof parsed.config === 'string' ? parsed.config : ''
  const toml = parseCodexToml(configText)
  const reasoningEffort = toml.reasoningEffort
  const provider = toml.provider
  let model = toml.model

  if (!provider || typeof provider.baseUrl !== 'string' || provider.baseUrl === '') {
    return { ...base, blocked: true, blockedReason: 'config 中缺少可用的 [model_providers.custom] 段', blockedCode: BLOCKED.MISSING_CODEX_PROVIDER }
  }

  const warnings = []
  if (provider.requiresOpenaiAuth === true) {
    warnings.push('provider 标记 requires_openai_auth，导入后可能仍无法通过 API key 认证')
  }
  if (provider.wireApi !== undefined && provider.wireApi !== 'responses' && provider.wireApi !== 'chat') {
    warnings.push(`未知 wire_api "${provider.wireApi}"，按 openai-completions 处理`)
  }
  if (!model) {
    model = DEFAULT_CODEX_MODEL
    warnings.push(`config 中没有 model 字段，已回退为 ${DEFAULT_CODEX_MODEL}，导入后可在 DSH 中修改`)
  }

  const api = provider.wireApi === 'responses' ? 'openai-responses' : 'openai-completions'

  return {
    ...base,
    apiKey,
    baseURL: provider.baseUrl,
    api,
    models: [{ id: model }],
    modelReasoningEffort: reasoningEffort,
    warnings,
    unsupported: [],
  }
}

/**
 * Resolve the model for a claude-shaped row, shared by `claude` and
 * `claude-desktop`. A row that carries no ANTHROPIC_MODEL gets the default id
 * plus a warning; when the display name hints at a thinking model the entry is
 * still marked so the mapper enables forceAdaptiveThinking even though the
 * fallback id hides the suffix.
 */
function claudeModels(env, profileName, warnings) {
  if (asText(env?.ANTHROPIC_MODEL) !== undefined) return [env.ANTHROPIC_MODEL]
  warnings.push(`claude 配置中没有模型字段，已回退为 ${DEFAULT_CLAUDE_MODEL}，导入后可在 DSH 中修改`)
  if (/thinking/i.test(profileName)) return [{ id: DEFAULT_CLAUDE_MODEL, fallbackThinking: true }]
  return [DEFAULT_CLAUDE_MODEL]
}

/**
 * claude rows: env.ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN (or
 * ANTHROPIC_API_KEY). Maps to the anthropic-messages protocol.
 */
function extractClaude(base, parsed) {
  const { profileName } = base
  const env = (parsed && typeof parsed === 'object' ? parsed.env : undefined) ?? {}
  const apiKey = [env.ANTHROPIC_AUTH_TOKEN, env.ANTHROPIC_API_KEY]
    .find((value) => typeof value === 'string' && value.length > 0)
  if (apiKey === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 API key（env.ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY 缺失）', blockedCode: BLOCKED.MISSING_ANTHROPIC_KEY }
  }

  const baseURL = asText(env.ANTHROPIC_BASE_URL)
  if (baseURL === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 base URL（env.ANTHROPIC_BASE_URL 缺失）', blockedCode: BLOCKED.MISSING_ANTHROPIC_BASE_URL }
  }

  const warnings = []
  return {
    ...base,
    apiKey,
    baseURL,
    api: 'anthropic-messages',
    models: claudeModels(env, profileName, warnings),
    modelReasoningEffort: undefined,
    warnings,
    unsupported: [],
  }
}

/**
 * claude-desktop rows. cc-switch's own preset keeps the endpoint in a
 * top-level `baseUrl` — "baseUrl 是顶级字段，而不是
 * settingsConfig.env.ANTHROPIC_BASE_URL" — and names which env key holds the
 * credential via `apiKeyField`. Older rows still use the nested env shape, so
 * both are accepted rather than guessing which generation wrote the row.
 */
function extractClaudeDesktop(base, parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {}
  const env = source.env && typeof source.env === 'object' ? source.env : {}

  // The preset names the field holding the key; only the two Anthropic names
  // are meaningful, so anything else falls through to the defensive lookup.
  const namedField = source.apiKeyField === 'ANTHROPIC_AUTH_TOKEN' || source.apiKeyField === 'ANTHROPIC_API_KEY'
    ? source.apiKeyField
    : undefined
  const apiKey = [
    namedField === undefined ? undefined : env[namedField],
    env.ANTHROPIC_AUTH_TOKEN,
    env.ANTHROPIC_API_KEY,
  ].find((value) => typeof value === 'string' && value.length > 0)
  if (apiKey === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 API key（baseUrl 配置中缺少 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY）', blockedCode: BLOCKED.MISSING_CLAUDE_DESKTOP_KEY }
  }

  const baseURL = asText(source.baseUrl) ?? asText(env.ANTHROPIC_BASE_URL)
  if (baseURL === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 base URL（缺少顶级 baseUrl 与 env.ANTHROPIC_BASE_URL）', blockedCode: BLOCKED.MISSING_CLAUDE_DESKTOP_BASE_URL }
  }

  const warnings = []
  return {
    ...base,
    apiKey,
    baseURL,
    api: 'anthropic-messages',
    models: claudeModels(env, base.profileName, warnings),
    modelReasoningEffort: undefined,
    warnings,
    unsupported: [],
  }
}

/**
 * opencode rows: ai-sdk shape
 * `{ npm, options: { baseURL, apiKey }, models: { id: { name, ... } } }`.
 * Only the openai-compatible npm adapter maps cleanly; others are blocked
 * with a clear reason instead of a broken provider.
 */
function extractOpencode(base, parsed) {
  const options = (parsed && typeof parsed === 'object' ? parsed.options : undefined) ?? {}
  const apiKey = asText(options.apiKey)
  if (apiKey === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 API key（options.apiKey 缺失）', blockedCode: BLOCKED.MISSING_OPENCODE_KEY }
  }
  const baseURL = asText(options.baseURL)
  if (baseURL === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 base URL（options.baseURL 缺失）', blockedCode: BLOCKED.MISSING_OPENCODE_BASE_URL }
  }
  const npm = typeof parsed.npm === 'string' ? parsed.npm : ''
  if (npm !== '@ai-sdk/openai-compatible') {
    return { ...base, blocked: true, blockedReason: `暂不支持的 opencode 适配器：${npm || '未知'}（仅 @ai-sdk/openai-compatible）`, blockedCode: BLOCKED.UNSUPPORTED_OPENCODE_ADAPTER, blockedDetail: npm || 'unknown' }
  }

  const warnings = []
  const models = withModelFallback(
    modelsFromMap(parsed && typeof parsed === 'object' ? parsed.models : undefined),
    DEFAULT_OPENCODE_MODEL,
    'opencode',
    warnings,
  )

  return {
    ...base,
    apiKey,
    baseURL,
    api: 'openai-completions',
    models,
    modelReasoningEffort: undefined,
    warnings,
    unsupported: [],
  }
}

/**
 * gemini rows: `{ env: { GEMINI_API_KEY, GOOGLE_GEMINI_BASE_URL, GEMINI_MODEL } }`,
 * which cc-switch writes to ~/.gemini/.env for the Gemini CLI.
 *
 * Always blocked. The fields are read anyway so the blocked row can name the
 * endpoint it would have pointed at, but no protocol mapping exists that would
 * make this import work.
 */
function extractGemini(base, parsed) {
  const env = (parsed && typeof parsed === 'object' ? parsed.env : undefined) ?? {}
  const apiKey = [env.GEMINI_API_KEY, env.GOOGLE_API_KEY]
    .find((value) => typeof value === 'string' && value.length > 0)
  const baseURL = asText(env.GOOGLE_GEMINI_BASE_URL)
  const warnings = []
  const models = withModelFallback(
    asText(env.GEMINI_MODEL) === undefined ? [] : [{ id: env.GEMINI_MODEL }],
    DEFAULT_GEMINI_MODEL,
    'gemini',
    warnings,
  )

  let host = ''
  if (baseURL !== undefined) {
    try {
      host = new URL(baseURL).host
    } catch {
      host = ''
    }
  }

  return {
    ...base,
    apiKey,
    baseURL: baseURL ?? '',
    api: undefined,
    models,
    modelReasoningEffort: undefined,
    warnings,
    unsupported: [],
    blocked: true,
    blockedReason: 'Gemini CLI 使用 Gemini 原生协议，DSH 的 llm-pi-ai 没有对应适配器，导入后会得到一个无法应答的 provider。请改用 OpenAI 兼容的 Gemini 中转（Base URL + API Key）并把它填成 openai-completions。',
    blockedCode: BLOCKED.UNSUPPORTED_GEMINI_PROTOCOL,
    blockedDetail: host,
  }
}

/**
 * hermes rows: `{ base_url, api_key, api_mode, models: [{ id, name, context_length }] }`,
 * written to ~/.hermes/config.yaml. `api_mode` names the protocol directly.
 */
function extractHermes(base, parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {}
  const apiKey = asText(source.api_key)
  if (apiKey === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 API key（api_key 缺失）', blockedCode: BLOCKED.MISSING_HERMES_KEY }
  }
  const baseURL = asText(source.base_url)
  if (baseURL === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 base URL（base_url 缺失）', blockedCode: BLOCKED.MISSING_HERMES_BASE_URL }
  }

  const warnings = []
  const apiMode = asText(source.api_mode)
  let api = HERMES_API_MODES[apiMode]
  if (api === undefined) {
    // Mirrors extractCodex's unknown-wire_api handling: warn and take the
    // protocol that most OpenAI-compatible relays actually speak.
    warnings.push(`未知 api_mode "${apiMode ?? '缺失'}"，按 openai-completions 处理`)
    api = 'openai-completions'
  }

  return {
    ...base,
    apiKey,
    baseURL,
    api,
    models: withModelFallback(modelsFromArray(source.models, { withContextLength: true }), DEFAULT_HERMES_MODEL, 'hermes', warnings),
    modelReasoningEffort: undefined,
    warnings,
    unsupported: [],
  }
}

/**
 * pi rows: `{ baseUrl, api, apiKey, models: [{ id, name }] }`, written to
 * ~/.pi/agent/models.json. Note the camelCase keys, unlike hermes. `api`
 * already holds a DSH protocol, so it is passed through once validated.
 */
function extractPi(base, parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {}
  const apiKey = asText(source.apiKey)
  if (apiKey === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 API key（apiKey 缺失）', blockedCode: BLOCKED.MISSING_PI_KEY }
  }
  const baseURL = asText(source.baseUrl)
  if (baseURL === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 base URL（baseUrl 缺失）', blockedCode: BLOCKED.MISSING_PI_BASE_URL }
  }
  const api = asText(source.api)
  if (api === undefined || !DSH_PROTOCOLS.has(api)) {
    return {
      ...base,
      blocked: true,
      blockedReason: `pi 的 api "${api ?? '缺失'}" 不是 DSH 支持的协议（仅 ${protocolsLabel()}）`,
      blockedCode: BLOCKED.UNSUPPORTED_PI_API,
      blockedDetail: api ?? 'unknown',
    }
  }

  const warnings = []
  return {
    ...base,
    apiKey,
    baseURL,
    api,
    models: withModelFallback(modelsFromArray(source.models), DEFAULT_PI_MODEL, 'pi', warnings),
    modelReasoningEffort: undefined,
    warnings,
    unsupported: [],
  }
}

/**
 * mcode rows: `{ kind: "custom", api, options: { baseURL, apiKey }, models: { id: { name } } }`,
 * written to ~/.minimax/config.yaml. Same carrier as opencode, but the protocol
 * sits at the top level and there is no npm adapter field to vet.
 */
function extractMcode(base, parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {}
  const options = source.options && typeof source.options === 'object' ? source.options : {}
  const apiKey = asText(options.apiKey)
  if (apiKey === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 API key（options.apiKey 缺失）', blockedCode: BLOCKED.MISSING_MCODE_KEY }
  }
  const baseURL = asText(options.baseURL)
  if (baseURL === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 base URL（options.baseURL 缺失）', blockedCode: BLOCKED.MISSING_MCODE_BASE_URL }
  }
  const api = asText(source.api)
  if (api === undefined || !DSH_PROTOCOLS.has(api)) {
    return {
      ...base,
      blocked: true,
      blockedReason: `mcode 的 api "${api ?? '缺失'}" 不是 DSH 支持的协议（仅 ${protocolsLabel()}）`,
      blockedCode: BLOCKED.UNSUPPORTED_MCODE_API,
      blockedDetail: api ?? 'unknown',
    }
  }

  const warnings = []
  return {
    ...base,
    apiKey,
    baseURL,
    api,
    models: withModelFallback(modelsFromMap(source.models), DEFAULT_MCODE_MODEL, 'mcode', warnings),
    modelReasoningEffort: undefined,
    warnings,
    unsupported: [],
  }
}

/**
 * openclaw rows: `{ baseUrl, apiKey, api, models: [{ id, name }] }`, folded into
 * OpenClaw's own `models.providers` structure. Like pi, without the `name`
 * wrapper and with an array-shaped model list.
 */
function extractOpenclaw(base, parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {}
  const apiKey = asText(source.apiKey)
  if (apiKey === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 API key（apiKey 缺失）', blockedCode: BLOCKED.MISSING_OPENCLAW_KEY }
  }
  const baseURL = asText(source.baseUrl)
  if (baseURL === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 base URL（baseUrl 缺失）', blockedCode: BLOCKED.MISSING_OPENCLAW_BASE_URL }
  }
  const api = asText(source.api)
  if (api === undefined || !DSH_PROTOCOLS.has(api)) {
    return {
      ...base,
      blocked: true,
      blockedReason: `openclaw 的 api "${api ?? '缺失'}" 不是 DSH 支持的协议（仅 ${protocolsLabel()}）`,
      blockedCode: BLOCKED.UNSUPPORTED_OPENCLAW_API,
      blockedDetail: api ?? 'unknown',
    }
  }

  const warnings = []
  return {
    ...base,
    apiKey,
    baseURL,
    api,
    models: withModelFallback(modelsFromArray(source.models), DEFAULT_OPENCLAW_MODEL, 'openclaw', warnings),
    modelReasoningEffort: undefined,
    warnings,
    unsupported: [],
  }
}
