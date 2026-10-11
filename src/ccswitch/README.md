# `src/ccswitch/`

cc-switch **4.0.8** 的前端源码按原样复制到这里，目录结构对应上游的 `src/`。

**升级方式**：从上游 `farion1231/cc-switch` 的 `v4.0.8` tag 提取 `src/`，整目录覆盖
（我们自己的 `README.md` 保留）。**不要从 headless fork 取** —— 那里的 `src/` 比上游多
10 处 web 模式适配（`web-shims/` 9 个文件 + `lib/capabilities.ts`），与我们自己的
`src/client/tauri-shim/` 职责重叠。

## 为什么是原样复制

计划决策 #7：**能直接复用的原始代码就不要自己写**，只有技术栈不同才必须重写。
所以这里的文件保持上游的 `.tsx`、`@/…` 路径别名、自动 JSX 运行时、`?url` 资源后缀
一概不动，由 `scripts/build.mjs` 提供与上游 `tsconfig.json` / `vite.config.ts` 一致的
编译选项来消化它们。

唯一被改写的是数据层：`@tauri-apps/api/core` 的 `invoke` 被 esbuild `alias`
指向 `src/client/tauri-shim/core.mjs`，从 Tauri IPC 变成打本插件自己的 HTTP 路由。
映射表在 `src/client/tauri-shim/commands.mjs`，命令去向总表在
`docs/ccswitch-command-map.md`。

## 约定

- **一个文件一个上游对应物。** 从 `src/components/…` 复制过来就放
  `src/ccswitch/components/…`，不要重命名、不要合并。
- **改写必须写在文件头。** 任何偏离上游的行，上面都要有一段说明为什么 ——
  下一次对照上游 diff 时，这段话就是"这里是有意为之"的证据。
- **`@tauri-apps/*` 的别名是白名单，不是黑名单。** `scripts/build.mjs` 的
  `CLIENT_ALIAS` 挂了 7 个：`core` `event`（IPC）、`app` `path` `window`
  （版本与路径）、`plugin-log` `plugin-updater`。**仍未给** `plugin-dialog`
  与 `plugin-process` —— 它们只被 `main.tsx` 引用，而 DSH 直接渲染 `<App />`，
  从不挂 `main.tsx`，所以让 esbuild 报 "Could not resolve" 依然比加一个
  谁也调不到的 shim 好。

## 重新 vendoring 的清单

换上游版本时，下面几处是**我们打过的补丁**，会随整份覆盖丢掉，必须重打：

| 文件 | 改了什么 | 不打的后果 |
|---|---|---|
| `lib/whatsNew.ts` | `import.meta.glob` → 逐份静态 `import` | cjs 下 `import.meta` 为空，模块初始化即抛 TypeError，**整棵 App 树渲染不出来**。构建只给一条 warning，所以**构建绿不代表没踩** |
| `App.tsx` | `useAppWindowControls` 外加 `isTauri()` 门卫；`@tauri-apps/api/core` 的 import 补 `isTauri` | Windows 上页头出现 minimize/maximize/close 三个死按钮（`api/window` 在本仓是 no-op shim） |

其余 566 个文件保持上游逐字节不动 —— Tailwind 前缀在**构建期**由
`scripts/ccswitch-style.mjs` 施加，所以 git 里的源码不因它而偏离。

> 更新 vendored 源码时注意 `Get-Content` / `Set-Content` 的编码：不带 `-Encoding`
> 往返一次会把中文写成 ANSI，文件随即不再是合法 UTF-8。用 `git checkout --` 恢复。
