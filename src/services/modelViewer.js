// Chargement À LA DEMANDE du composant <model-viewer>.
//
// POURQUOI CE MODULE EXISTE
// L'import vivait dans main.js, déclenché au démarrage de l'application. Il est
// bien dynamique — donc dans un fichier séparé — mais il partait quand même
// SUR CHAQUE PAGE : accueil, catalogue, généalogie, boutique. Or ce composant
// pèse 1 Mo, soit près d'un tiers des 3,3 Mo de JavaScript du site, et la
// grande majorité des visiteurs n'ouvre jamais un modèle 3D.
//
// Ici on ne le charge qu'au moment où une visionneuse s'ouvre réellement.
//
// La promesse est MÉMORISÉE : deux visionneuses ouvertes coup sur coup, ou un
// aller-retour entre deux objets, ne déclenchent qu'un seul téléchargement.
// Sans cette mémorisation, chaque ouverture relancerait un import — le
// navigateur servirait son cache, mais on paierait quand même l'analyse et
// l'exécution du module à chaque fois.

let promesse = null

export function chargerModelViewer() {
  if (!promesse) {
    promesse = import('@google/model-viewer').catch((e) => {
      // Un échec ne doit pas rester mémorisé : sur une coupure réseau
      // passagère, la tentative suivante doit pouvoir réussir.
      promesse = null
      console.warn('[3D] chargement de model-viewer impossible :', e?.message || e)
      throw e
    })
  }
  return promesse
}

// Vrai une fois le composant défini par le navigateur. Permet à une vue
// d'afficher un état d'attente tant que le module n'est pas arrivé.
export function modelViewerPret() {
  return typeof customElements !== 'undefined' && !!customElements.get('model-viewer')
}
