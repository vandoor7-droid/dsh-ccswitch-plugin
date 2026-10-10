# cc-switch 4.0.6 · 后端命令面盘点（规格文档）

> 来源：`C:/Users/15726/AppData/Local/Temp/cc-switch-src`（`farion1231/cc-switch` v4.0.6，Rust/Tauri），由只读盘点产出。
> **本文是规格源**：328 个 Tauri 命令的分组、入参、返回与副作用，以本文为准。
> 裁剪口径（v2 计划）：单 app（只管 DSH 一家的供应商与模型配置）；外部工具写入器与 Apps 安装器的命令标为不移植；
> 其余命令在 `docs/ccswitch-command-map.md` 中逐条给出「移植 / 裁剪 / 改造为 DSH 路由」的去向。

---

# CC Switch v4.0.6 — Backend Capability Surface Inventory

**Scope:** `C:/Users/15726/AppData/Local/Temp/cc-switch-src/src-tauri/src/` (Rust/Tauri). `live/project/*` and `live/floor.rs` are owned by another agent — referenced here only where they intersect a backend feature.

**Headline numbers**
- **328 registered IPC entry points** in `src-tauri/src/lib.rs:1397-1766` (`tauri::generate_handler![...]`): **325 `commands::*`** + `tray::take_tray_navigation` + `tray::tray_app_page_seen` + `update_tray_menu`.
- 34 `commands/*.rs` files carry `#[tauri::command]` (counts below). **Every `#[tauri::command]` function in the tree is registered** — I diffed defined-vs-registered; no orphan commands.
- `SCHEMA_VERSION = 20` (`database/mod.rs:53`), 19 base tables (`database/schema.rs`).
- 10 app types (`app_config.rs:402-471`): `claude, claude-desktop, codex, gemini, grokbuild, opencode, openclaw, hermes, pi, mcode`.
  - `supports_local_proxy()` = `claude | codex | gemini | grokbuild` (`app_config.rs:448-453`)
  - `is_additive_mode()` = `opencode | openclaw | hermes | pi | mcode` (`app_config.rs:441-446`)

---

## 1. Command inventory (by feature area)

Each area lists: what the user can do → state kept → key source file.

### 1.1 Provider CRUD / switching / endpoints / model lists — `commands/provider.rs` (31)
`get_providers`, `get_current_provider`, `add_provider`, `update_provider`, `get_provider_editor_view`, `delete_provider`, `remove_provider_from_live_config`, `switch_provider`, `import_default_config`, `get_claude_desktop_status`, `get_claude_desktop_default_routes`, `import_claude_desktop_providers_from_claude`, `ensure_claude_desktop_official_provider`, `ensure_codex_official_provider`, `ensure_grokbuild_official_provider`, `read_live_provider_settings`, `update_providers_sort_order`,
`test_api_endpoints`, `get_custom_endpoints`, `add_custom_endpoint`, `remove_custom_endpoint`, `update_endpoint_last_used`,
`fetch_models_for_config` + `get_opencode_models` (`commands/model_fetch.rs`, service `services/model_fetch.rs`),
`queryProviderUsage`, `testUsageScript` (custom JS usage scripts executed in a QuickJS sandbox — `usage_script.rs`),
universal providers: `get_universal_providers`, `get_universal_provider`, `upsert_universal_provider`, `delete_universal_provider`, `sync_universal_provider`,
OpenCode: `import_opencode_providers_from_live`, `get_opencode_live_provider_ids`.

- **State:** `providers` + `provider_endpoints` tables (`database/dao/providers.rs`, `universal_providers.rs`); per-provider `meta.custom_endpoints`; live files per app (other agent).
- **Sort order = failover queue priority** (`commands/provider.rs:924-926`, comment: “排序就是故障转移队列的优先级，托盘按它列队列”).
- **Official preset seeding:** `database/dao/providers_seed.rs` — `OFFICIAL_SEEDS` ids `claude-official`, `claude-desktop-official`, `codex-official`, `gemini-official`, `grokbuild-official`; seeded at startup (`lib.rs:778-786`).
- ⚠️ **Frontend-only presets** (not backend): `src/config/*ProviderPresets.ts` (~20 files: claude/codex/gemini/grokbuild/opencode/openclaw/hermes/pi/mcode/claudeDesktop/universal/codingPlan/jiekou/ppio…), plus `presetFamilies.ts`, `presetModelMetadata.ts`, `presetSearchAliases.ts`, `mcpPresets.ts`. The backend only seeds the 5 official ones — **presets are a frontend data surface the port must replicate.**
- `switch_provider_test_hook` / `import_default_config_test_hook` / `get_pricing_model_source_test_hook` / `set_pricing_model_source_test_hook` are **not Tauri commands** — they're `#[cfg_attr(not(feature = "test-hooks"), doc(hidden))]` integration hooks (`commands/provider.rs:155-163`, `commands/proxy.rs:319-355`).

### 1.2 Mode / routing / local proxy — `commands/proxy.rs` (31)
See §2 for behaviour.
`start_proxy_server`, `stop_proxy_server`, `stop_proxy_with_restore`, `get_proxy_takeover_status`, `set_proxy_takeover_for_app`, `get_app_mode`, `set_proxy_route`, `take_startup_attach_failures`, `exit_proxy_apps_in_mode`, `get_direct_provider`, `get_proxy_status`, `get_proxy_config`, `update_proxy_config`, `get_global_proxy_config`, `update_global_proxy_config`, `get_proxy_config_for_app`, `update_proxy_config_for_app`, `get_pricing_model_source`, `set_pricing_model_source`, `is_proxy_running`, `is_live_takeover_active`, `switch_proxy_provider`, `get_proxy_stack`, `set_proxy_stack_member`, `adopt_codex_stack_catalog`, `restart_codex_app_server_daemon`,
`get_provider_health`, `reset_circuit_breaker`, `get_circuit_breaker_config`, `update_circuit_breaker_config`, `get_circuit_breaker_stats`.
- **State:** `proxy_config` (4 rows, one per proxy app), `provider_health`, `proxy_live_backup`; device file `~/.cc-switch/live-state.json`.
- `update_global_proxy_config` mirrors 4 global fields across all rows; restarts the service if address/port changed and rewrites attached clients (`commands/proxy.rs:229-254`).

### 1.3 Failover queue — `commands/failover.rs` (6)
`get_failover_queue`, `get_available_providers_for_failover`, `add_to_failover_queue`, `remove_from_failover_queue`, `get_auto_failover_enabled`, `set_auto_failover_enabled`.
- **State:** `providers.in_failover_queue` + `proxy_config.auto_failover_enabled` (`database/dao/failover.rs`). The legacy `failover_queue` table is **dropped** at migration (`database/schema.rs:426-427`).
- Enforces `require_failover_app` (only proxy-capable apps) and rejects Codex Official account cards (`commands/failover.rs:14-33`).
- Enabling failover first switches to P1, only then writes `auto_failover_enabled=true` (`commands/failover.rs:265-285`).

### 1.4 Config paths / live status / common snippets — `commands/config.rs` (13)
`get_claude_config_status`, `get_config_status`, `get_claude_code_config_path`, `get_config_dir`, `open_config_folder`, `pick_directory`, `get_app_config_path`, `open_app_config_folder`, `get_claude_common_config_snippet`, `set_claude_common_config_snippet`, `get_common_config_snippet`, `set_common_config_snippet`, `extract_common_config_snippet`.
- **State:** `~/.cc-switch/config.json` (legacy), settings flag `legacy_common_config_migrated`, auto-extract at startup `initialize_common_config_snippets` (`lib.rs:1999`).

### 1.5 Settings — `commands/settings.rs` (20)
`get_settings`, `save_settings`, `get_app_config_dir_override`, `set_app_config_dir_override`, `set_auto_launch`, `get_auto_launch_status`, `get_rectifier_config`, `set_rectifier_config`, `get_optimizer_config`, `set_optimizer_config`, `get_copilot_optimizer_config`, `set_copilot_optimizer_config`, `get_log_config`, `set_log_config`, `has_codex_unify_history_backup`, `codex_forces_multi_agent_v2`, `restore_codex_unified_history`, `restart_app`, `install_update_and_restart`, `check_app_update_available`.
- **State:** device-level `AppSettings` (`settings.rs:353-537`) persisted to `~/.cc-switch/settings.json` (also mirrored into the `settings` table); DB-level `rectifier_config`, `optimizer_config`, `copilot_optimizer_config`, `log_config`, `global_proxy_url`, `claude_desktop_gateway_token` (`database/dao/settings.rs:141,245,268,293,314`).
- Updater: `tauri_plugin_updater`, emits `update-download-progress` (`commands/settings.rs:248`).

### 1.6 Claude plugin / onboarding — `commands/plugin.rs` (6) + `claude_plugin.rs`
`get_claude_plugin_status`, `read_claude_plugin_config`, `apply_claude_plugin_config`, `is_claude_plugin_applied`, `apply_claude_onboarding_skip`, `clear_claude_onboarding_skip`.
- **State:** `~/.claude/config.json` (managed block `is_managed_config`), settings `enable_claude_plugin_integration`, `skip_claude_onboarding`.

### 1.7 Import / export / backup — `commands/import_export.rs` (14) + `commands/sync_support.rs` (0 cmds, helpers)
`export_config_to_file`, `import_config_from_file`, `save_file_dialog`, `open_file_dialog`, `open_zip_file_dialog`, `create_db_backup`, `list_db_backups`, `list_backup_locations`, `delete_backup_location`, `reveal_backup_location`, `restore_db_backup`, `rename_db_backup`, `delete_db_backup`, `sync_current_providers_live`.
- **Format:** SQL text dump with header `-- CC Switch SQLite 导出` (`database/backup.rs:16`); import runs through a rusqlite **authorizer** that rejects `ATTACH`/`DETACH`/`CREATE VTABLE`/unknown actions and only allows pragma `foreign_keys`,`user_version` (`database/backup.rs:46-70`).
- Post-import sync (`commands/sync_support.rs:10-38`): `sync_current_to_live` → `prompts sync_all_to_live` → `model_pricing::sync_local_model_pricing` → `reload_settings` → log level → `usage_cache.invalidate_all()`.
- **Backup categories:** `services/backup_storage.rs` (DB backups, skill backups, migration-generation backups, env-var backups `services/env_manager.rs:71`, live backup) — path always computed server-side, never from frontend.

### 1.8 Sync (WebDAV + S3) — `commands/webdav_sync.rs` (5), `commands/s3_sync.rs` (5)
See §3.

### 1.9 Deep link — `commands/deeplink.rs` (4) + `deeplink/`
`parse_deeplink`, `merge_deeplink_config`, `import_from_deeplink`, `import_from_deeplink_unified`.
- Scheme `ccswitch://v1/import?resource=provider|prompt|mcp|skill` (`deeplink/parser.rs:11-15`); handlers in `deeplink/{provider,prompt,mcp,skill}.rs`, tests in `deeplink/tests.rs` (995 lines).
- Registration: `tauri_plugin_deep_link` + `on_open_url` + single-instance argv scan (`lib.rs:369, 1046-1104`), helper `handle_deeplink_url` (`lib.rs:263`), emits `deeplink-import` / `deeplink-error`.

### 1.10 Project profiles (项目配置方案) — `commands/profile.rs` (6)
`list_profiles`, `create_profile`, `update_profile`, `delete_profile`, `clear_current_profile`, `apply_profile`.
- **State:** `profiles` table (id, name, `payload` JSON with per-app slots of provider/MCP/skills/prompt snapshots) + current marker in `settings` as `current_profile_id_<scope>` (`database/dao/profiles.rs:12-15`). Applies switch back to DB and emits `provider-switched` + `proxy-flags-changed` (`commands/profile.rs:90-94`).

### 1.11 Prompt library — `commands/prompt.rs` (13)
`get_prompts`, `upsert_prompt`, `delete_prompt`, `enable_prompt`, `import_prompt_from_file`, `get_current_prompt_file_content`, `get_prompt_file_location`, `get_pi_prompt_file`, `replace_pi_prompt_file`, `delete_pi_prompt_file`, `list_pi_prompt_templates`, `upsert_pi_prompt_template`, `delete_pi_prompt_template`.
- **State:** `prompts` table (PK `(id, app_type)`) + live prompt file per app (`prompt_files.rs:21`, `services/prompt.rs`, Pi: `services/pi_prompt_files.rs`). First-launch import for all 9 non-desktop apps (`lib.rs:1004-1030`).

### 1.12 Skills marketplace / manager — `commands/skill.rs` (27)
**Unified (v3.10.0+):** `get_installed_skills`, `get_skill_backups`, `delete_skill_backup`, `install_skill_unified`, `uninstall_skill_unified`, `restore_skill_backup`, `toggle_skill_app`, `scan_unmanaged_skills`, `import_skills_from_apps`, `discover_available_skills`, `check_skill_updates`, `resync_skills_to_apps`, `update_skill`, `migrate_skill_storage`, `get_cc_switch_skills_dir`, `open_cc_switch_skills_dir`, `search_skills_sh`.
**Legacy compat:** `get_skills`, `get_skills_for_app`, `install_skill`, `install_skill_for_app`, `uninstall_skill`, `uninstall_skill_for_app`, `get_skill_repos`, `add_skill_repo`, `remove_skill_repo`, `install_skills_from_zip`.
- **State:** SSOT filesystem `~/.cc-switch/skills/` (or `~/.agents/skills/` when `skill_storage_location=unified`), `skills` + `skill_repos` tables, backups in `~/.cc-switch/skill-backups/` (`services/skill.rs:4-6, 629-644`); sync methods `auto|symlink|copy` (`settings.rs:skill_sync_method`). Marketplace = GitHub repos + **skills.sh API** (`services/skill.rs:305-359`). 7487-line service.

### 1.13 MCP — `commands/mcp.rs` (15). See §5.

### 1.14 Managed/OAuth accounts — `commands/auth.rs` (8), `copilot.rs` (15), `codex_oauth.rs` (2), `xai_oauth.rs` (2), `subscription.rs` (1), `balance.rs` (1), `coding_plan.rs` (1). See §4.

### 1.15 Usage / cost stats — `commands/usage.rs` (21) + `commands/stream_check.rs` (1)
`get_usage_summary`, `get_session_usage_summary`, `get_usage_summary_by_app`, `get_usage_trends`, `get_usage_first_date`, `get_provider_stats`, `get_model_stats`, `get_request_logs`, `get_request_detail`, `get_model_pricing`, `update_model_pricing`, `update_model_pricing_batch`, `delete_model_pricing`, `get_models_dev_sync_config`, `save_models_dev_sync_config`, `record_models_dev_sync_result`, `check_provider_limits`, `sync_session_usage`, `rebuild_codex_usage`, `get_session_usage_last_sync`, `get_usage_data_sources`; plus `stream_check_provider`.
- **State:** `proxy_request_logs`, `usage_daily_rollups`, `model_pricing`, `stream_check_logs`, `session_log_sync`, `session_usage_dedup`; sidecar `~/.cc-switch/model-pricing.json` (`services/model_pricing.rs:103,294`); models.dev sync config in `settings`.
- All aggregations in `services/usage_stats.rs` (5561 lines; 13 `get_*` methods at :840-2194).
- `usage-log-recorded` event, 200 ms debounce (`usage_events.rs:18-24`).
- Pricing model source (`response` vs `request`) is a **global per-app** setting (`proxy_config.pricing_model_source`); the provider-level override is deprecated.

### 1.16 Session reader — `commands/session_manager.rs` (10)
`list_sessions`, `get_session_messages`, `stream_session_messages` (Tauri `Channel<TranscriptChunk>`), `get_session_block_content` (paginated, ≤512K chars), `get_session_image`, `reveal_session_path`, `export_session_markdown`, `delete_session`, `delete_sessions`, `launch_session_terminal`.
- **State:** read-only over client session stores; parse cache in `session_manager/{cache,content,model}.rs`; per-provider readers `session_manager/providers/{claude,codex,grokbuild,hermes,mcode,opencode,pi,grokbuild…}.rs`, terminal in `session_manager/terminal/mod.rs`. Spec: `session-manager.md` at repo root.

### 1.17 App lifecycle / OS integration — `commands/misc.rs` (13), `commands/env.rs` (3), `commands/lightweight.rs` (3)
- `open_external`, `copy_text_to_clipboard`, `get_init_error`, `get_migration_result`, `get_skills_migration_result`, `is_portable_mode`, `set_window_theme`, `check_for_updates` (misc.rs); **tool lifecycle**: `get_tool_versions`, `run_tool_lifecycle_action`, `probe_tool_installations`, `list_tool_installations`, `open_provider_terminal` (misc.rs is 9010 lines — install/update CLI for `claude, codex, gemini, grok, opencode, openclaw, hermes, pi, mcode`, with per-OS npm/curl/PowerShell command builders and WSL shell preference).
- Env vars: `check_env_conflicts`, `delete_env_vars`, `restore_env_backup` (backups to `~/.cc-switch/backups`, `services/env_manager.rs:71`).
- Lightweight mode: `enter_lightweight_mode`, `exit_lightweight_mode`, `is_lightweight_mode` — destroys the main window, tray-only (`lightweight.rs:6-35`).

### 1.18 Global **upstream** proxy (outbound) — `commands/global_proxy.rs` (5)
`get_global_proxy_url`, `set_global_proxy_url`, `test_proxy_url`, `get_upstream_proxy_status`, `scan_local_proxies`.
- Distinct from the local 15721 proxy: this is the HTTP proxy CC Switch uses **for its own outbound requests** (`proxy/http_client.rs::init`). Stored at `settings.global_proxy_url`; invalid config is auto-cleared at startup (`lib.rs:1240-1270`).

### 1.19 Tray — `lib.rs:1555,1601-1602`, `tray.rs` (2 commands)
`update_tray_menu`, `take_tray_navigation`, `tray_app_page_seen`.
- Menu model built in 3 layers (`collect_*` → `build_menu_model` → `attach_*`), 4 languages, sections: problems (max 2 rows) → feedback row → Open CC Switch → per-switchable-app submenus (Claude Code, Claude Desktop, Codex, Gemini CLI, Grok Build) → lightweight mode → website/quit (`tray.rs:1-13`).
- Tray event ids (`tray.rs:2646-2683`): `show_main`, `open_website`, `lightweight_mode`, `quit`, nav ids, profile ids, provider-switch ids.
- On hover/click: `refresh_all_usage_in_tray` (10 s throttle, `tray.rs:2687-2726`).

### 1.20 Per-app config surfaces
- **OpenClaw** `commands/openclaw.rs` (14): `import_openclaw_providers_from_live`, `get_openclaw_live_provider_ids`, `get_openclaw_live_provider`, `scan_openclaw_config_health`, `get/set_openclaw_default_model`, `get/set_openclaw_model_catalog`, `get/set_openclaw_agents_defaults`, `get/set_openclaw_env`, `get/set_openclaw_tools`. → `openclaw_config.rs`.
- **Hermes** `commands/hermes.rs` (10): `import_hermes_providers_from_live`, `get_hermes_live_provider_ids`, `get_hermes_live_provider`, `get_hermes_model_config`, `open_hermes_web_ui`, `launch_hermes_dashboard`, `get/set_hermes_memory`, `get_hermes_memory_limits`, `set_hermes_memory_enabled`. → `hermes_config.rs`.
- **OMO** `commands/omo.rs` (6): `read_omo_local_file`, `get_current_omo_provider_id`, `disable_current_omo`, `read_omo_slim_local_file`, `get_current_omo_slim_provider_id`, `disable_current_omo_slim`. → `services/omo.rs` (reads `~/.omo/omo.json`).
- **Pi** `commands/pi.rs` (3, `pub(crate)`): `get_pi_current_state`, `update_pi_provider_usage_script`, `get_pi_session_discovery`. → `pi_config/`, `services/pi_state.rs`.
- **Workspace / daily memory** `commands/workspace.rs` (8): `read_workspace_file`, `write_workspace_file`, `list_daily_memory_files`, `read_daily_memory_file`, `write_daily_memory_file`, `delete_daily_memory_file`, `search_daily_memory_files`, `open_workspace_directory`.

---

## 2. Local proxy / routing (port 15721)

**Yes — implemented in `proxy/` (data plane) + `mode/` (control plane) + `services/proxy.rs` (lifecycle).**

### 2.1 Server
- Default `listen_address 127.0.0.1`, `listen_port 15721` (`proxy/types.rs:44-55`); DB default column `listen_port … DEFAULT 15721` (`database/schema.rs:132`).
- Routes (`proxy/server.rs:299-425`): `/health`, `/status`; Claude `/v1/messages` + `/claude/v1/messages`; Claude Desktop gateway `/claude-desktop/v1/{models,messages}`; Chat `/chat/completions`, `/v1/chat/completions`, `/v1/v1/chat/completions`, `/codex/v1/chat/completions`; `/models`, `/v1/models`; Responses `/responses` (+GET=WS handshake), `/v1/responses`, `/v1/v1/responses`, `/codex/v1/responses`; GrokBuild `/grokbuild/v1/responses`; compact `/…/responses/compact`; `/…/alpha/search`; `/…/images/generations` + `/…/images/edits`; Gemini `any(/v1beta/*path)`, `any(/gemini/v1beta/*path)`, `any(/gemini/v1/*path)`; body limit 200 MB.
- Per-app proxy rows: 4 rows in `proxy_config` keyed `claude|codex|gemini|grokbuild`, with **different defaults** (`database/schema.rs:129-186`): claude `max_retries 6, first_byte 90, idle 180, circuit 8/3/90/0.7/15`; codex `3/60/120/600/4/2/60/0.6/10`; gemini `5/60/120/600/4/2/60/0.6/10`; grokbuild `3/…` (same as codex).

### 2.2 Failover / routing rules — `proxy/provider_router.rs`
- `select_providers_with_current` (`:62-133`):
  - failover **off** → single current route provider, circuit breaker not consulted.
  - failover **on** → **queue order only** (P1→P2…), from `db.get_failover_queue(app_type)`; each candidate filtered by `provider_supports_failover` and `breaker.is_available()`.
  - `provider_supports_failover` (`:15-19`): **Codex Official account cards never participate** (their native `Authorization` header would cross the account boundary).
  - all open → `AppError::AllProvidersCircuitOpen`; none → `NoProvidersConfigured`.
- Retry loop & accounting in `proxy/forwarder.rs:549-720`: `note_attempt` → `finish_success` (increments `failover_count` when the serving provider ≠ the one at request start, then spawns `FailoverSwitchManager::try_switch`) / `record_provider_failure` (feeds circuit breaker, continues to next candidate) / `finish_neutral_failure` (client errors don't trip the breaker).
- Rectifier-retry failures classified in `handle_rectifier_retry_failure` (`forwarder.rs:557-593`): Timeout/ForwardFailed/5xx → continue failover; other → return to client.
- Circuit breaker config live-updates: `update_circuit_breaker_config*`, `reset_circuit_breaker` (reset also auto-switches back to a higher-priority queue member — `commands/proxy.rs:408-413`).
- Stack mode **disables failover** (`proxy/handler_context.rs:133,167-170`; `commands/failover.rs` + `mode/controller.rs:975-977`).
- Post-failover route recording: `mode::controller::record_failover_route` (`mode/controller.rs:1433-1472`) — **only swaps the proxy upstream, does not rewrite client files**; ignored entirely in Stack mode (stale result).
- Cross-cutting protections: `proxy/switch_lock.rs` (per-app switch lock), `proxy/circuit_breaker.rs`, `proxy/error_mapper.rs`, `proxy/log_codes.rs`.

### 2.3 `costMultiplier` — **legacy / disabled**
- `ProviderMeta.costMultiplier` is explicitly documented as **已停用 (deprecated)** — retained only to round-trip for older-device sync (`provider.rs:506-509`).
- `proxy_config.default_cost_multiplier` exists in schema (`database/schema.rs:139`) but **is never read by runtime code** — the only non-schema occurrence is a test that asserts it is ignored (`proxy/response_processor.rs:1232-1293`, `test_log_usage_ignores_legacy_multiplier_and_provider_overrides`).
- Rows in `proxy_request_logs.cost_multiplier` are written as `1.0` (`proxy/usage/logger.rs:86,175,287`). Calculator still *accepts* a multiplier (`proxy/usage/calculator.rs:47-104`) but the caller passes `Decimal::ONE`.

### 2.4 `limitDailyUsd` / `limitMonthlyUsd` — **advisory only, not enforced in the proxy**
- Fields on `ProviderMeta` (`provider.rs:514-519`).
- Read only by `Database::check_provider_limits` (`services/usage_stats.rs:2102-2194`) which sums `proxy_request_logs` (detail + rollup) for today / this month and returns `ProviderLimitStatus {daily_limit, monthly_limit, daily_exceeded, monthly_exceeded…}` for the **UI**.
- **No code in `proxy/` reads these** (verified by grep) — the proxy will not reject a request on spend limits. The tray only uses them for a “快用完” warning (<20 %, `tray.rs:67-68`).

### 2.5 `PROXY_MANAGED` placeholders
- Canonical constant `PROXY_TOKEN_PLACEHOLDER = "PROXY_MANAGED"` (`live/project/claude.rs:199`); also hard-coded in `live/project/gemini.rs:231,237`, `live/project/grok.rs:344,455`.
- Upstream safety: `proxy/forwarder.rs:48` `PROXY_AUTH_PLACEHOLDER`; **`PROXY_MANAGED must never be sent upstream`** — `forwarder.rs:4153` returns `ProxyError::AuthError` if a managed account's token could not be resolved; tests at `forwarder.rs:5117-5167, 5571`.
- Import guard: rows carrying the placeholder / local proxy address must not be imported as real config (`services/provider/live.rs:1011`; `services/proxy.rs:271`).
- Direct-mode write-back refuses rows that still carry a placeholder, else the client would keep pointing at a dead proxy (`mode/controller.rs:488-512`).

### 2.6 `stack_default` alias mapping
- `mode/controller.rs:181-240` — `claude_contract(route, proxy_url, stack, stack_default)`: `stack_default` = the model of the **default member** (first in the list, `stack::claude_route_default`, `mode/stack.rs`), `None` in pure route mode.
- Four Claude aliases (startup default / background tasks / subagent / `--model opus`) point at `stack_default`'s model; the projection is written by `live/project/claude.rs:238-253` (other agent's file).
- With published Stack models: `/model` selector replaced via top-level `modelPicker {replaceBuiltInOptions:true, options:[…]}` and `CLAUDE_CODE_MAX_CONTEXT_TOKENS` = min window of non-1M Stack models (unless 200K) (`mode/controller.rs:205-239`).
- Stack id formats: Claude `ccs-claude-<key>--<model>`, Codex `ccs-<key>/<model>`; key ≤24 chars, **permanently allocated to a member**; unparsable ids **error, never fall back** (`mode/stack.rs:1-45`).
- Stack supported only for `claude` and `codex` (`mode/stack.rs:supports_stack`).

### 2.7 Mode controller API (`mode/controller.rs`, 7054 lines)
`enter` / `enter_with_route`, `attach`, `exit`, `exit_apps_in_mode`, `detach_all(keep_mode)`, `exit_all`, `switch_route_locked` / `switch_route`, `switch_route_for_failover`, `set_route`, `reject_unsupported_official`, `set_stack_member`, `stack_views` / `stack_view_with_clients`, `adopt_codex_stack_catalog`, `resync_codex_stack_catalog`, `resync_route_locked` / `resync_route` / `resync_saved_row_locked`, `resync_routes`, `record_failover_route`, `check_codex_official_models` (15-min background), `resync_codex_if_behind`, `startup`, `direct_provider_id`, `app_mode_view`, `startup_attach_failures(_snapshot)`.
Supporting: `mode/contract.rs` (contract hash = sha256 of env+exclusive+top, version 1), `mode/state.rs` (`live-state.json`, `Mode::{Direct,Proxy}`, `Contract`, `StackState`, `Pending*`), `mode/operation.rs` (write-ahead intent, forward-roll/crash recovery, `MAX_REPLANS = 3`), `mode/current.rs` (`Purpose::{Direct,InUse}` — two distinct “current provider” notions).

---

## 3. Sync (WebDAV + S3)

**Transport-agnostic protocol:** `services/sync_protocol.rs`.

- **Artifact set: `db.sql` + `skills.zip` + `manifest.json`** — i.e. **the whole database (minus local-only tables) plus the Skills SSOT archive.** Not per-entity.
- Constants (`services/sync_protocol.rs:30-41`): `PROTOCOL_FORMAT = "cc-switch-webdav-sync"`, `PROTOCOL_VERSION = 2`, `DB_COMPAT_VERSION = 6` (legacy 5), `MAX_MANIFEST_BYTES = 1 MiB`, `MAX_SYNC_ARTIFACT_BYTES = 512 MiB`.
- **What's excluded from export** (`database/backup.rs:86-105`):
  - `SYNC_SKIP_TABLES` (not exported): `proxy_request_logs, stream_check_logs, provider_health, proxy_live_backup, usage_daily_rollups, session_log_sync, session_usage_dedup`
  - `SYNC_PRESERVE_TABLES` (local data kept on import): same list minus `provider_health`.
  - `model_pricing` is **synced** but its local JSON sidecar is the user-owned SSOT (`sync_protocol.rs:67-69`).
- **Trigger tables for auto-sync** (`sync_protocol.rs:64-77`): `providers, provider_endpoints, mcp_servers, prompts, skills, skill_repos, profiles, settings, proxy_config`.
- **Conflict handling: there is no merge.** It is last-writer-wins at snapshot granularity:
  - `validate_manifest_compat` — format string, protocol version, and DB compat version must match exactly (Current layout: equal; Legacy layout: remote ≤ local) (`sync_protocol.rs:234-288`).
  - `verify_artifact` — sha256 + size limit.
  - `apply_snapshot` (`sync_protocol.rs:357-390`): under the skill state write-guard → backup current skills → `restore_skills_zip` → `db.import_sql_string_for_sync(sql)` → **rollback skills if DB import fails**.
  - No per-row merge, no device vector clocks; the manifest only records `deviceName` (+`createdAt`, `snapshotId`) — explicitly **no `deviceId`** (test `sync_protocol.rs:691`).
  - A single global `sync_mutex()` serialises upload/download across WebDAV and S3 (`sync_protocol.rs:46-60`).
- **WebDAV specifics** (`services/webdav_sync.rs`): remote layout `Current` (and `Legacy`) dirs, `db.sql` then `skills.zip` then `manifest.json` last (best-effort consistency), then `HEAD` for ETag; download verifies ETag/artifacts then applies. Commands: `webdav_test_connection`, `webdav_sync_upload`, `webdav_sync_download`, `webdav_sync_save_settings`, `webdav_sync_fetch_remote_info`.
- **S3 mirror:** `services/s3.rs`, `s3_sync.rs`, commands in `commands/s3_sync.rs`.
- **Schedule — change-triggered, not periodic.** `services/webdav_auto_sync.rs` / `s3_auto_sync.rs` workers are started in `lib.rs:1157-1163`. Flow: `notify_db_changed(table)` → channel (buffer 1) → **debounce 1000 ms, max wait 10 000 ms** (`AUTO_SYNC_DEBOUNCE_MS`, `MAX_AUTO_SYNC_WAIT_MS`, `auto_sync_wait_duration`) → **upload only** (no auto-download). Gated by `settings.webdav_sync.enabled && .auto_sync` / `s3_sync.*`. Suppression guard (`AutoSyncSuppressionGuard`) is held during import/restore so a restore doesn't trigger an immediate re-upload.
- **Status persistence:** `WebDavSyncStatus {last_sync_at, last_error, last_error_source, last_remote_etag, last_local_manifest_hash, last_remote_manifest_hash}` (`settings.rs:93-116`), emitted as `webdav-sync-status-updated` / `s3-sync-status-updated`.
- Credentials live in **device-local** `settings.json` (`WebDavSyncSettings{enabled, auto_sync, base_url, username, password, remote_root="cc-switch-sync", profile="default"}`, `settings.rs:118-190`; `S3SyncSettings` :193-253).

---

## 4. Managed / OAuth accounts

**Supported auth providers (the `meta.authBinding.authProvider` values):** `github_copilot`, `codex_oauth`, `xai_oauth` (`commands/auth.rs:15-16`, `claude_desktop_config.rs:389,497`, `commands/provider.rs:414`, `tray.rs:900` `MANAGED_OAUTH_PROVIDER_TYPES`).

| Provider | Manager / file | Token store (all under `~/.cc-switch/`) | Commands |
|---|---|---|---|
| **GitHub Copilot** (multi-account, device flow) | `proxy/providers/copilot_auth.rs` (`CopilotAuthManager`, `storage_path = data_dir/copilot_auth.json`, tmp+rename, **0600** at `:1465`) | `copilot_auth.json` | `copilot_start_device_flow`, `copilot_poll_for_auth`, `copilot_poll_for_account`, `copilot_list_accounts`, `copilot_remove_account`, `copilot_set_default_account`, `copilot_get_auth_status`, `copilot_logout`, `copilot_is_authenticated`, `copilot_get_token`, `copilot_get_token_for_account`, `copilot_get_models`, `copilot_get_models_for_account`, `copilot_get_usage`, `copilot_get_usage_for_account` (`commands/copilot.rs`) |
| **Codex OAuth (ChatGPT Plus/Pro)** | `proxy/providers/codex_oauth_auth.rs` (`storage_path = data_dir/codex_oauth_auth.json` at `:399`), state `CodexOAuthState(Arc<CodexOAuthManager>)` created in `AppState::new` (`store.rs:24`) | `codex_oauth_auth.json` | Generic `auth_*` for login/list/remove/default/logout + `get_codex_oauth_quota`, `get_codex_oauth_models` (`commands/codex_oauth.rs`) |
| **xAI OAuth (SuperGrok)** | `proxy/providers/xai_oauth_auth.rs` (`storage_path = data_dir/xai_oauth_auth.json` at `:211`), state `XaiOAuthState` | `xai_oauth_auth.json` | Generic `auth_*` + `get_xai_oauth_quota`, `get_xai_oauth_models` (`commands/xai_oauth.rs`) |
| **Google OAuth (Gemini)** | `proxy/providers/auth.rs` `AuthStrategy::GoogleOAuth` + `services/provider/gemini_auth.rs` | CLI's own creds (not CC Switch-managed) | — |

**Generic auth façade** (`commands/auth.rs`, 8 commands): `auth_start_login`, `auth_poll_for_account`, `auth_cancel_login`, `auth_list_accounts`, `auth_get_status`, `auth_remove_account`, `auth_set_default_account`, `auth_logout` — dispatches on `AUTH_PROVIDER_CODEX_OAUTH` / `AUTH_PROVIDER_XAI_OAUTH`; removing an account also `unbind_codex_managed_accounts` in `database/dao/providers.rs:24` so provider rows stop pointing at dead accounts.

**Token refresh:** done lazily inside the proxy forwarder on each request (fine-grained locks inside each `*OAuthManager`, no coarse `RwLock` — comments in `commands/codex_oauth.rs:14-19`). `PROXY_MANAGED` is resolved to a real token at forward time; failure is an `AuthError` and never forwarded upstream (`proxy/forwarder.rs:4153`).

**Other credentials:**
- Codex login stash `~/.cc-switch/codex-login-stash.json` (0600, not synced) — preserved across switches to third-party providers (`services/provider/codex_login.rs:11`).
- Codex official model cache `~/.cc-switch/codex-official-models.json` (`codex_official_models.rs:8`), refreshed by a 15-minute background check (`mode/controller.rs:1350-1353`).
- Claude Desktop gateway token: DB `settings.claude_desktop_gateway_token` (`claude_desktop_config.rs:29`).

**Subscription / quota / balance queries** (read CLI-native OAuth, not CC Switch's): `get_subscription_quota` (`services/subscription.rs`, 1969 lines; `subscription_grok.rs`), `get_coding_plan_quota` (`services/coding_plan.rs`, 3234 lines), `get_balance` (`services/balance.rs`).

---

## 5. MCP management

Three overlapping layers (two are marked deprecated):

1. **Claude-direct** (`claude_mcp.rs` + 5 commands): `get_claude_mcp_status`, `read_claude_mcp_config`, `upsert_claude_mcp_server`, `delete_claude_mcp_server`, `validate_mcp_command`. Operates on `~/.claude.json` `mcpServers`. On Windows it wraps `npx/npm/yarn/pnpm/node/bun/deno` in `cmd /c` (`claude_mcp.rs:12-40`).
2. **`config.json` SSOT (deprecated)** (`commands/mcp.rs:50-161`): `get_mcp_config`, `upsert_mcp_server_in_config`, `delete_mcp_server_in_config`, `set_mcp_enabled` — reads/writes `~/.cc-switch/config.json`.
3. **Unified DB-backed** (`commands/mcp.rs:162-219` + `database/dao/mcp.rs` + `services/mcp.rs`): `get_mcp_servers`, `upsert_mcp_server`, `delete_mcp_server`, `toggle_mcp_app`, `import_mcp_from_apps`, `resync_mcp_to_apps`.
   - `mcp_servers` row = one server with **8 per-app enable flags**: `enabled_claude|codex|gemini|grokbuild|opencode|mcode|hermes|pi` (`database/schema.rs:64-73`).
   - `resync_mcp_to_apps` takes each app's switch lock, writes independently, one failure doesn't affect others.

**Per-app syncers (`mcp/`):** `claude`, `codex` (TOML), `gemini`, `grokbuild`, `hermes`, `opencode` (local/remote format), `mcode`, `pi`, plus `validation.rs` (`mcp/mod.rs` re-exports `import_from_*` / `remove_server_from_*` / `sync_enabled_to_*` / `sync_single_server_to_*`).

**Gemini-specific:** `gemini_mcp.rs` reads/writes `mcpServers` in `~/.gemini/settings.json` with reverse-format conversion `httpUrl → url + type:"http"`, url-only → `type:"sse"`, command-only → `type:"stdio"` (`gemini_mcp.rs:33-40`).

First-launch auto-import from all 6 apps when the table is empty (`lib.rs:955-1002`).

---

## 6. Other product surfaces in the backend

| Surface | Evidence |
|---|---|
| **Session reading** | §1.16; spec `session-manager.md`; `session_manager/*` |
| **Prompt library** | §1.11; `services/prompt.rs` (1002 L), `prompt_files.rs`, `prompt.rs` |
| **Skills marketplace** | §1.12; GitHub repos + skills.sh discovery/search/update (`services/skill.rs`) |
| **Model catalog generation** (`cc-switch-model-catalog.json`) | `codex_config.rs:25` `CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME`; `model_catalog_json` pointer validation + symlink escape checks at `codex_config.rs:2500-2632`; reverse-parse only when the pointer is CC Switch's own catalog; `mode::controller::adopt_codex_stack_catalog` / `resync_codex_stack_catalog` (`:1273-1310`); Codex catalog merging `services/provider/codex_client_catalog.rs` |
| **Model capabilities registry** | `model_capabilities.rs` — `ImageInputCapability::{Supported,Unsupported,Unknown}`, `is_confirmed_text_only_model`, used by Codex catalog generation **and** proxy media rectification (fail-open for catalog, no-op for rectifier) |
| **Usage/billing stats** | §1.15; `services/usage_stats.rs`, `usage_cache.rs`, `session_usage*.rs` (Claude/Codex/Gemini/GrokBuild/OpenCode/Mcode/Pi), `proxy/usage/{calculator,logger,parser}.rs` |
| **Auto-launch** | `auto_launch.rs` (`AutoLaunch` crate; macOS AppleScript + `.app` bundle path resolution, Windows registry, Linux XDG); commands `set_auto_launch` / `get_auto_launch_status`; setting `launch_on_startup` |
| **Tray** | §1.19 |
| **Deeplink** | §1.9 |
| **Single instance** | `tauri_plugin_single_instance` (`lib.rs:359-401`) — exits lightweight mode, scans argv for `ccswitch://`, then unminimize/show/focus; `destroy_single_instance_lock()` (`lib.rs:2268`) releases the macOS `/tmp/{identifier}.sock` before `restart_process()` |
| **Codex state/history migration** | `codex_state_db.rs` — resolves every `state_5.sqlite` path (config dir + `sqlite_home`/`CODEX_SQLITE_HOME`), skips WSL 9P paths that can't lock. `codex_history_migration.rs` — 3 migrations: third-party provider bucket, provider template bucket, official-history unify; markers in device `settings.local_migrations`; backups under `~/.cc-switch/backups/codex-official-history-unify-v1/`; restore path `restore_codex_unified_history` + `has_codex_unify_history_backup`; serialized by `CODEX_OFFICIAL_HISTORY_OP_LOCK`. Triggered at startup on a blocking pool (`lib.rs:788-847`) |
| **Window/exit lifecycle** | close→tray (`lib.rs:435-466`), `classify_exit_request` (StayInTray / RESTART_EXIT_CODE / normal, `lib.rs:2215-2243`), `cleanup_before_exit` / `cleanup_before_system_exit` (`lib.rs:1944-1977`), `save_window_state_before_exit`, tray-icon `NIM_DELETE` hack (`lib.rs:1979-1997`), `restart_process` + macOS `open -n` relaunch (`lib.rs:2283-2299`) |
| **Crash/panic + logs** | `panic_hook.rs` → `~/.cc-switch/crash.log`; `tauri_plugin_log` to `~/.cc-switch/logs/cc-switch.log`, KeepSome(4) × 20 MiB, runtime level from `log_config` (`lib.rs:474-527`) |
| **Init/migration status** | `init_status.rs` — `InitErrorPayload{path,error,kind,db_version,supported_version}` incl. `db_version_too_new` recovery screen, migration-success + skills-migration result cells; recovery dialogs in `lib.rs:2086-2210` |
| **Legacy config migration** | `app_config.rs` — `MultiAppConfig::load()` v2 JSON; v1 rejected with a user-facing message (`:637-638`); JSON→SQLite one-shot with archive to `config.json.migrated` (`lib.rs:540-600`) |
| **Env-var conflict tooling** | §1.17 |
| **Speed / stream health** | `services/speedtest.rs` (endpoint latency), `services/stream_check.rs` (reachability only — **explicitly never touches the circuit breaker**, `stream_check.rs:14-16`) → `stream_check_provider` |
| **Proxy response pipeline (feature-bearing)** | `proxy/{body_filter,cache_injector,copilot_optimizer,content_encoding,error_mapper,gemini_url,media_sanitizer,model_mapper,opaque_state_rectifier,response_processor,thinking_optimizer,thinking_budget_rectifier,thinking_rectifier,tool_media}.rs` + protocol translators `proxy/providers/*` (Claude/Codex Responses/Codex Chat/Codex→Anthropic/Gemini, xAI sanitiser, Moonshot schema, reasoning bridge, inline think, streaming SSE variants) |
| **Auto-launch of proxy on start** | `mode::controller::startup` at `lib.rs:1203` handles legacy takeover state (`proxy_config.enabled` × backup row table at `mode/controller.rs:1473-1484`) |
| **Desktop updates / installers** | `install_update_and_restart`, `check_app_update_available`, `check_for_updates` |
| **Portability** | `is_portable_mode` |

**Emitted events:** `deeplink-import`, `deeplink-error`, `provider-switched`, `proxy-flags-changed`, `tray-navigate`, `usage-cache-updated`, `usage-log-recorded`, `webdav-sync-status-updated`, `s3-sync-status-updated`, `universal-provider-synced`, `update-download-progress`.

---

## 7. Data model

### 7.1 SQLite (`~/.cc-switch/cc-switch.db`, `SCHEMA_VERSION = 20`)

| # | Table | Stores | Key file |
|---|---|---|---|
| 1 | `providers` | PK `(id, app_type)`; `name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta(JSON), is_current, in_failover_queue` | `schema.rs:27-46` |
| 2 | `provider_endpoints` | custom endpoint URLs per provider, FK cascade | `schema.rs:50-60` |
| 3 | `mcp_servers` | id, name, server_config, description, homepage, docs, tags, **8 `enabled_<app>` flags** | `schema.rs:64-76` |
| 4 | `prompts` | PK `(id, app_type)`; name, content, description, enabled, timestamps | `schema.rs:79-83` |
| 5 | `skills` | id, name, description, directory, repo_{owner,name,branch}, readme_url, **7 `enabled_<app>` flags**, installed_at, content_hash, updated_at | `schema.rs:87-109` |
| 6 | `skill_repos` | PK `(owner, name)`, branch, enabled | `schema.rs:113-119` |
| 7 | `settings` | key/value — global proxy url, rectifier/optimizer/copilot-optimizer/log config, `official_providers_seeded`, `skills_ssot_migration_pending`, `current_profile_id_<scope>`, `claude_desktop_gateway_token`, gemini scrub audit flags | `schema.rs:123` |
| 8 | `proxy_config` | PK `app_type ∈ {claude,codex,grokbuild}` (4 rows); `proxy_enabled, listen_address, listen_port(15721), enable_logging, enabled, auto_failover_enabled, max_retries, streaming_first_byte_timeout, streaming_idle_timeout, non_streaming_timeout, circuit_{failure,success}_threshold, circuit_timeout_seconds, circuit_error_rate_threshold, circuit_min_requests, default_cost_multiplier, pricing_model_source, live_takeover_active, timestamps` | `schema.rs:129-186, 371-407` |
| 9 | `provider_health` | PK `(provider_id, app_type)`; is_healthy, consecutive_failures, last_success/failure_at, last_error | `schema.rs:189-195` |
| 10 | `proxy_request_logs` | per-request ledger: request_id, provider_id, app_type, model, request_model, pricing_model, token buckets, `input_token_semantics`, 4 cost columns + total (TEXT/Decimal), latency/first_token/duration, status_code, error, session_id, provider_type, is_streaming, cost_multiplier, created_at, `data_source` (`proxy`/`session`). 5 indexes + app/expr dedup indexes | `schema.rs:200-235` |
| 11 | `model_pricing` | model_id, display_name, input/output/cache_read/cache_creation $ per M | `schema.rs:239-247` |
| 12 | `stream_check_logs` | reachability probe history | `schema.rs:250-262` |
| 13 | `proxy_live_backup` | app_type → original_config snapshot (legacy takeover) | `schema.rs:268-273` |
| 14 | `usage_daily_rollups` | PK `(date, app_type, provider_id, model, request_model, pricing_model)`; request/success counts, tokens, total_cost, avg_latency | `schema.rs:280-300` |
| 15 | `session_log_sync` | per-file cursors: last_modified, last_line_offset, last_synced_at, `last_byte_offset`, `last_tail_fingerprint` (detects external rewrites) | `schema.rs:310-320` |
| 16 | `session_usage_dedup` | PK `(data_source, request_id)` → semantic_id, has_entry_id (fork/rewrite dedup ledger after detail pruning) | `schema.rs:325-340` |
| 17 | `profiles` | id, name, payload (JSON snapshot), sort_order, timestamps | `schema.rs:345-355` |

Migration history inside `schema.rs` (v1…v20), incl. `proxy_config` singleton→per-app (`migrate_proxy_config_to_per_app`), drop of `failover_queue`, skills v2→v3 SSOT. `database/migration.rs` covers JSON→DB data migration.

### 7.2 `~/.cc-switch/` (device-local, generally **not** synced)

| Path | Purpose | Evidence |
|---|---|---|
| `cc-switch.db` | main SQLite | `config.rs:313-357`, `database/mod.rs:98` |
| `settings.json` | `AppSettings` — device-level (explicitly “不随数据库同步”, multi-device independence) | `settings.rs:347, 605-614` |
| `config.json` (+ `.bak`, `.migrated`) | legacy MultiAppConfig / MCP SSOT | `config.rs:360`, `app_config.rs:714` |
| `live-state.json` | per-app `mode/attached/proxy_route/contract/written/stack/pending`, 0600, device-local | `mode/state.rs:1-16`, `mode/controller.rs:679` |
| `copilot_auth.json`, `codex_oauth_auth.json`, `xai_oauth_auth.json` | OAuth token stores (0600) | §4 |
| `codex-login-stash.json` | preserved Codex ChatGPT login | `services/provider/codex_login.rs:11` |
| `codex-official-models.json` | Codex official model cache | `codex_official_models.rs:8` |
| `model-pricing.json` | user pricing overrides (local SSOT) | `services/model_pricing.rs:103,294` |
| `skills/` | Skills SSOT (or `~/.agents/skills/` if unified) | `services/skill.rs:633`, `settings.rs:skill_storage_location` |
| `skill-backups/` | uninstall backups | `services/skill.rs:644` |
| `backups/` | DB backups, env-var backups, codex history-migration generations, `proxy-live-backup` | `services/backup_storage.rs:54`, `services/env_manager.rs:71`, `codex_history_migration.rs:203`, `mode/controller.rs:2746` |
| `logs/cc-switch.log`, `crash.log` | rotating logs + panic log | `lib.rs:474-527`, `panic_hook.rs:28` |
| `crash.log` path | panic hook | `panic_hook.rs:3-28` |

### 7.3 Tauri Store
- `app_paths.json` → `app_config_dir_override` (`app_store.rs:9`, refreshed early in `setup` at `lib.rs:466`); migrated from old settings (`app_store::migrate_app_config_dir_from_settings`, `lib.rs:1036`).

---

## 8. Dead / deprecated / legacy code to flag for the port

1. **`costMultiplier` and `proxy_config.default_cost_multiplier` are dead** — documented 已停用; runtime ignores them (`provider.rs:506-509`, `proxy/response_processor.rs:1232-1293`). Keep only as a sync round-trip field if you replicate old-device sync.
2. **`meta.pricingModelSource` (provider-level) deprecated** — global only now (`provider.rs:511-514`).
3. **`limitDailyUsd` / `limitMonthlyUsd` are UI-only advisory**, never enforced in the proxy.
4. **`failover_queue` table dropped** (`database/schema.rs:426-427`) — replaced by `providers.in_failover_queue`.
5. **MCP `*_in_config` commands are marked 已废弃** (`commands/mcp.rs:71`) — kept for the old per-app API.
6. **`webdav_backup` setting** retained purely for backward compat (`settings.rs:465-467`).
7. **Legacy takeover backup rows** (`proxy_live_backup`) are never replayed — they're drained to a device file and deleted (`mode/controller.rs:1579-1584`), to protect downgrades.
8. **`githubAccountId`** in provider meta — legacy read-only compat; new code writes `authBinding` (`provider.rs:552-555`).
9. **`commands/*_test_hook`** functions require `feature = "test-hooks"` and are *not* IPC commands.
10. **Tray excludes additive apps** (OpenCode/OpenClaw/Hermes/Pi/Mcode) — no “current provider” there (`tray.rs:5-7, 36`).
11. **Two legacy MCP/`config.json` layers coexist** with the unified DB layer (§5) — the port must pick/replicate all three command families for API compat.