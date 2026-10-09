window.__ModuleLoader__.load({
	id: "dsh-ccswitch-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name2 in all)
		    __defProp(target, name2, { get: all[name2], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
		  // If the importer is in node compatibility mode or this is not an ESM
		  // file that has been converted to a CommonJS file using a Babel-
		  // compatible transform (i.e. "__esModule" has not been set), then set
		  // "default" to the CommonJS "module.exports" for node compatibility.
		  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
		  mod
		));
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

		// src/client/index.mjs
		var index_exports = {};
		__export(index_exports, {
		  apply: () => apply,
		  inject: () => inject,
		  name: () => name
		});
		module.exports = __toCommonJS(index_exports);

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

		// src/domain/validation.mjs
		var LEVELS = Object.freeze(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
		var LEVEL_SET = new Set(LEVELS);
		function validateReasoningEfforts(value) {
		  if (typeof value !== "object" || value === null || Array.isArray(value)) {
		    return { ok: false, message: "reasoning efforts must be an object" };
		  }
		  for (const [level, wire] of Object.entries(value)) {
		    if (!LEVEL_SET.has(level)) return { ok: false, message: `unsupported reasoning level: ${level}` };
		    if (wire !== null && typeof wire !== "string") {
		      return { ok: false, message: `wire value for ${level} must be a string or null` };
		    }
		    if (level !== "off" && (wire === null || wire.trim() === "")) {
		      return { ok: false, message: "non-off reasoning levels need a non-empty wire value" };
		    }
		  }
		  if (!Object.keys(value).some((level) => level !== "off")) {
		    return { ok: false, message: "at least one non-off reasoning level is required" };
		  }
		  return { ok: true };
		}
		function normalizeReasoningEfforts(value) {
		  const result = validateReasoningEfforts(value);
		  if (!result.ok) throw new Error(result.message);
		  return { ...value };
		}
		function reasoningStateForModel(modelId, draft) {
		  if (draft?.mode === "disabled") return { mode: "disabled", efforts: void 0 };
		  if (draft?.mode === "enabled") {
		    return { mode: "enabled", efforts: normalizeReasoningEfforts(draft.efforts) };
		  }
		  const known = knownReasoningFor(modelId);
		  return known === void 0 ? { mode: "disabled", efforts: void 0 } : { mode: "enabled", efforts: known };
		}

		// src/domain/settings.mjs
		function updateModelReasoning(provider, modelId, mode, efforts) {
		  const models = Array.isArray(provider?.models) ? provider.models : [];
		  const ids = models.map((model) => model?.id);
		  if (new Set(ids).size !== ids.length) throw new Error("duplicate model ID");
		  const index = ids.indexOf(modelId);
		  if (index < 0) throw new Error(`model not found: ${modelId}`);
		  const nextModels = models.map((model, at) => {
		    if (at !== index) return { ...model };
		    const next = { ...model };
		    if (mode === "disabled") {
		      next.reasoningEfforts = false;
		    } else if (mode === "enabled") {
		      next.reasoningEfforts = normalizeReasoningEfforts(efforts);
		    } else {
		      throw new Error(`unknown reasoning mode: ${mode}`);
		    }
		    return next;
		  });
		  return { ...provider, models: nextModels };
		}
		function settingsMutation(route, before, after) {
		  if (before?.models === after?.models) return { ns: "llm-pi-ai", ops: [] };
		  return {
		    ns: "llm-pi-ai",
		    ops: [{
		      op: "set",
		      path: ["providers", route, "models"],
		      value: after.models
		    }]
		  };
		}

		// lib/core/safety.js
		var REMOTE_SETTINGS_CONFLICT_CODE = "settings/conflict";
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

		// src/client/controller.mjs
		function createReasoningSettingsController(api) {
		  let snapshot = { status: "idle", writable: false, revision: void 0, providers: {}, error: null };
		  const listeners = /* @__PURE__ */ new Set();
		  const publish = (next) => {
		    snapshot = next;
		    for (const listener of listeners) listener();
		  };
		  let operationQueue = Promise.resolve();
		  const enqueue = (operation) => {
		    const next = operationQueue.then(operation, operation);
		    operationQueue = next.catch(() => {
		    });
		    return next;
		  };
		  const performRefresh = async () => {
		    publish({ ...snapshot, status: "loading", error: null });
		    try {
		      const response = await api.settings.describe();
		      if (!response.ok) throw new Error(response.error.message);
		      const namespace = response.value.namespaces.find((entry) => entry.ns === "llm-pi-ai");
		      const providers = namespace?.value?.providers ?? {};
		      publish({
		        status: "ready",
		        writable: response.value.writable === true,
		        revision: namespace?.revision,
		        providers,
		        error: null
		      });
		    } catch (error) {
		      publish({ ...snapshot, status: "error", error: error instanceof Error ? error.message : String(error) });
		    }
		    return snapshot;
		  };
		  const controller = {
		    getSnapshot: () => snapshot,
		    subscribe: (listener) => {
		      listeners.add(listener);
		      return () => listeners.delete(listener);
		    },
		    refresh: () => enqueue(performRefresh),
		    save: (route, modelId, mode, efforts, expectedRevision) => enqueue(async () => {
		      const revisionAtExecution = expectedRevision ?? snapshot.revision;
		      const before = snapshot.providers[route];
		      const after = updateModelReasoning(before, modelId, mode, efforts);
		      const mutation = settingsMutation(route, before, after);
		      const response = await api.settings.mutate(mutation.ns, mutation.ops, revisionAtExecution);
		      if (!response.ok) {
		        if (response.error.code === REMOTE_SETTINGS_CONFLICT_CODE) {
		          await performRefresh();
		          throw new Error(`settings conflict: ${response.error.message}`);
		        }
		        throw new Error(response.error.message);
		      }
		      await performRefresh();
		      return controller.getSnapshot();
		    })
		  };
		  return controller;
		}

		// src/client/import-controller.mjs
		function defaultFetch(url, init) {
		  return globalThis.fetch(url, init);
		}
		var SAME_ORIGIN_HEADER = "x-dsh-ccswitch-origin";
		var SAME_ORIGIN_VALUE = "same-origin";
		function writeHeaders() {
		  return { "content-type": "application/json", [SAME_ORIGIN_HEADER]: SAME_ORIGIN_VALUE };
		}
		function importable(profile) {
		  return profile.status !== "blocked" && profile.credential === "found";
		}
		var PROBE_REASONS = /* @__PURE__ */ new Set(["ok", "empty", "http-error", "timeout", "network", "no-credentials"]);
		var PROBE_CHECKS = /* @__PURE__ */ new Set(["models", "minimal", "none"]);
		function isStaleHost(message) {
		  return /HTTP\s*40[14]\b/.test(message) || /unauthorized/i.test(message);
		}
		function probeNumber(value) {
		  return Number.isInteger(value) && value >= 0 ? Math.min(value, 6e5) : 0;
		}
		function sanitizeProbe(result) {
		  return {
		    ok: result?.ok === true,
		    reason: PROBE_REASONS.has(result?.reason) ? result.reason : "network",
		    check: PROBE_CHECKS.has(result?.check) ? result.check : "none",
		    httpStatus: Number.isInteger(result?.httpStatus) && result.httpStatus > 0 && result.httpStatus < 1e3 ? result.httpStatus : void 0,
		    detail: typeof result?.detail === "string" ? result.detail.slice(0, 200) : void 0,
		    latencyMs: probeNumber(result?.latencyMs),
		    discoveredCount: probeNumber(result?.discoveredCount),
		    addedCount: probeNumber(result?.addedCount),
		    modelCount: probeNumber(result?.modelCount),
		    message: typeof result?.message === "string" ? result.message.slice(0, 300) : ""
		  };
		}
		function pruneProbes(probes, profiles) {
		  const ids = new Set(profiles.map((profile) => profile.profileId));
		  const next = {};
		  for (const [id, value] of Object.entries(probes ?? {})) {
		    if (ids.has(id)) next[id] = value;
		  }
		  return next;
		}
		function createCCSwitchImportController({
		  fetchImpl = defaultFetch,
		  getRevision = () => void 0,
		  onImported = () => {
		  }
		} = {}) {
		  let snapshot = {
		    phase: "idle",
		    profiles: [],
		    selectedIds: [],
		    results: [],
		    probes: {},
		    error: null,
		    source: void 0,
		    probedPath: void 0
		  };
		  const listeners = /* @__PURE__ */ new Set();
		  const publish = (next) => {
		    snapshot = next;
		    for (const listener of listeners) listener();
		  };
		  const request = async (url, init) => {
		    const response = await fetchImpl(url, init);
		    let body;
		    try {
		      body = await response.json();
		    } catch {
		      body = void 0;
		    }
		    if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
		    return body ?? {};
		  };
		  const controller = {
		    getSnapshot: () => snapshot,
		    subscribe: (listener) => {
		      listeners.add(listener);
		      return () => listeners.delete(listener);
		    },
		    setSelectedIds: (selectedIds) => {
		      publish({ ...snapshot, selectedIds: [...new Set(selectedIds.filter((id) => typeof id === "string"))] });
		    },
		    toggleSelected: (profileId) => {
		      const selected = new Set(snapshot.selectedIds);
		      if (selected.has(profileId)) selected.delete(profileId);
		      else selected.add(profileId);
		      controller.setSelectedIds([...selected]);
		    },
		    selectAll: () => {
		      controller.setSelectedIds(snapshot.profiles.filter(importable).map((profile) => profile.profileId));
		    },
		    selectNone: () => {
		      controller.setSelectedIds([]);
		    },
		    toggleSelectAll: () => {
		      const importableIds = snapshot.profiles.filter(importable).map((profile) => profile.profileId);
		      const allSelected = importableIds.length > 0 && importableIds.every((id) => snapshot.selectedIds.includes(id));
		      if (allSelected) controller.selectNone();
		      else controller.selectAll();
		    },
		    clearResults: () => {
		      publish({ ...snapshot, results: [] });
		    },
		    /**
		     * Test one row's endpoint without importing anything: the Host only reads
		     * `{baseURL}/models`, so this never touches settings or credentials.
		     */
		    probeOne: async (profileId) => {
		      const profile = snapshot.profiles.find((item) => item.profileId === profileId);
		      if (!profile || !importable(profile)) return void 0;
		      if (snapshot.probes?.[profileId]?.phase === "testing") return void 0;
		      const setProbe = (value) => {
		        publish({ ...snapshot, probes: { ...snapshot.probes, [profileId]: value } });
		      };
		      setProbe({ phase: "testing" });
		      try {
		        const body = await request("/api/dsh-ccswitch/probe", {
		          method: "POST",
		          headers: writeHeaders(),
		          body: JSON.stringify({ profileIds: [profileId] })
		        });
		        const results = Array.isArray(body.results) ? body.results : [];
		        const result = results.find((item) => item.profileId === profileId) ?? results[0];
		        if (!result) {
		          setProbe({ phase: "error", message: "", staleHost: false });
		          return void 0;
		        }
		        setProbe({ phase: "done", ...sanitizeProbe(result) });
		        return result;
		      } catch (error) {
		        const message = error instanceof Error ? error.message : String(error);
		        setProbe({ phase: "error", message, staleHost: isStaleHost(message) });
		        return void 0;
		      }
		    },
		    /**
		     * `keepResults` is for the refresh that follows an import: the report the
		     * user is reading must survive, otherwise the rows that were just imported
		     * still show "ready to import" while the summary of what happened vanishes.
		     * A user-initiated scan starts a new report instead.
		     */
		    scan: async (options = {}) => {
		      const keepResults = options?.keepResults === true;
		      publish({
		        ...snapshot,
		        phase: "loading",
		        error: null,
		        results: keepResults ? snapshot.results : []
		      });
		      try {
		        const body = await request("/api/dsh-ccswitch/scan");
		        const profiles = Array.isArray(body.profiles) ? body.profiles : [];
		        const selectedIds = profiles.filter(importable).map((profile) => profile.profileId);
		        publish({
		          phase: "ready",
		          profiles,
		          selectedIds,
		          results: keepResults ? snapshot.results : [],
		          probes: pruneProbes(snapshot.probes, profiles),
		          error: null,
		          source: typeof body.source === "string" ? body.source : void 0,
		          probedPath: typeof body.probedPath === "string" ? body.probedPath : void 0
		        });
		        return snapshot;
		      } catch (error) {
		        publish({ ...snapshot, phase: "error", error: error instanceof Error ? error.message : String(error) });
		        throw error;
		      }
		    },
		    importSelected: async () => {
		      publish({ ...snapshot, phase: "importing", error: null });
		      try {
		        const body = await request("/api/dsh-ccswitch/import", {
		          method: "POST",
		          headers: writeHeaders(),
		          body: JSON.stringify({ profileIds: snapshot.selectedIds, expectedRevision: getRevision() })
		        });
		        const results = Array.isArray(body.results) ? body.results : [];
		        publish({ ...snapshot, phase: "done", results, error: null });
		        try {
		          await onImported(results);
		        } catch {
		        }
		        return snapshot;
		      } catch (error) {
		        publish({ ...snapshot, phase: "error", error: error instanceof Error ? error.message : String(error) });
		        throw error;
		      }
		    }
		  };
		  return controller;
		}

		// src/client/manager-controller.mjs
		var MANAGER_API_BASE = "/api/dsh-ccswitch-manager";
		var PROVIDERS_PATH = `${MANAGER_API_BASE}/providers`;
		var SAVE_PATH = `${PROVIDERS_PATH}/save`;
		var DELETE_PATH = `${PROVIDERS_PATH}/delete`;
		var ACTIVATE_PATH = `${PROVIDERS_PATH}/activate`;
		var PRESETS_PATH = `${MANAGER_API_BASE}/presets`;
		var PROBE_PATH = "/api/dsh-ccswitch/probe";
		var SAME_ORIGIN_HEADER2 = "x-dsh-ccswitch-origin";
		var SAME_ORIGIN_VALUE2 = "same-origin";
		var FALLBACK_PROTOCOLS = ["openai-completions", "openai-responses", "anthropic-messages"];
		function defaultFetch2(url, init) {
		  return globalThis.fetch(url, init);
		}
		function writeHeaders2() {
		  return { "content-type": "application/json", [SAME_ORIGIN_HEADER2]: SAME_ORIGIN_VALUE2 };
		}
		function isRecord(value) {
		  return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function optionalText(value) {
		  const raw = typeof value === "string" ? value.trim() : "";
		  return raw === "" ? void 0 : raw;
		}
		function finiteNumber(value) {
		  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
		}
		function count(value) {
		  return Number.isInteger(value) && value >= 0 ? value : void 0;
		}
		function sanitizeModel(value) {
		  const source = isRecord(value) ? value : {};
		  return {
		    id: String(source.id ?? ""),
		    name: optionalText(source.name),
		    contextWindow: count(source.contextWindow),
		    maxTokens: count(source.maxTokens),
		    reasoningEfforts: source.reasoningEfforts === false ? false : void 0
		  };
		}
		function sanitizeProvider(key, value) {
		  const source = isRecord(value) ? value : {};
		  return {
		    key: String(source.key ?? key),
		    displayName: String(source.displayName ?? ""),
		    api: String(source.api ?? ""),
		    baseURL: String(source.baseURL ?? ""),
		    apiKeyEnv: optionalText(source.apiKeyEnv),
		    // The Host reports configuredness, never the key. Anything other than an
		    // explicit `found` reads as missing, so a Host that omits the field cannot
		    // make a provider whose credential is unset look ready.
		    credential: source.credential === "found" ? "found" : "missing",
		    models: (Array.isArray(source.models) ? source.models : []).slice(0, 200).map(sanitizeModel),
		    notes: optionalText(source.notes),
		    icon: optionalText(source.icon),
		    iconColor: optionalText(source.iconColor),
		    appType: optionalText(source.appType),
		    sourceProfileId: optionalText(source.sourceProfileId),
		    isCurrent: source.isCurrent === true,
		    inFailoverQueue: source.inFailoverQueue === true,
		    costMultiplier: finiteNumber(source.costMultiplier),
		    limitDailyUsd: finiteNumber(source.limitDailyUsd),
		    limitMonthlyUsd: finiteNumber(source.limitMonthlyUsd)
		  };
		}
		function sanitizeProviders(value) {
		  const source = isRecord(value) ? value : {};
		  const providers = {};
		  for (const [key, entry] of Object.entries(source)) {
		    if (key === "") continue;
		    providers[key] = sanitizeProvider(key, entry);
		  }
		  return providers;
		}
		function sanitizeOrder(order, providers) {
		  const seen = /* @__PURE__ */ new Set();
		  const next = [];
		  for (const key of Array.isArray(order) ? order : []) {
		    if (typeof key !== "string" || !Object.hasOwn(providers, key) || seen.has(key)) continue;
		    seen.add(key);
		    next.push(key);
		  }
		  for (const key of Object.keys(providers)) {
		    if (!seen.has(key)) next.push(key);
		  }
		  return next;
		}
		function sanitizeProtocols(value) {
		  const list = (Array.isArray(value) ? value : []).filter((entry) => typeof entry === "string" && entry.trim() !== "");
		  return list.length > 0 ? [...new Set(list)] : [...FALLBACK_PROTOCOLS];
		}
		function sanitizePresets(value) {
		  return (Array.isArray(value) ? value : []).filter(isRecord).slice(0, 200).map((preset) => ({
		    key: String(preset.key ?? ""),
		    displayName: String(preset.displayName ?? ""),
		    appType: optionalText(preset.appType),
		    api: String(preset.api ?? ""),
		    baseURL: String(preset.baseURL ?? ""),
		    models: (Array.isArray(preset.models) ? preset.models : []).filter((id) => typeof id === "string" && id !== "").slice(0, 200),
		    // The CC Switch fields the picker groups and labels by. They travel as
		    // plain strings rather than being validated against the eight-category
		    // list here: the Host is the authority on its own catalogue, and an
		    // unrecognised category has to survive to `presetGroup` so it can fall
		    // back to `thirdparty` instead of vanishing from the picker entirely.
		    family: optionalText(preset.family),
		    planKey: optionalText(preset.planKey),
		    regionKey: optionalText(preset.regionKey),
		    category: optionalText(preset.category),
		    isPartner: preset.isPartner === true,
		    icon: optionalText(preset.icon),
		    iconColor: optionalText(preset.iconColor)
		  })).filter((preset) => preset.key !== "" && preset.displayName !== "");
		}
		var PROBE_REASONS2 = /* @__PURE__ */ new Set(["ok", "empty", "http-error", "timeout", "network", "no-credentials"]);
		var PROBE_CHECKS2 = /* @__PURE__ */ new Set(["models", "minimal", "none"]);
		function isStaleHost2(message) {
		  return /HTTP\s*40[14]\b/.test(message) || /unauthorized/i.test(message);
		}
		function probeNumber2(value) {
		  return Number.isInteger(value) && value >= 0 ? Math.min(value, 6e5) : 0;
		}
		function sanitizeProbe2(result) {
		  return {
		    ok: result?.ok === true,
		    reason: PROBE_REASONS2.has(result?.reason) ? result.reason : "network",
		    check: PROBE_CHECKS2.has(result?.check) ? result.check : "none",
		    httpStatus: Number.isInteger(result?.httpStatus) && result.httpStatus > 0 && result.httpStatus < 1e3 ? result.httpStatus : void 0,
		    detail: typeof result?.detail === "string" ? result.detail.slice(0, 200) : void 0,
		    latencyMs: probeNumber2(result?.latencyMs),
		    modelCount: probeNumber2(result?.modelCount),
		    message: typeof result?.message === "string" ? result.message.slice(0, 300) : ""
		  };
		}
		function pruneProbes2(probes, providers) {
		  const next = {};
		  for (const [key, value] of Object.entries(probes ?? {})) {
		    if (Object.hasOwn(providers ?? {}, key)) next[key] = value;
		  }
		  return next;
		}
		function withoutProbe(probes, key) {
		  if (!Object.hasOwn(probes ?? {}, key)) return probes ?? {};
		  const next = { ...probes };
		  delete next[key];
		  return next;
		}
		function sanitizeWarnings(value) {
		  return (Array.isArray(value) ? value : []).filter((entry) => typeof entry === "string" && entry.trim() !== "").slice(0, 20);
		}
		function createCCSwitchManagerController({ fetchImpl = defaultFetch2, onChanged = () => {
		} } = {}) {
		  let snapshot = {
		    status: "idle",
		    error: null,
		    /** The last failure was a revision conflict, not a bad request. */
		    conflict: false,
		    revision: void 0,
		    exists: false,
		    providers: {},
		    order: [],
		    current: void 0,
		    apiProtocols: [...FALLBACK_PROTOCOLS],
		    presets: [],
		    presetsError: null,
		    /** The row an operation is in flight for, so only it shows as busy. */
		    pendingKey: void 0,
		    pendingAction: void 0,
		    /** The Host's own validation list from a rejected save, for the form. */
		    saveErrors: [],
		    /** `{key, applied, warnings}` from the last activation, until dismissed. */
		    activation: void 0,
		    /**
		     * Per-row connection verdicts, keyed by provider key — the manager's
		     * equivalent of the import tab's `probes`. Each value is
		     * `{phase: 'testing'}`, `{phase: 'done', ...outcome}` or
		     * `{phase: 'error', message, staleHost}`.
		     */
		    probes: {}
		  };
		  const listeners = /* @__PURE__ */ new Set();
		  const publish = (next) => {
		    snapshot = next;
		    for (const listener of listeners) listener();
		  };
		  let operationQueue = Promise.resolve();
		  const enqueue = (operation) => {
		    const next = operationQueue.then(operation, operation);
		    operationQueue = next.then(() => void 0, () => void 0);
		    return next;
		  };
		  const request = async (url, init) => {
		    const response = await fetchImpl(url, init);
		    let body;
		    try {
		      body = await response.json();
		    } catch {
		      body = void 0;
		    }
		    if (!response.ok) {
		      const error = new Error(optionalText(body?.error) ?? `HTTP ${response.status}`);
		      error.status = response.status;
		      error.reason = optionalText(body?.reason);
		      error.errors = Array.isArray(body?.errors) ? body.errors.filter((entry) => typeof entry === "string").slice(0, 50) : void 0;
		      throw error;
		    }
		    return body ?? {};
		  };
		  const performRefresh = async (options = {}) => {
		    const quiet = options?.quiet === true;
		    if (!quiet) {
		      publish({ ...snapshot, status: "loading", error: null, conflict: false, pendingKey: void 0, pendingAction: void 0 });
		    }
		    try {
		      const body = await request(PROVIDERS_PATH);
		      const providers = sanitizeProviders(body?.providers);
		      publish({
		        ...snapshot,
		        status: "ready",
		        error: null,
		        conflict: false,
		        pendingKey: void 0,
		        pendingAction: void 0,
		        // `exists` separates "no namespace has been created yet" from "the
		        // namespace exists and is empty": the first has no catalogue to edit at
		        // all, which is a different thing to tell the user.
		        exists: body?.exists === true,
		        revision: Number.isInteger(body?.revision) ? body.revision : void 0,
		        providers,
		        order: sanitizeOrder(body?.order, providers),
		        // Verdicts are dropped along with the rows they describe: a provider
		        // deleted in another tab must not leave a green "connected" badge
		        // behind for a row that is about to be re-created with the same key.
		        probes: pruneProbes2(snapshot.probes, providers),
		        current: optionalText(body?.current),
		        apiProtocols: sanitizeProtocols(body?.apiProtocols)
		      });
		      return snapshot;
		    } catch (error) {
		      if (!quiet) {
		        publish({
		          ...snapshot,
		          status: "error",
		          error: error instanceof Error ? error.message : String(error),
		          conflict: false,
		          pendingKey: void 0,
		          pendingAction: void 0
		        });
		      }
		      throw error;
		    }
		  };
		  const quietlyRefresh = async () => {
		    try {
		      await performRefresh({ quiet: true });
		    } catch {
		    }
		  };
		  const runMutation = async ({ path, body, pendingKey, pendingAction, patch }) => {
		    publish({
		      ...snapshot,
		      status: "busy",
		      error: null,
		      conflict: false,
		      pendingKey,
		      pendingAction,
		      // Cleared on entry so a rejection's list is never the previous attempt's:
		      // a stale validation message is worse than none, because the field it
		      // names may already be fixed.
		      saveErrors: [],
		      activation: void 0
		    });
		    try {
		      const response = await request(path, {
		        method: "POST",
		        headers: writeHeaders2(),
		        body: JSON.stringify(body)
		      });
		      const extra = typeof patch === "function" ? patch(response) : void 0;
		      publish({
		        ...snapshot,
		        status: "ready",
		        error: null,
		        conflict: false,
		        pendingKey: void 0,
		        pendingAction: void 0,
		        saveErrors: [],
		        ...extra
		      });
		      await quietlyRefresh();
		      try {
		        await onChanged();
		      } catch {
		      }
		      return snapshot;
		    } catch (error) {
		      const message = error instanceof Error ? error.message : String(error);
		      const conflict = error?.status === 409 && error?.reason !== "active-provider";
		      error.conflict = conflict;
		      if (conflict) {
		        try {
		          await performRefresh({ quiet: true });
		        } catch {
		        }
		      }
		      publish({
		        ...snapshot,
		        status: conflict ? "conflict" : "error",
		        error: message,
		        conflict,
		        // Only a save route answers with a per-field list; carrying one from a
		        // delete or activate would put a form's errors on an unrelated dialog.
		        saveErrors: pendingAction === "save" && Array.isArray(error?.errors) ? error.errors : [],
		        pendingKey: void 0,
		        pendingAction: void 0
		      });
		      throw error;
		    }
		  };
		  const controller = {
		    getSnapshot: () => snapshot,
		    subscribe: (listener) => {
		      listeners.add(listener);
		      return () => listeners.delete(listener);
		    },
		    refresh: () => enqueue(() => performRefresh()),
		    /**
		     * The preset catalogue is loaded separately from the provider list because
		     * it is static: a failed load must not break the tab, so it reports beside
		     * the picker instead of through the page's error banner.
		     */
		    loadPresets: () => enqueue(async () => {
		      publish({ ...snapshot, presetsError: null });
		      try {
		        const body = await request(PRESETS_PATH);
		        publish({ ...snapshot, presets: sanitizePresets(body?.presets), presetsError: null });
		        return snapshot;
		      } catch (error) {
		        publish({ ...snapshot, presetsError: error instanceof Error ? error.message : String(error) });
		        throw error;
		      }
		    }),
		    /**
		     * Create or update one provider.
		     *
		     * `expectedRevision` is the revision the caller read the provider *at*, not
		     * whatever the controller holds now: a refresh that landed while the form
		     * was open means the document moved under the edit, and the Host has to be
		     * able to refuse rather than let the form silently overwrite it.
		     */
		    save: (draft = {}) => enqueue(async () => {
		      const key = optionalText(draft?.key);
		      const provider = isRecord(draft?.provider) ? draft.provider : {};
		      const apiKey = typeof draft?.apiKey === "string" && draft.apiKey !== "" ? draft.apiKey : void 0;
		      const expectedRevision = Number.isInteger(draft?.expectedRevision) ? draft.expectedRevision : snapshot.revision;
		      const body = { provider };
		      if (key !== void 0) body.key = key;
		      if (apiKey !== void 0) body.apiKey = apiKey;
		      if (expectedRevision !== void 0) body.expectedRevision = expectedRevision;
		      return runMutation({ path: SAVE_PATH, body, pendingKey: key, pendingAction: "save" });
		    }),
		    remove: (key, expectedRevision) => enqueue(async () => {
		      const target = optionalText(key);
		      if (target === void 0) throw new Error("remove requires a provider key");
		      const revision = Number.isInteger(expectedRevision) ? expectedRevision : snapshot.revision;
		      const body = { key: target };
		      if (revision !== void 0) body.expectedRevision = revision;
		      return runMutation({ path: DELETE_PATH, body, pendingKey: target, pendingAction: "delete" });
		    }),
		    activate: (key, expectedRevision) => enqueue(async () => {
		      const target = optionalText(key);
		      if (target === void 0) throw new Error("activate requires a provider key");
		      const revision = Number.isInteger(expectedRevision) ? expectedRevision : snapshot.revision;
		      const body = { key: target };
		      if (revision !== void 0) body.expectedRevision = revision;
		      return runMutation({
		        path: ACTIVATE_PATH,
		        body,
		        pendingKey: target,
		        pendingAction: "activate",
		        patch: (response) => ({
		          activation: {
		            key: target,
		            // Only an explicit `applied: false` means DSH did not take it; a
		            // Host that omits the field succeeded.
		            applied: response?.applied !== false,
		            warnings: sanitizeWarnings(response?.warnings)
		          }
		        })
		      });
		    }),
		    dismissActivation: () => {
		      publish({ ...snapshot, activation: void 0 });
		    },
		    /**
		     * Test one row's endpoint without changing anything.
		     *
		     * The probe route reads CC Switch's database and is addressed by the
		     * `profileId` a scan produced, so only a provider that came through an
		     * import can be probed: `sourceProfileId` is that id, written by the
		     * importer. A provider added by hand or from a preset has no such row, and
		     * inventing an id would silently probe whatever provider happened to share
		     * it — so the absence is reported rather than guessed at.
		     *
		     * Resolves `undefined` for a row that cannot be probed or a second click
		     * while one is in flight, matching the importer's `probeOne`: the caller is
		     * an event handler with nothing useful to do about either.
		     */
		    probeOne: async (key) => {
		      const target = optionalText(key);
		      if (target === void 0) return void 0;
		      const provider = snapshot.providers?.[target];
		      if (provider === void 0) return void 0;
		      if (snapshot.probes?.[target]?.phase === "testing") return void 0;
		      const profileId = optionalText(provider.sourceProfileId);
		      if (profileId === void 0) {
		        publish({
		          ...snapshot,
		          probes: { ...snapshot.probes, [target]: { phase: "error", message: "", unprobeable: true } }
		        });
		        return void 0;
		      }
		      const setProbe = (value) => {
		        publish({ ...snapshot, probes: { ...snapshot.probes, [target]: value } });
		      };
		      setProbe({ phase: "testing" });
		      try {
		        const body = await request(PROBE_PATH, {
		          method: "POST",
		          headers: writeHeaders2(),
		          body: JSON.stringify({ profileIds: [profileId] })
		        });
		        const results = Array.isArray(body.results) ? body.results : [];
		        const result = results.find((item) => item.profileId === profileId) ?? results[0];
		        if (result === void 0) {
		          setProbe({ phase: "error", message: "", staleHost: false });
		          return void 0;
		        }
		        setProbe({ phase: "done", ...sanitizeProbe2(result) });
		        return result;
		      } catch (error) {
		        const message = error instanceof Error ? error.message : String(error);
		        setProbe({ phase: "error", message, staleHost: isStaleHost2(message) });
		        return void 0;
		      }
		    },
		    /** Drop one row's verdict, so a stale result cannot outlive its cause. */
		    clearProbe: (key) => {
		      const target = optionalText(key);
		      if (target === void 0) return;
		      publish({ ...snapshot, probes: withoutProbe(snapshot.probes, target) });
		    },
		    /**
		     * Drop the previous attempt's failure before a new one begins.
		     *
		     * Without this, opening a second dialog after a rejected save greets the
		     * user with the errors of the attempt they already abandoned — including
		     * ones naming fields they have since fixed. The stored `saveErrors` outlive
		     * the dialog that produced them, because the controller has no way to know
		     * when a form closes.
		     */
		    clearSaveFeedback: () => {
		      const wasFailed = snapshot.status === "error" || snapshot.status === "conflict";
		      if (!wasFailed && snapshot.error === null && snapshot.conflict === false && snapshot.saveErrors.length === 0) {
		        return;
		      }
		      publish({
		        ...snapshot,
		        // Back to `ready` only from a failed state: a dialog can only be opened
		        // from a table that is on screen, so the read behind it did succeed.
		        status: wasFailed ? "ready" : snapshot.status,
		        error: null,
		        conflict: false,
		        saveErrors: []
		      });
		    }
		  };
		  return controller;
		}

		// src/client/messages.mjs
		var MESSAGES = {
		  zh: {
		    nav: "\u6A21\u578B\u63A8\u7406",
		    "importer.title": "CCSwitch \u5BFC\u5165",
		    "importer.hintExpanded": "\u4ECE\u672C\u673A CCSwitch \u8BFB\u53D6 provider \u914D\u7F6E\u3002",
		    "importer.hintCollapsed": "\u70B9\u51FB\u5C55\u5F00 CCSwitch \u5BFC\u5165\u8BBE\u7F6E",
		    "importer.collapseAria": "\u5C55\u5F00\u6216\u6536\u8D77 CCSwitch \u5BFC\u5165\u9762\u677F",
		    "importer.scan": "\u626B\u63CF",
		    "importer.scanning": "\u5904\u7406\u4E2D\u2026",
		    "importer.importSelected": "\u5BFC\u5165\u9009\u4E2D",
		    "importer.selectAll": "\u5168\u9009",
		    "importer.selectNone": "\u53D6\u6D88\u5168\u9009",
		    "importer.selectedCount": "\u5DF2\u9009 {selected} / {total} \u4E2A\u53EF\u5BFC\u5165",
		    "importer.pendingKey": "\u5F85\u751F\u6210 provider key",
		    "importer.credentialFound": "\u51ED\u636E\u5DF2\u627E\u5230",
		    "importer.credentialMissing": "\u7F3A\u5C11\u51ED\u636E",
		    "importer.noModels": "\u65E0\u6A21\u578B",
		    "importer.empty": "\u6CA1\u6709\u53EF\u8BFB\u53D6\u7684 CCSwitch provider\u3002",
		    "importer.emptyNotInstalled": "\u672A\u68C0\u6D4B\u5230 CC Switch \u6570\u636E\u5E93\uFF08\u5DF2\u67E5\u627E {path}\uFF09\u3002",
		    "importer.emptyNoProfiles": "CC Switch \u6570\u636E\u5E93\u4E2D\u6CA1\u6709\u53EF\u5BFC\u5165\u7684 provider\u3002",
		    "importer.emptyUnreadable": "CC Switch \u6570\u636E\u5E93\u65E0\u6CD5\u8BFB\u53D6\uFF08\u8868\u7ED3\u6784\u5F02\u5E38\u6216\u6587\u4EF6\u635F\u574F\uFF09\u3002",
		    "importer.emptyUnsupportedNode": "\u5F53\u524D Node \u7248\u672C\u65E0\u6CD5\u52A0\u8F7D node:sqlite\uFF0C\u56E0\u6B64\u8BFB\u4E0D\u5230 CC Switch \u6570\u636E\u5E93\u3002",
		    "importer.status.new": "\u5F85\u5BFC\u5165",
		    "importer.status.update": "\u5C06\u66F4\u65B0",
		    "importer.status.unchanged": "\u65E0\u9700\u66F4\u65B0",
		    "importer.status.blocked": "\u5DF2\u963B\u6B62",
		    "importer.status.failed": "\u5931\u8D25",
		    "importer.status.skipped": "\u5DF2\u8DF3\u8FC7",
		    "importer.loading": "\u6B63\u5728\u8BFB\u53D6 CCSwitch \u914D\u7F6E\u2026",
		    "importer.importing": "\u5BFC\u5165\u4E2D\u2026",
		    "importer.resultsTitle": "\u5BFC\u5165\u7ED3\u679C",
		    "importer.resultsClear": "\u6E05\u9664",
		    "importer.resultError": "\u9519\u8BEF\uFF1A{message}",
		    "importer.resultSkipped": "\u672A\u9009\u62E9\uFF0C\u6216\u8BE5\u914D\u7F6E\u4E0D\u53EF\u5BFC\u5165",
		    "importer.blocked.invalid-settings-json": "\u8BBE\u7F6E\u5185\u5BB9\u4E0D\u662F\u5408\u6CD5 JSON",
		    "importer.blocked.unsupported-app-type": "\u4E0D\u652F\u6301\u7684 app \u7C7B\u578B\uFF1A{detail}",
		    "importer.blocked.missing-openai-key": "\u7F3A\u5C11 API key\uFF08auth.OPENAI_API_KEY\uFF09",
		    "importer.blocked.missing-codex-provider": "config \u91CC\u6CA1\u6709\u53EF\u7528\u7684 [model_providers.custom] \u6BB5",
		    "importer.blocked.missing-anthropic-key": "\u7F3A\u5C11 API key\uFF08env.ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY\uFF09",
		    "importer.blocked.missing-anthropic-base-url": "\u7F3A\u5C11 base URL\uFF08env.ANTHROPIC_BASE_URL\uFF09",
		    "importer.blocked.missing-opencode-key": "\u7F3A\u5C11 API key\uFF08options.apiKey\uFF09",
		    "importer.blocked.missing-opencode-base-url": "\u7F3A\u5C11 base URL\uFF08options.baseURL\uFF09",
		    "importer.blocked.unsupported-opencode-adapter": "\u6682\u4E0D\u652F\u6301\u7684 opencode \u9002\u914D\u5668\uFF1A{detail}",
		    "importer.blocked.missing-claude-desktop-key": "\u7F3A\u5C11 API key\uFF08env.ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY\uFF09",
		    "importer.blocked.missing-claude-desktop-base-url": "\u7F3A\u5C11 base URL\uFF08\u9876\u7EA7 baseUrl \u4E0E env.ANTHROPIC_BASE_URL \u90FD\u6CA1\u6709\uFF09",
		    "importer.blocked.unsupported-claude-desktop-protocol": "claude-desktop \u7684 apiFormat \u4E0D\u662F DSH \u652F\u6301\u7684\u534F\u8BAE\uFF1A{detail}",
		    "importer.blocked.unsupported-gemini-protocol": "Gemini CLI \u4F7F\u7528\u539F\u751F\u534F\u8BAE\uFF0CDSH \u6CA1\u6709\u5BF9\u5E94\u9002\u914D\u5668\uFF1A{detail}\uFF1B\u8BF7\u6539\u7528 OpenAI \u517C\u5BB9\u7684 Gemini \u4E2D\u8F6C",
		    "importer.blocked.missing-hermes-key": "\u7F3A\u5C11 API key\uFF08api_key\uFF09",
		    "importer.blocked.missing-hermes-base-url": "\u7F3A\u5C11 base URL\uFF08base_url\uFF09",
		    "importer.blocked.missing-pi-key": "\u7F3A\u5C11 API key\uFF08apiKey\uFF09",
		    "importer.blocked.missing-pi-base-url": "\u7F3A\u5C11 base URL\uFF08baseUrl\uFF09",
		    "importer.blocked.unsupported-pi-api": "pi \u7684 api \u4E0D\u662F DSH \u652F\u6301\u7684\u534F\u8BAE\uFF1A{detail}",
		    "importer.blocked.missing-mcode-key": "\u7F3A\u5C11 API key\uFF08options.apiKey\uFF09",
		    "importer.blocked.missing-mcode-base-url": "\u7F3A\u5C11 base URL\uFF08options.baseURL\uFF09",
		    "importer.blocked.unsupported-mcode-api": "mcode \u7684 api \u4E0D\u662F DSH \u652F\u6301\u7684\u534F\u8BAE\uFF1A{detail}",
		    "importer.blocked.missing-openclaw-key": "\u7F3A\u5C11 API key\uFF08apiKey\uFF09",
		    "importer.blocked.missing-openclaw-base-url": "\u7F3A\u5C11 base URL\uFF08baseUrl\uFF09",
		    "importer.blocked.unsupported-openclaw-api": "openclaw \u7684 api \u4E0D\u662F DSH \u652F\u6301\u7684\u534F\u8BAE\uFF1A{detail}",
		    "importer.blocked.duplicate-provider-key": "\u672C\u6279\u91CC provider \u952E\u91CD\u590D\uFF1A{detail}",
		    "importer.blocked.blocked": "\u8BE5\u914D\u7F6E\u65E0\u6CD5\u5BFC\u5165",
		    "importer.probe.test": "\u6D4B\u8BD5\u8FDE\u63A5",
		    "importer.probe.testAria": "\u6D4B\u8BD5 {name} \u7684\u8FDE\u63A5",
		    "importer.probe.testing": "\u6D4B\u8BD5\u4E2D\u2026",
		    "importer.probe.ok": "\u8FDE\u901A \xB7 {count} \u4E2A\u6A21\u578B \xB7 {ms}ms",
		    "importer.probe.ok-minimal": "\u8FDE\u901A \xB7 \u6700\u5C0F\u8BF7\u6C42 \xB7 {ms}ms",
		    "importer.probe.hostStale": "\u5BBF\u4E3B\u672A\u52A0\u8F7D\u8BE5\u63A5\u53E3\uFF0C\u91CD\u542F DSH \u540E\u91CD\u8BD5",
		    "importer.probe.empty": "\u8FDE\u901A \xB7 \u4E0A\u6E38\u6CA1\u8FD4\u56DE\u6A21\u578B",
		    "importer.probe.http-error": "\u5931\u8D25 \xB7 HTTP {status}",
		    "importer.probe.no-credentials": "\u65E0\u6CD5\u6D4B\u8BD5\uFF1A\u7F3A\u5C11\u51ED\u636E\u6216 base URL",
		    "importer.probe.timeout": "\u5931\u8D25 \xB7 \u8D85\u65F6",
		    "importer.probe.network": "\u5931\u8D25 \xB7 \u7F51\u7EDC\u9519\u8BEF",
		    "importer.probe.requestFailed": "\u5931\u8D25 \xB7 {message}",
		    "reasoning.title": "\u6A21\u578B\u63A8\u7406",
		    "reasoning.intro": "\u4E3A\u81EA\u5B9A\u4E49 provider \u7684\u6BCF\u4E2A\u6A21\u578B\u8BBE\u7F6E\u63A8\u7406\u7B49\u7EA7\u3002",
		    "reasoning.hintExpanded": "\u4E3A\u81EA\u5B9A\u4E49 provider \u7684\u6BCF\u4E2A\u6A21\u578B\u8BBE\u7F6E\u63A8\u7406\u7B49\u7EA7\uFF1B\u4FDD\u5B58\u540E\u5373\u53EF\u5728\u6A21\u578B\u9009\u62E9\u5668\u4E2D\u5207\u6362\u3002",
		    "reasoning.hintCollapsed": "\u70B9\u51FB\u5C55\u5F00\u6A21\u578B\u63A8\u7406\u8BBE\u7F6E",
		    "reasoning.loading": "\u6B63\u5728\u52A0\u8F7D\u6A21\u578B\u63A8\u7406\u8BBE\u7F6E\u2026",
		    "reasoning.empty": "\u6682\u65E0\u81EA\u5B9A\u4E49 provider \u6A21\u578B\u3002",
		    "reasoning.modelCount": "{count} \u4E2A\u6A21\u578B",
		    "reasoning.mode": "\u63A8\u7406\u6A21\u5F0F",
		    "reasoning.modeDisabled": "\u5173\u95ED",
		    "reasoning.modeEnabled": "\u542F\u7528",
		    "reasoning.modeAria": "{model} \u63A8\u7406\u6A21\u5F0F",
		    "reasoning.expand": "\u5C55\u5F00",
		    "reasoning.collapse": "\u6536\u8D77",
		    "reasoning.collapseAria": "{action} {model} \u63A8\u7406\u8BBE\u7F6E",
		    "reasoning.levelsAria": "{model} \u53EF\u7528\u63A8\u7406\u7B49\u7EA7",
		    "reasoning.levelsHeading": "\u53EF\u7528\u7B49\u7EA7",
		    "reasoning.levelsSelected": "\u5DF2\u9009 {count} \u9879",
		    "reasoning.customShow": "\u81EA\u5B9A\u4E49 wire \u503C",
		    "reasoning.customHide": "\u6536\u8D77\u81EA\u5B9A\u4E49\u6620\u5C04",
		    "reasoning.customNullPlaceholder": "\u7559\u7A7A\u8868\u793A null",
		    "reasoning.customWireAria": "{model} {level} wire \u503C",
		    "reasoning.remoteUpdated": "\u8FDC\u7AEF\u5DF2\u66F4\u65B0",
		    "reasoning.unsaved": "\u6709\u672A\u4FDD\u5B58\u7684\u6539\u52A8",
		    "reasoning.discard": "\u64A4\u9500\u6539\u52A8",
		    "reasoning.discardTitle": "\u653E\u5F03\u5C1A\u672A\u4FDD\u5B58\u7684\u7F16\u8F91",
		    "reasoning.reloadDirty": "\u4E22\u5F03\u672C\u5730\u6539\u52A8\u5E76\u91CD\u65B0\u8F7D\u5165",
		    "reasoning.customMarker": "\u5DF2\u81EA\u5B9A\u4E49 {count} \u9879",
		    "reasoning.reload": "\u91CD\u65B0\u8F7D\u5165",
		    "reasoning.save": "\u4FDD\u5B58",
		    "reasoning.saving": "\u4FDD\u5B58\u4E2D\u2026",
		    "reasoning.saved": "\u5DF2\u4FDD\u5B58",
		    "reasoning.savedDirty": "\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u4ECD\u6709\u672A\u4FDD\u5B58\u7684\u6539\u52A8",
		    "reasoning.saveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF1A{message}",
		    "manager.title": "\u4F9B\u5E94\u5546\u7BA1\u7406",
		    "manager.hintExpanded": "\u76F4\u63A5\u7BA1\u7406\u672C\u63D2\u4EF6\u62E5\u6709\u7684 provider\uFF1A\u65B0\u589E\u3001\u7F16\u8F91\u3001\u590D\u5236\u3001\u5220\u9664\u3001\u542F\u7528\u3002",
		    "manager.loading": "\u6B63\u5728\u8BFB\u53D6 provider \u5217\u8868\u2026",
		    "manager.refresh": "\u5237\u65B0",
		    "manager.refreshing": "\u5237\u65B0\u4E2D\u2026",
		    "manager.empty": "\u8FD8\u6CA1\u6709 provider\uFF0C\u70B9\u51FB\u300C\u65B0\u589E provider\u300D\u5F00\u59CB\u3002",
		    "manager.emptyNoNamespace": "\u672C\u63D2\u4EF6\u5C1A\u672A\u521B\u5EFA\u8BBE\u7F6E\u547D\u540D\u7A7A\u95F4\uFF1B\u6DFB\u52A0\u7B2C\u4E00\u4E2A provider \u65F6\u4F1A\u4E00\u5E76\u521B\u5EFA\u3002",
		    "manager.add": "\u65B0\u589E provider",
		    "manager.presetLabel": "\u9884\u8BBE",
		    "manager.presetNone": "\u81EA\u5B9A\u4E49\uFF08\u7A7A\u767D\uFF09",
		    "manager.presetsFailed": "\u9884\u8BBE\u5217\u8868\u52A0\u8F7D\u5931\u8D25\uFF1A{message}",
		    "manager.probeUnprobeable": "\u65E0\u6CD5\u6D4B\u8BD5\uFF1A\u8BE5 provider \u4E0D\u662F\u4ECE CC Switch \u5BFC\u5165\u7684\uFF0C\u6CA1\u6709\u53EF\u63A2\u6D4B\u7684\u6E90\u8BB0\u5F55",
		    "manager.searchPlaceholder": "\u6309\u540D\u79F0/\u5907\u6CE8/\u8BF7\u6C42\u5730\u5740\u641C\u7D22\u4F9B\u5E94\u5546\u2026",
		    "manager.searchAriaLabel": "\u641C\u7D22\u4F9B\u5E94\u5546",
		    "manager.searchClear": "\u6E05\u9664",
		    "manager.noSearchResults": "\u6CA1\u6709\u7B26\u5408\u641C\u7D22\u6761\u4EF6\u7684\u4F9B\u5E94\u5546\u3002",
		    // The five sections CC Switch's "add provider" list is grouped into
		    // (`presetGroups.ts`, `PRESET_GROUP_ORDER`), and the two dimensions its
		    // version control picks between (`presetVersionLabel`: plan · region).
		    // Wording follows CC Switch's own zh/en catalogue so the two read alike.
		    "manager.group.login": "\u8D26\u53F7\u767B\u5F55",
		    "manager.group.vendor": "\u6A21\u578B\u5382\u5546",
		    "manager.group.thirdparty": "\u7B2C\u4E09\u65B9\u5E73\u53F0",
		    "manager.group.cloud": "\u4E91\u670D\u52A1\u5546",
		    "manager.group.plugin": "\u63D2\u4EF6\u914D\u7F6E",
		    "manager.plan.payg": "\u6309\u91CF\u4ED8\u8D39",
		    "manager.plan.coding": "\u7F16\u7A0B\u8BA2\u9605",
		    "manager.plan.codingPlan": "Coding Plan",
		    "manager.plan.agentPlan": "Agent Plan",
		    "manager.plan.tokenPlan": "Token Plan",
		    "manager.plan.enterpriseLite": "\u4F01\u4E1A Lite",
		    "manager.plan.enterprisePro": "\u4F01\u4E1A Pro",
		    "manager.plan.stepPlan": "Step Plan",
		    "manager.plan.aksk": "AKSK",
		    "manager.plan.apiKey": "API Key",
		    "manager.region.cn": "\u56FD\u5185",
		    "manager.region.intl": "\u6D77\u5916",
		    "manager.credentialFound": "\u51ED\u636E\u5DF2\u627E\u5230",
		    "manager.credentialMissing": "\u7F3A\u5C11\u51ED\u636E",
		    "manager.active": "\u5F53\u524D\u542F\u7528",
		    "manager.modelCount": "{count} \u4E2A\u6A21\u578B",
		    "manager.noModels": "\u65E0\u6A21\u578B",
		    "manager.failover": "\u6545\u969C\u8F6C\u79FB\u961F\u5217",
		    "manager.activate": "\u542F\u7528",
		    "manager.activating": "\u542F\u7528\u4E2D\u2026",
		    "manager.edit": "\u7F16\u8F91",
		    "manager.duplicate": "\u590D\u5236",
		    "manager.delete": "\u5220\u9664",
		    "manager.deleting": "\u5220\u9664\u4E2D\u2026",
		    "manager.saving": "\u4FDD\u5B58\u4E2D\u2026",
		    "manager.deleteConfirm": "\u786E\u5B9A\u5220\u9664 provider\u300C{name}\u300D\uFF1F\u8BE5\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002",
		    "manager.activateAria": "\u542F\u7528 {name}",
		    "manager.editAria": "\u7F16\u8F91 {name}",
		    "manager.duplicateAria": "\u590D\u5236 {name}",
		    "manager.deleteAria": "\u5220\u9664 {name}",
		    "manager.rowActionsAria": "{name} \u7684\u64CD\u4F5C",
		    "manager.activated": "\u5DF2\u542F\u7528 {name}",
		    "manager.activatedNotApplied": "\u5DF2\u6807\u8BB0\u4E3A\u542F\u7528\uFF0C\u4F46 DSH \u6CA1\u6709\u63A5\u53D7\u8BE5 provider\uFF0C\u6A21\u578B\u8BF7\u6C42\u4ECD\u8D70\u539F\u6765\u7684\u8DEF\u7531\u3002",
		    "manager.activationWarnings": "\u542F\u7528\u63D0\u793A",
		    "manager.dismiss": "\u77E5\u9053\u4E86",
		    "manager.conflict": "\u8BBE\u7F6E\u6587\u6863\u5DF2\u88AB\u5176\u4ED6\u5730\u65B9\u6539\u52A8\uFF0C\u5217\u8868\u5DF2\u5237\u65B0\uFF0C\u8BF7\u91CD\u8BD5\u3002",
		    "manager.saveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF1A{message}",
		    "manager.deleteFailed": "\u5220\u9664\u5931\u8D25\uFF1A{message}",
		    "manager.deleteActive": "\u8BE5 provider \u6B63\u5728\u4F7F\u7528\u4E2D\uFF0C\u8BF7\u5148\u542F\u7528\u5176\u4ED6 provider \u518D\u5220\u9664\u3002",
		    "manager.activateFailed": "\u542F\u7528\u5931\u8D25\uFF1A{message}",
		    "manager.createTitle": "\u65B0\u589E provider",
		    "manager.editTitle": "\u7F16\u8F91 provider",
		    "manager.close": "\u5173\u95ED",
		    "manager.fieldDisplayName": "\u540D\u79F0",
		    "manager.fieldApi": "\u534F\u8BAE",
		    "manager.fieldBaseUrl": "Base URL",
		    "manager.fieldApiKey": "API Key",
		    "manager.apiKeyHint": "\u7559\u7A7A\u8868\u793A\u4FDD\u6301\u5F53\u524D\u5BC6\u94A5\u4E0D\u53D8\u3002",
		    "manager.apiKeyStored": "\u5DF2\u5B58\u6709\u4E00\u4E2A\u5BC6\u94A5\uFF0C\u6B64\u5904\u4E0D\u4F1A\u56DE\u663E\u3002",
		    "manager.fieldNotes": "\u5907\u6CE8",
		    "manager.fieldIcon": "\u56FE\u6807",
		    "manager.fieldIconColor": "\u56FE\u6807\u989C\u8272",
		    "manager.fieldCostMultiplier": "\u8D39\u7528\u500D\u7387",
		    "manager.fieldLimitDaily": "\u6BCF\u65E5\u9650\u989D\uFF08USD\uFF09",
		    "manager.fieldLimitMonthly": "\u6BCF\u6708\u9650\u989D\uFF08USD\uFF09",
		    "manager.fieldFailover": "\u52A0\u5165\u6545\u969C\u8F6C\u79FB\u961F\u5217",
		    "manager.modelsHeading": "\u6A21\u578B",
		    "manager.modelId": "\u6A21\u578B ID",
		    "manager.modelName": "\u663E\u793A\u540D",
		    "manager.modelContext": "\u4E0A\u4E0B\u6587\u7A97\u53E3",
		    "manager.modelMaxTokens": "\u6700\u5927\u8F93\u51FA token",
		    "manager.modelAdd": "\u6DFB\u52A0\u6A21\u578B",
		    "manager.modelRemove": "\u79FB\u9664",
		    "manager.modelRemoveAria": "\u79FB\u9664\u6A21\u578B {id}",
		    "manager.modelRowAria": "\u7B2C {index} \u4E2A\u6A21\u578B",
		    "manager.validationTitle": "\u8BF7\u4FEE\u6B63\u4EE5\u4E0B\u95EE\u9898\uFF1A",
		    "manager.error.displayName-required": "\u8BF7\u586B\u5199\u540D\u79F0\u3002",
		    "manager.error.api-required": "\u8BF7\u9009\u62E9\u534F\u8BAE\u3002",
		    "manager.error.baseURL-required": "\u8BF7\u586B\u5199 Base URL\u3002",
		    "manager.error.baseURL-invalid": "Base URL \u4E0D\u662F\u5408\u6CD5\u7F51\u5740\uFF1A{detail}",
		    "manager.error.models-required": "\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u6A21\u578B\uFF0C\u4E14\u6A21\u578B ID \u4E0D\u80FD\u4E3A\u7A7A\u3002",
		    "manager.error.model-id-required": "\u7B2C {detail} \u4E2A\u6A21\u578B\u7F3A\u5C11 ID\u3002",
		    "manager.error.costMultiplier-invalid": "\u8D39\u7528\u500D\u7387\u5FC5\u987B\u662F\u4E0D\u5C0F\u4E8E 0 \u7684\u6570\u5B57\uFF1A{detail}",
		    "manager.error.limitDailyUsd-invalid": "\u6BCF\u65E5\u9650\u989D\u5FC5\u987B\u662F\u4E0D\u5C0F\u4E8E 0 \u7684\u6570\u5B57\uFF1A{detail}",
		    "manager.error.limitMonthlyUsd-invalid": "\u6BCF\u6708\u9650\u989D\u5FC5\u987B\u662F\u4E0D\u5C0F\u4E8E 0 \u7684\u6570\u5B57\uFF1A{detail}",
		    "manager.save": "\u4FDD\u5B58",
		    "manager.cancel": "\u53D6\u6D88"
		  },
		  en: {
		    nav: "Model reasoning",
		    "importer.title": "CCSwitch import",
		    "importer.hintExpanded": "Read provider configuration from the local CCSwitch installation.",
		    "importer.hintCollapsed": "Click to expand the CCSwitch import settings",
		    "importer.collapseAria": "Expand or collapse the CCSwitch import panel",
		    "importer.scan": "Scan",
		    "importer.scanning": "Working\u2026",
		    "importer.importSelected": "Import selected",
		    "importer.selectAll": "Select all",
		    "importer.selectNone": "Clear selection",
		    "importer.selectedCount": "{selected} of {total} importable selected",
		    "importer.pendingKey": "provider key pending",
		    "importer.credentialFound": "credential found",
		    "importer.credentialMissing": "credential missing",
		    "importer.noModels": "no models",
		    "importer.empty": "No readable CCSwitch providers.",
		    "importer.emptyNotInstalled": "No CC Switch database found (looked in {path}).",
		    "importer.emptyNoProfiles": "The CC Switch database has no importable providers.",
		    "importer.emptyUnreadable": "The CC Switch database could not be read (unexpected schema or corrupt file).",
		    "importer.emptyUnsupportedNode": "This Node version cannot load node:sqlite, so the CC Switch database cannot be read.",
		    "importer.status.new": "ready",
		    "importer.status.update": "will update",
		    "importer.status.unchanged": "up to date",
		    "importer.status.blocked": "blocked",
		    "importer.status.failed": "failed",
		    "importer.status.skipped": "skipped",
		    "importer.loading": "Reading CCSwitch configuration\u2026",
		    "importer.importing": "Importing\u2026",
		    "importer.resultsTitle": "Import results",
		    "importer.resultsClear": "Clear",
		    "importer.resultError": "error: {message}",
		    "importer.resultSkipped": "not selected, or not importable",
		    "importer.blocked.invalid-settings-json": "settings content is not valid JSON",
		    "importer.blocked.unsupported-app-type": "unsupported app type: {detail}",
		    "importer.blocked.missing-openai-key": "missing API key (auth.OPENAI_API_KEY)",
		    "importer.blocked.missing-codex-provider": "no usable [model_providers.custom] section in config",
		    "importer.blocked.missing-anthropic-key": "missing API key (env.ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY)",
		    "importer.blocked.missing-anthropic-base-url": "missing base URL (env.ANTHROPIC_BASE_URL)",
		    "importer.blocked.missing-opencode-key": "missing API key (options.apiKey)",
		    "importer.blocked.missing-opencode-base-url": "missing base URL (options.baseURL)",
		    "importer.blocked.unsupported-opencode-adapter": "unsupported opencode adapter: {detail}",
		    "importer.blocked.missing-claude-desktop-key": "missing API key (env.ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY)",
		    "importer.blocked.missing-claude-desktop-base-url": "missing base URL (neither top-level baseUrl nor env.ANTHROPIC_BASE_URL)",
		    "importer.blocked.unsupported-claude-desktop-protocol": "claude-desktop's apiFormat is not a protocol DSH supports: {detail}",
		    "importer.blocked.unsupported-gemini-protocol": "the Gemini CLI speaks the Gemini-native protocol and DSH has no adapter for it: {detail}; use an OpenAI-compatible Gemini relay instead",
		    "importer.blocked.missing-hermes-key": "missing API key (api_key)",
		    "importer.blocked.missing-hermes-base-url": "missing base URL (base_url)",
		    "importer.blocked.missing-pi-key": "missing API key (apiKey)",
		    "importer.blocked.missing-pi-base-url": "missing base URL (baseUrl)",
		    "importer.blocked.unsupported-pi-api": "pi api is not a protocol DSH supports: {detail}",
		    "importer.blocked.missing-mcode-key": "missing API key (options.apiKey)",
		    "importer.blocked.missing-mcode-base-url": "missing base URL (options.baseURL)",
		    "importer.blocked.unsupported-mcode-api": "mcode api is not a protocol DSH supports: {detail}",
		    "importer.blocked.missing-openclaw-key": "missing API key (apiKey)",
		    "importer.blocked.missing-openclaw-base-url": "missing base URL (baseUrl)",
		    "importer.blocked.unsupported-openclaw-api": "openclaw api is not a protocol DSH supports: {detail}",
		    "importer.blocked.duplicate-provider-key": "duplicate provider key in this batch: {detail}",
		    "importer.blocked.blocked": "this profile cannot be imported",
		    "importer.probe.test": "Test connection",
		    "importer.probe.testAria": "Test the connection for {name}",
		    "importer.probe.testing": "Testing\u2026",
		    "importer.probe.ok": "connected \xB7 {count} models \xB7 {ms}ms",
		    "importer.probe.ok-minimal": "connected \xB7 minimal request \xB7 {ms}ms",
		    "importer.probe.hostStale": "the host has not loaded this endpoint \u2014 restart DSH",
		    "importer.probe.empty": "connected \xB7 upstream returned no models",
		    "importer.probe.http-error": "failed \xB7 HTTP {status}",
		    "importer.probe.no-credentials": "cannot test: missing credential or base URL",
		    "importer.probe.timeout": "failed \xB7 timed out",
		    "importer.probe.network": "failed \xB7 network error",
		    "importer.probe.requestFailed": "failed \xB7 {message}",
		    "reasoning.title": "Model reasoning",
		    "reasoning.intro": "Configure reasoning levels for every model of your custom providers.",
		    "reasoning.hintExpanded": "Configure reasoning levels per model; they become selectable in the model picker after saving.",
		    "reasoning.hintCollapsed": "Click to expand the model reasoning settings",
		    "reasoning.loading": "Loading model reasoning settings\u2026",
		    "reasoning.empty": "No custom provider models yet.",
		    "reasoning.modelCount": "{count} models",
		    "reasoning.mode": "Reasoning mode",
		    "reasoning.modeDisabled": "Off",
		    "reasoning.modeEnabled": "On",
		    "reasoning.modeAria": "Reasoning mode for {model}",
		    "reasoning.expand": "Expand",
		    "reasoning.collapse": "Collapse",
		    "reasoning.collapseAria": "{action} reasoning settings for {model}",
		    "reasoning.levelsAria": "Available reasoning levels for {model}",
		    "reasoning.levelsHeading": "Available levels",
		    "reasoning.levelsSelected": "{count} selected",
		    "reasoning.customShow": "Custom wire values",
		    "reasoning.customHide": "Hide custom mapping",
		    "reasoning.customNullPlaceholder": "empty means null",
		    "reasoning.customWireAria": "{model} {level} wire value",
		    "reasoning.remoteUpdated": "updated on the remote",
		    "reasoning.unsaved": "Unsaved changes",
		    "reasoning.discard": "Discard",
		    "reasoning.discardTitle": "Drop the edits that are not saved yet",
		    "reasoning.reloadDirty": "Discard local changes and reload",
		    "reasoning.customMarker": "{count} custom",
		    "reasoning.reload": "Reload",
		    "reasoning.save": "Save",
		    "reasoning.saving": "Saving\u2026",
		    "reasoning.saved": "Saved",
		    "reasoning.savedDirty": "Saved, but newer edits are still unsaved",
		    "reasoning.saveFailed": "Save failed: {message}",
		    "manager.title": "Provider manager",
		    "manager.hintExpanded": "Manage the providers this plugin owns: add, edit, duplicate, delete, activate.",
		    "manager.loading": "Loading providers\u2026",
		    "manager.refresh": "Refresh",
		    "manager.refreshing": "Refreshing\u2026",
		    "manager.empty": "No providers yet \u2014 use \u201CAdd provider\u201D to create one.",
		    "manager.emptyNoNamespace": "This plugin has no settings namespace yet; adding the first provider creates it.",
		    "manager.add": "Add provider",
		    "manager.presetLabel": "Preset",
		    "manager.presetNone": "Custom (blank)",
		    "manager.presetsFailed": "Could not load presets: {message}",
		    "manager.probeUnprobeable": "Cannot test: this provider was not imported from CC Switch, so it has no source record to probe",
		    "manager.searchPlaceholder": "Search name, notes, or API address\u2026",
		    "manager.searchAriaLabel": "Search providers",
		    "manager.searchClear": "Clear",
		    "manager.noSearchResults": "No providers match your search.",
		    "manager.group.login": "Account sign-in",
		    "manager.group.vendor": "Model vendors",
		    "manager.group.thirdparty": "Third-party platforms",
		    "manager.group.cloud": "Cloud providers",
		    "manager.group.plugin": "Plugin configs",
		    "manager.plan.payg": "Pay-as-you-go",
		    "manager.plan.coding": "Coding subscription",
		    "manager.plan.codingPlan": "Coding Plan",
		    "manager.plan.agentPlan": "Agent Plan",
		    "manager.plan.tokenPlan": "Token Plan",
		    "manager.plan.enterpriseLite": "Enterprise Lite",
		    "manager.plan.enterprisePro": "Enterprise Pro",
		    "manager.plan.stepPlan": "Step Plan",
		    "manager.plan.aksk": "AKSK",
		    "manager.plan.apiKey": "API Key",
		    "manager.region.cn": "China",
		    "manager.region.intl": "Global",
		    "manager.credentialFound": "credential found",
		    "manager.credentialMissing": "credential missing",
		    "manager.active": "active",
		    "manager.modelCount": "{count} models",
		    "manager.noModels": "no models",
		    "manager.failover": "failover queue",
		    "manager.activate": "Activate",
		    "manager.activating": "Activating\u2026",
		    "manager.edit": "Edit",
		    "manager.duplicate": "Duplicate",
		    "manager.delete": "Delete",
		    "manager.deleting": "Deleting\u2026",
		    "manager.saving": "Saving\u2026",
		    "manager.deleteConfirm": "Delete the provider \u201C{name}\u201D? This cannot be undone.",
		    "manager.activateAria": "Activate {name}",
		    "manager.editAria": "Edit {name}",
		    "manager.duplicateAria": "Duplicate {name}",
		    "manager.deleteAria": "Delete {name}",
		    "manager.rowActionsAria": "Actions for {name}",
		    "manager.activated": "Activated {name}",
		    "manager.activatedNotApplied": "Marked active, but DSH did not accept the provider \u2014 requests still use the previous route.",
		    "manager.activationWarnings": "Activation notes",
		    "manager.dismiss": "Dismiss",
		    "manager.conflict": "The settings document changed elsewhere. The list has been reloaded \u2014 please retry.",
		    "manager.saveFailed": "Save failed: {message}",
		    "manager.deleteFailed": "Delete failed: {message}",
		    "manager.deleteActive": "This provider is active. Activate another one before deleting it.",
		    "manager.activateFailed": "Activate failed: {message}",
		    "manager.createTitle": "Add provider",
		    "manager.editTitle": "Edit provider",
		    "manager.close": "Close",
		    "manager.fieldDisplayName": "Name",
		    "manager.fieldApi": "Protocol",
		    "manager.fieldBaseUrl": "Base URL",
		    "manager.fieldApiKey": "API key",
		    "manager.apiKeyHint": "Leave blank to keep the current key.",
		    "manager.apiKeyStored": "A key is already stored; it is never shown here.",
		    "manager.fieldNotes": "Notes",
		    "manager.fieldIcon": "Icon",
		    "manager.fieldIconColor": "Icon colour",
		    "manager.fieldCostMultiplier": "Cost multiplier",
		    "manager.fieldLimitDaily": "Daily limit (USD)",
		    "manager.fieldLimitMonthly": "Monthly limit (USD)",
		    "manager.fieldFailover": "Add to the failover queue",
		    "manager.modelsHeading": "Models",
		    "manager.modelId": "Model id",
		    "manager.modelName": "Display name",
		    "manager.modelContext": "Context window",
		    "manager.modelMaxTokens": "Max output tokens",
		    "manager.modelAdd": "Add model",
		    "manager.modelRemove": "Remove",
		    "manager.modelRemoveAria": "Remove model {id}",
		    "manager.modelRowAria": "Model {index}",
		    "manager.validationTitle": "Fix these problems:",
		    "manager.error.displayName-required": "A name is required.",
		    "manager.error.api-required": "A protocol is required.",
		    "manager.error.baseURL-required": "A base URL is required.",
		    "manager.error.baseURL-invalid": "The base URL is not a valid URL: {detail}",
		    "manager.error.models-required": "At least one model is required, and its id must not be empty.",
		    "manager.error.model-id-required": "Model {detail} has no id.",
		    "manager.error.costMultiplier-invalid": "The cost multiplier must be a number \u2265 0: {detail}",
		    "manager.error.limitDailyUsd-invalid": "The daily limit must be a number \u2265 0: {detail}",
		    "manager.error.limitMonthlyUsd-invalid": "The monthly limit must be a number \u2265 0: {detail}",
		    "manager.save": "Save",
		    "manager.cancel": "Cancel"
		  }
		};
		var DEFAULT_LOCALE = "zh";

		// src/client/i18n.mjs
		function makeTranslator(t) {
		  return function translate(key, fallback, params) {
		    let template;
		    try {
		      template = typeof t === "function" ? t(key) : void 0;
		    } catch {
		      template = void 0;
		    }
		    if (typeof template !== "string" || template.length === 0) template = fallback;
		    if (typeof template !== "string" || template.length === 0) return key;
		    if (!params) return template;
		    return template.replace(/\{(\w+)\}/g, (match, name2) => Object.hasOwn(params, name2) ? String(params[name2]) : match);
		  };
		}
		function messagesFor(locale) {
		  return MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
		}

		// src/client/registration.mjs
		var MODELS_FOOTER_SLOT = "settings.models.footer";
		var PLUGINS_TAB_SLOT = "settings.plugins.tab";
		function registerReasoningSettings(ctx, { controller, importer, manager, managerComponent, component, t }) {
		  ctx.locale?.register?.("dsh-ccswitch-plugin", MESSAGES);
		  ctx.slots.inject(MODELS_FOOTER_SLOT, () => ctx.slots.register({
		    name: MODELS_FOOTER_SLOT,
		    id: "ccswitch-importer",
		    order: 10,
		    inject: () => ({ controller, importer, slots: ctx.slots, t })
		  }, component));
		  if (manager && managerComponent) {
		    const tr = makeTranslator(t);
		    ctx.slots.inject(PLUGINS_TAB_SLOT, () => ctx.slots.register({
		      name: PLUGINS_TAB_SLOT,
		      id: "ccswitch-manager",
		      // 10 is taken by the importer's footer cell and by other plugins' tabs;
		      // 20 keeps this tab after them without colliding.
		      order: 20,
		      // A thunk, so the tab title follows the active locale: the owner
		      // re-reads it per render and never subscribes locale state itself.
		      label: () => tr("manager.title", "Provider manager"),
		      inject: () => ({ controller: manager, t })
		    }, managerComponent));
		  }
		  const refreshImporter = () => {
		    const result = importer?.scan?.();
		    if (result?.catch) void result.catch(() => {
		    });
		  };
		  const refreshManager = () => {
		    const result = manager?.refresh?.();
		    if (result?.catch) void result.catch(() => {
		    });
		  };
		  const listen = (event, handler) => {
		    try {
		      const dispose = ctx.remote.$on(event, handler);
		      return typeof dispose === "function" ? dispose : () => {
		      };
		    } catch {
		      return () => {
		      };
		    }
		  };
		  const disposers = [
		    listen("settings/document-updated", () => {
		      void controller.refresh();
		      refreshManager();
		    }),
		    listen("llm/adapters-updated", () => {
		      void controller.refresh();
		      refreshManager();
		    }),
		    listen("credentials/record-updated", refreshImporter),
		    listen("credentials/reference-updated", refreshImporter)
		  ];
		  return () => disposers.forEach((dispose) => dispose());
		}

		// src/ui/ModelsFooterPanel.mjs
		var import_react3 = __toESM(require("react"), 1);

		// src/ui/ReasoningSettingsSection.mjs
		var import_react = __toESM(require("react"), 1);

		// src/ui/reasoning-editor-state.mjs
		function draftForModel(model) {
		  if (model.reasoningEfforts === false) return { mode: "disabled", efforts: {} };
		  if (model.reasoningEfforts && typeof model.reasoningEfforts === "object") {
		    return { mode: "enabled", efforts: { ...model.reasoningEfforts } };
		  }
		  const inferred = reasoningStateForModel(model.id);
		  return { mode: inferred.mode, efforts: { ...inferred.efforts ?? {} } };
		}
		function draftSignature(draft) {
		  const efforts = Object.entries(draft.efforts ?? {}).sort(([left], [right]) => left.localeCompare(right));
		  return JSON.stringify([draft.mode, efforts]);
		}
		function reconcileDraft({ draft, baseline, baselineRevision, remoteModel, remoteRevision, remoteChanged }) {
		  const remoteDraft = draftForModel(remoteModel);
		  const remoteSignature = draftSignature(remoteDraft);
		  const baselineSignature = draftSignature(baseline);
		  const draftIsClean = draftSignature(draft) === baselineSignature;
		  if (remoteSignature === baselineSignature) {
		    return { draft, baseline, baselineRevision: remoteRevision, remoteChanged: false };
		  }
		  if (draftIsClean) {
		    return { draft: remoteDraft, baseline: remoteDraft, baselineRevision: remoteRevision, remoteChanged: false };
		  }
		  return { draft, baseline, baselineRevision, remoteChanged: true };
		}
		function rebaseDraft({ draft, savedModel, savedRevision }) {
		  const baseline = draftForModel(savedModel);
		  return { draft, baseline, baselineRevision: savedRevision, remoteChanged: false };
		}
		function reloadDraft({ remoteModel, remoteRevision }) {
		  const next = draftForModel(remoteModel);
		  return { draft: next, baseline: next, baselineRevision: remoteRevision, remoteChanged: false };
		}

		// src/ui/collapse-state.mjs
		var COLLAPSE_KEY = "dsh-ccswitch-plugin:collapse:v1";
		var EMPTY = Object.freeze({
		  reasoningPanel: false,
		  importPanel: false,
		  models: /* @__PURE__ */ Object.create(null)
		});
		function isRecord2(value) {
		  return value !== null && typeof value === "object" && !Array.isArray(value);
		}
		function normalizeCollapse(input) {
		  const out = {
		    reasoningPanel: false,
		    importPanel: false,
		    models: /* @__PURE__ */ Object.create(null)
		  };
		  if (!isRecord2(input)) return out;
		  out.reasoningPanel = input.reasoningPanel === true;
		  out.importPanel = input.importPanel === true;
		  if (isRecord2(input.models)) {
		    for (const route of Object.keys(input.models)) {
		      const byModel = input.models[route];
		      if (!isRecord2(byModel)) continue;
		      const normalized = /* @__PURE__ */ Object.create(null);
		      for (const modelId of Object.keys(byModel)) {
		        if (byModel[modelId] === true) normalized[modelId] = true;
		      }
		      out.models[route] = normalized;
		    }
		  }
		  return out;
		}
		function loadCollapse(storage = defaultStorage()) {
		  if (!storage) return EMPTY;
		  try {
		    const raw = storage.getItem(COLLAPSE_KEY);
		    if (raw == null) return EMPTY;
		    return normalizeCollapse(JSON.parse(raw));
		  } catch {
		    return EMPTY;
		  }
		}
		function saveCollapse(state, storage = defaultStorage()) {
		  if (!storage) return false;
		  try {
		    storage.setItem(COLLAPSE_KEY, JSON.stringify(normalizeCollapse(state)));
		    return true;
		  } catch {
		    return false;
		  }
		}
		function withPanelToggled(state, panel) {
		  if (panel !== "reasoningPanel" && panel !== "importPanel") return state;
		  return { ...state, [panel]: state?.[panel] !== true };
		}
		function withModelToggled(state, route, modelId, collapsed) {
		  const models = { ...state.models ?? {} };
		  const byRoute = { ...models[route] ?? {} };
		  if (collapsed) byRoute[modelId] = true;
		  else delete byRoute[modelId];
		  if (Object.keys(byRoute).length === 0) delete models[route];
		  else models[route] = byRoute;
		  return { ...state, models };
		}
		function isModelCollapsed(state, route, modelId) {
		  return state?.models?.[route]?.[modelId] === true;
		}
		function defaultStorage() {
		  try {
		    return typeof localStorage === "undefined" ? null : localStorage;
		  } catch {
		    return null;
		  }
		}

		// src/ui/ReasoningSettingsSection.mjs
		var h = import_react.default.createElement;
		var STATUS_SAVED_DIRTY = "saved-dirty";
		var STATUS_DIRTY = "dirty";
		function displayStatus(status, tr, rawError) {
		  if (status === "saving") return tr("reasoning.saving", "\u4FDD\u5B58\u4E2D\u2026");
		  if (status === "saved") return tr("reasoning.saved", "\u5DF2\u4FDD\u5B58");
		  if (status === STATUS_SAVED_DIRTY) return tr("reasoning.savedDirty", "\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u4ECD\u6709\u672A\u4FDD\u5B58\u7684\u6539\u52A8");
		  if (status === STATUS_DIRTY) return tr("reasoning.unsaved", "\u6709\u672A\u4FDD\u5B58\u7684\u6539\u52A8");
		  if (!status) return "";
		  return tr("reasoning.saveFailed", "\u4FDD\u5B58\u5931\u8D25\uFF1A{message}", { message: rawError ?? status });
		}
		function ModelEditor({ route, model, controller, writable, revision, collapsed = false, onToggleCollapsed, tr }) {
		  const initial = draftForModel(model);
		  const [draft, setDraft] = (0, import_react.useState)(initial);
		  const [baseline, setBaseline] = (0, import_react.useState)(initial);
		  const [baselineRevision, setBaselineRevision] = (0, import_react.useState)(revision);
		  const [remoteChanged, setRemoteChanged] = (0, import_react.useState)(false);
		  const [status, setStatus] = (0, import_react.useState)("");
		  const [saveError, setSaveError] = (0, import_react.useState)("");
		  const [customOpen, setCustomOpen] = (0, import_react.useState)(false);
		  const draftRef = (0, import_react.useRef)(draft);
		  const baselineRef = (0, import_react.useRef)(baseline);
		  const baselineRevisionRef = (0, import_react.useRef)(baselineRevision);
		  const remoteChangedRef = (0, import_react.useRef)(remoteChanged);
		  const saveInFlightRef = (0, import_react.useRef)(false);
		  draftRef.current = draft;
		  baselineRef.current = baseline;
		  baselineRevisionRef.current = baselineRevision;
		  remoteChangedRef.current = remoteChanged;
		  const applyReconciledState = (next) => {
		    const currentDraft = draftRef.current;
		    const currentBaseline = baselineRef.current;
		    if (draftSignature(next.draft) !== draftSignature(currentDraft)) {
		      draftRef.current = next.draft;
		      setDraft(next.draft);
		    }
		    if (draftSignature(next.baseline) !== draftSignature(currentBaseline)) {
		      baselineRef.current = next.baseline;
		      setBaseline(next.baseline);
		    }
		    if (next.baselineRevision !== baselineRevisionRef.current) {
		      baselineRevisionRef.current = next.baselineRevision;
		      setBaselineRevision(next.baselineRevision);
		    }
		    if (next.remoteChanged !== remoteChangedRef.current) {
		      remoteChangedRef.current = next.remoteChanged;
		      setRemoteChanged(next.remoteChanged);
		    }
		  };
		  (0, import_react.useEffect)(() => {
		    const next = reconcileDraft({
		      draft: draftRef.current,
		      baseline: baselineRef.current,
		      baselineRevision: baselineRevisionRef.current,
		      remoteModel: model,
		      remoteRevision: revision,
		      remoteChanged: remoteChangedRef.current
		    });
		    applyReconciledState(next);
		  }, [controller, model.id, model.reasoningEfforts, revision]);
		  const setMode = (mode) => setDraft((current) => ({ ...current, mode }));
		  const toggleLevel = (level, checked) => {
		    setDraft((current) => {
		      const efforts = { ...current.efforts };
		      if (!checked) delete efforts[level];
		      else efforts[level] = level === "off" ? null : level;
		      return { ...current, efforts };
		    });
		  };
		  const dirty = draftSignature(draft) !== draftSignature(baseline);
		  const reload = () => {
		    if (dirty && typeof globalThis.confirm === "function" && !globalThis.confirm(tr("reasoning.reloadDirty", "\u4E22\u5F03\u672C\u5730\u6539\u52A8\u5E76\u91CD\u65B0\u8F7D\u5165"))) {
		      return;
		    }
		    const remoteSnapshot = controller.getSnapshot();
		    const remoteModel = remoteSnapshot.providers[route]?.models?.find((entry) => entry.id === model.id) ?? model;
		    applyReconciledState(reloadDraft({ remoteModel, remoteRevision: remoteSnapshot.revision }));
		    setStatus("");
		    setSaveError("");
		  };
		  const save = async () => {
		    if (saveInFlightRef.current) return;
		    saveInFlightRef.current = true;
		    const draftToSave = draftRef.current;
		    const savingSignature = draftSignature(draftToSave);
		    const savingRevision = baselineRevisionRef.current;
		    setStatus("saving");
		    setSaveError("");
		    try {
		      const nextSnapshot = await controller.save(route, model.id, draftToSave.mode, draftToSave.efforts, savingRevision);
		      const savedModel = nextSnapshot.providers[route]?.models?.find((entry) => entry.id === model.id) ?? model;
		      if (draftSignature(draftRef.current) === savingSignature) {
		        applyReconciledState(reloadDraft({ remoteModel: savedModel, remoteRevision: nextSnapshot.revision }));
		        setStatus("saved");
		      } else {
		        applyReconciledState(rebaseDraft({ draft: draftRef.current, savedModel, savedRevision: nextSnapshot.revision }));
		        setStatus(STATUS_SAVED_DIRTY);
		      }
		    } catch (error) {
		      setSaveError(error instanceof Error ? error.message : String(error));
		      setStatus("error");
		    } finally {
		      saveInFlightRef.current = false;
		    }
		  };
		  const modelName = model.name || model.id;
		  const selectedCount = Object.keys(draft.efforts).length;
		  const customCount = Object.entries(draft.efforts).filter(([level, value]) => {
		    const normalized = value === "" || value === void 0 ? null : value;
		    return normalized !== (level === "off" ? null : level);
		  }).length;
		  const customBodyId = ("dsh-reasoning-custom-" + route + "-" + model.id).replace(/[^a-zA-Z0-9_-]/g, "-");
		  const effectiveStatus = dirty && (status === "saved" || status === "") ? STATUS_DIRTY : status;
		  const statusClass = effectiveStatus === "saving" ? "dsh-reasoning-status dsh-reasoning-status--saving" : effectiveStatus === "saved" ? "dsh-reasoning-status dsh-reasoning-status--success" : effectiveStatus === STATUS_SAVED_DIRTY || effectiveStatus === STATUS_DIRTY ? "dsh-reasoning-status dsh-reasoning-status--dirty" : effectiveStatus ? "dsh-reasoning-status dsh-reasoning-status--error" : "dsh-reasoning-status";
		  return h(
		    "article",
		    { className: "dsh-reasoning-model" + (collapsed ? " dsh-reasoning-model--collapsed" : "") },
		    h(
		      "header",
		      { className: "dsh-reasoning-model__header" },
		      h(
		        "div",
		        { className: "dsh-reasoning-model__identity" },
		        h("strong", null, modelName),
		        model.id !== modelName && h("code", null, model.id)
		      ),
		      h(
		        "div",
		        { className: "dsh-reasoning-model__mode-area" },
		        h("span", { className: "dsh-reasoning-model__mode-label" }, tr("reasoning.mode", "\u63A8\u7406\u6A21\u5F0F")),
		        h(
		          "div",
		          { className: "dsh-reasoning-mode", role: "group", "aria-label": tr("reasoning.modeAria", "{model} \u63A8\u7406\u6A21\u5F0F", { model: model.id }) },
		          h("button", {
		            type: "button",
		            className: draft.mode === "disabled" ? "dsh-reasoning-mode__option dsh-reasoning-mode__option--active" : "dsh-reasoning-mode__option",
		            "aria-pressed": draft.mode === "disabled",
		            disabled: !writable,
		            onClick: () => setMode("disabled")
		          }, tr("reasoning.modeDisabled", "\u5173\u95ED")),
		          h("button", {
		            type: "button",
		            className: draft.mode === "enabled" ? "dsh-reasoning-mode__option dsh-reasoning-mode__option--active" : "dsh-reasoning-mode__option",
		            "aria-pressed": draft.mode === "enabled",
		            disabled: !writable,
		            onClick: () => setMode("enabled")
		          }, tr("reasoning.modeEnabled", "\u542F\u7528"))
		        )
		      ),
		      h("button", {
		        type: "button",
		        className: "dsh-reasoning-collapse",
		        "aria-expanded": !collapsed,
		        "aria-controls": "dsh-reasoning-model-body-" + customBodyId,
		        "aria-label": tr("reasoning.collapseAria", "{action} {model} \u63A8\u7406\u8BBE\u7F6E", {
		          action: collapsed ? tr("reasoning.expand", "\u5C55\u5F00") : tr("reasoning.collapse", "\u6536\u8D77"),
		          model: modelName
		        }),
		        onClick: () => onToggleCollapsed?.(route, model.id, !collapsed)
		      }, h("span", { "aria-hidden": "true" }, collapsed ? "\u2304" : "\u2303"))
		    ),
		    h(
		      "div",
		      { id: "dsh-reasoning-model-body-" + customBodyId, className: "dsh-reasoning-model__body", hidden: collapsed || draft.mode !== "enabled" },
		      h(
		        "div",
		        { className: "dsh-reasoning-levels", "aria-label": tr("reasoning.levelsAria", "{model} \u53EF\u7528\u63A8\u7406\u7B49\u7EA7", { model: model.id }) },
		        h(
		          "div",
		          { className: "dsh-reasoning-levels__heading" },
		          h("span", { className: "dsh-reasoning-levels__label" }, tr("reasoning.levelsHeading", "\u53EF\u7528\u7B49\u7EA7")),
		          h("span", { className: "dsh-reasoning-levels__summary" }, tr("reasoning.levelsSelected", "\u5DF2\u9009 {count} \u9879", { count: selectedCount })),
		          customCount > 0 ? h("span", { className: "dsh-reasoning-levels__custom" }, tr("reasoning.customMarker", "\u5DF2\u81EA\u5B9A\u4E49 {count} \u9879", { count: customCount })) : null
		        ),
		        h(
		          "div",
		          { className: "dsh-reasoning-levels__options" },
		          ...LEVELS.map((level) => {
		            const checked = Object.hasOwn(draft.efforts, level);
		            return h(
		              "label",
		              { key: level, className: "dsh-reasoning-level" + (checked ? " dsh-reasoning-level--active" : "") },
		              h("input", {
		                type: "checkbox",
		                checked,
		                disabled: !writable,
		                onChange: (event) => toggleLevel(level, event.target.checked)
		              }),
		              h("span", null, level)
		            );
		          })
		        )
		      ),
		      h(
		        "div",
		        { className: "dsh-reasoning-custom" },
		        h(
		          "button",
		          {
		            type: "button",
		            className: customOpen ? "dsh-reasoning-custom__toggle dsh-reasoning-custom__toggle--active" : "dsh-reasoning-custom__toggle",
		            "aria-expanded": customOpen,
		            "aria-controls": customBodyId,
		            onClick: () => setCustomOpen((current) => !current)
		          },
		          h("span", null, customOpen ? tr("reasoning.customHide", "\u6536\u8D77\u81EA\u5B9A\u4E49\u6620\u5C04") : tr("reasoning.customShow", "\u81EA\u5B9A\u4E49 wire \u503C")),
		          h("span", { "aria-hidden": "true" }, customOpen ? "\u2303" : "\u2304")
		        ),
		        customOpen && h(
		          "div",
		          { id: customBodyId, className: "dsh-reasoning-custom__body" },
		          ...LEVELS.filter((level) => Object.hasOwn(draft.efforts, level)).map((level) => h(
		            "label",
		            { key: level, className: "dsh-reasoning-custom__field" },
		            h("span", null, level === "off" ? "off" : level),
		            h("input", {
		              type: "text",
		              value: draft.efforts[level] ?? "",
		              placeholder: level === "off" ? tr("reasoning.customNullPlaceholder", "\u7559\u7A7A\u8868\u793A null") : level,
		              disabled: !writable,
		              onChange: (event) => setDraft((current) => ({ ...current, efforts: { ...current.efforts, [level]: event.target.value } })),
		              "aria-label": tr("reasoning.customWireAria", "{model} {level} wire \u503C", { model: model.id, level })
		            })
		          ))
		        )
		      )
		    ),
		    !collapsed && h(
		      "footer",
		      { className: "dsh-reasoning-model__footer" },
		      h("span", { className: "dsh-reasoning-remote-status", role: "status", "aria-live": "polite" }, remoteChanged ? tr("reasoning.remoteUpdated", "\u8FDC\u7AEF\u5DF2\u66F4\u65B0") : ""),
		      remoteChanged && h("button", {
		        className: "dsh-reasoning-reload",
		        type: "button",
		        title: dirty ? tr("reasoning.reloadDirty", "\u4E22\u5F03\u672C\u5730\u6539\u52A8\u5E76\u91CD\u65B0\u8F7D\u5165") : void 0,
		        onClick: reload
		      }, tr("reasoning.reload", "\u91CD\u65B0\u8F7D\u5165")),
		      h("span", { role: "status", "aria-live": "polite", className: statusClass }, displayStatus(effectiveStatus, tr, saveError)),
		      // Saving an unchanged draft costs a settings.write and a full describe()
		      // round trip without changing anything, so the button tracks the draft.
		      h("button", { className: "dsh-reasoning-save", type: "button", disabled: !writable || status === "saving" || !dirty, onClick: save }, status === "saving" ? tr("reasoning.saving", "\u4FDD\u5B58\u4E2D\u2026") : tr("reasoning.save", "\u4FDD\u5B58"))
		    )
		  );
		}
		function renderProvider([route, provider], controller, writable, revision, collapse, onToggleCollapsed, tr) {
		  return h(
		    "section",
		    { key: route, className: "dsh-reasoning-provider" },
		    h(
		      "div",
		      { className: "dsh-reasoning-provider__header" },
		      h("h3", null, route),
		      h("span", null, tr("reasoning.modelCount", "{count} \u4E2A\u6A21\u578B", { count: provider.models.length }))
		    ),
		    h(
		      "div",
		      { className: "dsh-reasoning-provider__models" },
		      ...provider.models.map((model) => h(ModelEditor, {
		        key: model.id,
		        route,
		        model,
		        controller,
		        writable,
		        revision,
		        collapsed: isModelCollapsed(collapse, route, model.id),
		        onToggleCollapsed,
		        tr
		      }))
		    )
		  );
		}
		function ReasoningSettingsSection({ controller, embedded = false, collapse: collapseProp, setCollapse: setCollapseProp, t }) {
		  const tr = makeTranslator(t);
		  const snapshot = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
		  const providers = Object.entries(snapshot.providers).filter(([, provider]) => Array.isArray(provider?.models));
		  const [localCollapse, setLocalCollapse] = (0, import_react.useState)(() => loadCollapse());
		  const collapse = collapseProp ?? localCollapse;
		  const updateCollapse = setCollapseProp ?? setLocalCollapse;
		  const toggleModelCollapsed = (route, modelId, collapsed) => {
		    updateCollapse((current) => {
		      const next = withModelToggled(current, route, modelId, collapsed);
		      saveCollapse(next);
		      return next;
		    });
		  };
		  (0, import_react.useEffect)(() => {
		    if (snapshot.status === "idle") void controller.refresh();
		  }, [controller, snapshot.status]);
		  if (snapshot.status === "loading" && providers.length === 0) return h("p", null, tr("reasoning.loading", "\u6B63\u5728\u52A0\u8F7D\u6A21\u578B\u63A8\u7406\u8BBE\u7F6E\u2026"));
		  if (snapshot.status === "error") return h("p", { role: "alert" }, snapshot.error);
		  return h(
		    "section",
		    { className: embedded ? "dsh-reasoning-settings dsh-reasoning-settings--embedded" : "dsh-reasoning-settings" },
		    !embedded && h(
		      "header",
		      null,
		      h("h2", null, tr("reasoning.title", "\u6A21\u578B\u63A8\u7406")),
		      h("p", null, tr("reasoning.intro", "\u4E3A\u81EA\u5B9A\u4E49 provider \u7684\u6BCF\u4E2A\u6A21\u578B\u8BBE\u7F6E\u63A8\u7406\u7B49\u7EA7\u3002"))
		    ),
		    providers.length === 0 ? h("p", null, tr("reasoning.empty", "\u6682\u65E0\u81EA\u5B9A\u4E49 provider \u6A21\u578B\u3002")) : providers.map((entry) => renderProvider(entry, controller, snapshot.writable, snapshot.revision, collapse, toggleModelCollapsed, tr))
		  );
		}

		// src/ui/CCSwitchImportSection.mjs
		var import_react2 = __toESM(require("react"), 1);
		var h2 = import_react2.default.createElement;
		function isSelectable(profile) {
		  return profile.status !== "blocked" && profile.credential === "found";
		}
		function statusKey(status) {
		  if (status === "new") return "importer.status.new";
		  if (status === "update" || status === "updated") return "importer.status.update";
		  if (status === "unchanged") return "importer.status.unchanged";
		  if (status === "blocked") return "importer.status.blocked";
		  if (status === "failed") return "importer.status.failed";
		  if (status === "skipped") return "importer.status.skipped";
		  return void 0;
		}
		function statusLabel(status, tr) {
		  const key = statusKey(status);
		  return key ? tr(key, status) : status ?? "";
		}
		var SAFE_BADGES = /* @__PURE__ */ new Set(["new", "update", "updated", "unchanged", "blocked", "failed", "skipped"]);
		function badgeClass(status) {
		  const safe = SAFE_BADGES.has(status) ? status : "unchanged";
		  return `dsh-ccswitch-import__badge dsh-ccswitch-import__badge--${safe}`;
		}
		var BLOCKED_FALLBACK = {
		  "invalid-settings-json": "\u8BBE\u7F6E\u5185\u5BB9\u4E0D\u662F\u5408\u6CD5 JSON",
		  "unsupported-app-type": "\u4E0D\u652F\u6301\u7684 app \u7C7B\u578B\uFF1A{detail}",
		  "missing-openai-key": "\u7F3A\u5C11 API key\uFF08auth.OPENAI_API_KEY\uFF09",
		  "missing-codex-provider": "config \u91CC\u6CA1\u6709\u53EF\u7528\u7684 [model_providers.custom] \u6BB5",
		  "missing-anthropic-key": "\u7F3A\u5C11 API key\uFF08env.ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY\uFF09",
		  "missing-anthropic-base-url": "\u7F3A\u5C11 base URL\uFF08env.ANTHROPIC_BASE_URL\uFF09",
		  "missing-claude-desktop-key": "\u7F3A\u5C11 API key\uFF08env.ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY\uFF09",
		  "missing-claude-desktop-base-url": "\u7F3A\u5C11 base URL\uFF08\u9876\u7EA7 baseUrl \u4E0E env.ANTHROPIC_BASE_URL \u90FD\u6CA1\u6709\uFF09",
		  "unsupported-claude-desktop-protocol": "claude-desktop \u7684 apiFormat \u4E0D\u662F DSH \u652F\u6301\u7684\u534F\u8BAE\uFF1A{detail}",
		  "unsupported-gemini-protocol": "Gemini CLI \u4F7F\u7528\u539F\u751F\u534F\u8BAE\uFF0CDSH \u6CA1\u6709\u5BF9\u5E94\u9002\u914D\u5668\uFF1A{detail}\uFF1B\u8BF7\u6539\u7528 OpenAI \u517C\u5BB9\u7684 Gemini \u4E2D\u8F6C",
		  "missing-hermes-key": "\u7F3A\u5C11 API key\uFF08api_key\uFF09",
		  "missing-hermes-base-url": "\u7F3A\u5C11 base URL\uFF08base_url\uFF09",
		  "missing-pi-key": "\u7F3A\u5C11 API key\uFF08apiKey\uFF09",
		  "missing-pi-base-url": "\u7F3A\u5C11 base URL\uFF08baseUrl\uFF09",
		  "unsupported-pi-api": "pi \u7684 api \u4E0D\u662F DSH \u652F\u6301\u7684\u534F\u8BAE\uFF1A{detail}",
		  "missing-mcode-key": "\u7F3A\u5C11 API key\uFF08options.apiKey\uFF09",
		  "missing-mcode-base-url": "\u7F3A\u5C11 base URL\uFF08options.baseURL\uFF09",
		  "unsupported-mcode-api": "mcode \u7684 api \u4E0D\u662F DSH \u652F\u6301\u7684\u534F\u8BAE\uFF1A{detail}",
		  "missing-openclaw-key": "\u7F3A\u5C11 API key\uFF08apiKey\uFF09",
		  "missing-openclaw-base-url": "\u7F3A\u5C11 base URL\uFF08baseUrl\uFF09",
		  "unsupported-openclaw-api": "openclaw \u7684 api \u4E0D\u662F DSH \u652F\u6301\u7684\u534F\u8BAE\uFF1A{detail}",
		  "missing-opencode-key": "\u7F3A\u5C11 API key\uFF08options.apiKey\uFF09",
		  "missing-opencode-base-url": "\u7F3A\u5C11 base URL\uFF08options.baseURL\uFF09",
		  "unsupported-opencode-adapter": "\u6682\u4E0D\u652F\u6301\u7684 opencode \u9002\u914D\u5668\uFF1A{detail}",
		  "duplicate-provider-key": "\u672C\u6279\u91CC provider \u952E\u91CD\u590D\uFF1A{detail}",
		  "blocked": "\u8BE5\u914D\u7F6E\u65E0\u6CD5\u5BFC\u5165"
		};
		function blockedLabel(source, tr) {
		  const code = typeof source?.blockedCode === "string" && BLOCKED_FALLBACK[source.blockedCode] ? source.blockedCode : "blocked";
		  const detail = typeof source?.blockedDetail === "string" ? source.blockedDetail : "";
		  return tr(`importer.blocked.${code}`, BLOCKED_FALLBACK[code], { detail });
		}
		function emptyMessage(snapshot, tr) {
		  const probed = snapshot.probedPath || "~/.cc-switch/cc-switch.db";
		  if (snapshot.source === "not-installed") {
		    return tr("importer.emptyNotInstalled", "\u672A\u68C0\u6D4B\u5230 CC Switch \u6570\u636E\u5E93\uFF08\u5DF2\u67E5\u627E {path}\uFF09\u3002", { path: probed });
		  }
		  if (snapshot.source === "no-profiles") {
		    return tr("importer.emptyNoProfiles", "CC Switch \u6570\u636E\u5E93\u4E2D\u6CA1\u6709\u53EF\u5BFC\u5165\u7684 provider\u3002");
		  }
		  if (snapshot.source === "unreadable") {
		    return tr("importer.emptyUnreadable", "CC Switch \u6570\u636E\u5E93\u65E0\u6CD5\u8BFB\u53D6\uFF08\u8868\u7ED3\u6784\u5F02\u5E38\u6216\u6587\u4EF6\u635F\u574F\uFF09\u3002");
		  }
		  if (snapshot.source === "unsupported-node") {
		    return tr("importer.emptyUnsupportedNode", "\u5F53\u524D Node \u7248\u672C\u65E0\u6CD5\u52A0\u8F7D node:sqlite\uFF0C\u56E0\u6B64\u8BFB\u4E0D\u5230 CC Switch \u6570\u636E\u5E93\u3002");
		  }
		  return tr("importer.empty", "\u6CA1\u6709\u53EF\u8BFB\u53D6\u7684 CCSwitch provider\u3002");
		}
		function resultDetail(result, tr) {
		  if (result.status === "failed") {
		    return result.error ? tr("importer.resultError", "\u9519\u8BEF\uFF1A{message}", { message: result.error }) : "";
		  }
		  if (result.status === "blocked") return blockedLabel(result, tr);
		  if (result.status === "skipped") return tr("importer.resultSkipped", "\u672A\u9009\u62E9\uFF0C\u6216\u8BE5\u914D\u7F6E\u4E0D\u53EF\u5BFC\u5165");
		  return "";
		}
		var PROBE_FALLBACK = {
		  ok: "\u8FDE\u901A \xB7 {count} \u4E2A\u6A21\u578B \xB7 {ms}ms",
		  "ok-minimal": "\u8FDE\u901A \xB7 \u6700\u5C0F\u8BF7\u6C42 \xB7 {ms}ms",
		  empty: "\u8FDE\u901A \xB7 \u4E0A\u6E38\u6CA1\u8FD4\u56DE\u6A21\u578B",
		  "http-error": "\u5931\u8D25 \xB7 HTTP {status}",
		  "no-credentials": "\u65E0\u6CD5\u6D4B\u8BD5\uFF1A\u7F3A\u5C11\u51ED\u636E\u6216 base URL",
		  timeout: "\u5931\u8D25 \xB7 \u8D85\u65F6",
		  network: "\u5931\u8D25 \xB7 \u7F51\u7EDC\u9519\u8BEF"
		};
		function probeLabel(probe, tr) {
		  if (probe?.phase === "error") {
		    const base2 = tr("importer.probe.requestFailed", "\u5931\u8D25 \xB7 {message}", { message: probe.message ?? "" });
		    return probe.staleHost ? `${base2} \xB7 ${tr("importer.probe.hostStale", "\u5BBF\u4E3B\u672A\u52A0\u8F7D\u8BE5\u63A5\u53E3\uFF0C\u91CD\u542F DSH \u540E\u91CD\u8BD5")}` : base2;
		  }
		  const reason = probe?.check === "minimal" && probe?.ok === true ? "ok-minimal" : typeof probe?.reason === "string" && PROBE_FALLBACK[probe.reason] ? probe.reason : "network";
		  const base = tr(`importer.probe.${reason}`, PROBE_FALLBACK[reason], {
		    count: probe?.modelCount ?? 0,
		    ms: probe?.latencyMs ?? 0,
		    status: probe?.httpStatus ?? 0
		  });
		  return typeof probe?.detail === "string" && probe.detail.length > 0 ? `${base} \xB7 ${probe.detail}` : base;
		}
		function probeKind(probe) {
		  return probe?.phase !== "error" && probe?.ok === true ? "ok" : "error";
		}
		function domIdPart(value) {
		  return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60);
		}
		function CCSwitchImportSection({ controller, collapse, setCollapse, t }) {
		  const tr = makeTranslator(t);
		  if (!controller) return null;
		  const snapshot = (0, import_react2.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
		  (0, import_react2.useEffect)(() => {
		    if (snapshot.phase === "idle") void controller.scan().catch(() => {
		    });
		  }, [controller, snapshot.phase]);
		  const scanning = snapshot.phase === "loading";
		  const importing = snapshot.phase === "importing";
		  const busy = scanning || importing;
		  const awaitingFirstScan = snapshot.phase === "idle" || scanning;
		  const selected = new Set(snapshot.selectedIds);
		  const profiles = Array.isArray(snapshot.profiles) ? snapshot.profiles : [];
		  const importableIds = profiles.filter(isSelectable).map((profile) => profile.profileId);
		  const selectedCount = importableIds.filter((id) => selected.has(id)).length;
		  const allSelected = importableIds.length > 0 && selectedCount === importableIds.length;
		  const collapsed = collapse?.importPanel === true;
		  const toggleCollapsed = () => {
		    if (typeof setCollapse !== "function") return;
		    setCollapse((current) => {
		      const next = withPanelToggled(current, "importPanel");
		      saveCollapse(next);
		      return next;
		    });
		  };
		  return h2(
		    "section",
		    { className: "dsh-ccswitch-import" + (collapsed ? " dsh-ccswitch-import--collapsed" : ""), "aria-labelledby": "dsh-ccswitch-import-title" },
		    h2(
		      "div",
		      { className: "dsh-ccswitch-import__header" },
		      h2(
		        "div",
		        null,
		        h2("h2", { id: "dsh-ccswitch-import-title", className: "dsh-ccswitch-import__title" }, tr("importer.title", "CCSwitch \u5BFC\u5165")),
		        h2("p", { className: "dsh-ccswitch-import__hint" }, collapsed ? tr("importer.hintCollapsed", "\u70B9\u51FB\u5C55\u5F00 CCSwitch \u5BFC\u5165\u8BBE\u7F6E") : tr("importer.hintExpanded", "\u4ECE\u672C\u673A CCSwitch \u8BFB\u53D6 provider \u914D\u7F6E\u3002"))
		      ),
		      h2(
		        "div",
		        { className: "dsh-ccswitch-import__header-actions" },
		        h2("button", {
		          type: "button",
		          className: "dsh-ccswitch-collapse",
		          "aria-expanded": !collapsed,
		          "aria-controls": "dsh-ccswitch-import-body",
		          "aria-label": tr("importer.collapseAria", "\u5C55\u5F00\u6216\u6536\u8D77 CCSwitch \u5BFC\u5165\u9762\u677F"),
		          onClick: toggleCollapsed
		        }, h2("span", { "aria-hidden": "true" }, collapsed ? "\u2304" : "\u2303")),
		        !collapsed && h2(
		          "div",
		          { className: "dsh-ccswitch-import__actions" },
		          h2(
		            "button",
		            { className: "dsh-ccswitch-import__secondary", type: "button", disabled: busy, onClick: () => {
		              void controller.scan().catch(() => {
		              });
		            } },
		            scanning ? tr("importer.scanning", "\u5904\u7406\u4E2D\u2026") : tr("importer.scan", "\u626B\u63CF")
		          ),
		          h2(
		            "button",
		            { className: "dsh-ccswitch-import__primary", type: "button", disabled: busy || selected.size === 0, onClick: () => {
		              void controller.importSelected().catch(() => {
		              });
		            } },
		            importing ? tr("importer.importing", "\u5BFC\u5165\u4E2D\u2026") : tr("importer.importSelected", "\u5BFC\u5165\u9009\u4E2D")
		          )
		        )
		      )
		    ),
		    h2(
		      "div",
		      { id: "dsh-ccswitch-import-body", className: "dsh-ccswitch-import__body", hidden: collapsed },
		      snapshot.error && h2("p", { role: "alert", className: "dsh-ccswitch-import__error" }, snapshot.error),
		      profiles.length === 0 ? awaitingFirstScan ? h2("p", { className: "dsh-ccswitch-import__empty" }, tr("importer.loading", "\u6B63\u5728\u8BFB\u53D6 CCSwitch \u914D\u7F6E\u2026")) : h2("p", { className: "dsh-ccswitch-import__empty" }, emptyMessage(snapshot, tr)) : h2(
		        "div",
		        { className: "dsh-ccswitch-import__list" },
		        h2(
		          "label",
		          { className: "dsh-ccswitch-import__row dsh-ccswitch-import__row--select-all" },
		          h2("input", {
		            type: "checkbox",
		            checked: allSelected,
		            ref: (el) => {
		              if (el) el.indeterminate = selectedCount > 0 && !allSelected;
		            },
		            disabled: busy || importableIds.length === 0,
		            onChange: () => controller.toggleSelectAll()
		          }),
		          h2(
		            "span",
		            { className: "dsh-ccswitch-import__content" },
		            h2("strong", null, allSelected ? tr("importer.selectNone", "\u53D6\u6D88\u5168\u9009") : tr("importer.selectAll", "\u5168\u9009")),
		            h2(
		              "span",
		              { className: "dsh-ccswitch-import__meta-line" },
		              h2("span", null, tr("importer.selectedCount", "\u5DF2\u9009 {selected} / {total} \u4E2A\u53EF\u5BFC\u5165", { selected: selectedCount, total: importableIds.length }))
		            )
		          )
		        ),
		        ...profiles.map((profile, index) => {
		          const selectable = isSelectable(profile);
		          const probe = snapshot.probes?.[profile.profileId];
		          const testing = probe?.phase === "testing";
		          const canProbe = selectable && Boolean(profile.baseURL);
		          const checkboxId = `dsh-ccswitch-import-select-${index}-${domIdPart(profile.profileId)}`;
		          return h2(
		            "div",
		            {
		              key: profile.profileId,
		              className: "dsh-ccswitch-import__row" + (selectable ? "" : " dsh-ccswitch-import__row--blocked")
		            },
		            h2("input", {
		              type: "checkbox",
		              id: checkboxId,
		              checked: selected.has(profile.profileId),
		              disabled: !selectable || busy,
		              onChange: () => controller.toggleSelected(profile.profileId)
		            }),
		            // The row is a plain container now and the text is a real <label>
		            // for the checkbox: a button inside a wrapping <label> would also
		            // toggle the checkbox when clicked.
		            h2(
		              "label",
		              { htmlFor: checkboxId, className: "dsh-ccswitch-import__content" },
		              h2(
		                "span",
		                { className: "dsh-ccswitch-import__primary-line" },
		                h2("strong", null, profile.profileName || profile.profileId),
		                profile.baseURL ? h2("code", null, profile.baseURL) : null
		              ),
		              h2(
		                "span",
		                { className: "dsh-ccswitch-import__meta-line" },
		                h2("code", { className: "dsh-ccswitch-import__provider-key" }, profile.providerKey || tr("importer.pendingKey", "\u5F85\u751F\u6210 provider key")),
		                h2("span", null, `${profile.credential === "found" ? tr("importer.credentialFound", "\u51ED\u636E\u5DF2\u627E\u5230") : tr("importer.credentialMissing", "\u7F3A\u5C11\u51ED\u636E")} \xB7 ${(profile.modelIds ?? []).join(", ") || tr("importer.noModels", "\u65E0\u6A21\u578B")}`),
		                // A blocked row used to show only "blocked" with no reason:
		                // the Host had already worked out exactly what was wrong.
		                profile.status === "blocked" ? h2("span", { className: "dsh-ccswitch-import__blocked-reason" }, blockedLabel(profile, tr)) : null,
		                Array.isArray(profile.warnings) && profile.warnings.length > 0 ? h2("span", { className: "dsh-ccswitch-import__warnings" }, profile.warnings.join("\uFF1B")) : null
		              )
		            ),
		            h2(
		              "span",
		              { className: "dsh-ccswitch-import__row-extras" },
		              canProbe ? h2("button", {
		                type: "button",
		                className: "dsh-ccswitch-import__link dsh-ccswitch-import__probe-btn",
		                disabled: testing || busy,
		                "aria-label": tr("importer.probe.testAria", "\u6D4B\u8BD5 {name} \u7684\u8FDE\u63A5", { name: profile.profileName || profile.profileId }),
		                onClick: () => {
		                  Promise.resolve(controller.probeOne(profile.profileId)).catch(() => {
		                  });
		                }
		              }, testing ? tr("importer.probe.testing", "\u6D4B\u8BD5\u4E2D\u2026") : tr("importer.probe.test", "\u6D4B\u8BD5\u8FDE\u63A5")) : null,
		              probe && !testing ? h2("span", {
		                role: "status",
		                className: `dsh-ccswitch-import__probe dsh-ccswitch-import__probe--${probeKind(probe)}`
		              }, probeLabel(probe, tr)) : null,
		              h2("span", { className: badgeClass(profile.status) }, statusLabel(profile.status, tr))
		            )
		          );
		        })
		      ),
		      snapshot.results.length > 0 && h2(
		        "div",
		        { className: "dsh-ccswitch-import__report" },
		        h2(
		          "div",
		          { className: "dsh-ccswitch-import__report-head" },
		          h2("strong", null, tr("importer.resultsTitle", "\u5BFC\u5165\u7ED3\u679C")),
		          h2("button", { type: "button", className: "dsh-ccswitch-import__link", onClick: () => controller.clearResults() }, tr("importer.resultsClear", "\u6E05\u9664"))
		        ),
		        h2(
		          "ul",
		          { className: "dsh-ccswitch-import__results" },
		          ...snapshot.results.map((result, index) => {
		            const detail = resultDetail(result, tr);
		            return h2(
		              "li",
		              {
		                key: `${result.profileId ?? "row"}-${result.status ?? "unknown"}-${index}`,
		                className: "dsh-ccswitch-import__result" + (result.status === "failed" ? " dsh-ccswitch-import__result--failed" : "")
		              },
		              h2("span", { className: badgeClass(result.status) }, statusLabel(result.status, tr)),
		              h2("strong", null, result.profileName || result.profileId || ""),
		              detail ? h2("span", { className: "dsh-ccswitch-import__result-detail" }, detail) : null
		            );
		          })
		        )
		      )
		    )
		  );
		}

		// src/ui/ModelsFooterPanel.mjs
		var h3 = import_react3.default.createElement;
		function ModelsFooterPanel({ controller, importer, t }) {
		  const tr = makeTranslator(t);
		  const [collapse, setCollapse] = (0, import_react3.useState)(() => loadCollapse());
		  const reasoningCollapsed = collapse.reasoningPanel === true;
		  const toggleReasoning = () => {
		    setCollapse((current) => {
		      const next = withPanelToggled(current, "reasoningPanel");
		      saveCollapse(next);
		      return next;
		    });
		  };
		  return h3(
		    "div",
		    { className: "dsh-reasoning-composite" },
		    h3(CCSwitchImportSection, { controller: importer, collapse, setCollapse, t }),
		    h3(
		      "section",
		      { className: "dsh-reasoning-embed" + (reasoningCollapsed ? " dsh-reasoning-embed--collapsed" : ""), "aria-label": tr("nav", "Model reasoning") },
		      h3(
		        "button",
		        {
		          type: "button",
		          className: "dsh-reasoning-embed__toggle",
		          "aria-expanded": !reasoningCollapsed,
		          "aria-controls": "dsh-reasoning-embed-body",
		          onClick: toggleReasoning
		        },
		        h3("span", { className: "dsh-reasoning-embed__title" }, tr("nav", "Model reasoning")),
		        h3("span", { className: "dsh-reasoning-embed__hint" }, reasoningCollapsed ? tr("reasoning.hintCollapsed", "\u70B9\u51FB\u5C55\u5F00\u6A21\u578B\u63A8\u7406\u8BBE\u7F6E") : tr("reasoning.hintExpanded", "\u4E3A\u81EA\u5B9A\u4E49 provider \u7684\u6BCF\u4E2A\u6A21\u578B\u8BBE\u7F6E\u63A8\u7406\u7B49\u7EA7\uFF1B\u4FDD\u5B58\u540E\u5373\u53EF\u5728\u6A21\u578B\u9009\u62E9\u5668\u4E2D\u5207\u6362\u3002")),
		        h3("span", { className: "dsh-reasoning-embed__toggle-chevron", "aria-hidden": "true" }, reasoningCollapsed ? "\u2304" : "\u2303")
		      ),
		      h3(
		        "div",
		        { id: "dsh-reasoning-embed-body", hidden: reasoningCollapsed },
		        h3(ReasoningSettingsSection, { controller, embedded: true, collapse, setCollapse, t })
		      )
		    )
		  );
		}

		// src/ui/ProviderManagerSection.mjs
		var import_react5 = __toESM(require("react"), 1);

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
		function presetGroup(preset) {
		  switch (preset?.category) {
		    case "official":
		      return "login";
		    case "cn_official":
		      return "vendor";
		    case "cloud_provider":
		      return "cloud";
		    case "omo":
		    case "omo-slim":
		      return "plugin";
		    default:
		      return "thirdparty";
		  }
		}
		function presetVersionKeys(preset) {
		  const keys = [];
		  if (typeof preset?.planKey === "string" && preset.planKey !== "") {
		    keys.push(`manager.plan.${preset.planKey}`);
		  }
		  if (typeof preset?.regionKey === "string" && preset.regionKey !== "") {
		    keys.push(`manager.region.${preset.regionKey}`);
		  }
		  return keys;
		}
		function groupPresetsByCategory(presets) {
		  const list = Array.isArray(presets) ? presets : [];
		  return PRESET_GROUP_ORDER.map((group) => ({ group, presets: list.filter((preset) => presetGroup(preset) === group) })).filter((section) => section.presets.length > 0);
		}

		// src/ui/ProviderEditModal.mjs
		var import_react4 = __toESM(require("react"), 1);
		var h4 = import_react4.default.createElement;
		var MAX_MODELS = 200;
		var PROBLEM_FALLBACK = {
		  "displayName-required": "\u8BF7\u586B\u5199\u540D\u79F0\u3002",
		  "api-required": "\u8BF7\u9009\u62E9\u534F\u8BAE\u3002",
		  "baseURL-required": "\u8BF7\u586B\u5199 Base URL\u3002",
		  "baseURL-invalid": "Base URL \u4E0D\u662F\u5408\u6CD5\u7F51\u5740\uFF1A{detail}",
		  "models-required": "\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u6A21\u578B\uFF0C\u4E14\u6A21\u578B ID \u4E0D\u80FD\u4E3A\u7A7A\u3002",
		  "model-id-required": "\u7B2C {detail} \u4E2A\u6A21\u578B\u7F3A\u5C11 ID\u3002",
		  "costMultiplier-invalid": "\u8D39\u7528\u500D\u7387\u5FC5\u987B\u662F\u4E0D\u5C0F\u4E8E 0 \u7684\u6570\u5B57\uFF1A{detail}",
		  "limitDailyUsd-invalid": "\u6BCF\u65E5\u9650\u989D\u5FC5\u987B\u662F\u4E0D\u5C0F\u4E8E 0 \u7684\u6570\u5B57\uFF1A{detail}",
		  "limitMonthlyUsd-invalid": "\u6BCF\u6708\u9650\u989D\u5FC5\u987B\u662F\u4E0D\u5C0F\u4E8E 0 \u7684\u6570\u5B57\uFF1A{detail}"
		};
		function blankModel() {
		  return { id: "", name: "", contextWindow: "", maxTokens: "" };
		}
		function emptyDraft() {
		  return {
		    key: void 0,
		    displayName: "",
		    api: "",
		    baseURL: "",
		    apiKey: "",
		    notes: "",
		    icon: "",
		    iconColor: "",
		    costMultiplier: "",
		    limitDailyUsd: "",
		    limitMonthlyUsd: "",
		    inFailoverQueue: false,
		    models: [blankModel()],
		    // Carried through an edit so a save does not quietly drop fields this form
		    // does not edit. An edit replaces the whole stored record, so anything
		    // omitted here is lost.
		    appType: void 0,
		    sourceProfileId: void 0,
		    isCurrent: false
		  };
		}
		function textOf(value) {
		  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
		}
		function draftFromProvider(provider) {
		  const base = emptyDraft();
		  if (!provider || typeof provider !== "object") return base;
		  const models = Array.isArray(provider.models) ? provider.models : [];
		  return {
		    ...base,
		    key: typeof provider.key === "string" && provider.key !== "" ? provider.key : void 0,
		    displayName: String(provider.displayName ?? ""),
		    api: String(provider.api ?? ""),
		    baseURL: String(provider.baseURL ?? ""),
		    // Never copied from a stored value; see the module comment.
		    apiKey: "",
		    notes: String(provider.notes ?? ""),
		    icon: String(provider.icon ?? ""),
		    iconColor: String(provider.iconColor ?? ""),
		    costMultiplier: textOf(provider.costMultiplier),
		    limitDailyUsd: textOf(provider.limitDailyUsd),
		    limitMonthlyUsd: textOf(provider.limitMonthlyUsd),
		    inFailoverQueue: provider.inFailoverQueue === true,
		    models: models.length > 0 ? models.slice(0, MAX_MODELS).map((model) => ({
		      id: String(model?.id ?? ""),
		      name: String(model?.name ?? ""),
		      contextWindow: textOf(model?.contextWindow),
		      maxTokens: textOf(model?.maxTokens),
		      // Not editable here, but preserved so saving does not erase reasoning
		      // levels the user configured in the reasoning editor.
		      reasoningEfforts: model?.reasoningEfforts === false ? false : model?.reasoningEfforts
		    })) : [blankModel()],
		    appType: typeof provider.appType === "string" ? provider.appType : void 0,
		    sourceProfileId: typeof provider.sourceProfileId === "string" ? provider.sourceProfileId : void 0,
		    isCurrent: provider.isCurrent === true
		  };
		}
		function draftFromPreset(preset) {
		  const base = emptyDraft();
		  if (!preset || typeof preset !== "object") return base;
		  const models = (Array.isArray(preset.models) ? preset.models : []).filter((id) => typeof id === "string" && id !== "").slice(0, MAX_MODELS);
		  return {
		    ...base,
		    displayName: String(preset.displayName ?? ""),
		    api: String(preset.api ?? ""),
		    baseURL: String(preset.baseURL ?? ""),
		    icon: String(preset.icon ?? ""),
		    iconColor: String(preset.iconColor ?? ""),
		    appType: typeof preset.appType === "string" ? preset.appType : void 0,
		    models: models.length > 0 ? models.map((id) => ({ ...blankModel(), id })) : [blankModel()]
		  };
		}
		function numberField(value) {
		  if (typeof value === "number") return Number.isFinite(value) ? value : void 0;
		  const text = typeof value === "string" ? value.trim() : "";
		  if (text === "") return void 0;
		  const parsed = Number(text);
		  return Number.isFinite(parsed) ? parsed : void 0;
		}
		function optionalText2(value) {
		  const text = typeof value === "string" ? value.trim() : "";
		  return text === "" ? void 0 : text;
		}
		function validateDraft(draft) {
		  const source = draft && typeof draft === "object" ? draft : {};
		  const problems = [];
		  if (optionalText2(source.displayName) === void 0) problems.push({ code: "displayName-required" });
		  const api = optionalText2(source.api);
		  if (api === void 0) problems.push({ code: "api-required" });
		  const baseURL = optionalText2(source.baseURL);
		  if (baseURL === void 0) problems.push({ code: "baseURL-required" });
		  else {
		    try {
		      new URL(baseURL);
		    } catch {
		      problems.push({ code: "baseURL-invalid", detail: baseURL });
		    }
		  }
		  const models = Array.isArray(source.models) ? source.models : [];
		  const usable = models.filter((model) => optionalText2(model?.id) !== void 0);
		  if (usable.length === 0) problems.push({ code: "models-required" });
		  models.forEach((model, index) => {
		    if (optionalText2(model?.id) !== void 0) return;
		    const touched = optionalText2(model?.name) !== void 0 || numberField(model?.contextWindow) !== void 0 || numberField(model?.maxTokens) !== void 0;
		    if (touched) problems.push({ code: "model-id-required", detail: index + 1 });
		  });
		  for (const [field2, code] of [
		    ["costMultiplier", "costMultiplier-invalid"],
		    ["limitDailyUsd", "limitDailyUsd-invalid"],
		    ["limitMonthlyUsd", "limitMonthlyUsd-invalid"]
		  ]) {
		    const raw = source[field2];
		    const text = typeof raw === "string" ? raw.trim() : raw;
		    if (text === "" || text === void 0) continue;
		    const parsed = numberField(raw);
		    if (parsed === void 0 || parsed < 0) problems.push({ code, detail: String(raw) });
		  }
		  return problems;
		}
		function field(label, control, hint, hintId) {
		  return h4(
		    "label",
		    { className: "dsh-ccswitch-form__field" },
		    h4("span", { className: "dsh-ccswitch-form__label" }, label),
		    control,
		    hint ? h4("span", { className: "dsh-ccswitch-form__hint", id: hintId }, hint) : null
		  );
		}
		function ProviderEditModal({
		  initialDraft,
		  mode = "create",
		  protocols = [],
		  saving = false,
		  errors = [],
		  conflict = false,
		  saveError = "",
		  onSubmit,
		  onClose,
		  t
		}) {
		  const tr = makeTranslator(t);
		  const [draft, setDraft] = (0, import_react4.useState)(() => initialDraft ?? emptyDraft());
		  const [showProblems, setShowProblems] = (0, import_react4.useState)(false);
		  const dialogRef = (0, import_react4.useRef)(null);
		  const reactId = (0, import_react4.useId)();
		  const titleId = `dsh-ccswitch-modal-title-${reactId}`;
		  const apiKeyHintId = `dsh-ccswitch-modal-apikey-${reactId}`;
		  const modelsHeadingId = `dsh-ccswitch-modal-models-${reactId}`;
		  const problems = validateDraft(draft);
		  const problemMessages = problems.map((problem) => tr(
		    `manager.error.${problem.code}`,
		    PROBLEM_FALLBACK[problem.code] ?? PROBLEM_FALLBACK["models-required"],
		    problem.detail === void 0 ? void 0 : { detail: problem.detail }
		  ));
		  const hostErrors = (Array.isArray(errors) ? errors : []).filter((entry) => typeof entry === "string" && entry !== "");
		  (0, import_react4.useEffect)(() => {
		    const dialog = dialogRef.current;
		    if (!dialog || typeof document === "undefined") return void 0;
		    const first = dialog.querySelector("input, select, textarea, button");
		    if (first && typeof first.focus === "function") first.focus();
		    const onKeyDown = (event) => {
		      if (event.key === "Escape") {
		        event.stopPropagation();
		        onClose?.();
		        return;
		      }
		      if (event.key !== "Tab") return;
		      const focusable = dialog.querySelectorAll(
		        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
		      );
		      if (focusable.length === 0) return;
		      const firstEl = focusable[0];
		      const lastEl = focusable[focusable.length - 1];
		      if (event.shiftKey && document.activeElement === firstEl) {
		        event.preventDefault();
		        lastEl.focus();
		      } else if (!event.shiftKey && document.activeElement === lastEl) {
		        event.preventDefault();
		        firstEl.focus();
		      }
		    };
		    document.addEventListener("keydown", onKeyDown, true);
		    return () => document.removeEventListener("keydown", onKeyDown, true);
		  }, [onClose]);
		  const patch = (changes) => setDraft((current) => ({ ...current, ...changes }));
		  const patchModel = (index, changes) => setDraft((current) => ({
		    ...current,
		    models: current.models.map((model, at) => at === index ? { ...model, ...changes } : model)
		  }));
		  const addModel = () => setDraft((current) => current.models.length >= MAX_MODELS ? current : { ...current, models: [...current.models, blankModel()] });
		  const removeModel = (index) => setDraft((current) => {
		    const models = current.models.filter((_, at) => at !== index);
		    return { ...current, models: models.length > 0 ? models : [blankModel()] };
		  });
		  const submit = (event) => {
		    event.preventDefault();
		    if (saving) return;
		    setShowProblems(true);
		    if (problems.length > 0) return;
		    onSubmit?.(draft);
		  };
		  const protocolOptions = Array.isArray(protocols) && protocols.length > 0 ? protocols : [draft.api].filter(Boolean);
		  return h4(
		    "div",
		    {
		      className: "dsh-ccswitch-modal__backdrop",
		      // A click that starts and ends on the backdrop closes; one that started
		      // inside the panel and drifted out does not, so a drag that overshoots a
		      // text selection does not throw the form away.
		      onMouseDown: (event) => {
		        if (event.target === event.currentTarget) onClose?.();
		      }
		    },
		    h4(
		      "div",
		      {
		        className: "dsh-ccswitch-modal",
		        role: "dialog",
		        "aria-modal": "true",
		        "aria-labelledby": titleId,
		        ref: dialogRef
		      },
		      h4(
		        "form",
		        { className: "dsh-ccswitch-form", onSubmit: submit, noValidate: true },
		        h4(
		          "div",
		          { className: "dsh-ccswitch-modal__header" },
		          h4(
		            "h3",
		            { id: titleId, className: "dsh-ccswitch-modal__title" },
		            mode === "edit" ? tr("manager.editTitle", "\u7F16\u8F91 provider") : tr("manager.createTitle", "\u65B0\u589E provider")
		          ),
		          h4("button", {
		            type: "button",
		            className: "dsh-ccswitch-modal__close",
		            "aria-label": tr("manager.close", "\u5173\u95ED"),
		            onClick: () => onClose?.()
		          }, "\xD7")
		        ),
		        conflict || hostErrors.length > 0 || saveError !== "" || showProblems && problemMessages.length > 0 ? h4(
		          "div",
		          { role: "alert", className: "dsh-ccswitch-modal__errors" },
		          conflict ? h4("p", { className: "dsh-ccswitch-modal__error" }, tr("manager.conflict", "\u8BBE\u7F6E\u6587\u6863\u5DF2\u88AB\u5176\u4ED6\u5730\u65B9\u6539\u52A8\uFF0C\u5217\u8868\u5DF2\u5237\u65B0\uFF0C\u8BF7\u91CD\u8BD5\u3002")) : null,
		          saveError !== "" ? h4("p", { className: "dsh-ccswitch-modal__error" }, saveError) : null,
		          hostErrors.length > 0 || showProblems && problemMessages.length > 0 ? h4(
		            "div",
		            null,
		            h4("p", { className: "dsh-ccswitch-modal__error-title" }, tr("manager.validationTitle", "\u8BF7\u4FEE\u6B63\u4EE5\u4E0B\u95EE\u9898\uFF1A")),
		            h4(
		              "ul",
		              { className: "dsh-ccswitch-modal__error-list" },
		              ...[...hostErrors, ...showProblems ? problemMessages : []].map((message, index) => h4("li", { key: `${index}-${message}` }, message))
		            )
		          ) : null
		        ) : null,
		        h4(
		          "div",
		          { className: "dsh-ccswitch-form__grid" },
		          field(
		            tr("manager.fieldDisplayName", "\u540D\u79F0"),
		            h4("input", {
		              className: "dsh-ccswitch-form__input",
		              type: "text",
		              value: draft.displayName,
		              onChange: (event) => patch({ displayName: event.target.value })
		            })
		          ),
		          field(
		            tr("manager.fieldApi", "\u534F\u8BAE"),
		            h4(
		              "select",
		              {
		                className: "dsh-ccswitch-form__input",
		                value: draft.api,
		                onChange: (event) => patch({ api: event.target.value })
		              },
		              ...[...new Set([...protocolOptions, draft.api].filter((entry) => entry !== ""))].map((protocol) => h4("option", { key: protocol, value: protocol }, protocol)),
		              draft.api === "" ? h4("option", { key: "", value: "" }, "") : null
		            )
		          ),
		          field(
		            tr("manager.fieldBaseUrl", "Base URL"),
		            h4("input", {
		              className: "dsh-ccswitch-form__input",
		              type: "text",
		              value: draft.baseURL,
		              onChange: (event) => patch({ baseURL: event.target.value })
		            })
		          ),
		          field(
		            tr("manager.fieldApiKey", "API Key"),
		            h4("input", {
		              className: "dsh-ccswitch-form__input",
		              type: "password",
		              autoComplete: "off",
		              value: draft.apiKey,
		              "aria-describedby": apiKeyHintId,
		              onChange: (event) => patch({ apiKey: event.target.value })
		            }),
		            `${tr("manager.apiKeyHint", "\u7559\u7A7A\u8868\u793A\u4FDD\u6301\u5F53\u524D\u5BC6\u94A5\u4E0D\u53D8\u3002")}${mode === "edit" && initialDraft?.key ? ` ${tr("manager.apiKeyStored", "\u5DF2\u5B58\u6709\u4E00\u4E2A\u5BC6\u94A5\uFF0C\u6B64\u5904\u4E0D\u4F1A\u56DE\u663E\u3002")}` : ""}`,
		            apiKeyHintId
		          ),
		          field(
		            tr("manager.fieldNotes", "\u5907\u6CE8"),
		            h4("input", {
		              className: "dsh-ccswitch-form__input",
		              type: "text",
		              value: draft.notes,
		              onChange: (event) => patch({ notes: event.target.value })
		            })
		          ),
		          field(
		            tr("manager.fieldIcon", "\u56FE\u6807"),
		            h4("input", {
		              className: "dsh-ccswitch-form__input",
		              type: "text",
		              value: draft.icon,
		              onChange: (event) => patch({ icon: event.target.value })
		            })
		          ),
		          field(
		            tr("manager.fieldIconColor", "\u56FE\u6807\u989C\u8272"),
		            h4("input", {
		              className: "dsh-ccswitch-form__input",
		              type: "text",
		              value: draft.iconColor,
		              onChange: (event) => patch({ iconColor: event.target.value })
		            })
		          ),
		          field(
		            tr("manager.fieldCostMultiplier", "\u8D39\u7528\u500D\u7387"),
		            h4("input", {
		              className: "dsh-ccswitch-form__input",
		              type: "text",
		              inputMode: "decimal",
		              value: draft.costMultiplier,
		              onChange: (event) => patch({ costMultiplier: event.target.value })
		            })
		          ),
		          field(
		            tr("manager.fieldLimitDaily", "\u6BCF\u65E5\u9650\u989D\uFF08USD\uFF09"),
		            h4("input", {
		              className: "dsh-ccswitch-form__input",
		              type: "text",
		              inputMode: "decimal",
		              value: draft.limitDailyUsd,
		              onChange: (event) => patch({ limitDailyUsd: event.target.value })
		            })
		          ),
		          field(
		            tr("manager.fieldLimitMonthly", "\u6BCF\u6708\u9650\u989D\uFF08USD\uFF09"),
		            h4("input", {
		              className: "dsh-ccswitch-form__input",
		              type: "text",
		              inputMode: "decimal",
		              value: draft.limitMonthlyUsd,
		              onChange: (event) => patch({ limitMonthlyUsd: event.target.value })
		            })
		          ),
		          h4(
		            "label",
		            { className: "dsh-ccswitch-form__field dsh-ccswitch-form__field--check" },
		            h4("input", {
		              type: "checkbox",
		              checked: draft.inFailoverQueue,
		              onChange: (event) => patch({ inFailoverQueue: event.target.checked })
		            }),
		            h4("span", { className: "dsh-ccswitch-form__label" }, tr("manager.fieldFailover", "\u52A0\u5165\u6545\u969C\u8F6C\u79FB\u961F\u5217"))
		          )
		        ),
		        h4(
		          "fieldset",
		          { className: "dsh-ccswitch-form__models", "aria-labelledby": modelsHeadingId },
		          h4("legend", { id: modelsHeadingId, className: "dsh-ccswitch-form__legend" }, tr("manager.modelsHeading", "\u6A21\u578B")),
		          ...draft.models.map((model, index) => h4(
		            "div",
		            {
		              // Index-keyed on purpose: two rows may legitimately hold the same
		              // (or an empty) id while the user is editing, and keying by id
		              // would make React reconcile the wrong row.
		              key: index,
		              className: "dsh-ccswitch-form__model-row",
		              role: "group",
		              "aria-label": tr("manager.modelRowAria", "\u7B2C {index} \u4E2A\u6A21\u578B", { index: index + 1 })
		            },
		            h4("input", {
		              className: "dsh-ccswitch-form__input",
		              type: "text",
		              placeholder: tr("manager.modelId", "\u6A21\u578B ID"),
		              "aria-label": tr("manager.modelId", "\u6A21\u578B ID"),
		              value: model.id,
		              onChange: (event) => patchModel(index, { id: event.target.value })
		            }),
		            h4("input", {
		              className: "dsh-ccswitch-form__input",
		              type: "text",
		              placeholder: tr("manager.modelName", "\u663E\u793A\u540D"),
		              "aria-label": tr("manager.modelName", "\u663E\u793A\u540D"),
		              value: model.name,
		              onChange: (event) => patchModel(index, { name: event.target.value })
		            }),
		            h4("input", {
		              className: "dsh-ccswitch-form__input",
		              type: "text",
		              inputMode: "numeric",
		              placeholder: tr("manager.modelContext", "\u4E0A\u4E0B\u6587\u7A97\u53E3"),
		              "aria-label": tr("manager.modelContext", "\u4E0A\u4E0B\u6587\u7A97\u53E3"),
		              value: model.contextWindow,
		              onChange: (event) => patchModel(index, { contextWindow: event.target.value })
		            }),
		            h4("input", {
		              className: "dsh-ccswitch-form__input",
		              type: "text",
		              inputMode: "numeric",
		              placeholder: tr("manager.modelMaxTokens", "\u6700\u5927\u8F93\u51FA token"),
		              "aria-label": tr("manager.modelMaxTokens", "\u6700\u5927\u8F93\u51FA token"),
		              value: model.maxTokens,
		              onChange: (event) => patchModel(index, { maxTokens: event.target.value })
		            }),
		            h4("button", {
		              type: "button",
		              className: "dsh-ccswitch-import__link dsh-ccswitch-form__model-remove",
		              "aria-label": tr("manager.modelRemoveAria", "\u79FB\u9664\u6A21\u578B {id}", { id: model.id || index + 1 }),
		              onClick: () => removeModel(index)
		            }, tr("manager.modelRemove", "\u79FB\u9664"))
		          )),
		          h4("button", {
		            type: "button",
		            className: "dsh-ccswitch-import__secondary",
		            disabled: draft.models.length >= MAX_MODELS,
		            onClick: addModel
		          }, tr("manager.modelAdd", "\u6DFB\u52A0\u6A21\u578B"))
		        ),
		        h4(
		          "div",
		          { className: "dsh-ccswitch-modal__footer" },
		          h4("button", {
		            type: "button",
		            className: "dsh-ccswitch-import__secondary",
		            onClick: () => onClose?.()
		          }, tr("manager.cancel", "\u53D6\u6D88")),
		          h4("button", {
		            type: "submit",
		            className: "dsh-ccswitch-import__primary",
		            disabled: saving
		          }, saving ? tr("manager.saving", "\u4FDD\u5B58\u4E2D\u2026") : tr("manager.save", "\u4FDD\u5B58"))
		        )
		      )
		    )
		  );
		}

		// src/ui/ProviderManagerSection.mjs
		var h5 = import_react5.default.createElement;
		var FALLBACK = messagesFor(DEFAULT_LOCALE);
		function presetOptionLabel(preset, tr) {
		  const parts = presetVersionKeys(preset).map((key) => tr(key, FALLBACK[key]));
		  return parts.length === 0 ? String(preset?.displayName ?? "") : `${preset.displayName} \xB7 ${parts.join(" \xB7 ")}`;
		}
		var FAILURE_TEXT = {
		  activate: ["manager.activateFailed", "\u542F\u7528\u5931\u8D25\uFF1A{message}"],
		  delete: ["manager.deleteFailed", "\u5220\u9664\u5931\u8D25\uFF1A{message}"],
		  save: ["manager.saveFailed", "\u4FDD\u5B58\u5931\u8D25\uFF1A{message}"]
		};
		function emptyState(snapshot) {
		  const status = snapshot?.status;
		  if (status === "error" || status === "conflict") return null;
		  if (status !== "ready") return "loading";
		  return snapshot.exists === true ? "empty" : "emptyNoNamespace";
		}
		function providerRowView(provider, snapshot) {
		  const key = provider?.key ?? "";
		  const pending = snapshot?.pendingKey !== void 0 && snapshot.pendingKey === key;
		  return {
		    key,
		    name: provider?.displayName || key,
		    isCurrent: provider?.isCurrent === true,
		    // Anything the Host did not explicitly report as found reads as missing:
		    // the failure that matters is a provider whose key is unset, and it must
		    // never be dressed up as ready.
		    credentialFound: provider?.credential === "found",
		    modelCount: Array.isArray(provider?.models) ? provider.models.length : 0,
		    inFailoverQueue: provider?.inFailoverQueue === true,
		    // Whether this row can be probed at all. The probe route reads CC Switch's
		    // database and is addressed by the `profileId` a scan produced, so a
		    // provider the user added by hand or from a preset has no row to probe.
		    // The button is hidden rather than shown-and-failing: there is no action
		    // the user could take to make it work, and offering it would read as a
		    // broken feature rather than a limit of what was imported.
		    probeable: typeof provider?.sourceProfileId === "string" && provider.sourceProfileId !== "",
		    pending,
		    action: pending ? snapshot?.pendingAction : void 0,
		    disabled: snapshot?.status === "busy" || snapshot?.status === "loading"
		  };
		}
		function providerMatches(provider, query) {
		  const needle = String(query ?? "").trim().toLowerCase();
		  if (needle === "") return true;
		  return [provider?.displayName, provider?.notes, provider?.baseURL].filter((value) => typeof value === "string" && value !== "").join("\n").toLowerCase().includes(needle);
		}
		var PROBE_FALLBACK2 = {
		  ok: "\u8FDE\u901A \xB7 {count} \u4E2A\u6A21\u578B \xB7 {ms}ms",
		  "ok-minimal": "\u8FDE\u901A \xB7 \u6700\u5C0F\u8BF7\u6C42 \xB7 {ms}ms",
		  empty: "\u8FDE\u901A \xB7 \u4E0A\u6E38\u6CA1\u8FD4\u56DE\u6A21\u578B",
		  "http-error": "\u5931\u8D25 \xB7 HTTP {status}",
		  "no-credentials": "\u65E0\u6CD5\u6D4B\u8BD5\uFF1A\u7F3A\u5C11\u51ED\u636E\u6216 base URL",
		  timeout: "\u5931\u8D25 \xB7 \u8D85\u65F6",
		  network: "\u5931\u8D25 \xB7 \u7F51\u7EDC\u9519\u8BEF"
		};
		function probeLabel2(probe, tr) {
		  if (probe?.phase === "error") {
		    if (probe.unprobeable === true) {
		      return tr("manager.probeUnprobeable", "\u65E0\u6CD5\u6D4B\u8BD5\uFF1A\u8BE5 provider \u4E0D\u662F\u4ECE CC Switch \u5BFC\u5165\u7684\uFF0C\u6CA1\u6709\u53EF\u63A2\u6D4B\u7684\u6E90\u8BB0\u5F55");
		    }
		    const base2 = tr("importer.probe.requestFailed", "\u5931\u8D25 \xB7 {message}", { message: probe.message ?? "" });
		    return probe.staleHost ? `${base2} \xB7 ${tr("importer.probe.hostStale", "\u5BBF\u4E3B\u672A\u52A0\u8F7D\u8BE5\u63A5\u53E3\uFF0C\u91CD\u542F DSH \u540E\u91CD\u8BD5")}` : base2;
		  }
		  const reason = probe?.check === "minimal" && probe?.ok === true ? "ok-minimal" : typeof probe?.reason === "string" && PROBE_FALLBACK2[probe.reason] ? probe.reason : "network";
		  const base = tr(`importer.probe.${reason}`, PROBE_FALLBACK2[reason], {
		    count: probe?.modelCount ?? 0,
		    ms: probe?.latencyMs ?? 0,
		    status: probe?.httpStatus ?? 0
		  });
		  return typeof probe?.detail === "string" && probe.detail.length > 0 ? `${base} \xB7 ${probe.detail}` : base;
		}
		function probeKind2(probe) {
		  return probe?.phase !== "error" && probe?.ok === true ? "ok" : "error";
		}
		function useDialog(revision, onOpen) {
		  const [dialog, setDialog] = (0, import_react5.useState)(null);
		  const open = (next) => {
		    onOpen?.();
		    setDialog({ revision, ...next });
		  };
		  return {
		    dialog,
		    openCreate: (preset) => open({ mode: "create", draft: preset ? draftFromPreset(preset) : emptyDraft() }),
		    openEdit: (provider) => open({ mode: "edit", draft: draftFromProvider(provider) }),
		    openDuplicate: (provider) => open({
		      mode: "create",
		      // A duplicate is a *new* provider that starts from an existing one, so the
		      // key is dropped: keeping it would make the save an update to the
		      // original, which is the opposite of what "Duplicate" promises.
		      draft: { ...draftFromProvider(provider), key: void 0, isCurrent: false }
		    }),
		    close: () => setDialog(null)
		  };
		}
		function ProviderManagerSection({ controller, t }) {
		  const tr = makeTranslator(t);
		  const snapshot = (0, import_react5.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
		  const { dialog, openCreate, openEdit, openDuplicate, close } = useDialog(
		    snapshot.revision,
		    () => controller.clearSaveFeedback?.()
		  );
		  const [presetKey, setPresetKey] = (0, import_react5.useState)("");
		  const [query, setQuery] = (0, import_react5.useState)("");
		  const [rowError, setRowError] = (0, import_react5.useState)(null);
		  const loadedPresets = (0, import_react5.useRef)(false);
		  (0, import_react5.useEffect)(() => {
		    if (snapshot.status === "idle") void controller.refresh().catch(() => {
		    });
		  }, [controller, snapshot.status]);
		  (0, import_react5.useEffect)(() => {
		    if (loadedPresets.current) return;
		    loadedPresets.current = true;
		    void controller.loadPresets().catch(() => {
		    });
		  }, [controller]);
		  const providers = snapshot.providers ?? {};
		  const order = Array.isArray(snapshot.order) ? snapshot.order : [];
		  const presets = Array.isArray(snapshot.presets) ? snapshot.presets : [];
		  const busy = snapshot.status === "busy" || snapshot.status === "loading";
		  const activation = snapshot.activation;
		  const runRowAction = async (key, action, kind) => {
		    setRowError(null);
		    try {
		      await action();
		    } catch (error) {
		      if (error?.conflict) return;
		      if (error?.reason === "active-provider") {
		        setRowError({ key, message: tr("manager.deleteActive", "\u8BE5 provider \u6B63\u5728\u4F7F\u7528\u4E2D\uFF0C\u8BF7\u5148\u542F\u7528\u5176\u4ED6 provider \u518D\u5220\u9664\u3002") });
		        return;
		      }
		      const message = error instanceof Error ? error.message : String(error);
		      const [fallbackKey, fallback] = FAILURE_TEXT[kind] ?? FAILURE_TEXT.delete;
		      setRowError({ key, message: tr(fallbackKey, fallback, { message }) });
		    }
		  };
		  const onActivate = (key) => runRowAction(key, () => controller.activate(key), "activate");
		  const onDelete = (provider) => {
		    const name2 = provider.displayName || provider.key;
		    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(tr("manager.deleteConfirm", "\u786E\u5B9A\u5220\u9664 provider\u300C{name}\u300D\uFF1F\u8BE5\u64CD\u4F5C\u65E0\u6CD5\u64A4\u9500\u3002", { name: name2 }))) {
		      return;
		    }
		    void runRowAction(provider.key, () => controller.remove(provider.key), "delete");
		  };
		  const submitDialog = (draft) => {
		    void controller.save({ ...draft, expectedRevision: dialog?.revision }).then(() => close()).catch(() => {
		    });
		  };
		  const applyPreset = (key) => {
		    setPresetKey(key);
		    if (key === "") return;
		    const preset = presets.find((entry) => entry.key === key);
		    if (preset) openCreate(preset);
		    setPresetKey("");
		  };
		  const rows = order.map((key) => providers[key]).filter(Boolean);
		  const visibleRows = rows.filter((provider) => providerMatches(provider, query));
		  return h5(
		    "section",
		    { className: "dsh-ccswitch-manager", "aria-labelledby": "dsh-ccswitch-manager-title" },
		    h5(
		      "div",
		      { className: "dsh-ccswitch-manager__header" },
		      h5(
		        "div",
		        null,
		        h5("h2", { id: "dsh-ccswitch-manager-title", className: "dsh-ccswitch-manager__title" }, tr("manager.title", "\u4F9B\u5E94\u5546\u7BA1\u7406")),
		        h5("p", { className: "dsh-ccswitch-manager__hint" }, tr("manager.hintExpanded", "\u76F4\u63A5\u7BA1\u7406\u672C\u63D2\u4EF6\u62E5\u6709\u7684 provider\uFF1A\u65B0\u589E\u3001\u7F16\u8F91\u3001\u590D\u5236\u3001\u5220\u9664\u3001\u542F\u7528\u3002"))
		      ),
		      h5(
		        "div",
		        { className: "dsh-ccswitch-manager__header-actions" },
		        presets.length > 0 ? h5(
		          "label",
		          { className: "dsh-ccswitch-manager__preset" },
		          h5("span", { className: "dsh-ccswitch-manager__preset-label" }, tr("manager.presetLabel", "\u9884\u8BBE")),
		          h5(
		            "select",
		            {
		              className: "dsh-ccswitch-manager__preset-select",
		              value: presetKey,
		              onChange: (event) => applyPreset(event.target.value)
		            },
		            h5("option", { value: "" }, tr("manager.presetNone", "\u81EA\u5B9A\u4E49\uFF08\u7A7A\u767D\uFF09")),
		            ...groupPresetsByCategory(presets).map((section) => h5(
		              "optgroup",
		              {
		                key: section.group,
		                // `optgroup` takes a `label` attribute, not children.
		                label: tr(`manager.group.${section.group}`, FALLBACK[`manager.group.${section.group}`])
		              },
		              ...section.presets.map((preset) => h5(
		                "option",
		                { key: preset.key, value: preset.key },
		                presetOptionLabel(preset, tr)
		              ))
		            ))
		          )
		        ) : null,
		        h5("button", {
		          type: "button",
		          className: "dsh-ccswitch-import__secondary",
		          disabled: busy,
		          onClick: () => {
		            void controller.refresh().catch(() => {
		            });
		          }
		        }, snapshot.status === "loading" ? tr("manager.refreshing", "\u5237\u65B0\u4E2D\u2026") : tr("manager.refresh", "\u5237\u65B0")),
		        h5("button", {
		          type: "button",
		          className: "dsh-ccswitch-import__primary",
		          disabled: busy,
		          onClick: () => openCreate()
		        }, tr("manager.add", "\u65B0\u589E provider"))
		      )
		    ),
		    snapshot.presetsError ? h5(
		      "p",
		      { className: "dsh-ccswitch-manager__note" },
		      tr("manager.presetsFailed", "\u9884\u8BBE\u5217\u8868\u52A0\u8F7D\u5931\u8D25\uFF1A{message}", { message: snapshot.presetsError })
		    ) : null,
		    snapshot.error ? h5(
		      "p",
		      { role: "alert", className: "dsh-ccswitch-import__error" },
		      snapshot.conflict ? tr("manager.conflict", "\u8BBE\u7F6E\u6587\u6863\u5DF2\u88AB\u5176\u4ED6\u5730\u65B9\u6539\u52A8\uFF0C\u5217\u8868\u5DF2\u5237\u65B0\uFF0C\u8BF7\u91CD\u8BD5\u3002") : snapshot.error
		    ) : null,
		    activation ? h5(
		      "div",
		      {
		        role: "status",
		        className: "dsh-ccswitch-manager__activation" + (activation.applied ? "" : " dsh-ccswitch-manager__activation--warn")
		      },
		      h5(
		        "div",
		        { className: "dsh-ccswitch-manager__activation-head" },
		        h5("strong", null, tr("manager.activated", "\u5DF2\u542F\u7528 {name}", {
		          name: providers[activation.key]?.displayName ?? activation.key
		        })),
		        h5("button", {
		          type: "button",
		          className: "dsh-ccswitch-import__link",
		          onClick: () => controller.dismissActivation()
		        }, tr("manager.dismiss", "\u77E5\u9053\u4E86"))
		      ),
		      !activation.applied ? h5(
		        "p",
		        { className: "dsh-ccswitch-manager__activation-warning" },
		        tr("manager.activatedNotApplied", "\u5DF2\u6807\u8BB0\u4E3A\u542F\u7528\uFF0C\u4F46 DSH \u6CA1\u6709\u63A5\u53D7\u8BE5 provider\uFF0C\u6A21\u578B\u8BF7\u6C42\u4ECD\u8D70\u539F\u6765\u7684\u8DEF\u7531\u3002")
		      ) : null,
		      activation.warnings.length > 0 ? h5(
		        "div",
		        null,
		        h5("p", { className: "dsh-ccswitch-manager__activation-title" }, tr("manager.activationWarnings", "\u542F\u7528\u63D0\u793A")),
		        h5(
		          "ul",
		          { className: "dsh-ccswitch-manager__activation-list" },
		          ...activation.warnings.map((warning, index) => h5("li", { key: `${index}-${warning}` }, warning))
		        )
		      ) : null
		    ) : null,
		    // The field only appears once there is something to narrow. On a tab with
		    // no providers it would be a control that cannot do anything, and it would
		    // sit above the empty state that is trying to explain how to get one.
		    rows.length > 0 ? h5(
		      "div",
		      {
		        // Laid out inline rather than through a stylesheet rule: every other
		        // class this tab uses lives in `src/client/styles.mjs`, which this
		        // change does not own. Hoisting these three declarations into a
		        // `.dsh-ccswitch-manager__search` rule there is the tidier home and is
		        // worth doing the next time that file is open.
		        style: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }
		      },
		      h5("input", {
		        // `text`, not `search`: the latter draws the browser's own clear
		        // affordance, which would sit beside the button below and clear the
		        // field twice.
		        type: "text",
		        // The edit form's own input class, so the two controls cannot drift
		        // apart in border, focus ring or font. Its `width:100%` is overridden
		        // below, because in a flex row it would push the clear button onto a
		        // second line.
		        className: "dsh-ccswitch-form__input",
		        style: { flex: "1 1 auto", width: "auto", minWidth: 0, maxWidth: "360px" },
		        value: query,
		        placeholder: tr("manager.searchPlaceholder", "\u6309\u540D\u79F0/\u5907\u6CE8/\u8BF7\u6C42\u5730\u5740\u641C\u7D22\u4F9B\u5E94\u5546\u2026"),
		        "aria-label": tr("manager.searchAriaLabel", "\u641C\u7D22\u4F9B\u5E94\u5546"),
		        disabled: busy,
		        onChange: (event) => setQuery(event.target.value)
		      }),
		      query === "" ? null : h5("button", {
		        type: "button",
		        className: "dsh-ccswitch-import__link",
		        onClick: () => setQuery("")
		      }, tr("manager.searchClear", "\u6E05\u9664"))
		    ) : null,
		    rows.length === 0 ? (() => {
		      const state = emptyState(snapshot);
		      if (state === null) return null;
		      if (state === "loading") {
		        return h5("p", { className: "dsh-ccswitch-manager__empty" }, tr("manager.loading", "\u6B63\u5728\u8BFB\u53D6 provider \u5217\u8868\u2026"));
		      }
		      return h5("p", { className: "dsh-ccswitch-manager__empty" }, state === "empty" ? tr("manager.empty", "\u8FD8\u6CA1\u6709 provider\uFF0C\u70B9\u51FB\u300C\u65B0\u589E provider\u300D\u5F00\u59CB\u3002") : tr("manager.emptyNoNamespace", "\u672C\u63D2\u4EF6\u5C1A\u672A\u521B\u5EFA\u8BBE\u7F6E\u547D\u540D\u7A7A\u95F4\uFF1B\u6DFB\u52A0\u7B2C\u4E00\u4E2A provider \u65F6\u4F1A\u4E00\u5E76\u521B\u5EFA\u3002"));
		    })() : visibleRows.length === 0 ? h5(
		      "p",
		      { role: "status", className: "dsh-ccswitch-manager__empty" },
		      tr("manager.noSearchResults", "\u6CA1\u6709\u7B26\u5408\u641C\u7D22\u6761\u4EF6\u7684\u4F9B\u5E94\u5546\u3002")
		    ) : h5(
		      "div",
		      { className: "dsh-ccswitch-manager__list" },
		      ...visibleRows.map((provider) => {
		        const view = providerRowView(provider, snapshot);
		        const { name: name2, pending, action } = view;
		        const probe = snapshot.probes?.[view.key];
		        const testing = probe?.phase === "testing";
		        return h5(
		          "div",
		          {
		            key: view.key,
		            className: "dsh-ccswitch-manager__row" + (view.isCurrent ? " dsh-ccswitch-manager__row--current" : "")
		          },
		          h5(
		            "div",
		            { className: "dsh-ccswitch-manager__content" },
		            h5(
		              "div",
		              { className: "dsh-ccswitch-manager__primary-line" },
		              h5("strong", null, name2),
		              view.isCurrent ? h5(
		                "span",
		                { className: "dsh-ccswitch-import__badge dsh-ccswitch-import__badge--new" },
		                tr("manager.active", "\u5F53\u524D\u542F\u7528")
		              ) : null
		            ),
		            h5(
		              "div",
		              { className: "dsh-ccswitch-manager__meta-line" },
		              h5("code", { className: "dsh-ccswitch-manager__provider-key" }, view.key),
		              h5("span", { className: "dsh-ccswitch-manager__protocol" }, provider.api || "\u2014"),
		              provider.baseURL ? h5("code", null, provider.baseURL) : null,
		              h5("span", null, view.modelCount > 0 ? tr("manager.modelCount", "{count} \u4E2A\u6A21\u578B", { count: view.modelCount }) : tr("manager.noModels", "\u65E0\u6A21\u578B")),
		              h5("span", {
		                className: "dsh-ccswitch-import__badge" + (view.credentialFound ? " dsh-ccswitch-import__badge--new" : " dsh-ccswitch-import__badge--blocked")
		              }, view.credentialFound ? tr("manager.credentialFound", "\u51ED\u636E\u5DF2\u627E\u5230") : tr("manager.credentialMissing", "\u7F3A\u5C11\u51ED\u636E")),
		              view.inFailoverQueue ? h5("span", { className: "dsh-ccswitch-manager__failover" }, tr("manager.failover", "\u6545\u969C\u8F6C\u79FB\u961F\u5217")) : null
		            ),
		            rowError && rowError.key === view.key ? h5("p", { role: "alert", className: "dsh-ccswitch-manager__row-error" }, rowError.message) : null
		          ),
		          h5(
		            "div",
		            { className: "dsh-ccswitch-manager__row-actions", role: "group", "aria-label": tr("manager.rowActionsAria", "{name} \u7684\u64CD\u4F5C", { name: name2 }) },
		            // Only a provider that came through an import has a CC Switch row
		            // behind it, so only one of those can be probed — see
		            // `providerRowView.probeable`. The button is hidden rather than
		            // shown-and-disabled: there is nothing the user could do to make
		            // it work, and a permanently dead control reads as a bug.
		            view.probeable ? h5("button", {
		              type: "button",
		              className: "dsh-ccswitch-import__link dsh-ccswitch-import__probe-btn",
		              disabled: testing || view.disabled,
		              "aria-label": tr("importer.probe.testAria", "\u6D4B\u8BD5 {name} \u7684\u8FDE\u63A5", { name: name2 }),
		              onClick: () => {
		                Promise.resolve(controller.probeOne(view.key)).catch(() => {
		                });
		              }
		            }, testing ? tr("importer.probe.testing", "\u6D4B\u8BD5\u4E2D\u2026") : tr("importer.probe.test", "\u6D4B\u8BD5\u8FDE\u63A5")) : null,
		            // Sitting beside the button rather than under the row, so the
		            // verdict reads as the answer to the click that asked for it.
		            probe && !testing ? h5("span", {
		              role: "status",
		              className: `dsh-ccswitch-import__probe dsh-ccswitch-import__probe--${probeKind2(probe)}`
		            }, probeLabel2(probe, tr)) : null,
		            h5("button", {
		              type: "button",
		              className: "dsh-ccswitch-import__link",
		              // Activating the row that is already current is a no-op that
		              // still costs a settings write and a full-catalogue edit.
		              disabled: view.disabled || view.isCurrent,
		              "aria-label": tr("manager.activateAria", "\u542F\u7528 {name}", { name: name2 }),
		              onClick: () => onActivate(view.key)
		            }, action === "activate" ? tr("manager.activating", "\u542F\u7528\u4E2D\u2026") : tr("manager.activate", "\u542F\u7528")),
		            h5("button", {
		              type: "button",
		              className: "dsh-ccswitch-import__link",
		              disabled: view.disabled,
		              "aria-label": tr("manager.editAria", "\u7F16\u8F91 {name}", { name: name2 }),
		              onClick: () => openEdit(provider)
		            }, tr("manager.edit", "\u7F16\u8F91")),
		            h5("button", {
		              type: "button",
		              className: "dsh-ccswitch-import__link",
		              disabled: view.disabled,
		              "aria-label": tr("manager.duplicateAria", "\u590D\u5236 {name}", { name: name2 }),
		              onClick: () => openDuplicate(provider)
		            }, tr("manager.duplicate", "\u590D\u5236")),
		            h5("button", {
		              type: "button",
		              className: "dsh-ccswitch-import__link dsh-ccswitch-manager__danger",
		              disabled: view.disabled,
		              "aria-label": tr("manager.deleteAria", "\u5220\u9664 {name}", { name: name2 }),
		              onClick: () => onDelete(provider)
		            }, action === "delete" ? tr("manager.deleting", "\u5220\u9664\u4E2D\u2026") : tr("manager.delete", "\u5220\u9664"))
		          )
		        );
		      })
		    ),
		    // Keyed by which provider is being edited, so opening "edit" on a second
		    // row remounts the form; without it React would reuse the first row's state
		    // and the dialog would show the wrong provider. The revision is deliberately
		    // NOT part of this key: a background refresh changes it, and remounting on
		    // that would throw away everything the user had typed.
		    dialog ? h5(ProviderEditModal, {
		      key: `${dialog.mode}:${dialog.draft?.key ?? "new"}`,
		      initialDraft: dialog.draft,
		      mode: dialog.mode,
		      protocols: snapshot.apiProtocols ?? [],
		      saving: snapshot.status === "busy" && snapshot.pendingAction === "save",
		      errors: Array.isArray(snapshot.saveErrors) ? snapshot.saveErrors : [],
		      conflict: snapshot.conflict === true,
		      saveError: snapshot.status === "error" && snapshot.error ? snapshot.error : "",
		      onSubmit: submitDialog,
		      onClose: close,
		      t
		    }) : null
		  );
		}

		// src/client/styles.mjs
		var STYLE_ID = "dsh-ccswitch-plugin-styles";
		var CSS = `button[class*="navCell"]:has(span[class*="navLabel"]:empty){display:none;}
		.dsh-reasoning-composite{display:flex;flex-direction:column;gap:20px;}
		.dsh-reasoning-embed{border-top:1px solid var(--dsw-alias-border-l2);padding-top:16px;}
		.dsh-reasoning-embed__title{margin:0 0 4px;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px;}
		.dsh-reasoning-embed__hint{margin:0 0 14px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;}.dsh-reasoning-embed__toggle{display:flex;align-items:center;gap:12px;width:100%;min-width:0;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;text-align:left;cursor:pointer;}.dsh-reasoning-embed__toggle:hover .dsh-reasoning-embed__title{color:var(--dsw-alias-brand-primary);}.dsh-reasoning-embed__toggle:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:1px;}.dsh-reasoning-embed__toggle .dsh-reasoning-embed__title{flex:none;margin:0;}.dsh-reasoning-embed__toggle .dsh-reasoning-embed__hint{flex:1 1 auto;min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.dsh-reasoning-embed__toggle-chevron{flex:none;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:18px;}.dsh-reasoning-collapse,.dsh-ccswitch-collapse{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;box-sizing:border-box;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:18px;cursor:pointer;}.dsh-reasoning-collapse:hover,.dsh-ccswitch-collapse:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}.dsh-reasoning-collapse:focus-visible,.dsh-ccswitch-collapse:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:1px;}.dsh-reasoning-model--collapsed .dsh-reasoning-model__header{padding-bottom:8px;}.dsh-ccswitch-import__header-actions{display:flex;align-items:center;gap:8px;flex:none;}.dsh-ccswitch-import__body{padding-top:12px;}
		.dsh-reasoning-settings{display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);}
		.dsh-reasoning-provider{padding:0 0 4px;}
		.dsh-reasoning-provider__header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:0 0 8px;border-bottom:1px solid var(--dsw-alias-border-l2);}
		.dsh-reasoning-provider__header h3{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px;overflow-wrap:anywhere;}
		.dsh-reasoning-provider__header span{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap;}
		.dsh-reasoning-provider__models{display:flex;flex-direction:column;gap:10px;padding-top:10px;}
		.dsh-reasoning-model{position:relative;min-width:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);}
		.dsh-reasoning-model__header{display:flex;align-items:center;justify-content:space-between;gap:16px;min-width:0;padding:12px;}
		.dsh-reasoning-model__identity{display:flex;flex-direction:column;gap:1px;min-width:0;}
		.dsh-reasoning-model__identity strong{min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;overflow-wrap:anywhere;}
		.dsh-reasoning-model__identity code{min-width:0;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code,monospace);font-size:12px;line-height:18px;overflow-wrap:anywhere;}
		.dsh-reasoning-model__mode-area{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:none;}
		.dsh-reasoning-model__mode-label{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;white-space:nowrap;}
		.dsh-reasoning-mode{display:inline-flex;align-items:center;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);}
		.dsh-reasoning-mode__option{min-width:40px;height:28px;padding:0 9px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:18px;cursor:pointer;}
		.dsh-reasoning-mode__option:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
		.dsh-reasoning-mode__option--active{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);}
		.dsh-reasoning-mode__option--active:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-foreground);}
		.dsh-reasoning-save,.dsh-ccswitch-import__primary{box-sizing:border-box;min-height:28px;padding:0 10px;border:0;border-radius:14px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-family:inherit;font-size:12px;line-height:18px;cursor:pointer;}
		.dsh-reasoning-save{min-width:64px;border-radius:7px;}
		.dsh-reasoning-save:hover:not(:disabled),.dsh-ccswitch-import__primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);}
		.dsh-reasoning-save:disabled,.dsh-ccswitch-import__primary:disabled,.dsh-ccswitch-import__secondary:disabled,.dsh-reasoning-mode__option:disabled{opacity:.4;cursor:default;}
		.dsh-reasoning-save:focus-visible,.dsh-ccswitch-import__primary:focus-visible,.dsh-ccswitch-import__secondary:focus-visible,.dsh-reasoning-mode__option:focus-visible,.dsh-reasoning-custom__toggle:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:1px;}
		.dsh-reasoning-status{display:inline-flex;align-items:center;min-width:0;max-width:100%;min-height:20px;box-sizing:border-box;padding:1px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:11px;font-weight:500;line-height:18px;white-space:nowrap;}.dsh-reasoning-status:empty,.dsh-reasoning-remote-status:empty{display:none;}.dsh-reasoning-status--saving{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);}.dsh-reasoning-reload{min-height:28px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:18px;cursor:pointer;}.dsh-reasoning-reload:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);}.dsh-reasoning-reload:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:1px;}
		.dsh-reasoning-status--success{color:var(--dsw-alias-state-success-primary);}
		.dsh-reasoning-status--error{max-width:240px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;white-space:normal;}
		.dsh-reasoning-model__body{min-width:0;padding:12px;border-top:1px solid var(--dsw-alias-border-l2);}
		.dsh-reasoning-levels{display:flex;flex-direction:column;gap:8px;min-width:0;}
		.dsh-reasoning-levels__heading{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;}
		.dsh-reasoning-levels__label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px;}
		.dsh-reasoning-levels__summary{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;white-space:nowrap;}
		.dsh-reasoning-levels__options{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0;}
		.dsh-reasoning-level{position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:28px;box-sizing:border-box;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer;}
		.dsh-reasoning-level:hover:not(:has(input:disabled)){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
		.dsh-reasoning-level--active{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-label-primary);}
		.dsh-reasoning-level:focus-within{outline:2px solid var(--dsw-alias-border-l3);outline-offset:1px;}
		.dsh-reasoning-level:has(input:disabled){cursor:default;opacity:.6;}
		.dsh-reasoning-level input{position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;}
		.dsh-reasoning-custom{margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2);}
		.dsh-reasoning-custom__toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:32px;box-sizing:border-box;padding:6px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer;}
		.dsh-reasoning-custom__toggle:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
		.dsh-reasoning-custom__toggle--active{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
		.dsh-reasoning-custom__toggle>span:last-child{flex:none;font-size:14px;line-height:18px;}
		.dsh-reasoning-custom__body{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;padding:10px 2px 0;}
		.dsh-reasoning-custom__field{display:flex;flex-direction:column;gap:4px;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;}
		.dsh-reasoning-custom__field input{box-sizing:border-box;width:100%;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:18px;}
		.dsh-reasoning-custom__field input:focus{border-color:var(--dsw-alias-brand-primary);outline:2px solid var(--dsw-alias-border-l3);outline-offset:1px;}
		.dsh-reasoning-custom__field input::placeholder{color:var(--dsw-alias-label-dimmed);}
		.dsh-reasoning-model__footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;min-width:0;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l2);}
		.dsh-ccswitch-import{border-top:1px solid var(--dsw-alias-border-l2);padding-top:16px;color:var(--dsw-alias-label-primary);}
		.dsh-ccswitch-import__header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}
		.dsh-ccswitch-import__title{margin:0 0 4px;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px;}
		.dsh-ccswitch-import__hint,.dsh-ccswitch-import__empty{margin:0 0 12px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;}
		.dsh-ccswitch-import__actions{display:flex;gap:8px;flex-wrap:wrap;}
		.dsh-ccswitch-import__secondary{box-sizing:border-box;min-height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:18px;cursor:pointer;}
		.dsh-ccswitch-import__secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}
		.dsh-ccswitch-import__list{display:flex;flex-direction:column;gap:8px;}
		.dsh-ccswitch-import__row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;min-width:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);}
		.dsh-ccswitch-import__row--blocked{opacity:.55;}.dsh-ccswitch-import__row--select-all{border-style:dashed;background:transparent;}.dsh-ccswitch-import__row--select-all .dsh-ccswitch-import__meta-line span{white-space:normal;}
		.dsh-ccswitch-import__content{display:flex;min-width:0;flex-direction:column;gap:2px;}
		.dsh-ccswitch-import__primary-line{display:flex;align-items:baseline;gap:8px;min-width:0;}
		.dsh-ccswitch-import__primary-line strong{flex:none;max-width:60%;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
		.dsh-ccswitch-import__primary-line code{min-width:0;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code,monospace);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
		.dsh-ccswitch-import__meta-line{display:flex;align-items:baseline;gap:8px;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow:hidden;white-space:nowrap;}
		.dsh-ccswitch-import__meta-line>*{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
		.dsh-ccswitch-import__meta-line>*+*::before{content:'\xB7';margin-right:8px;color:var(--dsw-alias-label-dimmed);}
		.dsh-ccswitch-import__meta-line .dsh-ccswitch-import__provider-key{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code,monospace);font-size:11px;line-height:16px;}
		.dsh-ccswitch-import__meta-line .dsh-ccswitch-import__warnings{color:var(--dsw-alias-state-warn-primary);}
		.dsh-ccswitch-import__badge{flex:none;min-height:20px;box-sizing:border-box;padding:1px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;line-height:18px;white-space:nowrap;}
		.dsh-ccswitch-import__badge--new{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary);}
		.dsh-ccswitch-import__badge--update{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary);}
		.dsh-ccswitch-import__badge--unchanged{color:var(--dsw-alias-label-tertiary);}
		.dsh-ccswitch-import__badge--blocked{color:var(--dsw-alias-label-dimmed);}
		.dsh-ccswitch-import__error{margin:0 0 12px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;}
		.dsh-ccswitch-import__results{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;}
		.dsh-ccswitch-import__meta-line .dsh-ccswitch-import__blocked-reason{color:var(--dsw-alias-state-error-primary);}
		.dsh-ccswitch-import__badge--updated{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary);}
		.dsh-ccswitch-import__badge--failed{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}
		.dsh-ccswitch-import__badge--skipped{color:var(--dsw-alias-label-dimmed);}
		.dsh-ccswitch-import__report{margin-top:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);}
		.dsh-ccswitch-import__report-head{display:flex;align-items:center;justify-content:space-between;gap:12px;}
		.dsh-ccswitch-import__report-head strong{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500;line-height:18px;}
		.dsh-ccswitch-import__link{padding:0;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-family:inherit;font-size:12px;line-height:18px;cursor:pointer;}
		.dsh-ccswitch-import__link:hover{text-decoration:underline;}
		.dsh-ccswitch-import__link:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:1px;}
		.dsh-ccswitch-import__result{display:flex;align-items:baseline;gap:8px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;}
		.dsh-ccswitch-import__result strong{flex:none;max-width:45%;color:var(--dsw-alias-label-primary);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
		.dsh-ccswitch-import__result-detail{min-width:0;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;}
		.dsh-ccswitch-import__result--failed .dsh-ccswitch-import__result-detail{color:var(--dsw-alias-state-error-primary);}
		.dsh-reasoning-levels__custom{color:var(--dsw-alias-brand-primary);font-size:11px;line-height:18px;white-space:nowrap;}
		.dsh-ccswitch-import__row-extras{display:flex;align-items:center;gap:8px;min-width:0;justify-self:end;}.dsh-ccswitch-import__probe-btn{white-space:nowrap;}.dsh-ccswitch-import__probe-btn[disabled]{color:var(--dsw-alias-label-dimmed);cursor:default;text-decoration:none;}.dsh-ccswitch-import__probe{font-size:11px;line-height:16px;white-space:nowrap;color:var(--dsw-alias-label-tertiary);}.dsh-ccswitch-import__probe--ok{color:var(--dsw-alias-state-business-primary);}.dsh-ccswitch-import__probe--error{color:var(--dsw-alias-state-error-primary);}
		@media (max-width:640px){[role='dialog']:has(.dsh-ccswitch-import)>nav{flex:0 0 56px;width:56px;min-width:56px;}[role='dialog']:has(.dsh-ccswitch-import)>nav button{width:40px;min-width:40px;padding:0;justify-content:center;}[role='dialog']:has(.dsh-ccswitch-import)>nav button>span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}[role='dialog']:has(.dsh-ccswitch-import)>div{min-width:0;}.dsh-ccswitch-import__header{flex-direction:column;}.dsh-ccswitch-import__header-actions{width:100%;justify-content:space-between;}.dsh-ccswitch-import__header-actions .dsh-ccswitch-import__actions{flex:1;}.dsh-ccswitch-import__actions{width:100%;flex-direction:column;align-items:stretch;}.dsh-ccswitch-import__actions button{width:100%;}.dsh-ccswitch-import__row{grid-template-columns:auto minmax(0,1fr);min-width:0;}.dsh-ccswitch-import__content{min-width:0;}.dsh-ccswitch-import__row-extras{grid-column:1/-1;justify-self:start;flex-wrap:wrap;}.dsh-reasoning-model__header{align-items:stretch;flex-direction:column;gap:10px;padding:10px;}.dsh-reasoning-model__mode-area{width:100%;justify-content:space-between;}.dsh-reasoning-model__body{padding:10px;}.dsh-reasoning-model__footer{padding:9px 10px;}.dsh-reasoning-levels__heading{align-items:flex-start;}.dsh-reasoning-levels__options{gap:6px;}.dsh-reasoning-custom__body{grid-template-columns:minmax(0,1fr);}}`;
		var STATUS_CSS = ".dsh-reasoning-status--dirty{color:var(--dsw-alias-label-secondary);}\n";
		var MANAGER_CSS = [
		  ".dsh-ccswitch-manager{display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary);}",
		  ".dsh-ccswitch-manager__header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}",
		  ".dsh-ccswitch-manager__title{margin:0 0 4px;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px;}",
		  ".dsh-ccswitch-manager__hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;}",
		  ".dsh-ccswitch-manager__header-actions{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap;}",
		  ".dsh-ccswitch-manager__preset{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;}",
		  ".dsh-ccswitch-manager__preset-select{box-sizing:border-box;min-height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:18px;}",
		  ".dsh-ccswitch-manager__preset-select:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:1px;}",
		  ".dsh-ccswitch-manager__note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere;}",
		  ".dsh-ccswitch-manager__empty{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;}",
		  ".dsh-ccswitch-manager__list{display:flex;flex-direction:column;gap:8px;}",
		  ".dsh-ccswitch-manager__row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-width:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);}",
		  // The active row is marked by its border rather than a fill, so the badge
		  // stays readable in both themes.
		  ".dsh-ccswitch-manager__row--current{border-color:var(--dsw-alias-brand-primary);}",
		  ".dsh-ccswitch-manager__content{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto;}",
		  ".dsh-ccswitch-manager__primary-line{display:flex;align-items:baseline;gap:8px;min-width:0;}",
		  ".dsh-ccswitch-manager__primary-line strong{min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
		  ".dsh-ccswitch-manager__meta-line{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;}",
		  ".dsh-ccswitch-manager__meta-line>*{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
		  ".dsh-ccswitch-manager__provider-key,.dsh-ccswitch-manager__meta-line code{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code,monospace);font-size:11px;line-height:16px;}",
		  ".dsh-ccswitch-manager__failover{color:var(--dsw-alias-label-secondary);}",
		  ".dsh-ccswitch-manager__row-error{margin:2px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere;}",
		  ".dsh-ccswitch-manager__row-actions{display:flex;align-items:center;gap:10px;flex:none;flex-wrap:wrap;justify-content:flex-end;}",
		  ".dsh-ccswitch-manager__danger{color:var(--dsw-alias-state-error-primary);}",
		  ".dsh-ccswitch-manager__danger[disabled]{color:var(--dsw-alias-label-dimmed);}",
		  ".dsh-ccswitch-manager__activation{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);}",
		  ".dsh-ccswitch-manager__activation--warn{border-color:var(--dsw-alias-state-warn-primary);}",
		  ".dsh-ccswitch-manager__activation-head{display:flex;align-items:center;justify-content:space-between;gap:12px;}",
		  ".dsh-ccswitch-manager__activation-head strong{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500;line-height:18px;}",
		  ".dsh-ccswitch-manager__activation-title{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;}",
		  ".dsh-ccswitch-manager__activation-list{margin:4px 0 0;padding-left:18px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;}",
		  ".dsh-ccswitch-manager__activation-warning{margin:6px 0 0;color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere;}",
		  // The edit dialog. It opens on top of the settings dialog, so it owns a
		  // full-viewport backdrop of its own rather than sitting inline in the tab.
		  ".dsh-ccswitch-modal__backdrop{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.32);}",
		  ".dsh-ccswitch-modal{display:flex;flex-direction:column;width:100%;max-width:720px;max-height:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden;}",
		  ".dsh-ccswitch-modal__header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);}",
		  ".dsh-ccswitch-modal__title{margin:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;}",
		  ".dsh-ccswitch-modal__close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:18px;line-height:1;cursor:pointer;}",
		  ".dsh-ccswitch-modal__close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
		  ".dsh-ccswitch-modal__close:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:1px;}",
		  ".dsh-ccswitch-modal__errors{margin:12px 16px 0;padding:8px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;}",
		  ".dsh-ccswitch-modal__error{margin:0 0 4px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere;}",
		  ".dsh-ccswitch-modal__error-title{margin:0;color:var(--dsw-alias-state-error-primary);font-size:12px;font-weight:500;line-height:18px;}",
		  ".dsh-ccswitch-modal__error-list{margin:4px 0 0;padding-left:18px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere;}",
		  ".dsh-ccswitch-modal__footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l2);}",
		  // The form body scrolls, the header and footer do not: on a short window the
		  // Save button has to stay reachable without scrolling past every field.
		  ".dsh-ccswitch-form{display:flex;flex-direction:column;min-height:0;overflow-y:auto;}",
		  ".dsh-ccswitch-form__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;padding:12px 16px 0;}",
		  ".dsh-ccswitch-form__field{display:flex;flex-direction:column;gap:4px;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;}",
		  ".dsh-ccswitch-form__field--check{flex-direction:row;align-items:center;gap:8px;}",
		  ".dsh-ccswitch-form__label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;}",
		  ".dsh-ccswitch-form__hint{color:var(--dsw-alias-label-dimmed);font-size:11px;line-height:16px;}",
		  ".dsh-ccswitch-form__input{box-sizing:border-box;width:100%;min-height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:18px;}",
		  ".dsh-ccswitch-form__input:focus{border-color:var(--dsw-alias-brand-primary);outline:2px solid var(--dsw-alias-border-l3);outline-offset:1px;}",
		  ".dsh-ccswitch-form__input::placeholder{color:var(--dsw-alias-label-dimmed);}",
		  ".dsh-ccswitch-form__models{margin:14px 16px 16px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;min-width:0;}",
		  ".dsh-ccswitch-form__legend{padding:0 4px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px;}",
		  ".dsh-ccswitch-form__model-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,.8fr) minmax(0,.8fr) auto;align-items:center;gap:6px;min-width:0;margin-bottom:6px;}",
		  ".dsh-ccswitch-form__model-remove{white-space:nowrap;}",
		  "@media (max-width:640px){",
		  ".dsh-ccswitch-manager__header{flex-direction:column;}",
		  ".dsh-ccswitch-manager__header-actions{width:100%;}",
		  ".dsh-ccswitch-manager__row{flex-direction:column;}",
		  ".dsh-ccswitch-manager__row-actions{width:100%;justify-content:flex-start;}",
		  ".dsh-ccswitch-modal__backdrop{padding:0;align-items:stretch;}",
		  ".dsh-ccswitch-modal{max-width:none;border-radius:0;max-height:none;height:100%;}",
		  ".dsh-ccswitch-form__grid{grid-template-columns:minmax(0,1fr);}",
		  // One model per row: five inputs side by side at phone width leaves each
		  // about 40px wide, which is unusable for an id or a token count.
		  ".dsh-ccswitch-form__model-row{grid-template-columns:minmax(0,1fr);}",
		  "}"
		].join("");
		function installEmbedStyles() {
		  if (typeof document === "undefined") return () => {
		  };
		  if (document.getElementById(STYLE_ID)) return () => {
		  };
		  const style = document.createElement("style");
		  style.id = STYLE_ID;
		  style.textContent = CSS + STATUS_CSS + MANAGER_CSS;
		  document.head.append(style);
		  return () => style.remove();
		}

		// src/client/index.mjs
		var name = "dsh-ccswitch-plugin";
		var inject = [
		  "slots",
		  "locale",
		  "remote"
		];
		function apply(ctx) {
		  const controller = createReasoningSettingsController(ctx.remote);
		  const importer = createCCSwitchImportController({
		    getRevision: () => controller.getSnapshot().revision,
		    // The reasoning panel mirrors the settings document the import just wrote,
		    // so it has to refresh — and so does the source scan, otherwise the rows
		    // that were imported keep their "ready to import" badge. `keepResults`
		    // preserves the report `importSelected` published a moment ago.
		    onImported: async () => {
		      controller.refresh();
		      await importer.scan({ keepResults: true });
		    }
		  });
		  const manager = createCCSwitchManagerController({
		    // A manager write lands in the same settings document the reasoning editor
		    // edits and the importer classifies against, so both have to re-read: a
		    // provider added here must show up in the reasoning panel immediately, and
		    // the manager's own table is refreshed by the controller itself.
		    onChanged: async () => {
		      controller.refresh();
		      await importer.scan({ keepResults: true });
		    }
		  });
		  const t = ctx.locale.bind("dsh-ccswitch-plugin");
		  const removeStyles = installEmbedStyles();
		  const dispose = registerReasoningSettings(ctx, {
		    controller,
		    importer,
		    manager,
		    managerComponent: ProviderManagerSection,
		    component: ModelsFooterPanel,
		    t
		  });
		  ctx.effect(() => {
		    controller.refresh();
		    return () => {
		      dispose();
		      removeStyles();
		    };
		  }, "dsh-ccswitch-plugin.lifecycle");
		}
		// Annotate the CommonJS export names for ESM import in node:
		0 && (module.exports = {
		  apply,
		  inject,
		  name
		});
		return module.exports;
	}
});
