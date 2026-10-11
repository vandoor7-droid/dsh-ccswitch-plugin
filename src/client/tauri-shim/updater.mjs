// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * `@tauri-apps/plugin-updater` for a host that updates by being reinstalled.
 *
 * `lib/updater.ts` imports this **dynamically** (its own comment: "动态引入，
 * 避免在未安装插件时导致打包期问题"), but esbuild still resolves a dynamic
 * `import()` while bundling, so an absent module is a build error rather than
 * a deferred one — which is why this shim has to exist at all.
 *
 * `check()` returning `null` makes `checkForUpdate` answer `"up-to-date"`, so
 * the "update available" banner never appears. That is the truth and it is also
 * the decision: the built-in updater is a platform-mapping item we cut (plan
 * decision #3 / M8), and DSH delivers this plugin as a package. Upstream source:
 * the headless fork's `src/web-shims/updater.ts`.
 */

export async function check(_options) {
  return null
}
