// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * Browser controller for the provider-manager tab.
 *
 * Deliberately the same shape as `import-controller.mjs`: a plain snapshot
 * object handed to `useSyncExternalStore`, and one serialized queue so two
 * clicks cannot interleave their reads and writes. It is not a React hook, so
 * a test can drive every path with a fake `fetch`.
 */

export const MANAGER_API_BASE = '/api/dsh-ccswitch-manager'

const PROVIDERS_PATH = `${MANAGER_API_BASE}/providers`
const SAVE_PATH = `${PROVIDERS_PATH}/save`
const DELETE_PATH = `${PROVIDERS_PATH}/delete`
const ACTIVATE_PATH = `${PROVIDERS_PATH}/activate`
const PRESETS_PATH = `${MANAGER_API_BASE}/presets`

// The Host accepts this header in place of an `Origin` header, which a browser
// is free to omit on a same-origin POST. The two constants are duplicated from
// `src/host/routes.mjs` rather than imported: that module reaches the scan core
// and therefore `node:sqlite`, which cannot be bundled for the browser.
const SAME_ORIGIN_HEADER = 'x-dsh-ccswitch-origin'
const SAME_ORIGIN_VALUE = 'same-origin'

/**
 * The protocols `dsh-llm-pi-ai` can serve, used only when the Host sends none.
 * Every read carries the authoritative list, so this is purely what the form
 * falls back to when the Host half is older than this bundle.
 */
const FALLBACK_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']

function defaultFetch(url, init) {
  return globalThis.fetch(url, init)
}

/** Headers for every state-changing request; see SAME_ORIGIN_HEADER above. */
function writeHeaders() {
  return { 'content-type': 'application/json', [SAME_ORIGIN_HEADER]: SAME_ORIGIN_VALUE }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A trimmed non-empty string, or undefined — never an empty one. */
function optionalText(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw === '' ? undefined : raw
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined
}

/**
 * One model row, rebuilt field by field.
 *
 * Rebuilding rather than spreading is what keeps a field the Host adds later
 * from reaching the UI without a deliberate decision — the same reasoning the
 * Host's own `publicProvider` uses in the other direction.
 */
export function sanitizeModel(value) {
  const source = isRecord(value) ? value : {}
  return {
    id: String(source.id ?? ''),
    name: optionalText(source.name),
    contextWindow: count(source.contextWindow),
    maxTokens: count(source.maxTokens),
    reasoningEfforts: source.reasoningEfforts === false ? false : undefined,
  }
}

/** One provider as this tab renders it. */
export function sanitizeProvider(key, value) {
  const source = isRecord(value) ? value : {}
  return {
    key: String(source.key ?? key),
    displayName: String(source.displayName ?? ''),
    api: String(source.api ?? ''),
    baseURL: String(source.baseURL ?? ''),
    apiKeyEnv: optionalText(source.apiKeyEnv),
    // The Host reports configuredness, never the key. Anything other than an
    // explicit `found` reads as missing, so a Host that omits the field cannot
    // make a provider whose credential is unset look ready.
    credential: source.credential === 'found' ? 'found' : 'missing',
    models: (Array.isArray(source.models) ? source.models : []).slice(0, 200).map(sanitizeModel),
    notes: optionalText(source.notes),
    icon: optionalText(source.icon),
    iconColor: optionalText(source.iconColor),
    appType: optionalText(source.appType),
    sourceProfileId: optionalText(source.sourceProfileId),
    isCurrent: source.isCurrent === true,
    inFailoverQueue: source.inFailoverQueue === true,
    costMultiplier: finiteNumber(source.costMultiplier),
    limitDailyUsd: finiteNumber(source.limitDailyUsd),
    limitMonthlyUsd: finiteNumber(source.limitMonthlyUsd),
  }
}

/** The provider map, keyed as the Host sent it, with unusable entries dropped. */
export function sanitizeProviders(value) {
  const source = isRecord(value) ? value : {}
  const providers = {}
  for (const [key, entry] of Object.entries(source)) {
    if (key === '') continue
    providers[key] = sanitizeProvider(key, entry)
  }
  return providers
}

/**
 * Row order, reconciled against the providers actually present.
 *
 * The Host sends `order` beside `providers`, but the two can disagree — a
 * truncated list, an older Host, a provider added between the two reads. A row
 * present in one and not the other must still render exactly once: a provider
 * that silently vanishes from the table is far worse than one shown out of
 * place, because the only way to notice is to count.
 */
export function sanitizeOrder(order, providers) {
  const seen = new Set()
  const next = []
  for (const key of Array.isArray(order) ? order : []) {
    if (typeof key !== 'string' || !Object.hasOwn(providers, key) || seen.has(key)) continue
    seen.add(key)
    next.push(key)
  }
  for (const key of Object.keys(providers)) {
    if (!seen.has(key)) next.push(key)
  }
  return next
}

/** The protocol list for the form's select; never empty. */
export function sanitizeProtocols(value) {
  const list = (Array.isArray(value) ? value : []).filter((entry) => typeof entry === 'string' && entry.trim() !== '')
  return list.length > 0 ? [...new Set(list)] : [...FALLBACK_PROTOCOLS]
}

/** Presets are a convenience, so a malformed entry is dropped, not repaired. */
export function sanitizePresets(value) {
  return (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .slice(0, 200)
    .map((preset) => ({
      key: String(preset.key ?? ''),
      displayName: String(preset.displayName ?? ''),
      appType: optionalText(preset.appType),
      api: String(preset.api ?? ''),
      baseURL: String(preset.baseURL ?? ''),
      models: (Array.isArray(preset.models) ? preset.models : [])
        .filter((id) => typeof id === 'string' && id !== '')
        .slice(0, 200),
      icon: optionalText(preset.icon),
      iconColor: optionalText(preset.iconColor),
    }))
    .filter((preset) => preset.key !== '' && preset.displayName !== '')
}

/**
 * The warnings an activation returned.
 *
 * These explain the cases where the catalogue now says "this one is active" but
 * DSH itself could not be pointed at it — the one outcome the user cannot see
 * from the row's badge, so they are kept verbatim rather than folded into a
 * generic "saved".
 */
export function sanitizeWarnings(value) {
  return (Array.isArray(value) ? value : [])
    .filter((entry) => typeof entry === 'string' && entry.trim() !== '')
    .slice(0, 20)
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] - swap-in for tests.
 * @param {() => Promise<void>|void} [options.onChanged] - called after every
 *   successful write. A manager write changes the same settings document the
 *   importer classifies against and the reasoning editor edits, so the host
 *   half is not the only thing that has to be told.
 */
export function createCCSwitchManagerController({ fetchImpl = defaultFetch, onChanged = () => {} } = {}) {
  let snapshot = {
    status: 'idle',
    error: null,
    /** The last failure was a revision conflict, not a bad request. */
    conflict: false,
    revision: undefined,
    exists: false,
    providers: {},
    order: [],
    current: undefined,
    apiProtocols: [...FALLBACK_PROTOCOLS],
    presets: [],
    presetsError: null,
    /** The row an operation is in flight for, so only it shows as busy. */
    pendingKey: undefined,
    pendingAction: undefined,
    /** The Host's own validation list from a rejected save, for the form. */
    saveErrors: [],
    /** `{key, applied, warnings}` from the last activation, until dismissed. */
    activation: undefined,
  }
  const listeners = new Set()
  const publish = (next) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  let operationQueue = Promise.resolve()
  const enqueue = (operation) => {
    const next = operationQueue.then(operation, operation)
    operationQueue = next.then(() => undefined, () => undefined)
    return next
  }

  const request = async (url, init) => {
    const response = await fetchImpl(url, init)
    let body
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    if (!response.ok) {
      const error = new Error(optionalText(body?.error) ?? `HTTP ${response.status}`)
      // The status and the Host's own list are what let a caller tell a failed
      // validation from a revision conflict from a Host that is simply older.
      error.status = response.status
      error.errors = Array.isArray(body?.errors)
        ? body.errors.filter((entry) => typeof entry === 'string').slice(0, 50)
        : undefined
      throw error
    }
    return body ?? {}
  }

  /**
   * `quiet` is for the re-read that follows a write: publishing `loading` there
   * would blank a table that is about to be replaced with its own contents, and
   * a failure must not overwrite the report of a write that already succeeded.
   */
  const performRefresh = async (options = {}) => {
    const quiet = options?.quiet === true
    if (!quiet) {
      publish({ ...snapshot, status: 'loading', error: null, conflict: false, pendingKey: undefined, pendingAction: undefined })
    }
    try {
      const body = await request(PROVIDERS_PATH)
      const providers = sanitizeProviders(body?.providers)
      publish({
        ...snapshot,
        status: 'ready',
        error: null,
        conflict: false,
        pendingKey: undefined,
        pendingAction: undefined,
        // `exists` separates "no namespace has been created yet" from "the
        // namespace exists and is empty": the first has no catalogue to edit at
        // all, which is a different thing to tell the user.
        exists: body?.exists === true,
        revision: Number.isInteger(body?.revision) ? body.revision : undefined,
        providers,
        order: sanitizeOrder(body?.order, providers),
        current: optionalText(body?.current),
        apiProtocols: sanitizeProtocols(body?.apiProtocols),
      })
      return snapshot
    } catch (error) {
      if (!quiet) {
        publish({
          ...snapshot,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          conflict: false,
          pendingKey: undefined,
          pendingAction: undefined,
        })
      }
      throw error
    }
  }

  const quietlyRefresh = async () => {
    try {
      await performRefresh({ quiet: true })
    } catch {
      // The write already succeeded; a failed re-read is not its failure. The
      // document-updated listener will bring the table back in step.
    }
  }

  /**
   * One write, with the busy/conflict/error transitions every route shares.
   *
   * A 409 means someone else moved the document under us. The row is re-read
   * before reporting so the table the user retries against is the current one,
   * and `conflict` is published as a flag rather than a sentence: the message
   * has to be localized, and the controller has no translator.
   */
  const runMutation = async ({ path, body, pendingKey, pendingAction, patch }) => {
    publish({
      ...snapshot,
      status: 'busy',
      error: null,
      conflict: false,
      pendingKey,
      pendingAction,
      // Cleared on entry so a rejection's list is never the previous attempt's:
      // a stale validation message is worse than none, because the field it
      // names may already be fixed.
      saveErrors: [],
      activation: undefined,
    })
    try {
      const response = await request(path, {
        method: 'POST',
        headers: writeHeaders(),
        body: JSON.stringify(body),
      })
      const extra = typeof patch === 'function' ? patch(response) : undefined
      publish({
        ...snapshot,
        status: 'ready',
        error: null,
        conflict: false,
        pendingKey: undefined,
        pendingAction: undefined,
        saveErrors: [],
        ...extra,
      })
      await quietlyRefresh()
      // Best-effort for the same reason the importer's post-import refresh is:
      // the write already landed, and a listener that throws must not turn a
      // completed save into a failure the user is invited to retry.
      try {
        await onChanged()
      } catch {
        // The catalogue published above is the source of truth.
      }
      return snapshot
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const conflict = error?.status === 409
      if (conflict) {
        // Re-read first, then publish: performRefresh clears `error`, so doing
        // it the other way round would erase the message being reported.
        try {
          await performRefresh({ quiet: true })
        } catch {
          // Keep the pre-write table; the conflict message still explains it.
        }
      }
      publish({
        ...snapshot,
        status: conflict ? 'conflict' : 'error',
        error: message,
        conflict,
        // Only a save route answers with a per-field list; carrying one from a
        // delete or activate would put a form's errors on an unrelated dialog.
        saveErrors: pendingAction === 'save' && Array.isArray(error?.errors) ? error.errors : [],
        pendingKey: undefined,
        pendingAction: undefined,
      })
      throw error
    }
  }

  const controller = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh: () => enqueue(() => performRefresh()),
    /**
     * The preset catalogue is loaded separately from the provider list because
     * it is static: a failed load must not break the tab, so it reports beside
     * the picker instead of through the page's error banner.
     */
    loadPresets: () => enqueue(async () => {
      publish({ ...snapshot, presetsError: null })
      try {
        const body = await request(PRESETS_PATH)
        publish({ ...snapshot, presets: sanitizePresets(body?.presets), presetsError: null })
        return snapshot
      } catch (error) {
        publish({ ...snapshot, presetsError: error instanceof Error ? error.message : String(error) })
        throw error
      }
    }),
    /**
     * Create or update one provider.
     *
     * `expectedRevision` is the revision the caller read the provider *at*, not
     * whatever the controller holds now: a refresh that landed while the form
     * was open means the document moved under the edit, and the Host has to be
     * able to refuse rather than let the form silently overwrite it.
     */
    save: (draft = {}) => enqueue(async () => {
      const key = optionalText(draft?.key)
      const provider = isRecord(draft?.provider) ? draft.provider : {}
      const apiKey = typeof draft?.apiKey === 'string' && draft.apiKey !== '' ? draft.apiKey : undefined
      const expectedRevision = Number.isInteger(draft?.expectedRevision) ? draft.expectedRevision : snapshot.revision
      const body = { provider }
      if (key !== undefined) body.key = key
      if (apiKey !== undefined) body.apiKey = apiKey
      if (expectedRevision !== undefined) body.expectedRevision = expectedRevision
      return runMutation({ path: SAVE_PATH, body, pendingKey: key, pendingAction: 'save' })
    }),
    remove: (key, expectedRevision) => enqueue(async () => {
      const target = optionalText(key)
      if (target === undefined) throw new Error('remove requires a provider key')
      const revision = Number.isInteger(expectedRevision) ? expectedRevision : snapshot.revision
      const body = { key: target }
      if (revision !== undefined) body.expectedRevision = revision
      return runMutation({ path: DELETE_PATH, body, pendingKey: target, pendingAction: 'delete' })
    }),
    activate: (key, expectedRevision) => enqueue(async () => {
      const target = optionalText(key)
      if (target === undefined) throw new Error('activate requires a provider key')
      const revision = Number.isInteger(expectedRevision) ? expectedRevision : snapshot.revision
      const body = { key: target }
      if (revision !== undefined) body.expectedRevision = revision
      return runMutation({
        path: ACTIVATE_PATH,
        body,
        pendingKey: target,
        pendingAction: 'activate',
        patch: (response) => ({
          activation: {
            key: target,
            // Only an explicit `applied: false` means DSH did not take it; a
            // Host that omits the field succeeded.
            applied: response?.applied !== false,
            warnings: sanitizeWarnings(response?.warnings),
          },
        }),
      })
    }),
    dismissActivation: () => {
      publish({ ...snapshot, activation: undefined })
    },
    /**
     * Drop the previous attempt's failure before a new one begins.
     *
     * Without this, opening a second dialog after a rejected save greets the
     * user with the errors of the attempt they already abandoned — including
     * ones naming fields they have since fixed. The stored `saveErrors` outlive
     * the dialog that produced them, because the controller has no way to know
     * when a form closes.
     */
    clearSaveFeedback: () => {
      const wasFailed = snapshot.status === 'error' || snapshot.status === 'conflict';
      if (!wasFailed && snapshot.error === null && snapshot.conflict === false && snapshot.saveErrors.length === 0) {
        return;
      }
      publish({
        ...snapshot,
        // Back to `ready` only from a failed state: a dialog can only be opened
        // from a table that is on screen, so the read behind it did succeed.
        status: wasFailed ? 'ready' : snapshot.status,
        error: null,
        conflict: false,
        saveErrors: [],
      })
    },
  }
  return controller
}
