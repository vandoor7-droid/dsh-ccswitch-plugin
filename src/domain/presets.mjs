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
 * @property {string} [family] - the vendor this shares with its other versions
 * @property {string} [planKey] - the plan, when this vendor sells several
 * @property {string} [regionKey] - the region, when this vendor serves two
 * @property {string} [category] - one of {@link CCS_PROVIDER_CATEGORIES}
 * @property {boolean} [isPartner] - CC Switch marks this vendor a partner
 * @property {string} [icon] - CC Switch's icon name, for the picker
 * @property {string} [iconColor] - CC Switch's hex accent for that icon
 */

/** @type {readonly CCSProviderPreset[]} */
export const PROVIDER_PRESETS = Object.freeze([
  {
    key: "deepseek-claude",
    displayName: "DeepSeek",
    appType: "claude",
    category: "cn_official",
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
    family: "kimi",
    planKey: "payg",
    regionKey: "cn",
    category: "cn_official",
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
    family: "kimi",
    planKey: "payg",
    regionKey: "cn",
    category: "cn_official",
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
    family: "zhipu",
    regionKey: "cn",
    category: "cn_official",
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
    family: "zhipu",
    regionKey: "cn",
    category: "cn_official",
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
    family: "siliconflow",
    regionKey: "cn",
    category: "aggregator",
    isPartner: true,
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
    family: "siliconflow",
    regionKey: "cn",
    category: "aggregator",
    isPartner: true,
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
    category: "aggregator",
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
    category: "aggregator",
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
    family: "minimax",
    regionKey: "cn",
    category: "cn_official",
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
    family: "minimax",
    regionKey: "cn",
    category: "cn_official",
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
    category: "aggregator",
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
    category: "aggregator",
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
    category: "aggregator",
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
    family: "xiaomi-mimo",
    planKey: "payg",
    category: "cn_official",
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
    family: "xiaomi-mimo",
    planKey: "payg",
    category: "cn_official",
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
    category: "cn_official",
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
    category: "cn_official",
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
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://www.packyapi.ai/v1",
    models: ["gpt-5.6-sol"],
    icon: "packycode",
  },
  {
    key: "aihubmix-codex",
    displayName: "AiHubMix (Codex)",
    appType: "codex",
    category: "aggregator",
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
    category: "aggregator",
    isPartner: true,
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
    category: "aggregator",
    isPartner: true,
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
    family: "stepfun",
    regionKey: "cn",
    category: "cn_official",
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
    family: "stepfun",
    planKey: "stepPlan",
    regionKey: "cn",
    category: "cn_official",
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
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://api.ant-ling.com/anthropic",
    models: ["Ling-2.6-1T"],
    icon: "bailing",
  },
  {
    key: "bailing-codex",
    displayName: "BaiLing (Codex)",
    appType: "codex",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://api.ant-ling.com/v1",
    models: ["Ling-2.6-1T"],
    icon: "bailing",
  },
  {
    key: "volcengine-doubao-claude",
    displayName: "Volcengine Doubao",
    appType: "claude",
    family: "volcengine",
    planKey: "payg",
    category: "cn_official",
    isPartner: true,
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
    family: "volcengine",
    planKey: "payg",
    category: "cn_official",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    models: ["doubao-seed-2-1-pro-260628"],
    icon: "doubao",
    iconColor: "#3370FF",
  },
])

/**
 * The eight categories CC Switch's frontend constrains `category` to.
 *
 * The Rust side types it as a free-form `Option<String>`, so this list is not a
 * validation gate but the vocabulary the picker and the icons are built
 * against — `types.ts` declares exactly these, and `presetGroups.ts` maps them
 * onto the five groups the "add provider" list is sectioned into.
 */
export const CCS_PROVIDER_CATEGORIES = Object.freeze([
  'official',
  'cn_official',
  'cloud_provider',
  'aggregator',
  'third_party',
  'custom',
  'omo',
  'omo-slim',
])

/**
 * The groups the preset picker is sectioned into, transcribed from
 * `presetGroups.ts`'s `PRESET_GROUP_ORDER`: account login, model vendors,
 * third-party platforms, cloud providers, plugin configurations.
 */
export const PRESET_GROUP_ORDER = Object.freeze([
  'login',
  'vendor',
  'thirdparty',
  'cloud',
  'plugin',
])

/**
 * The plans CC Switch's version control can label, transcribed from
 * `presetFamilies.ts`'s `PRESET_PLAN_KEYS`. Exported as the vocabulary a
 * `planKey` is checked against — a value outside it would render as a raw i18n
 * key rather than a label, and `presetVersionLabel` has no fallback for one.
 */
export const PRESET_PLAN_KEYS = Object.freeze([
  'payg',
  'coding',
  'codingPlan',
  'agentPlan',
  'tokenPlan',
  'enterpriseLite',
  'enterprisePro',
  'stepPlan',
  'aksk',
  'apiKey',
])

/** The two regions, in CC Switch's display order (China first). */
export const PRESET_REGION_KEYS = Object.freeze(['cn', 'intl'])

/**
 * Which section a preset belongs to, transcribed from `presetGroups.ts`.
 *
 * CC Switch's own version also sends anything carrying `requiresOAuth` or a
 * `providerType` to `login`. Neither field exists in this catalogue — every
 * entry here authenticates with an API key, because DSH has no OAuth path for a
 * third-party endpoint — so only the category half is reproduced.
 */
export function presetGroup(preset) {
  switch (preset?.category) {
    case 'official':
      return 'login'
    case 'cn_official':
      return 'vendor'
    case 'cloud_provider':
      return 'cloud'
    case 'omo':
    case 'omo-slim':
      return 'plugin'
    default:
      return 'thirdparty'
  }
}

/**
 * The i18n keys for a preset's version suffix, in CC Switch's order: plan
 * first, then region — the two dimensions `presetVersionLabel` joins with "·".
 *
 * Returned as keys rather than a joined string because this module has no
 * translator. A preset declaring neither dimension has no suffix and is shown
 * by its name alone; every such entry here is the only preset for its vendor,
 * so there is no second version to tell it apart from.
 */
export function presetVersionKeys(preset) {
  const keys = []
  if (typeof preset?.planKey === 'string' && preset.planKey !== '') {
    keys.push(`manager.plan.${preset.planKey}`)
  }
  if (typeof preset?.regionKey === 'string' && preset.regionKey !== '') {
    keys.push(`manager.region.${preset.regionKey}`)
  }
  return keys
}

/**
 * The catalogue sectioned for the picker, in `PRESET_GROUP_ORDER`.
 *
 * Empty sections are dropped rather than rendered as a heading with nothing
 * under it. A preset with no category falls to `thirdparty`, which is where
 * CC Switch's own `default` case puts it.
 */
export function groupPresetsByCategory(presets) {
  const list = Array.isArray(presets) ? presets : []
  return PRESET_GROUP_ORDER
    .map((group) => ({ group, presets: list.filter((preset) => presetGroup(preset) === group) }))
    .filter((section) => section.presets.length > 0)
}

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
