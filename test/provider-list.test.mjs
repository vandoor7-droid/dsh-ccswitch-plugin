// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * cc-switch's own list, rendered against this plugin's data.
 *
 * This is the acceptance test for M1's list half: the component is copied
 * verbatim from cc-switch, and what is proven here is that it still behaves
 * like the upstream one when fed a projected catalogue — the `Added` /
 * `Available` split from our membership, the row order from the catalogue
 * order, the Add/Remove buttons calling back with the right row, and every
 * class name carrying the `dsh-ccs-` prefix the style pipeline adds.
 *
 * It renders in jsdom rather than against a hand-rolled element tree, because
 * `ProviderList` portals its search panel, subscribes to react-query and
 * binds ⌘F — none of which a fake renderer exercises.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'

import { bundleModule, render, setupDom, teardownDom } from './helpers/render.mjs'
import { toCardProviders } from '../src/client/provider-shape.mjs'

// jsdom's animation loop keeps the process alive; without this the runner
// reports the file as a hang rather than as a finished suite.
after(() => teardownDom())

const ENTRY = `
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n";
import { ProviderList } from "@/components/providers/ProviderList";

export function list({ providers, callbacks }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return React.createElement(
    QueryClientProvider,
    { client },
    React.createElement(ProviderList, Object.assign({
      providers,
      currentProviderId: "",
      appId: "mcode",
      isLoading: false,
      onOpenWebsite() {},
      onCreate() {},
    }, callbacks))
  );
}
`

const RECORDS = {
  'ccs-deepseek-11111111': {
    displayName: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/anthropic',
    category: 'thirdparty',
    notes: 'first',
    inUse: false,
    createdAt: 1728000000000,
  },
  'ccs-moonshot-22222222': {
    displayName: 'Moonshot',
    baseURL: 'https://api.moonshot.cn',
    category: 'thirdparty',
    inUse: true,
    createdAt: 1728000001000,
  },
}

// i18next reads `localStorage.language` before it looks at the navigator, so
// pinning it here makes every string below deterministic instead of depending
// on whatever locale the machine running the suite happens to report.
await setupDom()
window.localStorage.setItem('language', 'zh')
const mod = await bundleModule('provider-list', ENTRY)

const ORDER = ['ccs-moonshot-22222222', 'ccs-deepseek-11111111']

function rows(order = ORDER) {
  return toCardProviders(RECORDS, order)
}

test('a catalogue row that is not applied lands in Available with an Add button', async () => {
  const called = []
  const hand = await render(mod.list({
    providers: rows(),
    callbacks: { onSwitch: (row) => called.push(['switch', row.id]) },
  }))

  assert.match(hand.text(), /可添加 · 1/)
  assert.match(hand.text(), /已添加 · 1/)

  const add = hand.labelled('添加')[0]
  assert.ok(add, `no Add button among ${JSON.stringify(hand.all('[aria-label]').map((n) => n.getAttribute('aria-label')).slice(0, 12))}`)
  await hand.click(add)
  assert.deepEqual(called, [['switch', 'ccs-deepseek-11111111']])
  await hand.unmount()
})

test('an applied row lands in Added with a Remove button', async () => {
  const called = []
  const hand = await render(mod.list({
    providers: rows(),
    callbacks: { onRemoveFromConfig: (row) => called.push(['remove', row.id]) },
  }))

  const remove = hand.labelled('移除')[0]
  assert.ok(remove, `no Remove button among ${JSON.stringify(hand.all('[aria-label]').map((n) => n.getAttribute('aria-label')).slice(0, 12))}`)
  await hand.click(remove)
  assert.deepEqual(called, [['remove', 'ccs-moonshot-22222222']])
  await hand.unmount()
})

test('membership is read from the record, so withdrawing one moves it between sections', async () => {
  const flipped = toCardProviders(
    { ...RECORDS, 'ccs-deepseek-11111111': { ...RECORDS['ccs-deepseek-11111111'], inUse: true } },
    ORDER,
  )
  const hand = await render(mod.list({ providers: flipped, callbacks: {} }))
  assert.match(hand.text(), /已添加 · 2/)
  assert.match(hand.text(), /可添加 · 0/)
  await hand.unmount()
})

test('rows appear in the catalogue order, which is also the failover priority', async () => {
  const hand = await render(mod.list({ providers: rows(), callbacks: {} }))
  const text = hand.text()
  const first = text.indexOf('Moonshot')
  const second = text.indexOf('DeepSeek')
  assert.ok(first >= 0 && second >= 0, 'both rows rendered')
  assert.ok(first < second, `expected Moonshot before DeepSeek in ${JSON.stringify(text.slice(0, 200))}`)
  await hand.unmount()
})

test('every utility Tailwind generated is namespaced on the rendered DOM', async () => {
  // The right question is not "does every class start with `dsh-ccs-`" —
  // variants come first (`hover:dsh-ccs-bg-subtle`) and some classes are not
  // Tailwind's at all (`lucide`, `lucide-grip-vertical`). It is "is any class
  // here one Tailwind would have *defined unprefixed*?" An unprefixed utility
  // in DSH's document is exactly what the whole pipeline exists to prevent.
  const { candidates } = await import('../scripts/ccswitch-style.mjs')
  const utilities = await candidates()
  const hand = await render(mod.list({ providers: rows(), callbacks: {} }))
  const classNames = [...hand.all('[class]')]
    .flatMap((node) => node.getAttribute('class').split(/\s+/))
    .filter((name) => name !== '')
  assert.ok(classNames.length > 20, `expected a styled tree, got ${classNames.length} classes`)
  const leaked = classNames.filter((name) => utilities.has(name))
  assert.deepEqual(
    leaked, [],
    `these classes are defined unprefixed and would apply to DSH: ${leaked.slice(0, 10).join(', ')}`,
  )
  // …and the tree really is styled, so an empty result cannot pass by having
  // rendered nothing.
  assert.ok(
    classNames.some((name) => name.startsWith('dsh-ccs-') || name.includes(':dsh-ccs-')),
    'expected at least one prefixed class',
  )
  await hand.unmount()
})

test('the card shows the endpoint, which only exists in the synthesized config', async () => {
  // `extractApiUrl` prefers `notes`, then `websiteUrl`, then
  // `extractProviderBaseUrl(settingsConfig)` — and this plugin stores neither
  // notes nor a website for that row, so the URL below can only have come from
  // the synthesized blob. If the projection ever stops carrying the endpoint,
  // the card's second line goes blank rather than throwing, which is exactly
  // the failure worth catching here.
  const hand = await render(mod.list({ providers: rows(), callbacks: {} }))
  assert.match(hand.text(), /https:\/\/api\.moonshot\.cn/)
  await hand.unmount()
})
