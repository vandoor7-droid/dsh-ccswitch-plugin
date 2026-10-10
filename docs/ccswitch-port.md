# cc-switch → DSH 移植架构

**日期：** 2026-10-10（v2，范围切换后）
**目标 CC Switch 版本：** 4.0.6（`farion1231/cc-switch`，Rust/Tauri）
**配套规格文档：** `docs/ccswitch-ux-inventory.md`、`docs/ccswitch-backend-inventory.md`、
`docs/ccswitch-write-engine-inventory.md`（已退役·参考）、`docs/ccswitch-command-map.md`

## 背景

CC Switch 是一个跨应用的 provider 管理器：它维护一份 provider 目录，把选中的那一个
投影（project）进各个 AI CLI 的 live 配置文件——Claude Code 的 `settings.json`、
Codex 的 `config.toml` 与 `auth.json`、Gemini CLI 的 `.env`、以及 OpenCode / OpenClaw /
Hermes / Pi / MCode 各自的 JSON 或 YAML。

**v2 把这件事改成了两半**：

1. **只管理 DSH 一家的供应商与模型配置**，不再改写任何外部工具的文件。
2. **供应商管理用添加式（OpenCode / Pi 风格的成员式共存）**，不再是 Claude Code 那种
   配置式（单活跃 + floor 清空重写）。

也就是说，本插件的目录是「候选清单」，DSH 自己的 `llm-pi-ai.providers` 才是「当前在服务的
成员集合」，两者之间靠**加入 / 移出**两个操作往复，而不是靠一个「当前启用」指针。

## 范围（v2 决策记录）

| # | 决策 | 影响 |
| --- | --- | --- |
| 1 | 几乎全量移植，需删减的内容逐条商量 | 计划按全量排，砍单逐条记 |
| 2 | **本地代理（`127.0.0.1:15721`）完整移植** | failover 队列、熔断、限额提示、`PROXY_MANAGED` 语义照搬 |
| 3 | **只管 DSH 一家**；顶部栏位（app 切换条、窗口 chrome）砍掉 | 单 app 形态 |
| 4 | **添加式供应商管理**，不是配置式 | 「切换即重写」退役；成员增删成为主交互 |
| 5 | **外部工具写入器砍掉** | `src/host/writers.js` 与 `/writers/run` 已删除；floor/residue/exclusive 写协议与 `CODEX_FLOOR_TOP`/`CODEX_EXCLUSIVE_TOP` 审计结论一并不适用 |
| 6 | **Apps 安装器砍掉**；MCP / Skills / Prompts / Sessions / Usage / 同步备份保留 | 产品面除安装器外全做 |
| 7 | **能直接复用的原始代码就不自己写** | 前端 TS/TSX、配置数据、i18n、图标原样编译；Rust 后端因技术栈改用 JS 重写，按模块边界镜像 |

### 已移植

- provider 目录的增删改查，存在插件自己的 settings 命名空间里。
- **加入 / 移出 DSH 路由表**（添加式的两个成员操作），按目录顺序读回，不存标志位。
- preset 目录，让「新增 provider」不必从空白表单开始。
- 读取 CC Switch 4.0.x 的全部十种 app_type。
- 逐个 provider 的连通性探活。
- CC Switch 数据库的扫描与解析，作为**迁移导入**通道。

### 明确不在范围内

| 未移植 | 决策 | 原因 |
| --- | --- | --- |
| 外部工具写入器与写引擎全家 | #5 | 只管 DSH；floor/residue/exclusive/`operation` 协议随之不适用 |
| 顶部 app 切换条、窗口 chrome、托盘、自启、便携、内建 updater | #3 | 平台映射项，DSH 侧没有一一对应物（M8 逐个定） |
| Apps 安装器 | #6 | 砍掉 |
| 多 app 子导航、ModeTabs 三模式切换 | #3/#4 | 改按「是否走代理」重解 |
| `costMultiplier` | 原版已停用 | `provider.rs:506-509` 起运行时忽略、日志写 `1.0`；不实现，字段仅留存 |

## 关键架构决定

### 1. 插件拥有自己的 settings 命名空间

provider 目录存在插件自己的命名空间里，而不是写进 `llm-pi-ai.providers`。

`llm-pi-ai` 是 DSH 自己的模型路由表，它的 schema、校验和 UI 都归它所有；把 CC Switch
的目录写进去，等于让两个产品共用一个文档，任何一方改 schema 都会静默破坏另一方。
把目录写进 `llm-pi-ai` 也**在语义上就是错的**：那份文档回答的是「DSH 此刻在用哪些
provider」，而目录回答的是「这份插件拥有哪些 provider」。加入动作仍然会向 `llm-pi-ai`
投影——那是「让 DSH 真的用上这个 provider」，与「管理这份目录」是两件事。

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

### 4. 成员关系是推导出来的，不是存下来的

这是 v2 最核心的一条，也是与 v1 唯一的结构性差异。

两份文档：

- **目录** = 插件命名空间 `dsh-ccswitch-plugin` 里的 `providers` 字典；
- **成员集** = `llm-pi-ai.providers` 这张 DSH 实际在服务的路由表。

「已接入」= **同一个 key 同时出现在两份文档里**。它在每次列表读取时由
`readLiveProviders()` 现场算出，**从不写回目录**。因此两份文档不可能漂移：目录里多一个
字段不会让界面以为它在服务，路由表里少一个键也不会让界面以为它没在服务。

这与 CC Switch 的添加式应用同构：`opencode_config.rs` 与 `pi_config/mod.rs` 都是
「把 provider 加进一个字典 / 从里面删掉」，而不是「把指针指过去」。`dsh-llm-pi-ai` 的
`Config` 正是 `providers: Volatile<Record<string, PiAiProviderProfile>>`——一个**没有
current 字段**的字典，所以这里也没有地方可以放「当前启用」。

由此 `isCurrent` 从行为里彻底退出：它在 schema 里保留，只是 CC Switch 自己 `is_current`
列的原样搬运（编辑表单往返用），**没有任何代码读它做决定**。

### 5. 成员操作永不触碰凭据与默认值

`加入` 与 `移出` 只改 `llm-pi-ai.providers` 这一张表：

- 不写目录，因此不与编辑表单持有的 revision 抢；
- 不动 credentials，移出后重新加入就是原样恢复；
- 不动排序（`sortIndex`）、创建时间、限额、`inFailoverQueue` 等默认配置。

这条来自 CC Switch 的
`provider_membership_never_changes_pi_auth_or_defaults` 原则。它是「加入/移出可重复、
可撤销」的前提——一旦成员操作顺手改了别的东西，用户就不敢点第二次。

删除（`/providers/delete`）例外地**先移出再忘记**：一个仍被路由表指着的 key 若先从目录里
删掉，就会变成谁也摘不掉的悬空成员。移出失败则整体 409（`reason: 'in-use'`），
目录项与密钥原封不动。

### 6. 顺序 = failover 优先级

目录的行序就是 CC Switch 的 `COALESCE(sort_index, 999999), created_at ASC, id ASC`，
而 cc-switch 明确把排序当作故障转移队列的优先级（`commands/provider.rs:924`）。
所以上移/下移按钮不是装饰：M2 的代理按这个顺序走 P1→Pn。拖动排序因此继续有意义，
即使「单活跃」已经不存在。

### 7. 表达不了的协议一律 blocked，不降级

DSH 的 `llm-pi-ai` 只能驱动三种协议：`openai-completions`、`openai-responses`、
`anthropic-messages`。源行里的协议落在这三种之外时，该行被标记为不可导入并给出稳定
的 reason code，而不是「按最接近的一种导入」。

理由：一个注册成功但永远无法应答的 provider，用户会在真正发请求时才发现，而那时线索
已经断在几层之外。导入时说清楚「为什么不能导」，比导进去一个坏掉的行有用。

由此，**Gemini 行永远不可导入**：Gemini CLI 走 Google 原生协议，DSH 没有对应适配器。
该行仍然会被扫描并显示，说明原因，并给出它本应指向的端点——静默消失比明确拒绝更糟。

（注意：这条讲的是**导入**。M2 的代理另有一套协议翻译，能覆盖的范围比这里宽，
但那是代理自己的能力，不能倒回来放宽导入的拒绝。）

### 8. `apiFormat` 是另一种"表达不了的协议"

`claude-desktop` 的行除了 endpoint 与 key，还带一个 `apiFormat`，声明那个 CLI 自己用哪种线格式。
cc-switch 的类型允许四个值：`anthropic`、`openai_chat`、`openai_responses`、`gemini_native`；
它自己的直连校验（`claude_desktop_config.rs`）只放行 `anthropic`，其余一律报错
（"第一阶段只支持原生 Anthropic Messages API"）。

所以这里不是"挑一个最接近的协议导入"，而是**按名字拒绝**：缺省与 `anthropic` 走
`anthropic-messages`，其余三个值以 `unsupported-claude-desktop-protocol` 阻断，`blockedDetail`
带上那个值。这与第 7 条同一个理由。

注意判定用的是**原值**，不做 trim：`"openai_chat "` 会被当作不匹配而拒绝并原样回显。
把近似值规整成匹配，等于替用户宣称一个他没有写下的格式。

### 9. 本地代理是 `127.0.0.1:15721`，与 `dsh-http-proxy` 不冲突

两者方向相反：`dsh-http-proxy` 是**出站**代理策略包（undici 全局 dispatcher，决定
DSH 的请求怎么出去）；cc-switch 的 15721 是**入站**服务，DSH 自己的模型请求打到它上面，
由它按 failover 队列转发给各家上游。端口、职责、进程都不重叠，可以并存。

消费者是 DSH 自己的模型请求：DSH 的出站指向 `127.0.0.1:15721`，代理按队列 P1→Pn 故障转移。

`limitDailyUsd` / `limitMonthlyUsd` 在原版**只是 UI 提示**（余量 <20% 时托盘告警），
代理从不据此拒绝请求——照原样实现成提示，不实现成拦截。

### 10. 失败方向向「保留用户数据」倾斜

解析失败时**拒绝写入**，绝不从空文档重建。cc-switch 的源码注释把这条写成两条事故的
教训——从空文档开始写，等于清空了用户的配置。DSH 侧同样如此：宁可报错，不可覆盖。
这条现在主要落在数据面（同步、备份、导入导出）上，见 M5。

## 已退役的决定（勿再恢复）

v1 里下面三条曾经是本插件最"保真"的部分，随决策 #5 / #4 一并退役：

| 原决定 | 现状 |
| --- | --- |
| **floor 语义：清空再写，而不是合并** | 不适用。没有外部 live 文件可写；`ANTHROPIC_`、`AWS_` 等前缀匹配规则不再需要 |
| **保序写入（原位改值 + 追加），拒绝而非清空** | 不适用。转为数据面的「备份 / 拒绝覆盖」原则（M5） |
| **激活是两次独立投影（DSH 路由 + 外部文件），任一失败都不回滚** | 退化为**一次**投影：`/providers/apply` 只写 `llm-pi-ai`，没有第二半，也就没有「哪一半失败了」的问题。返回的 `warnings` 只剩 `applyProvider` 自己给出的（例如 `llm-pi-ai` 未安装） |

「已经对齐的四处」中的写入器相关三处（Codex profile 覆盖检测、残留清理表、首写备份）
同样退役；**列表排序对齐** 与 **blocked 不降级** 两条继续有效，已并入上面的第 6、7 条。
首写备份的思想没有丢——它转到了数据面的自动备份（M5）。

`lib/core/claude-exclusive.js` 保留，但只剩一个用途：**导入时判断哪些 `env` 键属于这个
provider**，从而收进 `exclusiveEnv` 保证往返不丢。它不再写入、也不再删除任何文件。

## 前端基座（M0）

cc-switch 的前端原样编译复用，靠的是四件事，都在 `scripts/build.mjs` 里：

| 项 | 做法 |
| --- | --- |
| **TSX 管线** | `jsx: 'automatic'` + `jsxImportSource: 'react'`（对齐上游 `tsconfig.json` 的 `"jsx": "react-jsx"`）；`@` 别名指向 `src/ccswitch/`（对齐上游 `"@/*": ["src/*"]` 与 `vite.config.ts` 的 `alias`）；`.png/.jpg/.gif/.webp/.svg` 以 `dataurl` 载入，Vite 的 `?url` 后缀由一个小插件剥掉；`import.meta.env.DEV/PROD/MODE` 用 `define` 直接替换 |
| **依赖版本** | 42 个上游运行时依赖按 `pnpm-lock.yaml` 的**精确版本**进 `devDependencies`（它们被打进 `dist/client.js`，所以是构建期输入而不是运行期依赖）。`@tauri-apps/*` 全部不装——IPC 层由 shim 顶替 |
| **React 单实例** | `CLIENT_EXTERNALS` 必须含 `react/*`、`react-dom/*`（esbuild 的 `external` 只精确匹配裸名，不带子路径；漏了子路径就会内联第二份 React，症状是 Invalid hook call）。`assertSingleReact()` 用 esbuild metafile 在每次构建时断言没有任何 `node_modules/{react,react-dom,scheduler}` 被读进图里，不满足直接构建失败 |
| **Tauri invoke → 插件路由** | esbuild `alias` 把 `@tauri-apps/api/core` 指到 `src/client/tauri-shim/core.mjs`，把 `@tauri-apps/api/event` 指到 `event.mjs`。复制过来的组件一行不用改 |

`src/client/tauri-shim/commands.mjs` 是命令 → 路由表。**表里没有的命令一定抛错**
（`UnmappedCommandError`，错误信息指回 `docs/ccswitch-command-map.md`），绝不静默 no-op；
`event.mjs` 的 `listen/once/emit` 同理全部抛错——DSH 没有 Tauri 事件总线，对应物是还没做的
`ctx.remote` 桥，返回一个永不触发的监听器会渲染出一个看起来像"后端没数据"的空态。

`src/client/http.mjs` 把原来在 `import-controller.mjs` 与 `manager-controller.mjs` 里各抄一份的
同源标记头收成一处，`test/client-host-contract.test.mjs` 断言它与 `src/host/routes.mjs` 的那份
逐字相同（两份不能互相 import：host 侧会连到 `node:sqlite`）。

**已知需要改写的上游特性**：`src/lib/whatsNew.ts` 的 `import.meta.glob` 是 Vite 的编译期能力，
esbuild 没有对应物，复制过去之前先改（构建会响亮地失败，不会静默返回空 map）。

## 与 CC Switch 的偏离

1. **不改写任何外部工具的配置文件。** 这是最大的一条，来自决策 #5。
2. **没有单活跃指针。** `is_current` / `set_current_provider` 的语义不存在；成员集是
   「在 / 不在」的多值集合（决策 #4）。
3. **目录协议只有三种。** CC Switch 还能驱动 Gemini 原生协议、以及各家 OAuth 登录态。
   代理（M2）可以覆盖更宽的范围，但导入不因此放宽。
4. **不生成模型目录。** CC Switch 会为 Codex 生成 `cc-switch-model-catalog.json` 并写
   `model_catalog_json` 指针；本插件不生成目录文件。反向的一半做了：一个指向 cc-switch
   生成目录的**陈旧**指针会被摘掉，按文件 basename 识别，所以不管它被放在哪个目录下都
   认得出；认不出的指针一律不动，不猜。
5. **`costMultiplier` 不实现。** 原版自 4.0.x 起已停用，字段仅在 schema 中留存以保持
   数据往返。
6. **Apps 安装器不做**（决策 #6）。
7. **Universal providers 自然退化。** 跨 app 复用在单 app 下没有意义；目录本身已能表达
   同一条记录的多种形态。

## 模块地图

| 文件 | 职责 | 对应的 cc-switch 源 | 状态 |
| --- | --- | --- | --- |
| `lib/core/scan.js` | 只读扫描 `~/.cc-switch/cc-switch.db` | `src-tauri/src/database/` | 有效（迁移导入） |
| `lib/core/extract.js` | 把一个 provider 行解析成 Host 内的 profile | 各 `*ProviderPresets.ts` 的 `settingsConfig` 形状 | 有效 |
| `lib/core/toml.js` | 只读解析 Codex `config.toml` | `codex_config.rs` | 有效（只读） |
| `lib/core/mapper.js` | profile → `llm-pi-ai` 的 provider 记录 | `services/provider/claude_editor.rs` 等 | 有效（`applyProvider` 走同一条） |
| `lib/core/safety.js` | blocked reason code 与脱敏 | `error.rs` 的 localized code | 有效 |
| `lib/core/claude-exclusive.js` | provider 独有的 `env` 键表 | `live/floor.rs` 的 `CLAUDE_EXCLUSIVE_ENV` | 有效（**仅作导入过滤**） |
| `src/domain/ccs-provider.mjs` | 插件自己的 provider schema | `provider.rs` 的 `Provider` 结构 | 有效（`isCurrent` 降为搬运字段） |
| `src/domain/presets.mjs` | preset 目录 | `src/config/*ProviderPresets.ts` | 有效 |
| `src/host/manager-routes.mjs` | provider CRUD + 加入/移出的 HTTP 面 | `commands/provider.rs` | 有效（激活半边已换成成员操作） |
| `src/host/routes.mjs` | 扫描 / 导入 / 探活的 HTTP 面 | `commands/*` 的扫描与导入 | 有效 |
| `src/host/index.mjs` | 组合：命名空间、`applyProvider`、`withdrawProvider` | — | 有效 |
| `src/ui/ProviderManagerSection.mjs` | 管理页 | CC Switch 的 provider 列表界面 | 有效（启用按钮已换成加入/移出） |
| `src/client/http.mjs` | 浏览器侧传输助手（同源标记头、JSON 读取） | — | 有效 |
| `src/client/tauri-shim/core.mjs` | `invoke` → 插件 HTTP 路由 | `@tauri-apps/api/core` | 有效（M0 交付） |
| `src/client/tauri-shim/commands.mjs` | 命令 → 路由表 | `commands/*.rs` 的注册表 | 部分（未列出的命令抛错） |
| `src/client/tauri-shim/event.mjs` | 事件总线占位，全部抛错 | `@tauri-apps/api/event` | 待 `ctx.remote` 桥 |
| `src/ccswitch/` | 上游前端源码原样复制处 | `src/**` | 空，M1 起填充 |
| `src/host/writers.js` | 投影进外部 live 文件 | `live/project/*`、`live/floor.rs` | **已删除（决策 #5）** |

## 验证

- `npm test`（= `npm run build && node --test`）覆盖：扫描、十种 app_type 的解析、
  CRUD 路由、**加入/移出与目录一致性**、preset 数据完整性、i18n 键与占位符一致性。
- 成员操作的两条不变式各有一组断言：移出后目录项/凭据/排序不动；删除先移出，
  移出失败则整体拒绝且不留悬空成员。
- 端到端：在 desktop profile 安装插件后，扫描本机 CC Switch 库、导入若干 provider、
  加入其中两个（同时在服务）、移出一个，确认 `llm-pi-ai.providers` 与列表一致。
- 代理（M2）另有集成测试：failover 轮换、熔断、限额提示不拦截、`PROXY_MANAGED` 不出网。
