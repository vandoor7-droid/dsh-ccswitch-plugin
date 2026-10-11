// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * `@tauri-apps/plugin-log` for a host whose console is the only log there is.
 *
 * cc-switch writes to the system log from `lib/frontendLogger.ts`. The sidecar
 * keeps its own file (`<config>/logs/cc-switch.log`), so whatever this module
 * sees is client-side and belongs on the browser console. Upstream source: the
 * headless fork's `src/web-shims/log.ts`.
 */

const emit =
  (fn) =>
  (message, _options) => {
    fn(message)
  }

export const error = emit(console.error)
export const warn = emit(console.warn)
export const info = emit(console.info)
export const debug = emit(console.debug)
export const trace = emit(console.debug)
