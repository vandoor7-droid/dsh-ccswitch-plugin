// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * Static model catalog: infers per-model fields (contextWindow, input
 * modalities, thinking flag) from model id patterns when the CC Switch
 * source row carries none. Values are conservative defaults the user can
 * override in DSH after import.
 */

const K = 1024

/** id → { contextWindow, maxTokens?, input? } for models we know precisely. */
const EXACT_CATALOG = Object.freeze({
  'gpt-5.1-codex': { contextWindow: 400 * K, maxTokens: 128 * K, input: ['text', 'image'] },
  'gpt-5.1-codex-mini': { contextWindow: 400 * K, maxTokens: 128 * K, input: ['text', 'image'] },
  'gpt-5.1': { contextWindow: 400 * K, maxTokens: 128 * K, input: ['text', 'image'] },
  'gpt-5': { contextWindow: 400 * K, maxTokens: 128 * K, input: ['text', 'image'] },
  'gpt-4.1': { contextWindow: 1024 * K, maxTokens: 32 * K, input: ['text', 'image'] },
  'gpt-4.1-mini': { contextWindow: 1024 * K, maxTokens: 32 * K, input: ['text', 'image'] },
  'gpt-4o': { contextWindow: 128 * K, maxTokens: 16 * K, input: ['text', 'image'] },
  'gpt-4o-mini': { contextWindow: 128 * K, maxTokens: 16 * K, input: ['text', 'image'] },
  'o1': { contextWindow: 200 * K, maxTokens: 100 * K, input: ['text', 'image'] },
  'o3': { contextWindow: 200 * K, maxTokens: 100 * K, input: ['text', 'image'] },
  'o4-mini': { contextWindow: 200 * K, maxTokens: 100 * K, input: ['text', 'image'] },
  'deepseek-v4.1-flash': { contextWindow: 160 * K, maxTokens: 64 * K, input: ['text'] },
  'deepseek-chat': { contextWindow: 128 * K, maxTokens: 8 * K, input: ['text'] },
  'deepseek-reasoner': { contextWindow: 128 * K, maxTokens: 64 * K, input: ['text'] },
  'claude-opus-4-5': { contextWindow: 200 * K, maxTokens: 64 * K, input: ['text', 'image'] },
  'claude-sonnet-4-5': { contextWindow: 200 * K, maxTokens: 64 * K, input: ['text', 'image'] },
  'claude-haiku-4-5': { contextWindow: 200 * K, maxTokens: 64 * K, input: ['text', 'image'] },
  'claude-opus-4-1': { contextWindow: 200 * K, maxTokens: 32 * K, input: ['text', 'image'] },
  'claude-sonnet-4': { contextWindow: 200 * K, maxTokens: 64 * K, input: ['text', 'image'] },
  'claude-3-7-sonnet': { contextWindow: 200 * K, maxTokens: 64 * K, input: ['text', 'image'] },
  'gemini-2.5-pro': { contextWindow: 1024 * K, maxTokens: 64 * K, input: ['text', 'image'] },
  'gemini-2.5-flash': { contextWindow: 1024 * K, maxTokens: 64 * K, input: ['text', 'image'] },
  'grok-4': { contextWindow: 256 * K, maxTokens: 64 * K, input: ['text'] },
  'kimi-k2': { contextWindow: 256 * K, maxTokens: 8 * K, input: ['text'] },
  'qwen3-max': { contextWindow: 256 * K, maxTokens: 32 * K, input: ['text'] },
})

export const DEFAULT_CONTEXT_WINDOW = 128 * K
export const DEFAULT_MAX_TOKENS = 8 * K

/** Models whose ids carry the thinking/reasoning suffix, by family. */
const THINKING_ID_PATTERN = /(?:^|[/_.-])(thinking|reasoner|reasoning|r1)(?:[/_.-]|$)/i

/** Families where every current model is a thinking model. */
const THINKING_FAMILY_PATTERN = /^(o[134](-|$)|deepseek-reasoner)/i

export function isKnownModel(modelId) {
  return typeof modelId === 'string' && EXACT_CATALOG[modelId.trim().toLowerCase()] !== undefined
}

/**
 * Resolve catalog fields for one model id.
 * @returns {{ name?: string, contextWindow: number, maxTokens: number, input: string[] } | undefined}
 */
export function catalogFieldsFor(modelId) {
  if (typeof modelId !== 'string') return undefined
  const key = modelId.trim().toLowerCase()
  const exact = EXACT_CATALOG[key]
  if (exact) return { ...exact }

  // Family fallbacks: prefix match against known families keeps relay-only
  // ids (e.g. "gpt-6.1-sol", "claude-opus-5-thinking") reasonably sized.
  if (/^gpt-5/.test(key)) return { contextWindow: 400 * K, maxTokens: 128 * K, input: ['text', 'image'] }
  if (/^gpt-4/.test(key)) return { contextWindow: 128 * K, maxTokens: 16 * K, input: ['text', 'image'] }
  if (/^claude-(opus|sonnet|haiku)/.test(key)) return { contextWindow: 200 * K, maxTokens: 64 * K, input: ['text', 'image'] }
  if (/^deepseek/.test(key)) return { contextWindow: 128 * K, maxTokens: 32 * K, input: ['text'] }
  if (/^gemini-\d/.test(key)) return { contextWindow: 1024 * K, maxTokens: 64 * K, input: ['text', 'image'] }
  if (/^grok/.test(key)) return { contextWindow: 256 * K, maxTokens: 32 * K, input: ['text'] }
  if (/^(kimi|qwen|glm)/.test(key)) return { contextWindow: 128 * K, maxTokens: 32 * K, input: ['text'] }
  if (/^o[134]/.test(key)) return { contextWindow: 200 * K, maxTokens: 100 * K, input: ['text', 'image'] }
  return { contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS, input: ['text'] }
}

/**
 * Whether a model id denotes a thinking/reasoning model.
 * Used to auto-enable forceAdaptiveThinking on anthropic-messages routes.
 */
export function isThinkingModel(modelId) {
  if (typeof modelId !== 'string') return false
  const key = modelId.trim().toLowerCase()
  return THINKING_ID_PATTERN.test(key) || THINKING_FAMILY_PATTERN.test(key)
}
