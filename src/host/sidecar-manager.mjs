// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * Supervising the cc-switch sidecar.
 *
 * The sidecar is a 55MB Rust binary, not a library: this module is what makes
 * it behave like one. It owns the process from spawn to teardown, and hands the
 * bridge route an `{ origin, token }` only when the thing is actually answering.
 *
 * Four properties matter more than the plumbing.
 *
 * 1. **It never rewrites anyone else's config.** `CC_SWITCH_CLIENT_PROJECTION=off`
 *    is passed on every launch. Without it, merely starting the server edits
 *    `~/.claude` to clear a legacy proxy placeholder — before this plugin has
 *    been asked for anything, and against this project's rule that external
 *    writers are never invoked (decision #5). Forgetting this one variable is
 *    exactly the failure that would do the most damage to the least expected
 *    moment, which is why it is not optional here.
 * 2. **A dead sidecar is not a broken request.** The bridge answers 503 while
 *    this is down, and {@link SidecarManager#resolve} returns `null` rather
 *    than throwing, so a table that renders during startup shows "not ready"
 *    instead of a stack.
 * 3. **Restart is bounded.** A process that exits is restarted, but a run that
 *    dies within `QUICK_DEATH_MS` counts toward a budget; once the budget is
 *    spent the manager stops trying and says so. A binary that cannot stay up
 *    should fail visibly, not thrash forever while every request times out.
 * 4. **Teardown takes the tree.** The sidecar may hold a proxy listener and a
 *    SQLite writer. `SIGTERM`, then grace, then a forced kill of the whole
 *    process group — a half-dead parent with a live child would keep the port
 *    and the database.
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'

/** How often the sidecar is asked whether it is still there. */
export const HEALTH_INTERVAL_MS = 30_000

/** A death this soon after start counts as a crash, not a normal exit. */
export const QUICK_DEATH_MS = 10_000

/** How many quick deaths are tolerated before supervision gives up. */
export const MAX_QUICK_DEATHS = 3

/** How long a terminating sidecar gets before the tree is killed. */
export const GRACE_MS = 5_000

/** How long a probe may take before the sidecar counts as unhealthy. */
export const PROBE_TIMEOUT_MS = 5_000

/**
 * The proxy port cc-switch claims for itself. Never hand it to the sidecar's
 * own HTTP listener: the two would fight over the bind and one would silently
 * lose.
 */
export const RESERVED_PORTS = [15721]

/** Generate the bearer token the sidecar will accept. */
export function makeToken() {
  return randomBytes(32).toString('hex')
}

/**
 * Find the sidecar binary.
 *
 * `CC_SWITCH_SIDECAR_BIN` wins so a developer can point at a local build
 * without touching code. Otherwise the platform package that ships the binary
 * is consulted, and if it is absent the caller is told plainly: this plugin
 * cannot fall back to "run whatever is on PATH", because a `cc-switch-server`
 * of the wrong version would be a silent behaviour change.
 */
export function resolveBinaryPath({ env = process.env, packageResolver } = {}) {
  const override = env.CC_SWITCH_SIDECAR_BIN
  if (typeof override === 'string' && override.trim() !== '') return override.trim()

  const platform = `${process.platform}-${process.arch}`
  const packageName = `@dsh-ccswitch/${platform}`
  if (typeof packageResolver === 'function') {
    const resolved = packageResolver(packageName)
    if (typeof resolved === 'string' && resolved.trim() !== '') return resolved.trim()
    if (resolved instanceof Error) throw resolved
    throw new Error(
      `sidecar binary not found: install ${packageName}, or set CC_SWITCH_SIDECAR_BIN`,
    )
  }
  throw new Error(
    `sidecar binary not found: no package resolver, and CC_SWITCH_SIDECAR_BIN is unset`,
  )
}

/** Kill a process and everything it started. */
function killTree(child, signal, spawnImpl) {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    // `taskkill /T` walks the tree; a bare kill leaves the proxy listener up.
    try {
      spawnImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    } catch {
      child.kill(signal)
    }
    return
  }
  try {
    process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

/**
 * Supervise one sidecar process.
 *
 * @param {object} options
 * @param {string} options.binary - absolute path to `cc-switch-server`.
 * @param {string} [options.configDir] - passed as `CC_SWITCH_CONFIG_DIR`.
 * @param {number} [options.port] - the sidecar's own HTTP port.
 * @param {typeof nodeSpawn} [options.spawnImpl]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(entry: {level: string, message: string}) => void} [options.log]
 * @param {() => number} [options.now] - clock, for tests.
 */
export function createSidecarManager({
  binary,
  configDir,
  port,
  spawnImpl = nodeSpawn,
  fetchImpl = (url, init) => globalThis.fetch(url, init),
  log = () => {},
  now = () => Date.now(),
  healthIntervalMs = HEALTH_INTERVAL_MS,
  graceMs = GRACE_MS,
  quickDeathMs = QUICK_DEATH_MS,
  maxQuickDeaths = MAX_QUICK_DEATHS,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  if (typeof binary !== 'string' || binary.trim() === '') {
    throw new TypeError('createSidecarManager: binary path is required')
  }
  if (port === undefined || RESERVED_PORTS.includes(port)) {
    throw new TypeError(
      `createSidecarManager: port must be supplied and not one of ${RESERVED_PORTS.join(', ')}`,
    )
  }

  const token = makeToken()
  const origin = `http://127.0.0.1:${port}`
  let child = null
  let healthTimer = null
  let quickDeaths = 0
  let lastStartAt = 0
  let stopping = false
  let gaveUp = false

  function resolve() {
    if (gaveUp || stopping || !child) return null
    return { origin, token }
  }

  function spawnOnce() {
    lastStartAt = now()
    log({ level: 'info', message: `starting cc-switch sidecar on ${origin}` })
    const next = spawnImpl(binary, ['--port', String(port), '--bind', '127.0.0.1', '--token', token], {
      env: {
        ...process.env,
        ...(configDir ? { CC_SWITCH_CONFIG_DIR: configDir } : {}),
        // See property 1 in the file header: this is the variable that keeps
        // the sidecar out of the user's ~/.claude, ~/.codex and friends.
        CC_SWITCH_CLIENT_PROJECTION: 'off',
        CC_SWITCH_WEB_TOKEN: token,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    child = next
    next.on('error', (error) => {
      log({ level: 'error', message: `sidecar spawn failed: ${error.message}` })
      noteDeath('spawn-error')
    })
    next.on('exit', (code, signal) => {
      if (stopping) return
      noteDeath(`exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`)
    })
    return next
  }

  function noteDeath(why) {
    if (stopping) return
    const quick = now() - lastStartAt < quickDeathMs
    quickDeaths = quick ? quickDeaths + 1 : 0
    child = null
    if (quick && quickDeaths >= maxQuickDeaths) {
      gaveUp = true
      log({
        level: 'error',
        message: `sidecar died ${quickDeaths} times within ${quickDeathMs}ms each; not restarting`,
      })
      return
    }
    log({ level: 'warn', message: `sidecar ${why}; restarting` })
    spawnOnce()
  }

  async function probe() {
    if (!child) return
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), probeTimeoutMs)
    try {
      const response = await fetchImpl(`${origin}/api/env`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      if (response.ok) return
      log({ level: 'warn', message: `health probe returned ${response.status}` })
    } catch (error) {
      log({ level: 'warn', message: `health probe failed: ${error?.message ?? error}` })
    } finally {
      clearTimeout(timer)
    }
    // One failed probe is not enough to kill a working process — a busy box can
    // miss one — but a sidecar that cannot answer is not useful either, so it
    // is torn down and brought back cleanly rather than left half-alive.
    log({ level: 'warn', message: 'sidecar unhealthy; restarting' })
    await stop({ restartAfter: true })
  }

  async function stop({ restartAfter = false } = {}) {
    if (!child) return
    const dying = child
    child = null
    await new Promise((resolveStop) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        resolveStop()
      }
      dying.once('exit', done)
      try {
        dying.kill('SIGTERM')
      } catch {
        done()
      }
      setTimeout(() => {
        // SIGTERM is a request; the tree kill is the answer to a sidecar that
        // ignores it. Either way the port and the database are released.
        if (!settled) killTree(dying, 'SIGKILL', spawnImpl)
        done()
      }, graceMs)
    })
    if (restartAfter && !stopping && !gaveUp) spawnOnce()
  }

  return {
    /** `{ origin, token }` when the sidecar is up, `null` while it is not. */
    resolve,
    start() {
      if (child || stopping || gaveUp) return resolve()
      spawnOnce()
      healthTimer = setInterval(() => void probe(), healthIntervalMs)
      healthTimer.unref?.()
      return resolve()
    },
    async stop() {
      stopping = true
      if (healthTimer) {
        clearInterval(healthTimer)
        healthTimer = null
      }
      await stop()
    },
    /** Test seam: the current child, or `null`. */
    get child() {
      return child
    },
  }
}
