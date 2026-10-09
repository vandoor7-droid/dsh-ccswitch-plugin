// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import z from '@deepseek-ai/schemastery'
import { importProfiles } from '../../lib/core/importer.js'
import { defineCCSConfig } from '../domain/ccs-provider.mjs'
import { makeRoutes } from './routes.mjs'

export const name = 'dsh-ccswitch-plugin'
export const inject = ['webServer', 'settings', 'credentials']

/**
 * The plugin's own settings namespace, which DSH derives from this schema and
 * files under this plugin's loader row id (`dsh-ccswitch-plugin`).
 *
 * Declaring it is what moves the provider catalogue out of `llm-pi-ai` and into
 * a namespace this plugin owns. `SettingsForms.describe()` reports one
 * descriptor per plugin whose `Config` carries a volatile field, and
 * `mutate(ns, ops)` addresses it by that row id — so the browser can add, edit
 * and delete providers without the built-in Models page's schema or its
 * validation rules being involved at all.
 *
 * `z` is DSH's own `@deepseek-ai/schemastery`, and that is load-bearing rather
 * than incidental: only that build turns a `.volatile()` field into a cosmokit
 * `Volatile` reference when it parses the config, and the Loader commits live
 * edits by walking those references. A schema built with the public
 * `schemastery` package yields plain values instead, leaving the Loader nothing
 * to commit, so every write would report success and change nothing. The
 * package is therefore a peer dependency and is externalized in the build, so
 * the host half binds to the same copy DSH parses with.
 */
export const Config = defineCCSConfig(z)

export function apply(ctx) {
  // This plugin ships its own management page, so the form DSH would otherwise
  // generate for the schema above would only duplicate it. `auto: false` is a
  // presentation policy and does not remove read or write access to the
  // namespace (see dsh-client-locale and dsh-agent-default-model, which
  // declare it the same way).
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  const routes = makeRoutes({
    // 0.2.0 SettingsForms has no get(); describe() returns per-namespace views.
    getProviders: async () => {
      const namespaces = ctx.settings.describe()
      const namespace = namespaces.find((entry) => entry.ns === 'llm-pi-ai')
      return namespace?.value?.providers ?? {}
    },
    settings: ctx.settings,
    credentials: ctx.credentials,
    importProfiles,
  })
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) if (typeof dispose === 'function') dispose()
    }
  }, 'dsh-ccswitch-plugin: routes')
}
