// dsh-ccswitch-plugin — derivative of 2995288295/dsh-ccswitch-importer-plus
// (Apache-2.0), which is itself a derivative of wtiaw/dsh-ccswitch-importer.
// Reworked for DSH 0.2.0-rc.2. See NOTICE for the full attribution chain.
import { createHash, randomBytes } from 'node:crypto'

function shortHash(input, length) {
  return createHash('sha256').update(input).digest('hex').slice(0, length)
}

function slugify(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : 'provider'
}

export function providerKey(profileId, profileName) {
  const slug = slugify(profileName)
  const hash = shortHash(`${profileId}::${profileName}`, 8)
  return `ccs-${slug}-${hash}`
}

export function credentialRefFor(providerKeyValue) {
  // provider key tail after the last dash is the 8-hex hash.
  const hash = providerKeyValue.split('-').pop()
  if (!/^[a-f0-9]{8}$/.test(hash)) {
    throw new Error(`credentialRefFor: expected an 8-hex hash tail, got "${hash}"`)
  }
  return `DSH_CCSWITCH_${hash.toUpperCase()}_API_KEY`
}

/**
 * A fresh key for a provider the user creates inside DSH.
 *
 * CC Switch mints a UUID here, which would work, but this plugin derives the
 * credential reference from the key's trailing 8 hex characters (see
 * {@link credentialRefForProviderKey}). Keeping that shape means a provider
 * created by hand and one imported from CC Switch address their credentials
 * the same way, so nothing downstream has to know which is which.
 */
export function newProviderKey(displayName) {
  const slug = slugify(displayName)
  return `ccs-${slug}-${randomBytes(4).toString('hex')}`
}

export function credentialRefForProviderKey(providerKeyValue) {
  const tail = String(providerKeyValue).split('-').pop()
  const hash = /^[a-f0-9]{8}$/.test(tail) ? tail : shortHash(String(providerKeyValue), 8)
  return `DSH_CCSWITCH_${hash.toUpperCase()}_API_KEY`
}

export function credentialRef(profileId, profileName) {
  return credentialRefFor(providerKey(profileId, profileName))
}

export function variantKey(baseKey, index) {
  return `${baseKey}-${shortHash(`${baseKey}::${index}`, 4)}`
}
