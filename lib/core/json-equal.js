// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
/**
 * Key-order-insensitive deep equality for JSON-serializable provider docs.
 * DSH persists through a schema-normalizing YAML round-trip that reorders
 * object keys, so a raw JSON.stringify comparison always reports a diff.
 */
export function jsonEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => jsonEqual(item, b[index]))
  }
  if (typeof a === 'object' && a !== null && b !== null) {
    const aKeys = Object.keys(a).filter((key) => a[key] !== undefined)
    const bKeys = Object.keys(b).filter((key) => b[key] !== undefined)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) => b[key] !== undefined && jsonEqual(a[key], b[key]))
  }
  return false
}
