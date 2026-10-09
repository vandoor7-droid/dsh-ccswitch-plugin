// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * A small catalogue of provider presets, so "add a provider" does not begin
 * with an empty form and an endpoint the user has to look up.
 *
 * Every `baseURL` and model id below is transcribed from CC Switch 4.0.4's own
 * preset sources (`src/config/{claude,codex}ProviderPresets.ts`), not invented.
 * That matters more than it looks: a relay's endpoint is frequently NOT the
 * one its marketing site suggests — several providers serve Anthropic's
 * protocol from an `/anthropic` sub-path and OpenAI's from `/v1` on the same
 * host, and a preset that guesses gets a 404 that reads like a bad key.
 *
 * A preset is only a starting point. It fills the form; the user edits and
 * saves, and what gets stored is their provider, not this entry.
 *
 * Scope: only providers whose endpoint speaks one of the three protocols
 * `dsh-llm-pi-ai` can serve are listed. Anything CC Switch reaches over
 * Gemini's native protocol is deliberately absent — see `lib/core/extract.js`
 * for why importing one would produce a provider that can never answer.
 */

/**
 * @typedef {object} CCSProviderPreset
 * @property {string} key - stable id, unique within this list
 * @property {string} displayName - what the picker shows
 * @property {string} appType - the CC Switch app this was transcribed for
 * @property {string} api - one of {@link CCS_API_PROTOCOLS}
 * @property {string} baseURL - the endpoint's base, as CC Switch writes it
 * @property {string[]} models - model ids that endpoint serves
 * @property {string} [icon] - CC Switch's icon name, for the picker
 * @property {string} [iconColor] - CC Switch's hex accent for that icon
 */

/** @type {readonly CCSProviderPreset[]} */
export const PROVIDER_PRESETS = Object.freeze([
  {
    key: "deepseek-claude",
    displayName: "DeepSeek",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://api.deepseek.com/anthropic",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    icon: "deepseek",
    iconColor: "#1E88E5",
  },
  {
    key: "kimi-claude",
    displayName: "Kimi",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://api.moonshot.cn/anthropic",
    models: ["kimi-k2.7-code"],
    icon: "kimi",
    iconColor: "#6366F1",
  },
  {
    key: "kimi-codex",
    displayName: "Kimi (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://api.moonshot.cn/v1",
    models: ["kimi-k3"],
    icon: "kimi",
    iconColor: "#6366F1",
  },
  {
    key: "zhipu-glm-claude",
    displayName: "Zhipu GLM",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://open.bigmodel.cn/api/anthropic",
    models: ["glm-5.3"],
    icon: "zhipu",
    iconColor: "#0F62FE",
  },
  {
    key: "zhipu-glm-codex",
    displayName: "Zhipu GLM (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://open.bigmodel.cn/api/v1",
    models: ["glm-5.3"],
    icon: "zhipu",
    iconColor: "#0F62FE",
  },
  {
    key: "siliconflow-claude",
    displayName: "SiliconFlow",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://api.siliconflow.cn",
    models: ["Pro/MiniMaxAI/MiniMax-M2.5"],
    icon: "siliconflow",
    iconColor: "#6E29F6",
  },
  {
    key: "siliconflow-codex",
    displayName: "SiliconFlow (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://api.siliconflow.cn/v1",
    models: ["deepseek-ai/DeepSeek-V4-Flash"],
    icon: "siliconflow",
    iconColor: "#6E29F6",
  },
  {
    key: "modelscope-claude",
    displayName: "ModelScope",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://api-inference.modelscope.cn",
    models: ["ZhipuAI/GLM-5.2"],
    icon: "modelscope",
    iconColor: "#624AFF",
  },
  {
    key: "modelscope-codex",
    displayName: "ModelScope (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://api-inference.modelscope.cn/v1",
    models: ["ZhipuAI/GLM-5.2"],
    icon: "modelscope",
    iconColor: "#624AFF",
  },
  {
    key: "minimax-claude",
    displayName: "MiniMax",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://api.minimax.cn/anthropic",
    models: ["MiniMax-M3"],
    icon: "minimax",
    iconColor: "#FF6B6B",
  },
  {
    key: "minimax-codex",
    displayName: "MiniMax (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://api.minimax.cn/v1",
    models: ["MiniMax-M3"],
    icon: "minimax",
    iconColor: "#FF6B6B",
  },
  {
    key: "openrouter-claude",
    displayName: "OpenRouter",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://openrouter.ai/api",
    models: ["anthropic/claude-haiku-4.5", "anthropic/claude-opus-5", "anthropic/claude-sonnet-5"],
    icon: "openrouter",
    iconColor: "#6566F1",
  },
  {
    key: "nvidia-claude",
    displayName: "Nvidia",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://integrate.api.nvidia.com",
    models: ["moonshotai/kimi-k3"],
    icon: "nvidia",
    iconColor: "#000000",
  },
  {
    key: "nvidia-codex",
    displayName: "Nvidia (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://integrate.api.nvidia.com/v1",
    models: ["moonshotai/kimi-k3"],
    icon: "nvidia",
    iconColor: "#000000",
  },
  {
    key: "xiaomi-mimo-claude",
    displayName: "Xiaomi MiMo",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://api.xiaomimimo.com/anthropic",
    models: ["mimo-v2.6-pro"],
    icon: "xiaomimimo",
    iconColor: "#000000",
  },
  {
    key: "xiaomi-mimo-codex",
    displayName: "Xiaomi MiMo (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://api.xiaomimimo.com/v1",
    models: ["mimo-v2.6-pro"],
    icon: "xiaomimimo",
    iconColor: "#000000",
  },
  {
    key: "longcat-claude",
    displayName: "Longcat",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://api.longcat.chat/anthropic",
    models: ["LongCat-2.0"],
    icon: "longcat",
    iconColor: "#29E154",
  },
  {
    key: "longcat-codex",
    displayName: "Longcat (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://api.longcat.chat/openai/v1",
    models: ["LongCat-2.0"],
    icon: "longcat",
    iconColor: "#29E154",
  },
  {
    key: "packycode-codex",
    displayName: "PackyCode (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://www.packyapi.ai/v1",
    models: ["gpt-5.6-sol"],
    icon: "packycode",
  },
  {
    key: "aihubmix-codex",
    displayName: "AiHubMix (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://aihubmix.com/v1",
    models: ["gpt-5.6-sol"],
    icon: "aihubmix",
    iconColor: "#006FFB",
  },
  {
    key: "ppio-claude",
    displayName: "PPIO",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://api.ppio.com/anthropic",
    models: ["deepseek/deepseek-v4-flash-0731"],
    icon: "ppio",
    iconColor: "#2874FF",
  },
  {
    key: "ppio-codex",
    displayName: "PPIO (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://api.ppio.com/openai/v1",
    models: ["deepseek/deepseek-v4-flash-0731"],
    icon: "ppio",
    iconColor: "#2874FF",
  },
  {
    key: "stepfun-claude",
    displayName: "StepFun",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://api.stepfun.com/step_plan",
    models: ["step-3.5-flash-2603"],
    icon: "stepfun",
    iconColor: "#16D6D2",
  },
  {
    key: "stepfun-codex",
    displayName: "StepFun (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://api.stepfun.com/step_plan/v1",
    models: ["step-3.7-flash"],
    icon: "stepfun",
    iconColor: "#16D6D2",
  },
  {
    key: "bailing-claude",
    displayName: "BaiLing",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://api.ant-ling.com/anthropic",
    models: ["Ling-2.6-1T"],
    icon: "bailing",
  },
  {
    key: "bailing-codex",
    displayName: "BaiLing (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://api.ant-ling.com/v1",
    models: ["Ling-2.6-1T"],
    icon: "bailing",
  },
  {
    key: "volcengine-doubao-claude",
    displayName: "Volcengine Doubao",
    appType: "claude",
    api: "anthropic-messages",
    baseURL: "https://ark.cn-beijing.volces.com/api/compatible",
    models: ["doubao-seed-2-1-pro-260628"],
    icon: "doubao",
    iconColor: "#3370FF",
  },
  {
    key: "volcengine-doubao-codex",
    displayName: "Volcengine Doubao (Codex)",
    appType: "codex",
    api: "openai-responses",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    models: ["doubao-seed-2-1-pro-260628"],
    icon: "doubao",
    iconColor: "#3370FF",
  },
])

/** A preset's key, or undefined when the catalogue has no such entry. */
export function presetByKey(key) {
  return PROVIDER_PRESETS.find((preset) => preset.key === key)
}

/**
 * The provider a preset would create, ready for the save route.
 *
 * `apiKeyEnv` is deliberately absent: the key addresses a credential, and only
 * the save path — which knows whether it is creating or updating — may mint
 * one. A preset that carried a reference could point two providers at one
 * stored secret.
 */
export function providerFromPreset(preset) {
  return {
    displayName: preset.displayName,
    api: preset.api,
    baseURL: preset.baseURL,
    models: preset.models.map((id) => ({ id })),
    appType: preset.appType,
    ...(preset.icon === undefined ? {} : { icon: preset.icon }),
    ...(preset.iconColor === undefined ? {} : { iconColor: preset.iconColor }),
  }
}
