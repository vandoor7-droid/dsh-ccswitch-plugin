// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The same-origin marker has to be spelled identically on both halves.
 *
 * `src/host/routes.mjs` and `src/client/http.mjs` cannot import each other:
 * the host module reaches the scan core and therefore `node:sqlite`, which
 * cannot be bundled for the browser. The duplication is deliberate, and this
 * test is what stops the two copies drifting — a mismatch shows up only as
 * every write returning "missing Origin", which reads like a browser bug.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  SAME_ORIGIN_HEADER as CLIENT_HEADER,
  SAME_ORIGIN_VALUE as CLIENT_VALUE,
  writeHeaders,
  readJson,
} from "../src/client/http.mjs";
import {
  SAME_ORIGIN_HEADER as HOST_HEADER,
  SAME_ORIGIN_VALUE as HOST_VALUE,
} from "../src/host/routes.mjs";

test("client and host agree on the same-origin marker", () => {
  assert.equal(CLIENT_HEADER, HOST_HEADER);
  assert.equal(CLIENT_VALUE, HOST_VALUE);
});

test("every state-changing client request carries the marker and a JSON body", () => {
  const headers = writeHeaders();
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers[CLIENT_HEADER], CLIENT_VALUE);
});

test("an unreadable body is undefined rather than a thrown parse error", async () => {
  const empty = { json: async () => { throw new Error("not json"); } };
  assert.equal(await readJson(empty), undefined);
  const html = { json: async () => ({}) };
  assert.deepEqual(await readJson(html), {});
});
