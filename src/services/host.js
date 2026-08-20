// Résolution de l'organisation par NOM D'HÔTE.
//
// ARCHITECTURE (corrigée le 2026-08-20) :
//   nexacode.store            LA PLATEFORME — vitrine, inscription, et
//                             back-office du super-admin qui voit tous les
//                             locataires.
//   <slug>.nexacode.store     le site d'UN locataire. Le slug est choisi par
//                             l'organisation à son inscription.
//
// `musea.nexacode.store` n'est donc PAS la plateforme : c'est un locataire
// parmi les autres, au même titre que `bandjoun.nexacode.store`.
//
// Priorité voulue : le nom d'hôte d'abord (sous-domaine ou domaine personnalisé),
// le chemin /c/:slug conservé en repli local (dev, aperçu).
//
// Le domaine de plateforme peut compter plusieurs niveaux : la comparaison porte
// sur la chaîne entière, donc un déploiement sur « app.exemple.com » résoudrait
// « bandjoun.app.exemple.com » sans traitement particulier.
//
// La mise en service DNS/CloudFront (joker *.nexacode.store) est décrite
// dans infra/ ; ce module en est la couche applicative.

// Le repli doit valoir la RACINE, jamais un sous-domaine : si la variable
// d'environnement venait à manquer, un défaut à « musea.nexacode.store » ferait
// silencieusement revenir l'application à l'ancienne architecture, où la
// plateforme occupait un sous-domaine et où `musea` ne pouvait pas être loué.
export const PLATFORM_DOMAIN = (import.meta.env.VITE_PLATFORM_DOMAIN || 'nexacode.store').toLowerCase()

// Sous-domaines système réservés (miroir de la table `slugs_reserves`) : jamais une organisation.
export const RESERVED_SUBDOMAINS = new Set([
  'admin', 'api', 'app', 'assets', 'blog', 'c', 'cdn', 'compte', 'demo', 'dev', 'docs',
  // `musea` n'est PLUS réservé : la plateforme vit désormais sur la racine
  // (nexacode.store), et `musea.nexacode.store` est un locataire comme un autre.
  // Le laisser ici l'aurait rendu impossible à attribuer à une organisation.
  'erp', 'ftp', 'help', 'inscription', 'login', 'mail', 'media', 'preview',
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
    const label = sub.split('.')[0] // seul le premier label fait le slug (slug.musea.nexacode.store)
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
