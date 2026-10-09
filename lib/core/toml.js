// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * Minimal Codex config.toml extraction for the CC Switch importer.
 * Reads only: top-level `model`, and the `[model_providers.custom]` section's
 * name / base_url / wire_api / requires_openai_auth. Everything else is ignored.
 */

function stripInlineComment(value) {
  // In TOML a ` #` comment can only appear after the value. For quoted values
  // cut everything after the closing quote (a # inside the quotes is data);
  // for unquoted values cut at the first ` #`.
  const first = value[0]
  if (first === '"' || first === "'") {
    const close = value.indexOf(first, 1)
    if (close !== -1) return value.slice(0, close + 1)
    return value
  }
  const comment = value.indexOf(' #')
  if (comment !== -1) return value.slice(0, comment)
  return value
}

function unquote(raw) {
  const value = stripInlineComment(raw.trim())
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

function parseBool(raw) {
  const value = unquote(raw).toLowerCase()
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

export function parseCodexToml(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { model: undefined, reasoningEffort: undefined, provider: null }
  }
  let model
  let reasoningEffort
  let section = null
  let provider = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      section = sectionMatch[1]
      if (section === 'model_providers.custom') {
        // All four keys are always present so callers can rely on the shape;
        // missing fields are explicitly undefined.
        provider = { name: undefined, baseUrl: undefined, wireApi: undefined, requiresOpenaiAuth: undefined }
      }
      continue
    }
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const rawValue = line.slice(eq + 1).trim()
    if (section === null && key === 'model') {
      model = unquote(rawValue)
      continue
    }
    if (section === null && key === 'model_reasoning_effort') {
      reasoningEffort = unquote(rawValue)
      continue
    }
    if (section === 'model_providers.custom' && provider) {
      if (key === 'name') provider.name = unquote(rawValue)
      else if (key === 'base_url') provider.baseUrl = unquote(rawValue)
      else if (key === 'wire_api') provider.wireApi = unquote(rawValue)
      else if (key === 'requires_openai_auth') provider.requiresOpenaiAuth = parseBool(rawValue)
    }
  }
  return { model, reasoningEffort, provider }
}

/**
 * Grok Build's own `~/.grok/config.toml`.
 *
 * A different document from the Codex carrier above, despite both being TOML:
 * Grok selects one entry by name and stores each endpoint in its own table.
 *
 *   [models]
 *   default = "grok-4.5"
 *
 *   [model."grok-4.5"]
 *   model = "grok-4.5"
 *   base_url = "https://api.x.ai/v1"
 *   name = "Example"
 *   api_key = "..."          # or env_key = "SOME_VAR"
 *   api_backend = "responses"
 *   context_window = 500000
 *
 * The protocol key is `api_backend`, never `wire_api` — that spelling exists
 * only in the Codex-shaped template the preset form starts from.
 *
 * Returns every model table found plus the declared default, so a caller can
 * fall back to the sole table when `default` is absent or names nothing.
 */
export function parseGrokToml(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { defaultModel: undefined, models: {} }
  }
  const models = {}
  let defaultModel
  // `null` at top level; otherwise the table the following keys belong to.
  let section = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const header = line.match(/^\[([^\]]+)\]$/)
    if (header) {
      const name = header[1]
      if (name === 'models') {
        section = { kind: 'models' }
        continue
      }
      // `[model."a.b"]` is legal — the name is quoted precisely so it can hold
      // dots — so the quoted forms are matched before the bare one.
      const modelTable = name.match(/^model\.(?:"([^"]*)"|'([^']*)'|(.+))$/)
      if (modelTable) {
        const modelName = modelTable[1] ?? modelTable[2] ?? modelTable[3]
        section = { kind: 'model', name: modelName }
        // All keys always present, so a caller can read the shape without
        // guarding each field; anything the table omits stays undefined.
        models[modelName] = {
          model: undefined,
          baseUrl: undefined,
          name: undefined,
          apiKey: undefined,
          envKey: undefined,
          apiBackend: undefined,
          contextWindow: undefined,
        }
        continue
      }
      section = { kind: 'other' }
      continue
    }
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const rawValue = line.slice(eq + 1).trim()
    if (section !== null && section.kind === 'models' && key === 'default') {
      defaultModel = unquote(rawValue)
      continue
    }
    if (section === null || section.kind !== 'model') continue
    const entry = models[section.name]
    if (key === 'model') entry.model = unquote(rawValue)
    else if (key === 'base_url') entry.baseUrl = unquote(rawValue)
    else if (key === 'name') entry.name = unquote(rawValue)
    else if (key === 'api_key') entry.apiKey = unquote(rawValue)
    else if (key === 'env_key') entry.envKey = unquote(rawValue)
    else if (key === 'api_backend') entry.apiBackend = unquote(rawValue)
    else if (key === 'context_window') {
      const size = Number(unquote(rawValue))
      if (Number.isInteger(size) && size > 0) entry.contextWindow = size
    }
  }
  return { defaultModel, models }
}
