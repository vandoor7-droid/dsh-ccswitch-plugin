// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.

/**
 * `tailwind-merge` with this plugin's class prefix baked in.
 *
 * cc-switch's `cn()` is `twMerge(clsx(inputs))`, and `tailwind-merge` decides
 * which classes *override* which by parsing their names. Every class in this
 * build carries a `dsh-ccs-` prefix (see `scripts/ccswitch-style.mjs`), so
 * without the same prefix here `cn("dsh-ccs-p-4", "dsh-ccs-p-2")` would fail to
 * recognise the conflict and emit both — the merge would silently stop
 * merging, which is exactly the class of bug that looks fine until a hover
 * state does nothing.
 *
 * Aliased over the package by `scripts/build.mjs`, the same way `@tauri-apps/*`
 * is, so `src/ccswitch/lib/utils.ts` keeps calling `extendTailwindMerge` with
 * no knowledge of any of this. It imports the real implementation through the
 * `#tailwind-merge` subpath alias declared in `package.json`, because an alias
 * on `tailwind-merge` would otherwise rewrite this file's own import too.
 */
import {
  extendTailwindMerge as realExtend,
  twJoin as realTwJoin,
  twMerge as realTwMerge,
} from '#tailwind-merge'

/**
 * The prefix, spelled again because the single source of truth lives in
 * `scripts/ccswitch-style.mjs`, which runs under Node and must not be pulled
 * into the browser bundle. `test/client-host-contract.test.mjs`-style drift is
 * caught by `test/ccswitch-style.test.mjs`, which asserts the two agree.
 */
export const PREFIX = 'dsh-ccs-'

/** The cc-switch configuration, with the prefix forced on top of it. */
export function extendTailwindMerge(config = {}) {
  return realExtend({ ...config, prefix: PREFIX })
}

/** The prefixed merge, for anything that wants it directly. */
export const twMerge = extendTailwindMerge()

export const twJoin = realTwJoin
export default twMerge
