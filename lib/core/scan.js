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
export const SUPPORTED_APP_TYPES = [
  'codex',
  'claude',
  'claude-desktop',
  'opencode',
  // Added in 4.0.4. `gemini` and `grokbuild` are scanned even though gemini is
  // always blocked downstream: the row still has to appear so the user learns
  // why it cannot come across, instead of it silently vanishing from the list.
  'gemini',
  'hermes',
  'grokbuild',
  'pi',
  'mcode',
  'openclaw',
]

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
 * The row order CC Switch itself lists providers in, so the list here matches
 * the list there: `COALESCE(sort_index, 999999), created_at ASC, id ASC`
 * (`database/dao/providers.rs`). A provider the user has never reordered keeps
 * its creation order, and the id is a final tiebreak so the sequence is total
 * and stable instead of "whatever the storage engine returns".
 *
 * Both columns arrive by migration (`database/schema.rs` calls
 * `add_column_if_missing`), so a database written by an older CC Switch may not
 * have them. The real column set is read rather than assumed: naming a missing
 * column in `ORDER BY` makes SQLite throw, which would report a perfectly
 * readable database as unreadable.
 */
function orderClause(db) {
  const columns = new Set(
    db.prepare('PRAGMA table_info(providers)').all().map((column) => column.name),
  )
  const parts = []
  if (columns.has('sort_index')) parts.push('COALESCE(sort_index, 999999)')
  if (columns.has('created_at')) parts.push('created_at ASC')
  // `id` always exists, and ordering by it keeps the result deterministic even
  // for the degenerate case where neither ordering column is present.
  parts.push('id ASC')
  return parts.join(', ')
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
    // `website_url` and `category` are read only when the database actually
    // has them. Both arrive by migration on older installs, and SQLite throws
    // on an unknown column in the select list — which would report a perfectly
    // readable database as unreadable.
    const present = new Set(
      db.prepare('PRAGMA table_info(providers)').all().map((column) => column.name),
    )
    const optional = [
      present.has('website_url') ? 'website_url' : undefined,
      present.has('category') ? 'category' : undefined,
    ].filter((column) => column !== undefined)
    const columns = ['id', 'name', 'settings_config', 'is_current', 'app_type', ...optional]
    const rows = db
      .prepare(`SELECT ${columns.join(', ')} FROM providers ORDER BY ${orderClause(db)}`)
      .all()
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
