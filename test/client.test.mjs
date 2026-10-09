// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerReasoningSettings, MODELS_FOOTER_SLOT } from '../src/client/registration.mjs'

test('mounts into the built-in footer seat without shadowing the models section', () => {
  const registrations = []
  const listeners = new Map()
  const ctx = {
    locale: { register: () => {} },
    slots: {
      inject: (name, factory) => { registrations.push({ name, entry: factory() }); return () => {} },
      register: (options, component) => ({ options, component }),
    },
    remote: {
      $on: (event, handler) => { listeners.set(event, handler); return () => listeners.delete(event) },
    },
  }
  const controller = { refreshes: 0, refresh() { this.refreshes += 1 } }
  const importer = { scans: 0, scan() { this.scans += 1 } }
  const dispose = registerReasoningSettings(ctx, { controller, importer, component: 'Component', t: () => '' })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].name, MODELS_FOOTER_SLOT)
  assert.equal(registrations[0].name, 'settings.models.footer')
  assert.equal(registrations[0].entry.options.id, 'ccswitch-importer')
  assert.equal(registrations[0].entry.options.priority, undefined)
  assert.equal(registrations[0].entry.options.inject().controller, controller)
  assert.equal(listeners.size, 4)
  listeners.get('settings/document-updated')()
  listeners.get('llm/adapters-updated')()
  listeners.get('credentials/record-updated')()
  listeners.get('credentials/reference-updated')()
  assert.equal(controller.refreshes, 2)
  assert.equal(importer.scans, 2)
  dispose()
  assert.equal(listeners.size, 0)
})
