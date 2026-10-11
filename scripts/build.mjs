// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const PLUGIN_ID = "dsh-ccswitch-plugin";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist");

/**
 * Modules that must come from the host, never from this bundle.
 *
 * `react` and `react-dom` are listed with their subpaths because esbuild's
 * `external` matches a bare specifier exactly: `react` does **not** cover
 * `react/jsx-runtime`, which is precisely what cc-switch's components import
 * once the automatic JSX runtime is on. Without `react/*` the build would inline
 * a second React and every hook call in a copied component would fail with
 * "Invalid hook call" — the single worst failure mode in this whole port, and
 * the one `assertSingleReact` exists to catch.
 *
 * `@deepseek-ai/*` is external for the mirror-image reason: DSH's own services
 * are injected into the plugin at load time, and a second copy would be talking
 * to nothing.
 */
export const CLIENT_EXTERNALS = ["react", "react/*", "react-dom", "react-dom/*", "@deepseek-ai/*"];

/**
 * `@deepseek-ai/schemastery` is externalized rather than bundled: the plugin's
 * Config schema is what makes its settings namespace exist, and DSH validates
 * configuration against that schema with its own copy, so the two must be the
 * same build. It is a peer dependency for the same reason. (Bundling would
 * happen to work today — the volatile marker is a `Symbol.for`, so it survives
 * a copy boundary — but it would silently pin the schema to whatever version
 * this repo resolved, which is the kind of drift that surfaces much later as
 * "saves report success and change nothing".)
 */
const HOST_EXTERNALS = ["@deepseek-ai/schemastery"];

/**
 * Where cc-switch's sources are copied to, one directory per upstream `src/`.
 *
 * Mirrors its `tsconfig.json` (`"paths": { "@/*": ["src/*"] }`) and its
 * `vite.config.ts` (`alias: { "@": …/src }`), so a file keeps `@/components/…`
 * verbatim instead of having every import rewritten on the way in.
 */
export const CCS_SRC = resolve(ROOT, "src/ccswitch");

/**
 * `@tauri-apps/api/*` is aliased onto this plugin's own shims, which is the one
 * place the port has to change: cc-switch's frontend reaches its backend over
 * Tauri IPC, and here the same call has to become an HTTP request to a plugin
 * route. Everything else in a copied component compiles untouched.
 *
 * Still deliberately *not* aliased: `@tauri-apps/plugin-dialog` and
 * `@tauri-apps/plugin-process`. They are imported only by `main.tsx`, which is
 * the Tauri entry point and is never mounted — DSH renders `<App />` directly.
 * A build failure that names the file beats a shim that quietly does nothing,
 * so nothing here papers over a module the port has not thought about.
 *
 * The rest were added when the whole of `App.tsx` entered the graph (it used to
 * stop at the provider list, so these six were unreachable and esbuild never
 * looked at them). Each one is a deliberate answer rather than a no-op, which
 * is the distinction the paragraph above was protecting:
 *
 * - `api/app`   — version. Reports the sidecar's, falling back to the vendored
 *                 frontend's own, because both are true statements about what
 *                 the user is looking at; see `tauri-shim/app.mjs`.
 * - `api/path`  — `homeDir()`/`appConfigDir()` come from the sidecar and
 *                 **throw when it has not said**. Every caller already catches,
 *                 so an unknown directory renders as no default instead of a
 *                 guessed one; see `tauri-shim/path.mjs`.
 * - `api/window` — no-ops. The window belongs to DSH; `setDecorations` sits in
 *                 a `useEffect` that would otherwise take the panel down.
 * - `plugin-log`    — console. The sidecar has its own log file.
 * - `plugin-updater` — `check()` returns null: "up-to-date", so no banner. The
 *                 updater is cut by decision #3/M8 and DSH delivers this as a
 *                 package, so saying so is honest rather than inert.
 * - `prettier/*` — a real dependency (`UsageScriptModal` formats usage scripts
 *                 in the browser); upstream lists it as a devDependency and
 *                 bundles it all the same. We install it so the bundle has it.
 */
export const CLIENT_ALIAS = {
  "@": CCS_SRC,
  "@tauri-apps/api/core": resolve(ROOT, "src/client/tauri-shim/core.mjs"),
  "@tauri-apps/api/event": resolve(ROOT, "src/client/tauri-shim/event.mjs"),
  "@tauri-apps/api/app": resolve(ROOT, "src/client/tauri-shim/app.mjs"),
  "@tauri-apps/api/path": resolve(ROOT, "src/client/tauri-shim/path.mjs"),
  "@tauri-apps/api/window": resolve(ROOT, "src/client/tauri-shim/window.mjs"),
  "@tauri-apps/plugin-log": resolve(ROOT, "src/client/tauri-shim/log.mjs"),
  "@tauri-apps/plugin-updater": resolve(ROOT, "src/client/tauri-shim/updater.mjs"),
  // `tailwind-merge` validates class names against its own knowledge, so
  // `cn()` needs the `dsh-ccs-` prefix baked in — otherwise the merge stops
  // merging and `cn("dsh-ccs-p-4", "dsh-ccs-p-2")` emits both.
  "tailwind-merge": resolve(ROOT, "src/client/tauri-shim/tailwind-merge.mjs"),
};

/** cc-switch's `tsconfig.json`: `"jsx": "react-jsx"` (the automatic runtime). */
export const CLIENT_JSX = { jsx: "automatic", jsxImportSource: "react" };

/**
 * Vite-only globals, replaced with their production values.
 *
 * `import.meta.env.DEV` is a plain conditional in cc-switch's settings page and
 * resolves away to `false`. `import.meta.glob` (`src/lib/whatsNew.ts`) has **no**
 * esbuild equivalent — it is a compile-time file glob — so that one file needs a
 * deliberate rewrite when it is copied, and the build fails loudly on it until
 * then rather than silently returning an empty map.
 */
export const CLIENT_DEFINE = {
  "import.meta.env.DEV": "false",
  "import.meta.env.PROD": "true",
  "import.meta.env.MODE": '"production"',
};

/**
 * Binary assets, inlined as data URLs.
 *
 * cc-switch's icon index (`src/icons/extracted/index.ts`) default-imports ~109
 * PNG/SVG/JPEG files, and Vite turns each into a URL string — which is exactly
 * what a data URL is. Emitting separate files was the alternative, but this
 * bundle is written through `createLoaderBundle` as one self-contained script,
 * so there is no asset directory for DSH to serve.
 *
 * The cost is real and worth stating: ~1 MiB of source becomes ~1.4 MiB of base64
 * once that index is copied in. It is paid only when M1 pulls the icon picker in,
 * never before.
 */
export const CLIENT_LOADERS = {
  ".png": "dataurl",
  ".jpg": "dataurl",
  ".jpeg": "dataurl",
  ".gif": "dataurl",
  ".webp": "dataurl",
  ".ico": "dataurl",
  ".svg": "dataurl",
};

/**
 * Strip Vite's asset query (`./x.svg?url`) so esbuild can resolve the file.
 *
 * esbuild treats `x.svg?url` as a filename. Vite treats the suffix as "give me
 * the URL, not the module", and the two answers agree once the file is loaded
 * as a data URL — so the query is dropped and the loader does the rest. The
 * filter is narrow on purpose: only `?url`, so any other Vite-only query still
 * fails to resolve and gets looked at instead of being silently absorbed.
 */
const ASSET_QUERY_PLUGIN = {
  name: "ccswitch-asset-query",
  setup(build) {
    build.onResolve({ filter: /\?url$/ }, (args) => {
      const path = args.path.replace(/\?url$/, "");
      return build.resolve(path, { kind: args.kind, resolveDir: args.resolveDir });
    });
  },
};

const CCS_SOURCE_FILTER = /[\\/]src[\\/]ccswitch[\\/].*\.(ts|tsx|js|jsx)$/;

const LOADERS_BY_EXT = { ".ts": "ts", ".tsx": "tsx", ".js": "js", ".jsx": "jsx" };

/**
 * Rename cc-switch's Tailwind classes on the way in.
 *
 * The vendored sources keep upstream's text; the `dsh-ccs-` prefix is applied
 * here so nothing in git diverges from `cc-switch-src`, while the stylesheet
 * (see `ccswitch:styles`) carries the same prefix. Both sides are derived from
 * one candidate set inside `scripts/ccswitch-style.mjs`, so they cannot drift.
 *
 * Files under `src/ccswitch` are the only ones touched: this plugin's own
 * `.mjs` sources are written against DSH's primitives and use no utilities.
 */
const CCS_PREFIX_PLUGIN = {
  name: "ccswitch-prefix",
  setup(build) {
    build.onLoad({ filter: CCS_SOURCE_FILTER, namespace: "file" }, async (args) => {
      const { candidates, prefixSource } = await import("./ccswitch-style.mjs");
      const extension = args.path.slice(args.path.lastIndexOf("."));
      const source = await readFile(args.path, "utf8");
      return {
        contents: prefixSource(source, await candidates()),
        loader: LOADERS_BY_EXT[extension] ?? "ts",
      };
    });
  },
};

/**
 * `import css from "ccswitch:styles"` — cc-switch's compiled stylesheet.
 *
 * Resolved lazily, so a build that never mounts an upstream component never
 * runs Tailwind at all. The string is inlined rather than written to a `.css`
 * file because DSH loads a plugin as one script; there is no asset directory
 * for it to fetch from.
 */
const CCS_STYLES_PLUGIN = {
  name: "ccswitch-styles",
  setup(build) {
    build.onResolve({ filter: /^ccswitch:styles$/ }, () => ({
      path: "ccswitch:styles",
      namespace: "ccswitch-styles",
    }));
    build.onLoad({ filter: /.*/, namespace: "ccswitch-styles" }, async () => {
      const { buildCss } = await import("./ccswitch-style.mjs");
      const css = await buildCss();
      return { contents: `export default ${JSON.stringify(css)};\n`, loader: "js" };
    });
  },
};

export const CLIENT_PLUGINS = [ASSET_QUERY_PLUGIN, CCS_PREFIX_PLUGIN, CCS_STYLES_PLUGIN];

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

/**
 * Every `node_modules` entry that *is* a copy of React, React DOM or scheduler.
 *
 * Expressed as a package boundary (`/node_modules/<name>/`) rather than a loose
 * substring so `react-is` or `preact` do not trip it.
 */
export function bundledReactInputs(metafile) {
  const inputs = Object.keys(metafile?.inputs ?? {});
  return inputs.filter((path) => {
    const marker = `${"node_modules"}/`;
    let index = path.indexOf(marker);
    while (index >= 0) {
      const rest = path.slice(index + marker.length);
      const end = rest.search(/[\\/]/);
      const pkg = end < 0 ? rest : rest.slice(0, end);
      if (pkg === "react" || pkg === "react-dom" || pkg === "scheduler") return true;
      index = path.indexOf(marker, index + marker.length);
    }
    return false;
  });
}

/**
 * Whether an import specifier is covered by an externals list.
 *
 * The metafile reports the specifier the source wrote (`react/jsx-runtime`),
 * never the pattern that matched it, so the `/*` forms have to be expanded
 * here rather than compared with `includes`. `patterns` is a parameter only so
 * the expansion can be tested against a list other than the live one — with
 * today's `react/*` entry every React subpath is already covered, and the
 * branch in {@link assertSingleReact} exists to catch the day that stops being
 * true.
 */
export function coveredByExternals(specifier, patterns = CLIENT_EXTERNALS) {
  return patterns.some((pattern) => (
    pattern.endsWith("/*")
      ? specifier.startsWith(pattern.slice(0, -1))
      : specifier === pattern
  ));
}

/**
 * Refuse to ship a bundle with a second React in it.
 *
 * DSH hands the plugin exactly one React (it is a peer dependency and an
 * external), so any `react`/`react-dom`/`scheduler` file that reached the
 * graph means a copy got resolved and inlined somewhere — a hoisting accident,
 * a dependency that bundles rather than peers, or an `external` list that
 * stopped matching. Hooks do not cross a React copy, so the symptom would be
 * "Invalid hook call" in a component that looks correct.
 *
 * Checked from esbuild's metafile rather than by grepping the output: the
 * metafile says which files were *read*, which is the question that matters.
 *
 * @returns {{ inlined: number, reactExternals: string[] }}
 * @throws {Error} naming every offending input or uncovered specifier.
 */
export function assertSingleReact(metafile, label = "client") {
  const inlined = bundledReactInputs(metafile);
  if (inlined.length > 0) {
    throw new Error(
      `${label} inlined a second React runtime. These must stay external so the plugin ` +
      `uses DSH's own copy: ${inlined.join(", ")}`,
    );
  }
  // Nothing was inlined; now check the externals list still *covers* every
  // React specifier the graph reached for. A specifier that resolved but was
  // caught by the check above would already have failed, so this is the cheaper
  // statement that the list has not fallen behind the source.
  const externals = new Set();
  for (const output of Object.values(metafile?.outputs ?? {})) {
    for (const entry of output.imports ?? []) if (entry.external) externals.add(entry.path);
  }
  const reactExternals = [...externals].filter((path) =>
    path === "react" || path.startsWith("react/")
    || path === "react-dom" || path.startsWith("react-dom/"));
  const unlisted = reactExternals.filter((path) => !coveredByExternals(path));
  if (unlisted.length > 0) {
    throw new Error(
      `${label} resolved ${unlisted.join(", ")} from the host but CLIENT_EXTERNALS does not ` +
      "list it, so the next build may inline it",
    );
  }
  return { inlined: 0, reactExternals: [...reactExternals].sort() };
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

/** The client half's esbuild options, exported so a test can compile a fixture with them. */
export function clientBuildOptions() {
  return {
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    external: CLIENT_EXTERNALS,
    alias: CLIENT_ALIAS,
    define: CLIENT_DEFINE,
    loader: CLIENT_LOADERS,
    plugins: CLIENT_PLUGINS,
    metafile: true,
    ...CLIENT_JSX,
  };
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
    ...clientBuildOptions(),
  });
  assertSingleReact(client.metafile, "dist/client.js");
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
