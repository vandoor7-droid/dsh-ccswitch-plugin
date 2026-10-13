# sidecar 命令覆盖清单

> **P0 产出 2026-10-12；P3 更新同日。** 数字全部来自**实测**，不是估算。
> 重跑方式见文末「再生方法」——每次跟版后重跑，不要凭记忆引用本文数字。

## 一句话

sidecar 实现 **207** 个命令，我们前端需要 **305** 个，命中 **201**、缺 **104**，
**覆盖率 65.9%**。缺的 104 里有 **78 个按既定决策本就不做**，真正要补 **26 个**。

| 轮次 | sidecar | 我们需要 | 命中 | 缺 | 覆盖率 |
|---|---|---|---|---|---|
| P0 基线 | 143 | 300 | 137 | 163 | 45.7% |
| P3 首刀（熔断/健康） | 148 | 305 | 142 | 163 | 46.6% |
| 组1 + 组2 + 组5 部分 | 177 | 305 | 171 | 134 | 56.1% |
| Codex 压缩 / 过期提示 / 日志 | 182 | 305 | 176 | 129 | 57.7% |
| 备份位置 + Profile | 190 | 305 | 184 | 121 | 60.3% |
| WebDAV 同步 | 195 | 305 | 189 | 116 | 62.0% |
| S3 同步（组3 收口） | 200 | 305 | 194 | 111 | 63.6% |
| 额度 3 条（组4 开工） | 203 | 305 | 197 | 108 | 64.6% |
| **Codex / xAI 托管账号查询** | **207** | **305** | **201** | **104** | **65.9%** |

> **需要 305 而非 300**：前端升到 4.0.8 后新增 5 个调用点
> （`acknowledge_codex_stale_clients`、`get/set_codex_session_compression`、
> `get_codex_sessions_disk_usage`、`reveal_app_log_file`），它们也落在缺口里。

> **一处纠正**：某个提交信息写过「组1 18 of 18」，实为 **22/23**。
> 漏的是 `get_opencode_models`，处置见下方组1。

## 实测环境

| 项 | 值 |
|---|---|
| fork | `vandoor7-droid/cc-switch-headless`（本地 `D:\项目\cc-switch-headless`） |
| 版本 | `4.0.8`（`src-tauri/Cargo.toml`） |
| 构建 | `cargo build --no-default-features --features server --bin cc-switch-server`，无 Tauri/WebKit/显示环境 |
| 产物 | `src-tauri/target/debug/cc-switch-server.exe`，55 MB |
| 端点 | `127.0.0.1:15881`（避开 15800 默认值与 15721 代理） |
| 配置目录 | `CC_SWITCH_CONFIG_DIR` 指向 scratch（见下方安全注意） |
| 质量门 | `cargo fmt --check` 与 `cargo clippy -- -D warnings` 均通过；`cargo check`（desktop feature）亦通过 |

## 传输契约（已验证）

| 请求 | 结果 |
|---|---|
| `POST /api/invoke` body `{"cmd":"get_providers","args":{"app":"claude"}}` | `200` → `{"ok":true,"data":{...}}` |
| `POST /api/invoke` body `{"cmd":"get_circuit_breaker_config","args":{}}` | `200` → `{"ok":true,"data":{"failureThreshold":8,...}}`（P3 已补，不再是 `E_NOT_IMPLEMENTED`） |
| `POST /api/invoke` body `{"cmd":"webdav_test_connection","args":{}}` | `200` → `{"ok":false,"error":"E_NOT_IMPLEMENTED: webdav_test_connection"}`（仍缺的代表） |
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

合计 `22+4+37+15+85 = 163`，与 P0 快照的 missing 数一致。
（当前实测是 `22+4+37+15+51 = 129`——砍掉的四类仍是 78 条，E 组已从 85 补到剩 51。）

> **口径说明**：下表各组写的是「该组命令总数 / 已完成」。全部 5 组相加为 90 条
> （组1 23 + 组2 8 + 组3 23 + 组4 30 + 组5 6），其中 **已交付 39、待补 51**。
> 早期文档里出现过的「E 组 85」是某个快照下的**未实现数**，两个口径不同，
> 不要混用——按实测，当前缺口 129 = 按决策砍 78 + 待补 51。

---

## E 组明细（90 条在范围内：39 已交付 / 51 待补，按交付批次）

### 组 1 · 供应商 + 路由/熔断/测速（22/23 已完成）

**熔断/健康 5 条（P3 首刀）：**

```
get_circuit_breaker_config   update_circuit_breaker_config   get_circuit_breaker_stats
reset_circuit_breaker        get_provider_health
```

实测：`get_circuit_breaker_config` 返回真实配置
（`failureThreshold 8 / successThreshold 3 / timeoutSeconds 90 / errorRateThreshold 0.7 / minRequests 15`）；
`get_circuit_breaker_stats` 返回 `null` —— **上游 `commands/proxy.rs` 本身对该命令就是桩**
（"目前先返回 None"），这里忠实保留 `null` 而非报 `E_NOT_IMPLEMENTED`，因为界面读的是
「有没有统计」，`null` 让它安静地不显示，与桌面版一致。

其中 `reset_circuit_breaker` 的「恢复后按 `sort_index` 回切」分支已抽到
`services::failover::reset_circuit_breaker`，桌面命令与 web 派发共用同一份 ——
按 `web/routes.rs` 模块文档的约定，真实逻辑只许在 `services/`。

**端点 / 测速 5 条：**

```
get_custom_endpoints   add_custom_endpoint   remove_custom_endpoint
update_endpoint_last_used   test_api_endpoints
```

**全局出站代理 5 条**（类型与逻辑已从 desktop 门控的 `commands/global_proxy.rs`
抽进 `services::global_proxy`，桌面命令改委托）：

```
get_global_proxy_url   set_global_proxy_url   test_proxy_url
get_upstream_proxy_status   scan_local_proxies
```

**Stack（聚合）5 条 + 连通性/拉模型 2 条：**

```
get_proxy_stack   set_proxy_stack_member   exit_proxy_apps_in_mode
adopt_codex_stack_catalog   restart_codex_app_server_daemon
stream_check_provider   fetch_models_for_config
```

**组 1 唯一不实现的 1 条 —— `get_opencode_models`：**

它靠在服务端执行本机 `opencode models` 实现。而 fork 的 web 模式**刻意拒绝运行本机
CLI**：`host::run_tool_command` 的非 desktop 分支恒返回
`Err("Web 模式暂不支持运行本机 CLI 工具（{tool}）")`。这条是 fork 的安全边界——
`cc-switch-server` 可以经 SSH 隧道 / 反代暴露给另一台机器上的浏览器，此时「在服务端
跑任意 CLI」是升级了的攻击面。

我们的 sidecar 虽然只绑 `127.0.0.1` 且只被插件宿主调用，但我们**会复用同一个二进制做
分发**（P6），把它跑命令的能力加回去等于给所有用这个二进制的人开放该攻击面。
故此处保持 `E_NOT_IMPLEMENTED`。若将来确实需要，正解是加一个显式的
`--allow-local-tools` 开关，而不是在 web 派发里直接放开。

### 组 2 · 设置面（8/8 已完成）

```
get_log_config     set_log_config     get_rectifier_config   set_rectifier_config
get_optimizer_config                 set_optimizer_config    delete_env_vars
restore_env_backup
```

### 组 3 · 数据面（23/23 已完成）

**已完成 5 条 —— Codex 会话压缩 / 过期提示 / 日志（4.0.8 新增）：**

```
get_codex_session_compression   set_codex_session_compression
get_codex_sessions_disk_usage   acknowledge_codex_stale_clients   reveal_app_log_file
```

实测：`get_codex_session_compression` → `false`；`get_codex_sessions_disk_usage`
→ `12484894`（真实字节数）；`acknowledge_codex_stale_clients` → `null`。

`reveal_app_log_file` 用 `tauri_plugin_opener`（desktop-only）定位文件管理器里的日志，
web 模式做不到——服务端没法替**用户**弹窗口。按 fork 已有的约定（`open_config_folder`
就是这么写的）**注册它并返回描述性错误**，而不是留 `E_NOT_IMPLEMENTED`：

```
Web 模式下请在服务器上直接打开 <配置目录>/logs/cc-switch.log
```

这样界面给出的是「去哪里找」，而不是「没有这个命令」。

> **组3 已全部完成**。**更正**：此前判断 webdav 需要先做 200–300 行的抽取重构，读代码后发现**判断错了**——全局同步互斥锁本就在 `services::webdav_sync`，设置助手走非门控的 `settings`，命令层只剩几百字节胶水。现在已抽进 `services::webdav_flow` 共用。原来的这段记载保留，免得下次又按错的前提估工：
> `commands/webdav_sync.rs` 里有真实逻辑——密码合并 `resolve_password_for_request`
> （敏感）、**全局同步互斥锁** `run_with_webdav_lock`（有测试断言它是单例，两个恢复
> 同时跑会半新半旧）、导入后投影 `run_post_import_sync`、错误持久化。
> 按 `web/routes.rs` 的约定必须先抽进 `services/` 再共用，是一次独立的重构，
> 值得单独一轮做完，不拆散。

```
webdav_sync_download    webdav_sync_fetch_remote_info   webdav_sync_save_settings
webdav_sync_upload      webdav_test_connection
s3_sync_download        s3_sync_fetch_remote_info       s3_sync_save_settings
s3_sync_upload          s3_test_connection
list_profiles           create_profile                  update_profile
delete_profile          apply_profile                   clear_current_profile

**已完成 2 条 —— 备份位置：** `list_backup_locations`、`delete_backup_location`
（`reveal_backup_location` 是文件管理器动作，与 `reveal_app_log_file` 同一处置，不实现）。

```

> 另注：`apply_profile` 桌面命令的注释写明「**必须保持同步命令**——`ProviderService::
> switch` 内部用 `block_on` 取切换锁，放进 async 命令会在运行时线程 panic」。
> web 侧移植时要走 `blocking()` 而非 `async` 块内直调，否则会踩这个 panic。

### 组 4 · OAuth 托管账号（7/30 已完成）

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

### 组 5 · 会话/用量余项（4/6 已完成）

```
get_usage_first_date   get_pi_current_state
get_pi_session_discovery   update_pi_provider_usage_script
```

**剩下 2 条延后到 P5（客户端接缝），不是遗漏：**

- `stream_session_messages` 用 Tauri `Channel` 逐块推送。插件侧的
  `src/client/tauri-shim/core.mjs` 里 `Channel` 构造函数**故意抛错**——给一个不会
  说话的 channel，会话阅读器会永远等在空转录上，把「没接线」读成「没有消息」。
  要接它得先有桥（SSE / 分块响应），那是 P5 的活。
- `get_session_image` 返回 `tauri::ipc::Response`（二进制体 + content-type）。
  桥接形状是 `{ body, contentType }`，属于同一处接缝。

---

## 安全注意（本轮实测得出）

1. **用户有真实 cc-switch 数据**：`~/.cc-switch/cc-switch.db` = **24 MB**。
   P0 全程用 `CC_SWITCH_CONFIG_DIR` 指向 scratch，**未触碰真实库**。
   4.0.8 对真实库要跑 **v0→v20** 全量迁移——未经评估绝不能直接上。

2. ✅ **已解决** —— `CC_SWITCH_CONFIG_DIR` 只搬 cc-switch 自己的状态目录，不搬外部
   CLI 配置。P0 实测服务端会：
   - 读真实 `~/.codex/config.toml`、OpenCode live 配置，据此导入供应商（**只读**，
     是决策保留的迁移通道）；
   - **写回真实 `~/.claude`**（清掉「旧版接管留下的代理占位符」，改回直连）。

   后者与决策 #5「外部写入器永不接」直接冲突。已在 fork 加开关关闭：

   ```
   CC_SWITCH_CLIENT_PROJECTION=off
   ```

   默认**开**（桌面与 web 的「本地路由」都依赖它把 CLI 指向代理），置 `off` 时
   只动 `~/.cc-switch` 自己的状态。**P3b 已验证**：scratch 配置目录下开关开启后，
   日志报「客户端投影已关闭」且不再出现写回警告，`~/.claude/settings.json`、
   `~/.claude.json`、`~/.codex/config.toml` 与 OpenCode 配置的 SHA-256 前后一致。

   > 插件侧的宿主监督器（P4）启动 sidecar 时**必须**带上这个环境变量。

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
