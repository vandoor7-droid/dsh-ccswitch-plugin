// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { MESSAGES, DEFAULT_LOCALE } from "./messages.mjs";

/**
 * Wrap the framework translator (`ctx.locale.bind(namespace)`) so components
 * can fall back safely.
 *
 * The returned function never throws and never renders `undefined`: when the
 * host translator is absent, returns nothing useful, or the key is missing, the
 * caller-supplied fallback is used instead. `{name}` placeholders are expanded
 * here rather than relying on the host's interpolation support.
 */
export function makeTranslator(t) {
  return function translate(key, fallback, params) {
    let template;
    try {
      template = typeof t === "function" ? t(key) : undefined;
    } catch {
      template = undefined;
    }
    if (typeof template !== "string" || template.length === 0) template = fallback;
    if (typeof template !== "string" || template.length === 0) return key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) => (
      Object.hasOwn(params, name) ? String(params[name]) : match
    ));
  };
}

/** Catalogue lookup for the given locale, falling back to the default. */
export function messagesFor(locale) {
  return MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
}
