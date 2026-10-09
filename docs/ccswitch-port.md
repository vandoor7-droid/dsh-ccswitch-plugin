# cc-switch → DSH 移植架构

**日期：** 2026-10-10
**目标 CC Switch 版本：** 4.0.6（`farion1231/cc-switch`，Rust/Tauri）

## 背景

CC Switch 是一个跨应用的 provider 管理器：它维护一份 provider 目录，把选中的那一个
投影（project）进各个 AI CLI 的 live 配置文件——Claude Code 的 `settings.json`、
Codex 的 `config.toml` 与 `auth.json`、Gemini CLI 的 `.env`、以及 OpenCode / OpenClaw /
Hermes / Pi / MCode 各自的 JSON 或 YAML。

本插件把这件事搬进 DSH：用 DSH 的 Settings 作为控制面，读写这些外部工具的配置。

## 范围

### 已移植

- provider 目录的增删改查，存在插件自己的 settings 命名空间里。
- preset 目录，让「新增 provider」不必从空白表单开始。
- 读取 CC Switch 4.0.x 的全部十种 app_type。
- Claude Code 与 Codex 的 live 投影（floor 语义，保序写入）。
- 逐个 provider 的连通性探活。

### 明确不在范围内

| 未移植 | 原因 |
| --- | --- |
| 本地代理（`127.0.0.1:15721`） | DSH 已有 `dsh-http-proxy`；再做一遍会与它抢端口和职责 |
| 托盘菜单 | DSH 是 Web/桌面应用，没有托盘这一层 |
| WebDAV 同步 | 与「在 DSH 里管 provider」无关 |
| session 阅读器、提示词库、技能商城 | 属于 CC Switch 的其他产品面，不是 provider 管理 |
| MCP 服务管理 | 独立功能，DSH 侧有自己的 MCP 配置面 |
| 计费 / 余额 / 模型价格聚合 | DSH 已有 `dsh-cost-meter` |
| 托管账号 OAuth（Copilot、Codex OAuth、xAI OAuth） | 需要一套登录流程与 token 轮换，与「导入 provider」是两件事 |
| 统一 provider（universalProviders） | CC Switch 的跨 app 复用形态，本插件用 `appType` 字段表达同一件事 |

## 关键架构决定

### 1. 插件拥有自己的 settings 命名空间

provider 目录存在插件自己的命名空间里，而不是写进 `llm-pi-ai.providers`。

`llm-pi-ai` 是 DSH 自己的模型路由表，它的 schema、校验和 UI 都归它所有；把 CC Switch
的目录写进去，等于让两个产品共用一个文档，任何一方改 schema 都会静默破坏另一方。
导入动作仍然会向 `llm-pi-ai` 投影——那是「让 DSH 自己也能用这个 provider」，与「管理
这份目录」是两件事，分开存放才说得清。

命名空间名就是插件在 `cordis.patch.yml` 里的 row id，因为
`SettingsForms.describe()` 报告的 `ns` 正是 `entry.options.id`。

### 2. 路由没有动态段，key 走 body

DSH 的 web server 只支持 `exact` 与 `prefix` 两种匹配，**没有** `:key` 这样的动态路径段。
所以目录被寻址为 `/providers` 加上 body 里的 `op`，而不是 `/providers/<key>`。

这不是将就：`exact` 路由的重复注册会抛错，前缀匹配是「最长前缀胜」，两者都不支持把
资源 id 编进路径。把 key 放进 body 反而让「key 从哪来」只有一处。

### 3. 凭据永不进入 settings 文档

设置文档是用户 profile 下的明文 YAML。provider 记录里只存 `apiKeyEnv`——一个
`role('credential-ref')` 标记的**引用**；真正的值走 credentials 服务，落在
`$DSH_HOME/.credentials.yaml`。

写入顺序是「先写凭据，再写引用」：反过来会留下一个「UI 显示已配置、但每个请求都失败」
的中间态。删除顺序相反——先删目录项，再删凭据，否则一次失败的 mutate 会销毁一个仍然
挂在目录里的 provider 的密钥。

### 4. floor 语义：清空再写，而不是合并

这是移植中最容易做错、也最值得保真的部分。

一个 provider 在 live 文件里**拥有**一组键（cc-switch 称之为「关键字段」/ floor）。
切换 provider 时，这些键一律先清空，再写入目标 provider 的值；live 里其余的键归用户
和客户端，一个字节都不碰。

为什么不能「只写不删」：上一个 provider 留下的 `ANTHROPIC_BASE_URL` 会让请求继续发往
旧端点，而新 provider 的值看起来又是对的——这类故障极难定位。先清后写保证了
「投影之后，文件里的连接与鉴权键恰好等于目标 provider 的」。

按前缀匹配只用在「整个前缀都属于连接与鉴权」的地方（`ANTHROPIC_`、`AWS_`、
`VERTEX_REGION_`、`GOOGLE_`）。`CLAUDE_CODE_USE_` **不能**按前缀：同一前缀下还有
`CLAUDE_CODE_USE_POWERSHELL_TOOL`、`CLAUDE_CODE_USE_NATIVE_FILE_SEARCH` 这类与
provider 无关的功能开关，误删会改变用户的行为。所以协议选择器逐个列举。

失败方向是安全的：漏掉的键会被当作用户键保留，而不是被误删。

### 5. 保序写入，拒绝而非清空

`settings.json` 的写入是**原位改值 + 追加新键**：已存在的键保持位置、缩进、行尾注释；
其余字节不动。文件原有的缩进字符、CRLF/LF、末尾换行都被保留，所以第二次写入与第一次
字节相同（幂等）。

文件解析失败时**拒绝写入**，绝不从空文档重建。cc-switch 的源码注释把这条写成两条事故
的教训——从空文档开始写，等于清空了用户的配置。DSH 侧同样如此：宁可报错，不可覆盖。

### 6. 表达不了的协议一律 blocked，不降级

DSH 的 `llm-pi-ai` 只能驱动三种协议：`openai-completions`、`openai-responses`、
`anthropic-messages`。源行里的协议落在这三种之外时，该行被标记为不可导入并给出稳定
的 reason code，而不是「按最接近的一种导入」。

理由：一个注册成功但永远无法应答的 provider，用户会在真正发请求时才发现，而那时线索
已经断在几层之外。导入时说清楚「为什么不能导」，比导进去一个坏掉的行有用。

由此，**Gemini 行永远不可导入**：Gemini CLI 走 Google 原生协议，DSH 没有对应适配器。
该行仍然会被扫描并显示，说明原因，并给出它本应指向的端点——静默消失比明确拒绝更糟。

### 7. `apiFormat` 是另一种"表达不了的协议"

`claude-desktop` 的行除了 endpoint 与 key，还带一个 `apiFormat`，声明那个 CLI 自己用哪种线格式。
cc-switch 的类型允许四个值：`anthropic`、`openai_chat`、`openai_responses`、`gemini_native`；
它自己的直连校验（`claude_desktop_config.rs`）只放行 `anthropic`，其余一律报错
（"第一阶段只支持原生 Anthropic Messages API"）。

所以这里不是"挑一个最接近的协议导入"，而是**按名字拒绝**：缺省与 `anthropic` 走
`anthropic-messages`，其余三个值以 `unsupported-claude-desktop-protocol` 阻断，`blockedDetail`
带上那个值。这与第 6 条同一个理由——一个注册成功但永远无法应答的 provider，用户要在真正
发请求时才发现，而那时线索已经断在几层之外。

注意判定用的是**原值**，不做 trim：`"openai_chat "` 会被当作不匹配而拒绝并原样回显。
把近似值规整成匹配，等于替用户宣称一个他没有写下的格式。

### 8. 激活是两次独立投影，任一失败都不回滚

「激活一个 provider」在这里意味着两件不同的事，它们写的是两个不同的地方：

1. **DSH 自己路由过去。** 把 provider 投影进 `llm-pi-ai`，否则目录里那一行会亮起来，
   而每个模型请求仍然走旧路由——界面说一套、实际做一套。
2. **改写外部工具自己的配置。** Claude Code 的 `~/.claude/settings.json`、Codex 的
   `~/.codex/{config.toml,auth.json}`。这才是 CC Switch 里「激活」的本义。

关键点在于：**目录写入一旦成功，它就是既成事实，后面两步都不得撤销它。**

- 后两步各自 try/catch，失败只写进 `warnings`，不改状态码，也不回滚 settings。
  用户的选择是持久的，把请求判为失败只会让人去重试一件已经发生的事。
- 两步之间也互不牵连：任何一步失败，重试只补做没成功的那一半。
- 返回值同时报告 `applied`（DSH 路由是否切换）与 `written`（外部文件写了什么），
  因为两者的修法不同——一个是 DSH settings 的问题，一个是磁盘上的文件。

由此有三个刻意的分支：

- **没有 writer 的 app_type**（目前八种）不是静默跳过，而是明确说出「还没有东西会写
  `gemini` 的配置，已支持的是 claude、codex」。用户要求激活它，静默无事发生会被读成成功。
- **provider 没有存密钥**时拒绝写文件，但**不**拒绝激活：一份指名了没有密钥的 provider
  的配置，会让外部工具以用户看不见的方式坏掉（Claude Code 退回自己的登录、Codex 直接
  拒绝启动），所以文件保持原样。
- **目标文件解析失败**时拒绝覆盖并如实报告，而不是从空文档重建。

## 与 CC Switch 的偏离

除上面的范围裁剪外，还有几处行为差异，都是 DSH 侧约束造成的，不是遗漏：

1. **目录协议只有三种。** CC Switch 还能驱动 Gemini 原生协议、以及各家 OAuth 登录态。
2. **活跃 provider 是全局单选。** CC Switch 是「每个 app 各有一个当前 provider」；本插件
   目前用 `isCurrent` 表达全局唯一的一个。多 app 并存时需要改成 per-app 组。
3. **没有代理模式。** 所以没有 `proxy_projection`、`PROXY_MANAGED` 占位符、也没有
   `stack_default` 那套别名映射。
4. **没有模型目录生成。** CC Switch 会为 Codex 生成 `cc-switch-model-catalog.json` 并写
   `model_catalog_json` 指针；本插件不生成目录文件。
5. **没有 profile 覆盖检测。** CC Switch 在写入 Codex 前会检查
   `[profiles.<name>]` 是否覆盖了选路键，覆盖时拒绝写入（因为写了也不生效）。本插件
   尚未做这项检查。
6. **没有 failover 队列的消费方。** `inFailoverQueue`、`costMultiplier`、
   `limitDailyUsd/Monthly` 字段已在 schema 里保留，但没有本地代理去消费它们，所以目前
   只是记录。
7. **没有残留清理表。** CC Switch 维护一份「自己下发过、且留下来有害」的（键，值）冻结
   列表，每次投影时精确命中才删。本插件尚未移植这张表，所以历史遗留的窗口值不会被
   自动清掉。

## 模块地图

| 文件 | 职责 | 对应的 cc-switch 源 |
| --- | --- | --- |
| `lib/core/scan.js` | 只读扫描 `~/.cc-switch/cc-switch.db` | `src-tauri/src/database/` |
| `lib/core/extract.js` | 把一个 provider 行解析成 Host 内的 profile | 各 `*ProviderPresets.ts` 的 `settingsConfig` 形状 |
| `lib/core/toml.js` | 只读解析 Codex `config.toml` | `codex_config.rs` |
| `lib/core/mapper.js` | profile → `llm-pi-ai` 的 provider 记录 | `services/provider/claude_editor.rs` 等 |
| `lib/core/safety.js` | blocked reason code 与脱敏 | `error.rs` 的 localized code |
| `src/domain/ccs-provider.mjs` | 插件自己的 provider schema | `provider.rs` 的 `Provider` 结构 |
| `src/domain/presets.mjs` | preset 目录 | `src/config/*ProviderPresets.ts` |
| `src/host/manager-routes.mjs` | provider 增删改查的 HTTP 面 | `commands/provider.rs` |
| `src/host/writers.js` | 投影进外部 live 文件 | `live/project/claude.rs`、`live/project/codex.rs`、`live/patch/json.rs`、`live/floor.rs` |
| `src/ui/ProviderManagerSection.mjs` | 管理页 | CC Switch 的 provider 列表界面 |

## 验证

- `npm test` 覆盖：扫描、十种 app_type 的解析、CRUD 路由、写入器的保序与拒绝语义、
  preset 数据完整性、i18n 键与占位符一致性。
- 端到端：在 desktop profile 安装插件后，扫描本机 CC Switch 库、导入若干 provider、
  激活其中一个并确认外部配置文件被正确改写。
