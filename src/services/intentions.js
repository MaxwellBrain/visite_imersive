// CE QUE LE VISITEUR VEUT, quand ce n'est pas une question.
//
// L'avatar vocal traitait toute parole comme une question à poser au modèle.
// C'est faux dans deux cas, et ce sont justement les deux qui donnent
// l'impression d'un guide qui COMPREND plutôt que d'un guide qui répond :
//
//   « Guide, montre-moi le trésor du roi »  → une NAVIGATION, pas une question.
//     Y répondre par un paragraphe est un contresens : la personne veut voir.
//
//   un mot secret prononcé                   → une RÉVÉLATION préparée.
//
// POURQUOI CE N'EST PAS DU RESSORT DU MODÈLE. On pourrait lui demander de
// classer l'intention. Ce serait payer une inférence et une seconde d'attente
// pour distinguer « montre-moi » de « raconte-moi » — que trois expressions
// régulières séparent sans se tromper. Le modèle sert à parler, pas à trier.

// « montre-moi », « emmène-moi », « je veux voir », « où est »…
// On EXIGE un verbe de monstration : sans lui, « le trésor du roi est-il
// ancien ? » partirait en navigation alors que c'est une vraie question.
const MONTRER = /\b(montre|montrez|montrer|fais\s+voir|emm[eè]ne|emmenez|conduis|am[eè]ne|je\s+veux\s+voir|j'aimerais\s+voir|peux-tu\s+me\s+montrer|o[uù]\s+(est|se\s+trouve)|show\s+me|take\s+me|i\s+want\s+to\s+see|where\s+is)\b/i

// NETTOYAGE DE LA CIBLE — en quatre passes, et l'ordre compte.
//
// Deux pièges m'ont eu à la première écriture, et ils sont assez communs pour
// mériter d'être nommés :
//
//  1. LE TRAIT D'UNION. « montre-moi le trésor » : `\b` après « montre » tombe
//     AVANT le tiret, si bien que la cible commençait par « -moi ». Le pronom
//     doit donc être retiré séparément, en acceptant tiret comme espace.
//  2. L'ORDRE DES ALTERNATIVES. `(le|la|les|…)` teste « le » d'abord : sur
//     « les masques », il consomme « le » et laisse « s masques ». Les formes
//     LONGUES passent toujours en premier.
const PRONOM = /^[\s,'-]*(?:moi|nous|me|us)?[\s,'-]*/i
const PREPOSITION = /^(?:jusqu'[àa]|vers|dans|[àa]u[xs]?|[àa]|to\s+the|to|at)\s+/i
const DETERMINANT = /^(?:les|le\s|la\s|l'|un[e]?|des|du|de\s+la|de\s|the|an|a\s)\s*/i
const POLITESSE = /\b(s'il\s+te\s+pla[iî]t|s'il\s+vous\s+pla[iî]t|please|merci|guide|avatar)\b/gi

// « montre-moi ça » ne désigne rien qu'on puisse chercher. Mieux vaut alors
// laisser la phrase repartir en question ordinaire : le modèle, lui, a le fil
// de la conversation et saura à quoi « ça » renvoie.
const VAGUE = /^(?:[cç]a|cela|ceci|ce|celui[- ]ci|celle[- ]ci|it|that|this|one)$/i

function normaliser(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Le visiteur demande-t-il à VOIR quelque chose ? Renvoie la cible nettoyée,
 * ou `null` si ce n'est pas une demande de monstration.
 *
 * On renvoie la CIBLE et non un identifiant : ce service ne connaît pas le
 * catalogue, et n'a pas à le connaître. C'est `guideAgent.ask()` qui sait
 * résoudre un nom d'œuvre en lien — il le fait déjà pour le chat.
 */
export function intentionMontrer(phrase) {
  const t = String(phrase || '')
  const m = MONTRER.exec(t)
  if (!m) return null
  let cible = t.slice(m.index + m[0].length).replace(POLITESSE, '')
  cible = cible.replace(PRONOM, '')            // « -moi », « nous »…
  cible = cible.replace(PREPOSITION, '')       // « à la calebasse » → « la calebasse »
  cible = cible.replace(DETERMINANT, '')       // « la calebasse »   → « calebasse »
  cible = cible.replace(/[?!.,;]+\s*$/, '').replace(/\s+/g, ' ').trim()

  if (cible.length < 3 || VAGUE.test(cible)) return null
  return cible
}

/**
 * Le mot secret de CETTE œuvre a-t-il été prononcé ?
 *
 * Comparaison sans accents ni casse, sur le mot entier — « leopard » ne doit
 * pas se déclencher sur « leopards » par hasard, mais « le léopard » doit
 * marcher. On teste donc l'inclusion du mot normalisé entouré de frontières.
 */
export function secretPrononce(phrase, mot) {
  const m = normaliser(mot)
  if (!m || m.length < 3) return false
  const t = normaliser(phrase)
  if (!t) return false
  // Frontières « souples » : début/fin de chaîne ou caractère non alphabétique.
  const i = t.indexOf(m)
  if (i < 0) return false
  const avant = i === 0 ? ' ' : t[i - 1]
  const apres = i + m.length >= t.length ? ' ' : t[i + m.length]
  return !/[a-z0-9]/.test(avant) && !/[a-z0-9]/.test(apres)
}
