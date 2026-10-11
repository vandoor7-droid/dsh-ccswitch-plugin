// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The left-sidebar entry.
 *
 * The requirement it protects is positional: the row has to sit **beneath**
 * 自动化任务, and DSH orders those rows by the numeric `order` the plugin
 * supplies — 插件 is `0`, 自动化任务 is `10`. A lower number would silently
 * shuffle this row above them; nothing else would notice, because the shell
 * renders whatever it is handed. That is a user-visible regression no runtime
 * failure would surface.
 *
 * It also compiles `panel.mjs` through the real client pipeline, so the module
 * that wires `<App />` into DSH is held to the same resolution rules as the
 * rest of the bundle: the `@/` alias onto the vendored sources, `ccswitch:styles`
 * (a virtual module only `scripts/build.mjs` knows how to answer), and the
 * five `@tauri-apps/*` shims. A panel that imports one more thing than the
 * pipeline can resolve fails here instead of rendering a blank column.
 *
 * The panel body itself is deliberately not mounted: `App` issues hundreds of
 * `invoke` calls on its first render, so a DOM test would be asserting on
 * transport failure rather than on the registration contract below.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { clientBuildOptions } from "../scripts/build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PANEL = resolve(ROOT, "src/client/panel.mjs");

/** Compile the panel exactly as the client bundle compiles it. */
async function compilePanel() {
  const result = await build({
    ...clientBuildOptions(),
    entryPoints: [PANEL],
  });
  return result.outputFiles[0].text;
}

test("the panel compiles through the client pipeline", async () => {
  // Resolution is the assertion: `ccswitch:styles` in particular is a virtual
  // module, and every `@tauri-apps/*` import has to land on a shim.
  const js = await compilePanel();
  assert.ok(js.length > 0, "the panel must produce output");
});

test("the row sits beneath 插件 (0) and 自动化任务 (10)", async () => {
  const js = await compilePanel();
  assert.match(js, /sidebar\.panellist/);
  assert.match(
    js,
    /order:\s*20/,
    "order 20 places the row third; 0 and 10 are taken by 插件 and 自动化任务",
  );
});

test("the row and the body are keyed on the same id", async () => {
  const js = await compilePanel();
  // Both seats are joined through PANEL_ID: the row's `id` is what the shell
  // passes as `activePanelId`, and `layout.selectPanel` rejects a key the
  // `main` slot does not hold — mismatching them throws on click.
  assert.match(js, /PANEL_ID\s*=\s*"ccswitch"/);
  assert.match(js, /name:\s*"main"/);
  assert.match(js, /key:\s*PANEL_ID/);
});

test("the label is a thunk so it follows a locale switch", async () => {
  const js = await compilePanel();
  // A plain string would be frozen at registration time; the shell re-reads a
  // function on every render after `ctx.locale` changes.
  assert.match(js, /label:\s*\(\)\s*=>/);
});
