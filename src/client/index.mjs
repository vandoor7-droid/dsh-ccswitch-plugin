// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { createReasoningSettingsController } from "./controller.mjs";
import { createCCSwitchImportController } from "./import-controller.mjs";
import { createCCSwitchManagerController } from "./manager-controller.mjs";
import { registerReasoningSettings } from "./registration.mjs";
import { ModelsFooterPanel } from "../ui/ModelsFooterPanel.mjs";
import { ProviderManagerSection } from "../ui/ProviderManagerSection.mjs";
import { installEmbedStyles } from "./styles.mjs";

export const name = "dsh-ccswitch-plugin";

// 0.2.0: remote settings/credentials namespaces are mounted by dsh-api-remotes;
// dsh-client-runtime no longer exists and connection.api is gone.
export const inject = [
  "slots",
  "locale",
  "remote",
];

export function apply(ctx) {
  const controller = createReasoningSettingsController(ctx.remote);
  const importer = createCCSwitchImportController({
    getRevision: () => controller.getSnapshot().revision,
    // The reasoning panel mirrors the settings document the import just wrote,
    // so it has to refresh — and so does the source scan, otherwise the rows
    // that were imported keep their "ready to import" badge. `keepResults`
    // preserves the report `importSelected` published a moment ago.
    onImported: async () => {
      controller.refresh();
      await importer.scan({ keepResults: true });
    },
  });
  const manager = createCCSwitchManagerController({
    // A manager write lands in the same settings document the reasoning editor
    // edits and the importer classifies against, so both have to re-read: a
    // provider added here must show up in the reasoning panel immediately, and
    // the manager's own table is refreshed by the controller itself.
    onChanged: async () => {
      controller.refresh();
      await importer.scan({ keepResults: true });
    },
  });
  const t = ctx.locale.bind("dsh-ccswitch-plugin");
  const removeStyles = installEmbedStyles();
  const dispose = registerReasoningSettings(ctx, {
    controller,
    importer,
    manager,
    managerComponent: ProviderManagerSection,
    component: ModelsFooterPanel,
    t,
  });
  ctx.effect(() => {
    controller.refresh();
    return () => {
      dispose();
      removeStyles();
    };
  }, "dsh-ccswitch-plugin.lifecycle");
}
