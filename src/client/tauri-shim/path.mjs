// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * `@tauri-apps/api/path` for a renderer that has no filesystem view.
 *
 * cc-switch resolves directory *defaults* from these: `homeDir()` + a relative
 * folder gives `~/.claude`, `~/.codex`, `~/.cc-switch` for display when the
 * user has not overridden them (`useDirectorySettings.ts:67-93`). The real,
 * authoritative paths come from `get_config_dir`, which is a sidecar command —
 * this is only the fallback the panel shows underneath it.
 *
 * So `homeDir()` throwing here is not a failure the user sees: every caller is
 * wrapped in try/catch and simply renders no default. What it must NOT do is
 * invent a path, because a wrong `~/.claude` default is worse than none — the
 * user would save it and cc-switch would look in the wrong place.
 *
 * `join()` needs no server: it is a pure string operation with the same rules
 * as Tauri's (empty segments dropped, an absolute segment restarts the join).
 * Upstream source: the headless fork's `src/web-shims/path.ts`.
 */
import { serverEnv } from './env.mjs'

export async function homeDir() {
  const env = await serverEnv()
  if (!env?.homeDir) throw new Error('服务端未提供 home 目录')
  return env.homeDir
}

export async function appConfigDir() {
  const env = await serverEnv()
  if (!env?.configDir) throw new Error('服务端未提供配置目录')
  return env.configDir
}

/** Same contract as Tauri's `join`: drop empty parts; a rooted part restarts. */
export async function join(...parts) {
  const filtered = parts.filter((part) => part.length > 0)
  if (filtered.length === 0) return ''
  return filtered.reduce((acc, part) => {
    if (acc.length === 0) return part
    if (part.startsWith('/')) return part
    return acc.endsWith('/') ? `${acc}${part}` : `${acc}/${part}`
  }, '')
}
