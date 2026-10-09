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
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseCodexToml } from '../../lib/core/toml.js'

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
 * it parses but is not the structure we require, and `'unsupported'` when no
 * writer serves the app type at all. The first two mean "this is the user's
 * file and we do not understand it", which the route reports differently from
 * an I/O failure.
 */
export class WriterError extends Error {
  constructor(message, { kind = 'parse', path, line, column } = {}) {
    super(message)
    this.name = 'WriterError'
    this.kind = kind
    if (path !== undefined) this.path = path
    if (line !== undefined) this.line = line
    if (column !== undefined) this.column = column
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

/** The table Codex is told to route third-party providers through. */
const CODEX_ROUTE_SECTION = 'model_providers.custom'
const CODEX_ROUTE_ID = 'custom'

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
 * to guess: `auth.json` holds a secret and is written 0600, the rest 0644,
 * matching cc-switch's private `auth.json`.
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
  return { top: {}, env }
}

/**
 * Clear every floor key the target does not claim, then write the target's.
 *
 * Keys present in both are assigned in place, which keeps their position in the
 * file; only genuinely new keys are appended. (JavaScript's `delete` leaves the
 * remaining keys in order, so unlike serde's `swap_remove` there is no
 * last-key-into-the-gap hazard to work around.)
 */
function applyClaudePatch(doc, top, env, path) {
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
function codexTomlEdits(provider, apiKey, requiresOpenaiAuth) {
  const edits = []
  const model = primaryModelId(provider)
  if (model !== undefined) {
    edits.push({ section: null, key: 'model', literal: tomlString(model) })
  }
  edits.push({ section: null, key: 'model_provider', literal: tomlString(CODEX_ROUTE_ID) })
  const effort = reasoningEffortOf(provider)
  edits.push({
    section: null,
    key: 'model_reasoning_effort',
    literal: effort === undefined ? null : tomlString(effort),
  })
  edits.push(
    { section: CODEX_ROUTE_SECTION, key: 'name', literal: tomlString(provider?.displayName ?? '') },
    { section: CODEX_ROUTE_SECTION, key: 'base_url', literal: tomlString(provider?.baseURL ?? '') },
    {
      section: CODEX_ROUTE_SECTION,
      key: 'wire_api',
      literal: tomlString(provider?.api === 'openai-responses' ? 'responses' : 'chat'),
    },
    { section: CODEX_ROUTE_SECTION, key: 'experimental_bearer_token', literal: tomlString(apiKey) },
    {
      section: CODEX_ROUTE_SECTION,
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
 */
function scanStructure(lines) {
  const sectionAt = []
  const headers = new Map()
  const state = { multiline: null, arrays: 0, unterminated: false }
  let current = null
  for (let index = 0; index < lines.length; index += 1) {
    sectionAt.push(current)
    if (state.multiline === null && state.arrays === 0) {
      const name = sectionNameOf(lines[index])
      if (name !== undefined) {
        if (!headers.has(name)) headers.set(name, index)
        current = name
      }
    }
    scanLine(lines[index], state)
  }
  const starts = [...headers.values()].sort((left, right) => left - right)
  const endOf = (start) => starts.find((candidate) => candidate > start) ?? lines.length
  const ranges = new Map([...headers].map(([name, start]) => [name, { start, end: endOf(start) }]))
  return { sectionAt, headers, ranges, unterminated: state.unterminated }
}

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
  const lines = text === '' ? [] : (endsWithNewline ? text.slice(0, -1) : text).split('\n')
  const structure = scanStructure(lines)
  const { sectionAt, headers, ranges } = structure

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

  const replacements = new Map()
  const removals = new Set()
  const pending = []
  const written = []
  const removed = []

  for (const edit of codexTomlEdits(provider, apiKey, requiresOpenaiAuth)) {
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

  // Appending a second `[model_providers.custom]` header is a TOML error, so a
  // file that already spells the table some other way is refused rather than
  // risked. An inline `custom = { … }` under an existing `[model_providers]`
  // cannot be patched line-wise at all.
  if (pending.some((edit) => edit.section === CODEX_ROUTE_SECTION) && !headers.has(CODEX_ROUTE_SECTION)) {
    const inlineCustom = ranges.has('model_providers') && lines
      .slice(ranges.get('model_providers').start, ranges.get('model_providers').end)
      .some((line) => keyOf(line) === 'custom')
    if (inlineCustom) {
      throw new WriterError(
        'config.toml defines model_providers.custom inline; refusing to rewrite it',
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
  verifyCodexToml(next, provider, { apiKey, requiresOpenaiAuth })
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
function verifyCodexToml(text, provider, { apiKey, requiresOpenaiAuth } = {}) {
  const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n')

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
  if (parsed.provider === null) refuse('model_providers.custom')
  expect('base_url', parsed.provider.baseUrl, String(provider?.baseURL ?? ''))
  expect('name', parsed.provider.name, String(provider?.displayName ?? ''))
  expect('wire_api', parsed.provider.wireApi, provider?.api === 'openai-responses' ? 'responses' : 'chat')
  expect('requires_openai_auth', parsed.provider.requiresOpenaiAuth, requiresOpenaiAuth)

  // `experimental_bearer_token` is not exposed by the reader, so like the
  // duplicate-header check above it is verified by scanning the text directly.
  // Comparing the raw value is the point: it proves the credential landed under
  // `[model_providers.custom]` and not in some table the line scanner mistook
  // for the route.
  const wantedToken = tomlString(apiKey)
  let inRoute = false
  let tokenFound = false
  for (const line of lines) {
    const name = sectionNameOf(line)
    if (name !== undefined) {
      inRoute = name === CODEX_ROUTE_SECTION
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
 * @param {object} [options.io] - file primitives, for tests that need a write
 *   to fail. Production never passes it.
 * @returns {Promise<{files: Array<{path: string, keys: string[], removed: string[]}>, warnings: string[]}>}
 * @throws {WriterError} when the existing file cannot be understood.
 */
export async function writeClaudeConfig({ provider, apiKey, home, io } = {}) {
  const key = requireApiKey(apiKey)
  const path = join(home ?? homedir(), '.claude', 'settings.json')
  const fileIo = io ?? defaultIo
  return withWriterLock(path, async () => {
    const raw = await fileIo.read(path)
    const { doc, style } = parseJsonDocument(raw, path)
    const { top, env } = claudeProjection(provider, key)
    const removed = applyClaudePatch(doc, top, env, path)
    await fileIo.write(path, serializeJson(doc, style), 0o644)
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
export async function writeCodexConfig({ provider, apiKey, home, io } = {}) {
  const key = requireApiKey(apiKey)
  const directory = join(home ?? homedir(), '.codex')
  const authPath = join(directory, 'auth.json')
  const configPath = join(directory, 'config.toml')
  const fileIo = io ?? defaultIo

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

    await fileIo.write(authPath, authNext, 0o600)
    try {
      await fileIo.write(configPath, patched.text, 0o644)
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
export async function writeProviderConfig({ appType, provider, apiKey, home, io } = {}) {
  if (appType === 'claude') return writeClaudeConfig({ provider, apiKey, home, io })
  if (appType === 'codex') return writeCodexConfig({ provider, apiKey, home, io })
  throw new WriterError(`no writer for app type "${appType}"`, { kind: 'unsupported' })
}
