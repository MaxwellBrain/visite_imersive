// DÉTECTION DU REGARD — colliders invisibles et rayon depuis le centre de l'écran
//
// Il n'existe pas d'oculométrie sur un téléphone : ce que l'on appelle « ce que
// le visiteur regarde » est en réalité « ce qu'il a mis au centre de son écran
// et y a laissé ». C'est une approximation, mais elle est honnête — pointer un
// objet avec son téléphone EST un geste d'attention.
//
// TROIS PROBLÈMES QUI NE SE VOIENT QU'À L'USAGE
//
//  1. LA MAIN TREMBLE. Un rayon strict sort du collider dix fois par seconde.
//     Sans hystérésis, la fixation ne se déclenche jamais. On laisse donc le
//     compteur SURVIVRE à une perte brève (`graceMs`) au lieu de le remettre à
//     zéro à chaque frémissement.
//
//  2. BALAYER N'EST PAS REGARDER. Un rayon qui traverse un collider en tournant
//     la tête ne doit rien déclencher. D'où le contrôle de STABILITÉ : on
//     mémorise la direction au début de la fixation, et on abandonne si le
//     regard s'en écarte de plus de `toleranceDeg`. Deux secondes de fixation
//     ne valent que si ce sont deux secondes au même endroit.
//
//  3. ON VOIT À TRAVERS LES MURS. Le visiteur est DANS la case : sans occlusion,
//     il déclenche le récit du grenier en regardant la paroi qui le cache. On
//     lance donc le rayon sur les colliders ET sur la coque du bâtiment, et on
//     ne retient le point que s'il est le PREMIER touché.

import { Raycaster, Vector3, Mesh, SphereGeometry, MeshBasicMaterial, Group } from 'three'

// Portée du rayon, en mètres. Borner évite de tester des colliders hors de vue
// à chaque image, et empêche de « viser » la rue à travers une paroi.
//
// ATTENTION : ce n'est PAS une constante universelle. Douze mètres suffisent
// pour un tolek de six, et condamnent la moitié des points d'une concession de
// vingt : sur le relevé de la Fondation, la sortie se trouve à 13,8 m du
// centre, donc à plus de 23 m d'un visiteur posté au bord opposé — le rayon
// s'arrêtait avant, et ce point n'aurait JAMAIS pu être regardé. Le moteur
// passe donc une portée calculée sur l'emprise de la scène ; cette valeur
// n'est plus qu'un plancher, pour les cas où l'emprise est inconnue.
const PORTEE_M = 12

export const REGLAGES_REGARD = Object.freeze({
  fixationMs: 2000,     // §4 — 1 800 à 2 200
  toleranceDeg: 9,      // écart angulaire toléré pendant la fixation
  graceMs: 220,         // perte de contact tolérée sans remise à zéro
  portee: PORTEE_M
})

// ---------------------------------------------------------------------------
// Colliders
// ---------------------------------------------------------------------------
// Des sphères invisibles à l'œil, mais bien présentes pour le rayon.
//
// Une sphère plutôt qu'une boîte : le regard n'a pas d'orientation privilégiée,
// et une sphère se teste en une soustraction de vecteurs. À sept colliders,
// l'économie est théorique ; elle cesse de l'être si une chefferie en pose
// soixante-dix sur un village entier.
export function creerColliders(hotspots) {
  const groupe = new Group()
  groupe.name = 'colliders-regard'
  const geo = new SphereGeometry(1, 12, 8)
  // `colorWrite: false` plutôt que `visible = false` : le raycaster de Three.js
  // ne tient pas compte de la visibilité, mais le rendu, lui, écrirait quand
  // même des pixels transparents. Là, la carte graphique ne touche à rien.
  const mat = new MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, colorWrite: false
  })

  for (const h of hotspots) {
    const m = new Mesh(geo, mat)
    m.position.set(h.x || 0, h.y ?? 1.2, h.z || 0)
    m.scale.setScalar(h.rayon || 0.45)
    m.renderOrder = -1
    m.userData.hotspotId = h.id
    m.userData.code = h.code
    m.name = `collider:${h.code}`
    groupe.add(m)
  }
  return groupe
}

// ---------------------------------------------------------------------------
// Suivi
// ---------------------------------------------------------------------------
export function creerSuiviRegard(reglages = {}) {
  const R = { ...REGLAGES_REGARD, ...reglages }
  const rayon = new Raycaster()
  rayon.far = R.portee

  const origine = new Vector3()
  const direction = new Vector3()
  const directionInitiale = new Vector3()

  let courant = null        // hotspotId en cours de fixation
  let dwell = 0             // ms de fixation cumulées
  let perduMs = 0           // ms depuis la dernière intersection effective
  const cosTolerance = Math.cos((R.toleranceDeg * Math.PI) / 180)

  function reset() { courant = null; dwell = 0; perduMs = 0 }

  // `camera`     — la caméra XR (sa matrice monde porte la pose du visiteur).
  // `colliders`  — le Group rendu par creerColliders().
  // `occulteurs` — maillages opaques (la coque de la case). Peut être vide.
  function evaluer(camera, colliders, occulteurs, dt) {
    camera.getWorldPosition(origine)
    // En réalité augmentée, le « centre de l'écran » est l'axe optique de la
    // caméra : -Z dans son repère. Aucune conversion de coordonnées souris
    // n'est nécessaire, et il ne FAUT pas en faire — en session immersive il
    // n'y a plus de curseur ni de viewport unique (deux yeux sur un casque).
    camera.getWorldDirection(direction)
    rayon.set(origine, direction)

    const cibles = occulteurs && occulteurs.length
      ? colliders.children.concat(occulteurs)
      : colliders.children
    const touches = rayon.intersectObjects(cibles, true)

    // Le premier touché fait foi. Si c'est une paroi, le point qui se trouve
    // derrière n'est pas regardé : il est caché.
    const premier = touches[0]
    const vise = premier && premier.object.userData.hotspotId != null
      ? premier.object.userData.hotspotId
      : null

    if (vise != null && vise === courant) {
      perduMs = 0
      // Contrôle de stabilité : le regard a-t-il tenu la même direction ?
      if (direction.dot(directionInitiale) < cosTolerance) {
        // Il a glissé : la fixation redémarre ICI, sur la nouvelle direction.
        directionInitiale.copy(direction)
        dwell = 0
      } else {
        dwell += dt
      }
    } else if (vise != null) {
      courant = vise
      dwell = dt
      perduMs = 0
      directionInitiale.copy(direction)
    } else if (courant != null) {
      // Perte de contact. Tolérée brièvement (main qui tremble, pas du visiteur),
      // au-delà on considère qu'il a détourné les yeux.
      perduMs += dt
      if (perduMs > R.graceMs) reset()
      else dwell += dt * 0.5   // on continue de compter, mais à demi-crédit
    }

    return {
      hotspotId: courant,
      dwellMs: dwell,
      // « stable » ne veut pas dire « immobile » : il veut dire que la fixation
      // en cours n'a pas été rompue. C'est ce que consomme la machine à états.
      stable: courant != null && perduMs <= R.graceMs,
      valide: courant != null && dwell >= R.fixationMs,
      progression: courant == null ? 0 : Math.min(1, dwell / R.fixationMs)
    }
  }

  return { evaluer, reset, get reglages() { return R } }
}
