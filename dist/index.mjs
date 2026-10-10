var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// node_modules/@deepseek-ai/dsh-atomic-write/lib/index.js
var lib_exports = {};
__export(lib_exports, {
  withFileLock: () => withFileLock,
  writeFileAtomic: () => writeFileAtomic
});
import { createHash as createHash2, randomBytes as randomBytes2 } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
function isTransientWindowsRenameError(error) {
  if (process.platform !== "win32") return false;
  return WINDOWS_TRANSIENT_RENAME_ERRORS.has(error?.code ?? "");
}
async function renameAtomicTemp(temp, filename) {
  let delay = WINDOWS_RENAME_RETRY_INITIAL_MS;
  for (let retries = 0; ; retries += 1) {
    try {
      await rename(temp, filename);
      return;
    } catch (error) {
      if (!isTransientWindowsRenameError(error)) throw error;
      if (retries >= WINDOWS_RENAME_RETRY_LIMIT) throw error;
    }
    await new Promise((resolve2) => setTimeout(resolve2, delay));
    delay = Math.min(delay * 2, WINDOWS_RENAME_RETRY_MAX_MS);
  }
}
async function writeFileAtomic(filename, content, options) {
  await mkdir(dirname(filename), {
    recursive: true,
    ...options.dirMode === void 0 ? {} : { mode: options.dirMode }
  });
  const temp = `${filename}.${randomBytes2(6).toString("hex")}.tmp`;
  try {
    await writeFile(temp, content, {
      mode: options.mode,
      flag: "wx"
    });
    await renameAtomicTemp(temp, filename);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
async function isLockContention(error, lockPath) {
  const code = error?.code;
  if (code === "EEXIST") return true;
  if (code !== "EPERM") return false;
  try {
    await lstat(lockPath);
    return true;
  } catch {
    return false;
  }
}
function holderExited(record) {
  if (!/^\d+\n$/.test(record)) return false;
  const pid = Number(record.trim());
  if (pid === 0 || pid > 2147483647) return false;
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}
async function readLockRecord(lockPath) {
  try {
    return await readFile(lockPath, "utf8");
  } catch (error) {
    return;
  }
}
async function takeOverExitedLock(lockPath) {
  const record = await readLockRecord(lockPath);
  if (record === void 0 || !holderExited(record)) return false;
  const claim = `${lockPath}.takeover-${createHash2("sha256").update(record).digest("hex").slice(0, 16)}`;
  try {
    await writeFile(claim, `${process.pid}
`, {
      mode: 384,
      flag: "wx"
    });
  } catch (error) {
    const code = error.code;
    if (code === "EEXIST" || code === "EPERM") return false;
    throw error;
  }
  try {
    if (await readLockRecord(lockPath) !== record || !holderExited(record)) return false;
    try {
      await rm(lockPath, { force: true });
    } catch (error) {
      return false;
    }
    return true;
  } finally {
    await rm(claim, { force: true }).catch((error) => {
    });
  }
}
async function withFileLock(filename, operation, options) {
  const lockPath = `${filename}.lock`;
  const deadline = Date.now() + (options?.waitMs ?? DEFAULT_LOCK_WAIT_MS);
  let delay = LOCK_RETRY_INITIAL_MS;
  let retriedUnconfirmedPermissionError = false;
  for (; ; ) {
    try {
      await writeFile(lockPath, `${process.pid}
`, {
        mode: 384,
        flag: "wx"
      });
      break;
    } catch (error) {
      if (!await isLockContention(error, lockPath)) {
        if (process.platform !== "win32" || error?.code !== "EPERM" || retriedUnconfirmedPermissionError) throw error;
        retriedUnconfirmedPermissionError = true;
      } else if (await takeOverExitedLock(lockPath)) continue;
    }
    if (Date.now() >= deadline) throw new Error(`atomic-write: timed out waiting for the writer lock at ${lockPath}`);
    await new Promise((resolve2) => setTimeout(resolve2, delay));
    delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS);
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true });
  }
}
var WINDOWS_TRANSIENT_RENAME_ERRORS, WINDOWS_RENAME_RETRY_INITIAL_MS, WINDOWS_RENAME_RETRY_MAX_MS, WINDOWS_RENAME_RETRY_LIMIT, LOCK_RETRY_INITIAL_MS, LOCK_RETRY_MAX_MS, DEFAULT_LOCK_WAIT_MS;
var init_lib = __esm({
  "node_modules/@deepseek-ai/dsh-atomic-write/lib/index.js"() {
    WINDOWS_TRANSIENT_RENAME_ERRORS = /* @__PURE__ */ new Set([
      "EACCES",
      "EBUSY",
      "EPERM"
    ]);
    WINDOWS_RENAME_RETRY_INITIAL_MS = 20;
    WINDOWS_RENAME_RETRY_MAX_MS = 200;
    WINDOWS_RENAME_RETRY_LIMIT = 8;
    LOCK_RETRY_INITIAL_MS = 20;
    LOCK_RETRY_MAX_MS = 200;
    DEFAULT_LOCK_WAIT_MS = 2e3;
  }
});

// src/host/index.mjs
import z from "@deepseek-ai/schemastery";

// lib/core/ids.js
import { createHash, randomBytes } from "node:crypto";
function shortHash(input, length) {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}
function slugify(name2) {
  const slug = String(name2).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "provider";
}
function providerKey(profileId, profileName) {
  const slug = slugify(profileName);
  const hash = shortHash(`${profileId}::${profileName}`, 8);
  return `ccs-${slug}-${hash}`;
}
function newProviderKey(displayName) {
  const slug = slugify(displayName);
  return `ccs-${slug}-${randomBytes(4).toString("hex")}`;
}
function credentialRefForProviderKey(providerKeyValue) {
  const tail = String(providerKeyValue).split("-").pop();
  const hash = /^[a-f0-9]{8}$/.test(tail) ? tail : shortHash(String(providerKeyValue), 8);
  return `DSH_CCSWITCH_${hash.toUpperCase()}_API_KEY`;
}
function variantKey(baseKey, index) {
  return `${baseKey}-${shortHash(`${baseKey}::${index}`, 4)}`;
}

// src/domain/catalog.mjs
var GPT_56_REASONING = Object.freeze({
  off: "none",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max"
});
var O_SERIES_REASONING = Object.freeze({
  off: null,
  low: "low",
  medium: "medium",
  high: "high"
});
var KNOWN_REASONING_CATALOG = Object.freeze({
  "gpt-5.6-sol": GPT_56_REASONING,
  "gpt-5.6-luna": GPT_56_REASONING,
  "gpt-5.6-terra": GPT_56_REASONING,
  o1: O_SERIES_REASONING,
  "o1-pro": O_SERIES_REASONING,
  o3: O_SERIES_REASONING,
  "o3-mini": O_SERIES_REASONING,
  "o3-pro": O_SERIES_REASONING,
  "o4-mini": O_SERIES_REASONING
});
function cloneReasoningEfforts(efforts) {
  return efforts === void 0 ? void 0 : { ...efforts };
}
function knownReasoningFor(modelId) {
  if (typeof modelId !== "string") return void 0;
  const key = modelId.trim().toLowerCase();
  return cloneReasoningEfforts(KNOWN_REASONING_CATALOG[key]);
}

// src/domain/import-reasoning.mjs
var IMPORTED_LEVELS = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
var IMPORTED_LEVEL_SET = new Set(IMPORTED_LEVELS);
function normalizeImportedEffort(value) {
  if (typeof value !== "string") return void 0;
  const normalized = value.trim().toLowerCase();
  if (normalized === "none") return "off";
  return IMPORTED_LEVEL_SET.has(normalized) ? normalized : void 0;
}
function seedReasoning(modelId, rawEffort) {
  const effort = normalizeImportedEffort(rawEffort);
  if (rawEffort !== void 0 && effort === void 0) return {
    efforts: false,
    defaultEffort: void 0,
    warnings: [`unknown reasoning effort "${String(rawEffort)}"; configure it in DSH`]
  };
  if (effort === "off") return { efforts: false, defaultEffort: "off", warnings: [] };
  const known = knownReasoningFor(modelId);
  if (effort === void 0) return {
    efforts: known ?? false,
    defaultEffort: void 0,
    warnings: []
  };
  if (known !== void 0 && known[effort] !== void 0) return {
    efforts: known,
    defaultEffort: effort,
    warnings: []
  };
  if (known !== void 0) return {
    efforts: known,
    defaultEffort: void 0,
    warnings: [`reasoning effort "${effort}" is not in the conservative catalog for ${modelId}`]
  };
  return {
    efforts: { off: null, [effort]: effort },
    defaultEffort: effort,
    warnings: []
  };
}

// src/domain/model-catalog.mjs
var K = 1024;
var EXACT_CATALOG = Object.freeze({
  "gpt-5.1-codex": { contextWindow: 400 * K, maxTokens: 128 * K, input: ["text", "image"] },
  "gpt-5.1-codex-mini": { contextWindow: 400 * K, maxTokens: 128 * K, input: ["text", "image"] },
  "gpt-5.1": { contextWindow: 400 * K, maxTokens: 128 * K, input: ["text", "image"] },
  "gpt-5": { contextWindow: 400 * K, maxTokens: 128 * K, input: ["text", "image"] },
  "gpt-4.1": { contextWindow: 1024 * K, maxTokens: 32 * K, input: ["text", "image"] },
  "gpt-4.1-mini": { contextWindow: 1024 * K, maxTokens: 32 * K, input: ["text", "image"] },
  "gpt-4o": { contextWindow: 128 * K, maxTokens: 16 * K, input: ["text", "image"] },
  "gpt-4o-mini": { contextWindow: 128 * K, maxTokens: 16 * K, input: ["text", "image"] },
  "o1": { contextWindow: 200 * K, maxTokens: 100 * K, input: ["text", "image"] },
  "o3": { contextWindow: 200 * K, maxTokens: 100 * K, input: ["text", "image"] },
  "o4-mini": { contextWindow: 200 * K, maxTokens: 100 * K, input: ["text", "image"] },
  "deepseek-v4.1-flash": { contextWindow: 160 * K, maxTokens: 64 * K, input: ["text"] },
  "deepseek-chat": { contextWindow: 128 * K, maxTokens: 8 * K, input: ["text"] },
  "deepseek-reasoner": { contextWindow: 128 * K, maxTokens: 64 * K, input: ["text"] },
  "claude-opus-4-5": { contextWindow: 200 * K, maxTokens: 64 * K, input: ["text", "image"] },
  "claude-sonnet-4-5": { contextWindow: 200 * K, maxTokens: 64 * K, input: ["text", "image"] },
  "claude-haiku-4-5": { contextWindow: 200 * K, maxTokens: 64 * K, input: ["text", "image"] },
  "claude-opus-4-1": { contextWindow: 200 * K, maxTokens: 32 * K, input: ["text", "image"] },
  "claude-sonnet-4": { contextWindow: 200 * K, maxTokens: 64 * K, input: ["text", "image"] },
  "claude-3-7-sonnet": { contextWindow: 200 * K, maxTokens: 64 * K, input: ["text", "image"] },
  "gemini-2.5-pro": { contextWindow: 1024 * K, maxTokens: 64 * K, input: ["text", "image"] },
  "gemini-2.5-flash": { contextWindow: 1024 * K, maxTokens: 64 * K, input: ["text", "image"] },
  "grok-4": { contextWindow: 256 * K, maxTokens: 64 * K, input: ["text"] },
  "kimi-k2": { contextWindow: 256 * K, maxTokens: 8 * K, input: ["text"] },
  "qwen3-max": { contextWindow: 256 * K, maxTokens: 32 * K, input: ["text"] }
});
var DEFAULT_CONTEXT_WINDOW = 128 * K;
var DEFAULT_MAX_TOKENS = 8 * K;
var THINKING_ID_PATTERN = /(?:^|[/_.-])(thinking|reasoner|reasoning|r1)(?:[/_.-]|$)/i;
var THINKING_FAMILY_PATTERN = /^(o[134](-|$)|deepseek-reasoner)/i;
function isKnownModel(modelId) {
  return typeof modelId === "string" && EXACT_CATALOG[modelId.trim().toLowerCase()] !== void 0;
}
function catalogFieldsFor(modelId) {
  if (typeof modelId !== "string") return void 0;
  const key = modelId.trim().toLowerCase();
  const exact = EXACT_CATALOG[key];
  if (exact) return { ...exact };
  if (/^gpt-5/.test(key)) return { contextWindow: 400 * K, maxTokens: 128 * K, input: ["text", "image"] };
  if (/^gpt-4/.test(key)) return { contextWindow: 128 * K, maxTokens: 16 * K, input: ["text", "image"] };
  if (/^claude-(opus|sonnet|haiku)/.test(key)) return { contextWindow: 200 * K, maxTokens: 64 * K, input: ["text", "image"] };
  if (/^deepseek/.test(key)) return { contextWindow: 128 * K, maxTokens: 32 * K, input: ["text"] };
  if (/^gemini-\d/.test(key)) return { contextWindow: 1024 * K, maxTokens: 64 * K, input: ["text", "image"] };
  if (/^grok/.test(key)) return { contextWindow: 256 * K, maxTokens: 32 * K, input: ["text"] };
  if (/^(kimi|qwen|glm)/.test(key)) return { contextWindow: 128 * K, maxTokens: 32 * K, input: ["text"] };
  if (/^o[134]/.test(key)) return { contextWindow: 200 * K, maxTokens: 100 * K, input: ["text", "image"] };
  return { contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS, input: ["text"] };
}
function isThinkingModel(modelId) {
  if (typeof modelId !== "string") return false;
  const key = modelId.trim().toLowerCase();
  return THINKING_ID_PATTERN.test(key) || THINKING_FAMILY_PATTERN.test(key);
}

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
function claudeExclusiveEnvOf(provider) {
  return pickClaudeExclusiveEnv(provider?.exclusiveEnv);
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
function defineCCSModel(z2) {
  return z2.object({
    id: z2.string().required(),
    name: z2.string(),
    contextWindow: z2.number().step(1).min(1),
    maxTokens: z2.number().step(1).min(1),
    // `false` disables reasoning for this model; a dict maps each level to the
    // wire spelling the endpoint expects, or null for "send nothing".
    reasoningEfforts: z2.union([
      z2.const(false),
      z2.dict(z2.union([z2.string(), z2.const(null)]))
    ])
  });
}
function defineCCSProvider(z2) {
  return z2.object({
    displayName: z2.string(),
    api: z2.union([...CCS_API_PROTOCOLS]),
    baseURL: z2.string(),
    apiKeyEnv: z2.string().role("credential-ref"),
    models: z2.array(defineCCSModel(z2)).default([]),
    // The provider's own Claude Code compatibility switches and window sizes.
    // Kept as a dict of primitives rather than a fixed key set so a value the
    // schema does not know yet survives a round-trip; `pickClaudeExclusiveEnv`
    // is what narrows it to keys this plugin is willing to write.
    exclusiveEnv: z2.dict(z2.union([z2.string(), z2.number(), z2.boolean()])),
    // CC Switch groups and labels a row by these two, and they drive four
    // behaviours that cannot otherwise be reproduced: whether the row can be
    // connectivity-checked at all, whether its API-key field is editable, the
    // "official accounts do not join the failover queue" refusal, and the
    // 官方 chip. Kept optional; an unclassified row is simply unclassified.
    category: z2.union([...CCS_PROVIDER_CATEGORIES]),
    websiteUrl: z2.string(),
    notes: z2.string(),
    icon: z2.string(),
    iconColor: z2.string(),
    appType: z2.string(),
    sourceProfileId: z2.string(),
    // CC Switch orders a provider list by `COALESCE(sort_index, 999999),
    // created_at ASC, id ASC`. Both columns are nullable there, so both fields
    // are optional here: a provider the user has never reordered has no index,
    // and a row imported from a database that predates the column has no
    // creation time.
    sortIndex: z2.number().step(1).min(0),
    createdAt: z2.number(),
    isCurrent: z2.boolean().default(false),
    inFailoverQueue: z2.boolean().default(false),
    costMultiplier: z2.number().min(0),
    limitDailyUsd: z2.number().min(0),
    limitMonthlyUsd: z2.number().min(0)
  });
}
function defineCCSConfig(z2) {
  return z2.object({
    providers: z2.dict(defineCCSProvider(z2)).default({}).volatile()
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
    const name2 = nonEmptyText(model.name);
    if (name2 !== void 0) next.name = name2;
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

// lib/core/json-equal.js
function jsonEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonEqual(item, b[index]));
  }
  if (typeof a === "object" && a !== null && b !== null) {
    const aKeys = Object.keys(a).filter((key) => a[key] !== void 0);
    const bKeys = Object.keys(b).filter((key) => b[key] !== void 0);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => b[key] !== void 0 && jsonEqual(a[key], b[key]));
  }
  return false;
}

// lib/core/mapper.js
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function enrichModel(sourceModel, profile) {
  const catalog = catalogFieldsFor(sourceModel.id);
  const next = { ...catalog, ...sourceModel };
  const thinking = sourceModel.fallbackThinking === true || isThinkingModel(sourceModel.id);
  if (profile.api === "anthropic-messages" && thinking) {
    const currentCompat = isObject(next.compat) ? next.compat : {};
    if (currentCompat.forceAdaptiveThinking === void 0) {
      next.compat = { ...currentCompat, forceAdaptiveThinking: true };
    }
  }
  delete next.fallbackThinking;
  return next;
}
function profileWarnings(profile, extra = []) {
  const modelId = profile.models?.find((model) => typeof model?.id === "string")?.id;
  const seed = modelId === void 0 ? { warnings: [] } : seedReasoning(modelId, profile.modelReasoningEffort);
  return [.../* @__PURE__ */ new Set([...profile.warnings ?? [], ...seed.warnings ?? [], ...extra])];
}
function preservationWarnings(profile, existing) {
  if (!isObject(existing)) return [];
  const warnings = [];
  const primaryModel = profile.models?.find((model) => typeof model?.id === "string");
  if (existing.reasoning !== void 0 && primaryModel) {
    const importedDefault = seedReasoning(primaryModel.id, profile.modelReasoningEffort).defaultEffort;
    if (importedDefault !== void 0 && existing.reasoning !== importedDefault) {
      warnings.push(`\u5DF2\u4FDD\u7559\u73B0\u6709 route reasoning ${existing.reasoning}\uFF0C\u672A\u8986\u76D6\u5BFC\u5165\u503C ${importedDefault}`);
    }
  }
  const existingModels = Array.isArray(existing.models) ? existing.models : [];
  for (const sourceModel of profile.models ?? []) {
    const current = existingModels.find((model) => model?.id === sourceModel?.id);
    if (!current || current.reasoningEfforts === void 0) continue;
    const importedEfforts = seedReasoning(sourceModel.id, profile.modelReasoningEffort).efforts;
    if (importedEfforts !== void 0 && JSON.stringify(current.reasoningEfforts) !== JSON.stringify(importedEfforts)) {
      warnings.push(`\u5DF2\u4FDD\u7559\u6A21\u578B ${sourceModel.id} \u7684\u73B0\u6709 reasoningEfforts`);
    }
  }
  return warnings;
}
function normalizeBaseUrl2(url) {
  return String(url ?? "").replace(/\/+$/, "");
}
function sourceModelsOf(profile) {
  return (profile.models ?? []).map((model) => typeof model === "string" ? { id: model } : model).filter((model) => typeof model?.id === "string" && model.id.length > 0);
}
function buildModels(profile, existingModels) {
  const existing = Array.isArray(existingModels) ? existingModels : [];
  const sourceModels = sourceModelsOf(profile);
  const sourceIds = new Set(sourceModels.map((model) => model.id));
  const models = sourceModels.map((sourceModel) => {
    const current = existing.find((model) => model?.id === sourceModel.id);
    const enriched = enrichModel(sourceModel, profile);
    const { fallbackThinking: _flag, ...source } = sourceModel;
    const next = { ...enriched, ...isObject(current) ? current : {}, ...source };
    delete next.fallbackThinking;
    if (isObject(enriched.compat) || isObject(next.compat)) {
      next.compat = { ...enriched.compat ?? {}, ...isObject(next.compat) ? next.compat : {} };
    }
    if (current?.reasoningEfforts === void 0) {
      next.reasoningEfforts = seedReasoning(sourceModel.id, profile.modelReasoningEffort).efforts;
    }
    return next;
  });
  for (const model of existing) {
    if (isObject(model) && typeof model.id === "string" && !sourceIds.has(model.id)) models.push({ ...model });
  }
  return { models, sourceModels };
}
function toProviderProfile(profile, existing, providerKeyValue) {
  const previous = isObject(existing) ? existing : {};
  const resolvedKey = providerKeyValue ?? providerKey(profile.profileId, profile.profileName);
  const key = credentialRefForProviderKey(resolvedKey);
  const { models, sourceModels } = buildModels(profile, previous.models);
  const mapped = {
    ...previous,
    displayName: profile.profileName,
    baseURL: normalizeBaseUrl2(profile.baseURL),
    api: profile.api,
    apiKeyEnv: key,
    models
  };
  const primaryModel = sourceModels[0];
  if (mapped.reasoning === void 0 && primaryModel) {
    const defaultEffort = seedReasoning(primaryModel.id, profile.modelReasoningEffort).defaultEffort;
    if (defaultEffort !== void 0) mapped.reasoning = defaultEffort;
  }
  return mapped;
}
function toCCSProvider(profile, existing, providerKeyValue) {
  const previous = isObject(existing) ? existing : {};
  const resolvedKey = providerKeyValue ?? providerKey(profile.profileId, profile.profileName);
  return normalizeCCSProvider({
    ...previous,
    displayName: profile.profileName,
    api: profile.api,
    baseURL: normalizeBaseUrl2(profile.baseURL),
    apiKeyEnv: credentialRefForProviderKey(resolvedKey),
    models: buildModels(profile, previous.models).models,
    ...profile.appType === void 0 ? {} : { appType: profile.appType },
    ...profile.profileId === void 0 ? {} : { sourceProfileId: profile.profileId },
    ...profile.notes === void 0 ? {} : { notes: profile.notes },
    ...profile.icon === void 0 ? {} : { icon: profile.icon },
    ...profile.iconColor === void 0 ? {} : { iconColor: profile.iconColor },
    // Carried through the catalogue so activation can put the provider's own
    // compatibility switches into the file it rewrites. `normalizeCCSProvider`
    // filters the key set, so a row cannot smuggle an arbitrary key in here.
    ...profile.exclusiveEnv === void 0 ? {} : { exclusiveEnv: profile.exclusiveEnv },
    // The vendor site and CC Switch's own grouping. Both are hand-editable in
    // the manager, so an existing value is kept when the row carries none —
    // which is what the spread-over-`previous` order already does.
    ...profile.websiteUrl === void 0 ? {} : { websiteUrl: profile.websiteUrl },
    ...profile.category === void 0 ? {} : { category: profile.category }
  });
}
function redactSummary(profile, key, status, extraWarnings = []) {
  return {
    profileId: profile.profileId,
    profileName: profile.profileName,
    sourceLabel: "CCSwitch",
    providerKey: key,
    baseURL: normalizeBaseUrl2(profile.baseURL),
    api: profile.api,
    modelCount: (profile.models ?? []).length,
    modelIds: (profile.models ?? []).map((m) => m.id),
    credential: profile.apiKey !== void 0 ? "found" : "missing",
    reasoningEffort: normalizeImportedEffort(profile.modelReasoningEffort),
    status,
    warnings: profileWarnings(profile, extraWarnings),
    blockedReason: profile.blocked ? profile.blockedReason : void 0,
    // The code/detail pair travels next to the Host-facing prose so the browser
    // can label the row in its own locale without parsing Chinese.
    blockedCode: profile.blocked ? profile.blockedCode : void 0,
    blockedDetail: profile.blocked ? profile.blockedDetail : void 0
  };
}
function resolveProviderKey(profile, existingProviders) {
  const existing = existingProviders ?? {};
  const baseKey = providerKey(profile.profileId, profile.profileName);
  let key = baseKey;
  const sameRoute = (entry) => entry?.displayName === profile.profileName && entry?.baseURL === normalizeBaseUrl2(profile.baseURL);
  let collisionWarning;
  if (existing[key] !== void 0 && !sameRoute(existing[key])) {
    let index = 1;
    while (existing[variantKey(baseKey, index)] !== void 0) {
      const candidate = variantKey(baseKey, index);
      if (sameRoute(existing[candidate])) {
        key = candidate;
        break;
      }
      index += 1;
    }
    if (key === baseKey) key = variantKey(baseKey, index);
    collisionWarning = `\u5DF2\u5B58\u5728\u540C\u540D provider\uFF0C\u5C06\u4F7F\u7528 ${key} \u5BFC\u5165\uFF0C\u4E0D\u8986\u76D6\u73B0\u6709\u914D\u7F6E`;
  }
  const warnings = profileWarnings(profile, [
    ...collisionWarning ? [collisionWarning] : [],
    ...preservationWarnings(profile, existing[key])
  ]);
  return { key, warnings };
}
function classifyProfiles(profiles, existingProviders, existingCatalogue) {
  const existing = existingProviders ?? {};
  const catalogue = existingCatalogue ?? {};
  const checkCatalogue = existingCatalogue !== void 0;
  const seen = /* @__PURE__ */ new Map();
  return profiles.map((profile) => {
    if (profile.skipped || profile.blocked) {
      return {
        profileId: profile.profileId,
        profileName: profile.profileName,
        status: "blocked",
        summary: redactSummary(profile, "", "blocked")
      };
    }
    const { key, warnings } = resolveProviderKey(profile, existing);
    if (seen.has(key)) {
      const duplicateWarning = `provider \u952E ${key} \u91CD\u590D\uFF0C\u4EC5\u5BFC\u5165\u7B2C\u4E00\u6761`;
      return {
        profileId: profile.profileId,
        profileName: profile.profileName,
        status: "blocked",
        providerKey: key,
        warnings: [...warnings, duplicateWarning],
        summary: redactSummary(profile, key, "blocked", [...warnings, duplicateWarning])
      };
    }
    seen.set(key, true);
    const existingEntry = existing[key];
    const mapped = toProviderProfile(profile, existingEntry, key);
    const catalogueEntry = catalogue[key];
    const catalogueRecord = checkCatalogue ? toCCSProvider(profile, catalogueEntry, key) : void 0;
    const catalogueSettled = !checkCatalogue || !validateCCSProvider(catalogueRecord).ok || catalogueEntry !== void 0 && jsonEqual(normalizeCCSProvider(catalogueEntry), catalogueRecord);
    const status = existingEntry === void 0 && (!checkCatalogue || catalogueEntry === void 0) ? "new" : jsonEqual(existingEntry, mapped) && catalogueSettled ? "unchanged" : "update";
    return {
      profileId: profile.profileId,
      profileName: profile.profileName,
      status,
      providerKey: key,
      warnings,
      summary: redactSummary(profile, key, status, warnings)
    };
  });
}

// lib/core/safety.js
var HOST_SETTINGS_CONFLICT_CODE = "SETTINGS_CONFLICT";
var REMOTE_SETTINGS_CONFLICT_CODE = "settings/conflict";
function isSettingsConflict(error) {
  if (!error) return false;
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === HOST_SETTINGS_CONFLICT_CODE || code === REMOTE_SETTINGS_CONFLICT_CODE) return true;
  if (/conflict/i.test(code)) return true;
  const message = error instanceof Error ? error.message : String(error?.message ?? error ?? "");
  return /conflict/i.test(message);
}
var IMPORT_FAILURE = {
  CREDENTIAL: "credential-write-failed",
  SETTINGS: "settings-write-failed",
  CONFLICT: "settings-conflict",
  ROLLBACK: "credential-rollback-failed",
  /**
   * The route into DSH landed but the plugin's own provider catalogue did not.
   *
   * A distinct kind because the two halves leave the system in different states
   * and call for different answers: this one means DSH can already call the
   * provider, and only the manager table is behind. Retrying the import repairs
   * it, and the credential must NOT be rolled back — the route references it.
   */
  CATALOGUE: "catalogue-write-failed"
};
var BLOCKED = {
  INVALID_SETTINGS_JSON: "invalid-settings-json",
  UNSUPPORTED_APP_TYPE: "unsupported-app-type",
  MISSING_OPENAI_KEY: "missing-openai-key",
  MISSING_CODEX_PROVIDER: "missing-codex-provider",
  MISSING_ANTHROPIC_KEY: "missing-anthropic-key",
  MISSING_ANTHROPIC_BASE_URL: "missing-anthropic-base-url",
  /** claude-desktop keeps its endpoint at the top level and names the key field. */
  MISSING_CLAUDE_DESKTOP_KEY: "missing-claude-desktop-key",
  MISSING_CLAUDE_DESKTOP_BASE_URL: "missing-claude-desktop-base-url",
  /**
   * claude-desktop carries an `apiFormat` naming the wire format its own tool
   * speaks. We already read the row's fields, so a value we cannot serve has to
   * be refused by name rather than imported as the one protocol we do serve —
   * that is exactly how a provider ends up registered and unable to answer.
   */
  UNSUPPORTED_CLAUDE_DESKTOP_PROTOCOL: "unsupported-claude-desktop-protocol",
  MISSING_OPENCODE_KEY: "missing-opencode-key",
  MISSING_OPENCODE_BASE_URL: "missing-opencode-base-url",
  UNSUPPORTED_OPENCODE_ADAPTER: "unsupported-opencode-adapter",
  /**
   * gemini rows are never blocked for a missing field — they are blocked on
   * protocol grounds. cc-switch configures the Gemini CLI, which speaks
   * Gemini's own protocol, and llm-pi-ai has no adapter for it, so any import
   * would be a provider that can never answer. `blockedDetail` is the endpoint
   * host so the row can still name what it would have pointed at.
   */
  UNSUPPORTED_GEMINI_PROTOCOL: "unsupported-gemini-protocol",
  /**
   * grokbuild rows hold Grok Build's own TOML, whose model table is selected by
   * `[models] default`. These are the ways a stored row can fail to yield one
   * usable endpoint. An `env_key` credential is deliberately not resolved (see
   * `extractGrokbuild`) and reports as MISSING_GROK_KEY.
   */
  MISSING_GROK_MODEL: "missing-grok-model",
  MISSING_GROK_BASE_URL: "missing-grok-base-url",
  MISSING_GROK_KEY: "missing-grok-key",
  /** `api_backend` was present but is neither responses nor chat_completions. */
  UNSUPPORTED_GROK_API_BACKEND: "unsupported-grok-api-backend",
  MISSING_HERMES_KEY: "missing-hermes-key",
  MISSING_HERMES_BASE_URL: "missing-hermes-base-url",
  MISSING_PI_KEY: "missing-pi-key",
  MISSING_PI_BASE_URL: "missing-pi-base-url",
  /** `api` was present but is not one of the three llm-pi-ai protocols. */
  UNSUPPORTED_PI_API: "unsupported-pi-api",
  MISSING_MCODE_KEY: "missing-mcode-key",
  MISSING_MCODE_BASE_URL: "missing-mcode-base-url",
  UNSUPPORTED_MCODE_API: "unsupported-mcode-api",
  MISSING_OPENCLAW_KEY: "missing-openclaw-key",
  MISSING_OPENCLAW_BASE_URL: "missing-openclaw-base-url",
  UNSUPPORTED_OPENCLAW_API: "unsupported-openclaw-api",
  /** Two selected rows resolve to the same provider key in one batch. */
  DUPLICATE_PROVIDER_KEY: "duplicate-provider-key",
  /** Fallback for a row that is blocked for a reason this build does not know. */
  UNKNOWN: "blocked"
};
var BLOCKED_CODES = new Set(Object.values(BLOCKED));
function redactText(value, secrets = []) {
  let text = value instanceof Error ? value.message : String(value?.message ?? value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8) {
      text = text.split(secret).join("[redacted]");
    }
  }
  return text.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]").replace(/\b(?:authorization|x-api-key|api-key)\b[^\n]*/gi, "auth header [redacted]").replace(/[A-Za-z0-9_\-]{32,}/g, "[redacted]").slice(0, 300);
}

// lib/core/importer.js
var ROUTE_NAMESPACE = "llm-pi-ai";
var CCS_NAMESPACE = "dsh-ccswitch-plugin";
var CATALOGUE_FAILURE = IMPORT_FAILURE.CATALOGUE;
async function importProfiles({ profiles, selectedIds, settings, credentials, expectedRevision }) {
  const selected = new Set(selectedIds ?? []);
  const results = [];
  const existing = { ...await readProviders(settings, ROUTE_NAMESPACE) ?? {} };
  const catalogue = { ...await readProviders(settings, CCS_NAMESPACE) ?? {} };
  const usedKeys = /* @__PURE__ */ new Set();
  let revisionForNextWrite = expectedRevision;
  let catalogueRevisionForNextWrite = await readRevision(settings, CCS_NAMESPACE);
  for (const profile of profiles) {
    if (profile.skipped) {
      results.push({ profileId: profile.profileId, profileName: profile.profileName, status: "skipped", skipReason: profile.skipReason });
      continue;
    }
    if (!selected.has(profile.profileId)) {
      results.push({ profileId: profile.profileId, profileName: profile.profileName, status: "skipped", skipReason: "\u672A\u9009\u62E9" });
      continue;
    }
    if (profile.blocked) {
      results.push({
        profileId: profile.profileId,
        profileName: profile.profileName,
        status: "blocked",
        error: profile.blockedReason,
        blockedCode: profile.blockedCode ?? BLOCKED.UNKNOWN,
        blockedDetail: profile.blockedDetail
      });
      continue;
    }
    const { key, warnings } = resolveProviderKey(profile, existing);
    const ref = credentialRefForProviderKey(key);
    if (usedKeys.has(key)) {
      results.push({
        profileId: profile.profileId,
        profileName: profile.profileName,
        status: "blocked",
        error: `provider \u952E ${key} \u91CD\u590D`,
        blockedCode: BLOCKED.DUPLICATE_PROVIDER_KEY,
        blockedDetail: key,
        warnings
      });
      continue;
    }
    usedKeys.add(key);
    const wasConfigured = existing[key] !== void 0;
    const mapped = toProviderProfile(profile, existing[key], key);
    const catalogueExisting = catalogue[key];
    const catalogueRecord = toCCSProvider(profile, catalogueExisting, key);
    const catalogueCheck = validateCCSProvider(catalogueRecord);
    const catalogueWarnings = catalogueCheck.ok ? [] : [`\u672A\u5199\u5165 provider \u76EE\u5F55\uFF1A${catalogueCheck.message}`];
    const catalogueUpToDate = catalogueExisting !== void 0 && jsonEqual(normalizeCCSProvider(catalogueExisting), catalogueRecord);
    const catalogueSettled = !catalogueCheck.ok || catalogueUpToDate;
    const routeSettled = wasConfigured && jsonEqual(existing[key], mapped);
    if (routeSettled && catalogueSettled) {
      results.push({
        profileId: profile.profileId,
        profileName: profile.profileName,
        providerKey: key,
        status: "unchanged",
        warnings: mergeWarnings(warnings, catalogueWarnings)
      });
      continue;
    }
    const previousCredential = await readCredential(credentials, ref);
    try {
      await credentials.set(ref, profile.apiKey);
    } catch (err) {
      results.push({
        profileId: profile.profileId,
        profileName: profile.profileName,
        providerKey: key,
        status: "failed",
        errorCode: IMPORT_FAILURE.CREDENTIAL,
        error: `\u51ED\u636E\u5199\u5165\u5931\u8D25\uFF1A${redactText(err, [profile.apiKey])}`,
        warnings: mergeWarnings(warnings, catalogueWarnings)
      });
      continue;
    }
    if (!routeSettled) {
      try {
        await settings.mutate(ROUTE_NAMESPACE, [{ op: "set", path: ["providers", key], value: mapped }], revisionForNextWrite);
      } catch (err) {
        const conflict = isSettingsConflict(err);
        const failure = {
          profileId: profile.profileId,
          profileName: profile.profileName,
          providerKey: key,
          status: "failed",
          errorCode: conflict ? IMPORT_FAILURE.CONFLICT : IMPORT_FAILURE.SETTINGS,
          error: `\u8BBE\u7F6E\u5199\u5165\u5931\u8D25\uFF1A${redactText(err, [profile.apiKey])}`,
          warnings: mergeWarnings(warnings, catalogueWarnings)
        };
        try {
          await restoreCredential(credentials, ref, previousCredential);
        } catch (cleanupErr) {
          results.push({
            ...failure,
            errorCode: IMPORT_FAILURE.ROLLBACK,
            error: `${failure.error}\uFF1B\u4E14\u51ED\u636E\u56DE\u6EDA\u5931\u8D25\uFF1A${redactText(cleanupErr, [profile.apiKey])}`
          });
          continue;
        }
        results.push(failure);
        continue;
      }
      existing[key] = mapped;
      revisionForNextWrite = await readRevision(settings, ROUTE_NAMESPACE);
    }
    if (catalogueCheck.ok && !catalogueUpToDate) {
      try {
        await settings.mutate(CCS_NAMESPACE, [{ op: "set", path: ["providers", key], value: catalogueRecord }], catalogueRevisionForNextWrite);
      } catch (err) {
        results.push({
          profileId: profile.profileId,
          profileName: profile.profileName,
          providerKey: key,
          status: "failed",
          errorCode: CATALOGUE_FAILURE,
          error: `provider \u8DEF\u7531\u5DF2\u5199\u5165\uFF0C\u4F46 provider \u76EE\u5F55\u5199\u5165\u5931\u8D25\uFF1A${redactText(err, [profile.apiKey])}`,
          warnings: mergeWarnings(warnings, catalogueWarnings)
        });
        continue;
      }
      catalogue[key] = catalogueRecord;
      catalogueRevisionForNextWrite = await readRevision(settings, CCS_NAMESPACE);
    }
    results.push({
      profileId: profile.profileId,
      profileName: profile.profileName,
      providerKey: key,
      status: wasConfigured ? "updated" : "new",
      warnings: mergeWarnings(warnings, catalogueWarnings)
    });
  }
  return results;
}
function mergeWarnings(warnings, extra) {
  return extra.length === 0 ? warnings : [.../* @__PURE__ */ new Set([...warnings, ...extra])];
}
async function readProviders(settings, ns) {
  try {
    if (typeof settings?.describe === "function") {
      const namespaces = await settings.describe();
      const namespace = (Array.isArray(namespaces) ? namespaces : []).find((entry) => entry.ns === ns);
      if (namespace?.value?.providers) return namespace.value.providers;
    }
    if (typeof settings?.get === "function") {
      const value = await settings.get(ns);
      if (value && typeof value === "object" && value.providers) return value.providers;
    }
  } catch {
  }
  return void 0;
}
async function readRevision(settings, ns) {
  try {
    if (typeof settings?.describe === "function") {
      const namespaces = await settings.describe();
      const namespace = (Array.isArray(namespaces) ? namespaces : []).find((entry) => entry.ns === ns);
      if (namespace?.revision !== void 0) return namespace.revision;
    }
  } catch {
  }
  return void 0;
}
async function readCredential(credentials, ref) {
  if (typeof credentials?.resolve === "function") {
    try {
      const resolved = await credentials.resolve(ref);
      if (resolved?.value !== void 0) return { configured: true, value: resolved.value };
    } catch {
    }
  }
  if (typeof credentials?.describe === "function") {
    try {
      const described = await credentials.describe(ref);
      return { configured: described?.configured === true, value: void 0 };
    } catch {
    }
  }
  return { configured: false, value: void 0 };
}
async function restoreCredential(credentials, ref, previous) {
  if (previous.value !== void 0) return credentials.set(ref, previous.value);
  if (!previous.configured) return credentials.unset(ref);
}

// lib/core/scan.js
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

// lib/core/toml.js
function stripInlineComment(value) {
  const first = value[0];
  if (first === '"' || first === "'") {
    const close = value.indexOf(first, 1);
    if (close !== -1) return value.slice(0, close + 1);
    return value;
  }
  const comment = value.indexOf(" #");
  if (comment !== -1) return value.slice(0, comment);
  return value;
}
function unquote(raw) {
  const value = stripInlineComment(raw.trim());
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === '"' && last === '"' || first === "'" && last === "'") {
      return value.slice(1, -1);
    }
  }
  return value;
}
function parseBool(raw) {
  const value = unquote(raw).toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return void 0;
}
function parseCodexToml(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return { model: void 0, reasoningEffort: void 0, provider: null };
  }
  let model;
  let reasoningEffort;
  let section = null;
  let provider = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (section === "model_providers.custom") {
        provider = { name: void 0, baseUrl: void 0, wireApi: void 0, requiresOpenaiAuth: void 0 };
      }
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const rawValue = line.slice(eq + 1).trim();
    if (section === null && key === "model") {
      model = unquote(rawValue);
      continue;
    }
    if (section === null && key === "model_reasoning_effort") {
      reasoningEffort = unquote(rawValue);
      continue;
    }
    if (section === "model_providers.custom" && provider) {
      if (key === "name") provider.name = unquote(rawValue);
      else if (key === "base_url") provider.baseUrl = unquote(rawValue);
      else if (key === "wire_api") provider.wireApi = unquote(rawValue);
      else if (key === "requires_openai_auth") provider.requiresOpenaiAuth = parseBool(rawValue);
    }
  }
  return { model, reasoningEffort, provider };
}
function parseGrokToml(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return { defaultModel: void 0, models: {} };
  }
  const models = {};
  let defaultModel;
  let section = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      const name2 = header[1];
      if (name2 === "models") {
        section = { kind: "models" };
        continue;
      }
      const modelTable = name2.match(/^model\.(?:"([^"]*)"|'([^']*)'|(.+))$/);
      if (modelTable) {
        const modelName = modelTable[1] ?? modelTable[2] ?? modelTable[3];
        section = { kind: "model", name: modelName };
        models[modelName] = {
          model: void 0,
          baseUrl: void 0,
          name: void 0,
          apiKey: void 0,
          envKey: void 0,
          apiBackend: void 0,
          contextWindow: void 0
        };
        continue;
      }
      section = { kind: "other" };
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const rawValue = line.slice(eq + 1).trim();
    if (section !== null && section.kind === "models" && key === "default") {
      defaultModel = unquote(rawValue);
      continue;
    }
    if (section === null || section.kind !== "model") continue;
    const entry = models[section.name];
    if (key === "model") entry.model = unquote(rawValue);
    else if (key === "base_url") entry.baseUrl = unquote(rawValue);
    else if (key === "name") entry.name = unquote(rawValue);
    else if (key === "api_key") entry.apiKey = unquote(rawValue);
    else if (key === "env_key") entry.envKey = unquote(rawValue);
    else if (key === "api_backend") entry.apiBackend = unquote(rawValue);
    else if (key === "context_window") {
      const size = Number(unquote(rawValue));
      if (Number.isInteger(size) && size > 0) entry.contextWindow = size;
    }
  }
  return { defaultModel, models };
}

// lib/core/extract.js
var SKIP_OFFICIAL = /* @__PURE__ */ new Set([
  "codex-official",
  "claude-official",
  "claude-desktop-official",
  "gemini-official",
  "grok-official"
]);
var SKIP_NAMES = /* @__PURE__ */ new Set([
  "default",
  "OpenAI Official",
  "Claude Official",
  "Claude Desktop Official",
  "Google Official",
  "Grok Official"
]);
var DSH_PROTOCOLS = /* @__PURE__ */ new Set(["openai-completions", "openai-responses", "anthropic-messages"]);
var DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5";
var DEFAULT_CODEX_MODEL = "gpt-5.1-codex";
var DEFAULT_OPENCODE_MODEL = "gpt-4o";
var DEFAULT_GEMINI_MODEL = "gemini-2.5-pro";
var DEFAULT_HERMES_MODEL = "gpt-4o";
var DEFAULT_PI_MODEL = "gpt-4o";
var DEFAULT_MCODE_MODEL = "gpt-4o";
var DEFAULT_OPENCLAW_MODEL = "gpt-4o";
function asText(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
var HERMES_API_MODES = {
  chat_completions: "openai-completions",
  codex_responses: "openai-responses",
  anthropic_messages: "anthropic-messages",
  openai_messages: "openai-completions"
};
function protocolsLabel() {
  return [...DSH_PROTOCOLS].join(" / ");
}
function withModelFallback(models, fallback, label, warnings) {
  if (models.length > 0) return models;
  warnings.push(`${label} \u914D\u7F6E\u4E2D\u6CA1\u6709\u6A21\u578B\u5217\u8868\uFF0C\u5DF2\u56DE\u9000\u4E3A ${fallback}\uFF0C\u5BFC\u5165\u540E\u53EF\u5728 DSH \u4E2D\u4FEE\u6539`);
  return [{ id: fallback }];
}
function modelsFromArray(list, { withContextLength = false } = {}) {
  if (!Array.isArray(list)) return [];
  const models = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const id = asText(entry.id);
    if (id === void 0) continue;
    const model = { id };
    const name2 = asText(entry.name);
    if (name2 !== void 0) model.name = name2;
    if (withContextLength) {
      const context = entry.context_length;
      if (Number.isFinite(context) && context >= 1) model.contextWindow = Math.trunc(context);
    }
    models.push(model);
  }
  return models;
}
function modelsFromMap(rawModels) {
  if (!rawModels || typeof rawModels !== "object" || Array.isArray(rawModels)) return [];
  return Object.entries(rawModels).filter(([id]) => asText(id) !== void 0).map(([id, meta]) => {
    const name2 = meta && typeof meta === "object" ? asText(meta.name) : void 0;
    return name2 ? { id, name: name2 } : { id };
  });
}
function extractProfile(row) {
  const profileId = String(row.id ?? "");
  const profileName = String(row.name ?? "");
  const appType = String(row.app_type ?? "codex");
  if (SKIP_OFFICIAL.has(profileId)) {
    return { profileId, profileName, appType, skipped: true, skipReason: "\u5B98\u65B9\u767B\u5F55\u6001\uFF08official\uFF09\u4E0D\u652F\u6301\u5BFC\u5165" };
  }
  if (SKIP_NAMES.has(profileName)) {
    return { profileId, profileName, appType, skipped: true, skipReason: "\u5B98\u65B9/\u9ED8\u8BA4 provider \u4E0D\u652F\u6301\u5BFC\u5165" };
  }
  const websiteUrl = asText(row.website_url);
  const category = asText(row.category);
  const base = {
    profileId,
    profileName,
    appType,
    isCurrent: Boolean(row.is_current),
    ...websiteUrl === void 0 ? {} : { websiteUrl },
    ...category === void 0 ? {} : { category },
    blocked: false,
    blockedReason: "",
    blockedCode: void 0,
    blockedDetail: void 0,
    warnings: [],
    unsupported: [],
    apiKey: void 0,
    baseURL: "",
    api: void 0,
    models: [],
    modelReasoningEffort: void 0
  };
  let parsed;
  try {
    parsed = JSON.parse(String(row.settings_config ?? "{}"));
  } catch {
    return { ...base, blocked: true, blockedReason: "settings_config \u4E0D\u662F\u5408\u6CD5 JSON", blockedCode: BLOCKED.INVALID_SETTINGS_JSON };
  }
  if (appType === "codex") return extractCodex(base, parsed);
  if (appType === "grokbuild") return extractGrokbuild(base, parsed);
  if (appType === "claude") return extractClaude(base, parsed);
  if (appType === "claude-desktop") return extractClaudeDesktop(base, parsed);
  if (appType === "opencode") return extractOpencode(base, parsed);
  if (appType === "gemini") return extractGemini(base, parsed);
  if (appType === "hermes") return extractHermes(base, parsed);
  if (appType === "pi") return extractPi(base, parsed);
  if (appType === "mcode") return extractMcode(base, parsed);
  if (appType === "openclaw") return extractOpenclaw(base, parsed);
  return { ...base, blocked: true, blockedReason: `\u4E0D\u652F\u6301\u7684 app_type\uFF1A${appType}`, blockedCode: BLOCKED.UNSUPPORTED_APP_TYPE, blockedDetail: appType };
}
function extractCodex(base, parsed) {
  const auth = (parsed && typeof parsed === "object" ? parsed.auth : void 0) ?? {};
  const apiKey = typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.length > 0 ? auth.OPENAI_API_KEY : void 0;
  if (apiKey === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 API key\uFF08auth.OPENAI_API_KEY \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_OPENAI_KEY };
  }
  const configText = typeof parsed.config === "string" ? parsed.config : "";
  const toml = parseCodexToml(configText);
  const reasoningEffort = toml.reasoningEffort;
  const provider = toml.provider;
  let model = toml.model;
  if (!provider || typeof provider.baseUrl !== "string" || provider.baseUrl === "") {
    return { ...base, blocked: true, blockedReason: "config \u4E2D\u7F3A\u5C11\u53EF\u7528\u7684 [model_providers.custom] \u6BB5", blockedCode: BLOCKED.MISSING_CODEX_PROVIDER };
  }
  const warnings = [];
  if (provider.requiresOpenaiAuth === true) {
    warnings.push("provider \u6807\u8BB0 requires_openai_auth\uFF0C\u5BFC\u5165\u540E\u53EF\u80FD\u4ECD\u65E0\u6CD5\u901A\u8FC7 API key \u8BA4\u8BC1");
  }
  if (provider.wireApi !== void 0 && provider.wireApi !== "responses" && provider.wireApi !== "chat") {
    warnings.push(`\u672A\u77E5 wire_api "${provider.wireApi}"\uFF0C\u6309 openai-completions \u5904\u7406`);
  }
  if (!model) {
    model = DEFAULT_CODEX_MODEL;
    warnings.push(`config \u4E2D\u6CA1\u6709 model \u5B57\u6BB5\uFF0C\u5DF2\u56DE\u9000\u4E3A ${DEFAULT_CODEX_MODEL}\uFF0C\u5BFC\u5165\u540E\u53EF\u5728 DSH \u4E2D\u4FEE\u6539`);
  }
  const api = provider.wireApi === "responses" ? "openai-responses" : "openai-completions";
  return {
    ...base,
    apiKey,
    baseURL: provider.baseUrl,
    api,
    models: [{ id: model }],
    modelReasoningEffort: reasoningEffort,
    warnings,
    unsupported: []
  };
}
function extractGrokbuild(base, parsed) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const { defaultModel, models } = parseGrokToml(asText(source.config) ?? "");
  const names = Object.keys(models);
  const declared = asText(defaultModel);
  const selectedName = declared !== void 0 && models[declared] !== void 0 ? declared : names.length === 1 ? names[0] : void 0;
  if (selectedName === void 0) {
    return {
      ...base,
      blocked: true,
      blockedReason: declared === void 0 ? "Grok \u914D\u7F6E\u91CC\u6CA1\u6709 [models] default\uFF0C\u4E5F\u6CA1\u6709\u552F\u4E00\u7684\u6A21\u578B\u8868\u53EF\u7528\u4E8E\u5BFC\u5165" : `Grok \u914D\u7F6E\u7684 [models] default "${declared}" \u6CA1\u6709\u5BF9\u5E94\u7684\u6A21\u578B\u8868`,
      blockedCode: BLOCKED.MISSING_GROK_MODEL,
      blockedDetail: declared
    };
  }
  const selected = models[selectedName];
  const baseURL = asText(selected.baseUrl);
  if (baseURL === void 0) {
    return {
      ...base,
      blocked: true,
      blockedReason: `Grok \u914D\u7F6E\u7684\u6A21\u578B\u8868 "${selectedName}" \u7F3A\u5C11 base_url`,
      blockedCode: BLOCKED.MISSING_GROK_BASE_URL,
      blockedDetail: selectedName
    };
  }
  const apiKey = asText(selected.apiKey);
  if (apiKey === void 0) {
    const viaEnv = asText(selected.envKey);
    return {
      ...base,
      blocked: true,
      blockedReason: viaEnv === void 0 ? `Grok \u914D\u7F6E\u7684\u6A21\u578B\u8868 "${selectedName}" \u7F3A\u5C11 api_key` : `Grok \u914D\u7F6E\u7684\u6A21\u578B\u8868 "${selectedName}" \u628A\u5BC6\u94A5\u653E\u5728\u73AF\u5883\u53D8\u91CF ${viaEnv} \u91CC\uFF1B\u5BFC\u5165\u4E0D\u4F1A\u4EE3\u8BFB\u5B83\uFF0C\u8BF7\u6539\u586B api_key`,
      blockedCode: BLOCKED.MISSING_GROK_KEY,
      blockedDetail: selectedName
    };
  }
  const warnings = [];
  const backend = asText(selected.apiBackend);
  let api;
  if (backend === void 0) {
    api = "openai-responses";
    warnings.push("Grok \u914D\u7F6E\u6CA1\u6709 api_backend\uFF0C\u5DF2\u6309 responses \u5904\u7406");
  } else if (backend === "responses") {
    api = "openai-responses";
  } else if (backend === "chat_completions") {
    api = "openai-completions";
  } else {
    return {
      ...base,
      blocked: true,
      blockedReason: `Grok \u7684 api_backend "${backend}" \u4E0D\u662F DSH \u652F\u6301\u7684\u534F\u8BAE\uFF08\u4EC5 responses / chat_completions\uFF09`,
      blockedCode: BLOCKED.UNSUPPORTED_GROK_API_BACKEND,
      blockedDetail: backend
    };
  }
  const model = { id: asText(selected.model) ?? selectedName };
  if (Number.isInteger(selected.contextWindow) && selected.contextWindow > 0) {
    model.contextWindow = selected.contextWindow;
  }
  return {
    ...base,
    apiKey,
    baseURL,
    api,
    models: [model],
    modelReasoningEffort: void 0,
    warnings,
    unsupported: []
  };
}
function claudeModels(env, profileName, warnings) {
  if (asText(env?.ANTHROPIC_MODEL) !== void 0) return [env.ANTHROPIC_MODEL];
  warnings.push(`claude \u914D\u7F6E\u4E2D\u6CA1\u6709\u6A21\u578B\u5B57\u6BB5\uFF0C\u5DF2\u56DE\u9000\u4E3A ${DEFAULT_CLAUDE_MODEL}\uFF0C\u5BFC\u5165\u540E\u53EF\u5728 DSH \u4E2D\u4FEE\u6539`);
  if (/thinking/i.test(profileName)) return [{ id: DEFAULT_CLAUDE_MODEL, fallbackThinking: true }];
  return [DEFAULT_CLAUDE_MODEL];
}
function extractClaude(base, parsed) {
  const { profileName } = base;
  const env = (parsed && typeof parsed === "object" ? parsed.env : void 0) ?? {};
  const apiKey = [env.ANTHROPIC_AUTH_TOKEN, env.ANTHROPIC_API_KEY].find((value) => typeof value === "string" && value.length > 0);
  if (apiKey === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 API key\uFF08env.ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_ANTHROPIC_KEY };
  }
  const baseURL = asText(env.ANTHROPIC_BASE_URL);
  if (baseURL === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 base URL\uFF08env.ANTHROPIC_BASE_URL \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_ANTHROPIC_BASE_URL };
  }
  const warnings = [];
  const exclusiveEnv = pickClaudeExclusiveEnv(env);
  return {
    ...base,
    apiKey,
    baseURL,
    api: "anthropic-messages",
    models: claudeModels(env, profileName, warnings),
    ...Object.keys(exclusiveEnv).length > 0 ? { exclusiveEnv } : {},
    modelReasoningEffort: void 0,
    warnings,
    unsupported: []
  };
}
function extractClaudeDesktop(base, parsed) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const env = source.env && typeof source.env === "object" ? source.env : {};
  const namedField = source.apiKeyField === "ANTHROPIC_AUTH_TOKEN" || source.apiKeyField === "ANTHROPIC_API_KEY" ? source.apiKeyField : void 0;
  const apiKey = [
    namedField === void 0 ? void 0 : env[namedField],
    env.ANTHROPIC_AUTH_TOKEN,
    env.ANTHROPIC_API_KEY
  ].find((value) => typeof value === "string" && value.length > 0);
  if (apiKey === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 API key\uFF08baseUrl \u914D\u7F6E\u4E2D\u7F3A\u5C11 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY\uFF09", blockedCode: BLOCKED.MISSING_CLAUDE_DESKTOP_KEY };
  }
  const baseURL = asText(source.baseUrl) ?? asText(env.ANTHROPIC_BASE_URL);
  if (baseURL === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 base URL\uFF08\u7F3A\u5C11\u9876\u7EA7 baseUrl \u4E0E env.ANTHROPIC_BASE_URL\uFF09", blockedCode: BLOCKED.MISSING_CLAUDE_DESKTOP_BASE_URL };
  }
  const warnings = [];
  const declared = asText(source.apiFormat);
  if (declared !== void 0 && declared !== "anthropic") {
    return {
      ...base,
      blocked: true,
      blockedReason: `claude-desktop \u7684 apiFormat \u4E0D\u662F DSH \u652F\u6301\u7684\u534F\u8BAE\uFF1A${declared}`,
      blockedCode: BLOCKED.UNSUPPORTED_CLAUDE_DESKTOP_PROTOCOL,
      blockedDetail: declared
    };
  }
  return {
    ...base,
    apiKey,
    baseURL,
    api: "anthropic-messages",
    models: claudeModels(env, base.profileName, warnings),
    modelReasoningEffort: void 0,
    warnings,
    unsupported: []
  };
}
function extractOpencode(base, parsed) {
  const options = (parsed && typeof parsed === "object" ? parsed.options : void 0) ?? {};
  const apiKey = asText(options.apiKey);
  if (apiKey === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 API key\uFF08options.apiKey \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_OPENCODE_KEY };
  }
  const baseURL = asText(options.baseURL);
  if (baseURL === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 base URL\uFF08options.baseURL \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_OPENCODE_BASE_URL };
  }
  const npm = typeof parsed.npm === "string" ? parsed.npm : "";
  if (npm !== "@ai-sdk/openai-compatible") {
    return { ...base, blocked: true, blockedReason: `\u6682\u4E0D\u652F\u6301\u7684 opencode \u9002\u914D\u5668\uFF1A${npm || "\u672A\u77E5"}\uFF08\u4EC5 @ai-sdk/openai-compatible\uFF09`, blockedCode: BLOCKED.UNSUPPORTED_OPENCODE_ADAPTER, blockedDetail: npm || "unknown" };
  }
  const warnings = [];
  const models = withModelFallback(
    modelsFromMap(parsed && typeof parsed === "object" ? parsed.models : void 0),
    DEFAULT_OPENCODE_MODEL,
    "opencode",
    warnings
  );
  return {
    ...base,
    apiKey,
    baseURL,
    api: "openai-completions",
    models,
    modelReasoningEffort: void 0,
    warnings,
    unsupported: []
  };
}
function extractGemini(base, parsed) {
  const env = (parsed && typeof parsed === "object" ? parsed.env : void 0) ?? {};
  const apiKey = [env.GEMINI_API_KEY, env.GOOGLE_API_KEY].find((value) => typeof value === "string" && value.length > 0);
  const baseURL = asText(env.GOOGLE_GEMINI_BASE_URL);
  const warnings = [];
  const models = withModelFallback(
    asText(env.GEMINI_MODEL) === void 0 ? [] : [{ id: env.GEMINI_MODEL }],
    DEFAULT_GEMINI_MODEL,
    "gemini",
    warnings
  );
  let host = "";
  if (baseURL !== void 0) {
    try {
      host = new URL(baseURL).host;
    } catch {
      host = "";
    }
  }
  return {
    ...base,
    apiKey,
    baseURL: baseURL ?? "",
    api: void 0,
    models,
    modelReasoningEffort: void 0,
    warnings,
    unsupported: [],
    blocked: true,
    blockedReason: "Gemini CLI \u4F7F\u7528 Gemini \u539F\u751F\u534F\u8BAE\uFF0CDSH \u7684 llm-pi-ai \u6CA1\u6709\u5BF9\u5E94\u9002\u914D\u5668\uFF0C\u5BFC\u5165\u540E\u4F1A\u5F97\u5230\u4E00\u4E2A\u65E0\u6CD5\u5E94\u7B54\u7684 provider\u3002\u8BF7\u6539\u7528 OpenAI \u517C\u5BB9\u7684 Gemini \u4E2D\u8F6C\uFF08Base URL + API Key\uFF09\u5E76\u628A\u5B83\u586B\u6210 openai-completions\u3002",
    blockedCode: BLOCKED.UNSUPPORTED_GEMINI_PROTOCOL,
    blockedDetail: host
  };
}
function extractHermes(base, parsed) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const apiKey = asText(source.api_key);
  if (apiKey === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 API key\uFF08api_key \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_HERMES_KEY };
  }
  const baseURL = asText(source.base_url);
  if (baseURL === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 base URL\uFF08base_url \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_HERMES_BASE_URL };
  }
  const warnings = [];
  const apiMode = asText(source.api_mode);
  let api = HERMES_API_MODES[apiMode];
  if (api === void 0) {
    warnings.push(`\u672A\u77E5 api_mode "${apiMode ?? "\u7F3A\u5931"}"\uFF0C\u6309 openai-completions \u5904\u7406`);
    api = "openai-completions";
  }
  return {
    ...base,
    apiKey,
    baseURL,
    api,
    models: withModelFallback(modelsFromArray(source.models, { withContextLength: true }), DEFAULT_HERMES_MODEL, "hermes", warnings),
    modelReasoningEffort: void 0,
    warnings,
    unsupported: []
  };
}
function extractPi(base, parsed) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const apiKey = asText(source.apiKey);
  if (apiKey === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 API key\uFF08apiKey \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_PI_KEY };
  }
  const baseURL = asText(source.baseUrl);
  if (baseURL === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 base URL\uFF08baseUrl \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_PI_BASE_URL };
  }
  const api = asText(source.api);
  if (api === void 0 || !DSH_PROTOCOLS.has(api)) {
    return {
      ...base,
      blocked: true,
      blockedReason: `pi \u7684 api "${api ?? "\u7F3A\u5931"}" \u4E0D\u662F DSH \u652F\u6301\u7684\u534F\u8BAE\uFF08\u4EC5 ${protocolsLabel()}\uFF09`,
      blockedCode: BLOCKED.UNSUPPORTED_PI_API,
      blockedDetail: api ?? "unknown"
    };
  }
  const warnings = [];
  return {
    ...base,
    apiKey,
    baseURL,
    api,
    models: withModelFallback(modelsFromArray(source.models), DEFAULT_PI_MODEL, "pi", warnings),
    modelReasoningEffort: void 0,
    warnings,
    unsupported: []
  };
}
function extractMcode(base, parsed) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const options = source.options && typeof source.options === "object" ? source.options : {};
  const apiKey = asText(options.apiKey);
  if (apiKey === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 API key\uFF08options.apiKey \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_MCODE_KEY };
  }
  const baseURL = asText(options.baseURL);
  if (baseURL === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 base URL\uFF08options.baseURL \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_MCODE_BASE_URL };
  }
  const api = asText(source.api);
  if (api === void 0 || !DSH_PROTOCOLS.has(api)) {
    return {
      ...base,
      blocked: true,
      blockedReason: `mcode \u7684 api "${api ?? "\u7F3A\u5931"}" \u4E0D\u662F DSH \u652F\u6301\u7684\u534F\u8BAE\uFF08\u4EC5 ${protocolsLabel()}\uFF09`,
      blockedCode: BLOCKED.UNSUPPORTED_MCODE_API,
      blockedDetail: api ?? "unknown"
    };
  }
  const warnings = [];
  return {
    ...base,
    apiKey,
    baseURL,
    api,
    models: withModelFallback(modelsFromMap(source.models), DEFAULT_MCODE_MODEL, "mcode", warnings),
    modelReasoningEffort: void 0,
    warnings,
    unsupported: []
  };
}
function extractOpenclaw(base, parsed) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const apiKey = asText(source.apiKey);
  if (apiKey === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 API key\uFF08apiKey \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_OPENCLAW_KEY };
  }
  const baseURL = asText(source.baseUrl);
  if (baseURL === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 base URL\uFF08baseUrl \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_OPENCLAW_BASE_URL };
  }
  const api = asText(source.api);
  if (api === void 0 || !DSH_PROTOCOLS.has(api)) {
    return {
      ...base,
      blocked: true,
      blockedReason: `openclaw \u7684 api "${api ?? "\u7F3A\u5931"}" \u4E0D\u662F DSH \u652F\u6301\u7684\u534F\u8BAE\uFF08\u4EC5 ${protocolsLabel()}\uFF09`,
      blockedCode: BLOCKED.UNSUPPORTED_OPENCLAW_API,
      blockedDetail: api ?? "unknown"
    };
  }
  const warnings = [];
  return {
    ...base,
    apiKey,
    baseURL,
    api,
    models: withModelFallback(modelsFromArray(source.models), DEFAULT_OPENCLAW_MODEL, "openclaw", warnings),
    modelReasoningEffort: void 0,
    warnings,
    unsupported: []
  };
}

// lib/core/scan.js
var DEFAULT_DB_CANDIDATES = [
  () => join(homedir(), ".cc-switch", "cc-switch.db")
];
var SUPPORTED_APP_TYPES = [
  "codex",
  "claude",
  "claude-desktop",
  "opencode",
  // Added in 4.0.4. `gemini` and `grokbuild` are scanned even though gemini is
  // always blocked downstream: the row still has to appear so the user learns
  // why it cannot come across, instead of it silently vanishing from the list.
  "gemini",
  "hermes",
  "grokbuild",
  "pi",
  "mcode",
  "openclaw"
];
var SCAN_REASON = {
  NOT_INSTALLED: "not-installed",
  NO_PROFILES: "no-profiles",
  UNREADABLE: "unreadable",
  UNSUPPORTED_NODE: "unsupported-node"
};
var require2 = createRequire(import.meta.url);
var databaseSyncClass;
var databaseSyncResolved = false;
function loadDatabaseSync() {
  if (!databaseSyncResolved) {
    databaseSyncResolved = true;
    try {
      databaseSyncClass = require2("node:sqlite")?.DatabaseSync;
    } catch {
      databaseSyncClass = void 0;
    }
  }
  return databaseSyncClass;
}
function sqliteAvailable() {
  return typeof loadDatabaseSync() === "function";
}
function openDb(dbPath) {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) {
    throw new Error(`node:sqlite is unavailable on Node ${process.version}; this importer needs Node >= 22.5`);
  }
  return new DatabaseSync(dbPath, { readOnly: true });
}
function discoverSources() {
  return DEFAULT_DB_CANDIDATES.map((fn) => fn()).filter((p) => existsSync(p));
}
function defaultSourcePath() {
  return DEFAULT_DB_CANDIDATES[0]?.();
}
function defaultLogger(message) {
  console.error("[dsh-ccswitch-plugin]", message);
}
function scanFailureMessage(err, dbPath) {
  const reason = err?.code ?? err?.name ?? "error";
  const message = err instanceof Error ? err.message : String(err ?? "");
  const detail = /no such table/i.test(message) ? " (no providers table)" : "";
  return `scan failed for ${dbPath}: ${reason}${detail}`;
}
function orderClause(db) {
  const columns = new Set(
    db.prepare("PRAGMA table_info(providers)").all().map((column) => column.name)
  );
  const parts = [];
  if (columns.has("sort_index")) parts.push("COALESCE(sort_index, 999999)");
  if (columns.has("created_at")) parts.push("created_at ASC");
  parts.push("id ASC");
  return parts.join(", ");
}
function scanSource(dbPath, { logger = defaultLogger } = {}) {
  if (!sqliteAvailable()) {
    return { profiles: [], reason: SCAN_REASON.UNSUPPORTED_NODE, dbPath };
  }
  if (typeof dbPath !== "string" || dbPath === "" || !existsSync(dbPath)) {
    return { profiles: [], reason: SCAN_REASON.NOT_INSTALLED, dbPath };
  }
  let db;
  try {
    db = openDb(dbPath);
    const present = new Set(
      db.prepare("PRAGMA table_info(providers)").all().map((column) => column.name)
    );
    const optional = [
      present.has("website_url") ? "website_url" : void 0,
      present.has("category") ? "category" : void 0
    ].filter((column) => column !== void 0);
    const columns = ["id", "name", "settings_config", "is_current", "app_type", ...optional];
    const rows = db.prepare(`SELECT ${columns.join(", ")} FROM providers ORDER BY ${orderClause(db)}`).all();
    const profiles = rows.filter((row) => SUPPORTED_APP_TYPES.includes(row.app_type)).map((row) => extractProfile(row)).filter((profile) => profile !== void 0);
    return { profiles, reason: profiles.length === 0 ? SCAN_REASON.NO_PROFILES : void 0, dbPath };
  } catch (err) {
    logger(scanFailureMessage(err, dbPath));
    return { profiles: [], reason: SCAN_REASON.UNREADABLE, dbPath };
  } finally {
    if (db) db.close();
  }
}

// lib/core/probe.js
var PROBE_TIMEOUT_MS = 8e3;
var MAX_PROBED_MODELS = 100;
var MAX_DETAIL_LENGTH = 200;
var MODELS_FALLBACK_STATUSES = /* @__PURE__ */ new Set([401, 403, 404, 405, 501]);
var MINIMAL_PROMPT = "ping";
var PROBE_REASON = {
  OK: "ok",
  EMPTY: "empty",
  HTTP_ERROR: "http-error",
  TIMEOUT: "timeout",
  NETWORK: "network",
  NO_CREDENTIALS: "no-credentials",
  UNKNOWN: "network"
};
var PROBE_REASONS = new Set(Object.values(PROBE_REASON));
var PROBE_CHECK = {
  MODELS: "models",
  MINIMAL: "minimal",
  NONE: "none"
};
var PROBE_CHECKS = new Set(Object.values(PROBE_CHECK));
function joinUrl(baseURL, path) {
  return `${String(baseURL).replace(/\/+$/, "")}${path}`;
}
function headersFor(profile) {
  const headers = { accept: "application/json" };
  headers.authorization = `Bearer ${profile.apiKey}`;
  if (profile.api === "anthropic-messages") {
    headers["x-api-key"] = profile.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  }
  return headers;
}
function firstModelId(profile) {
  const models = Array.isArray(profile?.models) ? profile.models : [];
  for (const model of models) {
    const id = typeof model === "string" ? model : model?.id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return void 0;
}
function minimalRequestFor(profile, modelId) {
  const headers = { ...headersFor(profile), "content-type": "application/json" };
  if (profile.api === "anthropic-messages") {
    return {
      url: joinUrl(profile.baseURL, "/messages"),
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: modelId,
          max_tokens: 1,
          messages: [{ role: "user", content: MINIMAL_PROMPT }]
        })
      }
    };
  }
  if (profile.api === "openai-responses") {
    return {
      url: joinUrl(profile.baseURL, "/responses"),
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({ model: modelId, input: MINIMAL_PROMPT, max_output_tokens: 1 })
      }
    };
  }
  return {
    url: joinUrl(profile.baseURL, "/chat/completions"),
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: MINIMAL_PROMPT }],
        max_tokens: 1
      })
    }
  };
}
async function probeConnection(profile, options = {}) {
  const startedAt = Date.now();
  const existing = new Set(
    (profile?.models ?? []).map((model) => typeof model === "string" ? model : model?.id).filter((id) => typeof id === "string" && id.length > 0)
  );
  const base = {
    ok: false,
    reason: PROBE_REASON.NO_CREDENTIALS,
    check: PROBE_CHECK.NONE,
    httpStatus: void 0,
    detail: void 0,
    latencyMs: 0,
    modelIds: [],
    discoveredCount: 0,
    addedCount: 0,
    modelCount: existing.size,
    message: "\u7F3A\u5C11 API key \u6216 base URL\uFF0C\u65E0\u6CD5\u6D4B\u8BD5\u8FDE\u63A5"
  };
  if (profile?.apiKey === void 0 || !profile?.baseURL) return base;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : PROBE_TIMEOUT_MS;
  const allowMinimal = options.allowMinimalRequest !== false;
  const doFetch = typeof options.fetchImpl === "function" ? options.fetchImpl : globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let listing;
    try {
      listing = await doFetch(joinUrl(profile.baseURL, "/models"), {
        headers: headersFor(profile),
        signal: controller.signal
      });
    } catch (err) {
      const reason = err?.name === "AbortError" ? PROBE_REASON.TIMEOUT : PROBE_REASON.NETWORK;
      return {
        ...base,
        reason,
        latencyMs: Date.now() - startedAt,
        message: `\u6A21\u578B\u63A2\u6D4B${reason === PROBE_REASON.TIMEOUT ? "\u8D85\u65F6" : "\u7F51\u7EDC\u9519\u8BEF"}\uFF0C\u4FDD\u7559\u6E90\u914D\u7F6E\u7684\u6A21\u578B\u5217\u8868`
      };
    }
    if (listing.ok) {
      const latencyMs = Date.now() - startedAt;
      const payload = await listing.json();
      const ids = extractModelIds(payload);
      if (ids.length === 0) {
        return {
          ...base,
          ok: true,
          reason: PROBE_REASON.EMPTY,
          check: PROBE_CHECK.MODELS,
          httpStatus: listing.status,
          latencyMs,
          message: "\u6A21\u578B\u63A2\u6D4B\u8FD4\u56DE\u7A7A\u5217\u8868\uFF0C\u4FDD\u7559\u6E90\u914D\u7F6E\u7684\u6A21\u578B\u5217\u8868"
        };
      }
      const merged = mergeModels(profile.models, ids);
      return {
        ok: true,
        reason: PROBE_REASON.OK,
        check: PROBE_CHECK.MODELS,
        httpStatus: listing.status,
        detail: void 0,
        latencyMs,
        modelIds: ids,
        discoveredCount: ids.length,
        addedCount: merged.length - (profile.models?.length ?? 0),
        modelCount: merged.length,
        message: `\u6A21\u578B\u63A2\u6D4B\u6210\u529F\uFF1A\u65B0\u589E ${merged.length - (profile.models?.length ?? 0)} \u4E2A\u6A21\u578B\uFF08\u5171 ${merged.length} \u4E2A\uFF09`
      };
    }
    const httpStatus = listing.status;
    const detail = await readErrorDetail(listing);
    const failed = {
      ...base,
      reason: PROBE_REASON.HTTP_ERROR,
      httpStatus,
      detail,
      latencyMs: Date.now() - startedAt,
      message: `\u6A21\u578B\u63A2\u6D4B\u5931\u8D25\uFF08HTTP ${httpStatus}\uFF09\uFF0C\u4FDD\u7559\u6E90\u914D\u7F6E\u7684\u6A21\u578B\u5217\u8868`
    };
    const modelId = firstModelId(profile);
    if (!allowMinimal || !MODELS_FALLBACK_STATUSES.has(httpStatus) || modelId === void 0) {
      return failed;
    }
    try {
      const { url, init } = minimalRequestFor(profile, modelId);
      const minimal = await doFetch(url, { ...init, signal: controller.signal });
      const latencyMs = Date.now() - startedAt;
      if (minimal.ok) {
        return {
          ...base,
          ok: true,
          reason: PROBE_REASON.OK,
          check: PROBE_CHECK.MINIMAL,
          httpStatus: minimal.status,
          detail,
          latencyMs,
          message: `\u6A21\u578B\u5217\u8868\u4E0D\u53EF\u7528\uFF08HTTP ${httpStatus}\uFF09\uFF0C\u6700\u5C0F\u8BF7\u6C42\u9A8C\u8BC1\u8FDE\u901A`
        };
      }
      return {
        ...failed,
        httpStatus: minimal.status,
        detail: await readErrorDetail(minimal) ?? detail,
        latencyMs,
        message: `\u6A21\u578B\u63A2\u6D4B\u5931\u8D25\uFF08HTTP ${minimal.status}\uFF09\uFF0C\u4FDD\u7559\u6E90\u914D\u7F6E\u7684\u6A21\u578B\u5217\u8868`
      };
    } catch {
      return { ...failed, latencyMs: Date.now() - startedAt };
    }
  } finally {
    clearTimeout(timer);
  }
}
async function probeModels(profile, options = {}) {
  const outcome = await probeConnection(profile, { ...options, allowMinimalRequest: false });
  if (outcome.reason === PROBE_REASON.NO_CREDENTIALS) return { profile, warnings: [] };
  if (!outcome.ok || outcome.reason === PROBE_REASON.EMPTY) {
    return { profile, warnings: [outcome.message] };
  }
  const merged = mergeModels(profile.models, outcome.modelIds);
  return {
    profile: { ...profile, models: merged.slice(0, MAX_PROBED_MODELS) },
    warnings: [outcome.message]
  };
}
async function readErrorDetail(response) {
  if (typeof response?.text !== "function") return void 0;
  try {
    return extractDetail(await response.text());
  } catch {
    return void 0;
  }
}
function extractDetail(text) {
  const raw = String(text ?? "").trim();
  if (raw.length === 0) return void 0;
  let candidate;
  try {
    candidate = firstMessage(JSON.parse(raw));
  } catch {
    candidate = firstMessage(jsonSlice(raw)) ?? quotedMessage(raw);
  }
  const flat = String(candidate ?? raw).replace(/\s+/g, " ").trim();
  return flat.length > 0 ? flat.slice(0, MAX_DETAIL_LENGTH) : void 0;
}
function jsonSlice(raw) {
  const start = raw.search(/[[{]/);
  if (start < 0) return void 0;
  try {
    return JSON.parse(raw.slice(start));
  } catch {
    return void 0;
  }
}
function quotedMessage(raw) {
  const match = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return void 0;
  return match[1].replace(
    /\\(.)/g,
    (_, char) => char === "n" || char === "r" || char === "t" ? " " : char
  );
}
function firstMessage(payload) {
  if (typeof payload === "string") return payload;
  if (payload === null || typeof payload !== "object") return void 0;
  const error = payload.error;
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object") {
    for (const key of ["message", "msg", "detail", "code"]) {
      if (typeof error[key] === "string" && error[key].length > 0) return error[key];
    }
  }
  for (const key of ["message", "msg", "detail", "error"]) {
    if (typeof payload[key] === "string" && payload[key].length > 0) return payload[key];
  }
  return void 0;
}
function mergeModels(models, ids) {
  const merged = [...models ?? []];
  const seen = new Set(merged.map((model) => model.id));
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(isKnownModel(id) ? { id, name: displayNameFor(id) } : { id });
  }
  return merged;
}
function extractModelIds(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return list.map((entry) => typeof entry === "string" ? entry : entry?.id).filter((id) => typeof id === "string" && id.length > 0).slice(0, MAX_PROBED_MODELS);
}
function displayNameFor(modelId) {
  return modelId.split(/[-_]/).map((part) => /^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

// src/host/routes.mjs
var API_BASE = "/api/dsh-ccswitch";
var MAX_JSON_BODY_BYTES = 64 * 1024;
var MAX_PROBE_TARGETS = 50;
var SAFE_STATUSES = /* @__PURE__ */ new Set(["new", "update", "updated", "unchanged", "blocked", "failed", "skipped"]);
var SAFE_FAILURE_CODES = new Set(Object.values(IMPORT_FAILURE));
var SAFE_REASONING = /* @__PURE__ */ new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
var SAFE_SCAN_REASONS = new Set(Object.values(SCAN_REASON));
function isLoopbackRequest(request) {
  const address = request.socket?.remoteAddress;
  if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
  const host = request.headers?.host;
  if (typeof host !== "string") return false;
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostUrl.hostname)) return false;
  if (request.headers?.["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers?.origin;
  if (origin === void 0) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}
function publicText(value) {
  return typeof value === "string" ? value.slice(0, 200) : void 0;
}
function publicEndpoint(value) {
  if (typeof value !== "string") return void 0;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return void 0;
  }
}
function publicWarning(value) {
  const text = String(value ?? "");
  if (text.includes("requires_openai_auth")) return "provider requires OpenAI authentication";
  if (text.includes("\u6CA1\u6709 model")) return "model is missing from the source profile";
  if (text.startsWith("unknown reasoning effort")) return "unknown reasoning effort; configure it in DSH";
  if (text.startsWith("reasoning effort")) return "reasoning effort is outside the conservative catalog";
  if (text.includes("\u5DF2\u4FDD\u7559\u6A21\u578B")) return "existing model reasoning settings were preserved";
  if (text.includes("\u5DF2\u4FDD\u7559\u73B0\u6709 route")) return "existing route reasoning was preserved";
  if (text.includes("provider \u952E") || text.includes("\u540C\u540D provider")) return "provider key collision; existing provider was preserved";
  return "source profile contains an import warning";
}
function publicWarnings(value) {
  return Array.isArray(value) ? value.slice(0, 20).map(publicWarning) : [];
}
function publicErrorDetail(value, secrets = []) {
  return redactText(value, secrets) || "import failed";
}
function publicSummary(summary) {
  return {
    profileId: publicText(summary.profileId),
    profileName: publicText(summary.profileName),
    sourceLabel: "CCSwitch",
    providerKey: publicText(summary.providerKey),
    baseURL: publicEndpoint(summary.baseURL),
    api: publicText(summary.api),
    modelCount: Number.isInteger(summary.modelCount) ? summary.modelCount : 0,
    modelIds: Array.isArray(summary.modelIds) ? summary.modelIds.filter((id) => typeof id === "string").slice(0, 100) : [],
    credential: summary.credential === "found" ? "found" : "missing",
    reasoningEffort: SAFE_REASONING.has(summary.reasoningEffort) ? summary.reasoningEffort : void 0,
    status: SAFE_STATUSES.has(summary.status) ? summary.status : "blocked",
    warnings: publicWarnings(summary.warnings),
    // Kept for wire compatibility with consumers that only look for a flag.
    blockedReason: summary.blockedReason ? "source profile is blocked" : void 0,
    // The browser labels the row from the code, not from the Chinese prose the
    // core builds for the log: one row per blocked profile, eight possible
    // reasons. `blockedDetail` carries the variable part (app type, npm name).
    blockedCode: BLOCKED_CODES.has(summary.blockedCode) ? summary.blockedCode : summary.blockedReason ? BLOCKED.UNKNOWN : void 0,
    blockedDetail: publicText(summary.blockedDetail)
  };
}
function publicResult(result, secrets = []) {
  const status = SAFE_STATUSES.has(result?.status) ? result.status : "failed";
  const output = {
    profileId: publicText(result?.profileId),
    profileName: publicText(result?.profileName),
    providerKey: publicText(result?.providerKey),
    status,
    warnings: publicWarnings(result?.warnings)
  };
  if (status === "failed") {
    output.error = publicErrorDetail(result?.error, secrets);
    if (SAFE_FAILURE_CODES.has(result?.errorCode)) output.errorCode = result.errorCode;
  }
  if (status === "blocked") {
    output.error = "profile blocked";
    output.blockedCode = BLOCKED_CODES.has(result?.blockedCode) ? result.blockedCode : BLOCKED.UNKNOWN;
    output.blockedDetail = publicText(result?.blockedDetail);
  }
  if (status === "skipped") output.skipReason = "profile was not selected or is not importable";
  return output;
}
function writeJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer"
  });
  response.end(JSON.stringify(body));
}
async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      request.destroy?.();
      return void 0;
    }
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function defaultScan() {
  const sources = discoverSources();
  if (sources.length === 0) {
    return { profiles: [], reason: SCAN_REASON.NOT_INSTALLED, dbPath: defaultSourcePath() };
  }
  return scanSource(sources[0]);
}
function normalizeScanResult(scanned) {
  if (Array.isArray(scanned)) return { profiles: scanned, reason: void 0, dbPath: void 0 };
  return {
    profiles: Array.isArray(scanned?.profiles) ? scanned.profiles : [],
    reason: scanned?.reason,
    dbPath: scanned?.dbPath
  };
}
var SAME_ORIGIN_HEADER = "x-dsh-ccswitch-origin";
var SAME_ORIGIN_VALUE = "same-origin";
function sameOriginSignals(request) {
  const headers = request.headers ?? {};
  const origin = typeof headers.origin === "string" ? headers.origin.trim() : "";
  const site = typeof headers["sec-fetch-site"] === "string" ? headers["sec-fetch-site"].trim().toLowerCase() : "";
  const marker = typeof headers[SAME_ORIGIN_HEADER] === "string" ? headers[SAME_ORIGIN_HEADER].trim() : "";
  let proof;
  if (origin.length > 0) proof = "origin";
  else if (site === "same-origin") proof = "sec-fetch-site";
  else if (marker === SAME_ORIGIN_VALUE) proof = "marker";
  return { origin, site, marker, proof };
}
function methodFence(request, response, isLoopback, method, { requireSameOrigin = false } = {}) {
  if (!isLoopback(request)) {
    writeJson(response, 403, { error: "forbidden: loopback and same-origin only" });
    return false;
  }
  if (request.method !== method) {
    writeJson(response, 405, { error: "method not allowed" });
    return false;
  }
  if (requireSameOrigin) {
    const { origin, site, marker, proof } = sameOriginSignals(request);
    if (proof === void 0) {
      writeJson(response, 403, {
        error: "forbidden: state-changing requests must come from the app page",
        saw: { origin: origin.length > 0, site: site.length > 0 ? site : null, marker: marker.length > 0 }
      });
      return false;
    }
  }
  return true;
}
function makeRoutes(deps = {}) {
  const scan = deps.scan ?? defaultScan;
  const getProviders = deps.getProviders ?? (async () => ({}));
  const importProfiles2 = deps.importProfiles ?? importProfiles;
  const getCatalogue = deps.getCatalogue ?? (async () => void 0);
  const probe = deps.probe ?? probeConnection;
  const isLoopback = deps.isLoopback ?? isLoopbackRequest;
  const settings = deps.settings;
  const credentials = deps.credentials;
  return [
    {
      kind: "exact",
      path: `${API_BASE}/scan`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, "GET")) return;
        try {
          const { profiles, reason, dbPath } = normalizeScanResult(await scan());
          const [route, catalogue] = await Promise.all([getProviders(), getCatalogue()]);
          const classified = catalogue === void 0 ? classifyProfiles(profiles, route) : classifyProfiles(profiles, route, catalogue);
          const body = { profiles: classified.map((item) => publicSummary(item.summary)) };
          if (SAFE_SCAN_REASONS.has(reason)) {
            body.source = reason;
            if (reason === SCAN_REASON.NOT_INSTALLED) body.probedPath = publicText(dbPath);
          }
          writeJson(response, 200, body);
        } catch {
          writeJson(response, 500, { error: "scan failed" });
        }
      }
    },
    {
      kind: "exact",
      path: `${API_BASE}/import`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, "POST", { requireSameOrigin: true })) return;
        const body = await readJsonBody(request);
        if (!body || !Array.isArray(body.profileIds) || body.profileIds.some((id) => typeof id !== "string")) {
          writeJson(response, 400, { error: "body must be { profileIds: string[], expectedRevision?: number, probe?: boolean }" });
          return;
        }
        if (body.expectedRevision !== void 0 && (typeof body.expectedRevision !== "number" || !Number.isInteger(body.expectedRevision))) {
          writeJson(response, 400, { error: "expectedRevision must be an integer" });
          return;
        }
        let knownSecrets = [];
        try {
          let profiles = normalizeScanResult(await scan()).profiles;
          if (body.probe === true) {
            const selected = new Set(body.profileIds);
            const probed = await Promise.all(
              profiles.filter((profile) => !profile.skipped && !profile.blocked && selected.has(profile.profileId)).map((profile) => probeModels(profile))
            );
            const probedById = new Map(probed.map((entry) => [entry.profile.profileId, entry]));
            profiles = profiles.map((profile) => {
              const entry = probedById.get(profile.profileId);
              return entry ? { ...profile, models: entry.profile.models, warnings: [...profile.warnings ?? [], ...entry.warnings] } : profile;
            });
          }
          const secretByProfileId = /* @__PURE__ */ new Map();
          for (const profile of profiles) {
            if (typeof profile.apiKey === "string" && profile.apiKey.length > 0) {
              secretByProfileId.set(profile.profileId, profile.apiKey);
            }
          }
          knownSecrets = [...secretByProfileId.values()];
          const results = await importProfiles2({
            profiles,
            selectedIds: body.profileIds,
            settings,
            credentials,
            expectedRevision: body.expectedRevision
          });
          writeJson(response, 200, { results: results.map((result) => publicResult(result, knownSecretsFor(result, secretByProfileId))) });
        } catch (err) {
          const label = err instanceof Error ? err.name : typeof err;
          console.error("[dsh-ccswitch-plugin] import failed:", `${label}: ${redactText(err, knownSecrets)}`);
          writeJson(response, 500, { error: "import failed" });
        }
      }
    },
    {
      kind: "exact",
      path: `${API_BASE}/probe`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, "POST", { requireSameOrigin: true })) return;
        const body = await readJsonBody(request);
        if (!body || !Array.isArray(body.profileIds) || body.profileIds.some((id) => typeof id !== "string")) {
          writeJson(response, 400, { error: "body must be { profileIds: string[] }" });
          return;
        }
        let knownSecrets = [];
        try {
          const profiles = normalizeScanResult(await scan()).profiles;
          const selected = new Set(body.profileIds);
          const targets = profiles.filter((profile) => !profile.skipped && !profile.blocked && selected.has(profile.profileId)).slice(0, MAX_PROBE_TARGETS);
          knownSecrets = targets.map((profile) => profile.apiKey).filter((key) => typeof key === "string" && key.length > 0);
          const results = await Promise.all(targets.map(async (profile) => {
            const outcome = await probe(profile);
            const detail = redactText(outcome?.detail, knownSecrets);
            return {
              profileId: publicText(profile.profileId),
              profileName: publicText(profile.profileName),
              ok: outcome?.ok === true,
              reason: PROBE_REASONS.has(outcome?.reason) ? outcome.reason : PROBE_REASON.NETWORK,
              check: PROBE_CHECKS.has(outcome?.check) ? outcome.check : PROBE_CHECK.NONE,
              httpStatus: Number.isInteger(outcome?.httpStatus) ? outcome.httpStatus : void 0,
              detail: detail ? detail.slice(0, 200) : void 0,
              latencyMs: Number.isInteger(outcome?.latencyMs) ? Math.min(Math.max(outcome.latencyMs, 0), 6e5) : 0,
              discoveredCount: probeCount(outcome?.discoveredCount),
              addedCount: probeCount(outcome?.addedCount),
              modelCount: probeCount(outcome?.modelCount),
              message: redactText(outcome?.message, knownSecrets) || "probe returned no detail"
            };
          }));
          writeJson(response, 200, { results });
        } catch (err) {
          const label = err instanceof Error ? err.name : typeof err;
          console.error("[dsh-ccswitch-plugin] probe failed:", `${label}: ${redactText(err, knownSecrets)}`);
          writeJson(response, 500, { error: "probe failed" });
        }
      }
    }
  ];
}
function probeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
function knownSecretsFor(result, secretByProfileId) {
  const own = secretByProfileId.get(result?.profileId);
  return typeof own === "string" ? [own] : [];
}

// src/host/writers.js
import { createHash as createHash3 } from "node:crypto";
import { mkdir as mkdir2, readFile as readFile2, rm as rm2, writeFile as writeFile2 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { basename, dirname as dirname2, join as join2, resolve } from "node:path";
var WRITER_APP_TYPES = Object.freeze(["claude", "codex"]);
var WriterError = class extends Error {
  constructor(message, { kind = "parse", path, line, column, profile, key } = {}) {
    super(message);
    this.name = "WriterError";
    this.kind = kind;
    if (path !== void 0) this.path = path;
    if (line !== void 0) this.line = line;
    if (column !== void 0) this.column = column;
    if (profile !== void 0) this.profile = profile;
    if (key !== void 0) this.key = key;
  }
};
var CLAUDE_FLOOR_TOP = /* @__PURE__ */ new Set([
  "apiKeyHelper",
  "apiBaseUrl",
  "primaryModel",
  "smallFastModel",
  // The legacy Bedrock API-key preset wrote the real key here.
  "apiKey",
  // `/model`: the choice belongs to the provider that was active when it was made.
  "model",
  // Fallback chain; model id → provider-specific id (a Bedrock ARN, say).
  "fallbackModel",
  "modelOverrides",
  // The `/model` picker rows; in aggregate mode these are CC Switch Stack models.
  "modelPicker",
  // advisor is only available on the Anthropic API.
  "advisorModel",
  // Bedrock / Vertex credential commands.
  "awsAuthRefresh",
  "awsCredentialExport",
  "gcpAuthRefresh"
]);
var CLAUDE_FLOOR_ENV_PREFIXES = ["ANTHROPIC_", "AWS_", "VERTEX_REGION_"];
var CLAUDE_FLOOR_ENV_KEYS = /* @__PURE__ */ new Set([
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL_FORCE",
  "CLOUD_ML_REGION",
  // Vertex credential path.
  "GOOGLE_APPLICATION_CREDENTIALS",
  // Subscription-account long-lived token and its companions.
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
  "CLAUDE_CODE_OAUTH_SCOPES",
  // Pairs with the top-level apiKeyHelper.
  "CLAUDE_CODE_API_KEY_HELPER_TTL_MS"
]);
var CLAUDE_PROTOCOL_SELECTORS = /* @__PURE__ */ new Set([
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_GATEWAY",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD"
]);
function isClaudeFloorEnv(key) {
  return CLAUDE_FLOOR_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)) || CLAUDE_PROTOCOL_SELECTORS.has(key) || CLAUDE_FLOOR_ENV_KEYS.has(key) || key.startsWith("CLAUDE_CODE_SKIP_") && key.endsWith("_AUTH");
}
var CLAUDE_RESIDUE_ENV = Object.freeze([
  ["CLAUDE_CODE_MAX_CONTEXT_TOKENS", ["262144", "372000", "983616"]],
  ["CLAUDE_CODE_AUTO_COMPACT_WINDOW", ["262144", "372000", "1000000"]],
  ["CLAUDE_CODE_MAX_OUTPUT_TOKENS", ["131072"]]
]);
function residueValues(values) {
  const spellings = [];
  for (const value of values) {
    spellings.push(value);
    if (/^\d+$/.test(value)) spellings.push(Number(value));
  }
  return spellings;
}
var CODEX_ROUTE_ID = "custom";
var CODEX_BUILT_IN_IDS = Object.freeze([
  "amazon-bedrock",
  "amazon-bedrock-runtime",
  "openai",
  "ollama",
  "lmstudio"
]);
var CODEX_RESERVED_TABLE_IDS = Object.freeze(["openai", "ollama", "lmstudio"]);
var CODEX_LEGACY_REROUTE_ID = "cc-switch";
var CODEX_PROXY_TOKEN_PLACEHOLDER = "PROXY_MANAGED";
var CODEX_PROFILE_KEY = "profile";
var CODEX_PROFILE_ROUTE_KEYS = Object.freeze([
  "model_provider",
  "openai_base_url",
  "experimental_bearer_token"
]);
var CODEX_CATALOG_FILENAME = "cc-switch-model-catalog.json";
var CODEX_CATALOG_KEY = "model_catalog_json";
var LOCK_WAIT_MS = 5e3;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireApiKey(apiKey) {
  if (typeof apiKey !== "string" || apiKey === "") {
    throw new WriterError("refusing to write a configuration with no credential", {
      kind: "credential"
    });
  }
  return apiKey;
}
var atomicWriteModule;
async function loadAtomicWrite() {
  if (atomicWriteModule === void 0) {
    try {
      atomicWriteModule = await Promise.resolve().then(() => (init_lib(), lib_exports));
    } catch {
      atomicWriteModule = null;
    }
  }
  return atomicWriteModule;
}
async function readBytesIfExists(path) {
  try {
    return await readFile2(path);
  } catch (err) {
    if (err?.code === "ENOENT") return void 0;
    throw err;
  }
}
async function replaceFile(path, content, mode) {
  const atomic = await loadAtomicWrite();
  if (atomic !== null) {
    await atomic.writeFileAtomic(path, content, { mode, dirMode: 448 });
    return;
  }
  await mkdir2(dirname2(path), { recursive: true, mode: 448 });
  await writeFile2(path, content, { mode });
}
var defaultIo = { read: readBytesIfExists, write: replaceFile };
async function withWriterLock(path, operation) {
  const atomic = await loadAtomicWrite();
  await mkdir2(dirname2(path), { recursive: true, mode: 448 });
  if (atomic === null) return operation();
  return atomic.withFileLock(path, operation, { waitMs: LOCK_WAIT_MS });
}
var DEVICE_DIR = ".dsh-ccswitch-plugin";
function defaultBackupRoot(home) {
  return join2(home ?? homedir2(), DEVICE_DIR, "backups", "live-first-write");
}
async function ensureFirstWriteBackup(path, current, backupRoot, fileIo) {
  const absolute = resolve(path);
  const key = createHash3("sha256").update(absolute).digest("hex").slice(0, 12);
  const backup = join2(backupRoot, `${key}-${basename(absolute)}`);
  const marker = `${backup}.source`;
  if (await fileIo.read(marker) !== void 0) return;
  await mkdir2(backupRoot, { recursive: true, mode: 448 });
  if (current !== void 0) await fileIo.write(backup, current, 384);
  await fileIo.write(marker, absolute, 384);
}
var DEFAULT_INDENT = "  ";
function detectIndent(text) {
  const lines = text.split("\n");
  for (let index = 1; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const content = line.trimStart();
    if (content === "") continue;
    const leading = line.slice(0, line.length - content.length);
    if (leading === "") continue;
    if (/^ +$/.test(leading) || /^\t+$/.test(leading)) return leading;
  }
  return void 0;
}
function jsonErrorLocation(message, text) {
  const explicit = /\(line (\d+) column (\d+)\)/.exec(message);
  if (explicit !== null) return { line: Number(explicit[1]), column: Number(explicit[2]) };
  const position = /at position (\d+)/.exec(message);
  if (position !== null) {
    const offset = Math.max(0, Number(position[1]));
    const before = text.slice(0, offset);
    return { line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
  }
  return { line: 1, column: 1 };
}
function parseJsonDocument(raw, path) {
  if (raw === void 0) return { doc: {}, style: defaultStyle() };
  const text = raw.toString("utf8");
  const bom = text.startsWith("\uFEFF");
  const body = bom ? text.slice(1) : text;
  if (body.trim() === "") return { doc: {}, style: { ...defaultStyle(), bom } };
  let doc;
  try {
    doc = JSON.parse(body);
  } catch (err) {
    const { line, column } = jsonErrorLocation(String(err?.message ?? ""), body);
    throw new WriterError(
      `${path} is not valid JSON (line ${line} column ${column}); refusing to overwrite it`,
      { kind: "parse", path, line, column }
    );
  }
  if (!isRecord(doc)) {
    throw new WriterError(
      `${path} does not contain a JSON object at the top level; refusing to overwrite it`,
      { kind: "shape", path, line: 1, column: 1 }
    );
  }
  return {
    doc,
    style: {
      indent: detectIndent(body) ?? DEFAULT_INDENT,
      trailingNewline: body.endsWith("\n"),
      crlf: body.includes("\r\n"),
      bom
    }
  };
}
function defaultStyle() {
  return { indent: DEFAULT_INDENT, trailingNewline: false, crlf: false, bom: false };
}
function serializeJson(doc, style) {
  let text = JSON.stringify(doc, null, style.indent);
  if (style.crlf) text = text.replace(/\n/g, "\r\n");
  if (style.trailingNewline) text += style.crlf ? "\r\n" : "\n";
  return style.bom ? `\uFEFF${text}` : text;
}
function primaryModelId(provider) {
  const models = Array.isArray(provider?.models) ? provider.models : [];
  const found = models.find((model) => typeof model?.id === "string" && model.id.trim() !== "");
  return found === void 0 ? void 0 : found.id.trim();
}
function claudeProjection(provider, apiKey) {
  const env = {
    ANTHROPIC_BASE_URL: String(provider?.baseURL ?? ""),
    // cc-switch prefers ANTHROPIC_AUTH_TOKEN and only uses ANTHROPIC_API_KEY
    // when the source row used that name, which this shape does not track.
    // Writing both would provoke Claude Code's "Both ANTHROPIC_AUTH_TOKEN and
    // ANTHROPIC_API_KEY set" warning.
    ANTHROPIC_AUTH_TOKEN: apiKey
  };
  const model = primaryModelId(provider);
  if (model !== void 0) env.ANTHROPIC_MODEL = model;
  const exclusive = claudeExclusiveEnvOf(provider);
  for (const [key, value] of Object.entries(exclusive)) env[key] = value;
  return { top: {}, env, exclusive };
}
function applyClaudePatch(doc, top, env, path, outgoingExclusive = {}) {
  if (doc.env !== void 0 && !isRecord(doc.env)) {
    throw new WriterError(
      `${path} has a non-object "env" member; refusing to overwrite it`,
      { kind: "shape", path }
    );
  }
  const topTargets = new Set(Object.keys(top));
  const envTargets = new Set(Object.keys(env));
  const removed = [];
  for (const key of Object.keys(doc)) {
    if (CLAUDE_FLOOR_TOP.has(key) && !topTargets.has(key)) {
      delete doc[key];
      removed.push(key);
    }
  }
  for (const key of Object.keys(doc.env ?? {})) {
    if (isClaudeFloorEnv(key) && !envTargets.has(key)) {
      delete doc.env[key];
      removed.push(`env.${key}`);
    }
  }
  for (const [key, values] of CLAUDE_RESIDUE_ENV) {
    if (envTargets.has(key)) continue;
    const current = doc.env?.[key];
    if (current === void 0) continue;
    if (!residueValues(values).includes(current)) continue;
    delete doc.env[key];
    removed.push(`env.${key}`);
  }
  for (const [key, value] of Object.entries(outgoingExclusive)) {
    if (envTargets.has(key)) continue;
    const current = doc.env?.[key];
    if (current === void 0) continue;
    if (current !== value) continue;
    delete doc.env[key];
    removed.push(`env.${key}`);
  }
  for (const [key, value] of Object.entries(top)) doc[key] = value;
  if (envTargets.size > 0) {
    if (!isRecord(doc.env)) doc.env = {};
    for (const [key, value] of Object.entries(env)) doc.env[key] = value;
  }
  return removed;
}
function scanLine(line, state) {
  let index = 0;
  if (state.multiline !== null) {
    const close = line.indexOf(state.multiline);
    if (close === -1) return;
    index = close + 3;
    state.multiline = null;
  }
  while (index < line.length) {
    const char = line[index];
    if (char === "#") return;
    if (char === '"' || char === "'") {
      if (line.slice(index, index + 3) === char.repeat(3)) {
        const close2 = line.indexOf(char.repeat(3), index + 3);
        if (close2 === -1) {
          state.multiline = char.repeat(3);
          return;
        }
        index = close2 + 3;
        continue;
      }
      if (char === '"') {
        let at = index + 1;
        while (at < line.length && line[at] !== '"') {
          at += line[at] === "\\" ? 2 : 1;
        }
        if (at >= line.length) {
          state.unterminated = true;
          return;
        }
        index = at + 1;
        continue;
      }
      const close = line.indexOf("'", index + 1);
      if (close === -1) {
        state.unterminated = true;
        return;
      }
      index = close + 1;
      continue;
    }
    if (char === "[") state.arrays += 1;
    else if (char === "]") state.arrays = Math.max(0, state.arrays - 1);
    index += 1;
  }
}
function sectionNameOf(line) {
  const match = /^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/.exec(line);
  if (match === null) return void 0;
  return match[1].split(".").map((segment) => unquoteKey(segment.trim())).join(".");
}
function unquoteKey(raw) {
  if (raw.length >= 2) {
    const first = raw[0];
    if ((first === '"' || first === "'") && raw[raw.length - 1] === first) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}
function keyOf(line) {
  const match = /^\s*([A-Za-z0-9_-]+|"[^"]*"|'[^']*')\s*=/.exec(line);
  return match === null ? void 0 : unquoteKey(match[1]);
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : void 0;
}
function codexProviderIds(structure) {
  const ids = /* @__PURE__ */ new Set();
  for (const name2 of structure.ranges.keys()) {
    const parts = name2.split(".");
    if (parts.length === 2 && parts[0] === "model_providers") ids.add(parts[1]);
  }
  for (const name2 of structure.values.keys()) {
    const parts = name2.split(".");
    if (parts.length >= 3 && parts[0] === "model_providers") ids.add(parts[1]);
  }
  return ids;
}
function repairReservedCodexTables(lines, structure) {
  const renames = /* @__PURE__ */ new Map();
  const drops = [];
  const removed = [];
  const taken = codexProviderIds(structure);
  for (const id of CODEX_RESERVED_TABLE_IDS) {
    const section = `model_providers.${id}`;
    const range = structure.ranges.get(section);
    if (range === void 0) continue;
    if (structure.arrays.has(section)) continue;
    const token = structure.values.get(`${section}.experimental_bearer_token`);
    if (token === CODEX_PROXY_TOKEN_PLACEHOLDER) {
      drops.push(range);
      removed.push(section);
      continue;
    }
    taken.delete(id);
    const renamed = firstFreeCodexTableId(taken, CODEX_LEGACY_REROUTE_ID);
    taken.add(renamed);
    renames.set(range.start, `model_providers.${renamed}`);
    removed.push(`${section} -> model_providers.${renamed}`);
  }
  if (renames.size === 0 && drops.length === 0) return null;
  const dropped = /* @__PURE__ */ new Set();
  for (const range of drops) {
    for (let index = range.start; index < range.end; index += 1) dropped.add(index);
  }
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (dropped.has(index)) continue;
    const renamed = renames.get(index);
    if (renamed === void 0) {
      out.push(lines[index]);
      continue;
    }
    out.push(renameSectionHeader(lines[index], renamed));
  }
  return { lines: out, removed };
}
function renameSectionHeader(line, name2) {
  const match = /^(\s*)(\[\[?)([^\]]+)(\]\]?)(\s*(?:#.*)?)$/.exec(line);
  if (match === null) return line;
  return `${match[1]}${match[2]}${name2}${match[4]}${match[5]}`;
}
function checkCodexEffectiveRoute(text, routeId) {
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const { values } = scanStructure(lines);
  const name2 = nonEmptyString(values.get(CODEX_PROFILE_KEY));
  if (name2 === void 0) return;
  const overridden = CODEX_PROFILE_ROUTE_KEYS.find((key) => {
    const value = values.get(`profiles.${name2}.${key}`);
    if (value === void 0) return false;
    if (value === UNREADABLE_TOML_VALUE) return true;
    const text2 = nonEmptyString(value);
    if (text2 === void 0) return false;
    if (key === "model_provider") return text2 !== routeId;
    return true;
  });
  if (overridden === void 0) return;
  throw new WriterError(
    `the active Codex profile "${name2}" ([profiles.${name2}]) sets ${overridden}, so requests would keep following it instead of the target provider. Remove ${overridden} from that profile or change the top-level profile; nothing was written`,
    { kind: "route", profile: name2, key: overridden }
  );
}
function commentStart(text) {
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "#") return index;
    if (char === '"' || char === "'") {
      if (text.slice(index, index + 3) === char.repeat(3)) {
        const close2 = text.indexOf(char.repeat(3), index + 3);
        if (close2 === -1) return -1;
        index = close2 + 3;
        continue;
      }
      if (char === '"') {
        let at = index + 1;
        while (at < text.length && text[at] !== '"') at += text[at] === "\\" ? 2 : 1;
        if (at >= text.length) return -1;
        index = at + 1;
        continue;
      }
      const close = text.indexOf("'", index + 1);
      if (close === -1) return -1;
      index = close + 1;
      continue;
    }
    index += 1;
  }
  return -1;
}
function valueSuffix(text) {
  const at = commentStart(text);
  if (at === -1) return "";
  let start = at;
  while (start > 0 && (text[start - 1] === " " || text[start - 1] === "	")) start -= 1;
  return text.slice(start);
}
function tomlString(value) {
  return JSON.stringify(String(value));
}
function reasoningEffortOf(provider) {
  for (const candidate of [provider?.modelReasoningEffort, provider?.reasoning]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
  }
  return void 0;
}
function hasCredentialLoginMaterial(auth) {
  if (!isRecord(auth)) return false;
  const present = (value) => {
    if (value === null || value === void 0) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    if (isRecord(value)) return Object.keys(value).length > 0;
    return true;
  };
  if (["personal_access_token", "agent_identity", "bedrock_api_key"].some((key) => present(auth[key]))) {
    return true;
  }
  const tokens = auth.tokens;
  if (!isRecord(tokens)) return false;
  return ["id_token", "access_token", "refresh_token"].some((key) => present(tokens[key]));
}
function isBuiltInCodexId(id) {
  return CODEX_BUILT_IN_IDS.includes(id);
}
function isReservedCodexId(id) {
  return CODEX_RESERVED_TABLE_IDS.includes(id);
}
function firstFreeCodexTableId(taken, base) {
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}
function codexRouteId() {
  if (!isBuiltInCodexId(CODEX_ROUTE_ID) && !isReservedCodexId(CODEX_ROUTE_ID)) return CODEX_ROUTE_ID;
  return firstFreeCodexTableId(new Set(CODEX_BUILT_IN_IDS), CODEX_ROUTE_ID);
}
function isCcSwitchCatalog(value) {
  if (typeof value !== "string" || value === "") return false;
  const name2 = value.split(/[\\/]/).pop();
  return name2 === CODEX_CATALOG_FILENAME;
}
function hasStaleCatalogPointer(structure) {
  return isCcSwitchCatalog(structure.values.get(CODEX_CATALOG_KEY));
}
function codexTomlEdits(provider, apiKey, requiresOpenaiAuth, routeId) {
  const edits = [];
  const routeSection = `model_providers.${routeId}`;
  const model = primaryModelId(provider);
  if (model !== void 0) {
    edits.push({ section: null, key: "model", literal: tomlString(model) });
  }
  edits.push({ section: null, key: "model_provider", literal: tomlString(routeId) });
  const effort = reasoningEffortOf(provider);
  edits.push({
    section: null,
    key: "model_reasoning_effort",
    literal: effort === void 0 ? null : tomlString(effort)
  });
  edits.push(
    { section: routeSection, key: "name", literal: tomlString(provider?.displayName ?? "") },
    { section: routeSection, key: "base_url", literal: tomlString(provider?.baseURL ?? "") },
    {
      section: routeSection,
      key: "wire_api",
      literal: tomlString(provider?.api === "openai-responses" ? "responses" : "chat")
    },
    { section: routeSection, key: "experimental_bearer_token", literal: tomlString(apiKey) },
    {
      section: routeSection,
      key: "requires_openai_auth",
      literal: requiresOpenaiAuth ? "true" : "false"
    }
  );
  return edits;
}
function scanStructure(lines) {
  const sectionAt = [];
  const headers = /* @__PURE__ */ new Map();
  const values = /* @__PURE__ */ new Map();
  const arrays = /* @__PURE__ */ new Set();
  const state = { multiline: null, arrays: 0, unterminated: false };
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    sectionAt.push(current);
    if (state.multiline === null && state.arrays === 0) {
      const name2 = sectionNameOf(lines[index]);
      if (name2 !== void 0) {
        if (!headers.has(name2)) headers.set(name2, index);
        if (/^\s*\[\[/.test(lines[index])) arrays.add(name2);
        current = name2;
        continue;
      }
      const key = keyOf(lines[index]);
      if (key !== void 0 && !state.unterminated) {
        const value = parseTomlLiteral(lines[index]);
        values.set(
          current === null ? key : `${current}.${key}`,
          value === void 0 ? UNREADABLE_TOML_VALUE : value
        );
      }
    }
    scanLine(lines[index], state);
  }
  const starts = [...headers.values()].sort((left, right) => left - right);
  const endOf = (start) => starts.find((candidate) => candidate > start) ?? lines.length;
  const ranges = new Map([...headers].map(([name2, start]) => [name2, { start, end: endOf(start) }]));
  return { sectionAt, headers, ranges, values, arrays, unterminated: state.unterminated };
}
function parseTomlLiteral(line) {
  const eq = line.indexOf("=");
  if (eq === -1) return void 0;
  const raw = line.slice(eq + 1);
  const at = commentStart(raw);
  const body = (at === -1 ? raw : raw.slice(0, at)).trim();
  if (body === "") return void 0;
  if (body.startsWith('"') || body.startsWith("'")) {
    const quote = body[0];
    if (body.length < 2 || body[body.length - 1] !== quote) return void 0;
    const inner = body.slice(1, -1);
    if (quote === "'") return inner;
    try {
      return JSON.parse(body);
    } catch {
      return inner;
    }
  }
  if (body === "true") return true;
  if (body === "false") return false;
  if (/^[+-]?\d+$/.test(body)) return Number(body);
  if (body.startsWith("{") && body.endsWith("}")) {
    return parseInlineTable(body.slice(1, -1));
  }
  return void 0;
}
function parseInlineTable(body) {
  const members = {};
  let depth = 0;
  let start = 0;
  const parts = [];
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '"' || char === "'") {
      const close = body.indexOf(char, index + 1);
      if (close === -1) return void 0;
      index = close;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = unquoteKey(part.slice(0, eq).trim());
    if (key === "") continue;
    const value = parseTomlLiteral(`x = ${part.slice(eq + 1)}`);
    members[key] = value === void 0 ? UNREADABLE_TOML_VALUE : value;
  }
  return members;
}
var UNREADABLE_TOML_VALUE = Symbol("unreadable-toml-value");
function patchCodexToml(text, provider, { apiKey, requiresOpenaiAuth, trailingNewline } = {}) {
  const endsWithNewline = trailingNewline ?? text.endsWith("\n");
  const original = text === "" ? [] : (endsWithNewline ? text.slice(0, -1) : text).split("\n");
  let structure = scanStructure(original);
  if (structure.unterminated) {
    throw new WriterError(
      "config.toml contains an unterminated string; refusing to overwrite it",
      { kind: "shape" }
    );
  }
  const repaired = repairReservedCodexTables(original, structure);
  let lines = original;
  const removed = [];
  if (repaired !== null) {
    lines = repaired.lines;
    removed.push(...repaired.removed);
    structure = scanStructure(lines);
  }
  const { sectionAt, headers, ranges } = structure;
  const routeId = codexRouteId();
  const routeSection = `model_providers.${routeId}`;
  const replacements = /* @__PURE__ */ new Map();
  const removals = /* @__PURE__ */ new Set();
  const pending = [];
  const written = [];
  if (hasStaleCatalogPointer(structure)) {
    const at = lines.findIndex((line, index) => sectionAt[index] === null && keyOf(line) === CODEX_CATALOG_KEY);
    if (at !== -1) {
      removals.add(at);
      removed.push(CODEX_CATALOG_KEY);
    }
  }
  for (const edit of codexTomlEdits(provider, apiKey, requiresOpenaiAuth, routeId)) {
    const label = edit.section === null ? edit.key : `${edit.section}.${edit.key}`;
    let found = -1;
    for (let index = 0; index < lines.length; index += 1) {
      if (sectionAt[index] !== edit.section) continue;
      if (keyOf(lines[index]) !== edit.key) continue;
      found = index;
      break;
    }
    if (found === -1) {
      pending.push(edit);
      continue;
    }
    if (edit.literal === null) {
      removals.add(found);
      removed.push(label);
      continue;
    }
    const line = lines[found];
    const indent = /^\s*/.exec(line)[0];
    const suffix = valueSuffix(line.slice(line.indexOf("=") + 1));
    replacements.set(found, `${indent}${edit.key} = ${edit.literal}${suffix}`);
    written.push(label);
  }
  if (pending.some((edit) => edit.section === routeSection) && !headers.has(routeSection)) {
    const inlineRoute = ranges.has("model_providers") && lines.slice(ranges.get("model_providers").start, ranges.get("model_providers").end).some((line) => keyOf(line) === routeId);
    if (inlineRoute) {
      throw new WriterError(
        `config.toml defines model_providers.${routeId} inline; refusing to rewrite it`,
        { kind: "shape" }
      );
    }
  }
  const firstHeader = headers.size === 0 ? lines.length : Math.min(...[...headers.values()]);
  const insertAfterLastContent = (end, floor) => {
    let at = end;
    while (at > floor && lines[at - 1] !== void 0 && lines[at - 1].trim() === "") at -= 1;
    return at;
  };
  const firstHeaderAt = insertAfterLastContent(firstHeader, 0);
  const insertions = /* @__PURE__ */ new Map();
  const blockAt = (index) => {
    if (!insertions.has(index)) insertions.set(index, { lines: [], blankBefore: false });
    return insertions.get(index);
  };
  let appendedHeader = false;
  for (const edit of pending) {
    if (edit.literal === null) continue;
    const label = edit.section === null ? edit.key : `${edit.section}.${edit.key}`;
    if (edit.section === null) {
      blockAt(firstHeaderAt).lines.push(`${edit.key} = ${edit.literal}`);
      written.push(label);
      continue;
    }
    const range = ranges.get(edit.section);
    if (range !== void 0) {
      blockAt(insertAfterLastContent(range.end, range.start + 1)).lines.push(`${edit.key} = ${edit.literal}`);
      written.push(label);
      continue;
    }
    const block = blockAt(lines.length);
    if (!appendedHeader) {
      block.lines.push(`[${edit.section}]`);
      block.blankBefore = true;
      appendedHeader = true;
    }
    block.lines.push(`${edit.key} = ${edit.literal}`);
    written.push(label);
  }
  const out = [];
  for (let index = 0; index <= lines.length; index += 1) {
    const block = insertions.get(index);
    if (block !== void 0) {
      if (block.blankBefore && out.length > 0 && out[out.length - 1].trim() !== "") out.push("");
      out.push(...block.lines);
    }
    if (index === lines.length) break;
    if (removals.has(index)) continue;
    out.push(replacements.has(index) ? replacements.get(index) : lines[index]);
  }
  const next = `${out.join("\n")}${endsWithNewline ? "\n" : ""}`;
  verifyCodexToml(next, provider, { apiKey, requiresOpenaiAuth, routeId });
  checkCodexEffectiveRoute(next, routeId);
  return { text: next, written, removed };
}
function verifyCodexToml(text, provider, { apiKey, requiresOpenaiAuth, routeId = CODEX_ROUTE_ID } = {}) {
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const routeSection = `model_providers.${routeId}`;
  const seen = /* @__PURE__ */ new Set();
  for (const line of lines) {
    const name2 = sectionNameOf(line);
    if (name2 === void 0) continue;
    if (seen.has(name2)) {
      throw new WriterError(
        `patching config.toml would duplicate the [${name2}] table; refusing to write it`,
        { kind: "shape" }
      );
    }
    seen.add(name2);
  }
  const refuse = (label) => {
    throw new WriterError(
      `config.toml did not take "${label}"; refusing to write it`,
      { kind: "shape" }
    );
  };
  const expect = (label, actual, wanted) => {
    if (wanted !== void 0 && actual !== wanted) refuse(label);
  };
  const parsed = parseCodexToml(text);
  const model = primaryModelId(provider);
  if (model !== void 0) expect("model", parsed.model, model);
  const effort = reasoningEffortOf(provider);
  if (effort === void 0) {
    if (parsed.reasoningEffort !== void 0) refuse("model_reasoning_effort");
  } else {
    expect("model_reasoning_effort", parsed.reasoningEffort, effort);
  }
  if (parsed.provider === null) refuse(routeSection);
  expect("base_url", parsed.provider.baseUrl, String(provider?.baseURL ?? ""));
  expect("name", parsed.provider.name, String(provider?.displayName ?? ""));
  expect("wire_api", parsed.provider.wireApi, provider?.api === "openai-responses" ? "responses" : "chat");
  expect("requires_openai_auth", parsed.provider.requiresOpenaiAuth, requiresOpenaiAuth);
  const wantedToken = tomlString(apiKey);
  let inRoute = false;
  let tokenFound = false;
  for (const line of lines) {
    const name2 = sectionNameOf(line);
    if (name2 !== void 0) {
      inRoute = name2 === routeSection;
      continue;
    }
    if (!inRoute || keyOf(line) !== "experimental_bearer_token") continue;
    const raw = line.slice(line.indexOf("=") + 1);
    const at = commentStart(raw);
    if ((at === -1 ? raw : raw.slice(0, at)).trim() !== wantedToken) {
      refuse("experimental_bearer_token");
    }
    tokenFound = true;
  }
  if (!tokenFound) refuse("experimental_bearer_token");
}
function protocolWarnings(appType, provider) {
  const api = String(provider?.api ?? "");
  if (appType === "claude" && api !== "anthropic-messages") {
    return [`provider api "${api}" is not anthropic-messages, but Claude Code speaks the Anthropic protocol`];
  }
  if (appType === "codex" && api === "anthropic-messages") {
    return ["provider api is anthropic-messages, which Codex cannot speak; the route will not work"];
  }
  return [];
}
async function writeClaudeConfig({ provider, apiKey, home, io, backupRoot, previous } = {}) {
  const key = requireApiKey(apiKey);
  const path = join2(home ?? homedir2(), ".claude", "settings.json");
  const fileIo = io ?? defaultIo;
  const backups = backupRoot ?? defaultBackupRoot(home);
  return withWriterLock(path, async () => {
    const raw = await fileIo.read(path);
    const { doc, style } = parseJsonDocument(raw, path);
    const { top, env } = claudeProjection(provider, key);
    const removed = applyClaudePatch(doc, top, env, path, claudeExclusiveEnvOf(previous));
    await ensureFirstWriteBackup(path, raw, backups, fileIo);
    await fileIo.write(path, serializeJson(doc, style), 384);
    return {
      files: [{
        path,
        keys: [...Object.keys(top), ...Object.keys(env).map((key2) => `env.${key2}`)],
        removed
      }],
      warnings: protocolWarnings("claude", provider)
    };
  });
}
async function writeCodexConfig({ provider, apiKey, home, io, backupRoot } = {}) {
  const key = requireApiKey(apiKey);
  const directory = join2(home ?? homedir2(), ".codex");
  const authPath = join2(directory, "auth.json");
  const configPath = join2(directory, "config.toml");
  const fileIo = io ?? defaultIo;
  const backups = backupRoot ?? defaultBackupRoot(home);
  return withWriterLock(authPath, () => withWriterLock(configPath, async () => {
    const authRaw = await fileIo.read(authPath);
    const { doc, style } = parseJsonDocument(authRaw, authPath);
    const requiresOpenaiAuth = hasCredentialLoginMaterial(doc);
    const authNext = serializeJson(doc, style);
    const configRaw = await fileIo.read(configPath);
    const patched = patchCodexToml(
      configRaw === void 0 ? "" : configRaw.toString("utf8"),
      provider,
      {
        apiKey: key,
        requiresOpenaiAuth,
        // A file being created gets a trailing newline even though there was no
        // "original" habit to copy.
        trailingNewline: configRaw === void 0 ? true : void 0
      }
    );
    await ensureFirstWriteBackup(authPath, authRaw, backups, fileIo);
    await ensureFirstWriteBackup(configPath, configRaw, backups, fileIo);
    await fileIo.write(authPath, authNext, 384);
    try {
      await fileIo.write(configPath, patched.text, 384);
    } catch (err) {
      await restoreBytes(authPath, authRaw, fileIo);
      throw err;
    }
    return {
      files: [
        { path: authPath, keys: [], removed: [] },
        { path: configPath, keys: patched.written, removed: patched.removed }
      ],
      warnings: protocolWarnings("codex", provider)
    };
  }));
}
async function restoreBytes(path, previous, fileIo) {
  try {
    if (previous === void 0) {
      await rm2(path, { force: true });
      return;
    }
    await fileIo.write(path, previous.toString("utf8"), 384);
  } catch {
  }
}
async function writeProviderConfig({ appType, provider, apiKey, home, io, previous } = {}) {
  if (appType === "claude") return writeClaudeConfig({ provider, apiKey, home, io, previous });
  if (appType === "codex") return writeCodexConfig({ provider, apiKey, home, io });
  throw new WriterError(`no writer for app type "${appType}"`, { kind: "unsupported" });
}

// src/host/manager-routes.mjs
var MANAGER_API_BASE = "/api/dsh-ccswitch-manager";
var MANAGER_NAMESPACE = "dsh-ccswitch-plugin";
var MAX_PROVIDERS = 500;
var SAFE_REASONS = /* @__PURE__ */ new Set(["new", "updated", "unchanged", "removed", "activated", "created"]);
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readCatalogue(settings) {
  try {
    const descriptors = await settings?.describe?.();
    const descriptor = (Array.isArray(descriptors) ? descriptors : []).find((entry) => entry?.ns === MANAGER_NAMESPACE);
    if (descriptor === void 0) return { providers: {}, revision: void 0, exists: false };
    const providers = isRecord2(descriptor.value?.providers) ? descriptor.value.providers : {};
    return { providers, revision: descriptor.revision, exists: true };
  } catch {
    return { providers: {}, revision: void 0, exists: false };
  }
}
function currentKeyOf(providers, appType) {
  const current = currentKeysByApp(providers);
  if (typeof appType === "string" && appType !== "") return current[appType];
  return Object.values(current)[0];
}
function publicProvider(key, provider, credentialConfigured) {
  const models = Array.isArray(provider?.models) ? provider.models : [];
  return {
    key,
    displayName: String(provider?.displayName ?? ""),
    api: String(provider?.api ?? ""),
    baseURL: String(provider?.baseURL ?? ""),
    apiKeyEnv: typeof provider?.apiKeyEnv === "string" ? provider.apiKeyEnv : void 0,
    credential: credentialConfigured ? "found" : "missing",
    models: models.slice(0, 200).map((model) => ({
      id: String(model?.id ?? ""),
      name: typeof model?.name === "string" ? model.name : void 0,
      contextWindow: Number.isInteger(model?.contextWindow) ? model.contextWindow : void 0,
      maxTokens: Number.isInteger(model?.maxTokens) ? model.maxTokens : void 0,
      reasoningEfforts: model?.reasoningEfforts === false ? false : void 0
    })),
    category: typeof provider?.category === "string" ? provider.category : void 0,
    websiteUrl: typeof provider?.websiteUrl === "string" ? provider.websiteUrl : void 0,
    notes: typeof provider?.notes === "string" ? provider.notes : void 0,
    icon: typeof provider?.icon === "string" ? provider.icon : void 0,
    iconColor: typeof provider?.iconColor === "string" ? provider.iconColor : void 0,
    appType: typeof provider?.appType === "string" ? provider.appType : void 0,
    sourceProfileId: typeof provider?.sourceProfileId === "string" ? provider.sourceProfileId : void 0,
    isCurrent: provider?.isCurrent === true,
    inFailoverQueue: provider?.inFailoverQueue === true,
    costMultiplier: typeof provider?.costMultiplier === "number" ? provider.costMultiplier : void 0,
    limitDailyUsd: typeof provider?.limitDailyUsd === "number" ? provider.limitDailyUsd : void 0,
    limitMonthlyUsd: typeof provider?.limitMonthlyUsd === "number" ? provider.limitMonthlyUsd : void 0
  };
}
async function credentialState(credentials, ref) {
  if (typeof ref !== "string" || ref === "") return false;
  if (typeof credentials?.describe === "function") {
    try {
      const described = await credentials.describe(ref);
      if (described?.configured === true) return true;
    } catch {
    }
  }
  if (typeof credentials?.resolve === "function") {
    try {
      const resolved = await credentials.resolve(ref);
      return typeof resolved?.value === "string" && resolved.value.length > 0;
    } catch {
    }
  }
  return false;
}
function uniqueKey(displayName, providers) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = newProviderKey(displayName);
    if (!Object.hasOwn(providers, candidate)) return candidate;
  }
  throw new Error("could not allocate a provider key");
}
function revisionOf(body) {
  return Number.isInteger(body?.expectedRevision) ? body.expectedRevision : void 0;
}
function resolveAppType(provider, override) {
  if (typeof override === "string" && override !== "") return override;
  const own = provider?.appType;
  return typeof own === "string" && own !== "" ? own : "claude";
}
function makeManagerRoutes(deps = {}) {
  const settings = deps.settings;
  const credentials = deps.credentials;
  const isLoopback = deps.isLoopback ?? isLoopbackRequest;
  const presets = Array.isArray(deps.presets) ? deps.presets : [];
  const home = deps.home;
  const applyProvider = deps.applyProvider ?? (async () => {
  });
  let queue = Promise.resolve();
  const serialize = (work) => {
    const next = queue.then(work, work);
    queue = next.then(() => void 0, () => void 0);
    return next;
  };
  const runWriter = async (provider, appType, outgoing) => {
    if (!WRITER_APP_TYPES.includes(appType)) {
      throw Object.assign(new Error("unsupported app type"), { code: "UNSUPPORTED" });
    }
    const resolved = await credentials?.resolve?.(provider?.apiKeyEnv);
    const apiKey = typeof resolved?.value === "string" ? resolved.value : "";
    if (apiKey === "") {
      throw Object.assign(new Error("credential is not set"), { code: "NO_CREDENTIAL" });
    }
    const written = await writeProviderConfig({ appType, provider, apiKey, home, previous: outgoing });
    return {
      appType,
      files: written.files.map((file) => ({
        path: file.path,
        keys: file.keys.slice(0, 60).map((key) => redactText(key).slice(0, 120)),
        removed: file.removed.slice(0, 60).map((key) => redactText(key).slice(0, 120))
      })),
      warnings: written.warnings.slice(0, 20).map((text) => redactText(text).slice(0, 200))
    };
  };
  return [
    {
      kind: "exact",
      path: `${MANAGER_API_BASE}/providers`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, "GET")) return;
        try {
          const { providers, revision, exists } = await readCatalogue(settings);
          const order = orderProviders(providers);
          const entries = await Promise.all(
            order.map(async (key) => [
              key,
              publicProvider(key, providers[key], await credentialState(credentials, providers[key]?.apiKeyEnv))
            ])
          );
          writeJson(response, 200, {
            exists,
            revision,
            order,
            // Which provider is active is only answerable per app (CC Switch's
            // `is_current` is a per-app singleton), so the map is the real
            // answer. `current` stays for a browser half that predates it.
            current: currentKeyOf(providers),
            currentByApp: currentKeysByApp(providers),
            providers: Object.fromEntries(entries),
            apiProtocols: [...CCS_API_PROTOCOLS],
            // The app types this plugin can act on, taken from the writer list
            // rather than a second copy in the browser half. A value here is a
            // promise that activating such a provider does something; the form
            // still offers a stored value outside the list, or editing an
            // imported row of another app type would rewrite it on open.
            appTypes: [...WRITER_APP_TYPES]
          });
        } catch (err) {
          console.error("[dsh-ccswitch-plugin] manager list failed:", redactText(err));
          writeJson(response, 500, { error: "could not read the provider catalogue" });
        }
      }
    },
    {
      kind: "exact",
      path: `${MANAGER_API_BASE}/providers/save`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, "POST", { requireSameOrigin: true })) return;
        const body = await readJsonBody(request);
        if (!isRecord2(body) || !isRecord2(body.provider)) {
          writeJson(response, 400, { error: "body must be { provider: object, key?: string }" });
          return;
        }
        const draft = normalizeCCSProvider({
          ...emptyCCSProvider(),
          ...body.provider,
          // A key is never accepted from the body: it addresses the credential
          // reference, so letting a caller choose one would let it point a new
          // provider at an existing provider's stored secret.
          apiKeyEnv: void 0
        });
        const check = validateCCSProvider(draft);
        if (!check.ok) {
          writeJson(response, 400, { error: "provider is not usable", errors: [check.message] });
          return;
        }
        const requestedKey = typeof body.key === "string" && body.key !== "" ? body.key : void 0;
        try {
          const result = await serialize(async () => {
            const { providers, revision } = await readCatalogue(settings);
            const existingKey = requestedKey !== void 0 && Object.hasOwn(providers, requestedKey) ? requestedKey : void 0;
            const key = existingKey ?? uniqueKey(draft.displayName, providers);
            if (existingKey === void 0 && Object.keys(providers).length >= MAX_PROVIDERS) {
              throw Object.assign(new Error("too many providers"), { code: "TOO_MANY" });
            }
            const apiKeyEnv = credentialRefForProviderKey(key);
            const existingRecord = existingKey === void 0 ? void 0 : providers[existingKey];
            const record = { ...draft, apiKeyEnv };
            if (record.sortIndex === void 0 && existingRecord?.sortIndex !== void 0) {
              record.sortIndex = existingRecord.sortIndex;
            }
            if (record.createdAt === void 0) {
              record.createdAt = existingRecord?.createdAt ?? Date.now();
            }
            const apiKey = typeof body.apiKey === "string" ? body.apiKey : void 0;
            if (apiKey !== void 0 && apiKey !== "") await credentials.set(apiKeyEnv, apiKey);
            await settings.mutate(
              MANAGER_NAMESPACE,
              [{ op: "set", path: ["providers", key], value: record }],
              revisionOf(body) ?? revision
            );
            return { key, record, created: existingKey === void 0 };
          });
          writeJson(response, 200, {
            key: result.key,
            status: SAFE_REASONS.has(result.created ? "created" : "updated") ? result.created ? "created" : "updated" : "updated",
            provider: publicProvider(result.key, result.record, await credentialState(credentials, result.record.apiKeyEnv))
          });
        } catch (err) {
          if (err?.code === "TOO_MANY") {
            writeJson(response, 409, { error: `the catalogue is limited to ${MAX_PROVIDERS} providers` });
            return;
          }
          const conflict = /conflict/i.test(String(err?.code ?? "")) || /conflict/i.test(String(err?.message ?? ""));
          console.error("[dsh-ccswitch-plugin] manager save failed:", redactText(err, [body.apiKey]));
          writeJson(response, conflict ? 409 : 500, {
            error: conflict ? "the settings document changed; reload and retry" : "could not save the provider"
          });
        }
      }
    },
    {
      kind: "exact",
      path: `${MANAGER_API_BASE}/providers/delete`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, "POST", { requireSameOrigin: true })) return;
        const body = await readJsonBody(request);
        if (!isRecord2(body) || typeof body.key !== "string" || body.key === "") {
          writeJson(response, 400, { error: "body must be { key: string }" });
          return;
        }
        try {
          const outcome = await serialize(async () => {
            const { providers, revision } = await readCatalogue(settings);
            if (!Object.hasOwn(providers, body.key)) return { missing: true };
            const deleted = providers[body.key];
            if (currentKeyOf(providers, effectiveAppType(deleted)) === body.key) return { active: true };
            const ref = providers[body.key]?.apiKeyEnv;
            await settings.mutate(
              MANAGER_NAMESPACE,
              [{ op: "unset", path: ["providers", body.key] }],
              revisionOf(body) ?? revision
            );
            if (typeof ref === "string" && ref !== "" && typeof credentials?.unset === "function") {
              try {
                await credentials.unset(ref);
              } catch (err) {
                console.error("[dsh-ccswitch-plugin] credential cleanup failed:", redactText(err));
              }
            }
            return { missing: false };
          });
          if (outcome.missing) {
            writeJson(response, 404, { error: "no such provider" });
            return;
          }
          if (outcome.active) {
            writeJson(response, 409, {
              reason: "active-provider",
              error: "this provider is active; activate another one before deleting it"
            });
            return;
          }
          writeJson(response, 200, { key: body.key, status: "removed" });
        } catch (err) {
          const conflict = /conflict/i.test(String(err?.code ?? "")) || /conflict/i.test(String(err?.message ?? ""));
          console.error("[dsh-ccswitch-plugin] manager delete failed:", redactText(err));
          writeJson(response, conflict ? 409 : 500, {
            error: conflict ? "the settings document changed; reload and retry" : "could not delete the provider"
          });
        }
      }
    },
    {
      kind: "exact",
      path: `${MANAGER_API_BASE}/providers/activate`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, "POST", { requireSameOrigin: true })) return;
        const body = await readJsonBody(request);
        if (!isRecord2(body) || typeof body.key !== "string" || body.key === "") {
          writeJson(response, 400, { error: "body must be { key: string }" });
          return;
        }
        try {
          const outcome = await serialize(async () => {
            const { providers, revision } = await readCatalogue(settings);
            if (!Object.hasOwn(providers, body.key)) return { missing: true };
            const outgoingKey = currentKeyOf(providers, effectiveAppType(providers[body.key]));
            const outgoing = outgoingKey === void 0 ? void 0 : providers[outgoingKey];
            const next = activateCCSProvider(providers, body.key);
            await settings.mutate(
              MANAGER_NAMESPACE,
              [{ op: "set", path: ["providers"], value: next }],
              revisionOf(body) ?? revision
            );
            return { missing: false, provider: next[body.key], outgoing };
          });
          if (outcome.missing) {
            writeJson(response, 404, { error: "no such provider" });
            return;
          }
          const provider = outcome.provider;
          const appType = resolveAppType(provider);
          const warnings = [];
          let applied = true;
          try {
            warnings.push(...await applyProvider(body.key, provider) ?? []);
          } catch (err) {
            applied = false;
            console.error("[dsh-ccswitch-plugin] projecting the provider into DSH failed:", redactText(err));
            warnings.push("DSH did not accept the route, so model requests still use the previous one");
          }
          let written;
          if (WRITER_APP_TYPES.includes(appType)) {
            try {
              written = await runWriter(provider, appType, outcome.outgoing);
              warnings.push(...written.warnings);
            } catch (err) {
              console.error("[dsh-ccswitch-plugin] writing the tool configuration failed:", redactText(err));
              warnings.push(err?.code === "NO_CREDENTIAL" ? "no key is stored for this provider, so its configuration was not written" : writerRefusalMessage(err));
            }
          } else {
            warnings.push(`nothing writes a "${appType}" configuration yet; supported: ${WRITER_APP_TYPES.join(", ")}`);
          }
          writeJson(response, 200, {
            key: body.key,
            status: "activated",
            applied,
            written,
            warnings: warnings.slice(0, 20).map((text) => redactText(text).slice(0, 200))
          });
        } catch (err) {
          const conflict = /conflict/i.test(String(err?.code ?? "")) || /conflict/i.test(String(err?.message ?? ""));
          console.error("[dsh-ccswitch-plugin] manager activate failed:", redactText(err));
          writeJson(response, conflict ? 409 : 500, {
            error: conflict ? "the settings document changed; reload and retry" : "could not activate the provider"
          });
        }
      }
    },
    {
      kind: "exact",
      path: `${MANAGER_API_BASE}/providers/reorder`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, "POST", { requireSameOrigin: true })) return;
        const body = await readJsonBody(request);
        if (!isRecord2(body) || !Array.isArray(body.keys) || body.keys.some((key) => typeof key !== "string" || key === "")) {
          writeJson(response, 400, { error: "body must be { keys: string[] }" });
          return;
        }
        const requested = body.keys;
        if (new Set(requested).size !== requested.length) {
          writeJson(response, 400, { error: "keys must not repeat" });
          return;
        }
        try {
          await serialize(async () => {
            const { providers, revision } = await readCatalogue(settings);
            const present = Object.keys(providers);
            if (requested.length !== present.length || requested.some((key) => !Object.hasOwn(providers, key))) {
              throw Object.assign(new Error("keys must name every provider exactly once"), { code: "NOT_PERMUTATION" });
            }
            const next = Object.fromEntries(
              // Index by position, which is what CC Switch's `sort_index` is:
              // an ordinal the list is sorted by.
              requested.map((key, index) => [key, { ...providers[key], sortIndex: index }])
            );
            await settings.mutate(
              MANAGER_NAMESPACE,
              [{ op: "set", path: ["providers"], value: next }],
              revisionOf(body) ?? revision
            );
            return next;
          });
          writeJson(response, 200, { status: "reordered", order: requested });
        } catch (err) {
          if (err?.code === "NOT_PERMUTATION") {
            writeJson(response, 400, { error: "keys must name every provider exactly once" });
            return;
          }
          const conflict = /conflict/i.test(String(err?.code ?? "")) || /conflict/i.test(String(err?.message ?? ""));
          console.error("[dsh-ccswitch-plugin] manager reorder failed:", redactText(err));
          writeJson(response, conflict ? 409 : 500, {
            error: conflict ? "the settings document changed; reload and retry" : "could not reorder the providers"
          });
        }
      }
    },
    {
      kind: "exact",
      path: `${MANAGER_API_BASE}/presets`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, "GET")) return;
        writeJson(response, 200, { presets });
      }
    },
    {
      kind: "exact",
      path: `${MANAGER_API_BASE}/writers/run`,
      handler: async (request, response) => {
        if (!methodFence(request, response, isLoopback, "POST", { requireSameOrigin: true })) return;
        const body = await readJsonBody(request);
        if (!isRecord2(body) || typeof body.key !== "string" || body.key === "") {
          writeJson(response, 400, { error: 'body must be { key: string, appType?: "claude" | "codex" }' });
          return;
        }
        try {
          const outcome = await serialize(async () => {
            const { providers } = await readCatalogue(settings);
            if (!Object.hasOwn(providers, body.key)) {
              throw Object.assign(new Error("no such provider"), { code: "NOT_FOUND" });
            }
            const provider = providers[body.key];
            return runWriter(provider, resolveAppType(provider, body.appType));
          });
          writeJson(response, 200, {
            key: body.key,
            appType: outcome.appType,
            // Already redacted and clamped by runWriter.
            written: outcome.files,
            warnings: outcome.warnings
          });
        } catch (err) {
          if (err?.code === "NOT_FOUND") {
            writeJson(response, 404, { error: "no such provider" });
            return;
          }
          if (err?.code === "NO_CREDENTIAL") {
            writeJson(response, 400, {
              error: "this provider has no key stored, so writing it would leave the tool unable to authenticate"
            });
            return;
          }
          if (err?.code === "UNSUPPORTED" || err instanceof WriterError) {
            console.error("[dsh-ccswitch-plugin] writer refused:", redactText(err));
            writeJson(response, 400, {
              error: writerRefusalMessage(err)
            });
            return;
          }
          console.error("[dsh-ccswitch-plugin] writer failed:", redactText(err));
          writeJson(response, 500, { error: "could not write the tool configuration" });
        }
      }
    }
  ];
}
function writerRefusalMessage(err) {
  if (!(err instanceof WriterError)) {
    return `no writer for that app type; supported: ${WRITER_APP_TYPES.join(", ")}`;
  }
  if (err.kind === "unsupported") {
    return `no writer for that app type; supported: ${WRITER_APP_TYPES.join(", ")}`;
  }
  if (err.kind === "credential") {
    return "this provider has no key stored, so writing it would leave the tool unable to authenticate";
  }
  if (err.kind === "parse") {
    const where = err.line === void 0 ? "" : ` (line ${err.line} column ${err.column})`;
    return `the existing configuration is not valid JSON${where}, so it was left untouched`;
  }
  return "the existing configuration has an unexpected shape, so it was left untouched";
}

// src/host/index.mjs
var name = "dsh-ccswitch-plugin";
var inject = ["webServer", "settings", "credentials"];
var Config = defineCCSConfig(z);
function apply(ctx) {
  ctx.inject(["settings"], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
  const providersOf = (ns) => async () => {
    const namespaces = await ctx.settings.describe();
    const namespace = (Array.isArray(namespaces) ? namespaces : []).find((entry) => entry.ns === ns);
    return namespace?.value?.providers ?? {};
  };
  const routes = makeRoutes({
    getProviders: providersOf("llm-pi-ai"),
    // The importer writes this namespace too, so the scan preview has to
    // classify against it — see the note in routes.mjs.
    getCatalogue: providersOf(MANAGER_NAMESPACE),
    settings: ctx.settings,
    credentials: ctx.credentials,
    importProfiles
  });
  const managerRoutes = makeManagerRoutes({
    settings: ctx.settings,
    credentials: ctx.credentials,
    presets: PROVIDER_PRESETS,
    applyProvider: async (key, provider) => {
      const namespaces = await ctx.settings.describe();
      const live = (Array.isArray(namespaces) ? namespaces : []).find((entry) => entry.ns === "llm-pi-ai");
      if (live === void 0) {
        return ["llm-pi-ai is not installed, so the provider was marked active but DSH has no route to use it"];
      }
      const existing = live.value?.providers?.[key];
      const mapped = toProviderProfile({
        profileId: provider?.sourceProfileId ?? key,
        profileName: provider?.displayName ?? key,
        baseURL: provider?.baseURL,
        api: provider?.api,
        models: provider?.models ?? [],
        modelReasoningEffort: void 0
      }, existing, key);
      await ctx.settings.mutate("llm-pi-ai", [{ op: "set", path: ["providers", key], value: mapped }], live.revision);
      return [];
    }
  });
  const allRoutes = [...routes, ...managerRoutes];
  ctx.effect(() => {
    const disposers = allRoutes.map((route) => ctx.webServer.register(route));
    return () => {
      for (const dispose of disposers) if (typeof dispose === "function") dispose();
    };
  }, "dsh-ccswitch-plugin: routes");
}
export {
  Config,
  apply,
  inject,
  name
};
