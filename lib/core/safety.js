// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * Shared safety helpers: settings-conflict identification and credential
 * redaction. Both the Host core and the route layer import from here so a
 * single definition governs every place an error can reach the browser.
 */

/**
 * The Host settings service throws `SETTINGS_CONFLICT`; the 0.2.0 remote API
 * surface reports the same condition as `settings/conflict`. Both mean "the
 * document moved under you", so both must be recognised.
 */
export const HOST_SETTINGS_CONFLICT_CODE = 'SETTINGS_CONFLICT'
export const REMOTE_SETTINGS_CONFLICT_CODE = 'settings/conflict'

export function isSettingsConflict(error) {
  if (!error) return false
  const code = typeof error?.code === 'string' ? error.code : ''
  if (code === HOST_SETTINGS_CONFLICT_CODE || code === REMOTE_SETTINGS_CONFLICT_CODE) return true
  if (/conflict/i.test(code)) return true
  const message = error instanceof Error ? error.message : String(error?.message ?? error ?? '')
  return /conflict/i.test(message)
}

/** Machine-readable failure kinds. The Host maps these to fixed messages. */
export const IMPORT_FAILURE = {
  CREDENTIAL: 'credential-write-failed',
  SETTINGS: 'settings-write-failed',
  CONFLICT: 'settings-conflict',
  ROLLBACK: 'credential-rollback-failed',
}

/**
 * Why a source profile cannot be imported.
 *
 * `extractProfile` already knows exactly what is wrong with a row, but it
 * explains it in Chinese prose meant for the Host log. The browser needs a
 * stable code plus an optional detail value, otherwise every blocked row
 * collapses into the same "blocked" badge and the user has to guess which of
 * the eight possible causes applies to it.
 */
export const BLOCKED = {
  INVALID_SETTINGS_JSON: 'invalid-settings-json',
  UNSUPPORTED_APP_TYPE: 'unsupported-app-type',
  MISSING_OPENAI_KEY: 'missing-openai-key',
  MISSING_CODEX_PROVIDER: 'missing-codex-provider',
  MISSING_ANTHROPIC_KEY: 'missing-anthropic-key',
  MISSING_ANTHROPIC_BASE_URL: 'missing-anthropic-base-url',
  /** claude-desktop keeps its endpoint at the top level and names the key field. */
  MISSING_CLAUDE_DESKTOP_KEY: 'missing-claude-desktop-key',
  MISSING_CLAUDE_DESKTOP_BASE_URL: 'missing-claude-desktop-base-url',
  MISSING_OPENCODE_KEY: 'missing-opencode-key',
  MISSING_OPENCODE_BASE_URL: 'missing-opencode-base-url',
  UNSUPPORTED_OPENCODE_ADAPTER: 'unsupported-opencode-adapter',
  /**
   * gemini rows are never blocked for a missing field — they are blocked on
   * protocol grounds. cc-switch configures the Gemini CLI, which speaks
   * Gemini's own protocol, and llm-pi-ai has no adapter for it, so any import
   * would be a provider that can never answer. `blockedDetail` is the endpoint
   * host so the row can still name what it would have pointed at.
   */
  UNSUPPORTED_GEMINI_PROTOCOL: 'unsupported-gemini-protocol',
  MISSING_HERMES_KEY: 'missing-hermes-key',
  MISSING_HERMES_BASE_URL: 'missing-hermes-base-url',
  MISSING_PI_KEY: 'missing-pi-key',
  MISSING_PI_BASE_URL: 'missing-pi-base-url',
  /** `api` was present but is not one of the three llm-pi-ai protocols. */
  UNSUPPORTED_PI_API: 'unsupported-pi-api',
  MISSING_MCODE_KEY: 'missing-mcode-key',
  MISSING_MCODE_BASE_URL: 'missing-mcode-base-url',
  UNSUPPORTED_MCODE_API: 'unsupported-mcode-api',
  MISSING_OPENCLAW_KEY: 'missing-openclaw-key',
  MISSING_OPENCLAW_BASE_URL: 'missing-openclaw-base-url',
  UNSUPPORTED_OPENCLAW_API: 'unsupported-openclaw-api',
  /** Two selected rows resolve to the same provider key in one batch. */
  DUPLICATE_PROVIDER_KEY: 'duplicate-provider-key',
  /** Fallback for a row that is blocked for a reason this build does not know. */
  UNKNOWN: 'blocked',
}

export const BLOCKED_CODES = new Set(Object.values(BLOCKED))

/**
 * Redact a free-form error before it can leave the Host process.
 *
 * Two layers, because shape matching alone is not enough: a relay key that does
 * not start with `sk-` still has to be removed. The caller passes the concrete
 * secrets it knows about, and a length heuristic catches anything else that
 * looks like a long opaque token.
 */
export function redactText(value, secrets = []) {
  let text = value instanceof Error ? value.message : String(value?.message ?? value ?? '')
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) {
      text = text.split(secret).join('[redacted]')
    }
  }
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
    .replace(/\b(?:authorization|x-api-key|api-key)\b[^\n]*/gi, 'auth header [redacted]')
    .replace(/[A-Za-z0-9_\-]{32,}/g, '[redacted]')
    .slice(0, 300)
}
