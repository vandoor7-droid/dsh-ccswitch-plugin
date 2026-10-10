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
  },
  // --- transcribed from CC Switch 4.0.6 (claude, 35 entries) ---
  //
  // Generated from `src/config/claudeProviderPresets.ts` by bundling that
  // module and reading the evaluated presets, so these endpoints are the ones
  // CC Switch itself writes rather than the ones its marketing pages suggest.
  // The hand-written block above is kept as-is; anything whose endpoint it
  // already ships is not repeated here.
  //
  // Excluded: entries with no model id (llm-pi-ai rejects an empty model list),
  // OAuth-only entries (DSH has no sign-in path), and endpoint templates like
  // `bedrock-runtime.${AWS_REGION}...` that parse as URLs but cannot be dialled.
  {
    key: "kimi-global-claude",
    displayName: "Kimi Global",
    appType: "claude",
    family: "kimi",
    planKey: "payg",
    regionKey: "intl",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://api.moonshot.ai/anthropic",
    models: ["kimi-k2.7-code"],
    icon: "kimi",
    iconColor: "#6366F1"
  },
  {
    key: "kimi-for-coding-claude",
    displayName: "Kimi For Coding",
    appType: "claude",
    family: "kimi",
    planKey: "coding",
    regionKey: "cn",
    category: "cn_official",
    isPartner: true,
    api: "anthropic-messages",
    baseURL: "https://api.kimi.com/coding/",
    models: ["kimi-for-coding"],
    icon: "kimi",
    iconColor: "#6366F1"
  },
  {
    key: "kimi-for-coding-global-claude",
    displayName: "Kimi For Coding Global",
    appType: "claude",
    family: "kimi",
    planKey: "coding",
    regionKey: "intl",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://api.kimi.ai/coding/",
    models: ["kimi-for-coding"],
    icon: "kimi",
    iconColor: "#6366F1"
  },
  {
    key: "shengsuanyun-claude",
    displayName: "Shengsuanyun",
    appType: "claude",
    category: "aggregator",
    isPartner: true,
    api: "anthropic-messages",
    baseURL: "https://router.shengsuanyun.com/api",
    models: ["anthropic/claude-sonnet-5", "anthropic/claude-opus-5", "anthropic/claude-haiku-4.5"],
    icon: "shengsuanyun"
  },
  {
    key: "fluxa-token-plan-claude",
    displayName: "FluxA Token Plan",
    appType: "claude",
    category: "aggregator",
    isPartner: true,
    api: "anthropic-messages",
    baseURL: "https://api.baiduqianfan.ai/anthropic/tokenplan/team",
    models: ["deepseek-v4-pro"],
    icon: "fluxa"
  },
  {
    key: "volcengine-agent-plan-claude",
    displayName: "\u706B\u5C71 Agent Plan",
    appType: "claude",
    family: "volcengine",
    planKey: "agentPlan",
    category: "cn_official",
    isPartner: true,
    api: "anthropic-messages",
    baseURL: "https://ark.cn-beijing.volces.com/api/plan",
    models: ["ark-code-latest"],
    icon: "huoshan",
    iconColor: "#3370FF"
  },
  {
    key: "volcengine-coding-plan-claude",
    displayName: "\u706B\u5C71 Coding Plan",
    appType: "claude",
    family: "volcengine",
    planKey: "codingPlan",
    category: "cn_official",
    isPartner: true,
    api: "anthropic-messages",
    baseURL: "https://ark.cn-beijing.volces.com/api/coding",
    models: ["ark-code-latest"],
    icon: "huoshan",
    iconColor: "#3370FF"
  },
  {
    key: "byteplus-claude",
    displayName: "BytePlus",
    appType: "claude",
    category: "cn_official",
    isPartner: true,
    api: "anthropic-messages",
    baseURL: "https://ark.ap-southeast.bytepluses.com/api/coding",
    models: ["ark-code-latest"],
    icon: "byteplus",
    iconColor: "#3370FF"
  },
  {
    key: "siliconflow-en-claude",
    displayName: "SiliconFlow en",
    appType: "claude",
    family: "siliconflow",
    regionKey: "intl",
    category: "aggregator",
    isPartner: true,
    api: "anthropic-messages",
    baseURL: "https://api.siliconflow.com",
    models: ["MiniMaxAI/MiniMax-M3"],
    icon: "siliconflow",
    iconColor: "#000000"
  },
  {
    key: "atlascloud-claude",
    displayName: "AtlasCloud",
    appType: "claude",
    category: "aggregator",
    api: "anthropic-messages",
    baseURL: "https://api.atlascloud.ai",
    models: ["zai-org/glm-5.1"],
    icon: "atlascloud"
  },
  {
    key: "soshow-claude",
    displayName: "Soshow",
    appType: "claude",
    category: "aggregator",
    api: "anthropic-messages",
    baseURL: "https://maas.so-show.com",
    models: ["claude-sonnet-5"],
    icon: "soshow"
  },
  {
    key: "gemini-native-claude",
    displayName: "Gemini Native",
    appType: "claude",
    category: "third_party",
    api: "anthropic-messages",
    baseURL: "https://generativelanguage.googleapis.com",
    models: ["gemini-3.6-flash"],
    icon: "gemini",
    iconColor: "#4285F4"
  },
  {
    key: "opencode-go-claude",
    displayName: "OpenCode Go",
    appType: "claude",
    family: "opencode",
    planKey: "coding",
    category: "third_party",
    api: "anthropic-messages",
    baseURL: "https://opencode.ai/zen/go",
    models: ["deepseek-v4-flash"],
    icon: "opencode",
    iconColor: "#211E1E"
  },
  {
    key: "opencode-zen-claude",
    displayName: "OpenCode Zen",
    appType: "claude",
    family: "opencode",
    planKey: "payg",
    category: "aggregator",
    api: "anthropic-messages",
    baseURL: "https://opencode.ai/zen",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5"],
    icon: "opencode",
    iconColor: "#211E1E"
  },
  {
    key: "tencent-token-plan-claude",
    displayName: "Tencent Token Plan",
    appType: "claude",
    family: "tencent",
    planKey: "tokenPlan",
    regionKey: "cn",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://api.lkeap.cloud.tencent.com/plan/anthropic",
    models: ["tc-code-latest"],
    icon: "tencent",
    iconColor: "#0052D9"
  },
  {
    key: "tencent-token-plan-intl-claude",
    displayName: "Tencent Token Plan (Intl)",
    appType: "claude",
    family: "tencent",
    planKey: "tokenPlan",
    regionKey: "intl",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://tokenhub-intl.tencentcloudmaas.com/plan/anthropic",
    models: ["auto"],
    icon: "tencent",
    iconColor: "#0052D9"
  },
  {
    key: "tencent-token-plan-enterprise-pro-claude",
    displayName: "Tencent Token Plan Enterprise Pro",
    appType: "claude",
    family: "tencent",
    planKey: "enterprisePro",
    regionKey: "cn",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://tokenhub.tencentmaas.com/plan/anthropic",
    models: ["auto"],
    icon: "tencent",
    iconColor: "#0052D9"
  },
  {
    key: "zhipu-glm-en-claude",
    displayName: "Zhipu GLM en",
    appType: "claude",
    family: "zhipu",
    regionKey: "intl",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://api.z.ai/api/anthropic",
    models: ["glm-5.3"],
    icon: "zhipu",
    iconColor: "#0F62FE"
  },
  {
    key: "baidu-qianfan-coding-plan-claude",
    displayName: "Baidu Qianfan Coding Plan",
    appType: "claude",
    family: "baidu-qianfan",
    planKey: "codingPlan",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://qianfan.baidubce.com/anthropic/coding",
    models: ["qianfan-code-latest"],
    icon: "baidu",
    iconColor: "#2932E1"
  },
  {
    key: "baidu-qianfan-token-plan-claude",
    displayName: "Baidu Qianfan Token Plan",
    appType: "claude",
    family: "baidu-qianfan",
    planKey: "tokenPlan",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://qianfan.baidubce.com/anthropic/tokenplan/personal",
    models: ["deepseek-v4-pro"],
    icon: "baidu",
    iconColor: "#2932E1"
  },
  {
    key: "qwen-ai-claude",
    displayName: "\u5343\u95EEAI\u5E73\u53F0",
    appType: "claude",
    family: "qianwen",
    planKey: "payg",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://dashscope.aliyuncs.com/apps/anthropic",
    models: ["qwen3.8-max", "qwen3.7-plus", "qwen3.8-flash"],
    icon: "qianwenai",
    iconColor: "#624AFF"
  },
  {
    key: "qwen-ai-token-plan-claude",
    displayName: "\u5343\u95EEAI\u5E73\u53F0 Token Plan",
    appType: "claude",
    family: "qianwen",
    planKey: "tokenPlan",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
    models: ["qwen3.8-max", "qwen3.7-plus", "qwen3.8-flash"],
    icon: "qianwenai",
    iconColor: "#624AFF"
  },
  {
    key: "qwencloud-claude",
    displayName: "QwenCloud",
    appType: "claude",
    family: "qwencloud",
    planKey: "payg",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://dashscope-intl.aliyuncs.com/apps/anthropic",
    models: ["qwen3.8-max", "qwen3.7-plus", "qwen3.8-flash"],
    icon: "qwencloud",
    iconColor: "#6336E7"
  },
  {
    key: "qwencloud-for-coding-claude",
    displayName: "QwenCloud For Coding",
    appType: "claude",
    family: "qwencloud",
    planKey: "coding",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic",
    models: ["qwen3.7-plus"],
    icon: "qwencloud",
    iconColor: "#6336E7"
  },
  {
    key: "qwencloud-token-plan-claude",
    displayName: "QwenCloud Token Plan",
    appType: "claude",
    family: "qwencloud",
    planKey: "tokenPlan",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic",
    models: ["qwen3.8-max", "qwen3.7-plus", "qwen3.8-flash"],
    icon: "qwencloud",
    iconColor: "#6336E7"
  },
  {
    key: "stepfun-en-claude",
    displayName: "StepFun en",
    appType: "claude",
    family: "stepfun",
    regionKey: "intl",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://api.stepfun.ai/step_plan",
    models: ["step-3.5-flash-2603"],
    icon: "stepfun",
    iconColor: "#16D6D2"
  },
  {
    key: "minimax-en-claude",
    displayName: "MiniMax en",
    appType: "claude",
    family: "minimax",
    regionKey: "intl",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://api.minimax.io/anthropic",
    models: ["MiniMax-M3"],
    icon: "minimax",
    iconColor: "#FF6B6B"
  },
  {
    key: "cherryin-claude",
    displayName: "CherryIN",
    appType: "claude",
    category: "aggregator",
    api: "anthropic-messages",
    baseURL: "https://open.cherryin.net",
    models: ["anthropic/claude-sonnet-5", "anthropic/claude-opus-5", "anthropic/claude-haiku-4.5"],
    icon: "cherryin"
  },
  {
    key: "therouter-claude",
    displayName: "TheRouter",
    appType: "claude",
    category: "aggregator",
    api: "anthropic-messages",
    baseURL: "https://api.therouter.ai",
    models: ["anthropic/claude-sonnet-5", "anthropic/claude-opus-5", "anthropic/claude-haiku-4.5"],
    icon: "therouter"
  },
  {
    key: "novita-ai-claude",
    displayName: "Novita AI",
    appType: "claude",
    category: "aggregator",
    api: "anthropic-messages",
    baseURL: "https://api.novita.ai/anthropic",
    models: ["zai-org/glm-5.1"],
    icon: "novita",
    iconColor: "#000000"
  },
  {
    key: "pipellm-claude",
    displayName: "PIPELLM",
    appType: "claude",
    category: "aggregator",
    api: "anthropic-messages",
    baseURL: "https://cc-api.pipellm.ai",
    models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
    icon: "pipellm"
  },
  {
    key: "xiaomi-mimo-token-plan-china-claude",
    displayName: "Xiaomi MiMo Token Plan (China)",
    appType: "claude",
    family: "xiaomi-mimo",
    planKey: "tokenPlan",
    category: "cn_official",
    api: "anthropic-messages",
    baseURL: "https://token-plan-cn.xiaomimimo.com/anthropic",
    models: ["mimo-v2.6-pro"],
    icon: "xiaomimimo",
    iconColor: "#000000"
  },
  {
    key: "jiekou-ai-claude",
    displayName: "JieKou AI",
    appType: "claude",
    category: "aggregator",
    api: "anthropic-messages",
    baseURL: "https://api.jiekou.ai/anthropic",
    models: ["claude-fable-5"],
    icon: "jiekou",
    iconColor: "#000000"
  },
  {
    key: "command-code-claude",
    displayName: "Command Code",
    appType: "claude",
    category: "third_party",
    api: "anthropic-messages",
    baseURL: "https://api.commandcode.ai/provider",
    models: ["deepseek/deepseek-v4.1-flash"],
    icon: "commandcode"
  },
  {
    key: "modelark-claude",
    displayName: "\u6A21\u529B\u65B9\u821F",
    appType: "claude",
    category: "aggregator",
    api: "anthropic-messages",
    baseURL: "https://moark.com/anthropic",
    models: ["deepseek-v4-flash-0731"],
    icon: "moark"
  },
  // --- transcribed from CC Switch 4.0.6 (codex, 77 entries) ---
  //
  // Generated from `src/config/codexProviderPresets.ts` by bundling that
  // module and reading the evaluated presets, so these endpoints are the ones
  // CC Switch itself writes rather than the ones its marketing pages suggest.
  // The hand-written block above is kept as-is; anything whose endpoint it
  // already ships is not repeated here.
  //
  // Excluded: entries with no model id (llm-pi-ai rejects an empty model list),
  // OAuth-only entries (DSH has no sign-in path), and endpoint templates like
  // `bedrock-runtime.${AWS_REGION}...` that parse as URLs but cannot be dialled.
  {
    key: "kimi-global-codex",
    displayName: "Kimi Global (Codex)",
    appType: "codex",
    family: "kimi",
    planKey: "payg",
    regionKey: "intl",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://api.moonshot.ai/v1",
    models: ["kimi-k3", "kimi-k2.7-code"],
    icon: "kimi",
    iconColor: "#6366F1"
  },
  {
    key: "kimi-for-coding-codex",
    displayName: "Kimi For Coding (Codex)",
    appType: "codex",
    family: "kimi",
    planKey: "coding",
    regionKey: "cn",
    category: "cn_official",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.kimi.com/coding/v1",
    models: ["kimi-for-coding", "kimi-for-coding-highspeed", "k3", "k3-256k"],
    icon: "kimi",
    iconColor: "#6366F1"
  },
  {
    key: "kimi-for-coding-global-codex",
    displayName: "Kimi For Coding Global (Codex)",
    appType: "codex",
    family: "kimi",
    planKey: "coding",
    regionKey: "intl",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://api.kimi.ai/coding/v1",
    models: ["kimi-for-coding", "kimi-for-coding-highspeed", "k3", "k3-256k"],
    icon: "kimi",
    iconColor: "#6366F1"
  },
  {
    key: "zetaapi-codex",
    displayName: "ZetaAPI (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.zetaapi.ai/v1",
    models: ["gpt-5.6-sol"],
    icon: "zetaapi"
  },
  {
    key: "apinebula-codex",
    displayName: "APINebula (Codex)",
    appType: "codex",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://apinebula.ai/v1",
    models: ["gpt-5.6-sol"],
    icon: "apinebula"
  },
  {
    key: "aicodemirror-codex",
    displayName: "AICodeMirror (Codex)",
    appType: "codex",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.aicodemirror.ai/api/codex/backend-api/codex",
    models: ["gpt-5.6-sol"],
    icon: "aicodemirror",
    iconColor: "#000000"
  },
  {
    key: "patewayai-codex",
    displayName: "PatewayAI (Codex)",
    appType: "codex",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.pateway.ai/v1",
    models: ["gpt-5.6-sol"],
    icon: "pateway"
  },
  {
    key: "fennoai-codex",
    displayName: "FennoAI (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.fenno.ai",
    models: ["gpt-5.6-sol"],
    icon: "fenno"
  },
  {
    key: "runapi-codex",
    displayName: "RunAPI (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://runapi.host/v1",
    models: ["gpt-5.6-sol"],
    icon: "runapi"
  },
  {
    key: "shengsuanyun-codex",
    displayName: "Shengsuanyun (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://router.shengsuanyun.com/api/v1",
    models: ["openai/gpt-5.6-sol"],
    icon: "shengsuanyun"
  },
  {
    key: "aigocode-codex",
    displayName: "AIGoCode (Codex)",
    appType: "codex",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.aigocode.app",
    models: ["gpt-5.6-sol"],
    icon: "aigocode",
    iconColor: "#5B7FFF"
  },
  {
    key: "qiniu-codex",
    displayName: "Qiniu (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.qnaigc.com/bypass/openai/v1",
    models: ["gpt-6-astra"],
    icon: "qiniu"
  },
  {
    key: "aicoding-codex",
    displayName: "AICoding (Codex)",
    appType: "codex",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.aicoding.inc",
    models: ["gpt-5.6-sol"],
    icon: "aicoding",
    iconColor: "#000000"
  },
  {
    key: "subrouter-codex",
    displayName: "SubRouter (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://subrouter.ai/v1",
    models: ["gpt-5.6-sol"],
    icon: "subrouter"
  },
  {
    key: "fluxa-token-plan-codex",
    displayName: "FluxA Token Plan (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.baiduqianfan.ai/v2/tokenplan/team",
    models: ["deepseek-v4-pro", "deepseek-v4-flash-0731", "deepseek-v4-flash", "deepseek-v3.2", "glm-5.2", "glm-5.1", "glm-5", "kimi-k2.6"],
    icon: "fluxa"
  },
  {
    key: "88api-codex",
    displayName: "88API (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.88api.ai/v1",
    models: ["gpt-5.6-sol"],
    icon: "88api"
  },
  {
    key: "apikey-fun-codex",
    displayName: "APIKEY.FUN (Codex)",
    appType: "codex",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.apikey.fan/v1",
    models: ["gpt-5.6-sol"],
    icon: "apikeyfun"
  },
  {
    key: "9527code-codex",
    displayName: "9527CODE (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://9527.codes/v1",
    models: ["gpt-5.6-sol"],
    icon: "9527code"
  },
  {
    key: "code0-codex",
    displayName: "Code0 (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://code0.ai/v1",
    models: ["gpt-5.6-sol"],
    icon: "code0"
  },
  {
    key: "teamorouter-codex",
    displayName: "TeamoRouter (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.teamorouter.cn/v1",
    models: ["gpt-5.6-sol"],
    icon: "teamorouter"
  },
  {
    key: "claudecn-codex",
    displayName: "ClaudeCN (Codex)",
    appType: "codex",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://claudecn.top/v1",
    models: ["gpt-5.6-sol"],
    icon: "claudecn"
  },
  {
    key: "volcengine-agent-plan-codex",
    displayName: "\u706B\u5C71 Agent Plan (Codex)",
    appType: "codex",
    family: "volcengine",
    planKey: "agentPlan",
    category: "cn_official",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
    models: ["ark-code-latest"],
    icon: "huoshan",
    iconColor: "#3370FF"
  },
  {
    key: "volcengine-coding-plan-codex",
    displayName: "\u706B\u5C71 Coding Plan (Codex)",
    appType: "codex",
    family: "volcengine",
    planKey: "codingPlan",
    category: "cn_official",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3",
    models: ["ark-code-latest"],
    icon: "huoshan",
    iconColor: "#3370FF"
  },
  {
    key: "byteplus-codex",
    displayName: "BytePlus (Codex)",
    appType: "codex",
    category: "cn_official",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://ark.ap-southeast.bytepluses.com/api/coding/v3",
    models: ["ark-code-latest"],
    icon: "byteplus",
    iconColor: "#3370FF"
  },
  {
    key: "siliconflow-en-codex",
    displayName: "SiliconFlow en (Codex)",
    appType: "codex",
    family: "siliconflow",
    regionKey: "intl",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.siliconflow.com/v1",
    models: ["MiniMaxAI/MiniMax-M3"],
    icon: "siliconflow",
    iconColor: "#000000"
  },
  {
    key: "a6api-codex",
    displayName: "A6API (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.a6api.com/v1",
    models: ["gpt-5.6-sol"],
    icon: "a6api"
  },
  {
    key: "compshare-codex",
    displayName: "Compshare (Codex)",
    appType: "codex",
    family: "compshare",
    planKey: "payg",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.modelverse.cn/v1",
    models: ["gpt-6-astra"],
    icon: "ucloud",
    iconColor: "#000000"
  },
  {
    key: "compshare-coding-plan-codex",
    displayName: "Compshare Coding Plan (Codex)",
    appType: "codex",
    family: "compshare",
    planKey: "codingPlan",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://cp.compshare.cn/v1",
    models: ["gpt-5.6-sol"],
    icon: "ucloud",
    iconColor: "#000000"
  },
  {
    key: "ccsub-codex",
    displayName: "CCSub (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://www.ccsub.net/v1",
    models: ["gpt-6-astra"],
    icon: "ccsub"
  },
  {
    key: "sssaicode-codex",
    displayName: "SSSAiCode (Codex)",
    appType: "codex",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://node-hk.sssaicodeapi.com/api/v1",
    models: ["gpt-5.6-sol"],
    icon: "sssaicode",
    iconColor: "#000000"
  },
  {
    key: "soleapi-codex",
    displayName: "SoleAPI (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://soleapi.com/v1",
    models: ["gpt-5.6-sol"],
    icon: "soleapi"
  },
  {
    key: "micu-codex",
    displayName: "Micu (Codex)",
    appType: "codex",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://www.micuapi.ai/v1",
    models: ["gpt-5.6-sol"],
    icon: "micu",
    iconColor: "#000000"
  },
  {
    key: "rightcode-codex",
    displayName: "RightCode (Codex)",
    appType: "codex",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://www.rightapi.ai/codex/v1",
    models: ["gpt-5.6-sol"],
    icon: "rc",
    iconColor: "#E96B2C"
  },
  {
    key: "cubence-codex",
    displayName: "Cubence (Codex)",
    appType: "codex",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.cubence.com/v1",
    models: ["gpt-5.6-sol"],
    icon: "cubence",
    iconColor: "#000000"
  },
  {
    key: "crazyrouter-codex",
    displayName: "CrazyRouter (Codex)",
    appType: "codex",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://cn.crazyrouter.com/v1",
    models: ["gpt-5.6-sol"],
    icon: "crazyrouter",
    iconColor: "#000000"
  },
  {
    key: "dmxapi-codex",
    displayName: "DMXAPI (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://www.dmxapi.cn/v1",
    models: ["gpt-5.6-sol"],
    icon: "dmxapi"
  },
  {
    key: "sudocode-chat-codex",
    displayName: "SudoCode.chat (Codex)",
    appType: "codex",
    family: "sudocode",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://api.sudocode.chat/v1",
    models: ["gpt-5.6-sol"],
    icon: "sudocode"
  },
  {
    key: "sudocode-us-codex",
    displayName: "SudoCode.us (Codex)",
    appType: "codex",
    family: "sudocode",
    category: "third_party",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://sudocode.us/v1",
    models: ["gpt-5.6-sol"],
    icon: "sudocode-us"
  },
  {
    key: "xycai-codex",
    displayName: "XycAi (Codex)",
    appType: "codex",
    category: "aggregator",
    isPartner: true,
    api: "openai-responses",
    baseURL: "https://apicdn.xycai.us/v1",
    models: ["gpt-5.6-sol"],
    icon: "xycai"
  },
  {
    key: "tu-zi-codex",
    displayName: "Tu-zi (Codex)",
    appType: "codex",
    category: "aggregator",
    api: "openai-responses",
    baseURL: "https://api.tu-zi.com/v1",
    models: ["gpt-5.6-sol"],
    icon: "tuzi"
  },
  {
    key: "amux-codex",
    displayName: "Amux (Codex)",
    appType: "codex",
    category: "aggregator",
    api: "openai-responses",
    baseURL: "https://api.amux.ai/v1",
    models: ["gpt-5.6-sol"],
    icon: "amux"
  },
  {
    key: "atlascloud-codex",
    displayName: "AtlasCloud (Codex)",
    appType: "codex",
    category: "aggregator",
    api: "openai-responses",
    baseURL: "https://api.atlascloud.ai/v1",
    models: ["zai-org/glm-5.2"],
    icon: "atlascloud"
  },
  {
    key: "soshow-codex",
    displayName: "Soshow (Codex)",
    appType: "codex",
    category: "aggregator",
    api: "openai-responses",
    baseURL: "https://maas.so-show.com/v1",
    models: ["gpt-5.6-sol"],
    icon: "soshow"
  },
  {
    key: "deepseek-codex",
    displayName: "DeepSeek (Codex)",
    appType: "codex",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://api.deepseek.com",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    icon: "deepseek",
    iconColor: "#1E88E5"
  },
  {
    key: "zhipu-glm-en-codex",
    displayName: "Zhipu GLM en (Codex)",
    appType: "codex",
    family: "zhipu",
    regionKey: "intl",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://api.z.ai/api/v1",
    models: ["glm-5.3", "glm-5.3-flash"],
    icon: "zhipu",
    iconColor: "#0F62FE"
  },
  {
    key: "baidu-qianfan-codex",
    displayName: "Baidu Qianfan (Codex)",
    appType: "codex",
    family: "baidu-qianfan",
    planKey: "payg",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://qianfan.baidubce.com/v2",
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],
    icon: "baidu",
    iconColor: "#2932E1"
  },
  {
    key: "baidu-qianfan-coding-plan-codex",
    displayName: "Baidu Qianfan Coding Plan (Codex)",
    appType: "codex",
    family: "baidu-qianfan",
    planKey: "codingPlan",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://qianfan.baidubce.com/v2/coding",
    models: ["qianfan-code-latest"],
    icon: "baidu",
    iconColor: "#2932E1"
  },
  {
    key: "baidu-qianfan-token-plan-codex",
    displayName: "Baidu Qianfan Token Plan (Codex)",
    appType: "codex",
    family: "baidu-qianfan",
    planKey: "tokenPlan",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://qianfan.baidubce.com/v2/tokenplan/personal",
    models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-0731", "glm-5.2", "glm-5.1", "kimi-k2.6"],
    icon: "baidu",
    iconColor: "#2932E1"
  },
  {
    key: "qwen-ai-codex",
    displayName: "\u5343\u95EEAI\u5E73\u53F0 (Codex)",
    appType: "codex",
    family: "qianwen",
    planKey: "payg",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3.8-max", "qwen3.8-2.4t-a95b", "qwen3.8-27b"],
    icon: "qianwenai",
    iconColor: "#624AFF"
  },
  {
    key: "qwen-ai-token-plan-codex",
    displayName: "\u5343\u95EEAI\u5E73\u53F0 Token Plan (Codex)",
    appType: "codex",
    family: "qianwen",
    planKey: "tokenPlan",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3.8-max", "qwen3.8-flash"],
    icon: "qianwenai",
    iconColor: "#624AFF"
  },
  {
    key: "qwencloud-codex",
    displayName: "QwenCloud (Codex)",
    appType: "codex",
    family: "qwencloud",
    planKey: "payg",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3.8-max", "qwen3.8-flash", "qwen3.7-max", "qwen3.8-2.4t-a95b", "qwen3.8-27b"],
    icon: "qwencloud",
    iconColor: "#6336E7"
  },
  {
    key: "qwencloud-for-coding-codex",
    displayName: "QwenCloud For Coding (Codex)",
    appType: "codex",
    family: "qwencloud",
    planKey: "coding",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://coding-intl.dashscope.aliyuncs.com/v1",
    models: ["qwen3.7-plus", "qwen3.6-plus", "qwen3-coder-plus"],
    icon: "qwencloud",
    iconColor: "#6336E7"
  },
  {
    key: "qwencloud-token-plan-codex",
    displayName: "QwenCloud Token Plan (Codex)",
    appType: "codex",
    family: "qwencloud",
    planKey: "tokenPlan",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3.8-max", "qwen3.8-flash", "qwen3.7-max"],
    icon: "qwencloud",
    iconColor: "#6336E7"
  },
  {
    key: "tencent-hunyuan-codex",
    displayName: "Tencent Hunyuan (Codex)",
    appType: "codex",
    family: "tencent",
    planKey: "payg",
    regionKey: "cn",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://tokenhub.tencentmaas.com/v1",
    models: ["hy3", "hy4-preview", "hy3-preview"],
    icon: "hunyuan",
    iconColor: "#0055E9"
  },
  {
    key: "tencent-token-plan-codex",
    displayName: "Tencent Token Plan (Codex)",
    appType: "codex",
    family: "tencent",
    planKey: "tokenPlan",
    regionKey: "cn",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://api.lkeap.cloud.tencent.com/plan/v3",
    models: ["tc-code-latest", "deepseek-v4-flash-202605", "deepseek-v4-pro-202606", "minimax-m2.7", "glm-5", "glm-5.1", "glm-5.2", "hy3", "hy3-preview"],
    icon: "tencent",
    iconColor: "#0052D9"
  },
  {
    key: "tencent-token-plan-intl-codex",
    displayName: "Tencent Token Plan (Intl) (Codex)",
    appType: "codex",
    family: "tencent",
    planKey: "tokenPlan",
    regionKey: "intl",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://tokenhub-intl.tencentcloudmaas.com/plan/v3",
    models: ["auto", "glm-5.2", "kimi-k2.6", "deepseek-v4-pro-202606", "deepseek-v4-flash-202605", "minimax-m3"],
    icon: "tencent",
    iconColor: "#0052D9"
  },
  {
    key: "tencent-token-plan-enterprise-pro-codex",
    displayName: "Tencent Token Plan Enterprise Pro (Codex)",
    appType: "codex",
    family: "tencent",
    planKey: "enterprisePro",
    regionKey: "cn",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://tokenhub.tencentmaas.com/plan/v3",
    models: ["auto", "glm-5.3", "glm-5.2", "glm-5", "glm-5.1", "glm-5-turbo", "kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6", "minimax-m2.7", "minimax-m3", "deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-0731", "deepseek-v4-pro-0813", "deepseek-v4-flash-202605", "deepseek-v4-pro-202606"],
    icon: "tencent",
    iconColor: "#0052D9"
  },
  {
    key: "stepfun-api-codex",
    displayName: "StepFun API (Codex)",
    appType: "codex",
    family: "stepfun",
    planKey: "payg",
    regionKey: "cn",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://api.stepfun.com/v1",
    models: ["step-3.7-flash"],
    icon: "stepfun",
    iconColor: "#16D6D2"
  },
  {
    key: "stepfun-api-en-codex",
    displayName: "StepFun API en (Codex)",
    appType: "codex",
    family: "stepfun",
    planKey: "payg",
    regionKey: "intl",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://api.stepfun.ai/v1",
    models: ["step-3.7-flash"],
    icon: "stepfun",
    iconColor: "#16D6D2"
  },
  {
    key: "stepfun-en-codex",
    displayName: "StepFun en (Codex)",
    appType: "codex",
    family: "stepfun",
    planKey: "stepPlan",
    regionKey: "intl",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://api.stepfun.ai/step_plan/v1",
    models: ["step-3.7-flash", "step-3.5-flash-2603", "step-3.5-flash"],
    icon: "stepfun",
    iconColor: "#16D6D2"
  },
  {
    key: "minimax-en-codex",
    displayName: "MiniMax en (Codex)",
    appType: "codex",
    family: "minimax",
    regionKey: "intl",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://api.minimax.io/v1",
    models: ["MiniMax-M3"],
    icon: "minimax",
    iconColor: "#FF6B6B"
  },
  {
    key: "astron-coding-plan-codex",
    displayName: "Astron Coding Plan (Codex)",
    appType: "codex",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://maas-coding-api.cn-huabei-1.xf-yun.com/v1",
    models: ["astron-code-latest"],
    icon: "astron"
  },
  {
    key: "xiaomi-mimo-token-plan-china-codex",
    displayName: "Xiaomi MiMo Token Plan (China) (Codex)",
    appType: "codex",
    family: "xiaomi-mimo",
    planKey: "tokenPlan",
    category: "cn_official",
    api: "openai-responses",
    baseURL: "https://token-plan-cn.xiaomimimo.com/v1",
    models: ["mimo-v2.6-pro", "mimo-v2.6-flash", "mimo-v2.5-pro", "mimo-v2.5"],
    icon: "xiaomimimo",
    iconColor: "#000000"
  },
  {
    key: "novita-ai-codex",
    displayName: "Novita AI (Codex)",
    appType: "codex",
    category: "aggregator",
    api: "openai-responses",
    baseURL: "https://api.novita.ai/openai/v1",
    models: ["zai-org/glm-5.3"],
    icon: "novita",
    iconColor: "#000000"
  },
  {
    key: "xai-grok-codex",
    displayName: "xAI (Grok) (Codex)",
    appType: "codex",
    category: "third_party",
    api: "openai-responses",
    baseURL: "https://api.x.ai/v1",
    models: ["grok-4.5", "grok-4.7"],
    icon: "xai",
    iconColor: "#000000"
  },
  {
    key: "opencode-go-codex",
    displayName: "OpenCode Go (Codex)",
    appType: "codex",
    family: "opencode",
    planKey: "coding",
    category: "third_party",
    api: "openai-responses",
    baseURL: "https://opencode.ai/zen/go/v1",
    models: ["glm-5.3", "glm-5.3-flash", "kimi-k3", "deepseek-v4-pro", "deepseek-v4-flash", "mimo-v2.5-pro"],
    icon: "opencode",
    iconColor: "#211E1E"
  },
  {
    key: "opencode-zen-codex",
    displayName: "OpenCode Zen (Codex)",
    appType: "codex",
    family: "opencode",
    planKey: "payg",
    category: "aggregator",
    api: "openai-responses",
    baseURL: "https://opencode.ai/zen/v1",
    models: ["gpt-6-sol"],
    icon: "opencode",
    iconColor: "#211E1E"
  },
  {
    key: "cherryin-codex",
    displayName: "CherryIN (Codex)",
    appType: "codex",
    category: "aggregator",
    api: "openai-responses",
    baseURL: "https://open.cherryin.net/v1",
    models: ["openai/gpt-5.6-sol"],
    icon: "cherryin"
  },
  {
    key: "relaxycode-codex",
    displayName: "RelaxyCode (Codex)",
    appType: "codex",
    category: "third_party",
    api: "openai-responses",
    baseURL: "https://www.relaxycode.com/v1",
    models: ["gpt-5.6-sol"],
    icon: "relaxcode"
  },
  {
    key: "e-flowcode-codex",
    displayName: "E-FlowCode (Codex)",
    appType: "codex",
    category: "third_party",
    api: "openai-responses",
    baseURL: "https://e-flowcode.cc/v1",
    models: ["gpt-5.6-sol"],
    icon: "eflowcode",
    iconColor: "#000000"
  },
  {
    key: "pipellm-codex",
    displayName: "PIPELLM (Codex)",
    appType: "codex",
    category: "aggregator",
    api: "openai-responses",
    baseURL: "https://cc-api.pipellm.ai/v1",
    models: ["gpt-5.6-sol"],
    icon: "pipellm"
  },
  {
    key: "openrouter-codex",
    displayName: "OpenRouter (Codex)",
    appType: "codex",
    category: "aggregator",
    api: "openai-responses",
    baseURL: "https://openrouter.ai/api/v1",
    models: ["gpt-5.6-sol"],
    icon: "openrouter",
    iconColor: "#6566F1"
  },
  {
    key: "therouter-codex",
    displayName: "TheRouter (Codex)",
    appType: "codex",
    category: "aggregator",
    api: "openai-responses",
    baseURL: "https://api.therouter.ai/v1",
    models: ["openai/gpt-5.3-codex"],
    icon: "therouter"
  },
  {
    key: "jiekou-ai-codex",
    displayName: "JieKou AI (Codex)",
    appType: "codex",
    category: "aggregator",
    api: "openai-responses",
    baseURL: "https://api.jiekou.ai/openai/v1",
    models: ["claude-fable-5"],
    icon: "jiekou",
    iconColor: "#000000"
  },
  {
    key: "aicodewith-codex",
    displayName: "AICodeWith (Codex)",
    appType: "codex",
    category: "aggregator",
    api: "openai-responses",
    baseURL: "https://api.aicodewith.ai/v1",
    models: ["gpt-5.6-sol"],
    icon: "aicodewith",
    iconColor: "#3A3B40"
  },
  {
    key: "command-code-codex",
    displayName: "Command Code (Codex)",
    appType: "codex",
    category: "third_party",
    api: "openai-responses",
    baseURL: "https://api.commandcode.ai/provider/v1",
    models: ["deepseek/deepseek-v4.1-flash", "z-ai/glm-5.3-flash", "Qwen/Qwen3.8-Flash"],
    icon: "commandcode"
  },
  {
    key: "modelark-codex",
    displayName: "\u6A21\u529B\u65B9\u821F (Codex)",
    appType: "codex",
    category: "aggregator",
    api: "openai-responses",
    baseURL: "https://moark.com/v1",
    models: ["deepseek-v4-flash-0731", "DeepSeek-V4-Pro", "GLM-5.3", "Kimi-K2.7-Code", "qwen3-coder-plus"],
    icon: "moark"
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
