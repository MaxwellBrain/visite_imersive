// ============================================================================
// DÉDOUBLONNAGE EN DEUX ÉTAGES — le classique, puis la classification.
// ----------------------------------------------------------------------------
//
// ÉTAGE 1 — LA MÉTHODE CLASSIQUE, celle de Power Query.
//
//   « Supprimer les doublons » compare une CLÉ, à l'identique. « Fusionner les
//   requêtes » joint deux tables sur cette clé. C'est exact, instantané,
//   explicable — et c'est ce que fait déjà notre écriture : `upsert` sur le
//   numéro d'inventaire. Quand la clé est là, le problème est réglé.
//
//   SA LIMITE est structurelle, pas réglable : elle exige que la clé existe et
//   soit écrite pareil des deux côtés. Or dans un fonds réel :
//     · beaucoup d'œuvres n'ont pas de numéro d'inventaire ;
//     · deux fichiers d'un même musée numérotent différemment ;
//     · le doublon vient d'une ressaisie, sans référence commune.
//
//   Power Query répond à ça par la « fusion approximative » : une similarité de
//   Jaccard, un seuil unique à 0,80. Mieux que rien, mais ça ne compare qu'UN
//   champ, et ça tranche par oui/non sans jamais dire « je ne sais pas ».
//
// ÉTAGE 2 — LA CLASSIFICATION, quand la clé manque.
//
//   Le modèle de Fellegi–Sunter, référence du couplage d'enregistrements. Au
//   lieu de comparer un champ, on compare TOUS les champs et on additionne des
//   POIDS. Chaque champ apporte une quantité d'information mesurée par deux
//   probabilités :
//
//     m = probabilité que le champ concorde SI les deux fiches sont la même œuvre
//     u = probabilité qu'il concorde PAR HASARD, entre deux œuvres différentes
//
//   Le poids d'un accord vaut log2(m/u), celui d'un désaccord log2((1−m)/(1−u)).
//   Un accord sur la matière ne prouve presque rien — dix matières, une chance
//   sur dix de coïncider. Un accord sur une notice de trois phrases est presque
//   une preuve. Le modèle donne mécaniquement à chacun son juste poids.
//
//   ET SURTOUT : DEUX SEUILS, DONC TROIS CLASSES. C'est ce qui manque à la
//   fusion approximative. Au-dessus du seuil haut, doublon certain ; en dessous
//   du seuil bas, pièces distinctes ; ENTRE LES DEUX, la zone que Fellegi et
//   Sunter appellent « clerical review » — l'examen humain. Cette zone n'est
//   pas un défaut du modèle, c'est sa raison d'être : elle reconnaît que
//   certains cas ne se tranchent pas sans regarder.
//
//   Chez nous, elle tombe exactement sur l'écran de revue de l'import.
//
// CE QU'ON NE FAIT PAS : fusionner tout seul. Le modèle CLASSE, il ne décide
// pas. Fusionner deux œuvres réellement distinctes est irréversible ; laisser
// un doublon se corrige en deux clics.
// ============================================================================

import { base, distance } from './rapprochement'

// ---------------------------------------------------------- comparateurs --

/** Similarité de Jaccard sur les mots — celle qu'emploie Power Query. */
export function jaccard(a, b) {
  const A = new Set(base(a).split(/\s+/).filter(Boolean))
  const B = new Set(base(b).split(/\s+/).filter(Boolean))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

/** Similarité par distance d'édition, ramenée entre 0 et 1. Bon sur les noms courts. */
export function similariteEdition(a, b) {
  const s = base(a)
  const t = base(b)
  if (!s || !t) return 0
  const max = Math.max(s.length, t.length)
  return 1 - distance(s, t) / max
}

// ------------------------------------------------------------- le modèle --
//
// LES POIDS SONT DES A PRIORI, PAS UN APPRENTISSAGE. Estimer m et u
// correctement demanderait un corpus de paires étiquetées « même œuvre / œuvres
// différentes » que nous n'avons pas. Ceux-ci viennent du bon sens du domaine,
// et c'est assumé : ils suffisent à séparer les cas nets et à faire remonter
// les cas douteux à l'humain, qui est de toute façon le juge.
//
//   `seuil` : à partir de quelle similarité on considère qu'il y a accord.
const CHAMPS = [
  // Une même référence est quasiment une preuve ; deux œuvres différentes ne
  // la partagent jamais.
  { cle: 'reference', libelle: 'N° inventaire', m: 0.99, u: 0.000001, seuil: 1, comparer: (a, b) => (base(a) === base(b) ? 1 : 0) },
  { cle: 'nom', libelle: 'Nom', m: 0.92, u: 0.004, seuil: 0.85, comparer: similariteEdition },
  // La salle pèse peu : dans une même salle, tout le monde concorde.
  { cle: 'salle', libelle: 'Salle', m: 0.85, u: 0.18, seuil: 0.9, comparer: similariteEdition },
  { cle: 'matiere', libelle: 'Matière', m: 0.93, u: 0.14, seuil: 1, comparer: (a, b) => (base(a) === base(b) ? 1 : 0) },
  // Une notice longue qui concorde est presque décisive.
  { cle: 'description', libelle: 'Notice', m: 0.80, u: 0.0015, seuil: 0.6, comparer: jaccard }
]

const log2 = (x) => Math.log(x) / Math.LN2

// Seuils en BITS de preuve. 8 bits ≈ 256 fois plus probable qu'un hasard :
// au-delà, on n'hésite plus. En dessous de 2, l'accord constaté s'explique
// aussi bien par la coïncidence.
export const SEUIL_HAUT = 8
export const SEUIL_BAS = 2

/**
 * Compare deux fiches et rend un verdict motivé.
 * @returns {{score, classe, details}} classe ∈ doublon | a_revoir | distinct
 */
export function comparerFiches(a, b) {
  let score = 0
  const details = []
  for (const c of CHAMPS) {
    const va = a?.[c.cle]
    const vb = b?.[c.cle]
    // Champ absent d'un côté : il n'apporte NI preuve NI contre-preuve. Le
    // compter comme un désaccord pénaliserait les fiches incomplètes, qui sont
    // la majorité dans un inventaire en cours.
    if (!base(va) || !base(vb)) { details.push({ champ: c.libelle, etat: 'absent', poids: 0 }); continue }
    const sim = c.comparer(va, vb)
    const accord = sim >= c.seuil
    const poids = accord ? log2(c.m / c.u) : log2((1 - c.m) / (1 - c.u))
    score += poids
    details.push({ champ: c.libelle, etat: accord ? 'accord' : 'desaccord', similarite: Math.round(sim * 100) / 100, poids: Math.round(poids * 10) / 10 })
  }
  const classe = score >= SEUIL_HAUT ? 'doublon' : score >= SEUIL_BAS ? 'a_revoir' : 'distinct'
  return { score: Math.round(score * 10) / 10, classe, details }
}

/**
 * Cherche les doublons dans un ensemble de fiches.
 *
 * BLOCAGE : on ne compare pas tout avec tout — ce serait quadratique et inutile.
 * Deux œuvres candidates partagent au moins un mot significatif de leur nom.
 * C'est le même compromis que la méthode classique de Power Query, appliqué en
 * amont du modèle plutôt qu'à sa place.
 *
 * @param {Array} fiches objets portant reference/nom/salle/matiere/description
 * @returns {Array<{a, b, score, classe, details}>} paires suspectes, les plus
 *   sûres d'abord. Rien n'est fusionné : ce sont des propositions.
 */
export function chercherDoublons(fiches, { max = 200 } = {}) {
  const parMot = new Map()
  fiches.forEach((f, i) => {
    for (const mot of new Set(base(f.nom).split(/\s+/).filter((w) => w.length >= 4))) {
      if (!parMot.has(mot)) parMot.set(mot, [])
      parMot.get(mot).push(i)
    }
  })

  const vues = new Set()
  const paires = []
  for (const indices of parMot.values()) {
    if (indices.length > 60) continue          // mot trop commun : il ne bloque rien
    for (let x = 0; x < indices.length; x++) {
      for (let y = x + 1; y < indices.length; y++) {
        const i = indices[x]
        const j = indices[y]
        const k = `${i}:${j}`
        if (vues.has(k)) continue
        vues.add(k)
        const r = comparerFiches(fiches[i], fiches[j])
        if (r.classe !== 'distinct') paires.push({ a: fiches[i], b: fiches[j], ...r })
      }
    }
  }
  return paires.sort((p, q) => q.score - p.score).slice(0, max)
}
