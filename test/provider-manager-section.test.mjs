// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The provider-manager tab, rendered for real.
 *
 * The tab's table is cc-switch's own `ProviderList`, so what is proven here is
 * the *seam*: that the section's header, banners and dialogs still work around
 * a component that reads react-query, portals its menu and brings its own
 * stylesheet — and that a click on that component's buttons reaches this
 * plugin's controller rather than stopping at the copied code.
 *
 * `ProviderList`'s own behaviour (the Added / Available split, row order, the
 * prefix on every class) is covered in `provider-list.test.mjs`; the modal's
 * contract is covered in `provider-manager-ui.test.mjs`. What only this file
 * can show is the two halves wired together.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'

import { bundleModule, render, setupDom, teardownDom } from './helpers/render.mjs'
import { createCCSwitchManagerController } from '../src/client/manager-controller.mjs'

after(() => teardownDom())

// i18next reads `localStorage.language` before it looks at the navigator.
await setupDom()
window.localStorage.setItem('language', 'zh')

const section = await bundleModule(
  'manager-section-dom',
  'export * from "../../src/ui/ProviderManagerSection.mjs";',
)
const { ProviderManagerSection } = section

const PROVIDERS_PATH = '/api/dsh-ccswitch-manager/providers'

/**
 * Point the *copied* layer's transport at a stub.
 *
 * The section reads its table through `useProvidersQuery`, which reaches the
 * backend with `invoke` and therefore a real `fetch` — the same call a browser
 * would make. The controller has its own injected `fetchImpl`, so it does not
 * need this; the point is that the seam runs all the way down to HTTP rather
 * than stopping at a mocked hook.
 */
function installApi(providers) {
  const envelope = {
    exists: true,
    revision: 7,
    order: Object.keys(providers),
    providers,
    apiProtocols: ['openai-completions', 'openai-responses', 'anthropic-messages'],
    appTypes: ['claude', 'codex'],
  }
  globalThis.fetch = async (url) => {
    const path = String(url)
    if (path.endsWith('/presets')) return jsonResponse({ presets: [] })
    if (path === PROVIDERS_PATH || path.startsWith(`${PROVIDERS_PATH}?`)) return jsonResponse(envelope)
    throw new Error(`unexpected request to ${path}`)
  }
  return envelope
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() { return body },
  }
}

function hostProvider(overrides = {}) {
  return {
    key: 'ccs-deepseek-ab12cd34',
    displayName: 'DeepSeek',
    api: 'anthropic-messages',
    baseURL: 'https://api.deepseek.com/anthropic',
    credential: 'found',
    models: [{ id: 'deepseek-flash' }],
    isCurrent: false,
    inUse: false,
    inFailoverQueue: false,
    ...overrides,
  }
}

function stubFetch(routes) {
  return async (url, init) => {
    const route = routes[url]
    if (route === undefined) throw new Error(`unexpected request to ${url}`)
    const result = typeof route === 'function' ? await route(init) : route
    return {
      ok: (result.status ?? 200) < 300,
      status: result.status ?? 200,
      async json() { return result.body },
    }
  }
}

/** A controller already holding `providers`, without a round trip. */
async function readyController(providers, extra = {}) {
  // Both halves read the same catalogue over HTTP — the controller through its
  // injected `fetchImpl`, the copied list through `invoke` — so both have to be
  // pointed at the same rows for the two to agree about what is rendered.
  installApi(providers)
  const fetchImpl = stubFetch({
    [PROVIDERS_PATH]: { body: {
      exists: true,
      revision: 7,
      order: Object.keys(providers),
      providers,
      apiProtocols: ['openai-completions', 'openai-responses', 'anthropic-messages'],
      appTypes: ['claude', 'codex'],
      ...(extra.body ?? {}),
    } },
    ...(extra.routes ?? {}),
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  return controller
}

const byText = (hand, label) => hand.all('button').find((node) => node.textContent.trim() === label)
const byLabel = (hand, label) => hand.labelled(label)[0]

test('the tab renders its own header over cc-switch\'s list', async () => {
  const controller = await readyController({
    'ccs-deepseek-ab12cd34': hostProvider({ inUse: true }),
  })
  const hand = await render(React.createElement(ProviderManagerSection, { controller }))

  // The shell is ours…
  assert.match(hand.text(), /供应商管理/)
  assert.ok(byText(hand, '刷新'), 'the header keeps its refresh control')
  // …and the table is the copied component's, with its own section headings.
  assert.match(hand.text(), /已添加 · 1/)
  assert.match(hand.text(), /可添加 · 0/)

  await hand.unmount()
})

test('a click on the copied list reaches this plugin\'s controller', async () => {
  const controller = await readyController({
    'ccs-idle-ab12cd34': hostProvider({ key: 'ccs-idle-ab12cd34', displayName: 'Idle', inUse: false }),
  })
  // The section calls the controller, not `invoke`, for membership — which is
  // what keeps the banners and the edit dialog's revision in step with the row
  // the user just clicked.
  const calls = []
  controller.apply = async (key) => { calls.push(['apply', key]) }
  controller.withdraw = async (key) => { calls.push(['withdraw', key]) }

  const hand = await render(React.createElement(ProviderManagerSection, { controller }))
  const add = byLabel(hand, '添加')
  assert.ok(add, 'the Available row rendered its Add control')
  await hand.click(add)
  assert.deepEqual(calls, [['apply', 'ccs-idle-ab12cd34']])

  await hand.unmount()
})

test('the header\'s add button opens a create dialog', async () => {
  const controller = await readyController({})
  const hand = await render(React.createElement(ProviderManagerSection, { controller }))

  const add = byText(hand, '新增 provider')
  assert.ok(add, 'the header offers a create control')
  await hand.click(add)

  // The modal is the plugin's own form, not a copied one, so it keeps its
  // Chinese title even though the list around it is upstream's.
  assert.match(hand.text(), /新增 provider/)
  assert.ok(hand.one('form'), 'the dialog rendered a form')

  await hand.unmount()
})

test('the card\'s ⋯ menu reaches the edit dialog for that row', async () => {
  const controller = await readyController({
    'ccs-deepseek-ab12cd34': hostProvider({ displayName: 'DeepSeek' }),
  })
  const hand = await render(React.createElement(ProviderManagerSection, { controller }))

  // Edit and delete live behind cc-switch's own overflow menu, so the seam is
  // only real if that menu opens here and its items land on our callbacks.
  const more = hand.all('[aria-label]').find((node) => node.getAttribute('aria-label')?.endsWith(' 的更多操作'))
  assert.ok(more, `no overflow control among ${JSON.stringify(hand.all('[aria-label]').map((n) => n.getAttribute('aria-label')))}`)
  await hand.click(more)

  const edit = hand.all('[aria-label]').find((node) => node.getAttribute('aria-label')?.startsWith('编辑 '))
  assert.ok(edit, 'the menu offered an edit item')
  await hand.click(edit)

  assert.match(hand.text(), /编辑 provider/)
  assert.ok(hand.one('form'), 'the edit dialog opened')

  await hand.unmount()
})
