// De quoi parlent les questions restées sans réponse ?
//
// POURQUOI CE FICHIER EXISTE
//
// « 6 questions sans réponse sur le Trône perlé » ne dit pas au conservateur
// QUOI écrire. « 4 personnes ont demandé en quoi il est fait » le lui dit.
// C'est toute la différence entre une statistique et un conseil.
//
// POURQUOI PAS UN LLM ICI
//
// La tentation serait d'envoyer les questions à Groq pour qu'il les classe.
// On s'en passe, et ce n'est pas de la paresse :
//  · le classement doit s'afficher instantanément, à l'ouverture de l'écran ;
//  · il doit fonctionner quand la clé API est absente — c'est le cas courant
//    sur ce projet (cf. MUSEA_MASTER_PLAN, tableau des secrets) ;
//  · il porte sur huit catégories fermées, connues d'avance. Un modèle de
//    langage n'apporte rien à une tâche que trente mots-clés résolvent, et il
//    apporterait une latence, un coût et une dépendance réseau.
//
// Le prix à payer est assumé : une question formulée de façon inattendue tombe
// dans « autre ». Mieux vaut ne rien conclure que conclure de travers — un
// mauvais conseil ferait écrire au conservateur une information dont personne
// n'a besoin.

// Chaque thème porte les formes RÉELLEMENT employées par les visiteurs, en
// français comme en anglais (le site est bilingue). Les accents sont retirés
// avant comparaison : « matière » et « matiere » doivent tomber au même endroit.
const THEMES = [
  {
    cle: 'matiere',
    mots: [
      'matiere', 'materiau', 'materiel', 'fabrique', 'fabrication', 'compose', 'faite avec',
      'fait avec', 'quoi est-il fait', 'quoi est fait', 'quoi c est fait', 'en quoi',
      'bois', 'bronze', 'laiton', 'cuivre', 'ivoire', 'perle', 'raphia', 'terre cuite',
      'tissu', 'cauris', 'made of', 'material', 'what is it made'
    ]
  },
  {
    cle: 'datation',
    // « age de » est volontairement absent : c'est un sous-mot de « image de ».
    mots: [
      'quand', 'quelle epoque', 'quelle annee', 'siecle', 'datation', 'date de',
      'remonte', 'ancien', 'anciennete', 'quel age', 'when', 'how old', 'century'
    ]
  },
  {
    cle: 'origine',
    // Pas de « origin » seul : c'est un sous-mot d'« original », qui relève de
    // la conservation (vrai/copie) et non de la provenance.
    mots: [
      'd ou vient', 'ou vient', 'provenance', 'origine', 'quelle region', 'quel village',
      'quelle chefferie', 'quel peuple', 'ethnie', 'trouve ou', 'recolte',
      'where does it come', 'where is it from', 'come from', 'comes from'
    ]
  },
  {
    cle: 'usage',
    // Pas de « rite » seul : sous-mot de « merite ». « rituel » suffit.
    mots: [
      'a quoi sert', 'ca sert', 'servait', 'utilise', 'utilisait', 'utilisation', 'usage',
      'fonction', 'pourquoi on', 'ceremonie', 'rituel', 'culte', 'danse',
      'porte par', 'what is it used', 'used for', 'purpose'
    ]
  },
  {
    cle: 'auteur',
    mots: [
      'qui a fait', 'qui l a fait', 'qui a fabrique', 'qui a sculpte', 'artisan',
      'sculpteur', 'forgeron', 'auteur', 'artiste', 'atelier', 'who made', 'craftsman', 'artist'
    ]
  },
  {
    cle: 'dimensions',
    // « mesure » plutôt que « combien mesure » : on dit aussi « combien IL mesure ».
    mots: [
      'taille', 'hauteur', 'largeur', 'longueur', 'mesure', 'quelle dimension',
      'dimensions', 'poids', 'combien pese', 'lourd', 'how big', 'how tall', 'weight', 'size'
    ]
  },
  {
    cle: 'valeur',
    // Pas de « cher » seul : sous-mot de « chercher » et « recherche ».
    mots: [
      'prix', 'combien coute', 'combien ca coute', 'valeur', 'ca vaut', 'trop cher',
      'c est cher', 'estimation', 'a vendre', 'acheter', 'price', 'how much', 'worth', 'value'
    ]
  },
  {
    cle: 'conservation',
    // Pas de « etat » seul : trop court, il apparaît dans d'autres mots.
    mots: [
      'restaure', 'restauration', 'abime', 'casse', 'conserve', 'conservation',
      'quel etat', 'bon etat', 'mauvais etat', 'copie', 'replique', 'authentique',
      'vrai ou faux', 'original', 'replica', 'restored'
    ]
  },
  {
    cle: 'visite',
    mots: [
      'horaire', 'ouvert', 'ouverture', 'fermeture', 'quel jour', 'billet', 'tarif',
      'entree', 'reservation', 'adresse', 'comment venir', 'ou se trouve le musee',
      'parking', 'opening hours', 'ticket', 'how to get'
    ]
  }
]

function normaliser(texte) {
  return String(texte || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Une question peut relever de deux thèmes à la fois (« c'est vieux et c'est en
// quoi ? »). On les renvoie tous : forcer un thème unique perdrait de l'information.
export function themesDeLaQuestion(question) {
  const q = normaliser(question)
  if (!q) return []
  const trouves = THEMES.filter((t) => t.mots.some((m) => q.includes(m))).map((t) => t.cle)
  return trouves.length ? trouves : ['autre']
}

/**
 * Agrège une liste de questions en thèmes, du plus demandé au moins demandé.
 * Renvoie [{ cle, n, recurrent }] — `recurrent` à partir de deux occurrences,
 * seuil à partir duquel il ne s'agit plus d'une curiosité isolée.
 *
 * « autre » est écarté du résultat : on ne peut donner aucun conseil dessus, et
 * l'afficher ne ferait qu'occuper la place des thèmes actionnables.
 */
export function themesFrequents(questions) {
  const compte = new Map()
  for (const q of questions || []) {
    for (const cle of themesDeLaQuestion(typeof q === 'string' ? q : q?.question)) {
      if (cle === 'autre') continue
      compte.set(cle, (compte.get(cle) || 0) + 1)
    }
  }
  return [...compte.entries()]
    .map(([cle, n]) => ({ cle, n, recurrent: n >= 2 }))
    .sort((a, b) => b.n - a.n || a.cle.localeCompare(b.cle))
}
