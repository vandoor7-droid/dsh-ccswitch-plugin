// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const PLUGIN_ID = "dsh-ccswitch-plugin";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist");
const CLIENT_EXTERNALS = ["react", "react-dom", "@deepseek-ai/*"];
// `@deepseek-ai/schemastery` is externalized rather than bundled: the plugin's
// Config schema is what makes its settings namespace exist, and DSH validates
// configuration against that schema with its own copy, so the two must be the
// same build. It is a peer dependency for the same reason. (Bundling would
// happen to work today — the volatile marker is a `Symbol.for`, so it survives
// a copy boundary — but it would silently pin the schema to whatever version
// this repo resolved, which is the kind of drift that surfaces much later as
// "saves report success and change nothing".)
const HOST_EXTERNALS = ["@deepseek-ai/schemastery"];

export function createLoaderBundle(id, commonJs) {
  const body = commonJs.trimEnd().split("\n").map((line) => line ? `\t\t${line}` : "").join("\n");
  return `window.__ModuleLoader__.load({\n` +
    `\tid: ${JSON.stringify(id)},\n` +
    `\tfactory: (require) => {\n` +
    `\t\tvar module = { exports: {} };\n` +
    `\t\tvar exports = module.exports;\n` +
    `${body}\n` +
    `\t\treturn module.exports;\n` +
    `\t}\n` +
    `});\n`;
}

async function bundleEntry(entry, outfile, options = {}) {
  const result = await build({
    entryPoints: [resolve(ROOT, entry)],
    bundle: true,
    write: false,
    ...options,
  });
  await writeFile(resolve(ROOT, outfile), result.outputFiles[0].text, "utf8");
}

export async function buildAll() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(resolve(DIST, "domain"), { recursive: true });

  await bundleEntry("src/host/index.mjs", "dist/index.mjs", {
    format: "esm",
    platform: "node",
    external: HOST_EXTERNALS,
  });

  const client = await build({
    entryPoints: [resolve(ROOT, "src/client/index.mjs")],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    external: CLIENT_EXTERNALS,
  });
  await writeFile(resolve(DIST, "client.js"), createLoaderBundle(PLUGIN_ID, client.outputFiles[0].text), "utf8");

  for (const entry of ["catalog", "validation", "settings", "ccs-provider"]) {
    await bundleEntry(`src/domain/${entry}.mjs`, `dist/domain/${entry}.mjs`, {
      format: "esm",
      platform: "neutral",
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildAll();
}
