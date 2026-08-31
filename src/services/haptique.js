// RETOUR HAPTIQUE — faire sentir la matière sous le doigt.
//
// L'idée tient en une phrase : une pièce en perles et une pièce en bois poli ne
// doivent pas donner la même sensation quand on les fait tourner. Le téléphone
// ne sait pas restituer une texture, mais il sait produire un RYTHME — et le
// rythme suffit à faire la différence entre « granuleux » et « lisse ».
//
// CE QUE L'API PERMET, ET CE QU'ELLE NE PERMET PAS
//
// `navigator.vibrate()` prend une durée ou une suite [vibre, pause, vibre…] en
// millisecondes. Elle ne règle NI l'intensité NI la fréquence. Tout se joue donc
// sur la découpe temporelle :
//
//   lisse     une impulsion continue et brève       ▬
//   granuleux des impulsions courtes et serrées     ▪▪▪▪▪
//   dur       une impulsion sèche et forte          ▮
//   souple    une montée en deux temps              ▪ ▬
//
// LÀ OÙ ELLE N'EXISTE PAS : iOS ne l'expose pas du tout dans Safari. Rien à
// contourner — la fonction ne fait alors rien, et aucun parcours n'en dépend.
// C'est la règle du projet : une capacité absente dégrade en silence.
//
// SOBRIÉTÉ. Un téléphone qui vibre à chaque image de rotation devient
// insupportable en trois secondes et vide la batterie. D'où l'intervalle
// minimum entre deux retours, qui est la partie la plus importante du fichier.

const SUPPORTE = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

// Sous cet intervalle, on ne rejoue pas : la rotation d'un objet émet des
// dizaines d'évènements par seconde, et sans ce garde-fou le téléphone
// vibrerait en continu.
const INTERVALLE_MIN_MS = 110
let dernier = 0

// Un motif par famille de matière. Les valeurs ne sont pas des mesures : elles
// ont été choisies pour que deux matières voisines restent distinguables au
// doigt, ce qui compte davantage qu'une exactitude physique impossible ici.
const MOTIFS = {
  // Grain régulier, chaleureux : de courtes impulsions espacées.
  bois:      [8, 26, 8, 26, 8],
  // Rugueux et mat : plus serré, plus long, sans netteté.
  terre:     [14, 18, 14, 18, 14, 18],
  // Le plus caractéristique : une nuée d'impulsions minuscules.
  perle:     [4, 12, 4, 12, 4, 12, 4, 12, 4],
  // Net, franc, résonant : une frappe unique et sèche.
  metal:     [22],
  // Souple, étouffé : une montée douce, sans attaque.
  textile:   [6, 40, 12],
  // Dense et lisse : une impulsion pleine, sans grain.
  ivoire:    [16],
  // Tressage : alternance régulière, marquée.
  vannerie:  [10, 22, 10, 22, 10, 22],
  // Dur et froid : deux frappes rapprochées.
  pierre:    [20, 14, 20],
  // Creux, léger : impulsion brève suivie d'une résonance faible.
  calebasse: [10, 30, 5],
  // Souple et épais : lent, arrondi.
  cuir:      [12, 34, 12]
}

// Gestes de l'interface, indépendants de la matière.
const GESTES = {
  toucher:   [10],          // on a touché la pièce
  poser:     [18, 60, 30],  // l'objet vient de s'ancrer en RA — l'évènement du parcours
  succes:    [12, 45, 12],  // énigme résolue, badge obtenu
  erreur:    [30, 50, 30],  // mauvaise réponse
  limite:    [6]            // butée de zoom atteinte
}

function jouer(motif, forcer = false) {
  if (!SUPPORTE || !motif) return false
  // Respect de la préférence système : quelqu'un qui a demandé moins
  // d'animations n'a pas demandé qu'on lui secoue le téléphone.
  if (typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false

  const t = Date.now()
  if (!forcer && t - dernier < INTERVALLE_MIN_MS) return false
  dernier = t
  try { navigator.vibrate(motif); return true } catch { return false }
}

/**
 * Vibration correspondant à la MATIÈRE de la pièce. Appelée pendant la
 * manipulation : elle est bridée par l'intervalle minimum, on peut donc
 * l'accrocher sans crainte à un évènement fréquent.
 */
export function matiere(nom) {
  return jouer(MOTIFS[nom] || MOTIFS.bois)
}

/**
 * Vibration d'un GESTE d'interface. `forcer` contourne l'intervalle minimum :
 * un ancrage réussi en RA doit se sentir même si l'on vient de vibrer.
 */
export function geste(nom, forcer = true) {
  return jouer(GESTES[nom], forcer)
}

/** Coupe net une vibration en cours (fermeture d'une vue, par exemple). */
export function stopper() {
  if (SUPPORTE) { try { navigator.vibrate(0) } catch { /* sans effet */ } }
}

export const matieresConnues = Object.keys(MOTIFS)
export const haptiqueSupportee = SUPPORTE
