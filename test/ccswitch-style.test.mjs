// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * The build-time Tailwind prefix, which is what keeps cc-switch's utility
 * classes out of DSH's document.
 *
 * Three things are worth pinning, because each one fails invisibly if it
 * drifts: the position the prefix lands in (Tailwind's own contract), the
 * lexer's losslessness (a miscount shifts every string after it, and the
 * symptom shows up in a component three files away), and the stylesheet's
 * scoping (an unscoped `* { box-sizing }` restyles DSH itself).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PREFIX,
  ROOT_CLASS,
  SOURCE_DIR,
  buildCss,
  candidates,
  prefixApplyDirectives,
  prefixSource,
  prefixToken,
} from '../scripts/ccswitch-style.mjs'
import { PREFIX as MERGE_PREFIX } from '../src/client/tauri-shim/tailwind-merge.mjs'

test('the prefix lands where Tailwind 3.4 puts it', () => {
  // Verified against a real Tailwind build rather than assumed — see the
  // table in scripts/ccswitch-style.mjs.
  const known = new Set([
    'flex', 'hover:bg-red-500', '!text-bold', 'hover:!text-bold', 'dark:flex',
    'w-[calc(1px*2)]', '[&:hover]:block', 'group-hover:opacity-50', 'sm:underline',
  ])
  const cases = [
    ['flex', 'dsh-ccs-flex'],
    ['hover:bg-red-500', 'hover:dsh-ccs-bg-red-500'],
    ['!text-bold', '!dsh-ccs-text-bold'],
    ['hover:!text-bold', 'hover:!dsh-ccs-text-bold'],
    ['dark:flex', 'dark:dsh-ccs-flex'],
    ['w-[calc(1px*2)]', 'dsh-ccs-w-[calc(1px*2)]'],
    // The colon inside `[&:hover]` is not a variant separator.
    ['[&:hover]:block', '[&:hover]:dsh-ccs-block'],
    ['group-hover:opacity-50', 'group-hover:dsh-ccs-opacity-50'],
    ['sm:underline', 'sm:dsh-ccs-underline'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(prefixToken(input, known), expected, input)
  }
})

test('a token Tailwind never emitted is left alone', () => {
  const known = new Set(['flex'])
  assert.equal(prefixToken('not-a-utility', known), 'not-a-utility')
  // `@apply` arguments are prefixed regardless: they are utilities by
  // definition and are never extracted from a source file.
  assert.equal(prefixToken('font-sans', known, true), 'dsh-ccs-font-sans')
})

test('the tailwind-merge shim carries the same prefix', () => {
  // Two spellings of one value: `scripts/ccswitch-style.mjs` must not be
  // imported by the browser bundle, so the shim repeats it.
  assert.equal(MERGE_PREFIX, PREFIX)
})

test('the rewrite is a no-op on syntax it does not understand', async () => {
  const none = new Set()
  const tricky = [
    'a "b" c',
    'export type { AppId } from "./types";',
    'const x = `${a} and ${b}`;',
    'const nested = `${`${inner}`}`;',
    "text.replace(/['\"]/g, '')",
    "don't break // a comment with ' quotes",
    '/* a block with "quotes" and `ticks` */',
    'const re = /https:\\/\\/x\\.y/;',
    'label = "Click to block";',
    'html = `<div class="${cls}">`;',
  ]
  for (const source of tricky) {
    assert.equal(prefixSource(source, none), source, source)
  }
})

test('class strings are prefixed and prose is not', () => {
  const known = new Set(['flex', 'gap-2', 'block', 'bg-red-500'])
  assert.equal(
    prefixSource('className="flex gap-2"', known),
    'className="dsh-ccs-flex dsh-ccs-gap-2"',
  )
  // A sentence containing a bare utility word is left alone.
  assert.equal(prefixSource('title="Click to block"', known), 'title="Click to block"')
  // A template literal only rewrites its static chunks, never the expression.
  assert.equal(
    prefixSource('className={`flex ${cond && "block"}`}', known),
    'className={`dsh-ccs-flex ${cond && "dsh-ccs-block"}`}',
  )
})

test('@apply arguments are prefixed', () => {
  assert.equal(
    prefixApplyDirectives('html { @apply font-sans antialiased; }'),
    'html { @apply dsh-ccs-font-sans dsh-ccs-antialiased; }',
  )
  assert.equal(prefixApplyDirectives('.a { color: red; }'), '.a { color: red; }')
})

test('the dark-mode marker is never rewritten', async () => {
  const set = await candidates()
  assert.equal(set.has('dark'), false, 'the state marker must stay `dark`')
  // …while a real utility still is.
  assert.equal(set.has('flex'), true)
})

test('every vendored source survives the rewrite', async () => {
  // The lexer's contract: for a token set that renames nothing, the output is
  // byte-identical. A regression here shifts strings in unrelated files.
  const { readdir, readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const files = []
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(path)
    }
  }
  await walk(SOURCE_DIR)
  assert.ok(files.length > 300, `expected the vendored tree, found ${files.length} files`)
  for (const path of files) {
    const source = await readFile(path, 'utf8')
    assert.equal(prefixSource(source, new Set()), source, path)
  }
})

test('the stylesheet is prefixed and cannot reach DSH', async () => {
  const css = await buildCss()
  assert.ok(css.length > 10000, `expected a real stylesheet, got ${css.length} bytes`)

  assert.match(css, /\.dsh-ccs-flex\{/, 'utilities must be prefixed')
  assert.ok(!/(^|})\.flex\{/.test(css), 'an unprefixed utility would apply to DSH')

  // cc-switch carries its own reset; none of it may leave the plugin.
  assert.ok(!/(^|})\*\{box-sizing/.test(css), 'the * reset must be scoped')
  assert.ok(!/(^|})html\{/.test(css), 'the html rule must be scoped')
  assert.ok(!/(^|})body\{/.test(css), 'the body rule must be scoped')
  assert.match(css, new RegExp(`\\.${ROOT_CLASS} \\*`), 'the reset must be scoped under the root')

  // …but the custom properties stay global: a Radix portal escapes the
  // wrapper entirely and still has to resolve them.
  assert.match(css, /:root\{/, ':root variables must stay global')
  assert.ok(!css.includes('@apply'), 'every @apply must have been resolved')

  // Tailwind's own preflight must not be re-enabled behind the scoping.
  assert.ok(!css.includes('*,:after,:before'), 'preflight must stay off')
})
