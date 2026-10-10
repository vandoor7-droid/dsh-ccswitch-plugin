// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The frontend base: proof that cc-switch's sources compile through this
 * repo's esbuild pipeline without being rewritten first.
 *
 * The fixture under `test/fixtures/pipeline/` deliberately uses every feature
 * that would otherwise force a rewrite — automatic JSX, the `@/` path alias,
 * a JSON import, Vite's `?url` asset suffix, `import.meta.env`, and
 * `@tauri-apps/api/core` — so a regression in any one of them fails here
 * rather than the first time a real component is copied in.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import {
  CCS_SRC,
  CLIENT_ALIAS,
  assertSingleReact,
  bundledReactInputs,
  clientBuildOptions,
  coveredByExternals,
} from "../scripts/build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = resolve(ROOT, "test/fixtures/pipeline");

/** Compile the fixture exactly as the client bundle would be compiled. */
async function compileFixture() {
  return build({
    ...clientBuildOptions(),
    entryPoints: [resolve(FIXTURE, "entry.tsx")],
    alias: { ...CLIENT_ALIAS, "@": FIXTURE },
  });
}

test("the @ alias points at the directory cc-switch sources are copied into", () => {
  assert.equal(CLIENT_ALIAS["@"], CCS_SRC);
  assert.equal(CCS_SRC, resolve(ROOT, "src/ccswitch"));
});

test("the Tauri IPC layer is aliased onto the plugin's own shims", () => {
  assert.equal(
    CLIENT_ALIAS["@tauri-apps/api/core"],
    resolve(ROOT, "src/client/tauri-shim/core.mjs"),
  );
  assert.equal(
    CLIENT_ALIAS["@tauri-apps/api/event"],
    resolve(ROOT, "src/client/tauri-shim/event.mjs"),
  );
  // Window chrome and the platform plugins are deliberately absent — see the
  // note in scripts/build.mjs.
  assert.equal(Object.hasOwn(CLIENT_ALIAS, "@tauri-apps/api/window"), false);
});

test("a cc-switch-shaped TSX fixture compiles through the pipeline", async () => {
  const result = await compileFixture();
  const js = result.outputFiles[0].text;

  // JSX compiled with the automatic runtime, and `@/widget` resolved through
  // the alias — both are proven by the widget's own literal reaching the output.
  assert.match(js, /widget-rendered:/);

  // The JSON import is inlined rather than left as a path.
  assert.match(js, /fixture/);
  assert.ok(!js.includes("./meta.json"), "the JSON import must be inlined");

  // Vite's `?url` suffix, loaded as a data URL.
  assert.match(js, /data:image\/svg\+xml/);
  assert.ok(!js.includes(".svg?url"), "the asset query must not survive into the bundle");

  // `import.meta.env.DEV` replaced, not left dangling in a CJS bundle.
  assert.ok(!js.includes("import.meta.env"), "import.meta.env must be defined away");

  // `invoke` came from the shim, not from a Tauri package.
  assert.match(js, /no route is mapped for the cc-switch command/);
});

test("the fixture's React stays external, and the gate agrees", async () => {
  const result = await compileFixture();
  const checked = assertSingleReact(result.metafile, "fixture");
  assert.deepEqual(checked.inlined, 0);
  assert.ok(
    checked.reactExternals.includes("react/jsx-runtime"),
    `expected react/jsx-runtime to be external, got ${JSON.stringify(checked.reactExternals)}`,
  );
  assert.deepEqual(bundledReactInputs(result.metafile), []);
});

test("assertSingleReact rejects a bundle that inlined a React copy", () => {
  const metafile = {
    inputs: {
      "src/a.mjs": {},
      "node_modules/react/index.js": {},
      "node_modules/dep/node_modules/react-dom/index.js": {},
      // Not React: a similar name must not trip the check.
      "node_modules/react-is/index.js": {},
    },
    outputs: {},
  };
  assert.throws(
    () => assertSingleReact(metafile, "dist/client.js"),
    (error) => {
      assert.match(error.message, /inlined a second React runtime/);
      assert.match(error.message, /node_modules[\\/]react[\\/]index\.js/);
      assert.match(error.message, /node_modules[\\/]react-dom[\\/]index\.js/);
      assert.ok(!error.message.includes("react-is"), "react-is is not a React copy");
      return true;
    },
  );
});

test("the externals pattern expands subpaths instead of matching them literally", () => {
  assert.ok(coveredByExternals("react", ["react", "react/*"]));
  assert.ok(coveredByExternals("react/jsx-runtime", ["react", "react/*"]));
  assert.ok(coveredByExternals("react-dom/client", ["react-dom", "react-dom/*"]));
  assert.ok(!coveredByExternals("react/jsx-runtime", ["react"]), "a bare `react` must not cover its subpaths");
  assert.ok(!coveredByExternals("react-dom", ["react", "react/*"]));
  assert.ok(coveredByExternals("react/jsx-runtime"), "the live list must cover the automatic runtime");
});

test("the shipped client bundle carries no React of its own", async () => {
  // `npm test` runs `npm run build` first, so this file exists and was produced
  // by the same options the gate above ran against. The metafile is gone by
  // then, so the artifact itself is checked for React's own tell-tale strings:
  // `react` is external, so none of these can be present unless a copy got in.
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(resolve(ROOT, "dist/client.js"), "utf8");
  assert.match(source, /window\.__ModuleLoader__\.load/);
  for (const marker of ["__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED", "ReactCurrentOwner"]) {
    assert.ok(!source.includes(marker), `dist/client.js contains ${marker}, so React was bundled`);
  }
});
