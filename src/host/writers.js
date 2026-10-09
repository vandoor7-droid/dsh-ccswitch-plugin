// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * Push one of this plugin's providers out to another tool's *live* config.
 *
 * The manager's CRUD routes change what this plugin owns; these writers are the
 * other direction — they make Claude Code and Codex actually use a provider by
 * editing the files those tools read at startup.
 *
 * Two properties are ported from CC Switch and are the whole point of the
 * module:
 *
 * 1. **A provider owns a fixed set of keys; nothing else is touched.** The
 *    floor lists below are a key-for-key port of cc-switch's
 *    `src-tauri/src/live/floor.rs`. Everything outside them — `hooks`,
 *    `permissions`, `API_TIMEOUT_MS`, the user's own TOML tables — belongs to
 *    the user, and switching providers must not disturb a byte of it. The
 *    direction of failure is deliberate: a key wrongly left *out* of the floor
 *    is merely preserved, while a key wrongly *in* it belongs to the user and
 *    gets deleted. The lists are therefore narrow, and the exclusions are
 *    spelled out where they are easy to get wrong.
 * 2. **A file that cannot be understood is refused, never reset.** cc-switch
 *    cites two separate incidents (its C0 incident, and v3.11.0) where a parse
 *    failure fell back to an empty document and silently wiped a user's
 *    configuration. So a file that fails to parse, or whose top level is not
 *    the shape we expect, raises an error carrying the location, and the bytes
 *    on disk are left exactly as they were. A *missing* or blank file is the
 *    one permitted empty base.
 *
 * Every write is a read-modify-write cycle inside `withFileLock`, because the
 * tool that owns the file (Claude Code, Codex) may be running and writing to it
 * at the same time. `writeFileAtomic` supplies the rename-based commit, so a
 * reader observes either the old or the new file and never a half-written one.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { parseCodexToml } from '../../lib/core/toml.js'
import { claudeExclusiveEnvOf } from '../../lib/core/claude-exclusive.js'

/**
 * The app types that have a writer. `appType` on a CC Switch row is a wider
 * list than this (claude-desktop, gemini, opencode, …); naming what is actually
 * supported is the difference between "not implemented yet" and a silent
 * no-op, so the route reports this list when it is handed anything else.
 */
export const WRITER_APP_TYPES = Object.freeze(['claude', 'codex'])

/**
 * A refusal to touch a target file, as opposed to a failure to write one.
 *
 * `kind` is `'parse'` when the existing file is not valid JSON, `'shape'` when
 * it parses but is not the structure we require, `'unsupported'` when no writer
 * serves the app type at all, and `'route'` when the file is perfectly
 * well-formed but the provider we were asked to activate would not actually be
 * the one the tool routes through. The first two mean "this is the user's file
 * and we do not understand it", which the route reports differently from an
 * I/O failure; `'route'` means "we understand it, and writing would not do what
 * you asked", which is a refusal rather than a bug.
 *
 * `profile` and `key` are carried on a `'route'` refusal so the message can
 * name the profile that is in the way — see {@link checkCodexEffectiveRoute}.
 */
export class WriterError extends Error {
  constructor(message, { kind = 'parse', path, line, column, profile, key } = {}) {
    super(message)
    this.name = 'WriterError'
    this.kind = kind
    if (path !== undefined) this.path = path
    if (line !== undefined) this.line = line
    if (column !== undefined) this.column = column
    if (profile !== undefined) this.profile = profile
    if (key !== undefined) this.key = key
  }
}

// --- the floor --------------------------------------------------------------

/**
 * Top-level keys of `~/.claude/settings.json` that a provider owns.
 *
 * Deliberately absent, and pinned by the tests: `hooks`, `enabledPlugins`,
 * `permissions` and `statusLine` are the user's own configuration. Under `env`,
 * `CLAUDE_CODE_USE_POWERSHELL_TOOL`, `CLAUDE_CODE_USE_NATIVE_FILE_SEARCH`,
 * `API_TIMEOUT_MS` and `DISABLE_TELEMETRY` are feature switches rather than
 * connection settings. cc-switch verified the `CLAUDE_CODE_USE_*` split against
 * Claude Code 2.1.282 — that prefix cannot be matched wholesale for exactly
 * this reason.
 */
const CLAUDE_FLOOR_TOP = new Set([
  'apiKeyHelper',
  'apiBaseUrl',
  'primaryModel',
  'smallFastModel',
  // The legacy Bedrock API-key preset wrote the real key here.
  'apiKey',
  // `/model`: the choice belongs to the provider that was active when it was made.
  'model',
  // Fallback chain; model id → provider-specific id (a Bedrock ARN, say).
  'fallbackModel',
  'modelOverrides',
  // The `/model` picker rows; in aggregate mode these are CC Switch Stack models.
  'modelPicker',
  // advisor is only available on the Anthropic API.
  'advisorModel',
  // Bedrock / Vertex credential commands.
  'awsAuthRefresh',
  'awsCredentialExport',
  'gcpAuthRefresh',
])

/** Prefixes in `env` where the whole namespace is connection and auth. */
const CLAUDE_FLOOR_ENV_PREFIXES = ['ANTHROPIC_', 'AWS_', 'VERTEX_REGION_']

/** `env` keys owned by a provider, listed individually. */
const CLAUDE_FLOOR_ENV_KEYS = new Set([
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL_FORCE',
  'CLOUD_ML_REGION',
  // Vertex credential path.
  'GOOGLE_APPLICATION_CREDENTIALS',
  // Subscription-account long-lived token and its companions.
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_OAUTH_SCOPES',
  // Pairs with the top-level apiKeyHelper.
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
])

/** Protocol selectors. `CLAUDE_CODE_USE_` is not a safe prefix — see above. */
const CLAUDE_PROTOCOL_SELECTORS = new Set([
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
])

function isClaudeFloorEnv(key) {
  return CLAUDE_FLOOR_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    || CLAUDE_PROTOCOL_SELECTORS.has(key)
    || CLAUDE_FLOOR_ENV_KEYS.has(key)
    || (key.startsWith('CLAUDE_CODE_SKIP_') && key.endsWith('_AUTH'))
}

/**
 * Window values earlier versions of CC Switch injected into Claude Code's
 * `env`, frozen as exact (key, value) pairs — a verbatim port of
 * `CLAUDE_RESIDUE_ENV` (`src-tauri/src/live/residue.rs`).
 *
 * These are the leftovers that a value-comparison rule cannot prove are the
 * previous provider's: an early Kimi or Codex-OAuth row carried none of these
 * keys, so the value in the file was put there by CC Switch itself rather than
 * by the provider being switched away from. Each is *larger* than the window
 * the next provider actually has, so leaving one behind over-runs the window
 * silently. Timeout and telemetry switches are deliberately not collected:
 * they are harmless when stale, and a user is likely to have set them globally
 * from vendor documentation.
 *
 * The three keys are provider-exclusive fields, so they are otherwise left
 * alone — this list is the only reason our writer touches them at all.
 */
const CLAUDE_RESIDUE_ENV = Object.freeze([
  ['CLAUDE_CODE_MAX_CONTEXT_TOKENS', ['262144', '372000', '983616']],
  ['CLAUDE_CODE_AUTO_COMPACT_WINDOW', ['262144', '372000', '1000000']],
  ['CLAUDE_CODE_MAX_OUTPUT_TOKENS', ['131072']],
])

/**
 * The spellings a residue value can have in JSON.
 *
 * The presets wrote strings, but a few early rows wrote the same number
 * unquoted, so a match has to accept both — cc-switch's `residue_values`. Only
 * values that parse as an unsigned integer get a numeric spelling; a bare
 * `parseInt` would turn a value like `1e6` into a number it never was.
 */
function residueValues(values) {
  const spellings = []
  for (const value of values) {
    spellings.push(value)
    if (/^\d+$/.test(value)) spellings.push(Number(value))
  }
  return spellings
}

/** The table Codex is told to route third-party providers through. */
const CODEX_ROUTE_ID = 'custom'

/**
 * Codex's built-in provider ids, spelled as Codex spells them — a port of
 * cc-switch's `BUILT_IN_IDS` (`src-tauri/src/live/project/codex.rs`). A table
 * under one of these is not a custom route at all, so the one id this module
 * writes its own route under must never be one of them.
 */
const CODEX_BUILT_IN_IDS = Object.freeze([
  'amazon-bedrock',
  'amazon-bedrock-runtime',
  'openai',
  'ollama',
  'lmstudio',
])

/**
 * The built-in ids whose provider table makes Codex 0.148+ refuse to load the
 * *whole* file, not merely that table — cc-switch's `RESERVED_TABLE_IDS`. The
 * two `amazon-bedrock` ids are deliberately absent: Codex allows a table there,
 * because that is how the Bedrock region and profile are set.
 */
const CODEX_RESERVED_TABLE_IDS = Object.freeze(['openai', 'ollama', 'lmstudio'])

/**
 * The base id a table squatting on a reserved id is renamed to, with a numeric
 * suffix when that too is taken — cc-switch's `LEGACY_REROUTE_ID`, used with
 * its `first_free_id`.
 */
const CODEX_LEGACY_REROUTE_ID = 'cc-switch'

/**
 * The proxy placeholder token. cc-switch writes it into a route table's
 * `experimental_bearer_token` while that route is dormant and recognises the
 * literal on the way back in (`PROXY_TOKEN_PLACEHOLDER`,
 * `src-tauri/src/live/project/claude.rs`). A table still holding it carries no
 * real credential, which is the one thing that makes deleting that table safe
 * rather than destructive.
 */
const CODEX_PROXY_TOKEN_PLACEHOLDER = 'PROXY_MANAGED'

/** The top-level key naming the profile Codex actually applies. */
const CODEX_PROFILE_KEY = 'profile'

/**
 * Keys inside `[profiles.<name>]` that would keep steering requests after this
 * writer has moved the route — cc-switch's `check_effective_route`, and the
 * same three it substitutes a warning for.
 */
const CODEX_PROFILE_ROUTE_KEYS = Object.freeze([
  'model_provider',
  'openai_base_url',
  'experimental_bearer_token',
])

/**
 * The model catalog file cc-switch generates next to `config.toml`, recognised
 * by base name so a pointer is ours wherever the file is rooted — cc-switch's
 * `CATALOG_FILENAME` and `is_cc_switch_catalog`.
 */
const CODEX_CATALOG_FILENAME = 'cc-switch-model-catalog.json'

/** The top-level key pointing Codex at a model catalog file. */
const CODEX_CATALOG_KEY = 'model_catalog_json'

/** How long to wait for another writer before failing. */
const LOCK_WAIT_MS = 5000

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A credential a config can actually be written with.
 *
 * Enforced here rather than only at the route, because an empty value does not
 * fail loudly on the way out: `JSON.stringify` silently drops a key whose value
 * is `undefined`, so a missing key would produce a file that *looks* complete
 * and leaves the tool unable to authenticate. Refusing is the only outcome that
 * keeps the external tool working.
 */
function requireApiKey(apiKey) {
  if (typeof apiKey !== 'string' || apiKey === '') {
    throw new WriterError('refusing to write a configuration with no credential', {
      kind: 'credential',
    })
  }
  return apiKey
}

// --- file primitives --------------------------------------------------------

/**
 * `@deepseek-ai/dsh-atomic-write` is resolved lazily so this module still loads
 * in a bare `node --test` environment with no DSH profile. It is a peer
 * dependency, and the harness-sanctioned way to replace a file: exclusive-create
 * temp in the same directory, then rename, which is what makes a concurrent
 * reader see a whole file rather than a truncation.
 *
 * `null` records "looked for it and it is not there", so the failed import is
 * not retried on every call.
 */
let atomicWriteModule
async function loadAtomicWrite() {
  if (atomicWriteModule === undefined) {
    try {
      atomicWriteModule = await import('@deepseek-ai/dsh-atomic-write')
    } catch {
      atomicWriteModule = null
    }
  }
  return atomicWriteModule
}

async function readBytesIfExists(path) {
  try {
    return await readFile(path)
  } catch (err) {
    // Only "not there" is a normal state to start from. Anything else — a
    // directory in the file's place, a permission problem — is a real failure
    // and must not be mistaken for an empty file.
    if (err?.code === 'ENOENT') return undefined
    throw err
  }
}

/**
 * Replace a file's bytes. `mode` is explicit because the atomic writer refuses
 * to guess, and every file this module writes turns out to hold a credential:
 * Claude Code keeps `ANTHROPIC_AUTH_TOKEN` in `settings.json`, and Codex keeps
 * the key in the route table's `experimental_bearer_token` inside `config.toml`
 * since 0.149. Both are therefore written 0600 — cc-switch marks exactly these
 * two paths `LiveFile::private` (`claude_direct.rs`, `codex_direct.rs`), and a
 * wider mode would hand the key to every other account on the machine.
 */
async function replaceFile(path, content, mode) {
  const atomic = await loadAtomicWrite()
  if (atomic !== null) {
    await atomic.writeFileAtomic(path, content, { mode, dirMode: 0o700 })
    return
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, content, { mode })
}

const defaultIo = { read: readBytesIfExists, write: replaceFile }

/**
 * Run `operation` while holding the cross-process writer lock for `path`.
 *
 * The parent directory is created first because the lock is a sibling file and
 * `withFileLock` requires its directory to exist. Without the atomic-write
 * package there is no lock to take, so the operation simply runs — that path
 * exists only for a bare test environment, never for a DSH host.
 */
async function withWriterLock(path, operation) {
  const atomic = await loadAtomicWrite()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  if (atomic === null) return operation()
  return atomic.withFileLock(path, operation, { waitMs: LOCK_WAIT_MS })
}

// --- the first-write backup -------------------------------------------------

/**
 * This plugin's device-local state directory, `~/.dsh-ccswitch-plugin`.
 *
 * cc-switch keeps the same kind of state in `~/.cc-switch` and pins that
 * location on purpose (the `DeviceStore` doc comment, `live/engine.rs`: "覆盖
 * 目录可能指向网盘同步目录，而写前意图和备份都是这台设备的事实"). The
 * reasoning is what matters here, not the name: a first-write backup is a fact
 * about *this machine*, so it must not follow a directory the user can redirect
 * — a redirected one may be a cloud-sync folder, and a "first write" that syncs
 * between machines is no longer a first write, it is another machine's second.
 *
 * This plugin has no separate config-directory knob, so the guarantee is
 * expressed the only way it can be: the directory is derived from the home
 * directory, exactly as `~/.claude` and `~/.codex` are, and from nothing else a
 * caller passes. (Deriving it from `home` is also what keeps the tests
 * hermetic: `home` is the temp directory they already isolate.)
 */
const DEVICE_DIR = '.dsh-ccswitch-plugin'

/**
 * `<home>/<device dir>/backups/live-first-write/` — cc-switch's layout under
 * its own device store, which is where its `first_write_backup_dir` points.
 */
function defaultBackupRoot(home) {
  return join(home ?? homedir(), DEVICE_DIR, 'backups', 'live-first-write')
}

/**
 * Save one byte-level copy of a file before this plugin ever writes to it.
 *
 * A port of cc-switch's `ensure_first_write_backup` (`live/engine.rs`). The
 * purpose is a way back: if a later version of this writer has a bug, the file
 * as it was *before the plugin ever touched it* is still on disk. That is why
 * the copy is taken once and never again — the `.source` marker's presence
 * means "already saved", so the copy beside it always holds the original and
 * never a version this plugin wrote.
 *
 * The name is `<first 12 hex of sha256(absolute path)>-<basename>`, and the
 * marker beside it records the original absolute path so the directory can be
 * read by a human. A file that did not exist on the first write gets only the
 * marker: there were no original bytes to keep, and writing it means the
 * content this plugin is about to create is never later mistaken for the
 * user's own.
 *
 * Both files are written 0600. A backup of `settings.json` or `config.toml`
 * holds the same credential the live file does, so a wider mode would undo the
 * reason those two are owner-only in the first place.
 *
 * A failure here propagates and aborts the write, which is cc-switch's
 * behaviour too (`?` on the call in `mode/operation.rs`): if the original
 * cannot be saved, the file must not be touched.
 */
async function ensureFirstWriteBackup(path, current, backupRoot, fileIo) {
  // The backup is keyed by the absolute path, so the same file reached through
  // a relative path or a symlinked parent still maps to one entry — cc-switch
  // hashes `path.to_string_lossy()`, and `resolve` is the closest thing Node
  // has to what Rust's `Path` already holds.
  const absolute = resolve(path)
  const key = createHash('sha256').update(absolute).digest('hex').slice(0, 12)
  const backup = join(backupRoot, `${key}-${basename(absolute)}`)
  const marker = `${backup}.source`
  // The marker is the whole test, and it is written last, so its presence
  // proves the copy beside it is complete.
  if (await fileIo.read(marker) !== undefined) return
  // The backup root is almost never there on the first write, and cc-switch
  // creates it the same way its `stage_write` creates any target's parent
  // (`create_dir_all`) rather than leaving it to the caller.
  await mkdir(backupRoot, { recursive: true, mode: 0o700 })
  if (current !== undefined) await fileIo.write(backup, current, 0o600)
  await fileIo.write(marker, absolute, 0o600)
}

// --- JSON documents ---------------------------------------------------------

const DEFAULT_INDENT = '  '

/**
 * The first indented line's leading whitespace, which serde and Claude Code
 * both use as one level of indentation. Mixed spaces and tabs are not a
 * convention worth guessing at, so that falls back to two spaces.
 */
function detectIndent(text) {
  const lines = text.split('\n')
  for (let index = 1; index < lines.length; index += 1) {
    const raw = lines[index]
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const content = line.trimStart()
    if (content === '') continue
    const leading = line.slice(0, line.length - content.length)
    if (leading === '') continue
    if (/^ +$/.test(leading) || /^\t+$/.test(leading)) return leading
  }
  return undefined
}

/** Where a `JSON.parse` failure is, from the message Node attached to it. */
function jsonErrorLocation(message, text) {
  const explicit = /\(line (\d+) column (\d+)\)/.exec(message)
  if (explicit !== null) return { line: Number(explicit[1]), column: Number(explicit[2]) }
  const position = /at position (\d+)/.exec(message)
  if (position !== null) {
    const offset = Math.max(0, Number(position[1]))
    const before = text.slice(0, offset)
    return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') }
  }
  return { line: 1, column: 1 }
}

/**
 * Parse a target JSON file, or refuse it.
 *
 * Returns the document plus the formatting habits to re-emit it with. A missing
 * or blank file is the only case that starts from `{}`; a file that does not
 * parse, or whose top level is not an object, throws with the location rather
 * than being replaced — see this module's header for why that rule is absolute.
 */
function parseJsonDocument(raw, path) {
  if (raw === undefined) return { doc: {}, style: defaultStyle() }
  const text = raw.toString('utf8')
  const bom = text.startsWith('﻿')
  const body = bom ? text.slice(1) : text
  if (body.trim() === '') return { doc: {}, style: { ...defaultStyle(), bom } }
  let doc
  try {
    doc = JSON.parse(body)
  } catch (err) {
    const { line, column } = jsonErrorLocation(String(err?.message ?? ''), body)
    throw new WriterError(
      `${path} is not valid JSON (line ${line} column ${column}); refusing to overwrite it`,
      { kind: 'parse', path, line, column },
    )
  }
  if (!isRecord(doc)) {
    throw new WriterError(
      `${path} does not contain a JSON object at the top level; refusing to overwrite it`,
      { kind: 'shape', path, line: 1, column: 1 },
    )
  }
  return {
    doc,
    style: {
      indent: detectIndent(body) ?? DEFAULT_INDENT,
      trailingNewline: body.endsWith('\n'),
      crlf: body.includes('\r\n'),
      bom,
    },
  }
}

function defaultStyle() {
  return { indent: DEFAULT_INDENT, trailingNewline: false, crlf: false, bom: false }
}

/**
 * Re-emit a document in the shape the file already had.
 *
 * Re-serialising cannot preserve byte-for-byte everything — a `é` escape
 * becomes the character itself — so the promise is narrower, and is what the
 * tests pin down: key order and values are unchanged, the first write may
 * normalise whitespace, and every write after that is byte-stable.
 */
function serializeJson(doc, style) {
  let text = JSON.stringify(doc, null, style.indent)
  if (style.crlf) text = text.replace(/\n/g, '\r\n')
  if (style.trailingNewline) text += style.crlf ? '\r\n' : '\n'
  return style.bom ? `﻿${text}` : text
}

// --- the Claude projection --------------------------------------------------

/** The primary model id, when the provider names one. */
function primaryModelId(provider) {
  const models = Array.isArray(provider?.models) ? provider.models : []
  const found = models.find((model) => typeof model?.id === 'string' && model.id.trim() !== '')
  return found === undefined ? undefined : found.id.trim()
}

/**
 * The keys a provider contributes to `settings.json`.
 *
 * Top-level is empty: this plugin's provider shape has no `apiBaseUrl` /
 * `modelPicker` analogue, so the writer only ever *clears* top-level floor keys.
 * That is what makes a switch away from an imported `apiKeyHelper` row actually
 * take effect instead of leaving the old credential route in place.
 */
function claudeProjection(provider, apiKey) {
  const env = {
    ANTHROPIC_BASE_URL: String(provider?.baseURL ?? ''),
    // cc-switch prefers ANTHROPIC_AUTH_TOKEN and only uses ANTHROPIC_API_KEY
    // when the source row used that name, which this shape does not track.
    // Writing both would provoke Claude Code's "Both ANTHROPIC_AUTH_TOKEN and
    // ANTHROPIC_API_KEY set" warning.
    ANTHROPIC_AUTH_TOKEN: apiKey,
  }
  const model = primaryModelId(provider)
  if (model !== undefined) env.ANTHROPIC_MODEL = model
  // The provider's own compatibility switches and window sizes go in through
  // the same map: on the way *in* they are ordinary writes. What differs is
  // the way out, which is the removal pass in {@link applyClaudePatch}.
  const exclusive = claudeExclusiveEnvOf(provider)
  for (const [key, value] of Object.entries(exclusive)) env[key] = value
  return { top: {}, env, exclusive }
}

/**
 * Clear every floor key the target does not claim, then write the target's.
 *
 * Keys present in both are assigned in place, which keeps their position in the
 * file; only genuinely new keys are appended. (JavaScript's `delete` leaves the
 * remaining keys in order, so unlike serde's `swap_remove` there is no
 * last-key-into-the-gap hazard to work around.)
 */
function applyClaudePatch(doc, top, env, path, outgoingExclusive = {}) {
  if (doc.env !== undefined && !isRecord(doc.env)) {
    // cc-switch refuses here too: rewriting a non-object `env` would discard
    // whatever the user meant by it.
    throw new WriterError(
      `${path} has a non-object "env" member; refusing to overwrite it`,
      { kind: 'shape', path },
    )
  }
  const topTargets = new Set(Object.keys(top))
  const envTargets = new Set(Object.keys(env))
  const removed = []
  for (const key of Object.keys(doc)) {
    if (CLAUDE_FLOOR_TOP.has(key) && !topTargets.has(key)) {
      delete doc[key]
      removed.push(key)
    }
  }
  for (const key of Object.keys(doc.env ?? {})) {
    if (isClaudeFloorEnv(key) && !envTargets.has(key)) {
      delete doc.env[key]
      removed.push(`env.${key}`)
    }
  }
  // Residue cleanup, cc-switch's `remove_if` half of `direct_patch`. The rule
  // is value-equality, not ownership: a window key is only deleted when it
  // holds a value CC Switch itself is known to have written, so a window the
  // user set by hand to some other number survives. A key the incoming
  // provider writes is skipped outright — its value is assigned below and wins
  // in place, which is what cc-switch means by "the target's own value stays
  // in place".
  for (const [key, values] of CLAUDE_RESIDUE_ENV) {
    if (envTargets.has(key)) continue
    const current = doc.env?.[key]
    if (current === undefined) continue
    if (!residueValues(values).includes(current)) continue
    delete doc.env[key]
    removed.push(`env.${key}`)
  }
  // Exclusive cleanup, the other half of cc-switch's `remove_if`. A key the
  // outgoing provider wrote is deleted only while the file still holds the
  // value it wrote; a value the user has since edited no longer matches, and
  // the key stays. A key the incoming provider writes is skipped here and wins
  // in place below, which is what "the target's own value stays in place"
  // means. Primitives only, so `===` is the right comparison — a string "1" and
  // a number 1 are different values and cc-switch treats them as such.
  for (const [key, value] of Object.entries(outgoingExclusive)) {
    if (envTargets.has(key)) continue
    const current = doc.env?.[key]
    if (current === undefined) continue
    if (current !== value) continue
    delete doc.env[key]
    removed.push(`env.${key}`)
  }
  for (const [key, value] of Object.entries(top)) doc[key] = value
  if (envTargets.size > 0) {
    if (!isRecord(doc.env)) doc.env = {}
    for (const [key, value] of Object.entries(env)) doc.env[key] = value
  }
  return removed
}

// --- the TOML patcher -------------------------------------------------------

/**
 * Update a Codex `config.toml` without rewriting it.
 *
 * cc-switch does this with `toml_edit`, which keeps every item's surrounding
 * whitespace and comments; this repo has a TOML *reader* (`lib/core/toml.js`)
 * and no writer, so this is a deliberately narrow line-preserving patcher
 * rather than a general one. It only ever replaces a line it positively
 * identified as `key = …` inside the right table, appends a key that is
 * missing, and copies every other byte through untouched.
 *
 * The scanner is conservative on purpose: the moment a line's content is
 * ambiguous (an unterminated string, a multi-line string or array that carries
 * on) it stops analysing, which can only cause an edit to be *skipped*.
 * Skipping is safe — {@link verifyCodexToml} then refuses the write — whereas
 * misreading a line would corrupt the user's file.
 */

/**
 * Advance the scanner across one line.
 *
 * `state.multiline` is the delimiter of an open multi-line string, and
 * `state.arrays` counts open brackets. Both are needed because a `key = ` that
 * looks top-level can be sitting inside a multi-line value belonging to the
 * previous entry.
 */
function scanLine(line, state) {
  let index = 0
  if (state.multiline !== null) {
    const close = line.indexOf(state.multiline)
    if (close === -1) return
    index = close + 3
    state.multiline = null
  }
  while (index < line.length) {
    const char = line[index]
    if (char === '#') return
    if (char === '"' || char === "'") {
      if (line.slice(index, index + 3) === char.repeat(3)) {
        const close = line.indexOf(char.repeat(3), index + 3)
        if (close === -1) {
          state.multiline = char.repeat(3)
          return
        }
        index = close + 3
        continue
      }
      // A single-line string cannot span lines, so running off the end without
      // a closing quote means the file is not the TOML we think it is.
      if (char === '"') {
        let at = index + 1
        while (at < line.length && line[at] !== '"') {
          at += line[at] === '\\' ? 2 : 1
        }
        if (at >= line.length) {
          state.unterminated = true
          return
        }
        index = at + 1
        continue
      }
      const close = line.indexOf("'", index + 1)
      if (close === -1) {
        state.unterminated = true
        return
      }
      index = close + 1
      continue
    }
    if (char === '[') state.arrays += 1
    else if (char === ']') state.arrays = Math.max(0, state.arrays - 1)
    index += 1
  }
}

/** The section a header line opens, as a dotted name with segments unquoted. */
function sectionNameOf(line) {
  const match = /^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/.exec(line)
  if (match === null) return undefined
  return match[1]
    .split('.')
    .map((segment) => unquoteKey(segment.trim()))
    .join('.')
}

/** Strip surrounding quotes from a key segment or bare key. */
function unquoteKey(raw) {
  if (raw.length >= 2) {
    const first = raw[0]
    if ((first === '"' || first === "'") && raw[raw.length - 1] === first) {
      return raw.slice(1, -1)
    }
  }
  return raw
}

/** The `key` a line opens, with a quoted key unquoted. */
function keyOf(line) {
  const match = /^\s*([A-Za-z0-9_-]+|"[^"]*"|'[^']*')\s*=/.exec(line)
  return match === null ? undefined : unquoteKey(match[1])
}

/** A non-empty string, trimmed; `undefined` for anything else. */
function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * The provider ids sitting under `[model_providers]`, as far as the scanner can
 * see them: named tables and direct members both count.
 */
function codexProviderIds(structure) {
  const ids = new Set()
  for (const name of structure.ranges.keys()) {
    const parts = name.split('.')
    if (parts.length === 2 && parts[0] === 'model_providers') ids.add(parts[1])
  }
  for (const name of structure.values.keys()) {
    const parts = name.split('.')
    if (parts.length >= 3 && parts[0] === 'model_providers') ids.add(parts[1])
  }
  return ids
}

/**
 * Move or drop `[model_providers.<reserved>]` tables before anything else runs.
 *
 * Codex 0.148+ refuses to load the *entire* file when one of these three ids
 * carries a provider table, so a config that has one cannot be activated at all
 * until it is dealt with — this is cc-switch's loop over `RESERVED_TABLE_IDS`
 * at the top of `CodexConfigPatch::write_route`, and it is the reason
 * `first_free_id` exists.
 *
 * The two outcomes differ by what can be proved. A table still holding the
 * proxy placeholder carries no real credential, so it is provably CC Switch's
 * own leftover and is deleted. Anything else may be the user's — CC Switch
 * cannot tell which of its keys they care about, so it keeps the table and
 * renames it, and so does this.
 *
 * cc-switch additionally deletes a table it can match against its `retired`
 * list of known earlier routes. That list lives in CC Switch's database and
 * this writer has no equivalent, so the placeholder test is the only deletion
 * this module can justify; everything else is renamed, which is the
 * conservative half of the same rule.
 *
 * @returns the rewritten lines and the labels removed, or `null` when there was
 *   nothing to repair. Lines are returned rather than edited in place because
 *   every caller keys its edits off line indices, which a deletion moves.
 */
function repairReservedCodexTables(lines, structure) {
  const renames = new Map()
  const drops = []
  const removed = []
  const taken = codexProviderIds(structure)
  for (const id of CODEX_RESERVED_TABLE_IDS) {
    const section = `model_providers.${id}`
    const range = structure.ranges.get(section)
    if (range === undefined) continue
    // An array-of-tables header is not a provider table, and renaming one
    // line of it would leave its siblings pointing at the old name.
    if (structure.arrays.has(section)) continue
    const token = structure.values.get(`${section}.experimental_bearer_token`)
    if (token === CODEX_PROXY_TOKEN_PLACEHOLDER) {
      drops.push(range)
      removed.push(section)
      continue
    }
    taken.delete(id)
    const renamed = firstFreeCodexTableId(taken, CODEX_LEGACY_REROUTE_ID)
    taken.add(renamed)
    // The header carries the whole dotted name, not just the id: unlike
    // cc-switch, which re-keys an entry in the `model_providers` map, this
    // patches the line, so the parent prefix has to be preserved.
    renames.set(range.start, `model_providers.${renamed}`)
    removed.push(`${section} -> model_providers.${renamed}`)
  }
  if (renames.size === 0 && drops.length === 0) return null

  const dropped = new Set()
  for (const range of drops) {
    for (let index = range.start; index < range.end; index += 1) dropped.add(index)
  }
  const out = []
  for (let index = 0; index < lines.length; index += 1) {
    if (dropped.has(index)) continue
    const renamed = renames.get(index)
    if (renamed === undefined) {
      out.push(lines[index])
      continue
    }
    out.push(renameSectionHeader(lines[index], renamed))
  }
  return { lines: out, removed }
}

/**
 * Rewrite a `[table]` header line to open `name` instead, keeping the original
 * indentation, the array-of-tables brackets if any, and any trailing comment.
 */
function renameSectionHeader(line, name) {
  const match = /^(\s*)(\[\[?)([^\]]+)(\]\]?)(\s*(?:#.*)?)$/.exec(line)
  if (match === null) return line
  return `${match[1]}${match[2]}${name}${match[4]}${match[5]}`
}

/**
 * Refuse to write when the configuration that would result does not actually
 * route to the provider being activated — cc-switch's `check_effective_route`
 * (`src-tauri/src/live/project/codex.rs`).
 *
 * Codex prefers the top-level `profile` when one is named, and a key inside
 * that profile table outranks the top-level one this writer just set. The
 * request would then keep going wherever the profile sends it, which looks
 * exactly like success from here: the file is well-formed and every key this
 * module owns says what it should. So the write is refused instead, and the
 * message names the profile and the key so the user can fix it.
 *
 * Only three keys can do this (`CODEX_PROFILE_ROUTE_KEYS`), and
 * `model_provider` is special: a profile naming the same route this writer is
 * about to select agrees with it rather than overriding it, so it is not a
 * conflict. cc-switch compares against the selected route with the built-in
 * `openai` as the fallback; here the route is always a custom table, so the
 * comparison is against that id.
 *
 * cc-switch checks the *resulting* document, and so does this — the profile
 * keys are not ones this module writes, but proving that by construction would
 * mean every future edit re-proves it.
 */
function checkCodexEffectiveRoute(text, routeId) {
  const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n')
  const { values } = scanStructure(lines)
  const name = nonEmptyString(values.get(CODEX_PROFILE_KEY))
  if (name === undefined) return
  const overridden = CODEX_PROFILE_ROUTE_KEYS.find((key) => {
    const value = values.get(`profiles.${name}.${key}`)
    if (value === undefined) return false
    // A value the scanner saw but will not read — an array, a float, a
    // multi-line string — is treated as a conflict. cc-switch reads the file
    // with a real TOML parser, so it finds a value for all three of those; the
    // one place the two disagree is a genuine multi-line string, which
    // cc-switch reads as a string and this does not. Refusing is the
    // recoverable direction either way: a wrongly-refused write costs the user
    // one edit, while a wrongly-allowed one hides the fact that the switch did
    // nothing at all.
    if (value === UNREADABLE_TOML_VALUE) return true
    // A *readable* non-string — `openai_base_url = 123` — is not a conflict
    // here, and is not one in cc-switch either: its `non_empty_str` is
    // `Item::as_str(..).filter(non-empty)`, so anything that is not a string
    // reads as absent and the key is skipped.
    const text = nonEmptyString(value)
    if (text === undefined) return false
    if (key === 'model_provider') return text !== routeId
    return true
  })
  if (overridden === undefined) return
  throw new WriterError(
    `the active Codex profile "${name}" ([profiles.${name}]) sets ${overridden}, so requests would keep `
    + `following it instead of the target provider. Remove ${overridden} from that profile or change the `
    + 'top-level profile; nothing was written',
    { kind: 'route', profile: name, key: overridden },
  )
}

/**
 * Where the trailing `# comment` on a line begins, or `-1` when there is none.
 *
 * `-1` is also the answer for a line whose strings never close: nothing after
 * an unterminated quote can be trusted to be a comment.
 */
function commentStart(text) {
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '#') return index
    if (char === '"' || char === "'") {
      if (text.slice(index, index + 3) === char.repeat(3)) {
        const close = text.indexOf(char.repeat(3), index + 3)
        if (close === -1) return -1
        index = close + 3
        continue
      }
      if (char === '"') {
        let at = index + 1
        while (at < text.length && text[at] !== '"') at += text[at] === '\\' ? 2 : 1
        if (at >= text.length) return -1
        index = at + 1
        continue
      }
      const close = text.indexOf("'", index + 1)
      if (close === -1) return -1
      index = close + 1
      continue
    }
    index += 1
  }
  return -1
}

/**
 * Everything from the end of the value to the end of the line — the whitespace
 * run and the comment. Returned as a single unit so a replaced value keeps the
 * original spacing *and* the comment, the way `toml_edit`'s `decor` does.
 */
function valueSuffix(text) {
  const at = commentStart(text)
  if (at === -1) return ''
  let start = at
  while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start -= 1
  return text.slice(start)
}

/** TOML source for a string value. JSON's escaping is a subset of TOML's. */
function tomlString(value) {
  return JSON.stringify(String(value))
}

/**
 * The effort a provider asks for, if it asks for one.
 *
 * This plugin's stored shape has no effort field of its own, so a value can
 * only arrive from a record the importer projected (`modelReasoningEffort`) or
 * one written by hand into the document (`reasoning`, the name llm-pi-ai uses).
 * Both spellings are read; an absent one leaves the key alone rather than
 * inventing a level.
 */
function reasoningEffortOf(provider) {
  for (const candidate of [provider?.modelReasoningEffort, provider?.reasoning]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }
  return undefined
}

/**
 * Whether `auth.json` holds a login Codex would itself authenticate with.
 *
 * A port of cc-switch's `codex_auth_has_credential_login_material`
 * (`src-tauri/src/codex_config.rs`), and deliberately not "is there anything in
 * the file". A bare `OPENAI_API_KEY` — which is exactly what earlier versions of
 * this writer left behind — is *not* a login, and neither is pure metadata such
 * as `last_refresh` or `tokens.account_id`; counting those would shield a stale
 * third-party key from being recognised for what it is.
 *
 * cc-switch's own `login_on_disk` is computed with a sibling predicate,
 * `codex_auth_has_openai_account_material`, which differs on two inputs: it
 * counts a bare `OPENAI_API_KEY` as a login and does not count
 * `bedrock_api_key`. Neither difference reaches us. cc-switch only has a bare
 * key to count because of a delete it performs and we do not — with its default
 * `preserve_codex_official_auth_on_switch = false` it removes the stale key on
 * the way in — and counting a key we leave in place would tell Codex to fall
 * back to *another* provider's credential, which is the keyless-fallback hazard
 * cc-switch itself refuses to write. `bedrock_api_key` is a Bedrock credential,
 * which Codex cannot load as an OpenAI account at all. This predicate is the
 * one that answers the question this writer actually faces.
 */
function hasCredentialLoginMaterial(auth) {
  if (!isRecord(auth)) return false
  const present = (value) => {
    if (value === null || value === undefined) return false
    if (typeof value === 'string') return value.trim() !== ''
    if (Array.isArray(value)) return value.length > 0
    if (isRecord(value)) return Object.keys(value).length > 0
    return true
  }
  if (['personal_access_token', 'agent_identity', 'bedrock_api_key'].some((key) => present(auth[key]))) {
    return true
  }
  const tokens = auth.tokens
  if (!isRecord(tokens)) return false
  return ['id_token', 'access_token', 'refresh_token'].some((key) => present(tokens[key]))
}

/**
 * Whether `id` names one of Codex's built-in providers rather than a custom
 * route — cc-switch's `is_built_in_id`. Case-sensitive on purpose: `OpenAI` is
 * a perfectly legal custom id, only the lowercase spelling is the built-in.
 */
function isBuiltInCodexId(id) {
  return CODEX_BUILT_IN_IDS.includes(id)
}

/**
 * Whether a `[model_providers.<id>]` table under this id makes Codex 0.148+
 * refuse to load the entire file — cc-switch's `RESERVED_TABLE_IDS`. The two
 * `amazon-bedrock` ids are built-in but deliberately *not* reserved.
 */
function isReservedCodexId(id) {
  return CODEX_RESERVED_TABLE_IDS.includes(id)
}

/**
 * The first free id of the form `base`, `base-2`, `base-3`, … — a direct port
 * of cc-switch's `first_free_id`.
 *
 * CC Switch uses it to pick a new home for a provider table squatting on a
 * reserved id, and this module uses it to *name* that home in the refusal it
 * raises instead (see {@link checkCodexReservedTables}); the two are the same
 * calculation, which is the point — the name in the message is the one
 * cc-switch would have moved the table to.
 */
function firstFreeCodexTableId(taken, base) {
  let candidate = base
  let suffix = 2
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

/**
 * The id this writer puts its own route table under.
 *
 * In practice this is `custom`: reusing that table is intended, because it is
 * the one this plugin owns and the one cc-switch's `put_table` writes.
 *
 * What must never happen is the id landing on one Codex claims for itself — a
 * table under a built-in id is not a custom route at all, and under `openai` /
 * `ollama` / `lmstudio` it makes Codex refuse the entire file. The check is
 * spelled out rather than left as a comment because it is what stops a later
 * change to `CODEX_ROUTE_ID` from quietly corrupting every config it touches,
 * and the fallback is cc-switch's `first_free_id` walk — pointed at the ids
 * that would break the file rather than at the ids merely in use, which is the
 * same set, since `RESERVED_TABLE_IDS` is a subset of `BUILT_IN_IDS`.
 */
function codexRouteId() {
  if (!isBuiltInCodexId(CODEX_ROUTE_ID) && !isReservedCodexId(CODEX_ROUTE_ID)) return CODEX_ROUTE_ID
  return firstFreeCodexTableId(new Set(CODEX_BUILT_IN_IDS), CODEX_ROUTE_ID)
}

/**
 * Whether a `model_catalog_json` value points at a catalog CC Switch generated.
 *
 * Matched on base name alone, so the pointer is recognised wherever the file
 * is rooted — cc-switch's `is_cc_switch_catalog`. This is the test that keeps
 * a catalog belonging to someone else from being mistaken for ours.
 */
function isCcSwitchCatalog(value) {
  if (typeof value !== 'string' || value === '') return false
  const name = value.split(/[\\/]/).pop()
  return name === CODEX_CATALOG_FILENAME
}

/**
 * Whether the config carries a pointer at a catalog CC Switch generated.
 *
 * `model_catalog_json` is read back as the literal the scanner parsed, so a
 * pointer written some way this scanner will not guess at comes back as the
 * unreadable marker rather than a string, and the answer is `false`. That is
 * the conservative direction: an unrecognised pointer is left alone rather than
 * deleted on a guess.
 */
function hasStaleCatalogPointer(structure) {
  return isCcSwitchCatalog(structure.values.get(CODEX_CATALOG_KEY))
}

/**
 * The keys this writer owns in `config.toml`.
 *
 * `model_reasoning_effort` is emitted as a removal when the provider carries no
 * effort: the key is floor, so a value left behind by the previous provider
 * would keep steering the model the new provider just selected. `literal: null`
 * means "remove it". The same reasoning applies to `model`, except that an
 * absent model is written as *no edit at all* rather than as a removal — a
 * provider with no models is a gap in our record, not a statement that the user
 * wants no model, and clearing the key would leave Codex unable to start.
 *
 * The credential is the route table's `experimental_bearer_token`, not anything
 * in `auth.json`: from Codex 0.149 a custom provider no longer reads a key out
 * of `auth.json`, which is reserved for the official login. Emitting the token
 * as an edit is also what stops the previous provider's token from being left
 * behind — cc-switch keeps the same key in its floor for that reason.
 *
 * `requires_openai_auth` is computed by the caller rather than fixed; see
 * {@link writeCodexConfig} for the rule and why neither fixed value is safe.
 */
function codexTomlEdits(provider, apiKey, requiresOpenaiAuth, routeId) {
  const edits = []
  const routeSection = `model_providers.${routeId}`
  const model = primaryModelId(provider)
  if (model !== undefined) {
    edits.push({ section: null, key: 'model', literal: tomlString(model) })
  }
  edits.push({ section: null, key: 'model_provider', literal: tomlString(routeId) })
  const effort = reasoningEffortOf(provider)
  edits.push({
    section: null,
    key: 'model_reasoning_effort',
    literal: effort === undefined ? null : tomlString(effort),
  })
  edits.push(
    { section: routeSection, key: 'name', literal: tomlString(provider?.displayName ?? '') },
    { section: routeSection, key: 'base_url', literal: tomlString(provider?.baseURL ?? '') },
    {
      section: routeSection,
      key: 'wire_api',
      literal: tomlString(provider?.api === 'openai-responses' ? 'responses' : 'chat'),
    },
    { section: routeSection, key: 'experimental_bearer_token', literal: tomlString(apiKey) },
    {
      section: routeSection,
      key: 'requires_openai_auth',
      literal: requiresOpenaiAuth ? 'true' : 'false',
    },
  )
  return edits
}

/**
 * Where each line sits in the document's table structure.
 *
 * `sectionAt[i]` is the table open at the *start* of line `i` (`null` for the
 * root), and `ranges` maps a table name to its header line and the line that
 * ends it. A key may only be matched inside the table it belongs to — matching
 * `model` at the root must not find the `model` inside `[some_table]`.
 *
 * `values` keeps the *last* assignment seen for each `table.key`, with the key
 * spelled as a dotted name from the root. Array-of-tables headers
 * (`[[thing]]`) overwrite rather than accumulate, because TOML allows the same
 * name to repeat and there is no way to tell the entries apart by name alone;
 * every reader here wants the last one. It is deliberately not a general TOML
 * reader — it only ever sees lines the scanner was able to classify.
 */
function scanStructure(lines) {
  const sectionAt = []
  const headers = new Map()
  const values = new Map()
  const arrays = new Set()
  const state = { multiline: null, arrays: 0, unterminated: false }
  let current = null
  for (let index = 0; index < lines.length; index += 1) {
    sectionAt.push(current)
    if (state.multiline === null && state.arrays === 0) {
      const name = sectionNameOf(lines[index])
      if (name !== undefined) {
        if (!headers.has(name)) headers.set(name, index)
        if (/^\s*\[\[/.test(lines[index])) arrays.add(name)
        current = name
        continue
      }
      const key = keyOf(lines[index])
      if (key !== undefined && !state.unterminated) {
        const value = parseTomlLiteral(lines[index])
        // A value the scanner saw but will not read is recorded as unreadable
        // rather than dropped, because "this key is absent" and "this key is
        // here and I cannot read it" call for opposite answers below.
        values.set(
          current === null ? key : `${current}.${key}`,
          value === undefined ? UNREADABLE_TOML_VALUE : value,
        )
      }
    }
    scanLine(lines[index], state)
  }
  const starts = [...headers.values()].sort((left, right) => left - right)
  const endOf = (start) => starts.find((candidate) => candidate > start) ?? lines.length
  const ranges = new Map([...headers].map(([name, start]) => [name, { start, end: endOf(start) }]))
  return { sectionAt, headers, ranges, values, arrays, unterminated: state.unterminated }
}

/**
 * The value a `key = …` line assigns, as a JavaScript value, or `undefined`
 * when the line holds something this scanner will not guess at.
 *
 * Only the shapes the route check actually reads are understood: quoted
 * strings, booleans, integers, and inline tables one level deep. Anything else
 * — an array, a multi-line value, a float — comes back `undefined`, which
 * makes the check treat it as "present but unreadable" rather than as absent.
 */
function parseTomlLiteral(line) {
  const eq = line.indexOf('=')
  if (eq === -1) return undefined
  const raw = line.slice(eq + 1)
  const at = commentStart(raw)
  const body = (at === -1 ? raw : raw.slice(0, at)).trim()
  if (body === '') return undefined
  if (body.startsWith('"') || body.startsWith("'")) {
    const quote = body[0]
    if (body.length < 2 || body[body.length - 1] !== quote) return undefined
    const inner = body.slice(1, -1)
    if (quote === "'") return inner
    // A basic string's escapes are close enough to JSON's for the values read
    // here; a body JSON refuses is left unread rather than coerced.
    try {
      return JSON.parse(body)
    } catch {
      return inner
    }
  }
  if (body === 'true') return true
  if (body === 'false') return false
  if (/^[+-]?\d+$/.test(body)) return Number(body)
  if (body.startsWith('{') && body.endsWith('}')) {
    return parseInlineTable(body.slice(1, -1))
  }
  return undefined
}

/**
 * The members of an inline table body (`{ a = 1, b = "x" }` without the
 * braces), as a plain object. Nested inline tables and arrays come back as
 * `undefined` members: this exists to answer "does this table set key X, and
 * to what", not to be a TOML reader.
 */
function parseInlineTable(body) {
  const members = {}
  let depth = 0
  let start = 0
  const parts = []
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char === '"' || char === "'") {
      const close = body.indexOf(char, index + 1)
      if (close === -1) return undefined
      index = close
      continue
    }
    if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, index))
      start = index + 1
    }
  }
  parts.push(body.slice(start))
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = unquoteKey(part.slice(0, eq).trim())
    if (key === '') continue
    const value = parseTomlLiteral(`x = ${part.slice(eq + 1)}`)
    // An inline member we cannot read still has to be *seen*: the caller
    // distinguishes "absent" from "present, value unknown" by the key's
    // presence, so it is recorded explicitly rather than dropped.
    members[key] = value === undefined ? UNREADABLE_TOML_VALUE : value
  }
  return members
}

/**
 * A marker for a TOML value the scanner positively saw but cannot represent.
 * It is never compared for equality — only tested for — so a single frozen
 * symbol is enough.
 */
const UNREADABLE_TOML_VALUE = Symbol('unreadable-toml-value')

/**
 * Patch `text`, returning the new text plus what was written and removed.
 *
 * An edit that matches an existing line replaces it in place, keeping its
 * indentation and any trailing comment. The rest are appended: top-level keys
 * immediately before the first table, because anything after a `[table]` header
 * would join that table, and table keys at the end of their own table.
 */
function patchCodexToml(text, provider, { apiKey, requiresOpenaiAuth, trailingNewline } = {}) {
  const endsWithNewline = trailingNewline ?? text.endsWith('\n')
  const original = text === '' ? [] : (endsWithNewline ? text.slice(0, -1) : text).split('\n')
  let structure = scanStructure(original)

  // An unterminated string means the line scanner stopped early on some line and
  // every later key it found is a guess. cc-switch parses the whole document
  // before patching and refuses when it fails; this scanner cannot parse, so it
  // refuses on the one signal it can detect reliably. The file is left alone.
  if (structure.unterminated) {
    throw new WriterError(
      'config.toml contains an unterminated string; refusing to overwrite it',
      { kind: 'shape' },
    )
  }

  // Reserved-id tables are dealt with before anything is matched, because
  // deleting one shifts every line index below it. Renaming does not, but both
  // are re-scanned together rather than tracking offsets.
  const repaired = repairReservedCodexTables(original, structure)
  let lines = original
  const removed = []
  if (repaired !== null) {
    lines = repaired.lines
    removed.push(...repaired.removed)
    structure = scanStructure(lines)
  }
  const { sectionAt, headers, ranges } = structure

  // The route id is chosen from the ids Codex claims for itself, never from the
  // ids already in the document — see {@link codexRouteId}.
  const routeId = codexRouteId()
  const routeSection = `model_providers.${routeId}`

  const replacements = new Map()
  const removals = new Set()
  const pending = []
  const written = []

  // The model-catalog pointer is a floor key — one the provider owns — but only
  // half of that can be honoured here, and the half that cannot is the
  // dangerous one. This writer never generates a catalog, so it can never
  // *set* the pointer; what it can do is recognise a pointer at a catalog
  // CC Switch generated and drop it. Such a catalog describes the models of
  // whichever provider was active when it was written, and leaving the pointer
  // in place would keep Codex reading a model list for a route it no longer
  // describes — the same silent wrongness the effective-route check refuses.
  //
  // A pointer at anything else is somebody else's catalogue — the user's own,
  // or another tool's — and is left exactly as it is. cc-switch's
  // `foreign_catalog` and `live_catalog_is_ours` exist precisely to tell those
  // two apart (`live/project/codex.rs`), and erring in the other direction
  // would delete a file someone else manages.
  //
  // The catalog *file* is deliberately not touched. This writer did not create
  // it in this activation, and removing a pointer already makes Codex stop
  // reading it; deleting the bytes as well would be an unrecoverable act taken
  // on a guess about who wrote them.
  if (hasStaleCatalogPointer(structure)) {
    const at = lines.findIndex((line, index) => sectionAt[index] === null && keyOf(line) === CODEX_CATALOG_KEY)
    if (at !== -1) {
      removals.add(at)
      removed.push(CODEX_CATALOG_KEY)
    }
  }

  for (const edit of codexTomlEdits(provider, apiKey, requiresOpenaiAuth, routeId)) {
    const label = edit.section === null ? edit.key : `${edit.section}.${edit.key}`
    let found = -1
    for (let index = 0; index < lines.length; index += 1) {
      if (sectionAt[index] !== edit.section) continue
      if (keyOf(lines[index]) !== edit.key) continue
      found = index
      break
    }
    if (found === -1) {
      pending.push(edit)
      continue
    }
    if (edit.literal === null) {
      removals.add(found)
      removed.push(label)
      continue
    }
    const line = lines[found]
    const indent = /^\s*/.exec(line)[0]
    const suffix = valueSuffix(line.slice(line.indexOf('=') + 1))
    replacements.set(found, `${indent}${edit.key} = ${edit.literal}${suffix}`)
    written.push(label)
  }

  // Appending a second route-table header is a TOML error, so a file that
  // already spells the table some other way is refused rather than risked. An
  // inline `custom = { … }` under an existing `[model_providers]` cannot be
  // patched line-wise at all.
  if (pending.some((edit) => edit.section === routeSection) && !headers.has(routeSection)) {
    const inlineRoute = ranges.has('model_providers') && lines
      .slice(ranges.get('model_providers').start, ranges.get('model_providers').end)
      .some((line) => keyOf(line) === routeId)
    if (inlineRoute) {
      throw new WriterError(
        `config.toml defines model_providers.${routeId} inline; refusing to rewrite it`,
        { kind: 'shape' },
      )
    }
  }

  const firstHeader = headers.size === 0
    ? lines.length
    : Math.min(...[...headers.values()])
  /**
   * Where a new key goes: just after the last real line of its block, not at
   * the block's nominal end. Appending at the end of a table's range would put
   * the key *after* the blank line that separates that table from the next one,
   * pushing the user's blank line up to the wrong side; the same applies to a
   * root key inserted before the first header.
   */
  const insertAfterLastContent = (end, floor) => {
    let at = end
    while (at > floor && lines[at - 1] !== undefined && lines[at - 1].trim() === '') at -= 1
    return at
  }
  const firstHeaderAt = insertAfterLastContent(firstHeader, 0)

  /**
   * `blankBefore` is set only for a *newly created table*, where a separating
   * blank line keeps the appended block readable. A key appended to an existing
   * block continues what is already there and must not be pushed away from it.
   */
  const insertions = new Map()
  const blockAt = (index) => {
    if (!insertions.has(index)) insertions.set(index, { lines: [], blankBefore: false })
    return insertions.get(index)
  }
  let appendedHeader = false
  for (const edit of pending) {
    if (edit.literal === null) continue
    const label = edit.section === null ? edit.key : `${edit.section}.${edit.key}`
    if (edit.section === null) {
      blockAt(firstHeaderAt).lines.push(`${edit.key} = ${edit.literal}`)
      written.push(label)
      continue
    }
    const range = ranges.get(edit.section)
    if (range !== undefined) {
      // `floor` keeps the key inside its own table: never above the header line.
      blockAt(insertAfterLastContent(range.end, range.start + 1)).lines.push(`${edit.key} = ${edit.literal}`)
      written.push(label)
      continue
    }
    const block = blockAt(lines.length)
    if (!appendedHeader) {
      block.lines.push(`[${edit.section}]`)
      block.blankBefore = true
      appendedHeader = true
    }
    block.lines.push(`${edit.key} = ${edit.literal}`)
    written.push(label)
  }

  const out = []
  for (let index = 0; index <= lines.length; index += 1) {
    const block = insertions.get(index)
    if (block !== undefined) {
      if (block.blankBefore && out.length > 0 && out[out.length - 1].trim() !== '') out.push('')
      out.push(...block.lines)
    }
    if (index === lines.length) break
    if (removals.has(index)) continue
    out.push(replacements.has(index) ? replacements.get(index) : lines[index])
  }

  const next = `${out.join('\n')}${endsWithNewline ? '\n' : ''}`
  verifyCodexToml(next, provider, { apiKey, requiresOpenaiAuth, routeId })
  // The effective-route check runs last, on the finished document: it is about
  // what Codex will do with the file, not about the edits, and a refusal here
  // is still before any write. cc-switch checks at the same point, at the end
  // of `CodexConfigPatch::apply_to`.
  checkCodexEffectiveRoute(next, routeId)
  return { text: next, written, removed }
}

/**
 * Confirm the patch landed before it is committed.
 *
 * The line scanner is the thing being trusted, so its output is checked two
 * ways: a table header must not now appear twice (the one corruption that
 * silently changes a file's meaning), and the independent reader in
 * `lib/core/toml.js` must see the values that were just written. A mismatch
 * means the scan misread the file and the edits landed somewhere they do not
 * belong; raising here costs a failed write, whereas writing would cost the
 * user's configuration.
 */
function verifyCodexToml(text, provider, { apiKey, requiresOpenaiAuth, routeId = CODEX_ROUTE_ID } = {}) {
  const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n')
  const routeSection = `model_providers.${routeId}`

  // Repeating a `[table]` header is the one corruption that silently changes a
  // file's meaning rather than breaking it loudly, so it is checked directly
  // instead of being left to the reader — which only looks at some tables.
  const seen = new Set()
  for (const line of lines) {
    const name = sectionNameOf(line)
    if (name === undefined) continue
    if (seen.has(name)) {
      throw new WriterError(
        `patching config.toml would duplicate the [${name}] table; refusing to write it`,
        { kind: 'shape' },
      )
    }
    seen.add(name)
  }

  const refuse = (label) => {
    throw new WriterError(
      `config.toml did not take "${label}"; refusing to write it`,
      { kind: 'shape' },
    )
  }
  const expect = (label, actual, wanted) => {
    if (wanted !== undefined && actual !== wanted) refuse(label)
  }

  const parsed = parseCodexToml(text)
  const model = primaryModelId(provider)
  if (model !== undefined) expect('model', parsed.model, model)
  // An absent effort is written as a *removal*, so it has to be checked in the
  // opposite direction: leaving the previous provider's value behind would keep
  // steering the model that was just selected, silently.
  const effort = reasoningEffortOf(provider)
  if (effort === undefined) {
    if (parsed.reasoningEffort !== undefined) refuse('model_reasoning_effort')
  } else {
    expect('model_reasoning_effort', parsed.reasoningEffort, effort)
  }
  if (parsed.provider === null) refuse(routeSection)
  expect('base_url', parsed.provider.baseUrl, String(provider?.baseURL ?? ''))
  expect('name', parsed.provider.name, String(provider?.displayName ?? ''))
  expect('wire_api', parsed.provider.wireApi, provider?.api === 'openai-responses' ? 'responses' : 'chat')
  expect('requires_openai_auth', parsed.provider.requiresOpenaiAuth, requiresOpenaiAuth)

  // `experimental_bearer_token` is not exposed by the reader, so like the
  // duplicate-header check above it is verified by scanning the text directly.
  // Comparing the raw value is the point: it proves the credential landed under
  // the route table and not in some table the line scanner mistook for it.
  const wantedToken = tomlString(apiKey)
  let inRoute = false
  let tokenFound = false
  for (const line of lines) {
    const name = sectionNameOf(line)
    if (name !== undefined) {
      inRoute = name === routeSection
      continue
    }
    if (!inRoute || keyOf(line) !== 'experimental_bearer_token') continue
    const raw = line.slice(line.indexOf('=') + 1)
    const at = commentStart(raw)
    if ((at === -1 ? raw : raw.slice(0, at)).trim() !== wantedToken) {
      refuse('experimental_bearer_token')
    }
    tokenFound = true
  }
  if (!tokenFound) refuse('experimental_bearer_token')
}

// --- warnings ---------------------------------------------------------------

/**
 * Point out a mismatch between the provider's declared protocol and what the
 * target tool can actually speak. This is a warning rather than a refusal: the
 * user may know better, and the write itself is well-formed either way.
 */
function protocolWarnings(appType, provider) {
  const api = String(provider?.api ?? '')
  if (appType === 'claude' && api !== 'anthropic-messages') {
    return [`provider api "${api}" is not anthropic-messages, but Claude Code speaks the Anthropic protocol`]
  }
  if (appType === 'codex' && api === 'anthropic-messages') {
    return ['provider api is anthropic-messages, which Codex cannot speak; the route will not work']
  }
  return []
}

// --- the writers ------------------------------------------------------------

/**
 * Write `~/.claude/settings.json` for one provider.
 *
 * @param {object} options
 * @param {object} options.provider - the stored provider record.
 * @param {string} options.apiKey - the resolved key. Never logged or returned.
 * @param {string} [options.home] - home directory; defaults to `os.homedir()`.
 *   Tests point this at a temp dir so the real `~/.claude` is never touched.
 * @param {string} [options.backupRoot] - where the once-per-file first-write
 *   backup goes; defaults to `<home>/.dsh-ccswitch-plugin/backups/live-first-write`.
 *   Parameterised for the same reason `home` is, and never derived from the
 *   file being written — see {@link defaultBackupRoot}.
 * @param {object} [options.io] - file primitives, for tests that need a write
 *   to fail. Production never passes it.
 * @returns {Promise<{files: Array<{path: string, keys: string[], removed: string[]}>, warnings: string[]}>}
 * @throws {WriterError} when the existing file cannot be understood.
 */
export async function writeClaudeConfig({ provider, apiKey, home, io, backupRoot, previous } = {}) {
  const key = requireApiKey(apiKey)
  const path = join(home ?? homedir(), '.claude', 'settings.json')
  const fileIo = io ?? defaultIo
  const backups = backupRoot ?? defaultBackupRoot(home)
  return withWriterLock(path, async () => {
    const raw = await fileIo.read(path)
    const { doc, style } = parseJsonDocument(raw, path)
    const { top, env } = claudeProjection(provider, key)
    // `previous` is whoever this provider replaces, when the caller knows.
    // Only its *exclusive* keys matter: the floor is defined by ownership and
    // is cleared unconditionally, but an exclusive key can come out only while
    // its value still matches what that provider wrote.
    const removed = applyClaudePatch(doc, top, env, path, claudeExclusiveEnvOf(previous))
    await ensureFirstWriteBackup(path, raw, backups, fileIo)
    await fileIo.write(path, serializeJson(doc, style), 0o600)
    return {
      files: [{
        path,
        keys: [...Object.keys(top), ...Object.keys(env).map((key) => `env.${key}`)],
        removed,
      }],
      warnings: protocolWarnings('claude', provider),
    }
  })
}

/**
 * Write `~/.codex/auth.json` and `~/.codex/config.toml` for one provider.
 *
 * The two files are one unit. Both are read and rendered *before* either is
 * written, so a file this module refuses to understand costs nothing; then
 * `auth.json` is committed first and `config.toml` second, and a failure on the
 * second restores the first to the exact bytes it had. That is cc-switch's
 * `write_codex_live_atomic`: a key left in `auth.json` while `config.toml`
 * still points at the previous provider is worse than having written nothing.
 *
 * The credential goes into the route table's `experimental_bearer_token`, not
 * into `auth.json`. From Codex 0.149 a custom provider no longer reads a key
 * out of `auth.json` — that file is the store for the *official* login, and a
 * third-party key written there authenticates nothing while still being read as
 * an `apikey` credential by Codex's auth-mode resolution, which outranks the
 * ChatGPT `tokens` that may sit next to it. So `auth.json` is left as the
 * official-login store: its members are re-emitted unchanged, and nothing of
 * ours is added. A key already there is *not* removed either, because this
 * module is handed one provider at a time and cannot prove the key was its own
 * — cc-switch only clears one it can match against a known provider key, and
 * deleting on shape alone would destroy a `codex login --api-key` credential.
 *
 * The route's `requires_openai_auth` is computed from `auth.json` and is
 * therefore exactly the state Codex will find after the write, since nothing
 * this writer does changes that file's meaning — see
 * {@link hasCredentialLoginMaterial} for why neither fixed value is safe.
 *
 * @param {object} options - as {@link writeClaudeConfig}.
 * @returns {Promise<{files: Array<{path: string, keys: string[], removed: string[]}>, warnings: string[]}>}
 * @throws {WriterError} when an existing file cannot be understood.
 */
export async function writeCodexConfig({ provider, apiKey, home, io, backupRoot } = {}) {
  const key = requireApiKey(apiKey)
  const directory = join(home ?? homedir(), '.codex')
  const authPath = join(directory, 'auth.json')
  const configPath = join(directory, 'config.toml')
  const fileIo = io ?? defaultIo
  const backups = backupRoot ?? defaultBackupRoot(home)

  return withWriterLock(authPath, () => withWriterLock(configPath, async () => {
    const authRaw = await fileIo.read(authPath)
    const { doc, style } = parseJsonDocument(authRaw, authPath)

    // This writer's route always carries its credential as a bearer token, and
    // cc-switch's rule for that case — `requires_openai_auth(RouteAuth::Bearer,
    // login_on_disk)` — therefore reduces to the login check alone.
    //
    // cc-switch reaches the same answer by a different route: with its default
    // `preserve_codex_official_auth_on_switch = false` it *deletes* a stale
    // third-party key from `auth.json` on the way to a third-party provider, so
    // its post-write file holds no such key either. This writer leaves the file
    // alone instead — see the doc comment above — so it has to classify the
    // residue rather than remove it, which is what the predicate does.
    const requiresOpenaiAuth = hasCredentialLoginMaterial(doc)
    const authNext = serializeJson(doc, style)

    const configRaw = await fileIo.read(configPath)
    const patched = patchCodexToml(
      configRaw === undefined ? '' : configRaw.toString('utf8'),
      provider,
      {
        apiKey: key,
        requiresOpenaiAuth,
        // A file being created gets a trailing newline even though there was no
        // "original" habit to copy.
        trailingNewline: configRaw === undefined ? true : undefined,
      },
    )

    // Both files are rendered before either is backed up or written, so a file
    // this module refuses to understand costs neither a write nor a backup —
    // the same ordering cc-switch gets from rendering in `plan` and backing up
    // in the publish step.
    await ensureFirstWriteBackup(authPath, authRaw, backups, fileIo)
    await ensureFirstWriteBackup(configPath, configRaw, backups, fileIo)

    await fileIo.write(authPath, authNext, 0o600)
    try {
      await fileIo.write(configPath, patched.text, 0o600)
    } catch (err) {
      await restoreBytes(authPath, authRaw, fileIo)
      throw err
    }

    return {
      files: [
        { path: authPath, keys: [], removed: [] },
        { path: configPath, keys: patched.written, removed: patched.removed },
      ],
      warnings: protocolWarnings('codex', provider),
    }
  }))
}

/**
 * Put a file back the way it was, or remove it if it did not exist.
 *
 * Best effort by design: the caller is already unwinding from a failure, and a
 * failure to roll back must not replace the original error with its own.
 */
async function restoreBytes(path, previous, fileIo) {
  try {
    if (previous === undefined) {
      await rm(path, { force: true })
      return
    }
    await fileIo.write(path, previous.toString('utf8'), 0o600)
  } catch {
    /* the original failure is the one worth reporting */
  }
}

/**
 * Dispatch to the writer for an app type.
 *
 * @throws {WriterError} with `kind: 'unsupported'` when nothing writes that app
 *   type, so the route can name what is supported instead of reporting success
 *   for a write that never happened.
 */
export async function writeProviderConfig({ appType, provider, apiKey, home, io, previous } = {}) {
  if (appType === 'claude') return writeClaudeConfig({ provider, apiKey, home, io, previous })
  if (appType === 'codex') return writeCodexConfig({ provider, apiKey, home, io })
  throw new WriterError(`no writer for app type "${appType}"`, { kind: 'unsupported' })
}
