// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MESSAGES } from '../src/client/messages.mjs'
import { makeTranslator } from '../src/client/i18n.mjs'

const root = new URL('../', import.meta.url)
const UI_FILES = [
  'src/ui/CCSwitchImportSection.mjs',
  'src/ui/ModelsFooterPanel.mjs',
  'src/ui/ReasoningSettingsSection.mjs',
]

async function uiSources() {
  return Promise.all(UI_FILES.map(async (path) => [path, await readFile(new URL(path, root), 'utf8')]))
}

function placeholdersIn(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

test('zh and en catalogues expose exactly the same keys', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.zh).sort())
})

test('no catalogue entry is empty', () => {
  for (const locale of Object.keys(MESSAGES)) {
    for (const [key, value] of Object.entries(MESSAGES[locale])) {
      assert.equal(typeof value, 'string', `${locale}.${key} must be a string`)
      assert.ok(value.length > 0, `${locale}.${key} must not be empty`)
    }
  }
})

test('every key the panels ask for exists in both locales', async () => {
  const missing = []
  for (const [path, source] of await uiSources()) {
    for (const match of source.matchAll(/\btr\(\s*["']([^"']+)["']/g)) {
      const key = match[1]
      if (!Object.hasOwn(MESSAGES.zh, key)) missing.push(`${path}: zh missing ${key}`)
      if (!Object.hasOwn(MESSAGES.en, key)) missing.push(`${path}: en missing ${key}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('placeholders agree between zh and en for every key', () => {
  for (const key of Object.keys(MESSAGES.zh)) {
    assert.deepEqual(
      placeholdersIn(MESSAGES.en[key]),
      placeholdersIn(MESSAGES.zh[key]),
      `placeholder mismatch for ${key}`,
    )
  }
})

test('the panels actually route through the translator', async () => {
  for (const [path, source] of await uiSources()) {
    const calls = [...source.matchAll(/\btr\(\s*["'][^"']+["']/g)].length
    assert.ok(calls >= 3, `${path} only makes ${calls} translator calls`)
  }
})

test('translator prefers the host value and falls back when it is absent', () => {
  const tr = makeTranslator((key) => (key === 'nav' ? 'Nav from host' : undefined))
  assert.equal(tr('nav', 'fallback'), 'Nav from host')
  assert.equal(tr('missing.key', 'fallback'), 'fallback')
})

test('translator interpolates placeholders and survives a broken host translator', () => {
  const tr = makeTranslator(() => '{count} of {total}')
  assert.equal(tr('k', 'unused', { count: 2, total: 5 }), '2 of 5')
  // A placeholder without a value is left alone rather than rendered as undefined.
  assert.equal(tr('k', 'unused', { count: 2 }), '2 of {total}')
  const throwing = makeTranslator(() => { throw new Error('no locale registered') })
  assert.equal(throwing('k', 'safe fallback'), 'safe fallback')
  assert.equal(makeTranslator(undefined)('k'), 'k')
})

test('both locales resolve every catalogue key through the framework translator', () => {
  for (const locale of ['zh', 'en']) {
    const table = MESSAGES[locale]
    const tr = makeTranslator((key) => table[key])
    for (const key of Object.keys(table)) {
      assert.equal(tr(key, 'fallback'), table[key], `${locale}.${key} did not resolve`)
    }
  }
})
