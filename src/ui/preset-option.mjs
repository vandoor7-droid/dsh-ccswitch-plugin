// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * What one preset looks like in the picker: its name, plus the version suffix
 * CC Switch appends when a vendor sells several plans or serves two regions.
 *
 * A preset that declares neither dimension is shown by its name alone, which is
 * what CC Switch does — every such entry in this catalogue is the only preset
 * for its vendor, so there is no sibling to tell it apart from.
 *
 * Lives in its own module rather than beside the section that renders it: the
 * section pulls in cc-switch's TypeScript components, which only a bundler can
 * load, while this is a pure function over the plugin's own preset catalogue
 * and should stay importable straight from a test.
 */
import { presetVersionKeys } from "../domain/presets.mjs";
import { messagesFor } from "../client/i18n.mjs";
import { DEFAULT_LOCALE } from "../client/messages.mjs";

/**
 * The fallback locale's catalogue, read once for the preset labels.
 *
 * Those three families — group, plan and region — are data-driven: the key is
 * built from the preset's own field, so there is nowhere to write a literal
 * fallback the way the static strings do. Reading them from the catalogue keeps
 * every key the picker can ask for resolvable even in a locale that has not
 * translated it yet.
 */
const FALLBACK = messagesFor(DEFAULT_LOCALE);

export function presetOptionLabel(preset, tr) {
  const parts = presetVersionKeys(preset).map((key) => tr(key, FALLBACK[key]));
  return parts.length === 0 ? String(preset?.displayName ?? "") : `${preset.displayName} · ${parts.join(" · ")}`;
}
