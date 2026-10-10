// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * Render cc-switch's components the way a browser would, so a test can prove
 * they actually mount.
 *
 * Two things are needed that a plain `import` cannot give us:
 *
 * 1. **A bundle.** The vendored sources are TypeScript/TSX and reach each
 *    other through the `@/` alias, which esbuild resolves and Node does not —
 *    so a test that imported `ProviderList.tsx` directly would fail before
 *    rendering anything. {@link bundleModule} compiles the entry with the same
 *    options the client bundle uses (same alias, same JSX runtime, same
 *    prefixing pass) and writes it under `test/.tmp`, which Node *can* import
 *    because bare specifiers then resolve against the repo's `node_modules`.
 * 2. **A DOM.** `ProviderList` portals its search panel to `document.body`,
 *    binds `globalThis.addEventListener` for ⌘F, and framer-motion asks for
 *    `matchMedia`. jsdom supplies all of it; the shims below fill the two
 *    gaps jsdom leaves.
 *
 * `test/.tmp` is gitignored — it is scratch output, never published
 * (`package.json` ships only `dist/`).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = resolve(ROOT, 'test/.tmp')

let domReady = false
let react = null
let client = null
let currentDom = null
/** Animation frames this helper scheduled, so teardown can cancel them. */
const pendingFrames = new Set()

/**
 * Put a browser-shaped global environment in place.
 *
 * Idempotent, and deliberately called lazily: `react-dom` reads `document` when
 * it is first used, and `jsdom` must exist before that happens.
 */
export async function setupDom() {
  if (domReady) return
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><html><body><div id="dsh-test-root"></div></body></html>', {
    url: 'http://127.0.0.1/',
    pretendToBeVisual: true,
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  // Node 24 ships its own read-only `navigator`; the getter has to be replaced
  // rather than assigned, or the whole setup throws before rendering.
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  })
  for (const name of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'MutationObserver', 'CustomEvent', 'Event']) {
    if (dom.window[name] !== undefined) globalThis[name] = dom.window[name]
  }
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  // Animation frames are backed by `setTimeout` here, and every one is tracked:
  // framer-motion re-arms a frame on each paint, so a frame scheduled just
  // before unmount would otherwise keep the process alive forever. `jsdom`'s
  // own `pretendToBeVisual` loop is replaced for the same reason.
  const scheduleFrame = (fn) => {
    const id = setTimeout(fn, 0)
    pendingFrames.add(id)
    return id
  }
  const cancelFrame = (id) => {
    clearTimeout(id)
    pendingFrames.delete(id)
  }
  globalThis.requestAnimationFrame = scheduleFrame
  globalThis.cancelAnimationFrame = cancelFrame
  dom.window.requestAnimationFrame = scheduleFrame
  dom.window.cancelAnimationFrame = cancelFrame
  // `ProviderList` binds ⌘F on `globalThis`, not on `window`.
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window)
  globalThis.removeEventListener = dom.window.removeEventListener.bind(dom.window)
  // jsdom has no `matchMedia`, which framer-motion and Radix both ask for.
  if (typeof dom.window.matchMedia !== 'function') {
    dom.window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() { return false },
    })
  }
  globalThis.matchMedia = dom.window.matchMedia.bind(dom.window)
  // React's `act` refuses to synchronise outside a test unless this is set.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  react = await import('react')
  client = await import('react-dom/client')
  currentDom = dom
  domReady = true
  return dom
}

/**
 * Shut the jsdom window down.
 *
 * jsdom's `pretendToBeVisual` keeps a `requestAnimationFrame` loop running for
 * as long as the window lives, and a test process that never exits is reported
 * as a hang rather than as a slow suite. Every test file that calls
 * {@link setupDom} must call this from an `after` hook.
 */
export function teardownDom() {
  for (const id of pendingFrames) clearTimeout(id)
  pendingFrames.clear()
  try {
    currentDom?.window?.close()
  } catch {
    // Closing an already-closed window is not a failure worth surfacing.
  }
  currentDom = null
}

const bundles = new Map()

/**
 * Compile `source` with the client build's options and import the result.
 *
 * Memoised by name, because a Tailwind candidate pass over the vendored tree
 * costs a few seconds and a test file renders the same fixture repeatedly.
 *
 * @param name - a unique, file-safe label; the bundle lands at
 *   `test/.tmp/<name>.mjs`.
 * @param source - the entry's TypeScript source.
 */
export async function bundleModule(name, source) {
  if (bundles.has(name)) return bundles.get(name)
  await setupDom()
  await mkdir(OUT_DIR, { recursive: true })
  const entry = resolve(OUT_DIR, `${name}.entry.tsx`)
  const outfile = resolve(OUT_DIR, `${name}.mjs`)
  await writeFile(entry, source, 'utf8')
  const { clientBuildOptions } = await import('../../scripts/build.mjs')
  await build({
    ...clientBuildOptions(),
    // ESM, so Node can import it; the shipped client bundle stays CJS for DSH's
    // module loader.
    format: 'esm',
    write: true,
    outfile,
    entryPoints: [entry],
    platform: 'browser',
    // Resolved from `test/.tmp` at runtime, which is inside the repo — so these
    // come from the same `node_modules` the test itself uses. Bundling a second
    // React would be the one mistake that fails as "Invalid hook call" rather
    // than as a build error. `@tanstack/react-query` is listed for the same
    // reason one level up: its `QueryClientContext` is an object identity, and
    // a bundled copy would hand the test a *different* one to answer with.
    external: [
      'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react-dom/server',
      '@tanstack/react-query',
    ],
  })
  const namespace = await import(`file://${outfile.split('\\').join('/')}`)
  bundles.set(name, namespace)
  return namespace
}

/**
 * Render an element tree into the jsdom document and hand back reads on it.
 *
 * Everything inside `act`, because React's effects — the ⌘F listener, react-
 * query's subscription, Radix's observers — have to settle before the DOM is
 * worth asserting on, and `act` is what waits for them.
 */
export async function render(element) {
  const dom = await setupDom()
  // A fresh container per render: reusing one after `unmount` makes React warn
  // that the container already has a root, and the warning is a distraction
  // from the assertion this file is actually making.
  const host = document.createElement('div')
  host.id = 'dsh-test-root'
  document.body.appendChild(host)
  const root = client.createRoot(host)
  await react.act(async () => { root.render(element) })
  // One more turn so `setTimeout`-based work (react-query's fetch, toasts)
  // gets a chance to land rather than racing the assertion.
  await react.act(async () => { await new Promise((done) => setTimeout(done, 20)) })
  return {
    host,
    /** The visible text, whitespace collapsed the way a reader sees it. */
    text: () => host.textContent.replace(/\s+/g, ' ').trim(),
    html: () => host.innerHTML,
    /** Every element matching a selector, as an array. */
    all: (selector) => [...host.querySelectorAll(selector)],
    /** The first element matching a selector, or null. */
    one: (selector) => host.querySelector(selector),
    /** All elements carrying an `aria-label`, for the button assertions. */
    labelled: (label) => [...host.querySelectorAll('[aria-label]')]
      .filter((node) => node.getAttribute('aria-label') === label),
    /**
     * Click an element inside `act`.
     *
     * A bare `node.click()` dispatches correctly but runs React's handler
     * outside `act`, so the resulting render is reported as an unexpected
     * update instead of being awaited.
     */
    async click(node) {
      await react.act(async () => { node.click() })
      await react.act(async () => { await new Promise((done) => setTimeout(done, 0)) })
    },
    async unmount() {
      await react.act(async () => { root.unmount() })
      host.remove()
      void dom
    },
  }
}
