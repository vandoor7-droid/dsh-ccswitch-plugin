# cc-switch 4.0.6 · UX 面盘点（规格文档）

> 来源：`C:/Users/15726/AppData/Local/Temp/cc-switch-src`（`farion1231/cc-switch` v4.0.6，Rust/Tauri），由只读盘点产出。
> **本文是规格源**：插件侧每一块界面的存在与否、结构、措辞、快捷键，以本文为准；实现与本文冲突时先改实现。
> 裁剪口径（v2 计划）：顶部 app 切换条与窗口 chrome 已砍；Apps 安装器已砍；多 app 子导航与三模式切换按「只管 DSH、是否走代理」重解；**外部写入器相关的界面条目仅作参考，不得恢复**。

---

# CC Switch v4.0.6 — User-Facing UI/UX Surface Inventory

Source root: `C:/Users/15726/AppData/Local/Temp/cc-switch-src`
All paths below are relative to that root unless written absolute.

---

## 1. Screens / Navigation Model

### 1.1 Navigation model (the "v7" nav)

- **`src/lib/navigation.ts`** — the single source of truth for the route model. No URL router; views are React state persisted to `localStorage` (`cc-switch-last-view`, `cc-switch-last-app`).
  - `AppPage = "providers" | "workspace" | "openclawConfig" | "hermesMemory"`
  - `GlobalPage = "usage" | "auth" | "mcp" | "skills" | "skillsDiscovery" | "prompts" | "sessions" | "apps"`
  - `View = AppPage | GlobalPage | "settings"`
  - `SettingsSection = "general" | "appConfig" | "routing" | "network" | "data" | "about"` (`SETTINGS_SECTIONS`)
  - `sharedFeatureAppOf("claude-desktop") → "claude"` (Prompts & Sessions are shared between Claude Code and Claude Desktop).
  - Legacy view migration: `openclawEnv|openclawTools|openclawAgents → openclawConfig`.
  - `appPageBelongsTo()`: switching apps while on `workspace`/`openclawConfig`/`hermesMemory` bounces back to `providers`.

- **`src/App.tsx`** — the whole shell: `<Sidebar>` + `<main>` + global dialogs. `renderContent()` = settings | app page | global page. Settings remembers `settingsReturnViewRef` so "← Back" returns to the prior view; `Esc` exits settings.

### 1.2 Sidebar (left rail) — `src/components/shell/Sidebar.tsx`

Layout: top bar (44px, window drag region, brand `CC Switch`, collapse toggle) → **Apps group** (only scrollable region) → divider → **6 global items** → divider → **bottom pair: Apps + Settings**.

| Order | Item | Icon | Notes / evidence |
|---|---|---|---|
| — | Apps list | `AppGlyph` | `APP_IDS.filter(visibleApps)`; `AppNavItem`. Per-app **status badge**: red dot = `status.alert` (mode active but routing service down); pill tag `Routing`/`Aggregation`/`Mapping` when *not* selected (`modeTag()`). Collapsed: badge overlay on glyph + `HoverTip`. |
| 1 | MCP | `Server` | `globals[]` |
| 2 | Skills | `SkillsIcon` | selected also when `view === "skillsDiscovery"` |
| 3 | Prompts | `BookOpen` | |
| 4 | Sessions | `History` | |
| 5 | Accounts (`nav.auth`) | `KeyRound` | red dot + tooltip when `authNeedsAttention` (an account needs re-auth) |
| 6 | Usage | `ChartColumn` | trailing text `nav.todayCost` = today's spend, only when `todayCost > 0` |
| 7 | Apps | `LayoutGrid` | neutral dot when tool updates available (`appsUpdateAvailable`) |
| 8 | Settings | `Settings` | **green** dot when a CC Switch update exists (`hasUpdate`); clicking with update goes straight to `about` |

- Collapse/expand: `useSidebarCollapsed.ts` — collapsed = 72px icon rail, items become icon-only with `HoverTip`; persisted; **shortcut `Ctrl/Cmd + \`**.
- **Settings directory replaces the whole sidebar** when `view === "settings"` (`SettingsDirectory`): `← Back` row, `SETTINGS_ITEMS` (general / appConfig / routing / network / data / about), footer `CC Switch v{version}`.
- Skip link `#main-content`.

### 1.3 Page header — `src/components/shell/AppPageHeader.tsx`

52px header, whole bar is a window drag region, `leading | icon | title | subtitle | titleExtra | actions | windowControls`.
- App-page variant: `variant="app"` = 16px app name + 13px page name subtitle (`renderAppPageHeader` in `App.tsx`).
- `WindowControls` (`src/components/shell/WindowControls.tsx`) injected via context — always on Windows, opt-in on Linux (`settings.useAppWindowControls`).

### 1.4 App page header actions (`App.tsx: renderAppPageHeader`)

- `ProfileSwitcher` — **gated**: only when `settings.showProfileSwitcher === true` (default **false**) and `currentView === "providers"` and `activeApp !== "mcode"`.
- Hermes: `Web UI ↗` button (`openHermesWebUI` → confirm dialog → `hermesApi.launchDashboard()`).
- Provider search toggle (icon button, `⌘F/Ctrl+F` tooltip) — **gated** by `settings.showProviderSearch` (default **true**).
- `+ Add provider` (solid) — only on `providers` view.
- `HermesMemorySaveButton` — only on `hermesMemory` view.
- **⋯ menu** (`appMenu`): `View this app's sessions` → `sessions`; `View this app's usage` (only when `usageAppOf(app)` ∈ `KNOWN_APP_TYPES` = claude/codex/gemini/grokbuild/opencode/pi/mcode) → `usage` with app filter; `Config directory…` → settings `appConfig`; `Install & upgrade…` → `apps`; separator; `Hide from sidebar` (disabled when only 1 visible app).

### 1.5 Per-app sub-navigation (in-page tabs)

- **Proxy apps (Claude Code / Codex / Gemini CLI / Grok Build)** → `ModeTabs` segment control: **Direct / Routing / Aggregation** (Aggregation hidden for Gemini CLI & Grok Build — `modesFor()` in `src/components/providers/mode/SwitchModePanel.tsx`; `isStackAppId` = claude, codex).
- **OpenClaw** → `PageTabs`: `Providers | Workspace | OpenClaw config` (`App.tsx: renderAppSegments`). OpenClaw config has a second-level `PageTabs size="sm"`: `env | tools | agents`.
- **Hermes** → `PageTabs`: `Providers | Memory`.
- All other apps: no sub-tabs (provider list only).

### 1.6 Full-screen panels (dialog pattern)

`src/components/common/FullScreenPanel.tsx` — overlay covering the content area (sidebar still clickable), header with Back, footer with Cancel/Submit, `Esc` closes, tracks unsaved changes. Used by: Add provider, Edit provider, Universal provider form, Manage universal providers, Auth settings panel, Endpoint speed test, Usage script editor, Pricing edit modal, Workspace file editor, Daily memory panel.

---

## 2. Provider List UX

### 2.1 Container

- **`src/components/providers/ProviderList.tsx`** — renders a `DndContext` (`@dnd-kit`) of *sections*, each a `SortableContext` of cards.
  - **Search**: floating panel portaled to `document.body` at `fixed end-6 top-[6.5rem]`, opened by header button or `⌘/Ctrl+F` (suppressed when focus is in an editable field), closed by `Esc`. Matches `name + notes + websiteUrl + baseUrl` (case-insensitive). Shows scope hint + "Press Esc to close". Closing keeps the term but stops filtering.
  - **Drag reorder**: `useDragSort.ts` → `providersApi.updateSortOrder()` then `updateTrayMenu()`.
  - **Skeletons**: 3 dashed 60px placeholders while loading or while "live membership" is pending.
  - **Empty state**: `src/components/providers/ProviderEmptyState.tsx` — title + body + outline buttons `Import from current config` (hidden for `pi`/`mcode`) and `+ Add provider`, plus key-fields hint for claude/codex/gemini/grokbuild.
  - No-results state: dashed box "No providers match your search."
- **Sections builder**: `src/components/providers/presentation.ts` — `buildSwitchSections`, `buildDesktopSections`, `buildAdditiveSections`. This is the core "what each row looks like" logic.

### 2.2 Row (card) anatomy — `src/components/providers/ProviderCard.tsx`

Left→right inside a `rounded-panel` card (`min-h-[58px]`):

1. **Drag handle** (`GripVertical`, hidden until hover) — `dragHandleProps`.
2. **`ProviderIconBox`** — resolved icon or initial fallback, always white background (`resolveProviderIcon`).
3. **Name (`h3`)** + **chips** (`CardChipBadge`, tones: outline/direct/route/stack/success/warning/danger) + **health chip** (Operational / Degraded / Circuit open — only when in failover queue & proxy running, `useProviderHealth`).
4. **Second line**: either the Codex official account identity (login, `⚠ Needs re-authentication`, `⚠ Bound account unavailable` + `Choose account` link, `Loading account…`, or "account follows Codex CLI login"), **or** a clickable URL (notes → website → parsed base URL) that opens externally; non-clickable if notes exist or nothing configured.
5. **Quota column** (max 208px): one of `CopilotQuotaFooter`, `CodexOauthQuotaFooter`, `XaiOauthQuotaFooter`, `SubscriptionQuotaFooter`, `UsageFooter`, or "N plans" + expand chevron (multi-plan expand shows a full `UsageFooter` below the card).
6. **`ProviderCardActions`** (right): status/primary buttons → move up/down → pencil edit → ⋯ menu.

Card tone (current provider highlight):
- `direct` → `border-direct-border bg-direct-soft`
- `route` → `border-route-border bg-route-soft`
- `stack` → `border-stack-border bg-stack-soft`
- `neutral` → `border-border-strong bg-subtle` (OpenClaw default / Hermes current)
- otherwise plain `border-border bg-surface hover:border-border-strong hover:shadow-v7-sm`
- `presentation.dim` → opacity 60% (blocked-from-routing official subs, Hermes-managed, non-active OMO).

### 2.3 Right-side actions — `src/components/providers/ProviderCardActions.tsx`

- **Primary slot**: either a status line (colored dot + `In use` / `Routing` / `Current default` / `Default after switching` / `Current` / `Default`) **or** a primary icon button from `BUTTON_ICON` map: `switch`(Play) · `exitAndUse`(Plug) · `routeHere`(Route) · `queueAdd`(ListPlus) · `queueRemove`(ListMinus) · `setDefault`(Star) · `add`(Plus) · `remove`(Minus) · `enable`/`use`(Power) · `disable`(PowerOff). If `button.menu` present (OpenClaw "Set default ▾") it becomes a dropdown with model options.
- **Move up / Move down** (`ArrowUp`/`ArrowDown`) — failover queue reordering, disabled at ends.
- **Edit** (Pencil) — may carry `editDisabledReason` shown via `DisabledReason` tooltip.
- **⋯ menu** (ordered): mode-specific `menuItems` first (e.g. `Set as default`) → `Duplicate` → `Connectivity check` (spinner while testing; **hidden** for `mcode` and for `category === "official"`) → `Configure usage query` (hidden for official-without-subscription, Copilot, unbound Codex OAuth, xAI OAuth) → `Open terminal` (**only Claude Code**, `onOpenTerminal` passed only when `activeApp === "claude"`) → separator → `Delete` (red; `deleteDisabledReason` shown as sub-text, e.g. "in use, cannot delete").

### 2.4 Per-mode row behavior — `presentation.ts`

**Switch apps** (`buildSwitchSections` / `buildSwitchSectionsByView`):
- *Direct view* + direct active: current card = `tone: direct`, `status: In use`; others get `Switch` button (opens `needsRoute` dialog if provider needs routing).
- *Direct view* + routing/stack active: chips add `Used when direct`; buttons = `Back to direct and use` (disabled with reason if needs routing).
- *Routing view* + routing active + failover **off**: current = `Routing` status; others `Route here` (blocked official subs → dim + disabled with reason).
- *Routing view* + failover **on**: two sections — **`Queue — by priority (N)`** (with `?` help: reorder with arrows or drag; `P1…Pn` chips; health chip; `Remove from queue`) and **`Not in queue (N)`** (`Add to queue`, disabled for providers not supporting failover).
- *Routing view* + not actually routing: no row actions (activation only via the notice-bar CTA).
- *Stack view*: 3 sections — **`Default provider`** (or `Default provider after switching to Aggregation`; chip `Default`; status), **`Added — N`** (chip `N models` / `No models`; `Remove`; `Set as default ▾` in ⋯), **`Available — N`** (`Add`; official → disabled with reason; `Set as default` available even before adding).
- In-use providers get `deleteDisabledReason: "…in use, cannot delete"` regardless of the active view.

**Claude Desktop** (`buildDesktopSections`): single section; chips `Official` + `Model mapping`/`Direct`; current = tone + `In use` + non-deletable; others `Switch`.

**Additive apps** (OpenCode / OpenClaw / Hermes / Pi / MiniMax Code — `buildAdditiveSections`): two sections **`Added — N`** / **`Available — N`**, each with a `?` help on the "Added" title.
- OMO / OMO Slim (`category` `omo`/`omo-slim`): chips `OMO`/`Slim`, action `Enable`/`Disable` (mutually exclusive).
- OpenClaw: default provider shows `Default` status + `Default model X` chip and cannot be removed; others get `Set as default` (dropdown when >1 model).
- Hermes: current shows `Current` + cannot remove; `Managed by Hermes` chip → dim, edit & delete disabled with reason.
- Pi: `Enable`/`Add` and delete blocked while `piStateUnavailable` (with a `Notice` at top: "Couldn't read Pi's current config"); `Pi` delete confirm appends the "Pi default provider" warning.

### 2.5 Switch-mode provider page — `src/components/providers/mode/`

- **`ModeTabs.tsx`** — segmented control with sliding thumb, icons Plug/Route/Layers, active mode gets a colored dot; `?` HelpTip explaining the three modes; status line (`Direct is active — connected to X`, `Routing is active → X`, `Aggregation is active — default X — n more with m models`); right side: **Failover switch** (only when viewing & active on Routing) and **Routing settings** icon (opens `RouteSettingsSheet`).
- **`SwitchModePanel.tsx`** — notice stack above the list:
  - service down while in route/stack → warning Notice with `Start service` / `Back to direct`
  - startup attach failure → warning Notice with `Retry` + dismiss
  - stack catalog notice (`routeOwnsCatalog`) → `Adopt catalog` button
  - `CodexStaleClientsNotice`
  - **viewing a non-active mode** → neutral Notice "You're viewing …{view}. {app} is currently on {active}." with CTA `Start routing` / `Switch to Aggregation` / `Back to direct` (opens `ModeDialog`).
- **`ModeDialog.tsx`** — confirm dialogs: enter route/stack (with provider/official pick, consequence notes), `needsRoute` dialog (`Switch anyway` / `Route and use`).
- **`RouteSettingsSheet.tsx`** — side Sheet (420px) with link to full routing settings.
- **`DesktopAccessBar.tsx`** — Claude Desktop status bar: current provider + mapping/direct, routing service status, `Retry`, `Change port`, warning notices for stale models / missing mappings / base URL mismatch.

### 2.6 Import from live config

`ProviderList.importMutation`: `Import from current config` button (empty state + header-less path) → per-app APIs (`importDefault`, `importOpenCodeFromLive`, `importOpenClawFromLive`, `importHermesFromLive`, `importClaudeDesktopFromClaude`); toasts `importCurrentDescription` / `noProviders` / error.

---

## 3. Add / Edit Provider Dialog

### 3.1 Shell

- **Add**: `src/components/providers/AddProviderDialog.tsx` — a `FullScreenPanel` titled "Add provider", subtitle = app display name (or `{app}（聚合模式）` when opened from the Aggregation view). **Two steps**: `pick` → `form` (state resets to `pick` on every open; back button in step 2 returns to step 1). Footer (step 2): `Cancel` + `Add` (disabled while submitting / form not ready).
  - Nested full-screen panels: `UniversalProviderFormModal`, `UniversalProviderPanel` ("Manage universal providers"), `AuthSettingsPanel`, `LiveEditConflictDialog`.
  - Universal tab **hidden** for: `opencode, openclaw, hermes, pi, mcode, grokbuild, claude-desktop`.
  - Live-edit base projection: Claude reads live `settings.json` first ("Loading…"); Codex/Gemini/Grok use `getEditorView` draft projection; conflict resolution via `useLiveEditConflict`.
- **Edit**: `src/components/providers/EditProviderDialog.tsx` — same `FullScreenPanel`, title `Edit provider "{name}"`. Shows a neutral `Notice` when editing the currently-active provider of a switch app, naming the live file (`~/.claude/settings.json`, `~/.codex/config.toml`, `~/.gemini/.env`). Falls back to SSOT config when proxy takeover is active.

### 3.2 Step 1 — Preset picker (`src/components/providers/forms/ProviderPresetSelector.tsx`)

Portaled into the panel body (`PresetStepContext`):

- **Search field** (auto-focused, `⌘/Ctrl+F` re-focuses in capture phase, `Esc` clears) — matches name / display name / domain / aliases (`presetGroups.presetMatches`).
- **Left category rail (168px)** with counts, `dim` when searching and count = 0:
  `All` | `Account sign-in` | `Model vendors` | `Third-party platforms` | `Cloud providers` | `Plugin configs` | ── divider ── `Across apps` → `Universal providers`.
  Groups come from `presetGroups.ts` `PRESET_GROUP_ORDER` = `login, vendor, thirdparty, cloud, plugin`; `presetGroup()` derives category from `category`/`requiresOAuth`/`providerType`.
- **Two-column list of `PresetRow`** (52px cards: icon box, name, detail line, optional `Needs routing` badge). Fixed first row = **`Custom Configuration`** ("Fill in the request URL and API key yourself"). In "All", rows are grouped into sections with headers + a hint paragraph per category.
- Row detail line: `Matched: X` / login hint / `{domain} · n versions` / domain.
- No-results state → "no presets match …" + `Use custom configuration` button.
- Universal category → 2-col list of universal presets + `Manage universal providers` link (opens nested full-screen `UniversalProviderPanel`).
- Picking a row jumps straight to step 2.

### 3.3 Step 2 — Preset bar + version switch

- `PresetBar`: icon, family/preset name, `Needs routing` badge, domain line, **`Change`** button (back to step 1). "Custom Configuration" shows a slider icon + custom label.
- `VersionSwitch`: versions of the same family laid out by `presetVersionLayout()`:
  - `grid` (plan × region) → two `SegmentedControl`s (Plan / Region), switching one keeps the other;
  - `single` dimension → one `SegmentedControl`;
  - otherwise → `Select` dropdown.
  - If the user already edited the form (`useFormEditedSince` — listens to real `input`/`change` on the form, excludes preset-selector subtree and Radix hidden inputs) → a `ConfirmDialog` warns before switching version.

### 3.4 Form fields (step 2) — `ProviderForm.tsx` (3022 lines) + per-app field components

Always:
- **`BasicFormFields.tsx`** — grid: `Name*` (with clickable icon → **fullscreen IconPicker dialog**; `icon`/`iconColor` auto-filled from metadata) and `Notes`; then `Website URL`. IME-safe inputs; required marker via CSS `REQUIRED_LABEL`.
- **App-specific `providerKey` field inserted before name** for OpenCode / OpenClaw / Hermes (`beforeNameSlot`) — required, normalized `^[a-z0-9]+(-[a-z0-9]+)*$`, duplicate/invalid inline red messages, "locked" hint when the provider already exists in live config.
- **`settingsConfig` JSON editor** (last block) with live validation + `FormMessage`.

Per app:

| App | Component | Fields (evidence) |
|---|---|---|
| Claude Code | `forms/ClaudeFormFields.tsx` | OAuth sections (Copilot / Codex OAuth / xAI OAuth), `API key*` (`ApiKeySection`), template/parameter inputs for preset-specific variables, `API endpoint` (`EndpointField` + `Manage & test` → `EndpointSpeedTest`, `full URL` toggle, `auto-select fastest`), **Advanced collapsible**: `Upstream format` (Anthropic Messages / OpenAI Chat / OpenAI Responses / Gemini Native), `Auth field` (`ANTHROPIC_AUTH_TOKEN` default vs `ANTHROPIC_API_KEY`), **Model mapping table** (rows: Sonnet / Opus / Fable / Haiku / Subagent + fallback; columns: role, display name, actual request model, "supports 1M" checkbox) with `一键设置 / Set all` and `Fetch models` buttons, `Default fallback model` (`ANTHROPIC_MODEL`), `Custom User-Agent`, **local-proxy request overrides** (headers JSON / body JSON). Stack variant: `ClaudeStackModelsField` + advanced collapsible with only UA + overrides. |
| Codex | `forms/CodexFormFields.tsx` (1981) | OAuth sections, API key, endpoint + speed test, default model + fetch, **Advanced collapsible**: model mapping/catalog rows (with ★ default star in stack layout), **reasoning block** — `Prompt cache routing` (auto/enabled/disabled), `Supports thinking mode` switch, `Supports reasoning effort` switch, max output tokens, `impersonate Claude Code`, Copilot API format, remote compaction toggle, etc. |
| Grok Build | `forms/GrokBuildProviderForm.tsx` | Same family as Codex + `Context window` field + raw `config.toml` editor with TOML validation |
| Gemini CLI | `forms/GeminiFormFields.tsx` | API key, endpoint, model field, fetch models; `GeminiConfigEditor` (env + config panels) |
| Claude Desktop | `forms/ClaudeDesktopProviderForm.tsx` | Endpoint, model mapping on/off, model mode direct/proxy, official notice, fetch models, route-required validation |
| OpenCode | `forms/OpenCodeFormFields.tsx` | `npm package` select, `Base URL`, API key, headers, `Extra options` key/value rows (add/remove), `Models` list (fetch / add manually / id + name + expandable limits/details) |
| OpenCode OMO | `forms/OmoFormFields.tsx` | model variants, agents, categories, "other fields" |
| OpenClaw | `forms/OpenClawFormFields.tsx` | `API protocol` select, `Base URL`, API key, `Send User-Agent`, `Models` list (id/name + per-model reasoning config) |
| Hermes | `forms/HermesFormFields.tsx` | `API mode`, `Base URL`, API key, `Models` (id/name/context length), `Rate-limit delay` |
| Pi | `forms/PiProviderForm.tsx` | preset select (required), name, provider key, credential, compatibility options KV, models table (id/name/context/max tokens/thinking-level map), per-field validation messages |
| MiniMax Code | `forms/McodeProviderForm.tsx` | provider key + raw `settingsConfig` JSON |
| Universal | `universal/UniversalProviderFormModal.tsx` | separate full-screen form for cross-app providers |

Shared sub-components (`src/components/providers/forms/shared/`):
- **`ApiKeySection.tsx` / `ApiKeyInput.tsx`** — label + show/hide, `required` red `*`, disabled for `category === "official"` (placeholder "No API key needed for official providers"), inline `Get API key ↗` link when `websiteUrl` + `shouldShowApiKeyLink`, optional partner promotion line under the input.
- **`EndpointField.tsx`** — base URL with hint, `Manage & test` button, `full URL` toggle.
- **`ModelDropdown.tsx` / `ModelInputWithFetch.tsx` / `FetchedModelPicker.tsx`** — model list editing with `Fetch models` and a picker dialog.
- **`EndpointSpeedTest.tsx`** — full-screen endpoint manager: add endpoint (validates URL / HTTPS / duplicates), `Auto-select fastest`, `Test speed` (latency results, `Failed` state), remove, `Save`.
- **`CustomUserAgentField`, `LocalProxyRequestOverridesField`, `RequestHeadersEditor`, `StructuredOptionsEditor`, `InactiveFieldsPanel`** (shows config fields *not* used by this mode, with copy-to-clipboard).

### 3.5 Config editors (the "advanced / extra config")

- `forms/CommonConfigEditor.tsx` — Claude: label `settingsConfig` JSON + `keyFieldsHint` + inactive-fields disclosure (`Add to global settings…`).
- `forms/CodexConfigEditor.tsx` + `CodexConfigSections.tsx` — two panes: **`auth.json`** (JSON) and **`config.toml`** (TOML) with syntax validation, `Enable remote compaction` toggle, context-window / auto-compact limit hints, inactive fields panel, proxy-takeover storage notice.
- `forms/GeminiConfigEditor.tsx` + `GeminiConfigSections.tsx` — `.env` + config panes.
- Raw `JsonEditor` (`src/components/JsonEditor.tsx`, CodeMirror) used for opencode / openclaw / hermes / OMO with `showValidation`.

### 3.6 Validation feedback

- Zod schema `src/lib/schemas/provider.ts` + `react-hook-form` `<FormMessage/>` per field.
- **Soft validation**: on submit `ProviderForm` shows `ConfirmDialog` "Configuration has these issues" (bulleted list + "Save anyway? Saving may make switching fail") with `Save anyway` / `Cancel`.
- **Live edit conflict**: `LiveEditConflictDialog` — "The config file changed on disk" → `Cancel` / `Keep theirs` / `Keep mine` (retries submit with policy).
- Provider key duplicate/invalid inline errors (OpenCode/OpenClaw/Hermes).
- TOML/JSON parse errors surfaced in the editor.
- Pi form throws `PiFormValidationError` with localized messages.
- Unsaved-changes guard: `src/lib/unsavedChanges.ts` + `confirmLeave` in `App.tsx` → `ConfirmDialog` "Unsaved changes" on navigation/switch.

---

## 4. Quick Actions / Global UX

### 4.1 Tray (frontend side only)

There is **no tray UI in React** — the tray menu is built by the Rust backend. The frontend only:
- `src/hooks/useTrayNavigation.ts` — listens for `tray-navigate`, pulls `take_tray_navigation()`, and dispatches `{app, section, intent: "needsRoute"|"add", providerId}`. Handled in `App.tsx: useTrayNavigation` → `openSettings(section)` / `selectApp(app)` + open Add dialog or pop the **needs-route** dialog on the app page.
- `useTrayAppPageSeen(app)` — reports the visible app page to the tray on switch & window focus.
- `providersApi.updateTrayMenu()` called after add/edit/sort/switch/import/profile-apply.
- Settings: `settings.minimizeToTrayOnClose`.

### 4.2 Keyboard shortcuts (complete list found)

| Shortcut | Effect | File |
|---|---|---|
| `⌘/Ctrl + ,` | Open Settings (→ General; → About if an update exists) | `src/App.tsx:727` |
| `⌘/Ctrl + F` | Open provider search (suppressed inside editable fields) | `src/components/providers/ProviderList.tsx:236` |
| `⌘/Ctrl + F` (capture) | Focus preset-picker search | `forms/ProviderPresetSelector.tsx:549` |
| `⌘/Ctrl + \` | Toggle sidebar collapse | `src/hooks/useSidebarCollapsed.ts:163` |
| `Esc` | Close provider search; `skillsDiscovery → skills`; `settings → return view` | `ProviderList.tsx`, `App.tsx:735` |
| `Esc` | Close `FullScreenPanel` | `src/components/common/FullScreenPanel.tsx:106` |
| `Esc` | `discover → installed` | `skills/UnifiedSkillsPanel.tsx:380` |
| `Esc` (with text) | Clear search inputs | preset picker, `ui/search-field.tsx` |
| `j` / arrows | Session reader navigation | `sessions/reader/SessionReader.tsx:341` |
| `⌘/Ctrl+F` | Daily memory search | `workspace/DailyMemoryPanel.tsx:154` |
| `ArrowLeft/Right`, `Home`, `End` | Page tab roving focus | `ui/page-tabs.tsx:57` |

> Note: `App.tsx:711` has a comment mentioning `⌘K` for usage, but **no `⌘K`/command-palette handler exists** in the codebase (`ui/command.tsx` exists but is only used by `ProfileSwitcher`'s combobox).

### 4.3 Search / filter surfaces

| Surface | Component |
|---|---|
| Provider search panel (floating) | `providers/ProviderList.tsx` |
| Preset search (add-provider step 1) | `forms/ProviderPresetSelector.tsx` |
| MCP matrix search | `mcp/UnifiedMcpPanel.tsx` (`MatrixSearch`, count + "overwrite" note) |
| Skills installed search + status filter + updates filter | `skills/UnifiedSkillsPanel.tsx` |
| Skills discover search (repos / skills.sh) | `skills/SkillsPage.tsx` |
| Skills import search | `skills/SkillImportDialog.tsx` |
| Prompts search | `prompts/PromptPageFrame.tsx` + `PromptLibrary.tsx` |
| Sessions search + app filter | `sessions/SessionManagerPage.tsx` |
| Usage app/provider/model/date filters | `usage/UsageDashboard.tsx` |
| Profiles search (⌘K combobox) | `profiles/ProfileSwitcher.tsx` |
| models.dev pricing search | `usage/ModelsDevPickerDialog.tsx` |

### 4.4 Toasts / notifications

- `src/lib/toast.ts` (sonner) — success/error/warning/info toasts, many with `closeButton: true`, `description`, and **undo actions** (e.g. mode exit toast with `Undo` in `hooks/useModeActions.ts:139`).
- Event-driven toasts in `App.tsx`: `webdav-sync-status-updated` / `s3-sync-status-updated` auto-sync errors, `proxy-official-warning`, migration results, skills migration result.
- Inline `Notice` banners (`ui/notice.tsx`) with optional action buttons & dismiss — used in mode panel, MCP/skills failures, env conflicts, sessions, Pi errors.

### 4.5 Confirm dialogs

- `src/components/ConfirmDialog.tsx` — `variant: destructive | info`, optional custom confirm/cancel text, optional `checkboxLabel`, `zIndex` (`top`, `alert`).
- `V7ConfirmDialog` / `V7Dialog` in `mcp/formBits.tsx` (used by MCP/Skills).
- Instances: delete vs. remove provider (remove uses `info` variant since it's reversible), unsaved-changes leave, Hermes WebUI launch, failover first-enable, mode enter/route/stack, version switch, soft validation, restore backup, delete backup, import/delete MCP, uninstall/update skills, storage move, rebuild Codex usage, exit-all-routing, unify Codex history, universal delete/sync, star prompt dismiss.

### 4.6 Import / export / backup / restore

- **Settings → Data → Import & export** (`settings/ImportExportSection.tsx`): `Select config file` → `Import` (shows progress, success with `backupId`, partial success, failure), `Export config` (file picker → `exportConfigToFile`).
- **Backup manager** (`settings/BackupListSection.tsx`): auto-backup interval (hours/days) + retain count selects, `Create backup`, per-row `Restore` / `Download` / `Rename` / `Delete` with confirms; restore creates a safety backup and shows its ID.
- **Backup storage browser** (`settings/BackupStorageSection.tsx`): total size, legacy badge, item count, `Reveal` / `Delete`.
- **Cloud sync** (`settings/WebdavSyncSection.tsx`, 1864 lines): `Sync type` select (WebDAV / S3) — mutually exclusive, enforced by a dialog; WebDAV form (service preset select, URL, username, password, profile, remote root, auto-sync switch, last-sync + last-error, `Test` / `Save` / `Sync now` / `Fetch remote` / `Upload` / `Download`); S3 form (presets, region, bucket, access key id, secret, endpoint, remote root, profile, auto-sync, enabled, test/save/save-and-test/upload/download). Remote DB compat version shown; `incompatibleVersion` guard.
- **Deep link import** (`src/components/DeepLinkImportDialog.tsx`): parses `cc-switch://` payloads for provider / MCP / prompt / skill, shows fields (app, provider name, homepage, endpoint) and confirm; toasts for partial MCP success.
- **MCP import** from app configs + per-server JSON copy + "copy all" JSON.
- **Skills import**: from zip, from app configs (`SkillImportDialog` with search, select all/none, per-app sources), restore from backup (`SkillRestoreDialog`).
- **Prompts import** from the app's own file + `Copy file path` + cross-app copy dialog (`PromptCopyDialog`).

---

## 5. Settings Pages (6 sections)

`src/components/settings/SettingsPage.tsx` renders the current section into `SettingsBody` (max-width 760). Layout primitives: `SettingsBlock` (title + `?` help + section actions), `SettingsCard` (white card, divided rows), `SettingsRow` / `SettingsSwitchRow`. **Switch rows autosave; path rows need the section's `Save`.** A `Restart required` dialog (`Later` / `Restart now`) appears when the data directory changes.

### 5.1 General (`settings/sections/GeneralSection.tsx`)
- **Appearance**: `Language` select (zh / zh-TW / en / ja), `Theme` segmented (System / Light / Dark with icons).
- **Sidebar & header**: `Apps shown in sidebar` → `Go to apps ›`; `Show profile switcher` (switch, **default off**); `Show provider search` (switch, **default on**).
- **Updates**: `Check for tool updates on startup` (switch, **default off**).
- **Window & terminal**: `Launch on startup`; `Start silently` (only when launch-on-startup); `Minimize to tray on close`; `Use app window controls` (**Linux only**); `Preferred terminal` (`TerminalSelect`).

### 5.2 App config (`settings/sections/AppConfigSection.tsx`)
One `SettingsBlock` per app in order `claude, codex, gemini, grokbuild, opencode, openclaw, hermes, pi`, each titled with `AppGlyph + display name`, each with a `Save` button when dirty:
- Claude: `Enable Claude plugin integration`, `Skip Claude onboarding` switches.
- Codex: `CodexAuthSettings.tsx` — `Preserve official auth when switching`, `Unify Codex session history` (with confirm dialogs + restore-backup option), `Codex stack classic subagents` (+ forced-V2 note).
- All: `Config directory` `DirectoryInput` (browse / reset / resolved path).

### 5.3 Local routing (`settings/sections/RoutingSection.tsx`)
- **Service block**: status dot + uptime / `Stopped`, live stats (total requests, success rate, active connections), `Start` / `Stop` (stop disabled with reason while apps are using it); `Listen` row = address + port inputs (validated `1024–65535`) + `Save & restart`; `Enable request logging` switch.
- **`Apps using routing (N)`**: rows with app glyph, mode dot + label, detail, `Go to ›`; empty dashed box; `Exit all` button → info ConfirmDialog.
- **Failover block**: app `SegmentedControl` (claude/codex/gemini/grokbuild) + `proxy/AutoFailoverConfigPanel.tsx` — three sub-groups: *Retry & timeouts* (max retries, streaming first-byte timeout, streaming idle timeout, non-streaming timeout, failure threshold), *Timeouts*, *Circuit breaker* (success threshold, recovery wait, error-rate threshold %, min requests); `Reset` + `Save`.
- **Rectifier block**: `settings/RectifierConfigPanel.tsx` — enabled switch, thinking signature, thinking budget, media fallback, media heuristic, optimizer (thinking optimizer, cache injection).

### 5.4 Network (`SettingsPage` case `"network"`)
Single block: **Global outbound proxy** → `settings/GlobalProxySettings.tsx`: hint text, URL input (`http://…` / `socks5://…`) + `Scan` / `Test` / `Clear` icon buttons + `Save`; username + password (show/hide); detected-proxy chips to click-select; Enter saves.

### 5.5 Data (`SettingsPage` case `"data"`)
Blocks: **Data location** (CC Switch app-config dir `DirectoryInput` + `Save`) · **Import & export** · **Backup** (interval/retain/create/list/restore/rename/delete) · **Cloud sync** (WebDAV/S3) · **Log config** (`LogConfigPanel.tsx`: enable switch + level select error/warn/info/debug/trace with descriptions).

### 5.6 About (`settings/AboutSection.tsx`)
- Header row: app icon, `CC Switch`, `Version vX` (+ `Portable mode` badge when portable), primary button `Check for updates` → `Checking…` / `Update to vX` (solid) / `Downloading…`.
- Update notes block when available.
- Link row: `GitHub` (shown only after the star prompt is dismissed), `Official website` (ccswitch.io), `Release notes`, `What's new` (only if `whats-new/*.json` entries exist).
- Dismissible **"Star on GitHub"** promo strip (animated star, `Star on GitHub` + ✕).
- `WhatsNewDialog` (`src/components/WhatsNewDialog.tsx`): version headers, `Version details`, `Show earlier (n)`, `View full`, `OK`. Data: `src/whats-new/4.0.0…4.0.6.json`.

> **No hotkeys/shortcuts settings page exists.** Global proxy is under "Network", sync under "Data", failover/rectifier under "Local routing".

---

## 6. Global Pages

### 6.1 Apps (`src/components/apps/AppsPage.tsx`)
Table-style rows (`AppRow`) with columns `App | Version | (action) | Show in sidebar`:
- Rows: every tool (`claude`, then **Claude Desktop**, then codex, gemini, grokbuild, opencode, openclaw, hermes, pi, mcode from `TOOL_NAMES`).
- Per row: glyph, name (+ source pill `Homebrew/npm/Scoop/…`, env pill `WSL · distro`), default install path + `Other installs (n)` expander, version / `New version vX` / `⚠ Not runnable` / `Not installed`, action button `Install` / `Update`, visibility `Switch` (disabled at 1 remaining app).
- Claude Desktop row: `Connected` / `Not connected` / `Unsupported` + help tip.
- Expandable footer: install error line, WSL `Shell` + `flag` selects, install-conflict list (`ToolInstallRow`).
- Header: `Last checked {time}` / `Never checked`; `Update all (n)`; `Check for updates`; ⋯ → `Diagnose install conflicts…`, `Manual install commands…` (dialog with copyable commands).
- `ToolUpgradeConfirmDialog` on upgrades.
- Sidebar badge for this page when `checkToolUpdatesOnStartup` found updates.

### 6.2 MCP (`src/components/mcp/UnifiedMcpPanel.tsx`, 1138 lines)
- Header: `MCP` + help tip; actions `Import from apps`, `+ Add`, ⋯ → `Resync all`, `Copy all JSON`.
- Toolbar: search + `shown/total` count + "overwrite" note.
- **Matrix table** (`AppMatrix.tsx`): sticky column header with one column per MCP app (`MCP_APP_IDS` = claude, codex, gemini, grokbuild, opencode, hermes, pi, mcode — *Claude Desktop & OpenClaw excluded*), each with `enabled/total` and per-column `enable rest` / `disable all`.
- Row: name + transport badge (`stdio`/`http`/…) + `Not enabled` badge, mono summary line, per-app `MatrixCell` toggles (on/off/fail with retry link), `Edit` pencil, ⋯ → `Copy JSON`, `Open docs` (when docs/homepage/preset docs exist), `Enable everywhere`, `Disable everywhere`, ──, `Delete…`.
- Failure notices per app with `Retry`; load-failed and empty states; delete confirm; import report dialog with expandable per-app source file list.

### 6.3 Skills (`src/components/skills/UnifiedSkillsPanel.tsx`, 2089 lines) + marketplace
- Header `Skills` + help + clickable `N updates` filter chip; actions: solid **`+ Add ▾`** → `Discover`, `Install from ZIP…`, `Import (n)`; ⋯ → `Check for updates`, `Restore from backup…`, `Manage repositories…`, `Storage…`.
- **`PageTabs`: `Installed (N)` | `Discover`** (legacy `skillsDiscovery` view opens Discover directly; `Esc` returns).
- **Installed**: sticky header row with select-all checkbox → **bulk bar** (`N selected`, `Enable to ▾` per-app menu, `Disable ▾` per-app menu, more bulk actions), search + `Check updates` / `Update all (N)` button, status filter (`All` / `Updates` / `None` / `In {app}`), matrix rows per skill with app enable/disable cells, per-row ⋯ → `Update`, `Open docs`, `Copy directory`, `Uninstall…` (uninstall backs up first; info confirm). Banners: unmanaged-skills import banner (`Review import` / `Ignore`), repo-failure banner with `Retry`.
- **Discover (marketplace)** (`skills/SkillsPage.tsx`, 1027 lines): `SegmentedControl` source = **`Repos (n)` / `skills.sh`**, search field, `Install to ▾` target-app picker, `Only uninstalled` toggle, `Reload` icon button; result cards with install counts, `Installed (n)` / `Install` / `Installing…` / `Retry` states; repo-failure & no-results states with `Manage repositories` / `Show all`.
- Sub-panels: `RepoManagerPanel` (Sheet: add repo URL + branch, list with enable switch, open, delete), `SkillImportDialog`, `SkillRestoreDialog`, `SkillsStorageSheet` (location CC Switch vs unified, `Move` with confirm, `Open folder`, `Re-sync` with confirm).

### 6.4 Prompts (`src/components/prompts/PromptPanel.tsx`)
- `PromptPageFrame.tsx`: header `Prompts` + help, **app switcher dropdown** (`AppToggle` over `PROMPT_APP_IDS` = claude, codex, gemini, grokbuild, opencode, hermes, pi, mcode), count, primary `Add`, ⋯ → `Import from {file}`, `Copy file path`, target-file line with size/`file missing`/`empty` meta, search field with result count.
- `PromptLibrary.tsx` / `PromptListItem.tsx`: rows with **enable switch**, pencil edit, ⋯ → `Copy to apps…` (only when >1 app), `Copy content`, ──, `Delete…` (undo toast).
- `PromptFormPanel` (editor), `PromptCopyDialog` (multi-target), `PromptEmptyState`.
- `Pi` gets a dedicated `PiPromptPanel` (+ `PiNativePromptResources`).
- App notes: Claude Desktop shares Claude Code prompts; OpenClaw note.

### 6.5 Sessions (`src/components/sessions/SessionManagerPage.tsx`, 1464 lines)
- Header `Sessions` + help ("where sessions come from"); ⋯ → `Refresh list`, `Select multiple…`, `Preferred terminal…`, ──, `Where are session records…`.
- Toolbar: **app filter dropdown** (All apps + per-app glyph & count), **search** (title, directory, first/last message, session ID), **`SegmentedControl` group by: `By time` / `By project`**; match/total counter with `Select all` link in selection mode.
- Notices: Claude Desktop note, Pi relative-session-dir warnings.
- Row actions (via `SessionItem.tsx` + bulk bar): open, copy, delete (confirm), multi-select bulk.
- **Reader** (`sessions/reader/`): `SessionReaderHeader` — `Back`, session name, `prev/next`, `Resume in {terminal}` primary (+ ⋯: `Copy resume command`, `Copy cd + resume`, `Change terminal`, Codex note), ⋯ → `Copy as Markdown`, `Export markdown`, `Copy with thinking`, `Copy session ID`, `Copy source path`, `Reload`, `Delete…`; outline toggle, per-turn filter, usage/tokens badge. Timeline rows: steps, thinking, tool calls, diffs, images (+lightbox), notes, questions, final reply, code blocks.

### 6.6 Usage (`src/components/usage/UsageDashboard.tsx`, via `UsagePage.tsx`)
- Header `Usage` + help; actions: sync status text, **`Sync now`** (session sync), **refresh-interval dropdown** (`Off / 5s / 10s / 30s / 60s`), **`Data sources`** (sheet).
- Filter row: **app segmented chips** (All + one glyph-only chip per `KNOWN_APP_TYPES`: claude, codex, gemini, grokbuild, opencode, pi, mcode), **provider dropdown** (with counts), **model dropdown** (mono, counts), **`UsageDateRangePicker`** (presets 24h…30d…custom, with "preset shortcuts").
- Body: `UsageHero` metric cards (total cost, requests, real total + help, cache hit rate, fresh input, output, cache write, cache read, `More`) → `UsageHeatmap` (range = "All") or `UsageTrendChart` → tabs.
- **Tabs**: `Request logs` (with status-code dropdown `All/200/400/401/429/500`) | `Providers` | `Models` (both "sorted by requests") | `Pricing`.
  - `RequestLogTable` → `RequestDetailPanel` (side panel with tokens/detail).
  - `ProviderStatsTable`, `ModelStatsTable`, `TablePagination`.
  - `PricingConfigPanel`: billing basis (by response / by request), per-app model-source select, defaults block, `Edit` per row, `Import from models.dev`, `Add pricing`, pricing table (model, input/output/cache-read/cache-write per 1M), `PricingEditModal` (full-screen).
- `UsageDataSourcesSheet`: session scan coverage, `Sync now`, routing-logging switch + `Edit logging`, **Rebuild Codex usage…** (info confirm, auto-backup).
- Empty state: icon + title + body + `Sync now` + `Configure pricing`.
- Two confirm dialogs: rebuild Codex usage; toasts for sync.

### 6.7 Accounts / Auth Center (`App.tsx` "auth" view → `settings/AuthCenterPanel.tsx`)
Header: `KeyRound` icon, title `Accounts`, `?` help tip, **`Beta` badge**. Three card groups, each scrollable-to from the provider form's `Manage accounts`:
1. `CopilotAuthSection.tsx` — GitHub login button (`Sign in with GitHub`), account select (`Use default account` / managed accounts), `Manage accounts`, deployment type (github.com / Enterprise + enterprise domain), signed-in date, `Retry` on status failure, migration-failure notice.
2. `CodexOAuthSection.tsx` — `Sign in with ChatGPT`, account select with `⚠ Needs re-authentication` + `Re-authenticate now`, **`FAST mode` switch**, re-auth note, signed-in date, `Retry`.
3. `XaiOAuthSection.tsx` (`mode="manage"`) — status (account count / needs re-auth / not authenticated), account list with `Default` badge + `Set as default` + remove, `Add account or re-authenticate` / `Sign in with xAI` (device-code flow with copyable code), `Delete all xAI accounts…`, `Retry`.
Shared sub-components `settings/auth/{AccountQuota, ManagedAccountsGroup, accountDetails}.tsx`.
Also reachable as a **nested full-screen panel** from provider forms (`providers/AuthSettingsPanel.tsx`).

### 6.8 App-specific pages
- **Workspace** (OpenClaw) — `workspace/WorkspaceFilesPanel.tsx` (+ `WorkspaceFileEditor` full-screen, `DailyMemoryPanel` with `⌘F` search & full-screen mode), `Open directory` action.
- **OpenClaw config** — `openclaw/EnvPanel.tsx`, `ToolsPanel.tsx`, `AgentsDefaultsPanel.tsx`, plus `OpenClawHealthBanner` above the body.
- **Hermes memory** — `hermes/HermesMemoryPanel.tsx`: per-file tabs (with unsaved dot), enable switch per memory file, textarea with placeholder + character meter (`over limit by n` / `remaining n`), `Save`, `Open config` link.

---

## 7. Other Recurring Surfaces

| Surface | File | Notes |
|---|---|---|
| **Usage script editor** (per provider) | `src/components/UsageScriptModal.tsx` (1653 lines, full-screen) | `Enable usage query` switch, `Preset template` select, template variables with `Show/Hide` secret toggles, credentials config, auto-auth for Copilot, official-subscription hint, token-plan hint, timeout / auto-query-interval (integer-validated), `Test script` (per-template result summary), `Format JSON`, `Save configuration`, `Cancel` |
| **Quota / cost on cards** | `UsageFooter.tsx`, `SubscriptionQuotaFooter.tsx`, `CopilotQuotaFooter.tsx`, `CodexOauthQuotaFooter.tsx`, `XaiOauthQuotaFooter.tsx`, `quota/QuotaLines.tsx`, `quota/QuotaBreakdown.tsx` | total/used/remaining + reset countdown, multi-plan expand, failed-state tooltip |
| **Today's cost in sidebar** | `hooks/useSidebarStatus.ts` + `Sidebar.tsx` `nav.todayCost` | 60s refresh |
| **Failover queue UI** | routing view sections in `presentation.ts` + `proxy/AutoFailoverConfigPanel.tsx` + `ModeTabs` failover switch | P1…Pn, move up/down, drag, health chips |
| **Model catalog / fetch** | `forms/FetchedModelPicker.tsx`, `ModelInputWithFetch.tsx`, `modelMetadataFill.ts`, `lib/modelsDev.ts`, `usage/ModelsDevPickerDialog.tsx` | fetch-from-endpoint + models.dev import |
| **Icon picker** | `src/components/IconPicker.tsx` + `icons/extracted/*` (~130 brand icons) + `icons/extracted/metadata.ts` | fullscreen dialog from the name field's icon |
| **Profiles (config sets)** | `profiles/ProfileSwitcher.tsx`, `ProfileManageDialog.tsx` | cmdk combobox: search, snapshot per scope, `Create from current`, `None`, `Manage…` → rename/delete/create |
| **Universal (cross-app) providers** | `universal/UniversalProviderPanel.tsx`, `UniversalProviderFormModal.tsx` | list, add, sync to all apps, duplicate, delete (with confirms) |
| **Deep link import** | `DeepLinkImportDialog.tsx` | provider/MCP/prompt/skill confirm + risk preview (`utils/deeplinkRisk.ts`) |
| **First-run notice** | `FirstRunNoticeDialog.tsx` | default vs official-provider copy |
| **New layout notice** | `shell/NewLayoutDialog.tsx` | one-time v7 layout announcement + release notes link |
| **What's new** | `WhatsNewDialog.tsx` + `whats-new/*.json` | |
| **Env conflict banner** | `env/EnvWarningBanner.tsx` | sticky banner, dismissible per session, `Delete` conflicts, re-check |
| **Database upgrade** | `DatabaseUpgrade.tsx` | |
| **Frontend error boundary** | `FrontendErrorBoundary.tsx` | |
| **Codex stale clients notice** | `providers/CodexStaleClientsNotice.tsx` | |
| **Update context** | `contexts/UpdateContext.tsx` + `lib/updater.ts` | drives sidebar/about update dots; `UpdateChannel = stable | beta` exists in `lib/updater.ts` (no UI switch found) |

---

## 8. Gated / Disabled / Dead Items

- **Profile switcher** — gated by `settings.showProfileSwitcher`, **default off** (`App.tsx:1175`, `GeneralSection.tsx:123`).
- **Provider search button in header** — gated by `settings.showProviderSearch`, **default on**; ⌘F still works when hidden.
- **Tool update check** — `settings.checkToolUpdatesOnStartup` **default off**; sidebar dot + Apps-page update badges only appear when it's on and a newer tool version is found.
- **`useAppWindowControls`** — rendered only on Windows always, on Linux only if enabled; macOS always uses native decorations.
- **Hide current app from sidebar** — disabled when only one visible app is left; Apps page switch likewise disabled at count 1.
- **Connectivity check** — never offered for `mcode` or `category === "official"` providers.
- **"Configure usage query"** — hidden for official-without-subscription, Copilot, unbound Codex OAuth, and xAI OAuth providers.
- **"Open terminal" row action** — only wired for Claude Code.
- **Stack mode tab** — hidden for Gemini CLI & Grok Build (`modesFor`).
- **Universal provider tab** — hidden for opencode/openclaw/hermes/pi/mcode/grokbuild/claude-desktop.
- **Import button in empty state** — hidden for `pi` and `mcode`.
- **`useAppWindowControls` switch row** — Linux only.
- **Silent startup row** — only when launch-on-startup is on.
- **Delete** disabled with reason on the currently-in-use provider (switch apps, Claude Desktop current, OpenClaw default, Hermes current, Hermes-managed, Pi-blocked).
- **Edit** disabled for Hermes-managed providers ("Managed by Hermes — edit in its Web UI").
- **Stack "Add"** disabled for official accounts (`providerCard.reason.officialStack`) and for providers blocked from routing.
- **"Set as default" while routing** disabled (`providerCard.reason.defaultWhileRouting`).
- **Failed writes** on MCP/Skills/Prompts disable their whole toolbar (`controlsDisabled` / `navigationBlocked` / `managementBusy`) and block navigation out of the page.
- **Dead code**: `src/components/common/AppToggleGroup.tsx`, `AppCountBar.tsx`, `ManagementListSearch.tsx`, `ListItemRow.tsx` have **no importers anywhere** — leftover from the pre-v7 layout.
- **`⌘K` command palette**: mentioned in a comment in `App.tsx:711` but not implemented; `ui/command.tsx` (cmdk) is only used inside `ProfileSwitcher`.
- **No hotkey/shortcut settings page** — shortcuts are hard-coded (see §4.2).