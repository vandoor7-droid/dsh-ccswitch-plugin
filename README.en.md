# DSH CC Switch Manager

Manage CC Switch providers inside DeepSeek Harness: import Codex, Claude, Claude Desktop, OpenCode, Gemini, Hermes, Grok Build, Pi, MCode and OpenClaw providers into DSH, or add, edit and activate providers without CC Switch at all — and write them back into Claude Code's and Codex's own configuration files.

[中文 README](./README.md)

> **Derivative work notice**: this plugin is a **derivative** of [2995288295/dsh-ccswitch-importer-plus](https://github.com/2995288295/dsh-ccswitch-importer-plus) (Apache-2.0), which is itself a derivative of [wtiaw/dsh-ccswitch-importer](https://github.com/wtiaw/dsh-ccswitch-importer) (Apache-2.0). It is maintained by a third party and is **not any upstream author's official release**. The original version targets DSH 0.1.x; the intermediate fork reworked the Host/Client wiring for **DSH 0.2.0-rc.2**; this version continues from there. The npm package is `dsh-ccswitch-plugin`; the plugin id and loader id match the package name. See [NOTICE](./NOTICE) for the full attribution chain.

## Features

- Read-only scanning of `~/.cc-switch/cc-switch.db` for all ten custom provider kinds CC Switch 4.0.4 writes: **Codex**, **Claude**, **Claude Desktop**, **OpenCode**, **Gemini**, **Hermes**, **Grok Build**, **Pi**, **MCode**, and **OpenClaw**. Official and default profiles are skipped. **Gemini** is always reported as unimportable — the Gemini CLI speaks Google's native protocol and DSH's `llm-pi-ai` has no adapter for it — and the row names the endpoint it would have used.
- Imports endpoints, protocol, model IDs, and API keys into DSH’s `llm-pi-ai` settings.
- Reads API keys only in the Host process and stores them through DSH credentials as an `apiKeyEnv` reference; scan and import responses are redacted.
- Prefills reasoning from the top-level Codex TOML field `model_reasoning_effort` while keeping all values editable in DSH.
- Maps `none` to disabled reasoning; known models use a conservative catalog; unknown models receive only the imported level; invalid values disable reasoning with a warning.
- Re-imports preserve existing reasoning levels, route defaults, headers, capacity fields, and models that are absent from CCSwitch.
- Keeps the native Models page, CCSwitch import controls, and reasoning editor in one Models page.
- The CCSwitch import section, reasoning panel, and each model card can be collapsed; collapse preferences persist in the current browser.

### Provider manager (does not need CCSwitch)

**Settings -> Plugins** also carries a standalone provider manager. It keeps the provider
catalogue in the plugin's **own** settings namespace (`dsh-ccswitch-plugin.providers`), so it
works with **no CCSwitch installed at all**:

- Add, edit, duplicate and delete providers: display name, protocol, endpoint, model list, notes,
  icon, cost multiplier, and daily/monthly spend caps.
- 28 built-in presets (DeepSeek, Kimi, Zhipu GLM, SiliconFlow, OpenRouter, NVIDIA, MiniMax, Doubao,
  and more) to start from, or a blank form.
- **Activating** a provider does two independent things: it points DSH's own `llm-pi-ai` route at it,
  and it rewrites **that provider's own tool configuration** — currently **Claude Code**
  (`~/.claude/settings.json`) and **Codex** (`~/.codex/config.toml` and `auth.json`).
- Once the catalogue write succeeds that is the durable fact: a failure in either later step is
  reported in `warnings` rather than rolled back, and a retry finishes only the half that did not take.
  An app type with no writer is named explicitly instead of silently skipped.

### How the external writes behave

Writing another tool's configuration follows CC Switch's **floor** semantics, which is the part
most worth getting right:

- A provider **owns** a set of keys in the live file (connection and authentication). Switching clears
  those keys and then writes the target provider's values; every other key belongs to the user and the
  client and is left untouched, byte for byte.
- Writes are **order-preserving**: an existing key keeps its position, indentation and trailing comment,
  and the file's original indent character, CRLF/LF and trailing newline are all preserved — so writing
  twice produces identical bytes.
- A file that **cannot be parsed is refused rather than overwritten**. The plugin never rebuilds a
  config from an empty document: an error is better than destroying the user's configuration.

CCSwitch itself remains a read-only import source: after import, DSH settings and the credentials
service are authoritative, and the plugin never writes back to the CCSwitch database.

## Installation

> **Do not use `dsh plugin --profile desktop add`.** DSH refuses it:
> `error: profile "desktop" is managed exclusively by the Electron application`.
> The desktop profile is managed by the desktop app alone. Install by hand instead.

1. **Quit DSH completely first** (the desktop app rewrites both files below while running).

2. Install the package into the profile's pnpm project:

```bash
cd ~/.dsh/profiles/desktop
pnpm add github:vandoor7-droid/dsh-ccswitch-plugin
# or from a local checkout: pnpm add /path/to/dsh-ccswitch-plugin
```

3. Add the package name to `dsh.profile.bundles` in that directory's `package.json`:

```json
"dsh": {
  "profile": {
    "bundles": ["...", "dsh-ccswitch-plugin"]
  }
}
```

**Step 3 is not optional.** A plugin's `cordis.patch.yml` is a **bundle** patch, and DSH
only merges it for packages named in `dsh.profile.bundles`. Skip it and the dependency
installs cleanly while the plugin stays invisible — with no error at all; its row simply
never reaches the loader.

4. Restart DSH. Open **Settings -> Plugins** (the provider manager) and **Settings -> Models** (the CCSwitch importer).

> Installing from a local checkout copies the **built** output rather than linking to it.
> After changing the source, run `npm run build` and `pnpm add` again so DSH picks the new build up.

## Usage

1. Open **CCSwitch Import** on the Models page and click **Scan**.
2. Select the providers to import and click **Import selected**.
3. Review the import results and provider model list.
4. Confirm the prefilled reasoning levels in the reasoning section; edit wire values for a gateway when needed, then save.
5. Use the arrows in section headers or model cards to collapse and expand content; the preference is remembered automatically.
6. Use the saved reasoning levels from the composer model picker.

If a settings revision conflict occurs, the import stops and restores the credential written by that attempt; an existing credential is restored to its prior value.

## Reasoning Catalog

The conservative defaults include:

- GPT-5.6 family: `off: none`, `low`, `medium`, `high`, `xhigh`, and `max`.
- OpenAI o-series (`o1`, `o3`, `o4-mini` and variants): `off: null`, `low`, `medium`, and `high`.

The catalog is only a default. Saved DSH fields remain user-controlled.

## DSH Community Market Catalog

This plugin ships a standard catalog source for DSH Community Market as described in the [catalog adapter guide (path A: standard source)](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/catalog-adapter-guide.md). The repo includes:

- `scripts/build-catalog.mjs` — generates the `catalog-source` manifest and the `/v1/plugins` page from `package.json` metadata;
- `scripts/deploy-catalog.sh` — one-command Cloudflare Pages deployment (with JSON Content-Type rewrite rules);
- `test/catalog.test.mjs` — validates the output against the official schemas and asserts metadata consistency;
- [docs/catalog.md](./docs/catalog.md) — deployment options, Content-Type requirements, and source registration.

The repository is also tagged with the GitHub topic `dsh-plugin`, so it is automatically indexed by the [dshfind](https://dshfind.com) catalog source.

Build and deploy:

```bash
DSH_CATALOG_ORIGIN=https://catalog.example.com npm run build:catalog
```

## Security and Limitations

- Host routes accept only loopback, same-origin requests; API keys never enter the browser, logs, summaries, or error text.
- Reading requires Node.js 22.19 or newer for the read-only SQLite API.
- The plugin handles custom CCSwitch Codex / Claude / Claude Desktop / OpenCode / Gemini / Hermes / Grok Build / Pi / MCode / OpenClaw providers and the fields currently present in the database. "Test connection" first calls `{baseURL}/models` (free, no inference); only when the upstream does not expose a model list (`401`/`403`/`404`/`405`/`501`) does it send one **1-token** request to the endpoint the provider really uses, to tell "this relay hides `/models`" apart from "this key is genuinely invalid". It writes nothing, and on failure it shows the upstream's own error text (redacted).
- Unknown models and invalid levels default to disabled reasoning to avoid sending unconfirmed parameters to a gateway.

## Differences from upstream

Relative to [wtiaw/dsh-ccswitch-importer](https://github.com/wtiaw/dsh-ccswitch-importer) (`0.1.3`, 2026-09-24, targeting DSH 0.1.x):

**Compatibility rewrite for DSH 0.2.0-rc.2**

- Peer dependencies moved to `^0.2.0-rc.2`; the `@deepseek-ai/dsh-client-runtime` injection dropped in 0.2.0 was removed.
- Adapted to the 0.2.0 `{ ok, value }` remote envelope and the `settings.describe()` namespace view.
- Import sources expanded from Codex to all ten CC Switch 4.0.4 app types (Codex / Claude / Claude Desktop / OpenCode / Gemini / Hermes / Grok Build / Pi / MCode / OpenClaw).
- Added a model-catalog fallback, model probing, and loopback error surfacing.
- Mounts into the native Models page footer slot and coexists with the built-in UI.

**Fixes**

- Batch import previously succeeded only for the first provider: the settings revision is now re-read after every successful write and used as the precondition for the next one.
- Secret redaction changed from `sk-` shape matching to redaction by known secret **values**, so import responses and stderr never echo an API key.
- `POST /import` now requires a same-origin `Origin` header; an oversized request body destroys the connection instead of being silently ignored.
- If newer edits arrive while a reasoning save is in flight, the status reads "saved (unsaved changes)" rather than "saved".
- Empty scans now distinguish "CCSwitch not installed / no profiles / database unreadable / Node too old" and echo the probed path.
- `node:sqlite` is loaded lazily, so an unsupported Node version produces a readable message instead of a load failure.
- All UI strings go through the zh/en message catalogue instead of hard-coded Chinese.

**`0.2.0-rc.3` UI usability fixes**

- Blocked rows now say why: the host attaches a machine-readable `blockedCode` to every blocked reason (unknown values fall back to `blocked`), the panel localises it from the zh/en catalogue, and the variable part (app type, npm adapter) travels as `blockedDetail`.
- The refresh that follows an import no longer wipes the import report; rows show the provider name instead of the internal id, failures are marked in the error colour, and a "clear" action was added.
- The empty-state flash ("no CCSwitch provider found") is gone on first paint, and "scanning" and "importing" no longer share one button label.
- Reasoning panel: editing after a save flips the badge to "unsaved changes" instead of still claiming "saved"; the save button is disabled when the draft is unchanged, so it cannot burn a pointless settings write; "reload" asks before discarding local edits; and the level summary shows a "N custom" marker so a collapsed row still reveals customised wire values.

**`0.2.0-rc.4` test connection**

- Every importable row now has a "Test connection" button. It calls a new `POST /api/dsh-ccswitch/probe` route that only reaches `{baseURL}/models` and reports `connected · N models · Nms`, or the failure (`HTTP 401`, timeout, network, missing credentials) — on the row, where the decision is made.
- Probing is read-only by construction: the route never touches settings, and an import is not part of the request. A test asserts that the import path is called zero times.
- The button sits next to the badge rather than inside the row `<label>`, so clicking it no longer toggles the checkbox. Rows without a credential or a base URL show no button, and a single request probes at most 50 rows.
- Verdicts are sanitised on both sides (unknown reasons degrade to a network failure, counts and durations are clamped) and are dropped when the row they describe disappears from a re-scan. The host keeps redacting by secret value, so an error body never echoes the key.

**`0.2.0-rc.5` more trustworthy probing**

- A failure no longer reports a bare status code: the probe lifts the upstream's own error text out of the response body (redacted, flattened to one line, capped at 200 characters) and shows it on the row — `failed · HTTP 401 · Invalid token (request id: …)` instead of leaving the user to guess.
- A relay that blocks `/models` is no longer a false failure: when it answers `401`/`403`/`404`/`405`/`501`, the probe sends one minimal real request shaped for that provider's protocol (`openai-completions` → `/chat/completions`, `openai-responses` → `/responses`, `anthropic-messages` → `/messages`) with `max_tokens: 1`. If that succeeds the row reads `connected · minimal request · Nms`, naming the check that passed.
- The extra request only happens when the free check was inconclusive: an unreachable upstream (timeout/network) or a provider with no known model id never triggers a second call, and the import path still widens the model list from `/models` alone — so probing never quietly costs more.
- A Host that is behind its bundle is now recognised: if the probe request itself answers `401`/`404` (the running Host has no such route while the page already runs the new client), the row says "the host has not loaded this endpoint — restart DSH" instead of misreporting it as an upstream failure.

**`0.2.0-rc.6` the same-origin fence no longer blocks "Test connection"**

- Fixes a defect of my own: writes used to **require an `Origin` header**, but a browser is allowed to omit it on a same-origin POST — this UI does — so every click came back as `forbidden: missing Origin on a state-changing request` and the probe looked broken. Three equivalent proofs are now accepted: `Origin` matching `Host`, `Sec-Fetch-Site: same-origin` (set by the browser, unforgeable from script), or the client's own `x-dsh-ccswitch-origin` marker.
- A cross-site page can produce none of them: a custom header forces a CORS preflight this route never answers, and `Sec-Fetch-Site` is written by the browser. The fence is not weakened, only no longer aimed at the app's own page.
- A rejection now carries `saw: { origin, site, marker }` in the body, so the next failure says what actually arrived instead of leaving a bare `forbidden`.
- `/import` had exactly the same problem and is fixed with it.

The upstream copyright and license are kept unmodified in `LICENSE`; changed files carry a notice header and `NOTICE` records the modifications.

The port architecture, its mapping onto CC Switch, and what is deliberately left out are documented in [docs/ccswitch-port.md](./docs/ccswitch-port.md).

## Development and Verification

Requirements: Node.js 22.19 or newer.

```bash
npm install
npm test
npm run pack:check
```

`npm run build` creates the DSH Host bundle and the Client bundle with the required `window.__ModuleLoader__.load` registration. The release package contains only `dist`, the patch, the READMEs, `NOTICE`, and the license; source and tests are excluded.
