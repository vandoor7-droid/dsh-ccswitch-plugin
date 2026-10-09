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
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

test('both writers write every secret-bearing file owner-only', async () => {
  // Each path these writers touch holds a credential: Claude Code keeps
  // ANTHROPIC_AUTH_TOKEN in settings.json, and Codex keeps the key in the route
  // table's `experimental_bearer_token` inside config.toml. cc-switch marks
  // exactly those paths `LiveFile::private`, so 0644 would hand the key to
  // every other account on the machine. The mode is recorded rather than
  // stat'd because a temp dir ignores permission bits on some platforms.
  const fixture = makeHome()
  try {
    const modes = []
    const recording = {
      read: async (path) => {
        try { return readFileSync(path) } catch (err) { if (err.code === 'ENOENT') return undefined; throw err }
      },
      write: async (path, _content, mode) => { modes.push([path, mode]) },
    }
    await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home, io: recording })
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home, io: recording })

    const written = modes.map(([path]) => path.split(String.fromCharCode(92)).join('/'))
    assert.ok(written.some((path) => path.endsWith('.claude/settings.json')), `claude settings.json was not written: ${written}`)
    assert.ok(written.some((path) => path.endsWith('.codex/auth.json')), `codex auth.json was not written: ${written}`)
    assert.ok(written.some((path) => path.endsWith('.codex/config.toml')), `codex config.toml was not written: ${written}`)
    for (const [path, mode] of modes) {
      assert.equal(mode, 0o600, `${path} must be owner-only, got 0o${Number(mode).toString(8)}`)
    }
  } finally {
    fixture.cleanup()
  }
})

// --- Codex: two files, one unit ---------------------------------------------

test('codex: auth.json keeps the official login and never gains the key', async () => {
  // From Codex 0.149 a custom provider reads its credential out of the route
  // table, not `auth.json`; a key written here would authenticate nothing while
  // still outranking the ChatGPT tokens beside it in Codex's auth-mode
  // resolution, which reads the file as an `apikey` credential.
  const fixture = makeHome()
  try {
    fixture.write('.codex/auth.json', JSON.stringify({
      tokens: { access_token: 'chatgpt-token' },
      last_refresh: '2026-01-01T00:00:00Z',
    }, null, 2))
    const result = await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const raw = fixture.read('.codex/auth.json')
    const doc = JSON.parse(raw)
    assert.equal(doc.OPENAI_API_KEY, undefined, 'the route table carries the key now, not auth.json')
    assert.deepEqual(doc.tokens, { access_token: 'chatgpt-token' })
    assert.equal(doc.last_refresh, '2026-01-01T00:00:00Z')
    assert.ok(!raw.includes('sk-new'), 'the key value must not reach auth.json at all')
    assert.deepEqual(result.files.map((file) => file.path.split(/[\\/]/).pop()), ['auth.json', 'config.toml'])
  } finally {
    fixture.cleanup()
  }
})

test('codex: the key lands in the route table, and never in a response', async () => {
  const fixture = makeHome()
  try {
    const result = await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const parsed = parseTomlish(fixture.read('.codex/config.toml'))
    assert.equal(
      parsed.sections['model_providers.custom'].experimental_bearer_token,
      'sk-new',
      'this is the one place Codex 0.149+ reads a custom provider credential from',
    )
    assert.ok(!JSON.stringify(result).includes('sk-new'), 'the key value never crosses back out')
  } finally {
    fixture.cleanup()
  }
})

test('codex: requires_openai_auth follows whether a login is on disk', async () => {
  // Neither fixed value is safe. `true` with no login in auth.json makes Codex
  // stall on a login page; `false` while a ChatGPT login sits next to it makes
  // Codex treat itself as signed out, so account info vanishes and tokens stop
  // being refreshed.
  const withLogin = makeHome()
  const withoutLogin = makeHome()
  try {
    withLogin.write('.codex/auth.json', JSON.stringify({
      tokens: { id_token: 'id', access_token: 'at', refresh_token: 'rt' },
    }))
    // The same file, minus the credential: metadata must not count as a login.
    withoutLogin.write('.codex/auth.json', JSON.stringify({
      tokens: { account_id: 'acct-meta-only' },
      last_refresh: '2026-01-01T00:00:00Z',
    }))

    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-a', home: withLogin.home })
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-b', home: withoutLogin.home })

    assert.equal(
      parseTomlish(withLogin.read('.codex/config.toml')).sections['model_providers.custom'].requires_openai_auth,
      'true',
    )
    assert.equal(
      parseTomlish(withoutLogin.read('.codex/config.toml')).sections['model_providers.custom'].requires_openai_auth,
      'false',
    )
  } finally {
    withLogin.cleanup()
    withoutLogin.cleanup()
  }
})

test('codex: a bare OPENAI_API_KEY is not a login, and a stale one is left alone', async () => {
  // This is the shape earlier versions of this writer left behind. It must not
  // be mistaken for a login (or `requires_openai_auth` would stay true and
  // Codex would stall), and it is not ours to delete: with one provider in hand
  // we cannot prove the key came from us rather than `codex login --api-key`.
  const fixture = makeHome()
  try {
    fixture.write('.codex/auth.json', '{"OPENAI_API_KEY": "sk-stale"}\n')
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    assert.equal(
      parseTomlish(fixture.read('.codex/config.toml')).sections['model_providers.custom'].requires_openai_auth,
      'false',
    )
    assert.equal(JSON.parse(fixture.read('.codex/auth.json')).OPENAI_API_KEY, 'sk-stale')
  } finally {
    fixture.cleanup()
  }
})

test('codex: a stale experimental_bearer_token is replaced, not left behind', async () => {
  // The token is floor: a value from the previous provider would otherwise keep
  // authenticating against the new provider's base_url.
  const fixture = makeHome()
  try {
    fixture.write('.codex/config.toml', [
      'model = "gpt-5"',
      '',
      '[model_providers.custom]',
      'name = "Old"',
      'base_url = "https://old.example/v1"',
      'experimental_bearer_token = "sk-old"',
      '',
    ].join('\n'))
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const out = fixture.read('.codex/config.toml')
    const parsed = parseTomlish(out)
    assert.equal(parsed.sections['model_providers.custom'].experimental_bearer_token, 'sk-new')
    assert.ok(!out.includes('sk-old'), 'the previous provider token must be gone')
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
    // No auth.json here, so there is no login on disk for the route to follow.
    assert.equal(parsed.sections['model_providers.custom'].requires_openai_auth, 'false')
    assert.equal(parsed.sections['model_providers.custom'].experimental_bearer_token, 'sk-new')
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
      // `io.read` is `readBytesIfExists`, so "not there" is `undefined` rather
      // than a throw. A stub that throws ENOENT would be implementing a
      // different interface from the one the writers use.
      read: async (path) => {
        try { return readFileSync(path) } catch (err) { if (err.code === 'ENOENT') return undefined; throw err }
      },
      write: async (path, content) => {
        if (path.endsWith('config.toml')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
        mkdirSync(join(path, '..'), { recursive: true })
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
        mkdirSync(join(path, '..'), { recursive: true })
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

// --- Claude: the residue table ----------------------------------------------

/** One (key, value) pair per entry of cc-switch's frozen residue list. */
const RESIDUE_PAIRS = [
  ['CLAUDE_CODE_MAX_CONTEXT_TOKENS', '262144'],
  ['CLAUDE_CODE_MAX_CONTEXT_TOKENS', '372000'],
  ['CLAUDE_CODE_MAX_CONTEXT_TOKENS', '983616'],
  ['CLAUDE_CODE_AUTO_COMPACT_WINDOW', '262144'],
  ['CLAUDE_CODE_AUTO_COMPACT_WINDOW', '372000'],
  ['CLAUDE_CODE_AUTO_COMPACT_WINDOW', '1000000'],
  ['CLAUDE_CODE_MAX_OUTPUT_TOKENS', '131072'],
]

test('claude: every frozen residue pair is removed, in both spellings', async () => {
  // These are window values earlier CC Switch versions injected. Each is larger
  // than the window the next provider actually has, so a leftover one over-runs
  // the window silently — which is why they are deleted rather than preserved
  // like other provider-exclusive fields.
  for (const [key, value] of RESIDUE_PAIRS) {
    for (const spelling of [value, Number(value)]) {
      const fixture = makeHome()
      try {
        fixture.write('.claude/settings.json', `${JSON.stringify({
          env: { [key]: spelling, KEEP_ME: '1' },
        }, null, 2)}\n`)
        const result = await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home })
        const env = JSON.parse(fixture.read('.claude/settings.json')).env
        assert.equal(env[key], undefined, `${key} = ${JSON.stringify(spelling)} must be removed`)
        assert.equal(env.KEEP_ME, '1', 'an unrelated user key is untouched')
        assert.ok(result.files[0].removed.includes(`env.${key}`), `the removal is reported: ${result.files[0].removed}`)
      } finally {
        fixture.cleanup()
      }
    }
  }
})

test('claude: a window the user set to some other value survives', async () => {
  // The rule is value equality, not ownership of the key. A number that CC
  // Switch never wrote is the user's own setting, and deleting it would be the
  // exact failure this module exists to avoid.
  const fixture = claudeFixture()
  try {
    fixture.write('.claude/settings.json', `${JSON.stringify({
      env: {
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: '65536',
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: 777,
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: 'not-a-number',
      },
    }, null, 2)}\n`)
    const result = await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const env = JSON.parse(fixture.read('.claude/settings.json')).env
    assert.equal(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '65536')
    assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, 777)
    assert.equal(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, 'not-a-number')
    assert.deepEqual(result.files[0].removed, [], 'nothing was claimed as removed')
  } finally {
    fixture.cleanup()
  }
})

test('claude: a residue value is not removed when the provider writes that key', async () => {
  // The target's own value wins in place, which is cc-switch's `remove_if`
  // rule: a path named by `set` is skipped by the removal pass. The projection
  // emits no window key today, so the guard itself is unreachable through the
  // public API and this pins the behaviour that *is* reachable — residue
  // cleanup runs in the same pass as a real write, and an unrelated
  // `CLAUDE_CODE_*` switch is not swept up with it.
  const fixture = makeHome()
  try {
    fixture.write('.claude/settings.json', `${JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://old.example',
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: '131072',
        API_TIMEOUT_MS: '300000',
      },
    }, null, 2)}\n`)
    await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const doc = JSON.parse(fixture.read('.claude/settings.json'))
    assert.equal(doc.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, undefined)
    assert.equal(doc.env.ANTHROPIC_AUTH_TOKEN, 'sk-new')
    assert.equal(doc.env.API_TIMEOUT_MS, '300000')
  } finally {
    fixture.cleanup()
  }
})

// --- Codex: the effective route ---------------------------------------------

test('codex: a profile that overrides the route is refused, and nothing is written', async () => {
  // Codex prefers the top-level `profile`, and a routing key inside it outranks
  // the one this writer just set. The write would look successful and route
  // somewhere else entirely, so it is refused instead.
  const fixture = makeHome()
  try {
    const source = [
      'model = "gpt-5"',
      'profile = "work"',
      '',
      '[profiles.work]',
      'model_provider = "openai"',
      '',
    ].join('\n')
    fixture.write('.codex/config.toml', source)
    await assert.rejects(
      writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home }),
      (err) => {
        assert.ok(err instanceof WriterError, 'a WriterError, not a generic failure')
        assert.equal(err.kind, 'route')
        assert.equal(err.profile, 'work')
        assert.equal(err.key, 'model_provider')
        assert.match(err.message, /\[profiles\.work\]/)
        assert.match(err.message, /model_provider/)
        assert.match(err.message, /nothing was written/)
        return true
      },
    )
    assert.equal(fixture.read('.codex/config.toml'), source, 'the file is byte-identical after a refusal')
    assert.equal(fixture.exists('.codex/auth.json'), false, 'and the sibling file was not created either')
  } finally {
    fixture.cleanup()
  }
})

test('codex: each of the three overriding keys is refused by name', async () => {
  for (const [key, value] of [
    ['model_provider', '"openai"'],
    ['openai_base_url', '"https://elsewhere.example/v1"'],
    ['experimental_bearer_token', '"sk-someone-elses"'],
  ]) {
    const fixture = makeHome()
    try {
      fixture.write('.codex/config.toml', [
        'profile = "work"',
        '',
        '[profiles.work]',
        `${key} = ${value}`,
        '',
      ].join('\n'))
      await assert.rejects(
        writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home }),
        (err) => err instanceof WriterError && err.kind === 'route' && err.key === key,
        `${key} must be refused`,
      )
    } finally {
      fixture.cleanup()
    }
  }
})

test('codex: a profile naming the same route agrees rather than overriding', async () => {
  // cc-switch compares `model_provider` against the route being selected, not
  // against "is it set at all": a profile that selects the same table the
  // writer is about to write is not a conflict.
  const fixture = makeHome()
  try {
    fixture.write('.codex/config.toml', [
      'profile = "work"',
      '',
      '[profiles.work]',
      'model_provider = "custom"',
      '',
    ].join('\n'))
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const parsed = parseTomlish(fixture.read('.codex/config.toml'))
    assert.equal(parsed.top.model_provider, 'custom')
    assert.equal(parsed.sections['profiles.work'].model_provider, 'custom', "the user's profile is left alone")
  } finally {
    fixture.cleanup()
  }
})

test('codex: no top-level profile, or one that does not exist, is not a conflict', async () => {
  for (const source of [
    'model = "gpt-5"\n',
    ['profile = "gone"', '', '[profiles.other]', 'model_provider = "openai"', ''].join('\n'),
  ]) {
    const fixture = makeHome()
    try {
      fixture.write('.codex/config.toml', source)
      await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
      assert.equal(parseTomlish(fixture.read('.codex/config.toml')).top.model_provider, 'custom')
    } finally {
      fixture.cleanup()
    }
  }
})

test('codex: a profile key the scanner cannot read is refused, not assumed harmless', async () => {
  // "absent" and "here but unreadable" call for opposite answers: the first is
  // not a conflict, the second might be. cc-switch reads these files with a
  // real TOML parser and would see a value for an array or a float, so refusing
  // is the direction that cannot hide a switch that did nothing.
  for (const value of ['["a", "b"]', '1.5', '"""multi\nline"""']) {
    const fixture = makeHome()
    try {
      const source = ['profile = "work"', '', '[profiles.work]', `openai_base_url = ${value}`, ''].join('\n')
      fixture.write('.codex/config.toml', source)
      await assert.rejects(
        writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home }),
        (err) => err instanceof WriterError && err.kind === 'route' && err.key === 'openai_base_url',
        `${value} must be treated as a conflict`,
      )
      assert.equal(fixture.read('.codex/config.toml'), source)
    } finally {
      fixture.cleanup()
    }
  }
})

test('codex: a readable non-string profile key is skipped, as cc-switch skips it', async () => {
  // cc-switch's `non_empty_str` keeps only strings, so `openai_base_url = 123`
  // reads as absent there and must not refuse the write here.
  const fixture = makeHome()
  try {
    fixture.write('.codex/config.toml', [
      'profile = "work"',
      '',
      '[profiles.work]',
      'openai_base_url = 123',
      'experimental_bearer_token = true',
      '',
    ].join('\n'))
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    assert.equal(parseTomlish(fixture.read('.codex/config.toml')).top.model_provider, 'custom')
  } finally {
    fixture.cleanup()
  }
})

// --- Codex: reserved provider-table ids -------------------------------------

test('codex: a reserved table that is not ours is renamed, not destroyed', async () => {
  // Codex 0.148+ refuses to load the whole file when one of these ids carries a
  // provider table. CC Switch cannot tell which of the user's keys matter, so
  // it keeps the table and moves it aside; so does this.
  const fixture = makeHome()
  try {
    fixture.write('.codex/config.toml', [
      'model = "gpt-5"',
      '',
      '[model_providers.openai]',
      'name = "My own openai-shaped relay"',
      'base_url = "https://example.test/v1"',
      '',
    ].join('\n'))
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const parsed = parseTomlish(fixture.read('.codex/config.toml'))
    assert.equal(parsed.sections['model_providers.cc-switch'].name, 'My own openai-shaped relay')
    assert.equal(parsed.sections['model_providers.cc-switch'].base_url, 'https://example.test/v1')
    assert.ok(!Object.hasOwn(parsed.sections, 'model_providers.openai'), 'the reserved id no longer carries a table')
    assert.equal(parsed.sections['model_providers.custom'].base_url, 'https://api.deepseek.com/v1')
  } finally {
    fixture.cleanup()
  }
})

test('codex: a reserved table holding a real credential is renamed, never deleted', async () => {
  // The placeholder is the *only* value that proves a table is CC Switch's own
  // leftover, because it carries no credential. A bearer token that is anything
  // else may be the user's own key — and one of these ids is exactly where a
  // hand-written config would put one — so that table is moved aside with its
  // key intact. Deleting it here would destroy a credential nothing can restore.
  const fixture = makeHome()
  try {
    fixture.write('.codex/config.toml', [
      '[model_providers.openai]',
      'name = "my own openai-shaped relay"',
      'base_url = "https://mine.example/v1"',
      'experimental_bearer_token = "sk-users-own-key"',
      '',
    ].join('\n'))
    const result = await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const out = fixture.read('.codex/config.toml')
    assert.ok(!out.includes('[model_providers.openai]'), 'the reserved id no longer carries a table')
    assert.ok(out.includes('sk-users-own-key'), 'the user credential survives the move')
    const parsed = parseTomlish(out)
    assert.equal(parsed.sections['model_providers.cc-switch'].experimental_bearer_token, 'sk-users-own-key')
    assert.ok(result.files[1].removed.includes('model_providers.openai -> model_providers.cc-switch'))
    assert.ok(!JSON.stringify(result).includes('sk-users-own-key'), 'and it never crosses back out')
  } finally {
    fixture.cleanup()
  }
})

test('codex: the rename takes the first free cc-switch-N id', async () => {
  const fixture = makeHome()
  try {
    fixture.write('.codex/config.toml', [
      '[model_providers.cc-switch]',
      'name = "already here"',
      '',
      '[model_providers.ollama]',
      'name = "needs a new home"',
      '',
    ].join('\n'))
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const parsed = parseTomlish(fixture.read('.codex/config.toml'))
    assert.equal(parsed.sections['model_providers.cc-switch'].name, 'already here')
    assert.equal(parsed.sections['model_providers.cc-switch-2'].name, 'needs a new home')
    assert.ok(!Object.hasOwn(parsed.sections, 'model_providers.ollama'))
  } finally {
    fixture.cleanup()
  }
})

test('codex: a reserved table still holding the proxy placeholder is deleted', async () => {
  // The placeholder is the one value that proves a table is CC Switch's own
  // leftover rather than the user's, because it carries no real credential.
  const fixture = makeHome()
  try {
    fixture.write('.codex/config.toml', [
      '[model_providers.lmstudio]',
      'name = "cc-switch dormant route"',
      'experimental_bearer_token = "PROXY_MANAGED"',
      '',
    ].join('\n'))
    const result = await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const out = fixture.read('.codex/config.toml')
    assert.ok(!out.includes('[model_providers.lmstudio]'), 'the dormant table is gone')
    assert.ok(!out.includes('PROXY_MANAGED'), 'and so is the placeholder')
    assert.ok(!Object.hasOwn(parseTomlish(out).sections, 'model_providers.cc-switch'), 'nothing was renamed instead')
    assert.ok(result.files[1].removed.includes('model_providers.lmstudio'))
  } finally {
    fixture.cleanup()
  }
})

test('codex: amazon-bedrock is built in but not reserved, so its table is left alone', async () => {
  // Codex allows a table under the bedrock ids — that is how the region and
  // profile are set — so renaming it would destroy a working configuration.
  const fixture = makeHome()
  try {
    fixture.write('.codex/config.toml', [
      '[model_providers.amazon-bedrock]',
      'aws_region = "us-east-1"',
      '',
    ].join('\n'))
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const parsed = parseTomlish(fixture.read('.codex/config.toml'))
    assert.equal(parsed.sections['model_providers.amazon-bedrock'].aws_region, 'us-east-1')
    assert.equal(parsed.sections['model_providers.custom'].base_url, 'https://api.deepseek.com/v1')
  } finally {
    fixture.cleanup()
  }
})

test('codex: the route table is never written under a built-in id', async () => {
  // A table Codex reads as built-in is not a custom route at all, so the id the
  // writer picks has to be checked rather than assumed.
  const fixture = makeHome()
  try {
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const parsed = parseTomlish(fixture.read('.codex/config.toml'))
    assert.equal(parsed.top.model_provider, 'custom')
    for (const id of ['openai', 'ollama', 'lmstudio', 'amazon-bedrock', 'amazon-bedrock-runtime']) {
      assert.ok(!Object.hasOwn(parsed.sections, `model_providers.${id}`), `${id} must not carry our route`)
    }
    assert.equal(parsed.sections['model_providers.custom'].experimental_bearer_token, 'sk-new')
  } finally {
    fixture.cleanup()
  }
})

// --- the first-write backup -------------------------------------------------

/** The backup directory this plugin uses under a given home. */
function backupDir(home) {
  return join(home, '.dsh-ccswitch-plugin', 'backups', 'live-first-write')
}

/** The 12-hex key cc-switch derives from a file's absolute path. */
function backupKey(path) {
  return createHash('sha256').update(resolve(path)).digest('hex').slice(0, 12)
}

test('codex: the original bytes of both files are saved before the first write, once', async () => {
  const fixture = makeHome()
  try {
    const authBefore = '{"tokens": {"access_token": "original"}}\n'
    const configBefore = 'model = "gpt-5"\n'
    fixture.write('.codex/auth.json', authBefore)
    fixture.write('.codex/config.toml', configBefore)

    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    // A second activation must not overwrite the saved original.
    await writeCodexConfig({
      provider: { ...CODEX_PROVIDER, displayName: 'Second' },
      apiKey: 'sk-second',
      home: fixture.home,
    })

    const dir = backupDir(fixture.home)
    const authPath = join(fixture.home, '.codex', 'auth.json')
    const configPath = join(fixture.home, '.codex', 'config.toml')
    assert.equal(readFileSync(join(dir, `${backupKey(configPath)}-config.toml`), 'utf8'), configBefore)
    assert.equal(readFileSync(join(dir, `${backupKey(authPath)}-auth.json`), 'utf8'), authBefore)
    // Two backups and two markers, and no more: the second write added nothing.
    assert.equal(readdirSync(dir).length, 4, readdirSync(dir).join(', '))
  } finally {
    fixture.cleanup()
  }
})

test('codex: the .source marker records the original absolute path', async () => {
  const fixture = makeHome()
  try {
    const configPath = join(fixture.home, '.codex', 'config.toml')
    fixture.write('.codex/config.toml', 'model = "gpt-5"\n')
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const marker = join(backupDir(fixture.home), `${backupKey(configPath)}-config.toml.source`)
    assert.equal(readFileSync(marker, 'utf8'), resolve(configPath))
  } finally {
    fixture.cleanup()
  }
})

test('codex: a file that did not exist gets only the marker, never a fake original', async () => {
  // There were no original bytes to keep. Writing an empty backup would later
  // read as "the user's file was empty", which it never was.
  const fixture = makeHome()
  try {
    await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const dir = backupDir(fixture.home)
    const files = readdirSync(dir)
    assert.equal(files.length, 2, `one marker per file, no copies: ${files.join(', ')}`)
    for (const name of files) assert.ok(name.endsWith('.source'), `${name} must be a marker`)
    // A later write still finds the marker and does not start backing up.
    await writeCodexConfig({
      provider: { ...CODEX_PROVIDER, displayName: 'Second' },
      apiKey: 'sk-second',
      home: fixture.home,
    })
    assert.equal(readdirSync(dir).length, 2)
  } finally {
    fixture.cleanup()
  }
})

test('claude: the first write saves the original settings.json', async () => {
  const fixture = claudeFixture()
  try {
    await writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const path = join(fixture.home, '.claude', 'settings.json')
    const saved = readFileSync(join(backupDir(fixture.home), `${backupKey(path)}-settings.json`), 'utf8')
    assert.equal(saved, CLAUDE_EXISTING)
  } finally {
    fixture.cleanup()
  }
})

test('the first-write backup is parameterisable and written owner-only', async () => {
  // The backup root is a parameter for the same reason `home` is: it keeps the
  // tests off the real device state directory. The mode is 0600 because a
  // backup of settings.json or config.toml holds the same credential the live
  // file does.
  const fixture = makeHome()
  const root = join(fixture.home, 'elsewhere', 'first-write')
  try {
    const modes = []
    const recording = {
      read: async (path) => {
        try { return readFileSync(path) } catch (err) { if (err.code === 'ENOENT') return undefined; throw err }
      },
      write: async (path, content, mode) => { modes.push([path, mode]); writeFileSync(path, content) },
    }
    fixture.write('.codex/config.toml', 'model = "gpt-5"\n')
    await writeCodexConfig({
      provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home, io: recording, backupRoot: root,
    })
    assert.ok(existsSync(root), 'the parameterised root is where the backup went')
    assert.equal(existsSync(backupDir(fixture.home)), false, 'and not the default one')
    // config.toml existed, so it gets a copy and a marker; auth.json did not,
    // so it gets only a marker.
    const configPath = join(fixture.home, '.codex', 'config.toml')
    const key = backupKey(configPath)
    assert.equal(readFileSync(join(root, `${key}-config.toml`), 'utf8'), 'model = "gpt-5"\n')
    assert.equal(readFileSync(join(root, `${key}-config.toml.source`), 'utf8'), resolve(configPath))
    const underRoot = modes.filter(([path]) => path.startsWith(root))
    assert.equal(underRoot.length, 3, underRoot.map(([path]) => path).join(', '))
    for (const [path, mode] of underRoot) {
      assert.equal(mode, 0o600, `${path} must be owner-only, got 0o${Number(mode).toString(8)}`)
    }
  } finally {
    fixture.cleanup()
  }
})

test('a refused write takes no backup', async () => {
  // Refusal means the file is not touched, and a backup of a file nothing wrote
  // to would just be noise in a directory whose whole meaning is "the original,
  // saved once".
  const fixture = makeHome()
  try {
    fixture.write('.claude/settings.json', '{ this is not json')
    await assert.rejects(
      writeClaudeConfig({ provider: CLAUDE_PROVIDER, apiKey: 'sk-new', home: fixture.home }),
      (err) => err instanceof WriterError && err.kind === 'parse',
    )
    assert.equal(existsSync(backupDir(fixture.home)), false, 'nothing was backed up')
  } finally {
    fixture.cleanup()
  }
})

// --- Codex: the model-catalog pointer ---------------------------------------

test('codex: a pointer at a catalog CC Switch generated is dropped', async () => {
  // The generated catalog describes whichever provider was active when it was
  // written. Leaving the pointer behind keeps Codex reading a model list for a
  // route it no longer describes.
  const fixture = makeHome()
  try {
    fixture.write('.codex/config.toml', [
      'model = "gpt-5"',
      'model_catalog_json = "cc-switch-model-catalog.json"',
      '',
    ].join('\n'))
    const result = await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
    const parsed = parseTomlish(fixture.read('.codex/config.toml'))
    assert.equal(parsed.top.model_catalog_json, undefined, 'the stale pointer is gone')
    assert.ok(result.files[1].removed.includes('model_catalog_json'))
  } finally {
    fixture.cleanup()
  }
})

test('codex: the catalog filename is recognised wherever it is rooted', async () => {
  for (const pointer of [
    'cc-switch-model-catalog.json',
    '/home/me/.codex/cc-switch-model-catalog.json',
    'C:\\Users\\me\\.codex\\cc-switch-model-catalog.json',
    './sub/dir/cc-switch-model-catalog.json',
  ]) {
    const fixture = makeHome()
    try {
      fixture.write('.codex/config.toml', `model_catalog_json = ${JSON.stringify(pointer)}\n`)
      await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
      assert.equal(
        parseTomlish(fixture.read('.codex/config.toml')).top.model_catalog_json,
        undefined,
        `${pointer} must be recognised as ours`,
      )
    } finally {
      fixture.cleanup()
    }
  }
})

test('codex: a catalog belonging to someone else is left exactly as it is', async () => {
  // cc-switch's `foreign_catalog` / `live_catalog_is_ours` exist for this: a
  // pointer at a file this plugin did not generate belongs to the user or to
  // another tool, and deleting it would take away a catalog someone else
  // manages.
  for (const pointer of [
    '/home/me/my-own-catalog.json',
    'C:\\Users\\me\\.codex\\custom-models.json',
    'my-cc-switch-model-catalog.json', // a near miss: different base name
    'cc-switch-model-catalog.JSON',    // case matters, as it does for cc-switch
  ]) {
    const fixture = makeHome()
    try {
      // Compared as raw text: the point is that the line is byte-identical, and
      // a backslash in a Windows path is a TOML escape, so re-reading it
      // through a parser would test the reader rather than the writer.
      const assignment = `model_catalog_json = ${JSON.stringify(pointer)}`
      fixture.write('.codex/config.toml', `model = "gpt-5"\n${assignment}\n`)
      await writeCodexConfig({ provider: CODEX_PROVIDER, apiKey: 'sk-new', home: fixture.home })
      const out = fixture.read('.codex/config.toml')
      assert.ok(out.includes(assignment), `${pointer} belongs to someone else and must survive:\n${out}`)
    } finally {
      fixture.cleanup()
    }
  }
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
