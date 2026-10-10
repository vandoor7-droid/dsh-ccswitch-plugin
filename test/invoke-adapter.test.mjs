// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The Tauri `invoke` → plugin-route adapter.
 *
 * This is the layer the plan calls "the one place that must change": cc-switch's
 * components keep calling `invoke("<command>", args)` and this decides where
 * that lands. The properties worth pinning are the refusal ones — an unmapped
 * command must throw, an unknown `id` must not become some other row's key, and
 * a Host error must keep its `status`/`reason` so a caller can still tell a
 * conflict from a bad request.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createInvoke, UnmappedCommandError } from "../src/client/tauri-shim/core.mjs";
import { INVOKE_ROUTES, MANAGER_API } from "../src/client/tauri-shim/commands.mjs";
import { listen, emit, UnmappedEventError } from "../src/client/tauri-shim/event.mjs";

/** A fetch that records every call and answers from a queue of scripted replies. */
function fakeFetch(replies = []) {
  const calls = [];
  const queue = [...replies];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", init });
    if (queue.length === 0) {
      // Scripting every reply is the point: an unscripted request means the
      // code under test did something the test did not expect, and answering
      // it with a bare 200 would hide that.
      throw new Error(`unexpected request: ${init.method ?? "GET"} ${url}`);
    }
    const next = queue.shift();
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => {
        if (next.body === undefined) throw new Error("no body");
        return next.body;
      },
    };
  };
  fn.calls = calls;
  return fn;
}

const PROVIDERS = `${MANAGER_API}/providers`;

test("a command with no route throws instead of doing nothing", async () => {
  const fetchImpl = fakeFetch();
  const invoke = createInvoke({ fetchImpl });
  await assert.rejects(
    () => invoke("definitely_not_a_command", { app: "claude" }),
    (error) => {
      assert.ok(error instanceof UnmappedCommandError);
      assert.equal(error.command, "definitely_not_a_command");
      assert.match(error.message, /ccswitch-command-map\.md/);
      return true;
    },
  );
  assert.equal(fetchImpl.calls.length, 0, "nothing may be sent for an unmapped command");
});

test("get_providers reads the catalogue without a state-changing marker", async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { exists: true, order: ["a"], providers: { a: {} } } }]);
  const invoke = createInvoke({ fetchImpl });
  const body = await invoke("get_providers", { app: "claude" });

  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, PROVIDERS);
  assert.equal(fetchImpl.calls[0].method, "GET");
  assert.equal(fetchImpl.calls[0].init.headers, undefined, "a GET makes no origin claim");
  // The whole body, not just `providers`: `order`/`revision`/`exists` are what
  // a copied list component still needs.
  assert.deepEqual(body.order, ["a"]);
});

test("a command that needs a key resolves the cc-switch id through the catalogue", async () => {
  const fetchImpl = fakeFetch([
    { status: 200, body: { providers: { "ccs-a-11111111": { sourceProfileId: "row-7" } } } },
    { status: 200, body: { key: "ccs-a-11111111", status: "removed" } },
  ]);
  const invoke = createInvoke({ fetchImpl });

  const removed = await invoke("delete_provider", { app: "claude", id: "row-7" });

  assert.equal(removed, true);
  assert.deepEqual(
    fetchImpl.calls.map((call) => [call.method, call.url]),
    [["GET", PROVIDERS], ["POST", `${PROVIDERS}/delete`]],
  );
  assert.deepEqual(JSON.parse(fetchImpl.calls[1].init.body), { key: "ccs-a-11111111" });
  assert.equal(
    fetchImpl.calls[1].init.headers["x-dsh-ccswitch-origin"],
    "same-origin",
    "a state-changing request must carry the marker the Host's fence accepts",
  );
});

test("an id the catalogue does not know is refused, not sent", async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { providers: { "ccs-a-11111111": { sourceProfileId: "row-7" } } } }]);
  const invoke = createInvoke({ fetchImpl });

  await assert.rejects(
    () => invoke("delete_provider", { app: "claude", id: "row-99" }),
    (error) => {
      assert.equal(error.code, "UNKNOWN_PROVIDER");
      assert.match(error.message, /row-99/);
      return true;
    },
  );
  assert.equal(fetchImpl.calls.length, 1, "only the lookup happened; no write was attempted");
});

test("a missing id is refused before any request", async () => {
  const fetchImpl = fakeFetch();
  const invoke = createInvoke({ fetchImpl });
  await assert.rejects(
    () => invoke("remove_provider_from_live_config", { app: "claude" }),
    (error) => error.code === "MISSING_ID",
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test("switch_provider is refused rather than silently re-read as a non-displacing apply", async () => {
  // cc-switch's command displaces every other row; the additive model has no
  // displacement to perform, so answering it with `apply` would report success
  // for work that was never done.
  const fetchImpl = fakeFetch();
  const invoke = createInvoke({ fetchImpl });
  await assert.rejects(
    () => invoke("switch_provider", { app: "claude", id: "row-1" }),
    (error) => error instanceof UnmappedCommandError && error.command === "switch_provider",
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test("removing from the live config lands on withdraw", async () => {
  const withdrawn = fakeFetch([
    { status: 200, body: { providers: { k: { sourceProfileId: "row-1" } } } },
    { status: 200, body: { key: "k", status: "withdrawn", inCatalogue: true } },
  ]);
  assert.equal(
    await createInvoke({ fetchImpl: withdrawn })("remove_provider_from_live_config", { id: "row-1" }),
    true,
  );
  assert.equal(withdrawn.calls[1].url, `${PROVIDERS}/withdraw`);
});

test("add_provider files the row and, by default, applies it too", async () => {
  const fetchImpl = fakeFetch([
    { status: 200, body: { key: "ccs-new-00000000", status: "created" } },
    { status: 200, body: { key: "ccs-new-00000000", status: "applied" } },
  ]);
  const invoke = createInvoke({ fetchImpl });

  const key = await invoke("add_provider", {
    app: "claude",
    provider: { displayName: "New" },
    apiKey: "sk-secret",
  });

  assert.equal(key, "ccs-new-00000000");
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), {
    provider: { displayName: "New" },
    apiKey: "sk-secret",
  });
  assert.equal(fetchImpl.calls[1].url, `${PROVIDERS}/apply`);
  assert.deepEqual(JSON.parse(fetchImpl.calls[1].init.body), { key: "ccs-new-00000000" });
});

test("add_provider with addToLive false files the row only", async () => {
  const fetchImpl = fakeFetch([
    { status: 200, body: { key: "ccs-new-00000000", status: "created" } },
  ]);
  const invoke = createInvoke({ fetchImpl });

  await invoke("add_provider", { app: "claude", provider: { displayName: "New" }, addToLive: false });

  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, `${PROVIDERS}/save`);
});

test("a Host error rejects with its message, status and reason", async () => {
  const fetchImpl = fakeFetch([
    { status: 200, body: { providers: { k: { sourceProfileId: "row-1" } } } },
    { status: 409, body: { reason: "in-use", error: "DSH still routes to this provider; withdraw it first" } },
  ]);
  const invoke = createInvoke({ fetchImpl });

  await assert.rejects(
    () => invoke("delete_provider", { id: "row-1" }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.reason, "in-use");
      assert.match(error.message, /withdraw it first/);
      return true;
    },
  );
});

test("the command table only ever names exact plugin routes", () => {
  for (const [command, route] of Object.entries(INVOKE_ROUTES)) {
    assert.equal(typeof route.path, "string", `${command} has no path`);
    assert.ok(route.path.startsWith("/api/"), `${command} is not a plugin route: ${route.path}`);
    assert.ok(!route.path.includes("<"), `${command} uses a path parameter DSH cannot match: ${route.path}`);
    assert.ok(["GET", "POST"].includes(route.method), `${command} uses an unsupported method`);
  }
});

test("cc-switch's event bus is refused loudly rather than stubbed out", async () => {
  await assert.rejects(
    () => listen("proxy-status", () => {}),
    (error) => {
      assert.ok(error instanceof UnmappedEventError);
      assert.equal(error.channel, "proxy-status");
      assert.match(error.message, /ctx\.remote/);
      return true;
    },
  );
  await assert.rejects(() => emit("proxy-status"), (error) => error instanceof UnmappedEventError);
});
