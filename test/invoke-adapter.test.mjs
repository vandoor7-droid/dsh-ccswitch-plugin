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
  const fetchImpl = fakeFetch([{
    status: 200,
    body: { exists: true, revision: 4, order: ["a"], providers: { a: { displayName: "A", baseURL: "https://x.test" } } },
  }]);
  const invoke = createInvoke({ fetchImpl });
  const providers = await invoke("get_providers", { app: "claude" });

  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, PROVIDERS);
  assert.equal(fetchImpl.calls[0].method, "GET");
  assert.equal(fetchImpl.calls[0].init.headers, undefined, "a GET makes no origin claim");
  // The map of rows in cc-switch's shape, not the envelope: the command's
  // contract is `IndexMap<String, Provider>` and callers do
  // `Object.values(result)`, so `exists`/`revision` must not enumerate as
  // providers. `sortIndex` comes from `order`, which is why the drag in
  // `useDragSort` writes back an order the Host accepts.
  assert.deepEqual(Object.keys(providers), ["a"]);
  assert.equal(providers.a.id, "a");
  assert.equal(providers.a.name, "A");
  assert.equal(providers.a.sortIndex, 0);
  assert.deepEqual(providers.a.settingsConfig, { baseUrl: "https://x.test", env: { ANTHROPIC_BASE_URL: "https://x.test" } });
  assert.equal("revision" in providers, false);
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

test("switch_provider lands on apply — the additive branch's Add", async () => {
  // Verified against the source rather than assumed: ProviderList.tsx:340
  // wires `actions.add` to `onSwitch`, and services/provider/mod.rs:6622
  // skips set_current_provider for additive apps and only writes live config.
  const fetchImpl = fakeFetch([
    { status: 200, body: { providers: { k: { sourceProfileId: "row-1" } } } },
    { status: 200, body: { key: "k", status: "applied" } },
  ]);
  const invoke = createInvoke({ fetchImpl });

  assert.equal(await invoke("switch_provider", { app: "pi", id: "row-1" }), true);
  assert.equal(fetchImpl.calls[1].url, `${PROVIDERS}/apply`);
  assert.deepEqual(JSON.parse(fetchImpl.calls[1].init.body), { key: "k" });
  assert.equal(fetchImpl.calls[1].init.body.includes('"app"'), false, "the app type is not forwarded");
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

test("a partial sort update is expanded into the full order the Host requires", async () => {
  // cc-switch sends `{ updates: [{ id, sortIndex }] }` naming only the rows
  // that moved; /providers/reorder refuses anything that is not the complete
  // permutation, because it rewrites every index by position.
  const fetchImpl = fakeFetch([{
    status: 200,
    body: {
      order: ["a", "b", "c"],
      providers: {
        a: { sourceProfileId: "row-a", sortIndex: 0 },
        b: { sourceProfileId: "row-b", sortIndex: 1 },
        c: { sourceProfileId: "row-c", sortIndex: 2 },
      },
    },
  }, { status: 200, body: { status: "reordered", order: ["c", "a", "b"] } }]);
  const invoke = createInvoke({ fetchImpl });

  const ok = await invoke("update_providers_sort_order", {
    app: "claude",
    updates: [{ id: "row-a", sortIndex: 1 }, { id: "row-c", sortIndex: 0 }],
  });

  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(fetchImpl.calls[1].init.body), { keys: ["c", "a", "b"] });
});

test("a sort update that names an unknown id is dropped rather than rejected", async () => {
  const fetchImpl = fakeFetch([{
    status: 200,
    body: { order: ["a"], providers: { a: { sortIndex: 0 } } },
  }, { status: 200, body: { status: "reordered", order: ["a"] } }]);
  const invoke = createInvoke({ fetchImpl });

  await invoke("update_providers_sort_order", { updates: [{ id: "gone", sortIndex: 5 }] });
  assert.deepEqual(JSON.parse(fetchImpl.calls[1].init.body), { keys: ["a"] });
});

test("commands with no route are answered locally instead of omitted", async () => {
  // `update_tray_menu` runs after every successful mutation in cc-switch, so
  // an unmapped entry would throw *after* the work had already succeeded.
  const fetchImpl = fakeFetch();
  const invoke = createInvoke({ fetchImpl });
  assert.equal(await invoke("update_tray_menu"), true);
  assert.equal(await invoke("get_current_provider", { app: "claude" }), "");
  assert.equal(fetchImpl.calls.length, 0, "neither of them reaches the Host");
});

test("a new row is stamped with the id the form minted", async () => {
  // Without this the row is unaddressable afterwards: every later command
  // resolves `id` through `sourceProfileId`.
  const fetchImpl = fakeFetch([
    { status: 200, body: { key: "ccs-new-00000000", status: "created" } },
  ]);
  const invoke = createInvoke({ fetchImpl });

  await invoke("add_provider", {
    app: "claude",
    id: "uuid-1234",
    provider: { displayName: "New" },
    addToLive: false,
  });

  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), {
    provider: { displayName: "New", sourceProfileId: "uuid-1234" },
  });
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
    // Locally answered commands carry no route at all; anything else must.
    if (typeof route.run === "function") {
      assert.equal(route.path, undefined, `${command} mixes a local answer with a path`);
      continue;
    }
    assert.equal(typeof route.path, "string", `${command} has no path`);
    assert.ok(route.path.startsWith("/api/"), `${command} is not a plugin route: ${route.path}`);
    assert.ok(!route.path.includes("<"), `${command} uses a path parameter DSH cannot match: ${route.path}`);
    assert.ok(["GET", "POST"].includes(route.method), `${command} uses an unsupported method`);
  }
});

test("connectivity check reuses the importer's probe and keeps cc-switch's thresholds", async () => {
  const fetchImpl = fakeFetch([
    { status: 200, body: { providers: { k: { sourceProfileId: "row-1" } } } },
    {
      status: 200,
      body: { results: [{ profileId: "row-1", ok: true, latencyMs: 900, httpStatus: 200 }] },
    },
  ])
  const fast = await createInvoke({ fetchImpl })("stream_check_provider", { appType: "mcode", providerId: "k" })
  assert.equal(fast.status, "operational")
  assert.equal(fast.success, true)
  assert.equal(fast.responseTimeMs, 900)
  assert.equal(fast.httpStatus, 200)
  // The probe is addressed by CC Switch's row id, not the catalogue key.
  assert.deepEqual(JSON.parse(fetchImpl.calls[1].init.body), { profileIds: ["row-1"] })

  // Above cc-switch's 6000 ms `degraded_threshold_ms` the verdict flips; the
  // boundary itself is inclusive, matching `latency <= threshold`.
  const probeAt = async (latencyMs) => {
    const slow = fakeFetch([
      { status: 200, body: { providers: { k: { sourceProfileId: "row-1" } } } },
      { status: 200, body: { results: [{ profileId: "row-1", ok: true, latencyMs }] } },
    ])
    return createInvoke({ fetchImpl: slow })("stream_check_provider", { providerId: "k" })
  }
  assert.equal((await probeAt(6000)).status, "operational")
  assert.equal((await probeAt(6001)).status, "degraded")

  // A probe that did not reach the endpoint reports `failed`, which is the
  // branch `useStreamCheck` renders as an error toast.
  const down = fakeFetch([
    { status: 200, body: { providers: { k: { sourceProfileId: "row-1" } } } },
    { status: 200, body: { results: [{ profileId: "row-1", ok: false, message: "connection refused" }] } },
  ])
  const failed = await createInvoke({ fetchImpl: down })("stream_check_provider", { providerId: "k" })
  assert.equal(failed.status, "failed")
  assert.equal(failed.success, false)
  assert.equal(failed.message, "connection refused")
})

test("a row this plugin created has no CC Switch row to probe, and says so", async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { providers: { k: {} } } }])
  const invoke = createInvoke({ fetchImpl })

  const result = await invoke("stream_check_provider", { providerId: "k" })
  assert.equal(result.status, "failed")
  assert.equal(result.success, false)
  assert.match(result.message, /no CC Switch row/)
  // The look-up is the only request: probing an address we do not have would
  // be a request to nowhere, and a throw here reaches the caller as
  // "检查出错: Error: …", which reads like a bug rather than a limit.
  assert.equal(fetchImpl.calls.length, 1)
})

test('bridge mode sends one exact route carrying {cmd, args} and returns the sidecar answer verbatim', async () => {
  // DSH has no path parameters, so 328 per-command routes would buy nothing;
  // one route whose body names the command fits the constraint the rest of the
  // plugin already follows (the provider key travels in the body too).
  const fetchImpl = fakeFetch([{ status: 200, body: { ok: true, data: { 'ccs-a-11111111': {} } } }])
  const invoke = createInvoke({ fetchImpl, bridge: true })

  const result = await invoke('get_providers', { app: 'dsh' })

  assert.equal(fetchImpl.calls[0].url, '/api/dsh-ccswitch-bridge')
  assert.equal(fetchImpl.calls[0].method, 'POST')
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), {
    cmd: 'get_providers',
    args: { app: 'dsh' },
  })
  // Verbatim — no `receive` projection: the sidecar already answers in
  // cc-switch's own shapes, which is the whole reason for not rewriting it.
  assert.deepEqual(result, { ok: true, data: { 'ccs-a-11111111': {} } })
})

test('bridge mode still answers local commands, and hands the rest — known or not — to the sidecar', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { ok: true, data: null } }])
  const invoke = createInvoke({ fetchImpl, bridge: true })

  // Local overrides stay local even against the sidecar: these three are
  // DSH-specific (no tray; no current pointer under the additive model; the
  // probe is this plugin's own route).
  assert.equal(await invoke('update_tray_menu'), true)
  assert.equal(await invoke('get_current_provider', { app: 'dsh' }), '')
  assert.equal(fetchImpl.calls.length, 0)

  // A command this table has never heard of goes through anyway. The sidecar
  // is the one that knows the command list: it answers, or answers
  // `E_NOT_IMPLEMENTED`. Throwing here first was what made its ~180 commands
  // unreachable while the table named 11.
  await invoke('definitely_not_a_command')
  assert.equal(fetchImpl.calls.length, 1)
  assert.equal(fetchImpl.calls[0].url, '/api/dsh-ccswitch-bridge')
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), {
    cmd: 'definitely_not_a_command',
    args: {},
  })
})

test('without a bridge, an unknown command still throws rather than answering nothing', async () => {
  // The table is the whole contract when nothing else is listening, so an
  // unknown name is a programming error — silence would render blank rows as
  // though the backend had answered.
  const fetchImpl = fakeFetch()
  const invoke = createInvoke({ fetchImpl })
  await assert.rejects(() => invoke('definitely_not_a_command'), UnmappedCommandError)
  assert.equal(fetchImpl.calls.length, 0)
})

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
