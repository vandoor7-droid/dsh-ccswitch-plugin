// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { reasoningStateForModel } from '../domain/validation.mjs'

export function draftForModel(model) {
  if (model.reasoningEfforts === false) return { mode: 'disabled', efforts: {} }
  if (model.reasoningEfforts && typeof model.reasoningEfforts === 'object') {
    return { mode: 'enabled', efforts: { ...model.reasoningEfforts } }
  }
  const inferred = reasoningStateForModel(model.id)
  return { mode: inferred.mode, efforts: { ...(inferred.efforts ?? {}) } }
}

export function draftSignature(draft) {
  const efforts = Object.entries(draft.efforts ?? {}).sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify([draft.mode, efforts])
}

export function reconcileDraft({ draft, baseline, baselineRevision, remoteModel, remoteRevision, remoteChanged }) {
  const remoteDraft = draftForModel(remoteModel)
  const remoteSignature = draftSignature(remoteDraft)
  const baselineSignature = draftSignature(baseline)
  const draftIsClean = draftSignature(draft) === baselineSignature
  if (remoteSignature === baselineSignature) {
    return { draft, baseline, baselineRevision: remoteRevision, remoteChanged: false }
  }
  if (draftIsClean) {
    return { draft: remoteDraft, baseline: remoteDraft, baselineRevision: remoteRevision, remoteChanged: false }
  }
  return { draft, baseline, baselineRevision, remoteChanged: true }
}

export function rebaseDraft({ draft, savedModel, savedRevision }) {
  const baseline = draftForModel(savedModel)
  return { draft, baseline, baselineRevision: savedRevision, remoteChanged: false }
}

export function reloadDraft({ remoteModel, remoteRevision }) {
  const next = draftForModel(remoteModel)
  return { draft: next, baseline: next, baselineRevision: remoteRevision, remoteChanged: false }
}
