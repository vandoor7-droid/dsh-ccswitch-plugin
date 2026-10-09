// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extractProfile } from './extract.js'

export const DEFAULT_DB_CANDIDATES = [
  () => join(homedir(), '.cc-switch', 'cc-switch.db'),
]

/** CC Switch app types this importer consumes. */
export const SUPPORTED_APP_TYPES = ['codex', 'claude', 'claude-desktop', 'opencode']

/** Why a scan produced no profiles. Only these values are ever surfaced. */
export const SCAN_REASON = {
  NOT_INSTALLED: 'not-installed',
  NO_PROFILES: 'no-profiles',
  UNREADABLE: 'unreadable',
  UNSUPPORTED_NODE: 'unsupported-node',
}

const require = createRequire(import.meta.url)

// node:sqlite is experimental and only exists from Node 22.5. Loading it lazily
// through createRequire keeps this module importable on older runtimes, so the
// plugin still loads and can explain itself instead of failing to register.
let databaseSyncClass
let databaseSyncResolved = false

function loadDatabaseSync() {
  if (!databaseSyncResolved) {
    databaseSyncResolved = true
    try {
      databaseSyncClass = require('node:sqlite')?.DatabaseSync
    } catch {
      databaseSyncClass = undefined
    }
  }
  return databaseSyncClass
}

/** True when this runtime can read a CC Switch database at all. */
export function sqliteAvailable() {
  return typeof loadDatabaseSync() === 'function'
}

/** Open the CC Switch SQLite database strictly read-only. */
export function openDb(dbPath) {
  const DatabaseSync = loadDatabaseSync()
  if (!DatabaseSync) {
    throw new Error(`node:sqlite is unavailable on Node ${process.version}; this importer needs Node >= 22.5`)
  }
  return new DatabaseSync(dbPath, { readOnly: true })
}

/** Discover candidate database paths (extendable for manual-source UI). */
export function discoverSources() {
  return DEFAULT_DB_CANDIDATES.map((fn) => fn()).filter((p) => existsSync(p))
}

export function defaultSourcePath() {
  return DEFAULT_DB_CANDIDATES[0]?.()
}

function defaultLogger(message) {
  // One line, no stack: a missing providers table is an expected state, not a
  // crash, and a red stack trace in CI trains reviewers to ignore red output.
  console.error('[dsh-ccswitch-plugin]', message)
}

function scanFailureMessage(err, dbPath) {
  const reason = err?.code ?? err?.name ?? 'error'
  const message = err instanceof Error ? err.message : String(err ?? '')
  const detail = /no such table/i.test(message) ? ' (no providers table)' : ''
  return `scan failed for ${dbPath}: ${reason}${detail}`
}

/**
 * Scan one database and report why it was empty. Never throws: a scan is a
 * read-only probe and every failure mode has a distinct, actionable reason.
 */
export function scanSource(dbPath, { logger = defaultLogger } = {}) {
  if (!sqliteAvailable()) {
    return { profiles: [], reason: SCAN_REASON.UNSUPPORTED_NODE, dbPath }
  }
  if (typeof dbPath !== 'string' || dbPath === '' || !existsSync(dbPath)) {
    return { profiles: [], reason: SCAN_REASON.NOT_INSTALLED, dbPath }
  }
  let db
  try {
    db = openDb(dbPath)
    const rows = db.prepare('SELECT id, name, settings_config, is_current, app_type FROM providers').all()
    const profiles = rows
      .filter((row) => SUPPORTED_APP_TYPES.includes(row.app_type))
      .map((row) => extractProfile(row))
      .filter((profile) => profile !== undefined)
    return { profiles, reason: profiles.length === 0 ? SCAN_REASON.NO_PROFILES : undefined, dbPath }
  } catch (err) {
    logger(scanFailureMessage(err, dbPath))
    return { profiles: [], reason: SCAN_REASON.UNREADABLE, dbPath }
  } finally {
    if (db) db.close()
  }
}

/** Thin wrapper kept for callers that only need the profile list. */
export function scanProfiles(dbPath, options) {
  return scanSource(dbPath, options).profiles
}
