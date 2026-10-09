// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { MESSAGES } from "./messages.mjs";

export const MODELS_FOOTER_SLOT = "settings.models.footer";

/**
 * Plan A: never shadow the built-in models settings section. Instead, mount
 * our panels (CCSwitch import + reasoning editor) into the built-in page's
 * own declared extension seat `settings.models.footer` (kind "list", scope
 * "root"), so the native "Add model provider" entry point keeps working.
 */
export function registerReasoningSettings(ctx, { controller, importer, component, t }) {
  // Register the whole catalogue, not just `nav`: every string the panels render
  // resolves through these keys, so a locale switch translates the entire UI.
  ctx.locale?.register?.("dsh-ccswitch-plugin", MESSAGES);

  ctx.slots.inject(MODELS_FOOTER_SLOT, () => ctx.slots.register({
    name: MODELS_FOOTER_SLOT,
    id: "ccswitch-importer",
    order: 10,
    inject: () => ({ controller, importer, slots: ctx.slots, t }),
  }, component));

  const refreshImporter = () => {
    const result = importer?.scan?.();
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
    listen("settings/document-updated", () => { void controller.refresh(); }),
    listen("llm/adapters-updated", () => { void controller.refresh(); }),
    listen("credentials/record-updated", refreshImporter),
    listen("credentials/reference-updated", refreshImporter),
  ];
  return () => disposers.forEach((dispose) => dispose());
}
