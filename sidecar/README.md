# `sidecar/` — cc-switch 无头桥接（P1）

本目录随插件仓库存放：**对上游 cc-switch 的补丁 + 桥接层实现 + 桥接验收测试**。
真正的开发在我们自己的 fork 上进行（`vandoor7-droid/cc-switch-headless`，
基于 `zhangzhiwei-zzw/cc-switch-headless`），本目录保存的是补丁的**来源与规格**。

> 选型理由见计划：调研了 9,574 个 cc-switch fork，没有一个自带 DSH 集成；
> `zhangzhiwei-zzw/cc-switch-headless` 已经把 cc-switch 做成无头服务
> （`cc-switch-server`、`@tauri-apps/api` 的 HTTP/SSE 垫片、68 条命令派发、
> `GET /api/capabilities` 能力协商、700 行 e2e、Windows 预编译），
> 是转接路线的现成参考实现。

## 为什么必须 fork 而不是「摘层」

- 我们 vendored 的前端是 **4.0.6**，headless fork 基线 **v4.0.0**（落后 147 提交）。
  在它上面 `merge` 上游 4.0.6，比把它的 web 层往 4.0.6 移植更省事——web 层调的是
  `services/*` 稳定接口，但补丁面越小越好。
- fork 上写 = 补丁、e2e、能力表、Windows 构建矩阵都在同一棵树里跟版，
  不用在两个仓之间搬运 diff。

## 契约（P0/P1 的实现目标）

### 传输

| 通道 | 形状 |
|---|---|
| 命令 | `POST /v1/invoke/<cmd>`，body `{ args }`，返回 `{ ok, data } \| { ok:false, error }`（沿用 fork 的信封与字符串 reject 语义） |
| 事件 | `GET /v1/events`（SSE）——13 个事件名，对应 `AppHandle::emit` 的全部 21 处调用点 |
| 流 | `GET /v1/stream/session` —— 唯一的 `Channel`（`stream_session_messages`），分块 → SSE/NDJSON |
| 能力 | `GET /v1/capabilities` —— `{ features: { pageProviders, pageRouting, …, }, mode: "web" }`，前端据此**隐藏**未实现入口而不是让用户点了报错 |
| 静态 | 仅开发用；插件侧不托管 fork 的前端 |

- 绑定 `127.0.0.1`，端口**避开 15721**（代理引擎自占）。
- 鉴权：启动时随机 256-bit token，经环境变量交给宿主；每个请求带 `Authorization: Bearer`。
  浏览器**永不直连** sidecar——一律经插件 host 路由转发（保住 `methodFence` 同源栅栏，
  密钥与 token 只在 host 半边出现）。

### 参数代入

| Tauri 形参 | 桥接层代入 |
|---|---|
| `State<'_, AppState>` 等 5 种 State（215 处） | headless `App` 的 `app.state::<T>()`（5 种在 `lib.rs` 已 `manage`） |
| `AppHandle`（40 处） | headless `AppHandle`；其中 B4/B5/B6/B7 共 **16 条**桌面命令返回 `E_NOT_IMPLEMENTED`，由 capabilities 隐藏 |
| `Channel<T>`（1 处） | 流端点的分块写入器 |
| `tauri::ipc::Response`（1 处） | `{ body: base64, contentType }` |

**外部写入器命令永不接入**（决策 #3/#5）：写 `~/.claude`、`~/.codex`、15721 takeover
客户端配置的命令一律不注册——只管 DSH，且避开"两个写者竞写客户端配置"的风险。
代理只服务 DSH 自己的模型请求。

### `AppType`

摘 yang227 的 PR（cc-switch #7244 / #7356）里的 `dsh` 枚举 + `is_additive_mode`
+ 字符串解析，**去掉它的 llm-pi-ai 写器**——成员/路由由插件 JS 层管
（`apply`/`withdraw` 写 `llm-pi-ai`，`inUse` 推导逻辑照旧）。

## 目录约定

```
sidecar/
├── README.md            ← 本文件：契约与选型理由
├── patches/             ← 对上游的补丁（若补丁以 patch 文件形式存放）
└── e2e/                 ← 摘自 fork `scripts/e2e/*.smoke|pages|proxy|sessions|security`
                            的桥接验收，改指向本地桥端口与 token
```

## 验收（P0 尖峰）

1. `TAURI_CONFIG='{"app":{"windows":[]}}'` + 空 `frontendDist` 编出 `bridge_main`。
2. `curl -H "Authorization: Bearer $TOKEN" -d '{"args":{"app":"dsh"}}' .../v1/invoke/get_providers` 返回目录。
3. `GET /v1/events` 在另一次 `invoke` 触发 `emit` 时收到事件（否则 21 处 emit 需改 sink）。
4. 15721 代理转发一次真实模型请求往返。
