// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import z from '@deepseek-ai/schemastery'
import { importProfiles } from '../../lib/core/importer.js'
import { toProviderProfile } from '../../lib/core/mapper.js'
import { defineCCSConfig } from '../domain/ccs-provider.mjs'
import { PROVIDER_PRESETS } from '../domain/presets.mjs'
import { makeManagerRoutes, MANAGER_NAMESPACE } from './manager-routes.mjs'
import { makeRoutes } from './routes.mjs'
import { makeBridgeRoutes } from './bridge.mjs'
import { createSidecarManager, resolveBinaryPath, RESERVED_PORTS } from './sidecar-manager.mjs'

export const name = 'dsh-ccswitch-plugin'
export const inject = ['webServer', 'settings', 'credentials']

/**
 * The sidecar's own HTTP port.
 *
 * 15721 belongs to cc-switch's proxy and 15800 is its own default, so neither
 * can be used here. The default below is deliberately outside both, and an env
 * override exists because a fixed port collides the first time two of these
 * run.
 */
function sidecarPort(env = process.env) {
  const raw = env.CC_SWITCH_SIDECAR_PORT
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10)
  const port = Number.isInteger(parsed) && parsed > 0 ? parsed : 15881
  if (RESERVED_PORTS.includes(port)) {
    throw new Error(`CC_SWITCH_SIDECAR_PORT=${port} is reserved by cc-switch's own proxy`)
  }
  return port
}

/** Where the sidecar keeps its database and settings. */
function sidecarConfigDir(env = process.env) {
  const raw = env.CC_SWITCH_SIDECAR_CONFIG_DIR
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

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

  // 0.2.0 SettingsForms has no get(); describe() returns per-namespace views.
  // `describe()` is synchronous, so the read is wrapped only to keep one shape.
  const providersOf = (ns) => async () => {
    const namespaces = await ctx.settings.describe()
    const namespace = (Array.isArray(namespaces) ? namespaces : []).find((entry) => entry.ns === ns)
    return namespace?.value?.providers ?? {}
  }

  const routes = makeRoutes({
    getProviders: providersOf('llm-pi-ai'),
    // The importer writes this namespace too, so the scan preview has to
    // classify against it — see the note in routes.mjs.
    getCatalogue: providersOf(MANAGER_NAMESPACE),
    settings: ctx.settings,
    credentials: ctx.credentials,
    importProfiles,
  })
  const managerRoutes = makeManagerRoutes({
    settings: ctx.settings,
    credentials: ctx.credentials,
    presets: PROVIDER_PRESETS,
    // Membership of `llm-pi-ai`'s route table is the plugin's whole idea of
    // "applied", so it is read from the live namespace rather than mirrored
    // into the catalogue. One reader for the list and for delete/withdraw
    // means the two can never disagree about what is serving traffic.
    readLiveProviders: providersOf('llm-pi-ai'),
    applyProvider: async (key, provider) => {
      // Applying a provider here has to mean something to DSH itself, or the
      // row would be listed as applied while every request kept going to a
      // route that did not name it. The provider is projected into
      // `llm-pi-ai` through the *same* mapper the importer uses, so a provider
      // added by hand and one imported from CC Switch produce an identical
      // route.
      const namespaces = await ctx.settings.describe()
      const live = (Array.isArray(namespaces) ? namespaces : []).find((entry) => entry.ns === 'llm-pi-ai')
      if (live === undefined) {
        return ['llm-pi-ai is not installed, so the provider was marked applied but DSH has no route to use it']
      }
      const existing = live.value?.providers?.[key]
      const mapped = toProviderProfile({
        profileId: provider?.sourceProfileId ?? key,
        profileName: provider?.displayName ?? key,
        baseURL: provider?.baseURL,
        api: provider?.api,
        models: provider?.models ?? [],
        modelReasoningEffort: undefined,
      }, existing, key)
      await ctx.settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', key], value: mapped }], live.revision)
      return []
    },
    withdrawProvider: async (key) => {
      // Removing the member is the only edit: the catalogue row, its stored
      // credential and every default stay exactly as they were. That is the
      // rule CC Switch's `pi_config` states as
      // `provider_membership_never_changes_pi_auth_or_defaults`, and it is what
      // makes applying and withdrawing repeatable rather than destructive.
      const namespaces = await ctx.settings.describe()
      const live = (Array.isArray(namespaces) ? namespaces : []).find((entry) => entry.ns === 'llm-pi-ai')
      if (live === undefined) return
      if (!Object.hasOwn(live.value?.providers ?? {}, key)) return
      await ctx.settings.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', key] }], live.revision)
    },
  })
  const allRoutes = [...routes, ...managerRoutes]
  ctx.effect(() => {
    const disposers = allRoutes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) if (typeof dispose === 'function') dispose()
    }
  }, 'dsh-ccswitch-plugin: routes')

  // The sidecar and the bridge route that fronts it, in their own effect:
  // their lifetime is the process's, not a route's. The route has to be
  // reachable while the sidecar is still starting — otherwise a first render
  // 404s where it should say "not ready" — and the process has to die with the
  // plugin rather than outlive it holding a port and a database.
  ctx.effect(() => {
    const disposers = []

    let manager = null
    try {
      manager = createSidecarManager({
        binary: resolveBinaryPath(),
        port: sidecarPort(),
        configDir: sidecarConfigDir(),
      })
      manager.start()
    } catch (error) {
      // No binary is a normal state, not a load failure: this plugin's other
      // surfaces work without it, and the bridge below still answers 503 so a
      // table reads "not ready" instead of a stack.
      console.warn(`[dsh-ccswitch-plugin] sidecar not started: ${error.message}`)
    }

    for (const route of makeBridgeRoutes({ sidecar: async () => manager?.resolve() ?? null })) {
      disposers.push(ctx.webServer.register(route))
    }

    return () => {
      // The manager goes first: dropping the route while the process is still
      // running would leave a listener behind after the plugin is gone.
      void manager?.stop()
      for (const dispose of disposers) if (typeof dispose === 'function') dispose()
    }
  }, 'dsh-ccswitch-plugin: sidecar')
}
