// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { parseCodexToml } from './toml.js'
import { BLOCKED } from './safety.js'

const SKIP_OFFICIAL = new Set(['codex-official', 'claude-official', 'claude-desktop-official'])
const SKIP_NAMES = new Set(['default', 'OpenAI Official', 'Claude Official', 'Claude Desktop Official'])
// llm-pi-ai strict validation rejects a provider whose models list resolves
// empty; claude-desktop rows rarely carry ANTHROPIC_MODEL, so fall back to a
// widely-supported id the user can change in DSH afterwards.
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5'
const DEFAULT_CODEX_MODEL = 'gpt-5.1-codex'
const DEFAULT_OPENCODE_MODEL = 'gpt-4o'

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
  if (appType === 'claude' || appType === 'claude-desktop') return extractClaude(base, parsed)
  if (appType === 'opencode') return extractOpencode(base, parsed)
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
 * claude / claude-desktop rows: env.ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN
 * (or ANTHROPIC_API_KEY). Maps to the anthropic-messages protocol.
 */
function extractClaude(base, parsed) {
  const { profileName } = base
  const env = (parsed && typeof parsed === 'object' ? parsed.env : undefined) ?? {}
  const apiKey = [env.ANTHROPIC_AUTH_TOKEN, env.ANTHROPIC_API_KEY]
    .find((value) => typeof value === 'string' && value.length > 0)
  if (apiKey === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 API key（env.ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY 缺失）', blockedCode: BLOCKED.MISSING_ANTHROPIC_KEY }
  }

  const baseURL = typeof env.ANTHROPIC_BASE_URL === 'string' && env.ANTHROPIC_BASE_URL.length > 0
    ? env.ANTHROPIC_BASE_URL
    : undefined
  if (baseURL === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 base URL（env.ANTHROPIC_BASE_URL 缺失）', blockedCode: BLOCKED.MISSING_ANTHROPIC_BASE_URL }
  }

  const warnings = []
  let model = typeof env.ANTHROPIC_MODEL === 'string' && env.ANTHROPIC_MODEL.length > 0
    ? env.ANTHROPIC_MODEL
    : DEFAULT_CLAUDE_MODEL
  if (!env.ANTHROPIC_MODEL) {
    warnings.push(`claude 配置中没有模型字段，已回退为 ${DEFAULT_CLAUDE_MODEL}，导入后可在 DSH 中修改`)
    // The display name often names the real model ("… Claude Opus 5 Thinking").
    // When it hints at a thinking model, mark the entry so the mapper enables
    // forceAdaptiveThinking even though the fallback id hides the suffix.
    if (/thinking/i.test(profileName)) {
      model = { id: DEFAULT_CLAUDE_MODEL, fallbackThinking: true }
    }
  }

  return {
    ...base,
    apiKey,
    baseURL,
    api: 'anthropic-messages',
    models: [model],
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
  const apiKey = typeof options.apiKey === 'string' && options.apiKey.length > 0
    ? options.apiKey
    : undefined
  if (apiKey === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 API key（options.apiKey 缺失）', blockedCode: BLOCKED.MISSING_OPENCODE_KEY }
  }
  const baseURL = typeof options.baseURL === 'string' && options.baseURL.length > 0
    ? options.baseURL
    : undefined
  if (baseURL === undefined) {
    return { ...base, blocked: true, blockedReason: '未找到 base URL（options.baseURL 缺失）', blockedCode: BLOCKED.MISSING_OPENCODE_BASE_URL }
  }
  const npm = typeof parsed.npm === 'string' ? parsed.npm : ''
  if (npm !== '@ai-sdk/openai-compatible') {
    return { ...base, blocked: true, blockedReason: `暂不支持的 opencode 适配器：${npm || '未知'}（仅 @ai-sdk/openai-compatible）`, blockedCode: BLOCKED.UNSUPPORTED_OPENCODE_ADAPTER, blockedDetail: npm || 'unknown' }
  }

  const warnings = []
  const rawModels = (parsed && typeof parsed === 'object' ? parsed.models : undefined) ?? {}
  const models = Object.entries(rawModels)
    .filter(([id]) => typeof id === 'string' && id.length > 0)
    .map(([id, meta]) => {
      const name = meta && typeof meta === 'object' && typeof meta.name === 'string' ? meta.name : undefined
      return name ? { id, name } : { id }
    })
  if (models.length === 0) {
    models.push({ id: DEFAULT_OPENCODE_MODEL })
    warnings.push(`opencode 配置中没有模型列表，已回退为 ${DEFAULT_OPENCODE_MODEL}，导入后可在 DSH 中修改`)
  }

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
