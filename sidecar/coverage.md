# sidecar 命令覆盖清单

> **P0 产出，2026-10-12。** 数字全部来自**实测**，不是估算。
> 重跑方式见文末「再生方法」——每次跟版后重跑，不要凭记忆引用本文数字。

## 一句话

sidecar 实现 **143** 个命令，我们前端需要 **300** 个，命中 **137**、缺 **163**，
**覆盖率 45.7%**。缺的 163 里有 **78 个按既定决策本就不做**，真正要补 **85 个**。

## 实测环境

| 项 | 值 |
|---|---|
| fork | `vandoor7-droid/cc-switch-headless` @ `342a35b` |
| 版本 | `4.0.8`（`src-tauri/Cargo.toml`） |
| 构建 | `cargo build --no-default-features --features server --bin cc-switch-server`，**1m58s**，无 Tauri/WebKit/显示环境 |
| 产物 | `src-tauri/target/debug/cc-switch-server.exe`，55 MB |
| 端点 | `127.0.0.1:15880`（避开 15800 默认值与 15721 代理） |
| 配置目录 | `CC_SWITCH_CONFIG_DIR` 指向 scratch（见下方安全注意） |

## 传输契约（已验证）

| 请求 | 结果 |
|---|---|
| `POST /api/invoke` body `{"cmd":"get_providers","args":{"app":"claude"}}` | `200` → `{"ok":true,"data":{...}}` |
| `POST /api/invoke` body `{"cmd":"get_circuit_breaker_config","args":{}}` | `200` → `{"ok":false,"error":"E_NOT_IMPLEMENTED: get_circuit_breaker_config"}` |
| `GET /api/capabilities` 带 Bearer | `200` |
| `GET /api/capabilities` 不带 token | `401` |
| `POST /api/invoke` 不带 token | `401` |
| `GET /api/env` | `200` → `{"name","version","homeDir","configDir"}` |

**请求形状**：`{"cmd": <string>, "args": {...}}`，单端点 `POST /api/invoke`——
命令名**不是**路径段（`POST /api/invoke/get_providers` 会落到 SPA 兜底页）。
实现在 `src-tauri/src/web/routes.rs:38` 的 `InvokeRequest`。

这与 `src/client/tauri-shim/core.mjs` 的 bridge 模式**已经对上**（`body: { cmd, args }`）。

**信封** `{ok,data}` / `{ok:false,error}` 与 `sidecar/README.md` 的契约一致，无需修订。

## 能力协商实测

**开**：`pageProviders` `pageRouting` `pageSessions` `pageImportExport` `pageUsage`
`pageMcp` `pageSkills` `pagePrompts` `sessionStream`

**关**：`pageAuth` `pageApps` `sessionReveal` `sessionTerminal` `pickDirectory`
`openInFileManager` `tray` `updater`

关掉的 8 项里，`pageAuth`（托管账号 OAuth 登录）、`pageApps`（安装器）、
`sessionTerminal`、`pickDirectory`、`openInFileManager`、`tray`、`updater`
都落在我们已砍的决策里——**与决策不冲突**，无需补。

## 缺口分类

| 类别 | 数量 | 处置 |
|---|---|---|
| A. 桌面壳/平台 | 22 | **砍**（决策：托盘/窗口 chrome/自启/便携/updater） |
| B. Apps 安装器 | 4 | **砍**（决策 #6） |
| C. 多 app 面（Hermes/OpenClaw/OMO/Universal/Workspace） | 37 | **砍**（决策 #3 只管 DSH 一家） |
| D. 外部写入器 + 深链 | 15 | **砍**（决策 #5） |
| E. **必须补** | **85** | 按组交付 |

合计 `22+4+37+15+85 = 163`，与实测 missing 数一致。

---

## E 组明细（85 个，按交付批次）

### 组 1 · 供应商 + 路由/熔断/测速（23）— **首批**

```
add_custom_endpoint            remove_custom_endpoint         get_custom_endpoints
update_endpoint_last_used      test_api_endpoints             fetch_models_for_config
get_opencode_models            get_circuit_breaker_config     get_circuit_breaker_stats
update_circuit_breaker_config  reset_circuit_breaker          get_provider_health
get_proxy_stack                set_proxy_stack_member         exit_proxy_apps_in_mode
adopt_codex_stack_catalog      restart_codex_app_server_daemon
get_global_proxy_url           set_global_proxy_url           test_proxy_url
get_upstream_proxy_status      scan_local_proxies             stream_check_provider
```

### 组 2 · 设置面（8）

```
get_log_config     set_log_config     get_rectifier_config   set_rectifier_config
get_optimizer_config                 set_optimizer_config    delete_env_vars
restore_env_backup
```

### 组 3 · 数据面（18）

```
webdav_sync_download    webdav_sync_fetch_remote_info   webdav_sync_save_settings
webdav_sync_upload      webdav_test_connection
s3_sync_download        s3_sync_fetch_remote_info       s3_sync_save_settings
s3_sync_upload          s3_test_connection
list_profiles           create_profile                  update_profile
delete_profile          apply_profile                   clear_current_profile
list_backup_locations   delete_backup_location
```

### 组 4 · OAuth 托管账号（30）

```
auth_start_login   auth_poll_for_account   auth_cancel_login   auth_list_accounts
auth_get_status    auth_remove_account     auth_set_default_account   auth_logout

copilot_start_device_flow  copilot_poll_for_auth   copilot_get_auth_status
copilot_logout             copilot_is_authenticated copilot_get_token
copilot_get_models         copilot_get_usage        copilot_list_accounts
copilot_poll_for_account   copilot_remove_account   copilot_set_default_account
copilot_get_token_for_account  copilot_get_models_for_account  copilot_get_usage_for_account

get_codex_oauth_models  get_codex_oauth_quota  get_xai_oauth_models
get_xai_oauth_quota     get_subscription_quota get_balance  get_coding_plan_quota
```

### 组 5 · 会话/用量余项（6）

```
get_session_image    stream_session_messages    get_usage_first_date
get_pi_current_state get_pi_session_discovery   update_pi_provider_usage_script
```

---

## 安全注意（本轮实测得出）

1. **用户有真实 cc-switch 数据**：`~/.cc-switch/cc-switch.db` = **24 MB**。
   P0 全程用 `CC_SWITCH_CONFIG_DIR` 指向 scratch，**未触碰真实库**。
   4.0.8 对真实库要跑 **v0→v20** 全量迁移——未经评估绝不能直接上。

2. **`CC_SWITCH_CONFIG_DIR` 只搬 cc-switch 自己的状态目录，不搬外部 CLI 配置**。
   实测服务端仍然：
   - 读了真实 `~/.codex/config.toml`、OpenCode live 配置，并据此导入供应商；
   - **写回了真实 `~/.claude`**（清掉「旧版接管留下的代理占位符」，改回直连）。

   这是启动时的 live 导入与接管清理逻辑，行为本身与桌面版一致。
   **但对插件落地意味着**：sidecar 一启动就可能改写 `~/.claude`、`~/.codex`。
   与决策 #5「外部写入器永不接」直接冲突，**P3 必须在 sidecar 侧切断这些启动写入**
   （或至少改为只读导入 + 显式确认），否则装进 DSH 就会动用户的真实配置。

3. **两进程争用风险**：sidecar 与桌面版 cc-switch 若同时打开会争 `~/.cc-switch/cc-switch.db`。
   落地时 sidecar 必须是唯一写者（计划已列为硬约束）。

## 再生方法

```powershell
# 1. 起 sidecar（独立配置目录 + 独立端口）
$env:CC_SWITCH_CONFIG_DIR = '<scratch>'      # 绝不要指向真实 ~/.cc-switch
$env:CC_SWITCH_WEB_PORT   = '15880'
$env:CC_SWITCH_WEB_TOKEN  = '<token>'
& '<fork>\src-tauri\target\debug\cc-switch-server.exe'

# 2. 取权威命令表
$r = Invoke-WebRequest 'http://127.0.0.1:15880/api/capabilities' `
     -Headers @{Authorization="Bearer $env:CC_SWITCH_WEB_TOKEN"}
$theirs = (($r.Content | ConvertFrom-Json).commands -as [string[]]) -as [string[]]

# 3. 取我方需求（300 个）
$m = Select-String -Path 'src\ccswitch\lib\api\*.ts','src\ccswitch\hooks\*.ts',
        'src\ccswitch\lib\*.ts','src\ccswitch\components\**\*.ts',
        'src\ccswitch\components\**\*.tsx','src\ccswitch\utils\*.ts' `
     -Pattern 'invoke(?:<[^>]*>)?\(\s*["'']([a-zA-Z_0-9]+)["'']' -AllMatches
$ours = @{}; foreach($x in $m){ foreach($mm in $x.Matches){ $ours[$mm.Groups[1].Value]=1 } }

# 4. 求交集 → 重写本文的数字与分类
```

**排除项**：`update_tray_menu`、`get_current_provider` 有本地 `run` 覆盖，不走 bridge。
