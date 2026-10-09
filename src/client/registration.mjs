// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { MESSAGES } from "./messages.mjs";
import { makeTranslator } from "./i18n.mjs";

export const MODELS_FOOTER_SLOT = "settings.models.footer";

/**
 * The Plugins settings section's own tab seat (kind "list", scope "root").
 * Declared by `@deepseek-ai/dsh-client-ui-settings`, which hosts one page per
 * contribution and renders `options.label` as the tab title.
 */
export const PLUGINS_TAB_SLOT = "settings.plugins.tab";

/**
 * Plan A: never shadow the built-in models settings section. Instead, mount
 * our panels (CCSwitch import + reasoning editor) into the built-in page's
 * own declared extension seat `settings.models.footer` (kind "list", scope
 * "root"), so the native "Add model provider" entry point keeps working.
 *
 * The provider manager is not a footer of the Models page — it is its own page
 * under Plugins — so it registers into `settings.plugins.tab` instead. Both
 * seats are list-kind root slots, so the same `inject` + `register` shape works
 * for either.
 */
export function registerReasoningSettings(ctx, { controller, importer, manager, managerComponent, component, t }) {
  // Register the whole catalogue, not just `nav`: every string the panels render
  // resolves through these keys, so a locale switch translates the entire UI.
  ctx.locale?.register?.("dsh-ccswitch-plugin", MESSAGES);

  ctx.slots.inject(MODELS_FOOTER_SLOT, () => ctx.slots.register({
    name: MODELS_FOOTER_SLOT,
    id: "ccswitch-importer",
    order: 10,
    inject: () => ({ controller, importer, slots: ctx.slots, t }),
  }, component));

  // Only registered when a manager was supplied, so a caller assembling the
  // importer alone does not get a tab with no controller behind it.
  if (manager && managerComponent) {
    // The tab title goes through the safe translator rather than `t` directly:
    // the owner re-reads this thunk on every render, so a throwing or absent
    // host translator would take the whole Plugins page down with it.
    const tr = makeTranslator(t);
    ctx.slots.inject(PLUGINS_TAB_SLOT, () => ctx.slots.register({
      name: PLUGINS_TAB_SLOT,
      id: "ccswitch-manager",
      // 10 is taken by the importer's footer cell and by other plugins' tabs;
      // 20 keeps this tab after them without colliding.
      order: 20,
      // A thunk, so the tab title follows the active locale: the owner
      // re-reads it per render and never subscribes locale state itself.
      label: () => tr("manager.title", "Provider manager"),
      inject: () => ({ controller: manager, t }),
    }, managerComponent));
  }

  const refreshImporter = () => {
    const result = importer?.scan?.();
    if (result?.catch) void result.catch(() => {});
  };
  const refreshManager = () => {
    const result = manager?.refresh?.();
    if (result?.catch) void result.catch(() => {});
  };
  const listen = (event, handler) => {
    try {
      const dispose = ctx.remote.$on(event, handler);
      return typeof dispose === "function" ? dispose : () => {};
    } catch {
      return () => {};
    }
  };
  const disposers = [
    listen("settings/document-updated", () => { void controller.refresh(); refreshManager(); }),
    listen("llm/adapters-updated", () => { void controller.refresh(); refreshManager(); }),
    listen("credentials/record-updated", refreshImporter),
    listen("credentials/reference-updated", refreshImporter),
  ];
  return () => disposers.forEach((dispose) => dispose());
}
