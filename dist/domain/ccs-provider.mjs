// lib/core/claude-exclusive.js
var CLAUDE_EXCLUSIVE_ENV = [
  "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
  "CLAUDE_CODE_DISABLE_ARTIFACT",
  "ENABLE_TOOL_SEARCH",
  "CLAUDE_CODE_DISABLE_THINKING",
  "DISABLE_INTERLEAVED_THINKING",
  "CLAUDE_CODE_ALWAYS_ENABLE_EFFORT",
  "CLAUDE_CODE_EXTRA_BODY",
  "CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING",
  "CLAUDE_CODE_AUTO_MODE_SERVER",
  "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
  "CLAUDE_CODE_DISABLE_1M_CONTEXT",
  "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT",
  "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"
];
var EXCLUSIVE = new Set(CLAUDE_EXCLUSIVE_ENV);
function carryable(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
function pickClaudeExclusiveEnv(env) {
  const picked = {};
  if (env === null || typeof env !== "object" || Array.isArray(env)) return picked;
  for (const [key, value] of Object.entries(env)) {
    if (!EXCLUSIVE.has(key)) continue;
    if (!carryable(value)) continue;
    picked[key] = value;
  }
  return picked;
}

// src/domain/presets.mjs
var PROVIDER_PRESETS = Object.freeze([
  {
    key: "deepseek-claude",
    displayName: "DeepSeek",
    appType: "claude",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://api.deepseek.com/anthropic",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    icon: "deepseek",
    iconColor: "#1E88E5"
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
    iconColor: "#6366F1"
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
    iconColor: "#6366F1"
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
    iconColor: "#0F62FE"
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
    iconColor: "#0F62FE"
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
    iconColor: "#6E29F6"
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
    iconColor: "#6E29F6"
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
    iconColor: "#624AFF"
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
    iconColor: "#624AFF"
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
    iconColor: "#FF6B6B"
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
    iconColor: "#FF6B6B"
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
    iconColor: "#6566F1"
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
    iconColor: "#000000"
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
    iconColor: "#000000"
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
    iconColor: "#000000"
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
    iconColor: "#000000"
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
    iconColor: "#29E154"
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
    iconColor: "#29E154"
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
    icon: "packycode"
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
    iconColor: "#006FFB"
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
    iconColor: "#2874FF"
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
    iconColor: "#2874FF"
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
    iconColor: "#16D6D2"
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
    iconColor: "#16D6D2"
  },
  {
    key: "bailing-claude",
    displayName: "BaiLing",
    appType: "claude",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://api.ant-ling.com/anthropic",
    models: ["Ling-2.6-1T"],
    icon: "bailing"
  },
  {
    key: "bailing-codex",
    displayName: "BaiLing (Codex)",
    appType: "codex",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://api.ant-ling.com/v1",
    models: ["Ling-2.6-1T"],
    icon: "bailing"
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
    iconColor: "#3370FF"
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
    iconColor: "#3370FF"
  }
]);
var CCS_PROVIDER_CATEGORIES = Object.freeze([
  "official",
  "cn_official",
  "cloud_provider",
  "aggregator",
  "third_party",
  "custom",
  "omo",
  "omo-slim"
]);
var PRESET_GROUP_ORDER = Object.freeze([
  "login",
  "vendor",
  "thirdparty",
  "cloud",
  "plugin"
]);
var PRESET_PLAN_KEYS = Object.freeze([
  "payg",
  "coding",
  "codingPlan",
  "agentPlan",
  "tokenPlan",
  "enterpriseLite",
  "enterprisePro",
  "stepPlan",
  "aksk",
  "apiKey"
]);
var PRESET_REGION_KEYS = Object.freeze(["cn", "intl"]);

// src/domain/ccs-provider.mjs
var CCS_API_PROTOCOLS = Object.freeze([
  "openai-completions",
  "openai-responses",
  "anthropic-messages"
]);
var CCS_REASONING_LEVELS = Object.freeze([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);
var PROTOCOL_SET = new Set(CCS_API_PROTOCOLS);
var LEVEL_SET = new Set(CCS_REASONING_LEVELS);
function defineCCSModel(z) {
  return z.object({
    id: z.string().required(),
    name: z.string(),
    contextWindow: z.number().step(1).min(1),
    maxTokens: z.number().step(1).min(1),
    // `false` disables reasoning for this model; a dict maps each level to the
    // wire spelling the endpoint expects, or null for "send nothing".
    reasoningEfforts: z.union([
      z.const(false),
      z.dict(z.union([z.string(), z.const(null)]))
    ])
  });
}
function defineCCSProvider(z) {
  return z.object({
    displayName: z.string(),
    api: z.union([...CCS_API_PROTOCOLS]),
    baseURL: z.string(),
    apiKeyEnv: z.string().role("credential-ref"),
    models: z.array(defineCCSModel(z)).default([]),
    // The provider's own Claude Code compatibility switches and window sizes.
    // Kept as a dict of primitives rather than a fixed key set so a value the
    // schema does not know yet survives a round-trip; `pickClaudeExclusiveEnv`
    // is what narrows it to keys this plugin is willing to write.
    exclusiveEnv: z.dict(z.union([z.string(), z.number(), z.boolean()])),
    // CC Switch groups and labels a row by these two, and they drive four
    // behaviours that cannot otherwise be reproduced: whether the row can be
    // connectivity-checked at all, whether its API-key field is editable, the
    // "official accounts do not join the failover queue" refusal, and the
    // 官方 chip. Kept optional; an unclassified row is simply unclassified.
    category: z.union([...CCS_PROVIDER_CATEGORIES]),
    websiteUrl: z.string(),
    notes: z.string(),
    icon: z.string(),
    iconColor: z.string(),
    appType: z.string(),
    sourceProfileId: z.string(),
    // CC Switch orders a provider list by `COALESCE(sort_index, 999999),
    // created_at ASC, id ASC`. Both columns are nullable there, so both fields
    // are optional here: a provider the user has never reordered has no index,
    // and a row imported from a database that predates the column has no
    // creation time.
    sortIndex: z.number().step(1).min(0),
    createdAt: z.number(),
    isCurrent: z.boolean().default(false),
    inFailoverQueue: z.boolean().default(false),
    costMultiplier: z.number().min(0),
    limitDailyUsd: z.number().min(0),
    limitMonthlyUsd: z.number().min(0)
  });
}
function defineCCSConfig(z) {
  return z.object({
    providers: z.dict(defineCCSProvider(z)).default({}).volatile()
  });
}
function emptyCCSProvider(overrides = {}) {
  return {
    displayName: "",
    api: CCS_API_PROTOCOLS[0],
    baseURL: "",
    apiKeyEnv: "",
    models: [],
    isCurrent: false,
    inFailoverQueue: false,
    ...overrides
  };
}
function normalizeBaseUrl(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}
function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  return void 0;
}
function nonEmptyText(value) {
  const text = String(value ?? "").trim();
  return text === "" ? void 0 : text;
}
function normalizeCCSProvider(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const models = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of Array.isArray(source.models) ? source.models : []) {
    const model = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : typeof entry === "string" ? { id: entry } : void 0;
    if (model === void 0) continue;
    const id = nonEmptyText(model.id);
    if (id === void 0 || seen.has(id)) continue;
    seen.add(id);
    const next = { id };
    const name = nonEmptyText(model.name);
    if (name !== void 0) next.name = name;
    const contextWindow = finiteNumber(model.contextWindow);
    if (contextWindow !== void 0 && contextWindow >= 1) next.contextWindow = truncate(contextWindow);
    const maxTokens = finiteNumber(model.maxTokens);
    if (maxTokens !== void 0 && maxTokens >= 1) next.maxTokens = truncate(maxTokens);
    if (model.reasoningEfforts === false) next.reasoningEfforts = false;
    else if (model.reasoningEfforts && typeof model.reasoningEfforts === "object") {
      next.reasoningEfforts = { ...model.reasoningEfforts };
    }
    models.push(next);
  }
  const provider = {
    displayName: String(source.displayName ?? "").trim(),
    api: String(source.api ?? "").trim(),
    baseURL: normalizeBaseUrl(source.baseURL),
    apiKeyEnv: String(source.apiKeyEnv ?? "").trim(),
    models
  };
  const exclusiveEnv = pickClaudeExclusiveEnv(source.exclusiveEnv);
  if (Object.keys(exclusiveEnv).length > 0) provider.exclusiveEnv = exclusiveEnv;
  const category = nonEmptyText(source.category);
  if (category !== void 0 && CCS_PROVIDER_CATEGORIES.includes(category)) provider.category = category;
  for (const field of ["websiteUrl", "notes", "icon", "iconColor", "appType", "sourceProfileId"]) {
    const text = nonEmptyText(source[field]);
    if (text !== void 0) provider[field] = text;
  }
  if (source.isCurrent === true) provider.isCurrent = true;
  if (source.inFailoverQueue === true) provider.inFailoverQueue = true;
  for (const field of ["costMultiplier", "limitDailyUsd", "limitMonthlyUsd"]) {
    const amount = finiteNumber(source[field]);
    if (amount !== void 0 && amount >= 0) provider[field] = amount;
  }
  const sortIndex = finiteNumber(source.sortIndex);
  if (sortIndex !== void 0 && sortIndex >= 0) provider.sortIndex = truncate(sortIndex);
  const createdAt = finiteNumber(source.createdAt);
  if (createdAt !== void 0) provider.createdAt = createdAt;
  return provider;
}
function orderProviders(providers) {
  const UNSORTED = 999999;
  return Object.entries(providers ?? {}).map(([key, provider]) => ({ key, provider })).sort((a, b) => {
    const aIndex = Number.isInteger(a.provider?.sortIndex) ? a.provider.sortIndex : UNSORTED;
    const bIndex = Number.isInteger(b.provider?.sortIndex) ? b.provider.sortIndex : UNSORTED;
    if (aIndex !== bIndex) return aIndex - bIndex;
    const aCreated = Number.isFinite(a.provider?.createdAt) ? a.provider.createdAt : Number.NEGATIVE_INFINITY;
    const bCreated = Number.isFinite(b.provider?.createdAt) ? b.provider.createdAt : Number.NEGATIVE_INFINITY;
    if (aCreated !== bCreated) return aCreated - bCreated;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  }).map((entry) => entry.key);
}
function truncate(value) {
  return Number.isInteger(value) ? value : Math.trunc(value);
}
function validateCCSProvider(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "provider must be an object" };
  }
  if (String(value.displayName ?? "").trim() === "") {
    return { ok: false, message: "displayName is required" };
  }
  const api = String(value.api ?? "").trim();
  if (api === "") return { ok: false, message: "api is required" };
  if (!PROTOCOL_SET.has(api)) {
    return { ok: false, message: `api "${api}" is not one of ${CCS_API_PROTOCOLS.join(", ")}` };
  }
  const baseURL = String(value.baseURL ?? "").trim();
  if (baseURL === "") return { ok: false, message: "baseURL is required" };
  try {
    new URL(baseURL);
  } catch {
    return { ok: false, message: `baseURL "${baseURL}" is not a URL` };
  }
  const models = Array.isArray(value.models) ? value.models : [];
  if (models.length === 0) return { ok: false, message: "at least one model is required" };
  for (const model of models) {
    const id = model && typeof model === "object" ? String(model.id ?? "").trim() : "";
    if (id === "") return { ok: false, message: "every model needs an id" };
    const efforts = model.reasoningEfforts;
    if (efforts === void 0 || efforts === false) continue;
    if (typeof efforts !== "object" || efforts === null || Array.isArray(efforts)) {
      return { ok: false, message: `model "${id}" reasoningEfforts must be false or an object` };
    }
    for (const [level, wire] of Object.entries(efforts)) {
      if (!LEVEL_SET.has(level)) {
        return { ok: false, message: `model "${id}" has an unknown reasoning level "${level}"` };
      }
      if (wire !== null && typeof wire !== "string") {
        return { ok: false, message: `model "${id}" level "${level}" must be a string or null` };
      }
      if (level !== "off" && (wire === null || wire.trim() === "")) {
        return { ok: false, message: `model "${id}" level "${level}" needs a wire value` };
      }
    }
  }
  return { ok: true };
}
var DEFAULT_APP_TYPE = "claude";
function effectiveAppType(provider) {
  const own = provider?.appType;
  return typeof own === "string" && own !== "" ? own : DEFAULT_APP_TYPE;
}
function activateCCSProvider(providers, key) {
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    throw new Error("providers must be an object");
  }
  if (!Object.hasOwn(providers, key)) throw new Error(`unknown provider: ${key}`);
  const appType = effectiveAppType(providers[key]);
  return Object.fromEntries(
    Object.entries(providers).map(([entryKey, provider]) => [
      entryKey,
      effectiveAppType(provider) === appType ? { ...provider, isCurrent: entryKey === key } : provider
    ])
  );
}
function currentKeysByApp(providers) {
  const current = {};
  for (const [key, provider] of Object.entries(providers ?? {})) {
    if (provider?.isCurrent !== true) continue;
    const appType = effectiveAppType(provider);
    if (!Object.hasOwn(current, appType)) current[appType] = key;
  }
  return current;
}
export {
  CCS_API_PROTOCOLS,
  CCS_PROVIDER_CATEGORIES,
  CCS_REASONING_LEVELS,
  DEFAULT_APP_TYPE,
  activateCCSProvider,
  currentKeysByApp,
  defineCCSConfig,
  defineCCSModel,
  defineCCSProvider,
  effectiveAppType,
  emptyCCSProvider,
  normalizeBaseUrl,
  normalizeCCSProvider,
  orderProviders,
  validateCCSProvider
};
