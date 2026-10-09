# DSH CC Switch 管理器

在 DeepSeek Harness 里管理 CC Switch 的 provider：把 Codex、Claude、Claude Desktop、OpenCode、Gemini、Hermes、Grok Build、Pi、MCode 与 OpenClaw 的 provider 导入 DSH，也能不依赖 CC Switch 单独新增/编辑/激活 provider，并把它写回 Claude Code 与 Codex 自己的配置文件。

[English README](./README.en.md)

> **衍生作品说明**：本插件是 [2995288295/dsh-ccswitch-importer-plus](https://github.com/2995288295/dsh-ccswitch-importer-plus)（Apache-2.0）的**衍生版**，而后者又是 [wtiaw/dsh-ccswitch-importer](https://github.com/wtiaw/dsh-ccswitch-importer)（Apache-2.0）的衍生版。本版本由第三方维护，**不是任何上游作者的官方版本**。原始版本面向 DSH 0.1.x；中间 fork 针对 **DSH 0.2.0-rc.2** 重写了 Host/Client 接线；本版本在此基础上继续开发。npm 包名为 `dsh-ccswitch-plugin`，插件 ID 与 loader ID 与包名一致。完整归属链见 [NOTICE](./NOTICE)。

## 功能

- 只读扫描 `~/.cc-switch/cc-switch.db`，识别 CC Switch 4.0.4 的全部十种自定义 provider：**Codex**、**Claude**、**Claude Desktop**、**OpenCode**、**Gemini**、**Hermes**、**Grok Build**、**Pi**、**MCode** 与 **OpenClaw**；官方和默认 profile 会跳过。其中 **Gemini** 一定会被标记为不可导入——Gemini CLI 走 Google 原生协议，DSH 的 `llm-pi-ai` 没有对应适配器——该行会说明原因并给出它本应指向的端点。
- 将 endpoint、协议、模型 ID 和 API key 导入 DSH 的 `llm-pi-ai` 设置。
- API key 只在 Host 进程中读取，并通过 DSH credentials 服务保存为 `apiKeyEnv` 引用；扫描和导入响应不包含 key。
- 从 Codex TOML 顶层 `model_reasoning_effort` 预填模型推理配置，同时允许之后在 DSH 中修改。
- `none` 映射为关闭；已知模型使用保守目录；未知模型只生成导入值对应的单个等级；非法值安全关闭并给出警告。
- 重新导入不会覆盖已有的推理等级、route 默认值、headers、容量字段或未出现在 CCSwitch 的额外模型。
- 原生 Models 页面、CCSwitch 导入区和模型推理编辑器共存于同一个 Models 页面。
- CCSwitch 导入区、模型推理面板和每个模型卡片都支持收纳折叠，折叠偏好会保存在当前浏览器。

### provider 管理器（不依赖 CCSwitch）

**设置 -> 插件** 里还有一个独立的 provider 管理器，它把 provider 目录存在插件**自己的** settings 命名空间
（`dsh-ccswitch-plugin.providers`）里，因此**不装 CCSwitch 也能用**：

- 增删改查 provider：显示名、协议、endpoint、模型列表、备注、图标、成本倍率与每日/每月额度。
- 28 个内置 preset（DeepSeek、Kimi、智谱 GLM、硅基流动、OpenRouter、NVIDIA、MiniMax、豆包等），
  新建时挑一个即可，也可以从空白表单开始。
- **激活**一个 provider 会做两件事，且彼此独立：把 DSH 自己的 `llm-pi-ai` 路由切过去；以及改写
  **那个 provider 所属工具自己的配置**——目前覆盖 **Claude Code**（`~/.claude/settings.json`）
  与 **Codex**（`~/.codex/config.toml` 与 `auth.json`）。
- 目录写入成功即视为既成事实：后面两步任何一步失败都只写进 `warnings` 而不回滚，重试只补做没成功的那一半。
  没有 writer 的 app type 会被明确点名，而不是静默跳过。

### 写回外部工具配置的边界

外部配置的写入遵循 CC Switch 的 **floor** 语义，这是最值得小心的一部分：

- 一个 provider 在 live 文件里**拥有**一组键（连接与鉴权）；切换时这些键先清空再写入目标 provider 的值，
  文件里其余的键归用户和客户端，一个字节都不碰。
- **保序写入**：已存在的键保持位置、缩进、行尾注释；文件原有的缩进字符、CRLF/LF、末尾换行都保留，
  因此重复写入字节相同。
- 目标文件**解析失败时拒绝写入**，绝不从空文档重建——宁可报错，不可覆盖用户的配置。

CCSwitch 本身是只读导入源：导入后 DSH 设置和 credentials 服务成为配置事实来源，插件不会写回 CCSwitch 数据库。

## 安装

> **不要用 `dsh plugin --profile desktop add`。** 它会被 DSH 拒绝：
> `error: profile "desktop" is managed exclusively by the Electron application`
> ——desktop profile 由桌面应用独占管理。请按下面的步骤手动安装。

1. **先完全退出 DSH**（桌面应用会在运行时回写下面这两个文件）。

2. 把包装进 profile 的 pnpm 工程：

```bash
cd ~/.dsh/profiles/desktop
pnpm add github:vandoor7-droid/dsh-ccswitch-plugin
# 或从本地源码：pnpm add /path/to/dsh-ccswitch-plugin
```

3. 把包名加进同一目录下 `package.json` 的 `dsh.profile.bundles`：

```json
"dsh": {
  "profile": {
    "bundles": ["...", "dsh-ccswitch-plugin"]
  }
}
```

**第 3 步不能漏。** 插件的 `cordis.patch.yml` 是 **bundle patch**，而 DSH 只对列在
`dsh.profile.bundles` 里的包合并它的 patch。只做第 2 步的话，依赖装得好好的，插件
依然不出现——而且不报任何错，那一行永远到不了 loader。

4. 重启 DSH。打开 **设置 -> 插件**（provider 管理器）与 **设置 -> 模型**（CCSwitch 导入）。

> 从本地源码安装时，`pnpm add` 复制的是**构建产物**而不是链接。改完源码要
> `npm run build`，再重新 `pnpm add` 一次，DSH 才会用到新的构建。

## 使用

1. 在 Models 页面打开「CCSwitch 导入」并点击「扫描」。
2. 选择需要导入的 provider，点击「导入选中」。
3. 检查导入结果和 provider 模型列表。
4. 在同页的模型推理区域确认已预填的等级；第三方网关需要自定义 wire value 时直接编辑并保存。
5. 使用各面板标题栏或模型卡片右侧的箭头收纳/展开内容；折叠偏好会自动记住。
6. 在输入框模型选择器中使用保存后的推理等级。

导入会在设置 revision 冲突时停止并恢复本次写入的 credential；已有 credential 会恢复原值。

## 推理目录

当前保守目录包含：

- GPT-5.6 系列：`off: none`、`low`、`medium`、`high`、`xhigh`、`max`。
- OpenAI o-series（`o1`、`o3`、`o4-mini` 及变体）：`off: null`、`low`、`medium`、`high`。

目录只是默认值，保存后的 DSH 字段由用户控制。

## DSH Community Market 目录

本插件按 [目录适配器指南（路径 A：标准来源）](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/catalog-adapter-guide.zh.md) 提供可接入 DSH Community Market 的标准目录。仓库内包含：

- `scripts/build-catalog.mjs` —— 从 `package.json` 元数据生成 `catalog-source` manifest 与 `/v1/plugins` 条目页；
- `scripts/deploy-catalog.sh` —— 一键部署到 Cloudflare Pages（含 JSON Content-Type 重写规则）；
- `test/catalog.test.mjs` —— 用官方 Schema 校验生成结果并断言元数据一致；
- [docs/catalog.md](./docs/catalog.md) —— 部署方式、Content-Type 要求与来源登记说明。

同时，本插件仓库已添加 GitHub topic `dsh-plugin`，会被 [dshfind](https://dshfind.com) 目录来源按 topic 自动收录。

生成与部署：

```bash
DSH_CATALOG_ORIGIN=https://catalog.example.com npm run build:catalog
```

## 安全边界与限制

- Host 路由只接受 loopback、same-origin 请求；API key 不进入浏览器、日志、摘要或错误文本。
- 读取需要 Node.js 22.19 或更高版本，以支持只读 SQLite API。
- 插件只处理 CCSwitch 的自定义 Codex / Claude / Claude Desktop / OpenCode / Gemini / Hermes / Grok Build / Pi / MCode / OpenClaw provider 和当前数据库字段；「测试连接」先请求 `{baseURL}/models`（免费、不发推理请求），只有当上游不提供模型列表（`401`/`403`/`404`/`405`/`501`）时，才对该 provider 真正使用的端点补发一次 **1 token** 的最小请求，用于区分「中转站不暴露 `/models`」与「凭据确实无效」。它不写入任何设置，失败时会把上游自己的错误原文（脱敏后）一并显示。
- 未知模型和不合法等级默认关闭，避免向网关发送未确认的 reasoning 参数。

## 与 dsh-ccswitch-importer-plus 的差异

本版本（`dsh-ccswitch-plugin`）基于 [2995288295/dsh-ccswitch-importer-plus](https://github.com/2995288295/dsh-ccswitch-importer-plus)，继承了它针对 DSH 0.2.0-rc.2 的全部重写工作。当前相对它的增量：

- 包名、插件 ID、loader ID、locale 命名空间、样式 ID、折叠偏好键统一从 `dsh-ccswitch-importer-plus` 改为 `dsh-ccswitch-plugin`。
- `package.json` 的 `author` 改为本项目维护者，`contributors` 保留中间 fork 作者与原 upstream 作者，`repository`/`bugs`/`homepage` 指向本仓库。
- `NOTICE` 重写为三代归属链（本仓库 -> `2995288295/dsh-ccswitch-importer-plus` -> `wtiaw/dsh-ccswitch-importer`）。
- 每个被改动源文件的头部注释同步为完整归属链。

> 折叠偏好键改名意味着升级后浏览器里旧的折叠状态会被重置一次，属于预期行为。

## 与上游的差异

相对 [wtiaw/dsh-ccswitch-importer](https://github.com/wtiaw/dsh-ccswitch-importer)（`0.1.3`，2026-09-24，面向 DSH 0.1.x），本版本的主要改动：

**针对 DSH 0.2.0-rc.2 的兼容性重写**

- peer 依赖改为 `^0.2.0-rc.2`，移除 0.2.0 已废弃的 `@deepseek-ai/dsh-client-runtime` 注入。
- 适配 0.2.0 的 `{ ok, value }` 远端信封与 `settings.describe()` 命名空间视图。
- 导入源从 Codex 扩展到 CC Switch 4.0.4 的全部十种 app_type（Codex / Claude / Claude Desktop / OpenCode / Gemini / Hermes / Grok Build / Pi / MCode / OpenClaw）。
- 新增模型目录回退、模型探测（probe）与 loopback 错误透出。
- 插件挂载到原生「模型」页面底部的 footer 槽位，与原生 UI 共存。

**缺陷修复**

- 批量导入此前只成功第一条：现在每次写入成功后重新读取 settings revision，作为下一条的并发前置条件。
- 凭据脱敏从「按 `sk-` 形状匹配」改为「按已知密钥的值脱敏」，导入响应与 stderr 都不再回显 API key。
- `POST /import` 现在强制要求同源 `Origin` 头；超长请求体会销毁连接而不是静默忽略。
- 保存推理等级期间若又产生新改动，状态显示为「已保存（有未保存修改）」而不是「已保存」。
- 空扫描结果现在区分「未安装 CCSwitch / 无 profile / 数据库不可读 / Node 版本过低」，并回显探测路径。
- `node:sqlite` 改为懒加载，Node 版本不足时给出可读提示，而不是整个插件加载失败。
- 界面文案全部走 zh/en 语言目录，不再硬编码中文。

**`0.2.0-rc.3` 界面可用性修复**

- 被阻止的行现在直接说明原因：服务端为每种原因附带机器可读的 `blockedCode`（未知值一律回退为 `blocked`），界面按 zh/en 目录本地化呈现，并把 app type、npm 适配器这类可变部分通过 `blockedDetail` 一并显示。
- 导入后的自动刷新不再清空导入结果；结果项显示 provider 名称而不是内部 ID，失败项标红，并新增「清除」入口。
- 首次进入设置页不再闪现「没有可读取的 CCSwitch provider」；「扫描中」与「导入中」不再共用同一个按钮文案。
- 推理面板：保存后再修改，徽章立刻变为「有未保存的改动」，而不是继续显示「已保存」；无改动时保存按钮禁用，避免空写一次设置；「重新载入」在会丢弃本地修改时先确认；等级行汇总新增「已自定义 N 项」标记，折叠状态下也能看出哪些模型改过 wire 值。

**`0.2.0-rc.4` 测试连接**

- 每个可导入的行现在都有一个「测试连接」按钮：新增的 `POST /api/dsh-ccswitch/probe` 只请求 `{baseURL}/models`，把结果显示在行内——`连通 · N 个模型 · Nms`，或具体失败原因（`HTTP 401`、超时、网络错误、缺少凭据），在需要做判断的地方直接给出结论。
- 探测在结构上就是只读的：这条路由不碰 settings，也不执行导入。有一条测试断言导入路径被调用 **0** 次。
- 按钮放在徽章旁边，而不是塞进行 `<label>` 里，所以点击按钮不再连带切换复选框；没有凭据或 base URL 的行不显示按钮；单次请求最多探测 50 行。
- 结果在两端都做归一化（未知原因一律按网络失败处理，计数与耗时都做夹取），重扫后消失的行会连带丢弃它的探测结果；服务端继续按密钥值脱敏，错误响应里不会回显 key。

**`0.2.0-rc.5` 探测更可信**

- 失败信息不再只有一个状态码：探测会把上游自己的错误原文取出来（脱敏、压成一行、截断 200 字符）附在行内，例如 `失败 · HTTP 401 · Invalid token (request id: …)`，而不是让用户对着一个 `HTTP 401` 猜。
- `/models` 被中转站挡住时不再是假失败：当它是 `401`/`403`/`404`/`405`/`501` 时，会按该 provider 的协议（`openai-completions` → `/chat/completions`、`openai-responses` → `/responses`、`anthropic-messages` → `/messages`）补发一次带上 `max_tokens: 1` 的最小真实请求。只要这次成功，行内显示 `连通 · 最小请求 · Nms`，明确说明是通过哪种方式验证的。
- 这次补发只发生在免费检查答不上来的时候，且上游不可达（超时/网络错误）或该 provider 没有已知模型 ID 时不会发第二次请求；导入路径的模型加宽仍然只走 `/models`，因此不会因为探测而多花钱。
- 新增宿主半未加载的识别：如果探测请求本身返回 `401`/`404`（宿主还没加载新路由，页面却已经是新的客户端 bundle），行内会提示「宿主未加载该接口，重启 DSH 后重试」，而不是把它误读成上游故障。

**`0.2.0-rc.6` 修复「测试连接」被同源围栏拦下**

- 修掉一个我自己引入的缺陷：写操作原本**必须有 `Origin` 头**，但浏览器在同源 POST 上是允许不发 `Origin` 的（这个界面就是这样），于是每次点击都只得到 `forbidden: missing Origin on a state-changing request`，看起来就像探测接口坏了。现在改为接受三种等价证明：`Origin` 与 `Host` 一致、`Sec-Fetch-Site: same-origin`（浏览器设置，脚本无法伪造）、或客户端自己带的 `x-dsh-ccswitch-origin` 标记头。
- 这三种证明跨站页面都给不出来：自定义头会触发 CORS 预检，而这条路由不响应预检；`Sec-Fetch-Site` 由浏览器填写。因此围栏没有被削弱，只是不再误伤同源页面。
- 被拒绝时响应体现在会附带 `saw: { origin, site, marker }`，直接说明这次请求到底带了什么，避免再对着一个 `forbidden` 猜。
- 同样的修复也覆盖了 `/import`：它此前有完全一样的问题。

上游版权与许可证原样保留在 `LICENSE`；改动声明见 `NOTICE`，且每个被改动的源文件头部都带改动提示。

移植架构、与 CC Switch 的对应关系、以及有意未移植的部分，见 [docs/ccswitch-port.md](./docs/ccswitch-port.md)。

## 开发与验证

要求 Node.js 22.19 或更高版本：

```bash
npm install
npm test
npm run pack:check
```

`npm run build` 生成 DSH Host bundle 和带有 `window.__ModuleLoader__.load` 注册的 Client bundle。发布包只包含 `dist`、patch、README、NOTICE 和许可证，不包含源码与测试。
