// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createReasoningSettingsController } from '../src/client/controller.mjs'

// 0.2.0 remote shape: calls resolve to { ok: true, value } | { ok: false, error }.
const namespace = (revision, wire = 'low') => ({
  ok: true,
  value: {
    writable: true,
    namespaces: [{ ns: 'llm-pi-ai', revision, value: {
      providers: { route: { models: [{ id: 'model', reasoningEfforts: { low: wire } }] } },
    } }],
  },
})

test('save sends the editor baseline revision and returns refreshed snapshot', async () => {
  const describes = [namespace(3), namespace(4, 'custom-low')]
  const mutations = []
  const controller = createReasoningSettingsController({
    settings: {
      describe: async () => describes.shift(),
      mutate: async (ns, ops, expectedRevision) => { mutations.push({ ns, ops, expectedRevision }); return { ok: true } },
    },
  })
  await controller.refresh()
  const result = await controller.save('route', 'model', 'enabled', { low: 'custom-low' }, 2)
  assert.equal(mutations[0].ns, 'llm-pi-ai')
  assert.equal(mutations[0].expectedRevision, 2)
  assert.equal(result.revision, 4)
  assert.equal(result.providers.route.models[0].reasoningEfforts.low, 'custom-low')
})

test('serializes saves so a later mutation waits for the earlier refresh', async () => {
  const describes = [namespace(3), namespace(4, 'first'), namespace(5, 'second')]
  const mutations = []
  let releaseFirst
  const firstMutation = new Promise((resolve) => { releaseFirst = resolve })
  const controller = createReasoningSettingsController({
    settings: {
      describe: async () => describes.shift(),
      mutate: async (ns, ops, expectedRevision) => {
        mutations.push({ ns, ops, expectedRevision })
        if (mutations.length === 1) await firstMutation
        return { ok: true }
      },
    },
  })
  await controller.refresh()
  const first = controller.save('route', 'model', 'enabled', { low: 'first' }, 3)
  const second = controller.save('route', 'model', 'enabled', { low: 'second' })
  await Promise.resolve()
  assert.equal(mutations.length, 1)
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(mutations.map((entry) => entry.expectedRevision), [3, 4])
})

test('conflict response triggers a refresh and throws', async () => {
  const describes = [namespace(3), namespace(9, 'remote-low')]
  const controller = createReasoningSettingsController({
    settings: {
      describe: async () => describes.shift(),
      mutate: async () => ({ ok: false, error: { code: 'settings/conflict', message: 'revision moved' } }),
    },
  })
  await controller.refresh()
  await assert.rejects(
    () => controller.save('route', 'model', 'enabled', { low: 'x' }, 2),
    /settings conflict/,
  )
  assert.equal(controller.getSnapshot().revision, 9)
})
