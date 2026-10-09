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
		    "reasoning.saveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF1A{message}"
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
		    "reasoning.saveFailed": "Save failed: {message}"
		  }
		};

		// src/client/registration.mjs
		var MODELS_FOOTER_SLOT = "settings.models.footer";
		function registerReasoningSettings(ctx, { controller, importer, component, t }) {
		  ctx.locale?.register?.("dsh-ccswitch-plugin", MESSAGES);
		  ctx.slots.inject(MODELS_FOOTER_SLOT, () => ctx.slots.register({
		    name: MODELS_FOOTER_SLOT,
		    id: "ccswitch-importer",
		    order: 10,
		    inject: () => ({ controller, importer, slots: ctx.slots, t })
		  }, component));
		  const refreshImporter = () => {
		    const result = importer?.scan?.();
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
		    }),
		    listen("llm/adapters-updated", () => {
		      void controller.refresh();
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
		function isRecord(value) {
		  return value !== null && typeof value === "object" && !Array.isArray(value);
		}
		function normalizeCollapse(input) {
		  const out = {
		    reasoningPanel: false,
		    importPanel: false,
		    models: /* @__PURE__ */ Object.create(null)
		  };
		  if (!isRecord(input)) return out;
		  out.reasoningPanel = input.reasoningPanel === true;
		  out.importPanel = input.importPanel === true;
		  if (isRecord(input.models)) {
		    for (const route of Object.keys(input.models)) {
		      const byModel = input.models[route];
		      if (!isRecord(byModel)) continue;
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
		function installEmbedStyles() {
		  if (typeof document === "undefined") return () => {
		  };
		  if (document.getElementById(STYLE_ID)) return () => {
		  };
		  const style = document.createElement("style");
		  style.id = STYLE_ID;
		  style.textContent = CSS + STATUS_CSS;
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
		  const t = ctx.locale.bind("dsh-ccswitch-plugin");
		  const removeStyles = installEmbedStyles();
		  const dispose = registerReasoningSettings(ctx, {
		    controller,
		    importer,
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
