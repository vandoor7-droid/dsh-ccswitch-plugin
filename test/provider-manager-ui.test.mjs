// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
//
// The manager tab is the first thing in this plugin that writes settings from
// the browser, so these tests care about what the user is actually told: a row
// per provider with its credential state, an empty state that distinguishes
// "nothing yet" from "no namespace", membership warnings that reach the screen,
// and a form that shows every validation problem at once instead of one save
// at a time.
//
// The components are rendered for real, through React's own dispatcher. There
// is no react-dom here and adding one is not worth it — but a component that
// throws on a shape the Host can actually send is a class of bug that no
// source-text assertion catches, so the tree is built rather than grepped.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import React from 'react'
import { createCCSwitchManagerController } from '../src/client/manager-controller.mjs'
// The section pulls in cc-switch's TypeScript components, which only a
// bundler can load — `@/` aliases, `.tsx`, the prefixed stylesheet. Its pure
// helpers are imported directly so the tests that only need those do not pay
// for a build.
import { bundleModule, setupDom, teardownDom } from './helpers/render.mjs'
import { presetOptionLabel } from '../src/ui/preset-option.mjs'
import {
  ProviderEditModal,
  draftFromPreset,
  draftFromProvider,
  draftSignature,
  draftToProvider,
  draftToSaveRequest,
  emptyDraft,
  numberField,
  validateDraft,
} from '../src/ui/ProviderEditModal.mjs'
import { MESSAGES } from '../src/client/messages.mjs'
import { PROVIDER_PRESETS, presetGroup, presetVersionKeys } from '../src/domain/presets.mjs'
import { MODELS_FOOTER_SLOT, PLUGINS_TAB_SLOT, registerReasoningSettings } from '../src/client/registration.mjs'

// Compiled rather than imported: the section reaches cc-switch's TypeScript
// components through the `@/` alias, which Node cannot resolve on its own.
const section = await bundleModule(
  'manager-section',
  'export * from "../../src/ui/ProviderManagerSection.mjs";',
)
const { ProviderManagerSection } = section

// The one context the fake renderer has to answer, so `useProvidersQuery` in
// the section does not throw. Queries are disabled: nothing here asserts on a
// round trip the section did not make itself.
const { QueryClient, QueryClientContext } = await import('@tanstack/react-query')
const sectionQueryClient = new QueryClient({
  defaultOptions: { queries: { enabled: false, retry: false } },
})

// `bundleModule` opens a jsdom window for the components that need one; the
// runner would otherwise report this file as a hang.
after(() => teardownDom())

const root = new URL('../', import.meta.url)
const read = (relative) => readFile(new URL(relative, root), 'utf8')

const INTERNALS = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED

// --- a minimal renderer ------------------------------------------------------
//
// Function components only, hooks backed by a per-instance array, refs handed a
// stand-in node. Enough to prove the components compose and to read what they
// render; deliberately not a DOM.

const FAKE_NODE = {
  querySelector: () => null,
  querySelectorAll: () => [],
  focus: () => {},
}

function makeDispatcher(hooks, effects, markDirty) {
  let index = 0
  const next = () => index++
  return {
    useState(initial) {
      const i = next()
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
      return [hooks[i], (value) => {
        hooks[i] = typeof value === 'function' ? value(hooks[i]) : value
        markDirty()
      }]
    },
    useReducer(reducer, initial) {
      const i = next()
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
      return [hooks[i], (action) => {
        hooks[i] = reducer(hooks[i], action)
        markDirty()
      }]
    },
    useRef(initial) {
      const i = next()
      if (!(i in hooks)) hooks[i] = { current: initial }
      return hooks[i]
    },
    useEffect(fn) {
      const i = next()
      if (!(i in hooks)) {
        hooks[i] = true
        effects.push(fn)
      }
    },
    useLayoutEffect(fn) { this.useEffect(fn) },
    useInsertionEffect(fn) { this.useEffect(fn) },
    useMemo(fn) {
      const i = next()
      if (!(i in hooks)) hooks[i] = fn()
      return hooks[i]
    },
    useCallback(fn) { next(); return fn },
    useId() {
      const i = next()
      if (!(i in hooks)) hooks[i] = `:r${i}:`
      return hooks[i]
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const i = next()
      try { subscribe(() => {}) } catch { /* a stubbed store may not support it */ }
      // Always re-read rather than caching: the whole point is that a store
      // change shows up on the next render.
      hooks[i] = getSnapshot()
      return hooks[i]
    },
    // `ProviderList` reads react-query's client from context, and
    // `useProvidersQuery` runs in the section itself. The harness has no
    // provider element to hang it on, so react-query's client is answered
    // directly — with fetching disabled, because these tests assert on what the
    // section draws from the controller, not on a network round trip.
    //
    // Every other context falls back to its own default. React only applies
    // `createContext(default)` when nothing above provides a value, and this
    // renderer never evaluates a provider, so the default has to be read off
    // the context itself — react-query's error-boundary context, for one,
    // dereferences it during the very first render.
    useContext(context) {
      next()
      if (context === QueryClientContext) return sectionQueryClient
      return context?._currentValue
    },
    useDeferredValue(value) { next(); return value },
    useTransition() { next(); return [false, (fn) => fn()] },
    useImperativeHandle() { next() },
    useDebugValue() {},
  }
}

function createHarness() {
  const hookStore = new Map()
  const cleanups = []
  let dirty = false

  /** Render one element tree. Re-renders reuse the same hook storage, so a
   *  `setState` from an event handler shows up in the next `render()` call. */
  function renderNode(element, keyPath) {
    if (element === null || element === undefined || typeof element === 'boolean') return null
    if (typeof element === 'string' || typeof element === 'number') {
      return { type: '#text', text: String(element), props: {}, children: [] }
    }
    if (Array.isArray(element)) {
      return {
        type: '#array',
        props: {},
        children: element.map((child, i) => renderNode(child, `${keyPath}[${i}]`)).filter(Boolean),
      }
    }
    const { type, props = {} } = element
    // React.createElement lifts `ref` off `props` and onto the element, so
    // reading it out of `props` would silently never fire.
    const ref = element.ref

    const assignRef = (value) => {
      if (typeof value === 'function') value(FAKE_NODE)
      else if (value && typeof value === 'object') value.current = FAKE_NODE
    }

    if (typeof type === 'function') {
      const key = `${keyPath}|${type.name || type.displayName || 'anon'}`
      let hooks = hookStore.get(key)
      if (!hooks) {
        hooks = []
        hookStore.set(key, hooks)
      }
      const effects = []
      const dispatcher = makeDispatcher(hooks, effects, () => { dirty = true })
      const previous = INTERNALS.ReactCurrentDispatcher.current
      INTERNALS.ReactCurrentDispatcher.current = dispatcher
      let output
      try {
        output = type(props)
      } finally {
        INTERNALS.ReactCurrentDispatcher.current = previous
      }
      const node = renderNode(output, key)
      // Refs are handed the stand-in so a component that reads one on mount
      // takes its real path instead of short-circuiting on null.
      assignRef(ref)
      for (const [name, value] of Object.entries(props)) {
        if (name === 'ref') assignRef(value)
      }
      for (const effect of effects) {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanups.push(cleanup)
      }
      return node
    }
    const node = {
      type,
      props,
      children: [],
    }
    // Refs on host elements are handed the stand-in too, so a component reading
    // one on mount takes its real path instead of short-circuiting on null.
    assignRef(ref)
    const rendered = renderNode(props.children ?? null, `${keyPath}/${type}`)
    // Normalize to an array: `props.children` is a single node when there is
    // one child, and a caller walking the tree should not have to care.
    node.children = Array.isArray(rendered) ? rendered : (rendered ? [rendered] : [])
    return node
  }

  return {
    /** Render, then re-render while any state changed during the pass. */
    render(element) {
      let tree
      let passes = 0
      do {
        dirty = false
        tree = renderNode(element, 'root')
        passes += 1
      } while (dirty && passes < 10)
      return tree
    },
    unmount() {
      for (const cleanup of cleanups.splice(0)) cleanup()
    },
  }
}

/** A stand-in `document`, so focus/keyboard effects can actually run. */
function withDocument(run) {
  const previous = globalThis.document
  const listeners = []
  globalThis.document = {
    listeners,
    activeElement: null,
    addEventListener: (event, handler) => listeners.push({ event, handler }),
    removeEventListener: (event, handler) => {
      const at = listeners.findIndex((entry) => entry.event === event && entry.handler === handler)
      if (at >= 0) listeners.splice(at, 1)
    },
  }
  try {
    return run(listeners)
  } finally {
    globalThis.document = previous
  }
}

// --- tree helpers ------------------------------------------------------------

function visit(node, fn) {
  if (!node) return
  fn(node)
  // `children` is a single node when there is one child, so it is not always
  // iterable.
  const children = Array.isArray(node.children) ? node.children : []
  for (const child of children) visit(child, fn)
}

function findAll(root, predicate) {
  const found = []
  visit(root, (node) => { if (predicate(node)) found.push(node) })
  return found
}

function byType(root, type) {
  return findAll(root, (node) => node.type === type)
}

/** Every text node in the subtree, joined — good enough to read a badge. */
function textOf(node) {
  let text = ''
  visit(node, (entry) => { if (entry.type === '#text') text += `${entry.text} ` })
  return text
}

/** The first element whose own text contains `needle`. */
function findByText(root, needle) {
  return findAll(root, (node) => node.type !== '#text' && textOf(node).includes(needle))[0]
}

/** The first button whose label contains `needle` — not an enclosing div. */
function buttonByText(root, needle) {
  return findAll(root, (node) => node.type === 'button' && textOf(node).includes(needle))[0]
}

// --- fixtures ----------------------------------------------------------------

const PROVIDERS_PATH = '/api/dsh-ccswitch-manager/providers'

function hostProvider(overrides = {}) {
  return {
    key: 'ccs-deepseek-ab12cd34',
    displayName: 'DeepSeek',
    api: 'anthropic-messages',
    baseURL: 'https://api.deepseek.com/anthropic',
    credential: 'found',
    models: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }],
    // `isCurrent` is inert provenance carried over from cc-switch's own DB
    // column; `inUse` is what the row's membership toggle is bound to, derived
    // by the Host from DSH's route table on every read.
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
  const fetchImpl = stubFetch({
    [PROVIDERS_PATH]: { body: {
      exists: true,
      revision: 7,
      order: Object.keys(providers),
      providers,
      apiProtocols: ['openai-completions', 'openai-responses', 'anthropic-messages'],
      ...(extra.body ?? {}),
    } },
    ...(extra.routes ?? {}),
  })
  const controller = createCCSwitchManagerController({ fetchImpl })
  await controller.refresh()
  return controller
}

const t = undefined // the components fall back to their own Chinese strings

// --- the membership banners --------------------------------------------------

test('the section surfaces the warnings an apply returned', async () => {
  const controller = await readyController(
    { 'ccs-deepseek-ab12cd34': hostProvider() },
    { routes: { [`${PROVIDERS_PATH}/apply`]: { body: {
      key: 'ccs-deepseek-ab12cd34',
      status: 'applied',
      warnings: ['llm-pi-ai is not installed, so DSH has no route to use it'],
    } } } },
  )
  await controller.apply('ccs-deepseek-ab12cd34')
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  const banner = findAll(tree, (node) => typeof node.props?.className === 'string'
    && node.props.className.split(' ').includes('dsh-ccswitch-manager__activation'))[0]
  assert.ok(banner, 'the membership banner rendered')
  const text = textOf(banner)
  // The warning is the whole reason the apply route returns a list: without it
  // the row would read "applied" while DSH had no route to reach it.
  assert.match(text, /llm-pi-ai is not installed/)
  // The headline names the provider and the action, from `notice.name`.
  assert.match(text, /已接入 DSH 的路由表：DeepSeek/)
  assert.match(text, /接入提示/)
  const items = byType(banner, 'li')
  assert.equal(items.length, 1, 'the warning list renders each entry')
  assert.match(textOf(items[0]), /llm-pi-ai is not installed/)

  // The dismiss control is bound to the controller's own clear, so the banner
  // cannot outlive the action it describes.
  const dismisses = []
  const dismissNotice = controller.dismissNotice
  controller.dismissNotice = () => { dismisses.push(1); dismissNotice() }
  const dismiss = buttonByText(banner, '知道了')
  assert.ok(dismiss, 'the banner offers a dismiss control')
  dismiss.props.onClick()
  assert.deepEqual(dismisses, [1], 'dismissing goes through controller.dismissNotice')
  const after = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  assert.equal(findAll(after, (node) => typeof node.props?.className === 'string'
    && node.props.className.split(' ').includes('dsh-ccswitch-manager__activation')).length, 0,
    'the banner is gone')
})

test('the section reports a withdraw with its own headline', async () => {
  const controller = await readyController(
    { 'ccs-deepseek-ab12cd34': hostProvider({ inUse: true }) },
    { routes: { [`${PROVIDERS_PATH}/withdraw`]: { body: {
      key: 'ccs-deepseek-ab12cd34',
      status: 'withdrawn',
      inCatalogue: true,
    } } } },
  )
  await controller.withdraw('ccs-deepseek-ab12cd34')
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  const banner = findAll(tree, (node) => typeof node.props?.className === 'string'
    && node.props.className.split(' ').includes('dsh-ccswitch-manager__activation'))[0]
  assert.ok(banner, 'the membership banner rendered')
  const text = textOf(banner)
  assert.match(text, /已从 DSH 的路由表移出 DeepSeek/)
  // A clean withdraw with nothing to warn about says only that much: the
  // warning heading is not a permanent fixture of the banner.
  assert.doesNotMatch(text, /接入提示/)

  // An orphan — a key the route table held that the catalogue never knew —
  // gets its own line, because only this tab could have produced one.
  const orphan = await readyController(
    { 'ccs-deepseek-ab12cd34': hostProvider({ inUse: true }) },
    { routes: { [`${PROVIDERS_PATH}/withdraw`]: { body: {
      key: 'ccs-deepseek-ab12cd34', status: 'withdrawn', inCatalogue: false,
    } } } },
  )
  await orphan.withdraw('ccs-deepseek-ab12cd34')
  const orphanTree = createHarness().render(React.createElement(ProviderManagerSection, { controller: orphan, t }))
  assert.match(textOf(orphanTree), /目录中并没有它/)
})

test('the section reports a revision conflict without inventing a row error', async () => {
  let revision = 7
  const controller = createCCSwitchManagerController({
    fetchImpl: stubFetch({
      [PROVIDERS_PATH]: () => ({ body: {
        exists: true, revision, order: ['ccs-deepseek-ab12cd34'],
        providers: { 'ccs-deepseek-ab12cd34': hostProvider() }, apiProtocols: [],
      } }),
      [`${PROVIDERS_PATH}/delete`]: () => {
        revision = 9
        return { status: 409, body: { error: 'the settings document changed; reload and retry' } }
      },
    }),
  })
  await controller.refresh()
  await controller.remove('ccs-deepseek-ab12cd34').catch(() => {})
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  // The conflict is a whole-table fact, so it is stated once at the top rather
  // than attached to the row the user happened to click.
  assert.match(textOf(tree), /设置文档已被其他地方改动/)
})

// --- the modal ---------------------------------------------------------------

test('the modal submits the revision it was opened at, so a concurrent edit is refused', async () => {
  const saves = []
  const controller = await readyController(
    { 'ccs-deepseek-ab12cd34': hostProvider() },
    { routes: { [`${PROVIDERS_PATH}/save`]: (init) => {
      saves.push(JSON.parse(init.body))
      return { body: { key: 'ccs-new-ab12cd34', status: 'created' } }
    } } },
  )
  // The form was opened against revision 7...
  const draft = { ...draftFromProvider(hostProvider()), apiKey: 'sk-typed' }
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderEditModal, {
    initialDraft: draft, mode: 'edit', protocols: ['anthropic-messages'],
    onSubmit: (value) => { void controller.save({ ...value, expectedRevision: controller.getSnapshot().revision }) },
    onClose: () => {},
    t,
  }))
  // ...and a background refresh moved the document before the user hit Save.
  await controller.refresh()
  const form = byType(tree, 'form')[0]
  assert.ok(form, 'the form rendered')
  form.props.onSubmit({ preventDefault() {} })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(saves.length, 1)
  // The revision travels with the body, which is what lets the Host refuse the
  // write instead of silently overwriting the newer document.
  assert.equal(saves[0].expectedRevision, 7)
  // A typed key is sent; the stored one never is.
  assert.equal(saves[0].apiKey, 'sk-typed')
  assert.equal(saves[0].key, 'ccs-deepseek-ab12cd34')
})

test('the modal renders every host validation error at once', () => {
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderEditModal, {
    initialDraft: draftFromProvider(hostProvider()),
    mode: 'edit',
    protocols: ['anthropic-messages'],
    errors: ['displayName is required', 'baseURL is not a URL', 'every model needs an id'],
    onSubmit: () => {},
    onClose: () => {},
    t,
  }))
  const alert = findAll(tree, (node) => node.props?.role === 'alert')[0]
  assert.ok(alert, 'the error region rendered')
  const items = byType(alert, 'li')
  // All three, not the first: revealing them one failed save at a time is the
  // behaviour this list exists to replace.
  assert.equal(items.length, 3)
  const text = textOf(alert)
  assert.match(text, /displayName is required/)
  assert.match(text, /baseURL is not a URL/)
  assert.match(text, /every model needs an id/)
})

test('the modal blocks a submit its own validation rejects, and does not call onSubmit', () => {
  let submitted = 0
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderEditModal, {
    initialDraft: emptyDraft(), // no name, no base URL, no model id
    mode: 'create',
    protocols: ['openai-completions'],
    onSubmit: () => { submitted += 1 },
    onClose: () => {},
    t,
  }))
  const form = byType(tree, 'form')[0]
  form.props.onSubmit({ preventDefault() {} })
  assert.equal(submitted, 0, 'an invalid form must not reach the save path')

  // The problems appear only after the attempt.
  const rerendered = harness.render(React.createElement(ProviderEditModal, {
    initialDraft: emptyDraft(),
    mode: 'create',
    protocols: ['openai-completions'],
    onSubmit: () => { submitted += 1 },
    onClose: () => {},
    t,
  }))
  const alert = findAll(rerendered, (node) => node.props?.role === 'alert')[0]
  assert.ok(alert, 'the local problems are shown after the attempt')
  assert.match(textOf(alert), /请填写名称/)
})

test('Escape closes the dialog and the listener is removed on unmount', () => {
  withDocument((listeners) => {
    let closed = 0
    const harness = createHarness()
    harness.render(React.createElement(ProviderEditModal, {
      initialDraft: draftFromProvider(hostProvider()),
      mode: 'edit',
      protocols: ['anthropic-messages'],
      onSubmit: () => {},
      onClose: () => { closed += 1 },
      t,
    }))
    const keydown = listeners.find((entry) => entry.event === 'keydown')
    assert.ok(keydown, 'the dialog installed a keydown handler')
    keydown.handler({ key: 'Escape', stopPropagation() {} })
    assert.equal(closed, 1)
    // A handler that outlives the dialog would close the settings panel on the
    // next Escape, from anywhere in the app.
    harness.unmount()
    assert.equal(listeners.filter((entry) => entry.event === 'keydown').length, 0)
  })
})

test('the dialog is properly named and modal', () => {
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderEditModal, {
    initialDraft: draftFromProvider(hostProvider()),
    mode: 'edit',
    protocols: ['anthropic-messages'],
    onSubmit: () => {},
    onClose: () => {},
    t,
  }))
  const dialog = findAll(tree, (node) => node.props?.role === 'dialog')[0]
  assert.ok(dialog, 'the dialog rendered')
  assert.equal(dialog.props['aria-modal'], 'true')
  // The accessible name points at a node that exists, or the dialog announces
  // itself as nothing.
  const titleId = dialog.props['aria-labelledby']
  assert.ok(typeof titleId === 'string' && titleId !== '')
  const heading = findAll(tree, (node) => node.props?.id === titleId)[0]
  assert.ok(heading, 'the labelled-by target exists')
  assert.match(textOf(heading), /编辑 provider/)

  // The key input is a password field, and it starts empty even though the
  // provider being edited has a stored credential.
  const password = byType(tree, 'input').filter((input) => input.props.type === 'password')
  assert.equal(password.length, 1)
  assert.equal(password[0].props.value, '')
})

// --- draft conversion --------------------------------------------------------

test('a stored key is never read back into the form', () => {
  const draft = draftFromProvider(hostProvider({
    // Even a Host that leaked one must not have it rendered.
    apiKey: 'sk-leaked',
    apiKeyEnv: 'DSH_CCSWITCH_AB12CD34_API_KEY',
  }))
  assert.equal(draft.apiKey, '')
  assert.equal(Object.hasOwn(draft, 'apiKeyEnv'), false)
})

test('draftFromProvider preserves fields the form does not edit', () => {
  const draft = draftFromProvider({
    key: 'k',
    displayName: 'X',
    api: 'anthropic-messages',
    baseURL: 'https://x.test',
    appType: 'claude',
    sourceProfileId: 'p1',
    isCurrent: true,
    costMultiplier: 1.5,
    limitDailyUsd: 0,
    limitMonthlyUsd: 20,
    models: [{ id: 'm', contextWindow: 200000, reasoningEfforts: { high: 'high' } }],
  })
  // A save replaces the whole record, so a field dropped here would be erased
  // from the stored provider.
  assert.equal(draft.appType, 'claude')
  assert.equal(draft.sourceProfileId, 'p1')
  assert.equal(draft.isCurrent, true)
  assert.equal(draft.costMultiplier, '1.5')
  // A limit of 0 is a real value, not "unset".
  assert.equal(draft.limitDailyUsd, '0')
  assert.deepEqual(draft.models[0].reasoningEfforts, { high: 'high' })
})

test('an edit form always opens with at least one model row', () => {
  assert.equal(draftFromProvider({ displayName: 'X', models: [] }).models.length, 1)
  assert.equal(draftFromProvider({ displayName: 'X' }).models.length, 1)
  assert.equal(emptyDraft().models.length, 1)
})

test('a preset starts a new provider and never carries a key', () => {
  const draft = draftFromPreset({
    key: 'deepseek-claude',
    displayName: 'DeepSeek',
    api: 'anthropic-messages',
    baseURL: 'https://api.deepseek.com/anthropic',
    models: ['deepseek-flash', 'deepseek-v4-pro', ''],
    appType: 'claude',
    icon: 'deepseek',
    iconColor: '#1E88E5',
  })
  assert.equal(draft.key, undefined)
  assert.equal(draft.displayName, 'DeepSeek')
  assert.deepEqual(draft.models.map((model) => model.id), ['deepseek-flash', 'deepseek-v4-pro'])
  const provider = draftToProvider(draft)
  // A key here would make the Host treat the save as an update to whatever
  // provider already holds it.
  assert.equal(Object.hasOwn(provider, 'apiKeyEnv'), false)
})

test('draftToProvider omits blank optionals rather than storing empty strings', () => {
  const provider = draftToProvider({
    displayName: '  X  ',
    api: 'openai-completions',
    baseURL: 'https://x.test/',
    notes: '',
    icon: '   ',
    costMultiplier: '',
    models: [{ id: ' m ', name: '', contextWindow: '', maxTokens: '4096' }],
  })
  assert.equal(provider.displayName, 'X')
  assert.equal(provider.baseURL, 'https://x.test/')
  // The settings layer diffs the projected form, so `""` round-tripping as a
  // present field would show up as a spurious edit on every save.
  assert.equal(Object.hasOwn(provider, 'notes'), false)
  assert.equal(Object.hasOwn(provider, 'icon'), false)
  assert.equal(Object.hasOwn(provider, 'costMultiplier'), false)
  assert.deepEqual(provider.models, [{ id: 'm', maxTokens: 4096 }])
})

test('draftToProvider drops model rows with no id', () => {
  const provider = draftToProvider({
    displayName: 'X',
    api: 'openai-completions',
    baseURL: 'https://x.test',
    models: [{ id: 'a' }, { id: '' }, { name: 'only a name' }, null, 'not a row', { id: 'b' }],
  })
  assert.deepEqual(provider.models.map((model) => model.id), ['a', 'b'])
})

test('validateDraft reports every problem, not just the first', () => {
  const problems = validateDraft(emptyDraft()).map((problem) => problem.code)
  assert.ok(problems.includes('displayName-required'))
  assert.ok(problems.includes('baseURL-required'))
  assert.ok(problems.includes('models-required'))
  // An empty `api` is its own problem, and the form defaults it to blank.
  assert.ok(problems.includes('api-required'))
})

test('validateDraft rejects an unparseable base URL and negative limits', () => {
  const problems = validateDraft({
    displayName: 'X',
    api: 'openai-completions',
    baseURL: 'not a url',
    costMultiplier: '-1',
    limitDailyUsd: 'abc',
    models: [{ id: 'm' }],
  }).map((problem) => problem.code)
  assert.ok(problems.includes('baseURL-invalid'))
  assert.ok(problems.includes('costMultiplier-invalid'))
  assert.ok(problems.includes('limitDailyUsd-invalid'))
})

test('validateDraft accepts a complete draft', () => {
  assert.deepEqual(validateDraft({
    displayName: 'X',
    api: 'anthropic-messages',
    baseURL: 'https://api.deepseek.com/anthropic',
    models: [{ id: 'deepseek-flash' }],
  }), [])
})

test('numberField distinguishes blank from zero and from garbage', () => {
  assert.equal(numberField(''), undefined)
  assert.equal(numberField('   '), undefined)
  assert.equal(numberField('0'), 0)
  assert.equal(numberField('12.5'), 12.5)
  assert.equal(numberField('abc'), undefined)
  assert.equal(numberField(undefined), undefined)
  assert.equal(numberField(null), undefined)
  assert.equal(numberField(3), 3)
})

test('draftToSaveRequest omits the apiKey and the key when there are none', () => {
  const request = draftToSaveRequest({
    displayName: 'X', api: 'openai-completions', baseURL: 'https://x.test', models: [{ id: 'm' }], apiKey: '',
  }, 7)
  assert.equal(Object.hasOwn(request, 'apiKey'), false)
  assert.equal(Object.hasOwn(request, 'key'), false)
  assert.equal(request.expectedRevision, 7)
})

// --- registration ------------------------------------------------------------

test('the manager registers into the plugins tab without disturbing the importer footer', () => {
  const registrations = []
  const listeners = new Map()
  const ctx = {
    locale: { register: () => {} },
    slots: {
      inject: (name, factory) => { registrations.push({ name, entry: factory() }); return () => {} },
      register: (options, component) => ({ options, component }),
    },
    remote: { $on: (event, handler) => { listeners.set(event, handler); return () => listeners.delete(event) } },
  }
  const controller = { refreshes: 0, refresh() { this.refreshes += 1 } }
  const importer = { scans: 0, scan() { this.scans += 1 } }
  const manager = { refreshes: 0, refresh() { this.refreshes += 1 } }
  const dispose = registerReasoningSettings(ctx, {
    controller,
    importer,
    manager,
    managerComponent: 'ManagerComponent',
    component: 'ImporterComponent',
    t: (key) => (key === 'manager.title' ? '供应商管理' : undefined),
  })

  assert.equal(registrations.length, 2, 'both panels register')
  const footer = registrations.find((entry) => entry.name === MODELS_FOOTER_SLOT)
  const tab = registrations.find((entry) => entry.name === PLUGINS_TAB_SLOT)
  assert.ok(footer, 'the importer footer still registers')
  assert.equal(footer.entry.options.id, 'ccswitch-importer')
  assert.equal(footer.entry.component, 'ImporterComponent')

  assert.ok(tab, 'the manager tab registers')
  assert.equal(PLUGINS_TAB_SLOT, 'settings.plugins.tab')
  assert.equal(tab.entry.options.id, 'ccswitch-manager')
  assert.equal(tab.entry.options.order, 20)
  // The tab title follows the locale, which means it is a thunk rather than a
  // string captured at registration time.
  assert.equal(typeof tab.entry.options.label, 'function')
  assert.equal(tab.entry.options.label(), '供应商管理')
  assert.equal(tab.entry.component, 'ManagerComponent')
  assert.equal(tab.entry.options.inject().controller, manager)

  // A settings write from anywhere refreshes both panels.
  listeners.get('settings/document-updated')()
  assert.equal(manager.refreshes, 1)
  dispose()
  assert.equal(listeners.size, 0)
})

test('no manager means no manager tab, and the importer keeps working', () => {
  const registrations = []
  const ctx = {
    locale: { register: () => {} },
    slots: {
      inject: (name, factory) => { registrations.push({ name, entry: factory() }); return () => {} },
      register: (options, component) => ({ options, component }),
    },
    remote: { $on: () => () => {} },
  }
  registerReasoningSettings(ctx, { controller: {}, importer: {}, component: 'ImporterComponent', t: () => '' })
  // A tab with no controller behind it would render an empty page.
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].name, MODELS_FOOTER_SLOT)
})

// --- the preset picker: CC Switch's groups and version labels ---------------

test('presetOptionLabel appends the version suffix CC Switch shows', () => {
  const tr = (_key, fallback) => fallback
  // Plan then region, joined with the same separator CC Switch's
  // `presetVersionLabel` uses.
  assert.equal(presetOptionLabel({ displayName: 'Kimi', planKey: 'payg', regionKey: 'cn' }, tr), 'Kimi · 按量付费 · 国内')
  assert.equal(presetOptionLabel({ displayName: 'Kimi', planKey: 'coding', regionKey: 'intl' }, tr), 'Kimi · 编程订阅 · 海外')
  // One dimension only.
  assert.equal(presetOptionLabel({ displayName: 'SiliconFlow', regionKey: 'cn' }, tr), 'SiliconFlow · 国内')
  assert.equal(presetOptionLabel({ displayName: '火山', planKey: 'agentPlan' }, tr), '火山 · Agent Plan')
  // Neither: the name alone, which is what CC Switch falls back to for a vendor
  // with no sibling version to be told apart from.
  assert.equal(presetOptionLabel({ displayName: 'DeepSeek' }, tr), 'DeepSeek')
  assert.equal(presetOptionLabel({ displayName: 'DeepSeek', planKey: '', regionKey: '' }, tr), 'DeepSeek')
  assert.equal(presetOptionLabel(undefined, tr), '')
})

test('the preset picker groups presets the way CC Switch sections its list', async () => {
  const controller = await readyController({ 'ccs-a-ab12cd34': hostProvider() }, {
    routes: {
      '/api/dsh-ccswitch-manager/presets': { body: { presets: [
        { key: 'deepseek-claude', displayName: 'DeepSeek', api: 'anthropic-messages', baseURL: 'https://api.deepseek.com/anthropic', models: ['deepseek-flash'], category: 'cn_official' },
        { key: 'openrouter-claude', displayName: 'OpenRouter', api: 'anthropic-messages', baseURL: 'https://openrouter.ai/api', models: ['x'], category: 'aggregator', isPartner: true },
      ] } },
    },
  })
  await controller.loadPresets()
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  const groups = byType(tree, 'optgroup')
  assert.deepEqual(groups.map((group) => group.props.label), ['模型厂商', '第三方平台'], 'one section per CC Switch group')
  const valuesIn = (group) => findAll(group, (node) => node.type === 'option').map((option) => option.props.value)
  assert.deepEqual(valuesIn(groups[0]), ['deepseek-claude'])
  assert.deepEqual(valuesIn(groups[1]), ['openrouter-claude'])
  // The blank entry stays outside the groups, and stays first: it is not a
  // vendor, and the select has to open on something.
  assert.equal(byType(tree, 'option')[0].props.value, '')
})

test('every group, plan and region key the picker can ask for exists in both locales', () => {
  // These three families are built from preset data rather than written as
  // literals, so the static `tr("…")` scan in test/i18n.test.mjs cannot see
  // them. Assert the real catalogue here instead.
  const keys = new Set()
  for (const preset of PROVIDER_PRESETS) {
    keys.add(`manager.group.${presetGroup(preset)}`)
    for (const key of presetVersionKeys(preset)) keys.add(key)
  }
  // Every key the vocabulary allows, not only the ones this catalogue happens
  // to use today: a newly tagged preset must not be able to render a raw key.
  for (const plan of ['payg', 'coding', 'codingPlan', 'agentPlan', 'tokenPlan', 'enterpriseLite', 'enterprisePro', 'stepPlan', 'aksk', 'apiKey']) {
    keys.add(`manager.plan.${plan}`)
  }
  for (const region of ['cn', 'intl']) keys.add(`manager.region.${region}`)
  for (const group of ['login', 'vendor', 'thirdparty', 'cloud', 'plugin']) keys.add(`manager.group.${group}`)

  const missing = []
  for (const key of keys) {
    for (const locale of ['zh', 'en']) {
      if (!Object.hasOwn(MESSAGES[locale], key)) missing.push(`${locale}: ${key}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('the picker distinguishes two versions of one vendor', async () => {
  // Rendering the bare display name twice would give the user two options they
  // cannot tell apart — which is the whole reason CC Switch appends a suffix.
  const controller = await readyController({ 'ccs-a-ab12cd34': hostProvider() }, {
    routes: {
      '/api/dsh-ccswitch-manager/presets': { body: { presets: [
        { key: 'kimi-claude', displayName: 'Kimi', api: 'anthropic-messages', baseURL: 'https://api.moonshot.cn/anthropic', models: ['kimi-k2.7-code'], family: 'kimi', planKey: 'payg', regionKey: 'cn', category: 'cn_official' },
        { key: 'kimi-coding', displayName: 'Kimi', api: 'anthropic-messages', baseURL: 'https://api.moonshot.cn/anthropic', models: ['kimi-k2.7-code'], family: 'kimi', planKey: 'coding', regionKey: 'intl', category: 'cn_official' },
      ] } },
    },
  })
  await controller.loadPresets()
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  const labels = byType(tree, 'option').map((option) => textOf(option).trim())
  assert.ok(labels.includes('Kimi · 按量付费 · 国内'), `labels were ${JSON.stringify(labels)}`)
  assert.ok(labels.includes('Kimi · 编程订阅 · 海外'), `labels were ${JSON.stringify(labels)}`)
})

/** The option values a `<select>` offers, flattened. */
function optionValues(select) {
  return (Array.isArray(select.props.children) ? select.props.children : [])
    .filter(Boolean)
    .map((option) => option.props.value)
}


// --- the app type control ----------------------------------------------------
//
// The field travelled through every draft builder but had no control, so a
// provider added by hand silently became a Claude Code provider: the Host
// defaults an absent app type to `claude`. It is now shown and editable.

test('a new provider names an app type instead of leaving it implied', () => {
  assert.equal(emptyDraft().appType, 'claude')
  // A stored provider that predates the field reads as the value the Host will
  // actually use, so the control never shows blank while the Host treats it as
  // claude.
  assert.equal(draftFromProvider({ displayName: 'X' }).appType, 'claude')
  assert.equal(draftFromProvider({ displayName: 'X', appType: '' }).appType, 'claude')
  assert.equal(draftFromProvider({ displayName: 'X', appType: 'codex' }).appType, 'codex')
  // A preset that names none is a Claude preset.
  assert.equal(draftFromPreset({ key: 'p', displayName: 'P' }).appType, 'claude')
  assert.equal(draftFromPreset({ key: 'p', displayName: 'P', appType: 'codex' }).appType, 'codex')
})

test('the app type survives the round trip to the wire shape', () => {
  const provider = draftToProvider({ ...emptyDraft(), displayName: 'X', appType: 'codex' })
  assert.equal(provider.appType, 'codex')
  // Omitted rather than sent empty when the form is blanked, so the Host falls
  // back rather than storing an unusable app type.
  const blank = draftToProvider({ ...emptyDraft(), displayName: 'X', appType: '' })
  assert.equal(Object.hasOwn(blank, 'appType'), false)
})

test('changing only the app type still counts as a change', () => {
  const base = draftFromProvider(hostProvider())
  assert.notEqual(draftSignature(base), draftSignature({ ...base, appType: 'codex' }))
})

test('the modal offers the Host app-type list and sends the chosen one', () => {
  const submitted = []
  const props = {
    initialDraft: draftFromProvider(hostProvider()),
    mode: 'edit',
    protocols: ['anthropic-messages'],
    appTypes: ['claude', 'codex'],
    onSubmit: (value) => submitted.push(value),
    onClose: () => {},
    t,
  }
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderEditModal, props))

  const appSelect = byType(tree, 'select').find((select) => optionValues(select).includes('codex'))
  assert.ok(appSelect, 'the app-type select rendered')
  // Its options come from the Host list, not a second copy in the browser.
  assert.deepEqual(optionValues(appSelect), ['claude', 'codex'])

  // Choosing one and saving carries it to the Host. The re-render reuses the
  // component's hook storage, so the draft the form now holds is the edited one.
  appSelect.props.onChange({ target: { value: 'codex' } })
  const rebuilt = harness.render(React.createElement(ProviderEditModal, props))
  byType(rebuilt, 'form')[0].props.onSubmit({ preventDefault() {} })
  assert.equal(submitted.length, 1)
  assert.equal(submitted[0].appType, 'codex')
})

test('every manager class the components use is defined in the stylesheet', async () => {
  // Derived from the sources rather than listed by hand: a hand list only ever
  // covers the classes someone remembered to add to it, which is how
  // `__app-type`, `__protocol`, `__preset-label` and `__search` shipped with no
  // rule at all. `dsh-ccswitch-form__*` and `dsh-ccswitch-import__*` are skipped
  // because they belong to the import panel and the edit form, whose coverage is
  // asserted in `ui-fixes.test.mjs`.
  const files = ['src/ui/ProviderManagerSection.mjs']
  const used = new Set()
  const defined = new Set()
  for (const file of files) {
    const text = await read(file)
    for (const [, name] of text.matchAll(/"?(dsh-ccswitch-manager__[a-z-]+)"?/g)) used.add(name)
  }
  const css = await read('src/client/styles.mjs')
  for (const [, name] of css.matchAll(/\.(dsh-ccswitch-manager__[a-z-]+)/g)) defined.add(name)

  const missing = [...used].filter((name) => !defined.has(name)).sort()
  assert.deepEqual(missing, [], `styles.mjs is missing a rule for: ${missing.join(', ')}`)

  // The reverse direction is not an error — a modifier like `__row--applied` is
  // built by concatenation and never appears as a bare literal — but a rule
  // nothing can ever apply is dead weight, so the handful of them that do come
  // from concatenation are named here.
  const concatenated = new Set([
    'dsh-ccswitch-manager__row--applied',
    'dsh-ccswitch-manager__activation--warn',
  ])
  const unused = [...defined].filter((name) => !used.has(name) && !concatenated.has(name)).sort()
  assert.deepEqual(unused, [], `styles.mjs rules nothing applies: ${unused.join(', ')}`)
})

test('a stored app type the Host no longer offers is still selectable', () => {
  // Opening the form on an imported provider of another app type must not
  // rewrite it to the first listed entry just because a save round-trips what
  // the form shows.
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderEditModal, {
    initialDraft: { ...draftFromProvider(hostProvider()), appType: 'gemini' },
    mode: 'edit',
    protocols: ['anthropic-messages'],
    appTypes: ['claude', 'codex'],
    onSubmit: () => {},
    onClose: () => {},
    t,
  }))
  const appSelect = byType(tree, 'select')[1]
  assert.ok(optionValues(appSelect).includes('gemini'), 'the stored value is offered alongside the Host list')
})
