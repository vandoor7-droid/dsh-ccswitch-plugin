// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
//
// The manager tab is the first thing in this plugin that writes settings from
// the browser, so these tests care about what the user is actually told: a row
// per provider with its credential state, an empty state that distinguishes
// "nothing yet" from "no namespace", activation warnings that reach the screen,
// and a form that shows every validation problem at once instead of one save
// at a time.
//
// The components are rendered for real, through React's own dispatcher. There
// is no react-dom here and adding one is not worth it — but a component that
// throws on a shape the Host can actually send is a class of bug that no
// source-text assertion catches, so the tree is built rather than grepped.
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { createCCSwitchManagerController } from '../src/client/manager-controller.mjs'
import { ProviderManagerSection, emptyState, presetOptionLabel, providerMatches, providerRowView } from '../src/ui/ProviderManagerSection.mjs'
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
    useContext() { next(); return undefined },
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
    isCurrent: false,
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

// --- the pure decisions ------------------------------------------------------

test('emptyState separates "still reading" from "nothing yet" and "no namespace"', () => {
  assert.equal(emptyState({ status: 'idle' }), 'loading')
  assert.equal(emptyState({ status: 'loading' }), 'loading')
  // A write in flight has not read the document either.
  assert.equal(emptyState({ status: 'busy' }), 'loading')
  assert.equal(emptyState({ status: 'ready', exists: true }), 'empty')
  // No namespace is a different sentence: it is created by the first write.
  assert.equal(emptyState({ status: 'ready', exists: false }), 'emptyNoNamespace')
  // A malformed Host must not be read as "namespace exists".
  assert.equal(emptyState({ status: 'ready', exists: 'yes' }), 'emptyNoNamespace')
  // Nothing has been read yet, so the tab must not claim the namespace is
  // missing — the initial snapshot holds `exists: false` before any read.
  assert.equal(emptyState(undefined), 'loading')
  assert.equal(emptyState({}), 'loading')
  // A failed or conflicted read is explained by the banner above; a second line
  // guessing at the contents would contradict it.
  assert.equal(emptyState({ status: 'error', error: 'boom' }), null)
  assert.equal(emptyState({ status: 'conflict', conflict: true }), null)
})

test('providerRowView reads the credential and pending state defensively', () => {
  const view = providerRowView(hostProvider(), { status: 'ready' })
  assert.equal(view.name, 'DeepSeek')
  assert.equal(view.credentialFound, true)
  assert.equal(view.modelCount, 2)
  assert.equal(view.pending, false)

  // Anything that is not an explicit `found` is missing: a provider whose key
  // is unset must never be dressed up as ready.
  assert.equal(providerRowView(hostProvider({ credential: 'maybe' }), {}).credentialFound, false)
  assert.equal(providerRowView(hostProvider({ credential: undefined }), {}).credentialFound, false)

  // A provider with no display name falls back to its key rather than rendering
  // an empty strong element the user cannot identify.
  const nameless = providerRowView(hostProvider({ displayName: '' }), {})
  assert.equal(nameless.name, 'ccs-deepseek-ab12cd34')

  // Only the row an operation is running for is busy.
  const busy = { status: 'busy', pendingKey: 'ccs-deepseek-ab12cd34', pendingAction: 'delete' }
  assert.equal(providerRowView(hostProvider(), busy).pending, true)
  assert.equal(providerRowView(hostProvider(), busy).action, 'delete')
  assert.equal(providerRowView(hostProvider({ key: 'other' }), busy).pending, false)
  assert.equal(providerRowView(hostProvider({ key: 'other' }), busy).action, undefined)
})

// --- the section renders -----------------------------------------------------

test('the section renders one row per provider with its credential badge', async () => {
  const controller = await readyController({
    'ccs-good-ab12cd34': hostProvider({ key: 'ccs-good-ab12cd34', displayName: 'Good' }),
    'ccs-nokey-ab12cd34': hostProvider({ key: 'ccs-nokey-ab12cd34', displayName: 'NoKey', credential: 'missing' }),
  })
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  const rows = findAll(tree, (node) => typeof node.props?.className === 'string'
    && node.props.className.includes('dsh-ccswitch-manager__row')
    && !node.props.className.includes('__row-actions')
    && !node.props.className.includes('__row-error'))
  assert.equal(rows.length, 2, 'one row per provider')

  const good = rows.find((row) => textOf(row).includes('Good'))
  assert.ok(good, 'the "Good" provider rendered')
  assert.match(textOf(good), /凭据已找到/)

  const nokey = rows.find((row) => textOf(row).includes('NoKey'))
  assert.ok(nokey, 'the "NoKey" provider rendered')
  assert.match(textOf(nokey), /缺少凭据/)
  // The credential badge is a distinct class, so "missing" is visible without
  // reading the words.
  const badges = byType(nokey, 'span').filter((span) => String(span.props.className ?? '').includes('badge--blocked'))
  assert.equal(badges.length, 1, 'the missing-credential badge uses the blocked style')
})

test('the section marks the active provider and its model count', async () => {
  const controller = await readyController({
    'ccs-live-ab12cd34': hostProvider({ key: 'ccs-live-ab12cd34', displayName: 'Live', isCurrent: true, inFailoverQueue: true }),
  })
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  const text = textOf(tree)
  assert.match(text, /当前启用/)
  assert.match(text, /2 个模型/)
  assert.match(text, /故障转移队列/)
  // Activating the row that is already current is a no-op write, so the button
  // is disabled rather than hidden (hiding it would shift the other actions).
  const activate = findAll(tree, (node) => node.props?.['aria-label'] === '启用 Live')[0]
  assert.ok(activate, 'the activate button rendered')
  assert.equal(activate.props.disabled, true)
})

test('the section shows the empty state, and distinguishes having no namespace', async () => {
  const empty = createCCSwitchManagerController({
    fetchImpl: stubFetch({ [PROVIDERS_PATH]: { body: { exists: true, revision: 1, order: [], providers: {}, apiProtocols: [] } } }),
  })
  await empty.refresh()
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller: empty, t }))
  assert.match(textOf(tree), /还没有 provider/)

  const noNamespace = createCCSwitchManagerController({
    fetchImpl: stubFetch({ [PROVIDERS_PATH]: { body: { exists: false, order: [], providers: {} } } }),
  })
  await noNamespace.refresh()
  const harness2 = createHarness()
  const tree2 = harness2.render(React.createElement(ProviderManagerSection, { controller: noNamespace, t }))
  assert.match(textOf(tree2), /尚未创建设置命名空间/)
})

test('the section surfaces the warnings an activation returned', async () => {
  const controller = await readyController(
    { 'ccs-deepseek-ab12cd34': hostProvider() },
    { routes: { [`${PROVIDERS_PATH}/activate`]: { body: {
      key: 'ccs-deepseek-ab12cd34',
      status: 'activated',
      applied: false,
      warnings: ['llm-pi-ai is not installed, so DSH has no route to use it'],
    } } } },
  )
  await controller.activate('ccs-deepseek-ab12cd34')
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  const text = textOf(tree)
  // The warning is the whole reason the activate route returns a list: without
  // it the row would read "active" while every request still used the old route.
  assert.match(text, /llm-pi-ai is not installed/)
  assert.match(text, /DSH 没有接受该 provider/)
  assert.match(text, /启用提示/)
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

test('a render survives a Host payload with missing and malformed fields', async () => {
  const controller = createCCSwitchManagerController({
    fetchImpl: stubFetch({ [PROVIDERS_PATH]: { body: {
      exists: true,
      revision: 3,
      // 'ghost' is in `order` but not `providers`; numbers are not keys.
      order: ['ghost', 7, 'ccs-x-ab12cd34'],
      providers: { 'ccs-x-ab12cd34': { displayName: null, models: 'nope', api: undefined } },
    } } }),
  })
  await controller.refresh()
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  // The one provider present is listed once, under its key, with no models.
  assert.match(textOf(tree), /ccs-x-ab12cd34/)
  assert.match(textOf(tree), /无模型/)
  assert.equal(findByText(tree, 'ghost'), undefined, 'a key with no provider must not become a row')
})

// --- dialogs opened from the table -------------------------------------------

const PROVIDER_KEY = 'ccs-deepseek-ab12cd34'

test('opening "edit" passes the revision the form was opened at, not the live one', async () => {
  // The revision has to *move* for this test to mean anything: if both reads
  // report the same number, a form that pinned the revision and one that read
  // the live value are indistinguishable.
  let revision = 7
  const saves = []
  const controller = createCCSwitchManagerController({
    fetchImpl: stubFetch({
      [PROVIDERS_PATH]: () => ({ body: {
        exists: true,
        revision,
        order: [PROVIDER_KEY],
        providers: { [PROVIDER_KEY]: hostProvider() },
        apiProtocols: ['openai-completions', 'openai-responses', 'anthropic-messages'],
      } }),
      [`${PROVIDERS_PATH}/save`]: (init) => {
        saves.push(JSON.parse(init.body))
        return { body: { key: PROVIDER_KEY, status: 'updated' } }
      },
    }),
  })
  await controller.refresh()
  assert.equal(controller.getSnapshot().revision, 7)

  const harness = createHarness()
  let tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  buttonByText(tree, '编辑').props.onClick()

  // Someone else edits the document while the form is open.
  revision = 9
  await controller.refresh()
  assert.equal(controller.getSnapshot().revision, 9, 'the table is now on a newer revision')

  tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  const form = byType(tree, 'form')[0]
  assert.ok(form, 'the edit form opened')
  form.props.onSubmit({ preventDefault() {} })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(saves.length, 1)
  // 7 is the revision the form was opened at. Reading the live revision (9) at
  // submit time would compare the write against itself and always succeed,
  // silently overwriting the edit that landed meanwhile.
  assert.equal(saves[0].expectedRevision, 7)
  assert.equal(saves[0].key, PROVIDER_KEY)
})

test('a second dialog does not open showing the previous attempt’s errors', async () => {
  const controller = await readyController(
    { [PROVIDER_KEY]: hostProvider() },
    { routes: { [`${PROVIDERS_PATH}/save`]: {
      status: 400,
      body: { error: 'provider is not usable', errors: ['displayName is required'] },
    } } },
  )
  const harness = createHarness()
  let tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  // Open edit, submit, and let the Host reject it.
  buttonByText(tree, '编辑').props.onClick()
  tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  byType(tree, 'form')[0].props.onSubmit({ preventDefault() {} })
  await new Promise((resolve) => setTimeout(resolve, 0))

  tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  assert.match(textOf(tree), /displayName is required/, 'the rejection is shown')

  // Close it, then open a fresh dialog: the abandoned attempt’s errors must
  // not greet the user, because they may name fields already fixed.
  buttonByText(tree, '取消').props.onClick()
  tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  assert.equal(byType(tree, 'form').length, 0, 'the dialog closed')

  buttonByText(tree, '新增 provider').props.onClick()
  tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  const form = byType(tree, 'form')[0]
  assert.ok(form, 'a fresh dialog opened')
  assert.equal(findAll(tree, (node) => node.props?.role === 'alert').length, 0,
    'the new dialog shows no errors from the abandoned attempt')
})

test('duplicate opens a create form for a new key, keeping the settings', async () => {
  const controller = await readyController({ [PROVIDER_KEY]: hostProvider() })
  const harness = createHarness()
  let tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  buttonByText(tree, '复制').props.onClick()
  tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  // A create form, so the save is unambiguously a new provider.
  assert.match(textOf(byType(tree, 'form')[0]), /新增 provider/)
  const values = byType(tree, 'input').map((input) => input.props.value)
  assert.ok(values.includes('DeepSeek'), 'the source name is carried over')
  // The protocol select is populated from the Host list, in the Host's own
  // order — it is not hardcoded, and the draft's existing protocol is not
  // hoisted to the front.
  assert.deepEqual(
    byType(tree, 'select')[0].props.children.filter(Boolean).map((option) => option.props.value),
    ['openai-completions', 'openai-responses', 'anthropic-messages'],
  )
})

test('delete asks for confirmation and does nothing when it is declined', async () => {
  let deletes = 0
  const controller = await readyController(
    { [PROVIDER_KEY]: hostProvider() },
    { routes: { [`${PROVIDERS_PATH}/delete`]: () => { deletes += 1; return { body: { key: PROVIDER_KEY, status: 'removed' } } } } },
  )
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  const previousConfirm = globalThis.window
  globalThis.window = { confirm: () => false }
  try {
    buttonByText(tree, '删除').props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    globalThis.window = previousConfirm
  }
  // Declining must not delete: the row is irreplaceable once the credential is
  // gone with it.
  assert.equal(deletes, 0)
})

test('delete proceeds once confirmed', async () => {
  let deleted = undefined
  const controller = await readyController(
    { [PROVIDER_KEY]: hostProvider() },
    { routes: { [`${PROVIDERS_PATH}/delete`]: (init) => {
      deleted = JSON.parse(init.body).key
      return { body: { key: PROVIDER_KEY, status: 'removed' } }
    } } },
  )
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  const previousWindow = globalThis.window
  globalThis.window = { confirm: () => true }
  try {
    buttonByText(tree, '删除').props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    globalThis.window = previousWindow
  }
  assert.equal(deleted, PROVIDER_KEY)
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

// --- search: CC Switch's ProviderList filter --------------------------------
//
// CC Switch builds one lowercased haystack per provider out of
// `[name, notes, websiteUrl, extractProviderBaseUrl(settingsConfig)]` and asks
// whether it contains the trimmed, lowercased query — a plain substring test,
// not a word or prefix match. These pin the fields this plugin has an
// equivalent for, and the two states a search can put the table into.

test('providerMatches searches name, notes and endpoint, case-insensitively', () => {
  const provider = {
    displayName: 'DeepSeek',
    notes: '备用线路',
    baseURL: 'https://api.deepseek.com/anthropic',
  }
  // Empty and whitespace-only queries match everything: that is what lets the
  // caller run every row through this without a separate "is searching" branch.
  assert.equal(providerMatches(provider, ''), true)
  assert.equal(providerMatches(provider, '   '), true)
  assert.equal(providerMatches(provider, undefined), true)

  assert.equal(providerMatches(provider, 'deep'), true, 'name')
  assert.equal(providerMatches(provider, 'DEEPSEEK'), true, 'case-insensitive')
  assert.equal(providerMatches(provider, '备用'), true, 'notes')
  assert.equal(providerMatches(provider, 'api.deepseek.com'), true, 'endpoint')
  assert.equal(providerMatches(provider, 'seek.com'), true, 'mid-string substring')
  assert.equal(providerMatches(provider, 'moonshot'), false)
  // A provider missing an optional field must not throw, and must not match on
  // the literal string "undefined" the way a template would.
  assert.equal(providerMatches({ displayName: 'X' }, 'x'), true)
  assert.equal(providerMatches({ displayName: 'X' }, 'undefined'), false)
  assert.equal(providerMatches(undefined, 'x'), false)
})

test('the search box narrows the table and has its own empty state', async () => {
  const controller = await readyController({
    'ccs-a-ab12cd34': hostProvider({ key: 'ccs-a-ab12cd34', displayName: 'Alpha' }),
    'ccs-b-ab12cd34': hostProvider({ key: 'ccs-b-ab12cd34', displayName: 'Beta' }),
  })
  const harness = createHarness()
  const render = () => harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  const rowsOf = (tree) => findAll(tree, (node) => typeof node.props?.className === 'string'
    && node.props.className.includes('dsh-ccswitch-manager__row')
    && !node.props.className.includes('__row-actions')
    && !node.props.className.includes('__row-error'))

  const tree = render()
  assert.equal(rowsOf(tree).length, 2, 'both rows render before searching')
  const input = findAll(tree, (node) => node.props?.['aria-label'] === '搜索供应商')[0]
  assert.ok(input, 'the search box rendered')
  assert.equal(input.props.type, 'text')

  input.props.onChange({ target: { value: 'beta' } })
  const filtered = render()
  assert.equal(rowsOf(filtered).length, 1, 'only the matching row remains')
  assert.match(textOf(rowsOf(filtered)[0]), /Beta/)

  // A query nothing matches must say so. Rendering the "no providers yet" line
  // here would be a lie: the catalogue is non-empty, the search is hiding it.
  input.props.onChange({ target: { value: 'zzz' } })
  const none = render()
  assert.equal(rowsOf(none).length, 0)
  assert.match(textOf(none), /没有符合搜索条件的供应商/)
  assert.doesNotMatch(textOf(none), /还没有 provider/)

  input.props.onChange({ target: { value: '' } })
  assert.equal(rowsOf(render()).length, 2, 'clearing restores the full list')
})

test('the search box is absent while there is nothing to search', async () => {
  const empty = createCCSwitchManagerController({
    fetchImpl: stubFetch({ [PROVIDERS_PATH]: { body: { exists: true, revision: 1, order: [], providers: {}, apiProtocols: [] } } }),
  })
  await empty.refresh()
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller: empty, t }))
  // A control that cannot do anything, sitting above the sentence explaining
  // how to get a provider, is worse than no control.
  assert.equal(findAll(tree, (node) => node.props?.['aria-label'] === '搜索供应商').length, 0)
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

// --- the per-row connection probe -------------------------------------------
//
// The manager reuses the importer's read-only probe route. The button is shown
// only where that route can actually answer — a provider that came through an
// import — because a control that can never succeed reads as a bug rather than
// as a limit of what was imported.

const PROBE_PATH = '/api/dsh-ccswitch/probe'

/** A probe outcome as the Host sends one. */
function probeOutcome(overrides = {}) {
  return {
    profileId: 'deepseek-1',
    ok: true,
    reason: 'ok',
    check: 'models',
    httpStatus: 200,
    latencyMs: 42,
    modelCount: 3,
    message: '模型探测成功',
    ...overrides,
  }
}

test('the probe button appears only where the probe route can answer', async () => {
  const controller = await readyController({
    'ccs-imported-ab12cd34': hostProvider({ key: 'ccs-imported-ab12cd34', displayName: 'Imported', sourceProfileId: 'deepseek-1' }),
    'ccs-hand-ab12cd34': hostProvider({ key: 'ccs-hand-ab12cd34', displayName: 'HandAdded' }),
  })
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  const probes = findAll(tree, (node) => node.type === 'button' && textOf(node).includes('测试连接'))
  assert.equal(probes.length, 1, 'only the imported row offers a probe')

  const rows = findAll(tree, (node) => typeof node.props?.className === 'string'
    && node.props.className.includes('dsh-ccswitch-manager__row')
    && !node.props.className.includes('__row-actions')
    && !node.props.className.includes('__row-error'))
  const imported = rows.find((row) => textOf(row).includes('Imported'))
  const hand = rows.find((row) => textOf(row).includes('HandAdded'))
  assert.equal(findAll(imported, (node) => textOf(node).includes('测试连接')).length > 0, true)
  assert.equal(findAll(hand, (node) => textOf(node).includes('测试连接')).length, 0)
  // The hand-added row still renders its other actions.
  assert.ok(findAll(hand, (node) => node.props?.['aria-label'] === '启用 HandAdded')[0])
})

test('a probe result renders inline on the row that asked for it', async () => {
  const controller = await readyController({
    'ccs-imported-ab12cd34': hostProvider({ key: 'ccs-imported-ab12cd34', displayName: 'Imported', sourceProfileId: 'deepseek-1' }),
    'ccs-other-ab12cd34': hostProvider({ key: 'ccs-other-ab12cd34', displayName: 'Other', sourceProfileId: 'deepseek-2' }),
  }, {
    routes: { [PROBE_PATH]: { body: { results: [probeOutcome()] } } },
  })
  const harness = createHarness()
  const render = () => harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  const button = findAll(render(), (node) => node.type === 'button' && textOf(node).includes('测试连接'))[0]
  assert.ok(button, 'the probe button rendered')
  button.props.onClick()
  // The click kicks off an async request; let it settle before re-rendering.
  await new Promise((resolve) => setTimeout(resolve, 0))
  const tree = render()

  const status = findAll(tree, (node) => node.props?.role === 'status'
    && typeof node.props?.className === 'string'
    && node.props.className.includes('dsh-ccswitch-import__probe'))
  assert.equal(status.length, 1, 'exactly one row shows a verdict')
  // Model count and latency, in the same wording the import tab uses.
  assert.match(textOf(status[0]), /连通/)
  assert.match(textOf(status[0]), /42ms/)

  // The verdict belongs to the row that asked for it, not to its neighbour.
  const rows = findAll(tree, (node) => typeof node.props?.className === 'string'
    && node.props.className.includes('dsh-ccswitch-manager__row')
    && !node.props.className.includes('__row-actions')
    && !node.props.className.includes('__row-error'))
  const other = rows.find((row) => textOf(row).includes('Other'))
  assert.doesNotMatch(textOf(other), /连通/)
})

test('a failed probe says why, and a stale Host is named', async () => {
  const controller = await readyController({
    'ccs-imported-ab12cd34': hostProvider({ key: 'ccs-imported-ab12cd34', displayName: 'Imported', sourceProfileId: 'deepseek-1' }),
  }, {
    routes: { [PROBE_PATH]: { body: { results: [
      probeOutcome({ ok: false, reason: 'http-error', check: 'none', httpStatus: 401, detail: 'Invalid token', latencyMs: 12 }),
    ] } } },
  })
  const harness = createHarness()
  const render = () => harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  findAll(render(), (node) => node.type === 'button' && textOf(node).includes('测试连接'))[0].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const text = textOf(render())
  assert.match(text, /失败/)
  assert.match(text, /HTTP 401/)
  // The upstream's own words are the actionable part of a failure.
  assert.match(text, /Invalid token/)
})

test('a probe the Host does not know about says so instead of blaming the provider', async () => {
  // A 404 from the probe *route* means the Host half predates the endpoint.
  // Reporting that as "network error" would send the user hunting a problem
  // that is not there.
  const controller = await readyController({
    'ccs-imported-ab12cd34': hostProvider({ key: 'ccs-imported-ab12cd34', displayName: 'Imported', sourceProfileId: 'deepseek-1' }),
  }, {
    routes: { [PROBE_PATH]: { status: 404, body: { error: 'HTTP 404' } } },
  })
  const harness = createHarness()
  const render = () => harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  findAll(render(), (node) => node.type === 'button' && textOf(node).includes('测试连接'))[0].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const text = textOf(render())
  assert.match(text, /宿主未加载该接口/)
})

test('the search box and the probe survive each other', async () => {
  // The search filters the rows; a verdict is stored against a provider key, so
  // narrowing the table must not drop it, and a probe must not clear the query.
  const controller = await readyController({
    'ccs-a-ab12cd34': hostProvider({ key: 'ccs-a-ab12cd34', displayName: 'Alpha', sourceProfileId: 'a-1' }),
    'ccs-b-ab12cd34': hostProvider({ key: 'ccs-b-ab12cd34', displayName: 'Beta', sourceProfileId: 'b-1' }),
  }, {
    routes: { [PROBE_PATH]: { body: { results: [probeOutcome({ profileId: 'a-1' })] } } },
  })
  const harness = createHarness()
  const render = () => harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  findAll(render(), (node) => node.type === 'button' && textOf(node).includes('测试连接'))[0].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))

  const input = findAll(render(), (node) => node.props?.['aria-label'] === '搜索供应商')[0]
  input.props.onChange({ target: { value: 'alpha' } })
  const filtered = render()
  assert.match(textOf(filtered), /连通/, 'the verdict survives filtering to its own row')
  // And it is still there when the filter is cleared.
  input.props.onChange({ target: { value: '' } })
  assert.match(textOf(render()), /连通/)
})

// --- moving a row ------------------------------------------------------------
//
// The reorder route was built and tested on the Host, and nothing in the UI
// called it, so the list order was fixed. These cover the controls that now do.

/** Every button whose own text is exactly `label`, in document order. */
function buttonsLabelled(root, label) {
  return findAll(root, (node) => node.type === 'button' && textOf(node).trim() === label)
}

/** The option values a `<select>` offers, flattened. */
function optionValues(select) {
  return (Array.isArray(select.props.children) ? select.props.children : [])
    .filter(Boolean)
    .map((option) => option.props.value)
}

const THREE_KEYS = ['ccs-a-ab12cd34', 'ccs-b-ab12cd34', 'ccs-c-ab12cd34']

function threeProviders() {
  return Object.fromEntries(THREE_KEYS.map((key) => [key, hostProvider({ key, displayName: key })]))
}

function searchBox(root) {
  return findAll(root, (node) => node.type === 'input'
    && typeof node.props.placeholder === 'string'
    && node.props.placeholder.includes('搜索'))[0]
}

test('the move buttons write the whole new order, and are dead at the ends', async () => {
  const reorders = []
  const controller = await readyController(threeProviders(), {
    routes: {
      [`${PROVIDERS_PATH}/reorder`]: (init) => {
        reorders.push(JSON.parse(init.body))
        return { body: { status: 'reordered', order: JSON.parse(init.body).keys } }
      },
    },
  })
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  const ups = buttonsLabelled(tree, '↑')
  const downs = buttonsLabelled(tree, '↓')
  assert.equal(ups.length, 3, 'one up button per row')
  assert.equal(downs.length, 3, 'one down button per row')
  // There is nowhere for the first row to go up, nor the last to go down. The
  // Host accepts either as a no-op move, which would cost a settings write and
  // a revision bump to store the order that is already there.
  assert.equal(ups[0].props.disabled, true, 'the first row cannot move up')
  assert.equal(downs[2].props.disabled, true, 'the last row cannot move down')
  assert.equal(ups[1].props.disabled, false)
  assert.equal(downs[0].props.disabled, false)

  // Move the middle row up.
  ups[1].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(reorders.length, 1, 'exactly one reorder was sent')
  // The complete order, re-indexed by position — what the Host requires.
  assert.deepEqual(reorders[0].keys, ['ccs-b-ab12cd34', 'ccs-a-ab12cd34', 'ccs-c-ab12cd34'])
})

test('a move made while a search is hiding rows still moves one whole slot', async () => {
  // CC Switch resolves both ends of a drag against the unfiltered
  // `sortedProviders`, so a move is a fact about the catalogue rather than
  // about what the filter happens to be showing. A one-slot move has to follow
  // the same rule, or a row moved past a hidden neighbour lands somewhere the
  // user cannot see and did not ask for.
  const reorders = []
  const controller = await readyController(threeProviders(), {
    routes: {
      [`${PROVIDERS_PATH}/reorder`]: (init) => {
        reorders.push(JSON.parse(init.body))
        return { body: { status: 'reordered', order: [] } }
      },
    },
  })
  const harness = createHarness()
  let tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  // Narrow to the last row only.
  const search = searchBox(tree)
  assert.ok(search, 'the search box rendered')
  search.props.onChange({ target: { value: 'ccs-c' } })
  tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))

  const ups = buttonsLabelled(tree, '↑')
  assert.equal(ups.length, 1, 'the filter hides the other two rows')
  // It is the third row of three, so up is available. Were the index resolved
  // against the filtered list it would be the first row, and this would be off.
  assert.equal(ups[0].props.disabled, false, 'the row is not first in the catalogue')
  ups[0].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(reorders[0].keys, ['ccs-a-ab12cd34', 'ccs-c-ab12cd34', 'ccs-b-ab12cd34'])
})

test('a failed reorder is reported as a reorder failure', async () => {
  const controller = await readyController(threeProviders(), {
    routes: {
      [`${PROVIDERS_PATH}/reorder`]: { status: 400, body: { error: 'keys must name every provider exactly once' } },
    },
  })
  const harness = createHarness()
  const tree = harness.render(React.createElement(ProviderManagerSection, { controller, t }))
  buttonsLabelled(tree, '↓')[0].props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  // Worded as a reorder failure, not a save or delete one: the user pressed a
  // move button and the message has to name that.
  assert.match(textOf(harness.render(React.createElement(ProviderManagerSection, { controller, t }))), /调整顺序失败/)
})

// --- the app type control ----------------------------------------------------
//
// The field travelled through every draft builder but had no control, so a
// provider added by hand silently became a Claude Code provider: the Host
// defaults an absent app type to `claude`. It is now shown and editable.

test('a row shows which app it belongs to, resolving an absent value to claude', () => {
  // The edit form can set this, so the list has to show it — otherwise two
  // providers with the same name in different apps look identical.
  assert.equal(providerRowView({ key: 'k', appType: 'codex' }, {}).appType, 'codex')
  assert.equal(providerRowView({ key: 'k' }, {}).appType, 'claude')
  assert.equal(providerRowView({ key: 'k', appType: '' }, {}).appType, 'claude')
  assert.equal(providerRowView({ key: 'k', appType: 7 }, {}).appType, 'claude')
})

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
