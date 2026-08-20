// PRÉCHARGEMENT DES ROUTES
//
// LE PROBLÈME QUE ÇA RÉSOUT
//   Le découpage par route évite de télécharger tout le site au démarrage, mais
//   déplace le coût : le PREMIER accès à une page paie son morceau de
//   JavaScript. Mesuré le 2026-08-20 sur le site en ligne — 1,2 s pour les
//   musées, 6,3 s pour les boutiques, 5,8 s pour la généalogie, alors que les
//   visites suivantes tiennent en 15 ms.
//
// L'IDÉE
//   Un visiteur amène sa souris sur un lien avant de cliquer. Ce délai — 200 à
//   400 ms en général — suffit à télécharger le morceau. Au clic, le code est
//   déjà là. On ne rend pas le téléchargement plus rapide : on le déplace dans
//   un moment où personne n'attend.
//
// CE QU'ON NE PRÉCHARGE PAS, ET POURQUOI
//   - Les liens externes : ce n'est pas notre code.
//   - En mode économie de données, ou sur réseau lent (2g) : précharger y coûte
//     plus qu'il ne rapporte, et peut consommer un forfait pour une page que le
//     visiteur n'ouvrira jamais. C'est loin d'être théorique pour un site
//     consulté depuis le Cameroun.
//   - Une route déjà préchargée : la mémorisation évite d'y revenir.

const dejaCharges = new Set()
let listeners = null

// Un simple passage de souris ne vaut pas une intention. On attend un court
// instant avant de déclencher : traverser l'écran survole des liens sans que
// personne n'ait l'intention de les ouvrir.
const DELAI_INTENTION = 70

function reseauMenage() {
  const c = navigator.connection
  if (!c) return true                       // information indisponible : on précharge
  if (c.saveData) return false
  return !/^(slow-)?2g$/.test(c.effectiveType || '')
}

/**
 * Télécharge le morceau de code d'une route, sans y naviguer.
 * Les composants d'une route paresseuse sont des FONCTIONS : les appeler
 * déclenche l'import dynamique, et donc le téléchargement.
 */
export function prechargerRoute(router, cible) {
  if (!cible || dejaCharges.has(cible)) return
  dejaCharges.add(cible)

  let resolue
  try {
    resolue = router.resolve(cible)
  } catch {
    return                                   // adresse hors du routeur : rien à faire
  }
  if (!resolue?.matched?.length) return

  for (const enregistrement of resolue.matched) {
    for (const composant of Object.values(enregistrement.components || {})) {
      // Un composant déjà résolu n'est plus une fonction : rien à télécharger.
      if (typeof composant !== 'function') continue
      try {
        // Un échec ici est sans conséquence : la navigation réelle réessaiera,
        // et l'utilisateur verra alors une vraie erreur s'il y en a une.
        Promise.resolve(composant()).catch(() => dejaCharges.delete(cible))
      } catch {
        dejaCharges.delete(cible)
      }
    }
  }
}

// Un lien mérite-t-il un préchargement ?
function lienInterne(a) {
  if (!a || !a.getAttribute) return null
  const href = a.getAttribute('href')
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return null
  if (a.target === '_blank' || a.hasAttribute('download')) return null
  // `a.href` est absolu : la comparaison d'origine écarte les liens externes
  // sans avoir à deviner à partir de la chaîne écrite dans le HTML.
  try {
    const u = new URL(a.href, location.href)
    if (u.origin !== location.origin) return null
    return u.pathname + u.search
  } catch {
    return null
  }
}

/**
 * Active le préchargement au survol, au focus clavier et au premier contact
 * tactile. Un seul écouteur par type, posé sur le document : des centaines de
 * liens n'ajoutent alors aucun coût, contrairement à un écouteur par lien.
 */
export function activerPrechargement(router) {
  if (listeners || typeof document === 'undefined') return
  if (!reseauMenage()) return

  let minuteur = null

  const viser = (e) => {
    const a = e.target?.closest?.('a[href]')
    const cible = lienInterne(a)
    if (!cible) return
    clearTimeout(minuteur)
    minuteur = setTimeout(() => prechargerRoute(router, cible), DELAI_INTENTION)
  }
  const annuler = () => clearTimeout(minuteur)

  // `touchstart` sans délai : sur mobile il n'y a pas de survol, et le doigt
  // qui touche l'écran annonce déjà le clic — on gagne le temps du geste.
  const tactile = (e) => {
    const cible = lienInterne(e.target?.closest?.('a[href]'))
    if (cible) prechargerRoute(router, cible)
  }

  document.addEventListener('mouseover', viser, { passive: true })
  document.addEventListener('mouseout', annuler, { passive: true })
  document.addEventListener('focusin', viser, { passive: true })
  document.addEventListener('touchstart', tactile, { passive: true })

  listeners = { viser, annuler, tactile }
}

/**
 * Précharge quelques routes pendant l'inactivité du navigateur.
 * À réserver aux destinations vraiment probables : tout précharger reviendrait
 * à annuler le découpage qu'on vient de mettre en place.
 */
export function prechargerAuRepos(router, cibles = []) {
  if (!cibles.length || !reseauMenage()) return
  const lancer = () => cibles.forEach((c) => prechargerRoute(router, c))
  // `requestIdleCallback` attend un vrai temps mort ; à défaut on temporise,
  // pour ne pas concurrencer le rendu de la page en cours.
  if ('requestIdleCallback' in window) window.requestIdleCallback(lancer, { timeout: 4000 })
  else setTimeout(lancer, 2500)
}
