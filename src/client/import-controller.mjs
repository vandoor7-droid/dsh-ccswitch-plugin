// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
function defaultFetch(url, init) {
  return globalThis.fetch(url, init)
}

// The Host accepts this header in place of an `Origin` header, which a browser
// is free to omit on a same-origin POST — exactly how "Test connection" turned
// into `missing Origin`. A cross-site page cannot send it: a custom header
// forces a CORS preflight that the Host never answers.
const SAME_ORIGIN_HEADER = 'x-dsh-ccswitch-origin'
const SAME_ORIGIN_VALUE = 'same-origin'

/** Headers for every state-changing request; see SAME_ORIGIN_HEADER above. */
function writeHeaders() {
  return { 'content-type': 'application/json', [SAME_ORIGIN_HEADER]: SAME_ORIGIN_VALUE }
}

function importable(profile) {
  return profile.status !== 'blocked' && profile.credential === 'found'
}

const PROBE_REASONS = new Set(['ok', 'empty', 'http-error', 'timeout', 'network', 'no-credentials'])
const PROBE_CHECKS = new Set(['models', 'minimal', 'none'])

/** A 401/404 out of the probe *route* means the Host half is older than the UI. */
function isStaleHost(message) {
  return /HTTP\s*40[14]\b/.test(message) || /unauthorized/i.test(message)
}

/** Counts and durations are clamped, not trusted: the Host could be anything. */
function probeNumber(value) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, 600000) : 0
}

/** Trust only the probe fields we render; anything odd degrades to a failure. */
function sanitizeProbe(result) {
  return {
    ok: result?.ok === true,
    reason: PROBE_REASONS.has(result?.reason) ? result.reason : 'network',
    check: PROBE_CHECKS.has(result?.check) ? result.check : 'none',
    httpStatus: Number.isInteger(result?.httpStatus) && result.httpStatus > 0 && result.httpStatus < 1000
      ? result.httpStatus
      : undefined,
    detail: typeof result?.detail === 'string' ? result.detail.slice(0, 200) : undefined,
    latencyMs: probeNumber(result?.latencyMs),
    discoveredCount: probeNumber(result?.discoveredCount),
    addedCount: probeNumber(result?.addedCount),
    modelCount: probeNumber(result?.modelCount),
    message: typeof result?.message === 'string' ? result.message.slice(0, 300) : '',
  }
}

/** Drop probe verdicts for rows that are no longer in the list. */
function pruneProbes(probes, profiles) {
  const ids = new Set(profiles.map((profile) => profile.profileId))
  const next = {}
  for (const [id, value] of Object.entries(probes ?? {})) {
    if (ids.has(id)) next[id] = value
  }
  return next
}

export function createCCSwitchImportController({
  fetchImpl = defaultFetch,
  getRevision = () => undefined,
  onImported = () => {},
} = {}) {
  let snapshot = {
    phase: 'idle',
    profiles: [],
    selectedIds: [],
    results: [],
    probes: {},
    error: null,
    source: undefined,
    probedPath: undefined,
  }
  const listeners = new Set()
  const publish = (next) => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const request = async (url, init) => {
    const response = await fetchImpl(url, init)
    let body
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
    return body ?? {}
  }
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setSelectedIds: (selectedIds) => {
      publish({ ...snapshot, selectedIds: [...new Set(selectedIds.filter((id) => typeof id === 'string'))] })
    },
    toggleSelected: (profileId) => {
      const selected = new Set(snapshot.selectedIds)
      if (selected.has(profileId)) selected.delete(profileId)
      else selected.add(profileId)
      controller.setSelectedIds([...selected])
    },
    selectAll: () => {
      controller.setSelectedIds(snapshot.profiles.filter(importable).map((profile) => profile.profileId))
    },
    selectNone: () => {
      controller.setSelectedIds([])
    },
    toggleSelectAll: () => {
      const importableIds = snapshot.profiles.filter(importable).map((profile) => profile.profileId)
      const allSelected = importableIds.length > 0 && importableIds.every((id) => snapshot.selectedIds.includes(id))
      if (allSelected) controller.selectNone()
      else controller.selectAll()
    },
    clearResults: () => {
      publish({ ...snapshot, results: [] })
    },
    /**
     * Test one row's endpoint without importing anything: the Host only reads
     * `{baseURL}/models`, so this never touches settings or credentials.
     */
    probeOne: async (profileId) => {
      const profile = snapshot.profiles.find((item) => item.profileId === profileId)
      if (!profile || !importable(profile)) return undefined
      if (snapshot.probes?.[profileId]?.phase === 'testing') return undefined
      const setProbe = (value) => {
        publish({ ...snapshot, probes: { ...snapshot.probes, [profileId]: value } })
      }
      setProbe({ phase: 'testing' })
      try {
        const body = await request('/api/dsh-ccswitch/probe', {
          method: 'POST',
          headers: writeHeaders(),
          body: JSON.stringify({ profileIds: [profileId] }),
        })
        const results = Array.isArray(body.results) ? body.results : []
        const result = results.find((item) => item.profileId === profileId) ?? results[0]
        if (!result) {
          setProbe({ phase: 'error', message: '', staleHost: false })
          return undefined
        }
        setProbe({ phase: 'done', ...sanitizeProbe(result) })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setProbe({ phase: 'error', message, staleHost: isStaleHost(message) })
        return undefined
      }
    },
    /**
     * `keepResults` is for the refresh that follows an import: the report the
     * user is reading must survive, otherwise the rows that were just imported
     * still show "ready to import" while the summary of what happened vanishes.
     * A user-initiated scan starts a new report instead.
     */
    scan: async (options = {}) => {
      const keepResults = options?.keepResults === true
      publish({
        ...snapshot,
        phase: 'loading',
        error: null,
        results: keepResults ? snapshot.results : [],
      })
      try {
        const body = await request('/api/dsh-ccswitch/scan')
        const profiles = Array.isArray(body.profiles) ? body.profiles : []
        const selectedIds = profiles.filter(importable).map((profile) => profile.profileId)
        // Carry the empty-scan reason so the UI can say *why* there is nothing
        // to import instead of showing one generic message.
        publish({
          phase: 'ready',
          profiles,
          selectedIds,
          results: keepResults ? snapshot.results : [],
          probes: pruneProbes(snapshot.probes, profiles),
          error: null,
          source: typeof body.source === 'string' ? body.source : undefined,
          probedPath: typeof body.probedPath === 'string' ? body.probedPath : undefined,
        })
        return snapshot
      } catch (error) {
        publish({ ...snapshot, phase: 'error', error: error instanceof Error ? error.message : String(error) })
        throw error
      }
    },
    importSelected: async () => {
      publish({ ...snapshot, phase: 'importing', error: null })
      try {
        const body = await request('/api/dsh-ccswitch/import', {
          method: 'POST',
          headers: writeHeaders(),
          body: JSON.stringify({ profileIds: snapshot.selectedIds, expectedRevision: getRevision() }),
        })
        const results = Array.isArray(body.results) ? body.results : []
        publish({ ...snapshot, phase: 'done', results, error: null })
        // The Host write already succeeded. Refreshing the settings snapshot is
        // best-effort: if it fails it reports its own error in the reasoning
        // panel, and it must not turn a completed import into a red banner here
        // that hides the per-row report the user actually needs.
        try {
          await onImported(results)
        } catch {
          // The import report published above is the source of truth.
        }
        return snapshot
      } catch (error) {
        publish({ ...snapshot, phase: 'error', error: error instanceof Error ? error.message : String(error) })
        throw error
      }
    },
  }
  return controller
}
