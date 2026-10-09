// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { importProfiles } from '../../lib/core/importer.js'
import { makeRoutes } from './routes.mjs'

export const name = 'dsh-ccswitch-plugin'
export const inject = ['webServer', 'settings', 'credentials']

export function apply(ctx) {
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
