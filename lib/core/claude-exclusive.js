// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The `env` keys a Claude provider owns that are *not* part of the floor.
 *
 * A port of `CLAUDE_EXCLUSIVE_ENV` (`src-tauri/src/live/floor.rs`). In CC Switch
 * the two sets differ in how a key is removed: floor keys belong to whoever is
 * active and are cleared on every switch, while exclusive keys belong to
 * whichever provider put them there and come out only while the file still
 * holds the value that provider wrote — so a user who edits one keeps it.
 *
 * **What is still used here is the definition, not the write.** This plugin no
 * longer rewrites any external tool's configuration (see decision #5 in
 * `docs/ccswitch-port.md`), so nothing is ever written into or deleted out of
 * `~/.claude/settings.json`. The set still matters on the way *in*: a row
 * scanned out of CC Switch's database carries an `env` object that mixes
 * provider-owned settings with the tool's own, and `pickClaudeExclusiveEnv` is
 * what decides which part is carried into the catalogue as `exclusiveEnv` so it
 * survives a round-trip through this plugin instead of being dropped as
 * "somebody else's setting".
 *
 * These are compatibility switches and window sizes a third-party upstream
 * needs and that cannot be read off the endpoint. AtlasCloud and Soshow reject
 * experimental beta headers; DeepSeek validates tool schemas strictly enough
 * that the Artifact tool 400s on every request; a gateway needs
 * `CLAUDE_CODE_AUTO_MODE_SERVER=0` because the server-side classifier exists
 * only on the official endpoint. Losing one would not fail loudly, which is why
 * they have to travel with the provider rather than be rediscovered.
 *
 * Deliberately absent, matching cc-switch: `API_TIMEOUT_MS` and
 * `DISABLE_TELEMETRY` are feature switches rather than provider configuration,
 * and a user is likely to have set them globally from vendor documentation.
 */

/**
 * The keys, spelled as Claude Code spells them. Frozen because this list is the
 * contract cc-switch verified against Claude Code 2.1.282: a key added here is
 * a key this plugin carries across as provider-owned instead of dropping as
 * somebody else's setting.
 */
export const CLAUDE_EXCLUSIVE_ENV = [
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'CLAUDE_CODE_DISABLE_ARTIFACT',
  'ENABLE_TOOL_SEARCH',
  'CLAUDE_CODE_DISABLE_THINKING',
  'DISABLE_INTERLEAVED_THINKING',
  'CLAUDE_CODE_ALWAYS_ENABLE_EFFORT',
  'CLAUDE_CODE_EXTRA_BODY',
  'CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING',
  'CLAUDE_CODE_AUTO_MODE_SERVER',
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_DISABLE_1M_CONTEXT',
  'CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT',
  'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY',
]

const EXCLUSIVE = new Set(CLAUDE_EXCLUSIVE_ENV)

/** Whether `key` is a provider-exclusive Claude Code `env` key. */
export function isClaudeExclusiveEnv(key) {
  return EXCLUSIVE.has(key)
}

/**
 * Only the three JSON primitives are carried: these are switches and window
 * sizes, so an object or array here is a malformed row rather than something to
 * preserve — and the catalogue field it lands in is declared as a map of
 * primitives, so a structured value would not survive the schema either.
 */
function carryable(value) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/**
 * The provider-exclusive keys in a `settings_config.env` object.
 *
 * Nothing that is neither floor nor exclusive is returned. Floor keys describe
 * the *active* endpoint rather than this provider, and anything else in that
 * object is the user's own setting — neither belongs in a catalogue entry that
 * is meant to describe one provider.
 *
 * @returns {Record<string, string|number|boolean>} possibly empty, never null.
 */
export function pickClaudeExclusiveEnv(env) {
  const picked = {}
  if (env === null || typeof env !== 'object' || Array.isArray(env)) return picked
  for (const [key, value] of Object.entries(env)) {
    if (!EXCLUSIVE.has(key)) continue
    if (!carryable(value)) continue
    picked[key] = value
  }
  return picked
}

/**
 * A stored provider's exclusive keys, filtered to the known set.
 *
 * The filter matters on the way out as much as on the way in: the settings
 * document is plaintext YAML a user can hand-edit, so this is the boundary that
 * keeps an arbitrary key from being published as a provider-owned setting. A
 * hand-added key outside the known set stays in the stored record untouched —
 * it is simply not reported here.
 */
export function claudeExclusiveEnvOf(provider) {
  return pickClaudeExclusiveEnv(provider?.exclusiveEnv)
}
