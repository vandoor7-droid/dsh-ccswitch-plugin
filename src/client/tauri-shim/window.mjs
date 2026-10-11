// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * `@tauri-apps/api/window` for a host that has no native window.
 *
 * cc-switch's `App.tsx` calls `getCurrentWindow().setDecorations(...)` on every
 * preference change and `WindowControls` drives min/max/close. Inside DSH those
 * buttons are DSH's business, not ours: the renderer is a tab in someone
 * else's window. The shapes below are therefore no-ops rather than stubs that
 * throw — `setDecorations` sits in a `useEffect` that would otherwise take the
 * whole panel down on the first settings read.
 *
 * The upstream source of this file is the headless fork's `src/web-shims/window.ts`
 * (vandoor7-droid/cc-switch-headless), which solved the same problem for the
 * browser. Kept identical in behaviour; only the header comment and module
 * system differ. See `src/ccswitch/README.md` for why we write `.mjs` here.
 */

export class WebWindow {
  async minimize() {}
  async toggleMaximize() {}
  async isMaximized() { return false }
  async maximize() {}
  async unmaximize() {}

  /**
   * `close()` really closes in the fork's shim because there the whole window
   * IS this app. Here it is a tab inside DSH, so closing would be destructive
   * and the click that reaches us should have been routed to DSH's own chrome
   * instead. Deliberately inert.
   */
  async close() {}

  async setDecorations() {}
  async setFocus() {}
  async show() {}
  async hide() {}

  async onResized() { return () => {} }
  async onFocusChanged() { return () => {} }
  async onCloseRequested() { return () => {} }
}

export function getCurrentWindow() {
  return new WebWindow()
}

export function getAllWindows() {
  return [new WebWindow()]
}
