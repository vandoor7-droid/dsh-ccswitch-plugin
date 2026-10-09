// lib/core/ids.js
import { createHash } from "node:crypto";
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
function normalizeBaseUrl(url) {
  return String(url ?? "").replace(/\/+$/, "");
}
function toProviderProfile(profile, existing, providerKeyValue) {
  const previous = isObject(existing) ? existing : {};
  const resolvedKey = providerKeyValue ?? providerKey(profile.profileId, profile.profileName);
  const key = credentialRefForProviderKey(resolvedKey);
  const existingModels = Array.isArray(previous.models) ? previous.models : [];
  const sourceModels = (profile.models ?? []).map((model) => typeof model === "string" ? { id: model } : model).filter((model) => typeof model?.id === "string" && model.id.length > 0);
  const sourceIds = new Set(sourceModels.map((model) => model.id));
  const models = sourceModels.map((sourceModel) => {
    const current = existingModels.find((model) => model?.id === sourceModel.id);
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
  for (const model of existingModels) {
    if (isObject(model) && typeof model.id === "string" && !sourceIds.has(model.id)) models.push({ ...model });
  }
  const mapped = {
    ...previous,
    displayName: profile.profileName,
    baseURL: normalizeBaseUrl(profile.baseURL),
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
function redactSummary(profile, key, status, extraWarnings = []) {
  return {
    profileId: profile.profileId,
    profileName: profile.profileName,
    sourceLabel: "CCSwitch",
    providerKey: key,
    baseURL: normalizeBaseUrl(profile.baseURL),
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
  const sameRoute = (entry) => entry?.displayName === profile.profileName && entry?.baseURL === normalizeBaseUrl(profile.baseURL);
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
function classifyProfiles(profiles, existingProviders) {
  const existing = existingProviders ?? {};
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
    const status = existingEntry === void 0 ? "new" : jsonEqual(existingEntry, mapped) ? "unchanged" : "update";
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
  ROLLBACK: "credential-rollback-failed"
};
var BLOCKED = {
  INVALID_SETTINGS_JSON: "invalid-settings-json",
  UNSUPPORTED_APP_TYPE: "unsupported-app-type",
  MISSING_OPENAI_KEY: "missing-openai-key",
  MISSING_CODEX_PROVIDER: "missing-codex-provider",
  MISSING_ANTHROPIC_KEY: "missing-anthropic-key",
  MISSING_ANTHROPIC_BASE_URL: "missing-anthropic-base-url",
  MISSING_OPENCODE_KEY: "missing-opencode-key",
  MISSING_OPENCODE_BASE_URL: "missing-opencode-base-url",
  UNSUPPORTED_OPENCODE_ADAPTER: "unsupported-opencode-adapter",
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
async function importProfiles({ profiles, selectedIds, settings, credentials, expectedRevision }) {
  const selected = new Set(selectedIds ?? []);
  const results = [];
  const existing = { ...await readExistingProviders(settings) ?? {} };
  const usedKeys = /* @__PURE__ */ new Set();
  let revisionForNextWrite = expectedRevision;
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
    if (wasConfigured && jsonEqual(existing[key], mapped)) {
      results.push({ profileId: profile.profileId, profileName: profile.profileName, providerKey: key, status: "unchanged", warnings });
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
        warnings
      });
      continue;
    }
    try {
      await settings.mutate("llm-pi-ai", [{ op: "set", path: ["providers", key], value: mapped }], revisionForNextWrite);
    } catch (err) {
      const conflict = isSettingsConflict(err);
      const failure = {
        profileId: profile.profileId,
        profileName: profile.profileName,
        providerKey: key,
        status: "failed",
        errorCode: conflict ? IMPORT_FAILURE.CONFLICT : IMPORT_FAILURE.SETTINGS,
        error: `\u8BBE\u7F6E\u5199\u5165\u5931\u8D25\uFF1A${redactText(err, [profile.apiKey])}`,
        warnings
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
    revisionForNextWrite = await readRevision(settings);
    results.push({ profileId: profile.profileId, profileName: profile.profileName, providerKey: key, status: wasConfigured ? "updated" : "new", warnings });
  }
  return results;
}
async function readExistingProviders(settings) {
  try {
    if (typeof settings?.describe === "function") {
      const namespaces = await settings.describe();
      const namespace = (Array.isArray(namespaces) ? namespaces : []).find((entry) => entry.ns === "llm-pi-ai");
      if (namespace?.value?.providers) return namespace.value.providers;
    }
    if (typeof settings?.get === "function") {
      const value = await settings.get("llm-pi-ai");
      if (value && typeof value === "object" && value.providers) return value.providers;
    }
  } catch {
  }
  return void 0;
}
async function readRevision(settings) {
  try {
    if (typeof settings?.describe === "function") {
      const namespaces = await settings.describe();
      const namespace = (Array.isArray(namespaces) ? namespaces : []).find((entry) => entry.ns === "llm-pi-ai");
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

// lib/core/extract.js
var SKIP_OFFICIAL = /* @__PURE__ */ new Set(["codex-official", "claude-official", "claude-desktop-official"]);
var SKIP_NAMES = /* @__PURE__ */ new Set(["default", "OpenAI Official", "Claude Official", "Claude Desktop Official"]);
var DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5";
var DEFAULT_CODEX_MODEL = "gpt-5.1-codex";
var DEFAULT_OPENCODE_MODEL = "gpt-4o";
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
  const base = {
    profileId,
    profileName,
    appType,
    isCurrent: Boolean(row.is_current),
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
  if (appType === "claude" || appType === "claude-desktop") return extractClaude(base, parsed);
  if (appType === "opencode") return extractOpencode(base, parsed);
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
function extractClaude(base, parsed) {
  const { profileName } = base;
  const env = (parsed && typeof parsed === "object" ? parsed.env : void 0) ?? {};
  const apiKey = [env.ANTHROPIC_AUTH_TOKEN, env.ANTHROPIC_API_KEY].find((value) => typeof value === "string" && value.length > 0);
  if (apiKey === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 API key\uFF08env.ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_ANTHROPIC_KEY };
  }
  const baseURL = typeof env.ANTHROPIC_BASE_URL === "string" && env.ANTHROPIC_BASE_URL.length > 0 ? env.ANTHROPIC_BASE_URL : void 0;
  if (baseURL === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 base URL\uFF08env.ANTHROPIC_BASE_URL \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_ANTHROPIC_BASE_URL };
  }
  const warnings = [];
  let model = typeof env.ANTHROPIC_MODEL === "string" && env.ANTHROPIC_MODEL.length > 0 ? env.ANTHROPIC_MODEL : DEFAULT_CLAUDE_MODEL;
  if (!env.ANTHROPIC_MODEL) {
    warnings.push(`claude \u914D\u7F6E\u4E2D\u6CA1\u6709\u6A21\u578B\u5B57\u6BB5\uFF0C\u5DF2\u56DE\u9000\u4E3A ${DEFAULT_CLAUDE_MODEL}\uFF0C\u5BFC\u5165\u540E\u53EF\u5728 DSH \u4E2D\u4FEE\u6539`);
    if (/thinking/i.test(profileName)) {
      model = { id: DEFAULT_CLAUDE_MODEL, fallbackThinking: true };
    }
  }
  return {
    ...base,
    apiKey,
    baseURL,
    api: "anthropic-messages",
    models: [model],
    modelReasoningEffort: void 0,
    warnings,
    unsupported: []
  };
}
function extractOpencode(base, parsed) {
  const options = (parsed && typeof parsed === "object" ? parsed.options : void 0) ?? {};
  const apiKey = typeof options.apiKey === "string" && options.apiKey.length > 0 ? options.apiKey : void 0;
  if (apiKey === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 API key\uFF08options.apiKey \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_OPENCODE_KEY };
  }
  const baseURL = typeof options.baseURL === "string" && options.baseURL.length > 0 ? options.baseURL : void 0;
  if (baseURL === void 0) {
    return { ...base, blocked: true, blockedReason: "\u672A\u627E\u5230 base URL\uFF08options.baseURL \u7F3A\u5931\uFF09", blockedCode: BLOCKED.MISSING_OPENCODE_BASE_URL };
  }
  const npm = typeof parsed.npm === "string" ? parsed.npm : "";
  if (npm !== "@ai-sdk/openai-compatible") {
    return { ...base, blocked: true, blockedReason: `\u6682\u4E0D\u652F\u6301\u7684 opencode \u9002\u914D\u5668\uFF1A${npm || "\u672A\u77E5"}\uFF08\u4EC5 @ai-sdk/openai-compatible\uFF09`, blockedCode: BLOCKED.UNSUPPORTED_OPENCODE_ADAPTER, blockedDetail: npm || "unknown" };
  }
  const warnings = [];
  const rawModels = (parsed && typeof parsed === "object" ? parsed.models : void 0) ?? {};
  const models = Object.entries(rawModels).filter(([id]) => typeof id === "string" && id.length > 0).map(([id, meta]) => {
    const name2 = meta && typeof meta === "object" && typeof meta.name === "string" ? meta.name : void 0;
    return name2 ? { id, name: name2 } : { id };
  });
  if (models.length === 0) {
    models.push({ id: DEFAULT_OPENCODE_MODEL });
    warnings.push(`opencode \u914D\u7F6E\u4E2D\u6CA1\u6709\u6A21\u578B\u5217\u8868\uFF0C\u5DF2\u56DE\u9000\u4E3A ${DEFAULT_OPENCODE_MODEL}\uFF0C\u5BFC\u5165\u540E\u53EF\u5728 DSH \u4E2D\u4FEE\u6539`);
  }
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

// lib/core/scan.js
var DEFAULT_DB_CANDIDATES = [
  () => join(homedir(), ".cc-switch", "cc-switch.db")
];
var SUPPORTED_APP_TYPES = ["codex", "claude", "claude-desktop", "opencode"];
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
    const rows = db.prepare("SELECT id, name, settings_config, is_current, app_type FROM providers").all();
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
  if (status === "failed") output.error = publicErrorDetail(result?.error, secrets);
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
          const classified = classifyProfiles(profiles, await getProviders());
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

// src/host/index.mjs
var name = "dsh-ccswitch-plugin";
var inject = ["webServer", "settings", "credentials"];
function apply(ctx) {
  const routes = makeRoutes({
    // 0.2.0 SettingsForms has no get(); describe() returns per-namespace views.
    getProviders: async () => {
      const namespaces = ctx.settings.describe();
      const namespace = namespaces.find((entry) => entry.ns === "llm-pi-ai");
      return namespace?.value?.providers ?? {};
    },
    settings: ctx.settings,
    credentials: ctx.credentials,
    importProfiles
  });
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route));
    return () => {
      for (const dispose of disposers) if (typeof dispose === "function") dispose();
    };
  }, "dsh-ccswitch-plugin: routes");
}
export {
  apply,
  inject,
  name
};
