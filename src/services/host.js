// Résolution de l'organisation par NOM D'HÔTE (Phase 2 — sous-domaines <slug>.musea.space).
//
// Priorité voulue : le nom d'hôte d'abord (sous-domaine ou domaine personnalisé),
// le chemin /c/:slug conservé en repli local (dev, aperçu). Le domaine plateforme
// est configurable via VITE_PLATFORM_DOMAIN (défaut « musea.nexacode.store »).
//
// Le domaine de plateforme peut compter plusieurs niveaux : la comparaison porte
// sur la chaîne entière, donc « bandjoun.musea.nexacode.store » est résolu
// correctement sans traitement particulier.
//
// La mise en service DNS/CloudFront (joker *.musea.nexacode.store) est décrite
// dans infra/ ; ce module en est la couche applicative.

export const PLATFORM_DOMAIN = (import.meta.env.VITE_PLATFORM_DOMAIN || 'musea.nexacode.store').toLowerCase()

// Sous-domaines système réservés (miroir de la table `slugs_reserves`) : jamais une organisation.
export const RESERVED_SUBDOMAINS = new Set([
  'admin', 'api', 'app', 'assets', 'blog', 'c', 'cdn', 'compte', 'demo', 'dev', 'docs',
  'erp', 'ftp', 'help', 'inscription', 'login', 'mail', 'media', 'musea', 'preview',
  'site', 'smtp', 'staging', 'static', 'status', 'support', 'test', 'www'
])

// Hôtes de développement / prévisualisation : traités comme la plateforme (site historique).
function isLocalHost(host) {
  return (
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(host) ||
    host.endsWith('.local') ||
    host.endsWith('.vercel.app') ||
    host.endsWith('.pages.dev') ||
    host.endsWith('.netlify.app')
  )
}

// Analyse le nom d'hôte courant.
// Renvoie { kind, slug } où kind ∈ 'local' | 'platform' | 'reserved' | 'subdomain' | 'custom'.
export function parseHost(hostname) {
  const raw = hostname != null
    ? hostname
    : (typeof window !== 'undefined' ? window.location.hostname : '')
  const host = String(raw || '').toLowerCase().replace(/:\d+$/, '')

  if (!host || isLocalHost(host)) return { kind: 'local', slug: null }

  if (host === PLATFORM_DOMAIN || host === `www.${PLATFORM_DOMAIN}`) {
    return { kind: 'platform', slug: null }
  }

  if (host.endsWith(`.${PLATFORM_DOMAIN}`)) {
    const sub = host.slice(0, host.length - (`.${PLATFORM_DOMAIN}`).length)
    const label = sub.split('.')[0] // seul le premier label fait le slug (slug.musea.space)
    if (RESERVED_SUBDOMAINS.has(label)) return { kind: 'reserved', slug: label }
    return { kind: 'subdomain', slug: label }
  }

  // Tout autre hôte = domaine personnalisé pointé par l'organisation.
  return { kind: 'custom', slug: null }
}

// URL canonique préférée d'une organisation : son domaine personnalisé vérifié,
// sinon son sous-domaine sur le domaine plateforme.
export function canonicalOrigin(tenant) {
  if (!tenant) return null
  if (tenant.custom_domain && tenant.domain_verified) return `https://${tenant.custom_domain}`
  if (tenant.slug) return `https://${tenant.slug}.${PLATFORM_DOMAIN}`
  return null
}
