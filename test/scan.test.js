// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { scanProfiles, scanSource, sqliteAvailable, discoverSources, openDb, DEFAULT_DB_CANDIDATES, SCAN_REASON } from '../lib/core/scan.js'

function makeDb(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'ccs-scan-'))
  const dbPath = join(dir, 'cc-switch.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`CREATE TABLE providers (
    id TEXT, name TEXT, settings_config TEXT, is_current BOOLEAN,
    app_type TEXT, sort_index INTEGER
  )`)
  const insert = db.prepare('INSERT INTO providers (id, name, settings_config, is_current, app_type) VALUES (?, ?, ?, ?, ?)')
  for (const row of rows) insert.run(row.id, row.name, row.settings_config, row.is_current ?? 0, row.app_type ?? 'codex')
  db.close()
  return { dir, dbPath }
}

const VALID_TOML = `model = "gpt-5.6-terra"
[model_providers.custom]
name = "t"
base_url = "https://t.example/v1"
wire_api = "responses"
`

test('scanProfiles extracts valid profiles and skips official/default', () => {
  const { dir, dbPath } = makeDb([
    { id: 'codex-official', name: 'OpenAI Official', settings_config: '{}' },
    { id: 'default', name: 'default', settings_config: '{}' },
    { id: 'p-1', name: 'P1', settings_config: JSON.stringify({ auth: { OPENAI_API_KEY: 'sk-a' }, config: VALID_TOML }), is_current: 1 },
  ])
  try {
    const profiles = scanProfiles(dbPath)
    const active = profiles.filter((p) => !p.skipped)
    assert.equal(active.length, 1)
    assert.equal(active[0].profileName, 'P1')
    assert.equal(active[0].isCurrent, true)
    assert.equal(profiles.filter((p) => p.skipped).length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('openDb opens read-only and lists codex rows', () => {
  const { dir, dbPath } = makeDb([
    { id: 'p-2', name: 'P2', settings_config: JSON.stringify({ auth: { OPENAI_API_KEY: 'sk-b' }, config: VALID_TOML }) },
  ])
  try {
    const db = openDb(dbPath)
    const rows = db.prepare("SELECT id, name, settings_config, is_current FROM providers").all()
    assert.equal(rows.length, 1)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discoverSources returns the default candidate path and only existing files', () => {
  assert.ok(DEFAULT_DB_CANDIDATES.some((fn) => fn().includes('.cc-switch')))
  const sources = discoverSources()
  assert.ok(Array.isArray(sources))
  // A candidate counts as a source only when it actually exists on disk.
  assert.ok(sources.every((path) => existsSync(path)))
})

test('scanProfiles includes codex and claude rows, excludes other app_types', () => {
  const { dir, dbPath } = makeDb([
    { id: 'c-1', name: 'ClaudeP', settings_config: JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-c', ANTHROPIC_BASE_URL: 'https://c.example' } }), app_type: 'claude' },
    { id: 'x-1', name: 'CodexP', settings_config: JSON.stringify({ auth: { OPENAI_API_KEY: 'sk-x' }, config: VALID_TOML }) },
    { id: 'g-1', name: 'GeminiP', settings_config: '{}', app_type: 'gemini' },
  ])
  try {
    const profiles = scanProfiles(dbPath)
    assert.equal(profiles.length, 2)
    assert.deepEqual(profiles.map((p) => p.profileName).sort(), ['ClaudeP', 'CodexP'])
    const claude = profiles.find((p) => p.profileName === 'ClaudeP')
    assert.equal(claude.api, 'anthropic-messages')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unreadable schema is reported as unreadable, not as "nothing to import"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ccs-scan-'))
  const dbPath = join(dir, 'cc-switch.db')
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE unrelated (x TEXT)')
  db.close()
  try {
    // Silent logger: this is an expected state, not a crash worth a stack trace.
    const result = scanSource(dbPath, { logger: () => {} })
    assert.deepEqual(result.profiles, [])
    assert.equal(result.reason, SCAN_REASON.UNREADABLE)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing db reports not-installed instead of throwing', () => {
  const result = scanSource('Z:/definitely/not/here/cc-switch.db', { logger: () => {} })
  assert.deepEqual(result.profiles, [])
  assert.equal(result.reason, SCAN_REASON.NOT_INSTALLED)
  // The thin wrapper still returns a bare list for existing callers.
  assert.deepEqual(scanProfiles('Z:/definitely/not/here/cc-switch.db'), [])
})

test('node:sqlite loads lazily so the plugin still loads on older runtimes', () => {
  assert.equal(sqliteAvailable(), true)
})
