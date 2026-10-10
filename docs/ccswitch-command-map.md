# cc-switch 4.0.6 · 命令映射表（M0 交付物）

> 本文把 `docs/ccswitch-backend-inventory.md` 盘点到的每一个 IPC 命令，逐条映射到 v2 计划（`fork-cc-switch-dsh-fork-fork-fork-mossy-robin.md`）单 app · 添加式范围下的去向；它是 M0 的交付物。
> 盘点头部数字为 328 个注册入口（325 个 `commands::*` + 3 个托盘命令）。`commands/s3_sync.rs` 的 5 个命令盘点只给了文件名、未列命令名，本表无法逐行对应（见文末「未覆盖」），故下表 **323 行**。六种去向：
> - `移植` — 按模块边界在 JS 里原样重写（决策 #7：常量与算法逐字转写，`↔` 标出镜像的 Rust 源）。
> - `移植·裁剪` — 重写，但按单 app / 仅 DSH 口径删减，删了什么写在备注。
> - `改造为插件路由` — 职责由 `/api/dsh-ccswitch-manager` 或 `/api/dsh-ccswitch` 下的 HTTP 路由承担，路由路径写在备注（已存在的注明「已存在」）。
> - `DSH 对应物` — 职责落到 DSH 既有设施（`settings`、`credentials`、`llm-pi-ai`、`webServer` 等），不新写实现，设施名写在备注。
> - `裁剪` — 不做。
> - `不适用` — 外部写入器退役或激活语义取消后，前提条件已消失，命令无消费者。
> 规则取自决策 **#2**（本地代理完整移植）、**#4**（添加式成员制取代激活）、**#5**（外部工具写入器退役）、**#6**（Apps 安装器砍、MCP/Skills/Prompts/Sessions/Usage/同步/备份/账号保留）；单 app 边界引用决策 **#3**。「分组」取盘点 §1.1–§1.20 自己的分节标题；「目标实现」为镜像 Rust 模块的计划 JS 路径，`—` 表示不新建插件模块（裁剪 / 不适用 / 由 DSH 对应物承担）。

## 映射表

| 命令 | 分组 | 单 app 裁剪后的去向 | 目标实现 | 备注 |
|---|---|---|---|---|
| `get_providers` | provider | 改造为插件路由 | `src/host/manager-routes.mjs` | `GET /api/dsh-ccswitch-manager/providers`（已存在） |
| `get_current_provider` | provider | 不适用 | — | 决策 #4：添加式成员集无单活跃指针 |
| `add_provider` | provider | 改造为插件路由 | `src/host/manager-routes.mjs` | `POST /api/dsh-ccswitch-manager/providers/save`（已存在） |
| `update_provider` | provider | 改造为插件路由 | `src/host/manager-routes.mjs` | `POST /api/dsh-ccswitch-manager/providers/save`（已存在） |
| `get_provider_editor_view` | provider | 改造为插件路由 | `src/host/manager-routes.mjs` | `GET /api/dsh-ccswitch-manager/providers`（编辑视图字段并入列表读取） |
| `delete_provider` | provider | 改造为插件路由 | `src/host/manager-routes.mjs` | `POST /api/dsh-ccswitch-manager/providers/delete`（已存在） |
| `remove_provider_from_live_config` | provider | 改造为插件路由 | `src/host/manager-routes.mjs` | `POST /api/dsh-ccswitch-manager/providers/withdraw`（外部投影退役，改成员式撤回） |
| `switch_provider` | provider | 不适用 | — | 决策 #4：「切换即重写」语义退役 |
| `import_default_config` | provider | 移植·裁剪 | `src/host/commands/provider.mjs` ↔ `src-tauri/src/commands/provider.rs` | 首启种子并入 cc-switch DB 导入通道，读 `~/.claude` 的分支裁掉；是否还需要 M1 再定 |
| `get_claude_desktop_status` | provider | 裁剪 | — | 决策 #3：claude-desktop 非管理对象 |
| `get_claude_desktop_default_routes` | provider | 裁剪 | — | 决策 #3：claude-desktop 非管理对象 |
| `import_claude_desktop_providers_from_claude` | provider | 裁剪 | — | 决策 #3：读取另一 app 的外部配置 |
| `ensure_claude_desktop_official_provider` | provider | 裁剪 | — | 决策 #3：官方种子只按管理对象播种 |
| `ensure_codex_official_provider` | provider | 裁剪 | — | 决策 #3：codex 非管理对象 |
| `ensure_grokbuild_official_provider` | provider | 裁剪 | — | 决策 #3：grokbuild 非管理对象 |
| `read_live_provider_settings` | provider | 改造为插件路由 | `src/host/manager-routes.mjs` | `GET /api/dsh-ccswitch-manager/providers` 的 `inUse` 字段（成员读取） |
| `update_providers_sort_order` | provider | 改造为插件路由 | `src/host/manager-routes.mjs` | `POST /api/dsh-ccswitch-manager/providers/reorder`（已存在；顺序即 failover 优先级） |
| `test_api_endpoints` | provider | 改造为插件路由 | `src/host/routes.mjs` | `POST /api/dsh-ccswitch/probe`（已存在） |
| `get_custom_endpoints` | provider | 移植·裁剪 | `src/host/commands/provider.mjs` ↔ `src-tauri/src/commands/provider.rs` | 端点子表裁为 provider 记录内字段，不建 `provider_endpoints` 表 |
| `add_custom_endpoint` | provider | 移植·裁剪 | `src/host/commands/provider.mjs` ↔ `src-tauri/src/commands/provider.rs` | 同上，随 `settings` 文档落盘 |
| `remove_custom_endpoint` | provider | 移植·裁剪 | `src/host/commands/provider.mjs` ↔ `src-tauri/src/commands/provider.rs` | 同上 |
| `update_endpoint_last_used` | provider | 移植·裁剪 | `src/host/commands/provider.mjs` ↔ `src-tauri/src/commands/provider.rs` | 只剩测速时间戳，随 provider 记录存 |
| `fetch_models_for_config` | provider | 改造为插件路由 | `src/host/routes.mjs` | `POST /api/dsh-ccswitch/probe`（模型发现复用 probeModels） |
| `get_opencode_models` | provider | 裁剪 | — | 决策 #3：opencode 非管理对象 |
| `queryProviderUsage` | provider | 移植 | `src/host/usage-script.mjs` ↔ `src-tauri/src/usage_script.rs` | QuickJS 沙箱用量脚本，决策 #6 保留（M4） |
| `testUsageScript` | provider | 移植 | `src/host/usage-script.mjs` ↔ `src-tauri/src/usage_script.rs` | 同上 |
| `get_universal_providers` | provider | 裁剪 | — | 单 app 下跨 app 复用无意义（计划「自然退化」） |
| `get_universal_provider` | provider | 裁剪 | — | 同上 |
| `upsert_universal_provider` | provider | 裁剪 | — | 同上 |
| `delete_universal_provider` | provider | 裁剪 | — | 同上 |
| `sync_universal_provider` | provider | 裁剪 | — | 同上 |
| `import_opencode_providers_from_live` | provider | 裁剪 | — | 决策 #3：opencode 非管理对象 |
| `get_opencode_live_provider_ids` | provider | 裁剪 | — | 决策 #3：opencode 非管理对象 |
| `start_proxy_server` | proxy | 移植 | `src/host/proxy/server.mjs` ↔ `src-tauri/src/proxy/server.rs` | 决策 #2：`127.0.0.1:15721` 路由表与 200MB body 上限照搬 |
| `stop_proxy_server` | proxy | 移植 | `src/host/proxy/server.mjs` ↔ `src-tauri/src/proxy/server.rs` | 决策 #2 |
| `stop_proxy_with_restore` | proxy | 不适用 | — | 决策 #5：停止后恢复客户端外部文件的半边已退役，停止本身由 `stop_proxy_server` 覆盖 |
| `get_proxy_takeover_status` | proxy | 不适用 | — | 决策 #5：接管状态读的是外部投影 |
| `set_proxy_takeover_for_app` | proxy | 不适用 | — | 决策 #5：接管即改写外部文件 |
| `get_app_mode` | proxy | 不适用 | — | 决策 #4/#5：Direct/Proxy 模式退化为「是否走代理」 |
| `set_proxy_route` | proxy | 不适用 | — | 决策 #5：路由写入=外部投影写入 |
| `take_startup_attach_failures` | proxy | 不适用 | — | 决策 #5：启动附着失败来自外部接管 |
| `exit_proxy_apps_in_mode` | proxy | 不适用 | — | 决策 #5：模式退出要还原外部文件 |
| `get_direct_provider` | proxy | 不适用 | — | 决策 #4：Direct 直连「当前供应商」已无意义 |
| `get_proxy_status` | proxy | 移植 | `src/host/proxy/server.mjs` ↔ `src-tauri/src/proxy/server.rs` | 决策 #2 |
| `get_proxy_config` | proxy | 移植 | `src/host/commands/proxy.mjs` ↔ `src-tauri/src/commands/proxy.rs` | 决策 #2：`proxy_config` 行参数与各 app 默认值 |
| `update_proxy_config` | proxy | 移植 | `src/host/commands/proxy.mjs` ↔ `src-tauri/src/commands/proxy.rs` | 决策 #2 |
| `get_global_proxy_config` | proxy | 移植 | `src/host/commands/proxy.mjs` ↔ `src-tauri/src/commands/proxy.rs` | 决策 #2：4 个全局字段镜像到各行 |
| `update_global_proxy_config` | proxy | 移植 | `src/host/commands/proxy.mjs` ↔ `src-tauri/src/commands/proxy.rs` | 决策 #2：地址/端口变更重启服务并重写已附着客户端 |
| `get_proxy_config_for_app` | proxy | 移植·裁剪 | `src/host/commands/proxy.mjs` ↔ `src-tauri/src/commands/proxy.rs` | 单 app：4 行配置收敛为 DSH 一行，`app_type` 参数裁掉 |
| `update_proxy_config_for_app` | proxy | 移植·裁剪 | `src/host/commands/proxy.mjs` ↔ `src-tauri/src/commands/proxy.rs` | 同上 |
| `get_pricing_model_source` | proxy | 移植 | `src/host/commands/proxy.mjs` ↔ `src-tauri/src/commands/proxy.rs` | 决策 #2：全局 `response`/`request` 口径，供应商级覆盖已废弃 |
| `set_pricing_model_source` | proxy | 移植 | `src/host/commands/proxy.mjs` ↔ `src-tauri/src/commands/proxy.rs` | 同上 |
| `is_proxy_running` | proxy | 移植 | `src/host/proxy/server.mjs` ↔ `src-tauri/src/proxy/server.rs` | 决策 #2 |
| `is_live_takeover_active` | proxy | 不适用 | — | 决策 #5：接管标记读自外部投影状态 |
| `switch_proxy_provider` | proxy | 不适用 | — | 决策 #4：代理上游改由 failover 队列顺序决定 |
| `get_proxy_stack` | proxy | 不适用 | — | 决策 #5：Stack 投影由 `live/project/*.rs` 写入外部文件 |
| `set_proxy_stack_member` | proxy | 不适用 | — | 决策 #5：同上 |
| `adopt_codex_stack_catalog` | proxy | 不适用 | — | 决策 #5：Codex 模型目录指针写入外部文件 |
| `restart_codex_app_server_daemon` | proxy | 裁剪 | — | 决策 #3：codex 外部工具的进程管理，单 app 不做 |
| `get_provider_health` | proxy | 移植 | `src/host/commands/proxy.mjs` ↔ `src-tauri/src/commands/proxy.rs` | 决策 #2：`provider_health` 表 + 健康 chip |
| `reset_circuit_breaker` | proxy | 移植 | `src/host/proxy/circuit-breaker.mjs` ↔ `src-tauri/src/proxy/circuit_breaker.rs` | 决策 #2：重置后自动切回更高优先级成员 |
| `get_circuit_breaker_config` | proxy | 移植 | `src/host/proxy/circuit-breaker.mjs` ↔ `src-tauri/src/proxy/circuit_breaker.rs` | 决策 #2 |
| `update_circuit_breaker_config` | proxy | 移植 | `src/host/proxy/circuit-breaker.mjs` ↔ `src-tauri/src/proxy/circuit_breaker.rs` | 决策 #2：热更新 |
| `get_circuit_breaker_stats` | proxy | 移植 | `src/host/proxy/circuit-breaker.mjs` ↔ `src-tauri/src/proxy/circuit_breaker.rs` | 决策 #2 |
| `get_failover_queue` | failover | 移植 | `src/host/commands/failover.mjs` ↔ `src-tauri/src/commands/failover.rs` | 决策 #2：队列顺序即 P1→Pn 故障转移顺序 |
| `get_available_providers_for_failover` | failover | 移植 | `src/host/commands/failover.mjs` ↔ `src-tauri/src/commands/failover.rs` | 托管账号卡不得入队的规则保留 |
| `add_to_failover_queue` | failover | 移植 | `src/host/commands/failover.mjs` ↔ `src-tauri/src/commands/failover.rs` | 决策 #2 |
| `remove_from_failover_queue` | failover | 移植 | `src/host/commands/failover.mjs` ↔ `src-tauri/src/commands/failover.rs` | 决策 #2 |
| `get_auto_failover_enabled` | failover | 移植 | `src/host/commands/failover.mjs` ↔ `src-tauri/src/commands/failover.rs` | 决策 #2 |
| `set_auto_failover_enabled` | failover | 移植 | `src/host/commands/failover.mjs` ↔ `src-tauri/src/commands/failover.rs` | 启用先切到 P1 再置位的顺序照搬；Stack 关 failover 的约束随 Stack 退役 |
| `get_claude_config_status` | config | 裁剪 | — | 决策 #3/#5：读 `~/.claude` 配置状态，无消费者 |
| `get_config_status` | config | 裁剪 | — | `~/.cc-switch` 自身目录状态，插件数据在 DSH `settings` 文档 |
| `get_claude_code_config_path` | config | 裁剪 | — | 决策 #3/#5：Claude Code 外部配置路径 |
| `get_config_dir` | config | 裁剪 | — | `~/.cc-switch` 目录，插件无独立数据目录 |
| `open_config_folder` | config | 裁剪 | — | 桌面壳打开文件管理器，web UI 无对应物 |
| `pick_directory` | config | 裁剪 | — | 原生目录选择对话框（桌面专属） |
| `get_app_config_path` | config | 裁剪 | — | 第二 app 配置路径 |
| `open_app_config_folder` | config | 裁剪 | — | 桌面壳打开文件管理器 |
| `get_claude_common_config_snippet` | config | 不适用 | — | 决策 #5：公共片段是写进 `~/.claude` 的投影内容 |
| `set_claude_common_config_snippet` | config | 不适用 | — | 决策 #5：外部写入器已退役 |
| `get_common_config_snippet` | config | 不适用 | — | 决策 #5：片段的唯一用途是投影进外部客户端配置 |
| `set_common_config_snippet` | config | 不适用 | — | 决策 #5：外部写入器已退役 |
| `extract_common_config_snippet` | config | 不适用 | — | 决策 #5：从外部配置反抽公共片段，前提消失 |
| `get_settings` | settings | DSH 对应物 | — | DSH `settings`（插件命名空间 `dsh-ccswitch-plugin`），不落 `~/.cc-switch/settings.json` |
| `save_settings` | settings | DSH 对应物 | — | 同上，经 `settings.mutate` 带 revision 写入 |
| `get_app_config_dir_override` | settings | 裁剪 | — | Tauri Store `app_paths.json` 数据目录覆盖，插件无独立目录 |
| `set_app_config_dir_override` | settings | 裁剪 | — | 同上 |
| `set_auto_launch` | settings | 裁剪 | — | rule 3：自启属平台映射项（M8 已裁） |
| `get_auto_launch_status` | settings | 裁剪 | — | 同上 |
| `get_rectifier_config` | settings | 移植 | `src/host/commands/settings.mjs` ↔ `src-tauri/src/commands/settings.rs` | 决策 #2：整形管线配置（思考签名/预算等） |
| `set_rectifier_config` | settings | 移植 | `src/host/commands/settings.mjs` ↔ `src-tauri/src/commands/settings.rs` | 决策 #2 |
| `get_optimizer_config` | settings | 移植 | `src/host/commands/settings.mjs` ↔ `src-tauri/src/commands/settings.rs` | 决策 #2：thinking/cache 优化器 |
| `set_optimizer_config` | settings | 移植 | `src/host/commands/settings.mjs` ↔ `src-tauri/src/commands/settings.rs` | 决策 #2 |
| `get_copilot_optimizer_config` | settings | 移植 | `src/host/commands/settings.mjs` ↔ `src-tauri/src/commands/settings.rs` | 决策 #2/#6：Copilot 优化器随账号面保留 |
| `set_copilot_optimizer_config` | settings | 移植 | `src/host/commands/settings.mjs` ↔ `src-tauri/src/commands/settings.rs` | 同上 |
| `get_log_config` | settings | DSH 对应物 | — | DSH 插件日志（console/DSH 日志面），不自建滚动日志文件 |
| `set_log_config` | settings | DSH 对应物 | — | 同上 |
| `has_codex_unify_history_backup` | settings | 裁剪 | — | 决策 #3：Codex 历史迁移属第二 app |
| `codex_forces_multi_agent_v2` | settings | 裁剪 | — | 决策 #3：同上 |
| `restore_codex_unified_history` | settings | 裁剪 | — | 决策 #3：同上 |
| `restart_app` | settings | 裁剪 | — | 桌面 App 进程重启，插件无对应物 |
| `install_update_and_restart` | settings | 裁剪 | — | rule 3：内建 updater 裁剪 |
| `check_app_update_available` | settings | 裁剪 | — | rule 3：同上 |
| `get_claude_plugin_status` | claude-plugin | 不适用 | — | 决策 #5：`~/.claude/config.json` 托管块的读状态，写入器退役后无消费者 |
| `read_claude_plugin_config` | claude-plugin | 不适用 | — | 决策 #5：同上 |
| `apply_claude_plugin_config` | claude-plugin | 不适用 | — | 决策 #5：外部写入器已退役 |
| `is_claude_plugin_applied` | claude-plugin | 不适用 | — | 决策 #5：同上 |
| `apply_claude_onboarding_skip` | claude-plugin | 不适用 | — | 决策 #5：写 `~/.claude/config.json` |
| `clear_claude_onboarding_skip` | claude-plugin | 不适用 | — | 决策 #5：同上 |
| `export_config_to_file` | import-export | 移植·裁剪 | `src/host/commands/import-export.mjs` ↔ `src-tauri/src/commands/import_export.rs` | 决策 #6：SQL 导出与 authorizer 白名单照搬；文件对话框裁掉，改浏览器下载 |
| `import_config_from_file` | import-export | 移植·裁剪 | `src/host/commands/import-export.mjs` ↔ `src-tauri/src/commands/import_export.rs` | 决策 #6：authorizer 拒绝 `ATTACH`/`CREATE VTABLE` 的规则保留；文件选择改浏览器上传 |
| `save_file_dialog` | import-export | 裁剪 | — | 原生保存对话框（桌面专属） |
| `open_file_dialog` | import-export | 裁剪 | — | 同上 |
| `open_zip_file_dialog` | import-export | 裁剪 | — | 同上 |
| `create_db_backup` | import-export | 移植·裁剪 | `src/host/commands/import-export.mjs` ↔ `src-tauri/src/commands/import_export.rs` | 决策 #6 备份保留；备份对象从 cc-switch SQLite 改为插件 `settings` 文档与导入快照 |
| `list_db_backups` | import-export | 移植·裁剪 | `src/host/commands/import-export.mjs` ↔ `src-tauri/src/commands/import_export.rs` | 同上 |
| `list_backup_locations` | import-export | 移植·裁剪 | `src/host/commands/import-export.mjs` ↔ `src-tauri/src/commands/import_export.rs` | 备份位置改为插件可写的 DSH 数据目录 |
| `delete_backup_location` | import-export | 移植·裁剪 | `src/host/commands/import-export.mjs` ↔ `src-tauri/src/commands/import_export.rs` | 同上 |
| `reveal_backup_location` | import-export | 裁剪 | — | 在文件管理器中定位（桌面壳能力），改由设置页展示路径 |
| `restore_db_backup` | import-export | 移植·裁剪 | `src/host/commands/import-export.mjs` ↔ `src-tauri/src/commands/import_export.rs` | 决策 #6：恢复前先自动安全备份的顺序保留 |
| `rename_db_backup` | import-export | 移植·裁剪 | `src/host/commands/import-export.mjs` ↔ `src-tauri/src/commands/import_export.rs` | 同上 |
| `delete_db_backup` | import-export | 移植·裁剪 | `src/host/commands/import-export.mjs` ↔ `src-tauri/src/commands/import_export.rs` | 同上 |
| `sync_current_providers_live` | import-export | 不适用 | — | 决策 #5：把 DB 当前供应商写进外部 live 文件的同步器 |
| `webdav_test_connection` | sync | 移植 | `src/host/commands/webdav-sync.mjs` ↔ `src-tauri/src/commands/webdav_sync.rs` | 决策 #6：WebDAV 同步保留（M5） |
| `webdav_sync_upload` | sync | 移植·裁剪 | `src/host/services/sync-protocol.mjs` ↔ `src-tauri/src/services/sync_protocol.rs` | 三件套协议（manifest/sha256/版本校验、互斥、防抖只上传）照搬；快照对象改为插件 `settings` 文档而非 cc-switch 全库 |
| `webdav_sync_download` | sync | 移植·裁剪 | `src/host/services/sync-protocol.mjs` ↔ `src-tauri/src/services/sync_protocol.rs` | 快照级 last-writer-wins、无合并的语义照搬；同上裁快照对象 |
| `webdav_sync_save_settings` | sync | DSH 对应物 | — | 凭据落 DSH `credentials`、配置落 DSH `settings`，不写 `~/.cc-switch/settings.json` |
| `webdav_sync_fetch_remote_info` | sync | 移植 | `src/host/commands/webdav-sync.mjs` ↔ `src-tauri/src/commands/webdav_sync.rs` | 决策 #6 |
| `parse_deeplink` | deeplink | 移植·裁剪 | `src/host/deeplink/parser.mjs` ↔ `src-tauri/src/deeplink/parser.rs` | 保留 `ccswitch://v1/import?resource=…` 解析（M5/M8），单实例/argv 扫描裁掉 |
| `merge_deeplink_config` | deeplink | 移植·裁剪 | `src/host/deeplink/merge.mjs` ↔ `src-tauri/src/deeplink/{provider,prompt,mcp,skill}.rs` | 合并结果落插件 `settings` 文档，不写 `config.json` |
| `import_from_deeplink` | deeplink | 移植·裁剪 | `src/host/deeplink/import.mjs` ↔ `src-tauri/src/deeplink/` | 风险预览导入通道（M5/M8） |
| `import_from_deeplink_unified` | deeplink | 移植·裁剪 | `src/host/deeplink/import.mjs` ↔ `src-tauri/src/deeplink/` | 同上 |
| `list_profiles` | profile | 移植 | `src/host/commands/profile.mjs` ↔ `src-tauri/src/commands/profile.rs` | 决策 #6：配置方案保留（M5） |
| `create_profile` | profile | 移植 | `src/host/commands/profile.mjs` ↔ `src-tauri/src/commands/profile.rs` | 快照载荷改存插件 `settings` 文档 |
| `update_profile` | profile | 移植 | `src/host/commands/profile.mjs` ↔ `src-tauri/src/commands/profile.rs` | 同上 |
| `delete_profile` | profile | 移植 | `src/host/commands/profile.mjs` ↔ `src-tauri/src/commands/profile.rs` | 同上 |
| `clear_current_profile` | profile | 移植·裁剪 | `src/host/commands/profile.mjs` ↔ `src-tauri/src/commands/profile.rs` | `current_profile_id` 只表示「上次应用的方案」，不再触发切换 |
| `apply_profile` | profile | 移植·裁剪 | `src/host/commands/profile.mjs` ↔ `src-tauri/src/commands/profile.rs` | 决策 #4/#5：应用改为整体投影进目录与成员集，不写外部文件、不发切换事件 |
| `get_prompts` | prompt | 移植 | `src/host/commands/prompt.mjs` ↔ `src-tauri/src/commands/prompt.rs` | 决策 #6：提示词库保留（M6） |
| `upsert_prompt` | prompt | 移植 | `src/host/commands/prompt.mjs` ↔ `src-tauri/src/commands/prompt.rs` | `prompts` 表改存插件 `settings` 文档 |
| `delete_prompt` | prompt | 移植 | `src/host/commands/prompt.mjs` ↔ `src-tauri/src/commands/prompt.rs` | 同上 |
| `enable_prompt` | prompt | 移植 | `src/host/commands/prompt.mjs` ↔ `src-tauri/src/commands/prompt.rs` | 启用开关保留 |
| `import_prompt_from_file` | prompt | 移植·裁剪 | `src/host/commands/prompt.mjs` ↔ `src-tauri/src/commands/prompt.rs` | 原生文件对话框裁掉，改浏览器上传 |
| `get_current_prompt_file_content` | prompt | 不适用 | — | 决策 #5：读的是被投影的 live prompt 文件，投影面已退役 |
| `get_prompt_file_location` | prompt | 不适用 | — | 决策 #5：同上，live prompt 文件不再存在 |
| `get_pi_prompt_file` | prompt | 不适用 | — | 决策 #5：Pi 的 live prompt 文件投影面 |
| `replace_pi_prompt_file` | prompt | 不适用 | — | 决策 #5：外部写入器已退役（且 Pi 属决策 #3 范围外） |
| `delete_pi_prompt_file` | prompt | 不适用 | — | 决策 #5：同上 |
| `list_pi_prompt_templates` | prompt | 裁剪 | — | 决策 #3：Pi 专属模板（`prompts` 按 `(id, app_type)` 主键） |
| `upsert_pi_prompt_template` | prompt | 裁剪 | — | 决策 #3：同上 |
| `delete_pi_prompt_template` | prompt | 裁剪 | — | 决策 #3：同上 |
| `get_installed_skills` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 决策 #6 技能保留；7 个 `enabled_<app>` 位收敛为 DSH 一位 |
| `get_skill_backups` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 备份目录改为插件自有数据目录 |
| `delete_skill_backup` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 同上 |
| `install_skill_unified` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | SSOT 目录改为 DSH skills 对应物，不落 `~/.cc-switch/skills/` |
| `uninstall_skill_unified` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 同上 |
| `restore_skill_backup` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 同上 |
| `toggle_skill_app` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 按 app 启用位收敛为 DSH 单 app 位 |
| `scan_unmanaged_skills` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 扫描范围收敛为 SSOT 目录 |
| `import_skills_from_apps` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 保留为迁移通道；来源裁掉 6 个外部 app 的 skills 目录，只留 cc-switch DB/SSOT |
| `discover_available_skills` | skill | 移植 | `src/host/services/skill.mjs` ↔ `src-tauri/src/services/skill.rs` | 决策 #6：Discover 市场（GitHub repos + skills.sh）保留 |
| `check_skill_updates` | skill | 移植 | `src/host/services/skill.mjs` ↔ `src-tauri/src/services/skill.rs` | 同上 |
| `resync_skills_to_apps` | skill | 移植·裁剪 | `src/host/services/skill.mjs` ↔ `src-tauri/src/services/skill.rs` | 同步目标从各外部 app 目录收敛为 DSH skills 对应物；auto/symlink/copy 三法裁为可用的一种 |
| `update_skill` | skill | 移植 | `src/host/services/skill.mjs` ↔ `src-tauri/src/services/skill.rs` | 决策 #6 |
| `migrate_skill_storage` | skill | 移植·裁剪 | `src/host/services/skill.mjs` ↔ `src-tauri/src/services/skill.rs` | `skill_storage_location=unified` 迁移在单 app 下退化为一次性搬迁 |
| `get_cc_switch_skills_dir` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 目录改为插件/DSH skills 路径 |
| `open_cc_switch_skills_dir` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 浏览器无文件管理器，改为在设置页展示路径 |
| `search_skills_sh` | skill | 移植 | `src/host/services/skill.mjs` ↔ `src-tauri/src/services/skill.rs` | skills.sh 检索接口原样移植 |
| `get_skills` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 遗留 API 兼容层，与 unified 层共用同一份数据 |
| `get_skills_for_app` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | `app_type` 参数收敛为 DSH 单 app |
| `install_skill` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 遗留兼容层，同上收敛 |
| `install_skill_for_app` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 同上 |
| `uninstall_skill` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 同上 |
| `uninstall_skill_for_app` | skill | 移植·裁剪 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 同上 |
| `get_skill_repos` | skill | 移植 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 决策 #6：市场源仓库表保留 |
| `add_skill_repo` | skill | 移植 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 同上 |
| `remove_skill_repo` | skill | 移植 | `src/host/commands/skill.mjs` ↔ `src-tauri/src/commands/skill.rs` | 同上 |
| `install_skills_from_zip` | skill | 移植·裁剪 | `src/host/services/skill.mjs` ↔ `src-tauri/src/services/skill.rs` | zip 选择对话框裁掉，改浏览器上传 |
| `get_claude_mcp_status` | mcp | 不适用 | — | 决策 #5：Claude-direct 层读 `~/.claude.json` 投影状态 |
| `read_claude_mcp_config` | mcp | 不适用 | — | 决策 #5：同上 |
| `upsert_claude_mcp_server` | mcp | 不适用 | — | 决策 #5：外部写入器已退役（含 Windows `cmd /c` 包装） |
| `delete_claude_mcp_server` | mcp | 不适用 | — | 决策 #5：同上 |
| `validate_mcp_command` | mcp | 移植·裁剪 | `src/host/commands/mcp.mjs` ↔ `src-tauri/src/commands/mcp.rs` | 校验规则保留；针对外部 CLI 安装形态的分支裁掉 |
| `get_mcp_config` | mcp | 裁剪 | — | 原版已标废弃（`commands/mcp.rs:71`）的 `config.json` SSOT 层，插件无 `~/.cc-switch` |
| `upsert_mcp_server_in_config` | mcp | 裁剪 | — | 同上 |
| `delete_mcp_server_in_config` | mcp | 裁剪 | — | 同上 |
| `set_mcp_enabled` | mcp | 裁剪 | — | 同上 |
| `get_mcp_servers` | mcp | 移植 | `src/host/commands/mcp.mjs` ↔ `src-tauri/src/commands/mcp.rs` | 决策 #6：MCP 矩阵保留（M6），落到 DSH 的 MCP 配置面 |
| `upsert_mcp_server` | mcp | 移植 | `src/host/commands/mcp.mjs` ↔ `src-tauri/src/commands/mcp.rs` | 统一 DB 层改存插件 `settings` 文档 |
| `delete_mcp_server` | mcp | 移植 | `src/host/commands/mcp.mjs` ↔ `src-tauri/src/commands/mcp.rs` | 同上 |
| `toggle_mcp_app` | mcp | 移植·裁剪 | `src/host/commands/mcp.mjs` ↔ `src-tauri/src/commands/mcp.rs` | 8 个 `enabled_<app>` 位收敛为 DSH 单 app 位 |
| `import_mcp_from_apps` | mcp | 移植·裁剪 | `src/host/commands/mcp.mjs` ↔ `src-tauri/src/commands/mcp.rs` | 首启自动导入来源收敛为 cc-switch DB；不扫 6 个外部 app 的配置文件 |
| `resync_mcp_to_apps` | mcp | 移植·裁剪 | `src/host/services/mcp.mjs` ↔ `src-tauri/src/services/mcp.rs` | 同步目标收敛为 DSH 的 MCP 配置面，逐 app 独立失败的容错保留 |
| `auth_start_login` | auth | 移植 | `src/host/commands/auth.mjs` ↔ `src-tauri/src/commands/auth.rs` | 决策 #6/C：通用账号门面保留（M3） |
| `auth_poll_for_account` | auth | 移植 | `src/host/commands/auth.mjs` ↔ `src-tauri/src/commands/auth.rs` | 同上 |
| `auth_cancel_login` | auth | 移植 | `src/host/commands/auth.mjs` ↔ `src-tauri/src/commands/auth.rs` | 同上 |
| `auth_list_accounts` | auth | 移植 | `src/host/commands/auth.mjs` ↔ `src-tauri/src/commands/auth.rs` | 同上 |
| `auth_get_status` | auth | 移植 | `src/host/commands/auth.mjs` ↔ `src-tauri/src/commands/auth.rs` | 同上 |
| `auth_remove_account` | auth | 移植 | `src/host/commands/auth.mjs` ↔ `src-tauri/src/commands/auth.rs` | 移除账号同时解绑供应商引用的规则保留 |
| `auth_set_default_account` | auth | 移植 | `src/host/commands/auth.mjs` ↔ `src-tauri/src/commands/auth.rs` | 决策 #6/C |
| `auth_logout` | auth | 移植 | `src/host/commands/auth.mjs` ↔ `src-tauri/src/commands/auth.rs` | 同上 |
| `copilot_start_device_flow` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | 决策 #6/C：Copilot 设备码多账号（M3） |
| `copilot_poll_for_auth` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | 同上 |
| `copilot_poll_for_account` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | 同上 |
| `copilot_list_accounts` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | 同上 |
| `copilot_remove_account` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | token 落 DSH `credentials`，0600 JSON 文件不建 |
| `copilot_set_default_account` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | 决策 #6/C |
| `copilot_get_auth_status` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | 同上 |
| `copilot_logout` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | 同上 |
| `copilot_is_authenticated` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | 同上 |
| `copilot_get_token` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | token 只在服务端解析，浏览器不见值 |
| `copilot_get_token_for_account` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | 同上 |
| `copilot_get_models` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | 决策 #6/C |
| `copilot_get_models_for_account` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | 同上 |
| `copilot_get_usage` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | 配额卡片 |
| `copilot_get_usage_for_account` | auth | 移植 | `src/host/commands/copilot.mjs` ↔ `src-tauri/src/commands/copilot.rs` | 同上 |
| `get_codex_oauth_quota` | auth | 移植 | `src/host/commands/codex-oauth.mjs` ↔ `src-tauri/src/commands/codex_oauth.rs` | 决策 #6/C：Codex OAuth（ChatGPT 登录）配额卡片 |
| `get_codex_oauth_models` | auth | 移植 | `src/host/commands/codex-oauth.mjs` ↔ `src-tauri/src/commands/codex_oauth.rs` | 同上 |
| `get_xai_oauth_quota` | auth | 移植 | `src/host/commands/xai-oauth.mjs` ↔ `src-tauri/src/commands/xai_oauth.rs` | 决策 #6/C：xAI（SuperGrok）配额卡片 |
| `get_xai_oauth_models` | auth | 移植 | `src/host/commands/xai-oauth.mjs` ↔ `src-tauri/src/commands/xai_oauth.rs` | 同上 |
| `get_subscription_quota` | auth | 移植 | `src/host/services/subscription.mjs` ↔ `src-tauri/src/services/subscription.rs` | 读 CLI 原生 OAuth，不自建订阅状态 |
| `get_balance` | auth | 移植 | `src/host/services/balance.mjs` ↔ `src-tauri/src/services/balance.rs` | 同上 |
| `get_coding_plan_quota` | auth | 移植 | `src/host/services/coding-plan.mjs` ↔ `src-tauri/src/services/coding_plan.rs` | 同上 |
| `get_usage_summary` | usage | 移植 | `src/host/services/usage-stats.mjs` ↔ `src-tauri/src/services/usage_stats.rs` | 决策 #6：用量看板保留（M4），数据源为经代理的请求账本 |
| `get_session_usage_summary` | usage | 移植 | `src/host/services/usage-stats.mjs` ↔ `src-tauri/src/services/usage_stats.rs` | 同上 |
| `get_usage_summary_by_app` | usage | 移植·裁剪 | `src/host/services/usage-stats.mjs` ↔ `src-tauri/src/services/usage_stats.rs` | 按 app 聚合维度收敛为 DSH 单 app |
| `get_usage_trends` | usage | 移植 | `src/host/services/usage-stats.mjs` ↔ `src-tauri/src/services/usage_stats.rs` | 决策 #6 |
| `get_usage_first_date` | usage | 移植 | `src/host/services/usage-stats.mjs` ↔ `src-tauri/src/services/usage_stats.rs` | 决策 #6 |
| `get_provider_stats` | usage | 移植 | `src/host/services/usage-stats.mjs` ↔ `src-tauri/src/services/usage_stats.rs` | 决策 #6 |
| `get_model_stats` | usage | 移植 | `src/host/services/usage-stats.mjs` ↔ `src-tauri/src/services/usage_stats.rs` | 决策 #6 |
| `get_request_logs` | usage | 移植 | `src/host/services/usage-stats.mjs` ↔ `src-tauri/src/services/usage_stats.rs` | 决策 #6：请求日志表 |
| `get_request_detail` | usage | 移植 | `src/host/services/usage-stats.mjs` ↔ `src-tauri/src/services/usage_stats.rs` | 同上 |
| `get_model_pricing` | usage | 移植 | `src/host/services/model-pricing.mjs` ↔ `src-tauri/src/services/model_pricing.rs` | 决策 #6：价格表 + `model-pricing.json` 侧车语义保留 |
| `update_model_pricing` | usage | 移植 | `src/host/services/model-pricing.mjs` ↔ `src-tauri/src/services/model_pricing.rs` | 同上 |
| `update_model_pricing_batch` | usage | 移植 | `src/host/services/model-pricing.mjs` ↔ `src-tauri/src/services/model_pricing.rs` | 同上 |
| `delete_model_pricing` | usage | 移植 | `src/host/services/model-pricing.mjs` ↔ `src-tauri/src/services/model_pricing.rs` | 同上 |
| `get_models_dev_sync_config` | usage | 移植 | `src/host/commands/usage.mjs` ↔ `src-tauri/src/commands/usage.rs` | models.dev 同步配置存插件 `settings` |
| `save_models_dev_sync_config` | usage | 移植 | `src/host/commands/usage.mjs` ↔ `src-tauri/src/commands/usage.rs` | 同上 |
| `record_models_dev_sync_result` | usage | 移植 | `src/host/commands/usage.mjs` ↔ `src-tauri/src/commands/usage.rs` | 同上 |
| `check_provider_limits` | usage | 移植 | `src/host/services/usage-stats.mjs` ↔ `src-tauri/src/services/usage_stats.rs` | 决策 #2：仅 UI 提示（<20% 警告），代理不拦截 |
| `sync_session_usage` | usage | 移植 | `src/host/services/session-usage.mjs` ↔ `src-tauri/src/services/session_usage*.rs` | 会话侧用量并入账本的游标/去重规则照搬 |
| `rebuild_codex_usage` | usage | 移植·裁剪 | `src/host/services/session-usage.mjs` ↔ `src-tauri/src/services/session_usage*.rs` | Codex 会话重建分支裁掉，只保留 DSH 经代理的账本 |
| `get_session_usage_last_sync` | usage | 移植 | `src/host/services/session-usage.mjs` ↔ `src-tauri/src/services/session_usage*.rs` | 决策 #6 |
| `get_usage_data_sources` | usage | 移植 | `src/host/commands/usage.mjs` ↔ `src-tauri/src/commands/usage.rs` | 决策 #6 |
| `stream_check_provider` | usage | 移植 | `src/host/commands/stream-check.mjs` ↔ `src-tauri/src/commands/stream_check.rs` | 可达性探测；明确不触碰熔断器的约束保留 |
| `list_sessions` | session | 移植·裁剪 | `src/host/commands/session-manager.mjs` ↔ `src-tauri/src/commands/session_manager.rs` | 决策 #6：会话阅读器保留；会话源从各外部客户端存储改为 DSH 会话存储 |
| `get_session_messages` | session | 移植·裁剪 | `src/host/commands/session-manager.mjs` ↔ `src-tauri/src/commands/session_manager.rs` | 解析缓存与分页规则照搬，读者收敛为 DSH 一侧 |
| `stream_session_messages` | session | 移植·裁剪 | `src/host/commands/session-manager.mjs` ↔ `src-tauri/src/commands/session_manager.rs` | Tauri `Channel` 改为分块 HTTP/SSE 流 |
| `get_session_block_content` | session | 移植·裁剪 | `src/host/commands/session-manager.mjs` ↔ `src-tauri/src/commands/session_manager.rs` | ≤512K 分页上限保留 |
| `get_session_image` | session | 移植·裁剪 | `src/host/commands/session-manager.mjs` ↔ `src-tauri/src/commands/session_manager.rs` | 图片读取改为经插件路由返回 |
| `reveal_session_path` | session | 移植·裁剪 | `src/host/commands/session-manager.mjs` ↔ `src-tauri/src/commands/session_manager.rs` | 浏览器无文件管理器，改为展示路径 |
| `export_session_markdown` | session | 移植·裁剪 | `src/host/commands/session-manager.mjs` ↔ `src-tauri/src/commands/session_manager.rs` | 导出改为浏览器下载 |
| `delete_session` | session | 移植·裁剪 | `src/host/commands/session-manager.mjs` ↔ `src-tauri/src/commands/session_manager.rs` | 删除落到 DSH 会话存储 |
| `delete_sessions` | session | 移植·裁剪 | `src/host/commands/session-manager.mjs` ↔ `src-tauri/src/commands/session_manager.rs` | 同上 |
| `launch_session_terminal` | session | 移植·裁剪 | `src/host/commands/session-manager.mjs` ↔ `src-tauri/src/commands/session_manager.rs` | 拉起终端改为展示恢复命令/会话路径（浏览器无终端；待 M6 确认形态） |
| `open_external` | app-lifecycle | DSH 对应物 | — | 桌面壳 `opener` 换成前端普通外链（`target="_blank"`），无需后端 |
| `copy_text_to_clipboard` | app-lifecycle | DSH 对应物 | — | 浏览器 Clipboard API |
| `get_init_error` | app-lifecycle | 裁剪 | — | cc-switch DB 初始化/迁移错误屏，插件无 DB |
| `get_migration_result` | app-lifecycle | 裁剪 | — | JSON→SQLite 一次性迁移结果，插件无 DB |
| `get_skills_migration_result` | app-lifecycle | 裁剪 | — | skills v2→v3 SSOT 迁移结果，随 skills 裁剪口径处理 |
| `is_portable_mode` | app-lifecycle | 裁剪 | — | rule 3：便携模式属平台映射项 |
| `set_window_theme` | app-lifecycle | 裁剪 | — | rule 3：窗口 chrome 裁剪 |
| `check_for_updates` | app-lifecycle | 裁剪 | — | rule 3：updater 裁剪 |
| `check_env_conflicts` | app-lifecycle | 裁剪 | — | 机器级环境变量冲突检查（`services/env_manager.rs`），插件不碰进程环境 |
| `delete_env_vars` | app-lifecycle | 裁剪 | — | 决策 #5：写机器环境变量，同属外部写入面 |
| `restore_env_backup` | app-lifecycle | 裁剪 | — | 同上（`~/.cc-switch/backups` 环境变量备份） |
| `enter_lightweight_mode` | app-lifecycle | 裁剪 | — | rule 3：销毁主窗口仅剩托盘的轻量模式 |
| `exit_lightweight_mode` | app-lifecycle | 裁剪 | — | 同上 |
| `is_lightweight_mode` | app-lifecycle | 裁剪 | — | 同上 |
| `get_tool_versions` | app-install | 裁剪 | — | 决策 #6：Apps 安装器（工具版本探测） |
| `run_tool_lifecycle_action` | app-install | 裁剪 | — | 决策 #6：安装/更新/卸载 CLI 动作 |
| `probe_tool_installations` | app-install | 裁剪 | — | 决策 #6：外部工具安装探测 |
| `list_tool_installations` | app-install | 裁剪 | — | 决策 #6：同上 |
| `open_provider_terminal` | app-install | 裁剪 | — | 决策 #6：拉起外部工具的终端会话 |
| `get_global_proxy_url` | global-proxy | 移植 | `src/host/commands/global-proxy.mjs` ↔ `src-tauri/src/commands/global_proxy.rs` | 插件自身出站请求（探测/同步/市场）沿用全局出站代理（计划 network 节） |
| `set_global_proxy_url` | global-proxy | 移植 | `src/host/commands/global-proxy.mjs` ↔ `src-tauri/src/commands/global_proxy.rs` | 同上 |
| `test_proxy_url` | global-proxy | 移植 | `src/host/commands/global-proxy.mjs` ↔ `src-tauri/src/commands/global_proxy.rs` | 同上 |
| `get_upstream_proxy_status` | global-proxy | 移植 | `src/host/commands/global-proxy.mjs` ↔ `src-tauri/src/commands/global_proxy.rs` | 同上；非法配置启动自清的规则保留 |
| `scan_local_proxies` | global-proxy | 移植 | `src/host/commands/global-proxy.mjs` ↔ `src-tauri/src/commands/global_proxy.rs` | 同上 |
| `update_tray_menu` | tray | 裁剪 | — | rule 3：托盘菜单（UX 盘点 §4.1） |
| `take_tray_navigation` | tray | 裁剪 | — | rule 3：同上 |
| `tray_app_page_seen` | tray | 裁剪 | — | rule 3：同上 |
| `import_openclaw_providers_from_live` | openclaw | 裁剪 | — | 决策 #3：OpenClaw 非管理对象（读外部配置） |
| `get_openclaw_live_provider_ids` | openclaw | 裁剪 | — | 决策 #3：同上 |
| `get_openclaw_live_provider` | openclaw | 裁剪 | — | 决策 #3：同上 |
| `scan_openclaw_config_health` | openclaw | 裁剪 | — | 决策 #3：同上 |
| `get_openclaw_default_model` | openclaw | 裁剪 | — | 决策 #3：默认模型非 DSH 数据（盘点记作 `get/set_openclaw_default_model`） |
| `set_openclaw_default_model` | openclaw | 裁剪 | — | 决策 #5：写外部 app 配置文件 |
| `get_openclaw_model_catalog` | openclaw | 裁剪 | — | 决策 #3：（盘点记作 `get/set_openclaw_model_catalog`） |
| `set_openclaw_model_catalog` | openclaw | 裁剪 | — | 决策 #5：写外部 app 配置文件 |
| `get_openclaw_agents_defaults` | openclaw | 裁剪 | — | 决策 #3：（盘点记作 `get/set_openclaw_agents_defaults`） |
| `set_openclaw_agents_defaults` | openclaw | 裁剪 | — | 决策 #5：写外部 app 配置文件 |
| `get_openclaw_env` | openclaw | 裁剪 | — | 决策 #3：（盘点记作 `get/set_openclaw_env`） |
| `set_openclaw_env` | openclaw | 裁剪 | — | 决策 #5：写外部 app 配置文件 |
| `get_openclaw_tools` | openclaw | 裁剪 | — | 决策 #3：（盘点记作 `get/set_openclaw_tools`） |
| `set_openclaw_tools` | openclaw | 裁剪 | — | 决策 #5：写外部 app 配置文件 |
| `import_hermes_providers_from_live` | hermes | 裁剪 | — | 决策 #3：Hermes 非管理对象（读外部配置） |
| `get_hermes_live_provider_ids` | hermes | 裁剪 | — | 决策 #3：同上 |
| `get_hermes_live_provider` | hermes | 裁剪 | — | 决策 #3：同上 |
| `get_hermes_model_config` | hermes | 裁剪 | — | 决策 #3：同上 |
| `open_hermes_web_ui` | hermes | 裁剪 | — | 决策 #3：打开另一 app 的 Web UI |
| `launch_hermes_dashboard` | hermes | 裁剪 | — | 决策 #3：拉起另一 app 的面板 |
| `get_hermes_memory` | hermes | 裁剪 | — | 决策 #3：（盘点记作 `get/set_hermes_memory`） |
| `set_hermes_memory` | hermes | 裁剪 | — | 决策 #5：写外部 app 配置文件 |
| `get_hermes_memory_limits` | hermes | 裁剪 | — | 决策 #3：同上 |
| `set_hermes_memory_enabled` | hermes | 裁剪 | — | 决策 #5：写外部 app 配置文件 |
| `read_omo_local_file` | omo | 裁剪 | — | 决策 #3：读 `~/.omo/omo.json`，OMO 非管理对象 |
| `get_current_omo_provider_id` | omo | 裁剪 | — | 决策 #4/#3：另一 app 的「当前供应商」指针 |
| `disable_current_omo` | omo | 裁剪 | — | 决策 #5：写外部 app 配置文件 |
| `read_omo_slim_local_file` | omo | 裁剪 | — | 决策 #3：同上 |
| `get_current_omo_slim_provider_id` | omo | 裁剪 | — | 决策 #4/#3：同上 |
| `disable_current_omo_slim` | omo | 裁剪 | — | 决策 #5：写外部 app 配置文件 |
| `get_pi_current_state` | pi | 裁剪 | — | 决策 #3：Pi 非管理对象 |
| `update_pi_provider_usage_script` | pi | 裁剪 | — | 决策 #5：写 Pi 外部配置 |
| `get_pi_session_discovery` | pi | 裁剪 | — | 决策 #3：Pi 会话发现 |
| `read_workspace_file` | workspace | 裁剪 | — | 决策 #3：OpenClaw 工作区文件面 |
| `write_workspace_file` | workspace | 裁剪 | — | 决策 #5：写外部工作区文件 |
| `list_daily_memory_files` | workspace | 裁剪 | — | 决策 #3：OpenClaw 每日记忆文件 |
| `read_daily_memory_file` | workspace | 裁剪 | — | 决策 #3：同上 |
| `write_daily_memory_file` | workspace | 裁剪 | — | 决策 #5：写外部文件 |
| `delete_daily_memory_file` | workspace | 裁剪 | — | 决策 #5：同上 |
| `search_daily_memory_files` | workspace | 裁剪 | — | 决策 #3：同上 |
| `open_workspace_directory` | workspace | 裁剪 | — | 决策 #3：打开文件管理器定位另一 app 的工作区 |

## 统计

| 去向 | 行数 |
|---|---|
| 移植 | 104 |
| 移植·裁剪 | 61 |
| 改造为插件路由 | 10 |
| DSH 对应物 | 7 |
| 裁剪 | 105 |
| 不适用 | 36 |
| **合计** | **323** |

合计校验：104 + 61 + 10 + 7 + 105 + 36 = 323 = 上表行数。分组合计（provider 33、proxy 31、failover 6、config 13、settings 20、claude-plugin 6、import-export 14、sync 5、deeplink 4、profile 6、prompt 13、skill 27、mcp 15、auth 30、usage 22、session 10、app-lifecycle 14、app-install 5、global-proxy 5、tray 3、openclaw 14、hermes 10、omo 6、pi 3、workspace 8）同样为 323。

## 未覆盖

1. **`commands/s3_sync.rs` 的 5 个命令**（盘点 §1.8 只给出文件与计数，未列命令名）。源码 `src-tauri/src/lib.rs` 的 `generate_handler![...]` 注册为 `s3_test_connection`、`s3_sync_upload`、`s3_sync_download`、`s3_sync_save_settings`、`s3_sync_fetch_remote_info`。按规则 6（同步保留），其去向应与本表对应的 WebDAV 五条一致（test / upload / download / fetch → 移植，save_settings → DSH 对应物）。因「行命令名必须逐字出现在盘点中」，未列入表内；这 5 个即 328 − 323 的差额。
2. **压缩记法的展开**：盘点对 6 组命令用 `get/set_x` 记法（`get/set_openclaw_default_model`、`get/set_openclaw_model_catalog`、`get/set_openclaw_agents_defaults`、`get/set_openclaw_env`、`get/set_openclaw_tools`、`get/set_hermes_memory`）。本表按「精确 Tauri 命令名」把它们展开为 12 行；其中 5 个 `get_openclaw_*` 只以压缩形式出现在盘点里，展开名已对照源码 `generate_handler` 核对，非杜撰。
3. **非 IPC 项**：`switch_provider_test_hook`、`import_default_config_test_hook`、`get_pricing_model_source_test_hook`、`set_pricing_model_source_test_hook` 需要 `feature = "test-hooks"`，不是注册命令（盘点 §1.1、§8.9）；`tray` 事件 id（`show_main`、`open_website` 等）、`mode/controller.rs` 的内部控制 API（`enter`/`attach`/`switch_route`/`resync_*` 等）同理，均不占行。

除上述三项外，盘点中出现的命令均已逐条对上行，无其他遗漏。
