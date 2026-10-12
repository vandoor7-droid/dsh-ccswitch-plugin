// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * Supervising the sidecar.
 *
 * The assertions worth having here are the ones where a mistake costs more than
 * a broken feature: the environment variable that keeps cc-switch out of the
 * user's `~/.claude`, the port it must never be given, and the restart budget
 * that keeps a broken binary from thrashing. Everything else is plumbing and
 * reads correctly from the source.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import {
  createSidecarManager,
  makeToken,
  MAX_QUICK_DEATHS,
  RESERVED_PORTS,
  resolveBinaryPath,
  QUICK_DEATH_MS,
} from '../src/host/sidecar-manager.mjs'

/** A child process stand-in: an emitter with a kill we can watch. */
function fakeChild() {
  const child = new EventEmitter()
  child.pid = 4242
  child.kill = (signal) => {
    child.killedWith ??= []
    child.killedWith.push(signal)
  }
  return child
}

function fakeSpawn() {
  const spawned = []
  const fn = (binary, args, options) => {
    const child = fakeChild()
    spawned.push({ binary, args, options, child })
    return child
  }
  fn.spawned = spawned
  return fn
}

test('a sidecar is launched with client projection off', () => {
  // The one that matters. Without it the sidecar rewrites ~/.claude on startup,
  // before the host has asked for anything — the behaviour decision 5 rules out.
  const spawnImpl = fakeSpawn()
  const manager = createSidecarManager({
    binary: '/opt/cc-switch-server',
    configDir: 'D:/scratch',
    port: 15881,
    spawnImpl,
  })
  manager.start()

  const { options } = spawnImpl.spawned[0]
  assert.equal(options.env.CC_SWITCH_CLIENT_PROJECTION, 'off')
  assert.equal(options.env.CC_SWITCH_CONFIG_DIR, 'D:/scratch')
})

test('the sidecar never gets the proxy port', () => {
  // 15721 is cc-switch's own proxy listener; giving the HTTP listener the same
  // port would lose the bind silently and take routing with it.
  assert.ok(RESERVED_PORTS.includes(15721))
  assert.throws(
    () => createSidecarManager({ binary: '/opt/cc-switch-server', port: 15721 }),
    /15721/,
  )
  assert.throws(() => createSidecarManager({ binary: '/opt/cc-switch-server', port: undefined }), /port/)
})

test('resolve is null until there is something to talk to', () => {
  const spawnImpl = fakeSpawn()
  const manager = createSidecarManager({ binary: '/opt/cc', port: 15881, spawnImpl })

  assert.equal(manager.resolve(), null)

  manager.start()
  const target = manager.resolve()
  assert.equal(target.origin, 'http://127.0.0.1:15881')
  // 32 bytes as hex: long enough that guessing is not a plan.
  assert.match(target.token, /^[0-9a-f]{64}$/)
  // The token is what the sidecar was told to accept.
  assert.equal(spawnImpl.spawned[0].options.env.CC_SWITCH_WEB_TOKEN, target.token)
  assert.ok(spawnImpl.spawned[0].args.includes(target.token))
})

test('a sidecar that exits is brought back', async () => {
  const spawnImpl = fakeSpawn()
  // far in the past so the death does not look quick
  let clock = 0
  const manager = createSidecarManager({
    binary: '/opt/cc',
    port: 15881,
    spawnImpl,
    now: () => clock,
    quickDeathMs: 1,
    graceMs: 5,
  })
  manager.start()
  clock = 100_000

  spawnImpl.spawned[0].child.emit('exit', 1, null)

  assert.equal(spawnImpl.spawned.length, 2, 'the supervisor replaces a process that died')
  assert.notEqual(manager.resolve(), null)
  await manager.stop()
})

test('a binary that keeps dying stops being restarted', async () => {
  const spawnImpl = fakeSpawn()
  const manager = createSidecarManager({
    binary: '/opt/cc',
    port: 15881,
    spawnImpl,
    now: () => 0, // every death is "quick"
    quickDeathMs: QUICK_DEATH_MS,
    maxQuickDeaths: MAX_QUICK_DEATHS,
  })
  manager.start()

  for (let i = 0; i < MAX_QUICK_DEATHS; i += 1) {
    spawnImpl.spawned[i].child.emit('exit', 1, null)
  }

  // The budget is spent: no more attempts, and the caller can see it is over
  // rather than waiting on a process that will never come back.
  assert.equal(spawnImpl.spawned.length, MAX_QUICK_DEATHS)
  assert.equal(manager.resolve(), null)
  await manager.stop()
})

test('stop terminates the process and leaves nothing resolvable', async () => {
  const spawnImpl = fakeSpawn()
  const manager = createSidecarManager({
    binary: '/opt/cc',
    port: 15881,
    spawnImpl,
    graceMs: 5,
  })
  manager.start()
  const child = spawnImpl.spawned[0].child

  const stopped = manager.stop()
  child.emit('exit', 0, 'SIGTERM')
  await stopped

  assert.deepEqual(child.killedWith, ['SIGTERM'])
  assert.equal(manager.resolve(), null)
})

test('the binary path comes from the override, then the platform package', () => {
  assert.equal(
    resolveBinaryPath({ env: { CC_SWITCH_SIDECAR_BIN: 'C:/tools/cc-switch-server.exe' } }),
    'C:/tools/cc-switch-server.exe',
  )

  const seen = []
  const resolved = resolveBinaryPath({
    env: {},
    packageResolver: (name) => {
      seen.push(name)
      return '/pkg/bin/cc-switch-server'
    },
  })
  assert.equal(resolved, '/pkg/bin/cc-switch-server')
  // The package name names the platform, so a wrong one installs nothing useful.
  assert.deepEqual(seen, [`@dsh-ccswitch/${process.platform}-${process.arch}`])

  // Falling back to PATH is deliberately not a thing: a cc-switch-server of the
  // wrong version would be a silent behaviour change.
  assert.throws(() => resolveBinaryPath({ env: {} }), /CC_SWITCH_SIDECAR_BIN/)
  assert.throws(
    () => resolveBinaryPath({ env: {}, packageResolver: () => '' }),
    /sidecar binary not found/,
  )
})

test('the token is fresh per manager', () => {
  assert.notEqual(makeToken(), makeToken())
})
