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
  for (const field of ["notes", "icon", "iconColor", "appType", "sourceProfileId"]) {
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
