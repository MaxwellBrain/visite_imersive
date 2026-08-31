// LUMIÈRE ADAPTATIVE — l'objet est éclairé comme l'endroit où se tient le visiteur.
//
// Pourquoi cela change quelque chose : une pièce vue à vingt-deux heures dans
// une lumière de plein midi trahit l'écran. La même, sous une lumière rasante
// et chaude, cesse d'être un rendu et devient un objet posé quelque part. On ne
// simule pas la météo — on suit l'HEURE, qui est gratuite, fiable, et porte
// l'essentiel de l'effet.
//
// CE QU'ON RÈGLE, ET POURQUOI CES TROIS-LÀ
//
//   exposure          la quantité de lumière. C'est le réglage dominant.
//   shadow-intensity  une lumière rasante projette une ombre plus longue et
//                     plus marquée ; à midi elle est courte et dure.
//   shadow-softness   plein soleil = ombre nette ; ciel couvert du soir ou
//                     éclairage d'intérieur = ombre diffuse.
//
// On ne touche PAS à `environment-image` : changer la carte d'environnement
// oblige model-viewer à recharger et refaire son pré-calcul, ce qui produit un
// clignotement visible. Les trois réglages ci-dessus se règlent à chaud.
//
// LE MODE « NUIT AU MUSÉE » n'est pas l'heure de nuit : c'est un parti pris de
// mise en scène, plus contrasté et plus sombre que ce que l'heure donnerait,
// avec une ombre longue. On le propose, on ne l'impose jamais.

// Cinq moments, et les bornes sont celles de la lumière, pas de l'horloge
// sociale : « matin » commence quand la lumière rase, pas quand on se lève.
const MOMENTS = [
  { cle: 'nuit',      de: 0,  a: 6,  exposure: 0.72, ombre: 1.05, douceur: 1.35 },
  { cle: 'aube',      de: 6,  a: 9,  exposure: 0.95, ombre: 1.55, douceur: 1.15 },
  { cle: 'jour',      de: 9,  a: 16, exposure: 1.18, ombre: 1.35, douceur: 0.65 },
  { cle: 'aprem',     de: 16, a: 19, exposure: 1.06, ombre: 1.60, douceur: 0.90 },
  { cle: 'crepuscule',de: 19, a: 22, exposure: 0.88, ombre: 1.45, douceur: 1.25 },
  { cle: 'nuit2',     de: 22, a: 24, exposure: 0.74, ombre: 1.10, douceur: 1.30 }
]

// Mise en scène assumée : plus sombre et plus contrastée que la nuit réelle.
const NUIT_AU_MUSEE = { cle: 'musee', exposure: 0.58, ombre: 1.95, douceur: 0.55 }

/** Le moment de la journée, chez le visiteur — pas chez le serveur. */
export function momentCourant(date = new Date()) {
  const h = date.getHours()
  return MOMENTS.find((m) => h >= m.de && h < m.a) || MOMENTS[2]
}

/**
 * Renvoie les trois réglages à appliquer à <model-viewer>.
 *
 * @param {object}  opts
 * @param {boolean} opts.auto     la fiche autorise-t-elle l'adaptation ?
 * @param {boolean} opts.nuit     mode « nuit au musée » demandé par le visiteur
 * @param {object}  opts.base     valeurs de la fiche, qui restent la référence
 */
export function reglagesLumiere({ auto = true, nuit = false, base = {} } = {}) {
  const socle = {
    exposure: Number(base.exposure) || 1.05,
    ombre: Number(base.ombre) || 1.4,
    douceur: Number(base.douceur) ?? 0.9
  }
  if (nuit) return applique(socle, NUIT_AU_MUSEE)
  if (!auto) return { ...socle, moment: 'fiche' }
  return applique(socle, momentCourant())
}

// Le moment MODULE les valeurs de la fiche, il ne les remplace pas. C'est ce
// qui permet à un conservateur d'assombrir une pièce claire sans que
// l'adaptation horaire vienne écraser son réglage : les deux se composent.
function applique(socle, m) {
  const r = (v, f) => Math.round(v * f * 100) / 100
  return {
    exposure: Math.min(3, Math.max(0.2, r(socle.exposure, m.exposure / 1.05))),
    ombre: Math.min(5, Math.max(0, r(socle.ombre, m.ombre / 1.4))),
    douceur: Math.min(2, Math.max(0, r(socle.douceur || 0.9, m.douceur / 0.9))),
    moment: m.cle
  }
}

/**
 * Prochaine bascule de moment, en millisecondes. Sert à reprogrammer un seul
 * minuteur au lieu de sonder l'heure en boucle — une visite peut durer assez
 * longtemps pour traverser un changement de lumière, et c'est un joli détail
 * quand cela arrive tout seul.
 */
export function msAvantProchainMoment(date = new Date()) {
  const m = momentCourant(date)
  const suivant = new Date(date)
  suivant.setHours(m.a, 0, 0, 0)
  if (suivant <= date) suivant.setDate(suivant.getDate() + 1)
  return suivant - date
}

export const momentsConnus = MOMENTS.map((m) => m.cle)
