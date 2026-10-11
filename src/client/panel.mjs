// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * The left-sidebar entry: a row in DSH's rail that opens cc-switch itself.
 *
 * DSH's shell exposes exactly two seats for this, and the shipped composition
 * fills neither — `ui-sidebar`'s README says so plainly ("The shipped
 * composition registers no example panel"), which is why this is a designed
 * extension point rather than something being bent to fit:
 *
 * - `sidebar.panellist` (list, root) — one row per plugin: an icon plus a
 *   label, ordered by `order`. 插件 is `0`, 自动化任务 is `10`, so `20` puts
 *   this one directly beneath them.
 * - `main` (keyed, root) — the body that fills the main column. The layout keys
 *   it on `activePanelId` and retains any key it finds in the slot, so
 *   registering the body is enough; nothing else needs to learn the id exists.
 *
 * The icon receives `{ size, active }` from the shell, which owns the row
 * chrome, the tooltip and the selected styling. The body receives nothing and
 * assembles cc-switch's own provider stack instead — that stack is `main.tsx`'s
 * job in the desktop build, and `main.tsx` is the Tauri entry point, which DSH
 * never mounts (it renders `<App />` directly).
 *
 * ### What `main.tsx` did that we deliberately do not
 *
 * | `main.tsx` | here | why |
 * |---|---|---|
 * | `installGlobalErrorHandlers()` | skipped | It replaces `window.onerror` and `unhandledrejection` **for the whole document**. That document belongs to DSH; a plugin must not own it. cc-switch's errors surface through the boundary below instead. |
 * | `body.classList.add("is-mac")` | skipped | Same reason: it is a style hook on DSH's `<body>` and would change DSH's own layout. |
 * | `initializeWindowActivity()` | skipped | It watches the native window we do not have. |
 * | `syncModelsDevPricingOnStartup()` | skipped | A background fetch on mount. Until the sidecar is wired (P4) it can only fail, and a failing request every time the tab opens is noise, not behaviour. |
 * | `listen("configLoadError", … exit(1))` | skipped | `exit()` in someone else's process is never right. |
 *
 * Everything the component tree actually needs — react-query, theme, the update
 * context, motion reduction, tooltips, the toaster — is reproduced verbatim,
 * because a missing provider is a crash inside a copied component and those are
 * expensive to read out of a blank panel.
 *
 * `Toaster` is included even though cc-switch's own `main.tsx` puts it outside
 * the app: without a mounted Toaster every `toast()` in the copied UI
 * disappears silently, which looks like "nothing happened" rather than an error.
 */
import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { ArrowLeftRight } from "lucide-react";
import { queryClient } from "@/lib/query";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UpdateProvider } from "@/contexts/UpdateContext";
import { Toaster } from "@/components/ui/sonner";
import { FrontendErrorBoundary } from "@/components/FrontendErrorBoundary";
import App from "@/App";
import "@/i18n";
import ccsStyles from "ccswitch:styles";
import { makeTranslator } from "./i18n.mjs";

const h = React.createElement;

/** Matches the `id` used for both seats — the shell joins them through it. */
export const PANEL_ID = "ccswitch";

/**
 * cc-switch's utilities, compiled with the `dsh-ccs-` prefix so none of them
 * reaches DSH's document. Installed at module scope: a `<style>` that only
 * appears once the row is clicked gives a flash of unstyled content.
 *
 * Same id as the one `ProviderManagerSection` installs, and the same guard, so
 * the two mount points share one stylesheet instead of injecting it twice.
 */
const STYLE_ID = "dsh-ccswitch-ccs-styles";
function installStyles() {
  if (typeof document === "undefined" || !ccsStyles) return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = ccsStyles;
  document.head.appendChild(style);
}
installStyles();

/**
 * cc-switch's own React tree, in DSH's main column.
 *
 * Written with `h()` rather than JSX: this is an `.mjs` file and the build
 * loader for those is plain JS — the same reason `ProviderManagerSection.mjs`
 * defines `const h = React.createElement`.
 */
export function CCSwitchPanel() {
  return h(
    FrontendErrorBoundary,
    null,
    h(
      QueryClientProvider,
      { client: queryClient },
      h(
        ThemeProvider,
        { defaultTheme: "system", storageKey: "cc-switch-theme" },
        h(
          UpdateProvider,
          null,
          h(
            MotionConfig,
            { reducedMotion: "user" },
            h(
              TooltipProvider,
              { delayDuration: 0, skipDelayDuration: 0 },
              h(App),
            ),
            h(Toaster),
          ),
        ),
      ),
    ),
  );
}

/**
 * The rail glyph.
 *
 * `ArrowLeftRight` rather than a brand mark: every other row in this rail is a
 * monochrome stroke glyph that inherits the row's colour, and a multicoloured
 * logo would read as a different kind of object. The meaning is the one that
 * matters here — cc-switch is about which provider a request goes to.
 */
export function CCSwitchPanelIcon({ size = 18 }) {
  return h(ArrowLeftRight, { size, "aria-hidden": true });
}

/**
 * Register both seats.
 *
 * @param {object} ctx - the plugin context, which carries `slots`.
 * @param {Function} t - this plugin's bound locale translator.
 * @param {Function} makeTranslator - builds a translator with a default, so a
 *   missing key yields copy rather than a throw inside the shell's row list.
 */
export function registerPanel(ctx, t, makeTranslator) {
  const tr = makeTranslator(t);

  // `label` is a thunk because the shell re-reads it on every render after a
  // locale switch, and it must never subscribe to locale state itself — the
  // same convention the Plugins and Automation rows follow.
  //
  // The default is the product name in every locale, which is why no key is
  // added to the catalogue for it: "CC Switch" is not a word to translate.
  const disposeRow = ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 20,
        locale: "dsh-ccswitch-plugin",
        label: () => tr("panel.title", "CC Switch"),
      },
      CCSwitchPanelIcon,
    ),
  );

  const disposeBody = ctx.slots.inject("main", () =>
    ctx.slots.register(
      {
        name: "main",
        key: PANEL_ID,
        locale: "dsh-ccswitch-plugin",
      },
      CCSwitchPanel,
    ),
  );

  // Both seats go together: a row whose body is gone would throw the moment it
  // was clicked (`layout.selectPanel` rejects an id the `main` slot does not
  // hold), so neither may outlive the other.
  return () => {
    disposeBody?.();
    disposeRow?.();
  };
}
