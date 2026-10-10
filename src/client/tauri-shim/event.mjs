// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * `@tauri-apps/api/event` for a plugin that has no Tauri.
 *
 * Aliased the same way `core.mjs` is, so a copied component that subscribes to
 * a backend event reaches here instead of failing to resolve.
 *
 * **Every function throws.** DSH has no event bus of cc-switch's shape; the
 * equivalent is the plugin's `ctx.remote` bridge, which does not exist yet. A
 * no-op `listen` would be worse than an error: the component would render an
 * idle state that never changes and looks exactly like "the backend has
 * nothing to say", which is the same silent-failure shape the route table in
 * `./commands.mjs` refuses to allow.
 *
 * The channel name is carried on the error so the first copy of a component
 * that needs one says precisely which bridge has to be built (M2 for proxy
 * status, M4 for usage, M7 for the rest).
 */
export class UnmappedEventError extends Error {
  constructor(channel, action) {
    super(
      `cc-switch event "${channel}" is not available in this plugin (${action}); `
      + 'DSH has no Tauri event bus — this has to be bridged over ctx.remote',
    )
    this.name = 'UnmappedEventError'
    this.channel = channel
  }
}

/** Subscribe to a backend event. Not implemented — see the module note. */
export async function listen(channel) {
  throw new UnmappedEventError(channel, 'listen')
}

/** Subscribe to the next occurrence only. Not implemented. */
export async function once(channel) {
  throw new UnmappedEventError(channel, 'once')
}

/** Publish an event to the backend. Not implemented. */
export async function emit(channel) {
  throw new UnmappedEventError(channel, 'emit')
}
