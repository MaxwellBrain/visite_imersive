import { computed, ref, onBeforeUnmount } from 'vue'

// QUI A LE DROIT DE PARLER — un seul guide à la fois.
//
// LE PROBLÈME QU'IL RÉSOUT
//
// Le site public monte QUATRE guides différents, et rien ne les empêchait de
// coexister sur le même écran :
//
//   PublicLayout   → GuideChat  (fil de discussion ÉCRIT, flottant, toutes pages)
//   PublicLayout   → VoiceBot   (guide vocal flottant, toutes pages)
//   PublicObject   → GuideInline (question/réponse ÉCRITE, dans la page)
//   Object3DViewer → ObjectGuideRobot (avatar vocal, DANS le visualiseur)
//
// Ouvrir la 3D d'une œuvre affichait donc l'avatar vocal ET, par-dessus lui,
// une bulle de discussion écrite. Deux façons de poser la même question, dont
// une qui contredit le parti pris de la visite immersive : sur un objet en 3D,
// on regarde, on écoute, on ne lit pas. Pire, `VoiceBot` et l'avatar partagent
// le MÊME moteur de synthèse (`useTts` expose un état de module, pas une
// instance) et le MÊME micro : les faire vivre ensemble, c'est deux voix qui se
// coupent et une reconnaissance vocale qui change de propriétaire en route.
//
// POURQUOI UN COMPTEUR ET PAS UN BOOLÉEN
//
// Deux visualiseurs peuvent se chevaucher le temps d'une transition (le
// dialogue 3D qui se ferme pendant que la vue RA s'ouvre). Avec un booléen, le
// premier qui se ferme rend la parole à tout le monde alors que le second la
// tient encore. Le compteur ne la rend qu'au dernier sorti.
const detenteurs = ref(0)

/** Vrai quand un visualiseur immersif tient la parole : les guides écrits et le
 *  bot vocal global doivent alors s'effacer. */
export const paroleImmersive = computed(() => detenteurs.value > 0)

/**
 * À appeler par un visualiseur immersif. Rend une paire de fonctions et libère
 * automatiquement la parole si le composant est détruit sans se refermer
 * proprement — une navigation arrière, par exemple. Sans ce filet, un compteur
 * resté à 1 ferait disparaître le guide écrit sur tout le reste du site.
 */
export function useGuideFocus() {
  let tenuIci = 0

  function prendreLaParole() {
    tenuIci += 1
    detenteurs.value += 1
  }

  function rendreLaParole() {
    if (!tenuIci) return          // symétrie : on ne rend que ce qu'on a pris
    tenuIci -= 1
    detenteurs.value = Math.max(0, detenteurs.value - 1)
  }

  onBeforeUnmount(() => {
    detenteurs.value = Math.max(0, detenteurs.value - tenuIci)
    tenuIci = 0
  })

  return { paroleImmersive, prendreLaParole, rendreLaParole }
}
