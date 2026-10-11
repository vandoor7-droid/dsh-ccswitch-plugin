// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * `@tauri-apps/api/app` for a host that is not Tauri.
 *
 * cc-switch shows `getVersion()` on the About page, in the "What's new" dialog
 * header and in `NewLayoutDialog`. The truthful answer is the sidecar's version
 * (it is the thing actually running the backend), falling back to the vendored
 * frontend's own version — which is what the user is looking at — when the
 * bridge is not up yet.
 *
 * Upstream source: the headless fork's `src/web-shims/app.ts`. The only change
 * is the fallback: that shim has no "not running yet" state to fall back to,
 * because there the server is always there.
 */
import { serverEnv } from './env.mjs'

/** Matches `src/ccswitch/`'s vendored upstream version. See that README. */
export const VENDORED_VERSION = '4.0.8'

export async function getVersion() {
  const env = await serverEnv()
  return env?.version || VENDORED_VERSION
}

export function getName() {
  return 'CC Switch'
}

export function getTauriVersion() {
  return ''
}
