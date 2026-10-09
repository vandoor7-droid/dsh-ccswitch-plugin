// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { settingsMutation, updateModelReasoning } from "../domain/settings.mjs";
import { REMOTE_SETTINGS_CONFLICT_CODE } from "../../lib/core/safety.js";

export function createReasoningSettingsController(api) {
  let snapshot = { status: "idle", writable: false, revision: undefined, providers: {}, error: null };
  const listeners = new Set();
  const publish = (next) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  let operationQueue = Promise.resolve();
  const enqueue = (operation) => {
    const next = operationQueue.then(operation, operation);
    operationQueue = next.catch(() => {});
    return next;
  };
  const performRefresh = async () => {
    publish({ ...snapshot, status: "loading", error: null });
    try {
      // 0.2.0 remote calls resolve to { ok: true, value } | { ok: false, error }.
      const response = await api.settings.describe();
      if (!response.ok) throw new Error(response.error.message);
      const namespace = response.value.namespaces.find((entry) => entry.ns === "llm-pi-ai");
      const providers = namespace?.value?.providers ?? {};
      publish({
        status: "ready",
        writable: response.value.writable === true,
        revision: namespace?.revision,
        providers,
        error: null,
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
    }),
  };
  return controller;
}
