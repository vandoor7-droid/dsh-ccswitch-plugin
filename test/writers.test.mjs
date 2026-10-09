// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
//
// The writers edit files that belong to other tools and to the user. Two
// failures matter more than any other here, and most of these tests are about
// them: taking a user's own keys away, and turning a file we could not read
// into an empty one. Everything else — which key gets which value — is
// comparatively easy to notice and fix.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  WRITER_APP_TYPES,
  WriterError,
  writeClaudeConfig,
  writeCodexConfig,
  writeProviderConfig,
} from '../src/host/writers.js'
import { makeManagerRoutes, MANAGER_API_BASE } from '../src/host/manager-routes.mjs'
import { isLoopbackRequest } from '../src/host/routes.mjs'

// --- harness ----------------------------------------------------------------

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-ccswitch-writers-'))
  return {
    home,
    cleanup() { rmSync(home, { recursive: true, force: true }) },
    read(relative) { return readFileSync(join(home, relative), 'utf8') },
    write(relative, text) {
      const path = join(home, relative)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, text)
    },
    exists(relative) { return existsSync(join(home, relative)) },
  }
}

const CLAUDE_PROVIDER = {
  displayName: 'DeepSeek',
  api: 'anthropic-messages',
  baseURL: 'https://api.deepseek.com/anthropic',
  models: [{ id: 'deepseek-chat' }],
}

const CODEX_PROVIDER = {
  displayName: 'DeepSeek',
  api: 'openai-completions',
  baseURL: 'https://api.deepseek.com/v1',
  models: [{ id: 'deepseek-chat' }],
}

/** A settings.json that already carries a previous provider and user config. */
const CLAUDE_EXISTING = `{
  "env": {
    "ANTHROPIC_BASE_URL": "https://old.example",
    "CLAUDE_CODE_USE_POWERSHELL_TOOL": "1",
    "ANTHROPIC_AUTH_TOKEN": "sk-old",
    "API_TIMEOUT_MS": "300000",
    "AWS_REGION": "us-east-1"
  },
  "model": "old-model",
  "hooks": {
    "Stop": []
  },
  "permissions": {
    "allow": [
      "Bash"
    ]
  },
  "enabledPlugins": {
    "thing@market": true
  },
  "statusLine": {
    "type": "command"
  }
}
`

function claudeFixture() {
  const fixture = makeHome()
  fixture.write('.claude/settings.json', CLAUDE_EXISTING)
  return fixture
}

// --- Claude: the floor protects the user's keys -----------------------------

test('claude: user keys and their order survive a provider switch', async () => {
  const fixture = claudeFixture()
  try {
    await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const doc = JSON.parse(fixture.read('.claude/settings.json'))

    // The previous provider's floor keys are gone, at both levels.
    assert.equal(doc.env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic')
    assert.equal(doc.env.ANTHROPIC_AUTH_TOKEN, 'sk-new')
    assert.equal(doc.env.ANTHROPIC_MODEL, 'deepseek-chat')
    assert.equal(doc.env.AWS_REGION, undefined, 'AWS_ is a floor prefix')
    assert.equal(doc.model, undefined, 'model is a top-level floor key')

    // Everything the user owns is intact...
    assert.deepEqual(doc.hooks, { Stop: [] })
    assert.deepEqual(doc.permissions, { allow: ['Bash'] })
    assert.deepEqual(doc.enabledPlugins, { 'thing@market': true })
    assert.equal(doc.env.CLAUDE_CODE_USE_POWERSHELL_TOOL, '1')
    assert.equal(doc.env.API_TIMEOUT_MS, '300000')
    assert.deepEqual(doc.statusLine, { type: 'command' })

    // ...and in its original position: `env` stays first, and the surviving
    // keys inside it keep their relative order.
    assert.deepEqual(Object.keys(doc), ['env', 'hooks', 'permissions', 'enabledPlugins', 'statusLine'])
    assert.deepEqual(Object.keys(doc.env), [
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_USE_POWERSHELL_TOOL',
      'ANTHROPIC_AUTH_TOKEN',
      'API_TIMEOUT_MS',
      'ANTHROPIC_MODEL',
    ])
  } finally {
    fixture.cleanup()
  }
})

test('claude: a switch away clears the previous provider entirely', async () => {
  // The top-level floor matters even though this provider shape writes nothing
  // there: an imported `apiKeyHelper` row would otherwise keep supplying the
  // credential after the user believed they had switched away from it.
  const fixture = makeHome()
  try {
    fixture.write('.claude/settings.json', JSON.stringify({
      apiKeyHelper: '/usr/local/bin/get-key',
      model: 'from-the-old-provider',
      env: { ANTHROPIC_BASE_URL: 'https://old.example', ANTHROPIC_AUTH_TOKEN: 'sk-old' },
      hooks: { Stop: [] },
    }, null, 2))
    const result = await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const doc = JSON.parse(fixture.read('.claude/settings.json'))
    assert.equal(doc.apiKeyHelper, undefined)
    assert.equal(doc.model, undefined)
    assert.deepEqual(result.files[0].removed, ['apiKeyHelper', 'model'])
    assert.deepEqual(doc.hooks, { Stop: [] })
  } finally {
    fixture.cleanup()
  }
})

test('claude: reaching the format is idempotent and byte-stable', async () => {
  const fixture = claudeFixture()
  try {
    await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const once = fixture.read('.claude/settings.json')
    await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    assert.equal(fixture.read('.claude/settings.json'), once, 'a second write must not move a byte')
  } finally {
    fixture.cleanup()
  }
})

test('claude: indentation, CRLF and the missing trailing newline are all preserved', async () => {
  const fixture = makeHome()
  try {
    // Four-space indent, CRLF, no trailing newline — the opposite of the
    // defaults on all three axes, so a writer that guessed would be caught.
    const source = '{\r\n    "env": {\r\n        "ANTHROPIC_BASE_URL": "https://old.example"\r\n    },\r\n    "hooks": {}\r\n}'
    fixture.write('.claude/settings.json', source)
    await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const out = fixture.read('.claude/settings.json')
    assert.ok(out.includes('\r\n'), 'CRLF must survive')
    assert.ok(!/(^|[^\r])\n/.test(out), 'no bare LF may be introduced')
    assert.ok(out.includes('\r\n    "env": {'), 'four-space indent must survive')
    assert.ok(out.includes('\r\n        "ANTHROPIC_BASE_URL"'), 'second level follows the same indent')
    assert.ok(out.endsWith('}'), 'the absent trailing newline must stay absent')

    const before = out
    await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    assert.equal(fixture.read('.claude/settings.json'), before, 'and it is still byte-stable')
  } finally {
    fixture.cleanup()
  }
})

// --- Claude: refusing what cannot be understood -----------------------------

test('claude: a malformed settings.json is refused and left byte-identical', async () => {
  const fixture = makeHome()
  try {
    const broken = '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://old.example"\n  },\n  oops\n}\n'
    fixture.write('.claude/settings.json', broken)
    await assert.rejects(
      writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home }),
      (err) => {
        assert.ok(err instanceof WriterError)
        assert.equal(err.kind, 'parse')
        // The location is what makes the error actionable; without it the user
        // is told "invalid JSON" about a file they may not even know exists.
        assert.equal(err.line, 5)
        assert.equal(typeof err.column, 'number')
        return true
      },
    )
    assert.equal(fixture.read('.claude/settings.json'), broken, 'the file must not have moved')
  } finally {
    fixture.cleanup()
  }
})

test('claude: a non-object top level is refused and left byte-identical', async () => {
  const fixture = makeHome()
  try {
    fixture.write('.claude/settings.json', '[]')
    await assert.rejects(
      writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home }),
      (err) => err instanceof WriterError && err.kind === 'shape',
    )
    assert.equal(fixture.read('.claude/settings.json'), '[]')
  } finally {
    fixture.cleanup()
  }
})

test('claude: a non-object env member is refused rather than replaced', async () => {
  // Rewriting this would silently discard whatever the user meant by `env`.
  const fixture = makeHome()
  try {
    const source = '{"env": "oops", "hooks": {}}'
    fixture.write('.claude/settings.json', source)
    await assert.rejects(
      writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home }),
      (err) => err instanceof WriterError && err.kind === 'shape',
    )
    assert.equal(fixture.read('.claude/settings.json'), source)
  } finally {
    fixture.cleanup()
  }
})

test('claude: a missing file starts from an empty object', async () => {
  const fixture = makeHome()
  try {
    const result = await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const doc = JSON.parse(fixture.read('.claude/settings.json'))
    assert.deepEqual(doc, {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'sk-new',
        ANTHROPIC_MODEL: 'deepseek-chat',
      },
    })
    assert.deepEqual(result.files[0].removed, [])
  } finally {
    fixture.cleanup()
  }
})

test('claude: a blank file is also allowed to start empty', async () => {
  const fixture = makeHome()
  try {
    fixture.write('.claude/settings.json', '  \n')
    await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    assert.equal(JSON.parse(fixture.read('.claude/settings.json')).env.ANTHROPIC_AUTH_TOKEN, 'sk-new')
  } finally {
    fixture.cleanup()
  }
})

test('claude: the key is written under ANTHROPIC_AUTH_TOKEN only', async () => {
  // Both names at once provokes Claude Code's "Both ANTHROPIC_AUTH_TOKEN and
  // ANTHROPIC_API_KEY set" warning.
  const fixture = makeHome()
  try {
    await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const doc = JSON.parse(fixture.read('.claude/settings.json'))
    assert.equal(doc.env.ANTHROPIC_AUTH_TOKEN, 'sk-new')
    assert.equal(doc.env.ANTHROPIC_API_KEY, undefined)
  } finally {
    fixture.cleanup()
  }
})

// --- Codex: two files, one unit ---------------------------------------------

test('codex: auth.json gains the key while unknown members survive', async () => {
  const fixture = makeHome()
  try {
    fixture.write('.codex/auth.json', JSON.stringify({
      tokens: { access_token: 'chatgpt-token' },
      last_refresh: '2026-01-01T00:00:00Z',
    }, null, 2))
    const result = await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const doc = JSON.parse(fixture.read('.codex/auth.json'))
    assert.equal(doc.OPENAI_API_KEY, 'sk-new')
    assert.deepEqual(doc.tokens, { access_token: 'chatgpt-token' })
    assert.equal(doc.last_refresh, '2026-01-01T00:00:00Z')
    assert.deepEqual(result.files.map((file) => file.path.split(/[\\/]/).pop()), ['auth.json', 'config.toml'])
  } finally {
    fixture.cleanup()
  }
})

test('codex: config.toml gains the floor keys and the custom table, and keeps the rest', async () => {
  const fixture = makeHome()
  try {
    const source = [
      '# my codex config',
      'model = "gpt-5"          # keep this comment',
      'approval_policy = "on-request"',
      '',
      '[mcp_servers.thing]',
      'command = "thing"',
      '',
      '[projects."/home/me/app"]',
      'trust_level = "trusted"',
      '',
    ].join('\n')
    fixture.write('.codex/config.toml', source)
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const out = fixture.read('.codex/config.toml')

    // The user's own content is untouched, comments and order included.
    assert.ok(out.startsWith('# my codex config\n'), 'the leading comment stays put')
    assert.ok(out.includes('approval_policy = "on-request"'))
    assert.ok(out.includes('[mcp_servers.thing]\ncommand = "thing"'))
    assert.ok(out.includes('[projects."/home/me/app"]\ntrust_level = "trusted"'))

    const parsed = parseTomlish(out)
    assert.equal(parsed.top.model, 'deepseek-chat')
    assert.equal(parsed.top.model_provider, 'custom')
    assert.equal(parsed.sections['model_providers.custom'].name, 'DeepSeek')
    assert.equal(parsed.sections['model_providers.custom'].base_url, 'https://api.deepseek.com/v1')
    assert.equal(parsed.sections['model_providers.custom'].wire_api, 'chat')
    assert.equal(parsed.sections['model_providers.custom'].requires_openai_auth, 'true')
    // The edited line keeps its trailing comment.
    assert.ok(out.includes('model = "deepseek-chat"          # keep this comment'))
  } finally {
    fixture.cleanup()
  }
})

test('codex: a missing config.toml is created with just the keys we own', async () => {
  const fixture = makeHome()
  try {
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const out = fixture.read('.codex/config.toml')
    const parsed = parseTomlish(out)
    assert.equal(parsed.top.model, 'deepseek-chat')
    assert.equal(parsed.top.model_provider, 'custom')
    assert.equal(parsed.sections['model_providers.custom'].base_url, 'https://api.deepseek.com/v1')
    assert.ok(out.endsWith('\n'), 'a freshly created file ends with a newline')
  } finally {
    fixture.cleanup()
  }
})

test('codex: responses maps to wire_api = "responses"', async () => {
  const fixture = makeHome()
  try {
    await writeCodexConfig({
      provider: { ...CODEX_PROVIDER, api: 'openai-responses' },
      apiKey: 'sk-new',
      home: fixture.home,
    })
    assert.equal(parseTomlish(fixture.read('.codex/config.toml')).sections['model_providers.custom'].wire_api, 'responses')
  } finally {
    fixture.cleanup()
  }
})

test('codex: a stale reasoning effort is removed, not left steering the new model', async () => {
  const fixture = makeHome()
  try {
    fixture.write('.codex/config.toml', 'model = "gpt-5"\nmodel_reasoning_effort = "high"\n')
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const out = fixture.read('.codex/config.toml')
    assert.equal(parseTomlish(out).top.model_reasoning_effort, undefined)
    assert.ok(!out.includes('model_reasoning_effort'), 'the key is removed, not blanked')
  } finally {
    fixture.cleanup()
  }
})

test('codex: a provider that carries an effort writes it', async () => {
  const fixture = makeHome()
  try {
    await writeCodexConfig({
      provider: { ...CODEX_PROVIDER, reasoning: 'medium' },
      apiKey: 'sk-new',
      home: fixture.home,
    })
    assert.equal(parseTomlish(fixture.read('.codex/config.toml')).top.model_reasoning_effort, 'medium')
  } finally {
    fixture.cleanup()
  }
})

test('codex: a malformed auth.json is refused before either file is touched', async () => {
  const fixture = makeHome()
  try {
    fixture.write('.codex/auth.json', '{ not json')
    fixture.write('.codex/config.toml', 'model = "gpt-5"\n')
    await assert.rejects(
      writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home }),
      (err) => err instanceof WriterError && err.kind === 'parse',
    )
    assert.equal(fixture.read('.codex/auth.json'), '{ not json')
    assert.equal(fixture.read('.codex/config.toml'), 'model = "gpt-5"\n', 'the second file was never reached')
  } finally {
    fixture.cleanup()
  }
})

test('codex: a malformed config.toml is refused and auth.json is left alone', async () => {
  // Both files are read and rendered before either is written, so a file we
  // cannot parse costs nothing at all.
  const fixture = makeHome()
  try {
    fixture.write('.codex/auth.json', '{"tokens": {"access_token": "keep-me"}}')
    fixture.write('.codex/config.toml', 'model = "gpt-5\n') // unterminated string
    await assert.rejects(
      writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home }),
      (err) => err instanceof WriterError && err.kind === 'shape',
    )
    assert.equal(fixture.read('.codex/auth.json'), '{"tokens": {"access_token": "keep-me"}}')
    assert.equal(fixture.read('.codex/config.toml'), 'model = "gpt-5\n')
  } finally {
    fixture.cleanup()
  }
})

test('codex: a failing config.toml write rolls auth.json back', async () => {
  // The two files are one unit: a key committed to auth.json while config.toml
  // still points at the previous provider is worse than writing nothing.
  const fixture = makeHome()
  try {
    const authBefore = '{"tokens": {"access_token": "original"}}\n'
    fixture.write('.codex/auth.json', authBefore)
    fixture.write('.codex/config.toml', 'model = "gpt-5"\n')

    const failing = {
      read: async (path) => readFileSync(path),
      write: async (path, content) => {
        if (path.endsWith('config.toml')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
        writeFileSync(path, content)
      },
    }
    await assert.rejects(
      writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home, io: failing }),
      /disk full/,
    )
    assert.equal(fixture.read('.codex/auth.json'), authBefore, 'auth.json must be back to its prior bytes')
    assert.equal(fixture.read('.codex/config.toml'), 'model = "gpt-5"\n')
  } finally {
    fixture.cleanup()
  }
})

test('codex: rolling back removes an auth.json that did not exist before', async () => {
  const fixture = makeHome()
  try {
    const failing = {
      read: async (path) => {
        try { return readFileSync(path) } catch (err) { if (err.code === 'ENOENT') return undefined; throw err }
      },
      write: async (path, content) => {
        if (path.endsWith('config.toml')) throw new Error('nope')
        writeFileSync(path, content)
      },
    }
    await assert.rejects(
      writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home, io: failing }),
      /nope/,
    )
    assert.equal(fixture.exists('.codex/auth.json'), false, 'the file we created is removed again')
  } finally {
    fixture.cleanup()
  }
})

// --- dispatch ---------------------------------------------------------------

test('an app type with no writer is refused with the supported list', async () => {
  await assert.rejects(
    writeProviderConfig({ appType: 'gemini', provider: CLAUDE_PROVIDER, apiKey: 'sk', home: tmpdir() }),
    (err) => err instanceof WriterError && err.kind === 'unsupported' && /gemini/.test(err.message),
  )
  assert.deepEqual([...WRITER_APP_TYPES], ['claude', 'codex'])
})

test('an empty credential is refused by the writers themselves', async () => {
  // `JSON.stringify` drops a key whose value is `undefined`, so a missing key
  // would otherwise produce a file that looks complete and leaves the tool
  // unable to authenticate. The guard lives in the writers, not only in the
  // route, because the route is not the only possible caller.
  const fixture = makeHome()
  try {
    for (const apiKey of [undefined, '']) {
      for (const write of [writeClaudeConfig, writeCodexConfig]) {
        await assert.rejects(
          write({ provider: CLAUDE_PROVIDER, apiKey, home: fixture.home }),
          (err) => err instanceof WriterError && err.kind === 'credential',
        )
      }
    }
    assert.equal(fixture.exists('.claude/settings.json'), false)
    assert.equal(fixture.exists('.codex/auth.json'), false)
  } finally {
    fixture.cleanup()
  }
})

// --- the route --------------------------------------------------------------

function fakeReq(overrides = {}) {
  return {
    method: 'POST',
    url: `${MANAGER_API_BASE}/writers/run`,
    headers: { host: '127.0.0.1:5624', 'x-dsh-ccswitch-origin': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  }
}

function fakeRes() {
  const calls = []
  return {
    calls,
    writeHead(status, headers) { calls.push(['head', status, headers]) },
    end(body) { calls.push(['end', body]) },
  }
}

function withBody(request, body) {
  return Object.assign(request, {
    [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(body)) },
  })
}

function statusOf(res) { return res.calls.find((call) => call[0] === 'head')[1] }
function bodyOf(res) { return JSON.parse(res.calls.find((call) => call[0] === 'end')[1]) }

function fakeSettings(providers) {
  return {
    async describe() { return [{ ns: 'dsh-ccswitch-plugin', revision: 1, value: { providers } }] },
    async mutate() { throw new Error('the writers route must never write settings') },
  }
}

function fakeCredentials(values = {}) {
  return {
    async resolve(ref) {
      return Object.hasOwn(values, ref) ? { value: values[ref], source: 'test' } : undefined
    },
    async describe(ref) { return { ref, configured: Object.hasOwn(values, ref) } },
  }
}

function routeOf(routes) {
  const route = routes.find((item) => item.path === `${MANAGER_API_BASE}/writers/run`)
  assert.ok(route, 'the writers route must be registered')
  return route
}

test('the writers route reports what it wrote, and never the key', async () => {
  const fixture = makeHome()
  try {
    const settings = fakeSettings({
      'ccs-deepseek-ab12cd34': { ...CLAUDE_PROVIDER, apiKeyEnv: 'DSH_CCSWITCH_AB12CD34_API_KEY' },
    })
    const routes = makeManagerRoutes({
      settings,
      credentials: fakeCredentials({ DSH_CCSWITCH_AB12CD34_API_KEY: 'sk-secret-value' }),
      isLoopback: () => true,
      home: fixture.home,
    })
    const res = fakeRes()
    await routeOf(routes).handler(withBody(fakeReq(), { key: 'ccs-deepseek-ab12cd34' }), res)
    assert.equal(statusOf(res), 200)
    const body = bodyOf(res)
    assert.equal(body.key, 'ccs-deepseek-ab12cd34')
    assert.equal(body.appType, 'claude', 'the provider carries no appType, so it defaults to claude')
    assert.equal(body.written.length, 1)
    assert.ok(body.written[0].path.endsWith('settings.json'))
    assert.deepEqual(body.written[0].keys, [
      'env.ANTHROPIC_BASE_URL',
      'env.ANTHROPIC_AUTH_TOKEN',
      'env.ANTHROPIC_MODEL',
    ])
    assert.doesNotMatch(JSON.stringify(body), /sk-secret-value/, 'the key value never crosses the wire')
    // And it really was written to the injected home.
    assert.equal(fixture.read('.claude/settings.json').includes('sk-secret-value'), true)
  } finally {
    fixture.cleanup()
  }
})

test('the writers route refuses a provider whose credential is unset', async () => {
  // Writing a config that names a provider with no key leaves the external tool
  // broken in a way the user cannot see from inside DSH.
  const fixture = makeHome()
  try {
    const routes = makeManagerRoutes({
      settings: fakeSettings({
        'ccs-deepseek-ab12cd34': { ...CLAUDE_PROVIDER, apiKeyEnv: 'DSH_CCSWITCH_AB12CD34_API_KEY' },
      }),
      credentials: fakeCredentials(),
      isLoopback: () => true,
      home: fixture.home,
    })
    const res = fakeRes()
    await routeOf(routes).handler(withBody(fakeReq(), { key: 'ccs-deepseek-ab12cd34' }), res)
    assert.equal(statusOf(res), 400)
    assert.match(bodyOf(res).error, /no key stored/)
    assert.equal(fixture.exists('.claude/settings.json'), false, 'nothing was written')
  } finally {
    fixture.cleanup()
  }
})

test('the writers route refuses an app type that has no writer', async () => {
  const fixture = makeHome()
  try {
    const routes = makeManagerRoutes({
      settings: fakeSettings({
        'ccs-gemini-ab12cd34': { ...CLAUDE_PROVIDER, appType: 'gemini', apiKeyEnv: 'DSH_CCSWITCH_AB12CD34_API_KEY' },
      }),
      credentials: fakeCredentials({ DSH_CCSWITCH_AB12CD34_API_KEY: 'sk-x' }),
      isLoopback: () => true,
      home: fixture.home,
    })
    const res = fakeRes()
    await routeOf(routes).handler(withBody(fakeReq(), { key: 'ccs-gemini-ab12cd34' }), res)
    assert.equal(statusOf(res), 400)
    assert.match(bodyOf(res).error, /no writer for that app type/)
    assert.match(bodyOf(res).error, /claude, codex/, 'it names what is actually supported')
  } finally {
    fixture.cleanup()
  }
})

test('the writers route says so when the target file cannot be understood', async () => {
  const fixture = makeHome()
  try {
    fixture.write('.claude/settings.json', '{ broken')
    const routes = makeManagerRoutes({
      settings: fakeSettings({
        'ccs-deepseek-ab12cd34': { ...CLAUDE_PROVIDER, apiKeyEnv: 'DSH_CCSWITCH_AB12CD34_API_KEY' },
      }),
      credentials: fakeCredentials({ DSH_CCSWITCH_AB12CD34_API_KEY: 'sk-x' }),
      isLoopback: () => true,
      home: fixture.home,
    })
    const res = fakeRes()
    await routeOf(routes).handler(withBody(fakeReq(), { key: 'ccs-deepseek-ab12cd34' }), res)
    assert.equal(statusOf(res), 400)
    assert.match(bodyOf(res).error, /not valid JSON/)
    assert.equal(fixture.read('.claude/settings.json'), '{ broken')
  } finally {
    fixture.cleanup()
  }
})

test('the writers route honours an appType override from the body', async () => {
  const fixture = makeHome()
  try {
    const routes = makeManagerRoutes({
      settings: fakeSettings({
        'ccs-deepseek-ab12cd34': { ...CODEX_PROVIDER, appType: 'claude', apiKeyEnv: 'DSH_CCSWITCH_AB12CD34_API_KEY' },
      }),
      credentials: fakeCredentials({ DSH_CCSWITCH_AB12CD34_API_KEY: 'sk-x' }),
      isLoopback: () => true,
      home: fixture.home,
    })
    const res = fakeRes()
    await routeOf(routes).handler(
      withBody(fakeReq(), { key: 'ccs-deepseek-ab12cd34', appType: 'codex' }),
      res,
    )
    assert.equal(statusOf(res), 200)
    assert.equal(bodyOf(res).appType, 'codex')
    assert.equal(fixture.exists('.codex/config.toml'), true)
    assert.equal(fixture.exists('.claude/settings.json'), false)
  } finally {
    fixture.cleanup()
  }
})

test('the writers route 404s on an unknown provider', async () => {
  const routes = makeManagerRoutes({
    settings: fakeSettings({}),
    credentials: fakeCredentials(),
    isLoopback: () => true,
    home: tmpdir(),
  })
  const missing = fakeRes()
  await routeOf(routes).handler(withBody(fakeReq(), { key: 'nope' }), missing)
  assert.equal(statusOf(missing), 404)

  const wrongMethod = fakeRes()
  await routeOf(routes).handler(fakeReq({ method: 'GET' }), wrongMethod)
  assert.equal(statusOf(wrongMethod), 405)
})

test('the writers route is loopback and same-origin fenced', async () => {
  // The real predicate, not a stub: asserting that a function returning true
  // returns true would prove nothing about the fence.
  const routes = makeManagerRoutes({
    settings: fakeSettings({}),
    credentials: fakeCredentials(),
    isLoopback: isLoopbackRequest,
    home: tmpdir(),
  })
  const offLoop = fakeRes()
  await routeOf(routes).handler(
    withBody(fakeReq({ socket: { remoteAddress: '10.0.0.5' } }), { key: 'nope' }),
    offLoop,
  )
  assert.equal(statusOf(offLoop), 403)

  const noProof = fakeRes()
  await routeOf(routes).handler(
    withBody(fakeReq({ headers: { host: '127.0.0.1:5624' } }), { key: 'nope' }),
    noProof,
  )
  assert.equal(statusOf(noProof), 403)
})

// --- a minimal TOML reader, so the assertions above do not trust the writer ---

/**
 * Parse enough TOML to check the writers, deliberately independent of the
 * writer's own line scanner and of `lib/core/toml.js`: asserting a patcher's
 * output with the code under test proves nothing.
 */
function parseTomlish(text) {
  const top = {}
  const sections = {}
  let current = null
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header !== null) {
      current = header[1]
      sections[current] = sections[current] ?? {}
      continue
    }
    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line)
    if (assignment === null) continue
    const value = assignment[2].replace(/\s+#.*$/, '').trim().replace(/^"|"$/g, '')
    if (current === null) top[assignment[1]] = value
    else sections[current][assignment[1]] = value
  }
  return { top, sections }
}
