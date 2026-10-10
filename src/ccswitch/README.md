# `src/ccswitch/`

cc-switch 4.0.6 的前端源码按原样复制到这里，目录结构对应上游的 `src/`。

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
- **`@tauri-apps/*` 不全量别名。** `api/core` 与 `api/event` 有 shim；
  `api/window` 和 `@tauri-apps/plugin-*`（dialog / log / process / updater）
  故意不给：窗口 chrome 按决策 #3 砍掉，其余是 M8 的平台映射项，
  让 esbuild 报 "Could not resolve" 比给一个静默无操作的 shim 好。
- **已知需要重写的上游特性**：`src/lib/whatsNew.ts` 的 `import.meta.glob`
  是 Vite 的编译期能力，esbuild 没有对应物，复制过来之前先改。
  `import.meta.env.DEV` 已由 `CLIENT_DEFINE` 直接替换，无需处理。

## 尚未复制

M0 只交付编译管线、依赖版本、React 单实例核对和 IPC 适配层；组件从 M1 开始逐个进来。
