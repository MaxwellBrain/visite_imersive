// ============================================================================
// LE FONDS PAR CLASSEUR — un fichier, et le musée existe.
// ----------------------------------------------------------------------------
// LE PROBLÈME QUE ÇA RÉSOUT. Une fondation qui arrive sur MUSÉA part de rien :
// pas de musée, pas de salles, pas d'œuvres. Lui demander de créer tout cela
// écran par écran, en ligne, avant même de pouvoir saisir sa première pièce,
// c'est lui demander d'abandonner. Elle a déjà son inventaire — dans un tableau.
//
// On lui envoie donc UN fichier, elle le remplit hors ligne, et l'import crée
// l'ensemble : les musées, leurs salles, puis les œuvres qui s'y rangent.
//
// L'IMPORT SE FAIT EN CASCADE, dans cet ordre et pas un autre :
//
//   1. les MUSÉES manquants — la base rend leurs identifiants ;
//   2. les SALLES, dont la colonne « Musée » est un NOM, converti à ce moment ;
//   3. les ŒUVRES, dont le couple « Musée › Salle » est converti de même.
//
// Chaque étape a besoin des identifiants créés par la précédente : un musée
// écrit dans le même fichier que ses salles n'existe pas encore quand on lit la
// ligne de la salle. D'où les passes successives plutôt qu'une insertion unique.
//
// CE QUI N'EST JAMAIS DANS LE TABLEAU : les photos et les modèles 3D. Ils se
// déposent depuis l'ERP, fichier par fichier, une fois la structure en place.
// Une colonne « photo » n'aurait pu contenir qu'une adresse web, que le musée
// n'a pas — et c'est précisément ce que vous configurez « plus tard ».
//
// CE QUI EXISTE DÉJÀ N'EST PAS RECRÉÉ. Un musée ou une salle dont le nom
// correspond à un existant est réutilisé, pas dupliqué : le même fichier peut
// donc être renvoyé enrichi sans repartir de zéro.
// ============================================================================

import { construireClasseur, lireClasseur, lireCsv, construireCsv, estCsv } from './xlsx'
import { MUSEUM_TYPES, SECTOR_LOCATIONS } from '@/constants/options'
import { indexRapprochement, rapprocher } from './rapprochement'
import { chercherDoublons } from './classification'

export const MATIERES = ['bois', 'terre', 'perle', 'metal', 'textile', 'ivoire', 'vannerie', 'pierre', 'calebasse', 'cuir']
export const TONS = ['conteur', 'solennel', 'mysterieux', 'savant', 'joyeux']

// --------------------------------------------------------------- colonnes --

// LES ALIAS : LIRE AUSSI LES FICHIERS QUE NOUS N'AVONS PAS ÉCRITS.
//
// Un musée n'envoie pas toujours notre modèle. Il envoie SON inventaire, avec
// ses propres en-têtes : « Désignation » plutôt que « Nom de l'œuvre »,
// « Notice » plutôt que « Histoire », « Matériau » plutôt que « Matière ». Une
// reconnaissance par titre exact ne trouvait rien dans ces fichiers et
// répondait « en-têtes introuvables » — c'est-à-dire : recommencez tout.
//
// Chaque colonne accepte donc plusieurs noms. Ce qui n'est reconnu par AUCUN
// n'est pas deviné : la colonne est déclarée absente, le champ reste vide, et
// le conservateur le remplira dans l'ERP. Mieux vaut un champ vide qu'un champ
// faux — une notice logée dans la colonne « matière » est plus difficile à
// rattraper qu'une notice manquante.

export const COL_MUSEES = [
  { cle: 'nom', titre: 'Nom du musée *', largeur: 30, aide: 'Obligatoire. S’il existe déjà, il est réutilisé et non recréé.',
    alias: ['nom', 'musee', 'nom du musee', 'etablissement', 'institution', 'name', 'museum', 'intitule', 'designation', 'appellation'] },
  { cle: 'type', titre: 'Type', largeur: 20, aide: `Une valeur parmi : ${MUSEUM_TYPES.join(', ')}.`,
    alias: ['type', 'categorie', 'category', 'nature', 'genre'] },
  { cle: 'anneeFondation', titre: 'Année de fondation', largeur: 18, aide: 'En chiffres. Ex. 1903.',
    alias: ['annee de fondation', 'fondation', 'annee', 'date de creation', 'creation', 'founded', 'year'] },
  { cle: 'description', titre: 'Description', largeur: 60, aide: 'Quelques lignes de présentation.',
    alias: ['description', 'presentation', 'resume', 'summary', 'desc'] },
  { cle: 'histoire', titre: 'Histoire', largeur: 70, aide: 'Le récit long, affiché sur la page du musée.',
    alias: ['histoire', 'historique', 'history', 'recit'] },
  { cle: 'publier', titre: 'Publier (oui/non)', largeur: 16, aide: 'oui = visible sur le site. Vide ou non = brouillon.',
    alias: ['publier', 'publie', 'published', 'statut', 'visible', 'en ligne'] }
]

export const COL_SALLES = [
  { cle: 'musee', titre: 'Musée *', largeur: 28, aide: 'Le NOM du musée, tel qu’écrit dans l’onglet « Musées » ou déjà en base.',
    alias: ['musee', 'museum', 'etablissement', 'institution', 'batiment'] },
  { cle: 'nom', titre: 'Nom de la salle *', largeur: 28, aide: 'Obligatoire. Réutilisée si elle existe déjà dans ce musée.',
    alias: ['nom', 'salle', 'nom de la salle', 'room', 'espace', 'secteur', 'section', 'galerie', 'aile'] },
  { cle: 'emplacement', titre: 'Emplacement', largeur: 16, aide: `${SECTOR_LOCATIONS.join(' ou ')}. Vide = Intérieur.`,
    alias: ['emplacement', 'localisation', 'situation', 'location', 'interieur exterieur'] },
  { cle: 'etage', titre: 'Étage', largeur: 10, aide: 'En chiffres. 0 pour le rez-de-chaussée.',
    alias: ['etage', 'niveau', 'floor', 'level'] },
  { cle: 'description', titre: 'Description', largeur: 55, aide: 'Ce que la salle présente.',
    alias: ['description', 'presentation', 'desc', 'resume'] },
  { cle: 'histoire', titre: 'Histoire de la salle', largeur: 70, aide: 'Le récit qui distingue une salle d’une simple liste.',
    alias: ['histoire', 'histoire de la salle', 'historique', 'recit', 'history'] },
  { cle: 'publier', titre: 'Publier (oui/non)', largeur: 16, aide: 'oui = visible sur le site.',
    alias: ['publier', 'publie', 'published', 'statut', 'visible', 'en ligne'] }
]

export const COL_OBJETS = [
  // LA RÉFÉRENCE EN PREMIER : c'est la clé métier de l'import. Une œuvre déjà
  // présente sous ce numéro est MISE À JOUR, pas recréée. Sans elle, redéposer
  // un inventaire corrigé duplique toute la collection.
  { cle: 'reference', titre: 'N° inventaire', largeur: 18, aide: 'Le numéro d’inventaire du musée. Facultatif, mais c’est LUI qui permet de redéposer un fichier corrigé sans créer de doublons.',
    alias: ['n inventaire', 'no inventaire', 'numero d inventaire', 'numero inventaire', 'inventaire', 'reference', 'ref', 'cote', 'inv', 'id'] },
  { cle: 'musee', titre: 'Musée *', largeur: 26, aide: 'Le NOM du musée.',
    alias: ['musee', 'museum', 'etablissement', 'institution', 'collection'] },
  { cle: 'salle', titre: 'Salle *', largeur: 24, aide: 'Le NOM de la salle, dans ce musée.',
    alias: ['salle', 'room', 'secteur', 'section', 'galerie', 'emplacement', 'localisation', 'aile'] },
  { cle: 'nom', titre: 'Nom de l’œuvre *', largeur: 32, aide: 'Le nom d’inventaire. Obligatoire.',
    alias: ['nom', 'nom de l oeuvre', 'oeuvre', 'objet', 'titre', 'title', 'name', 'designation', 'denomination', 'intitule', 'piece', 'artefact'] },
  { cle: 'nomCommun', titre: 'Nom courant', largeur: 24, aide: 'Le nom que le public emploie, s’il diffère.',
    alias: ['nom courant', 'nom commun', 'nom vernaculaire', 'autre nom', 'appellation courante', 'common name'] },
  { cle: 'description', titre: 'Histoire de l’œuvre', largeur: 70, aide: 'Le récit. C’est lui que le guide vocal lira.',
    alias: ['histoire de l oeuvre', 'description', 'histoire', 'notice', 'recit', 'texte', 'commentaire', 'presentation', 'notes', 'story'] },
  { cle: 'matiere', titre: 'Matière', largeur: 14, aide: `Une valeur parmi : ${MATIERES.join(', ')}.`,
    alias: ['matiere', 'materiau', 'materiaux', 'material', 'composition', 'support'] },
  { cle: 'tonNarratif', titre: 'Ton du récit', largeur: 15, aide: `Une valeur parmi : ${TONS.join(', ')}. Vide = conteur.`,
    alias: ['ton du recit', 'ton', 'tonalite', 'style'] },
  { cle: 'secretMot', titre: 'Mot secret', largeur: 18, aide: 'Pour les quêtes : le mot à découvrir. Facultatif.',
    alias: ['mot secret', 'secret', 'mot cle'] },
  { cle: 'secretRecit', titre: 'Récit du secret', largeur: 50, aide: 'Ce que le visiteur apprend une fois le mot trouvé.',
    alias: ['recit du secret', 'histoire secrete', 'revelation'] },
  { cle: 'secretIndice', titre: 'Indice', largeur: 30, aide: 'L’indice qui met sur la piste.',
    alias: ['indice', 'enigme', 'hint'] },
  { cle: 'publier', titre: 'Publier (oui/non)', largeur: 16, aide: 'oui = visible sur le site.',
    alias: ['publier', 'publie', 'published', 'statut', 'visible', 'en ligne'] }
]

const TABLES = [
  { id: 'musees', onglet: 'Musees', colonnes: COL_MUSEES },
  { id: 'salles', onglet: 'Salles', colonnes: COL_SALLES },
  { id: 'objets', onglet: 'Objets', colonnes: COL_OBJETS }
]

// ------------------------------------------------------------------ outils --

const OUI = new Set(['oui', 'o', 'yes', 'y', 'true', 'vrai', '1', 'x'])
const norm = (s) => String(s ?? '').trim()
// Casse et accents varient d'une saisie à l'autre : refuser « tresor » pour
// « Trésor » ferait échouer un import pour rien.
const cle = (s) => norm(s).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')

function entier(v) {
  const s = norm(v).replace(/\s/g, '')
  return /^-?\d+$/.test(s) ? Number(s) : null
}

// NORMALISER LA MATIÈRE PLUTÔT QUE DE LA REFUSER.
//
// Un musée n'écrit pas « bois ». Il écrit « Bois, pigments », « Laiton (fonte à
// la cire perdue) », « Perles de verre, coton, fibres végétales » — parce que
// c'est ainsi qu'on rédige un constat de matériaux. Refuser ces lignes parce
// qu'elles ne tiennent pas dans notre vocabulaire de dix mots, c'est refuser
// l'inventaire entier.
//
// On cherche donc le premier matériau reconnu DANS le texte. Le premier, car
// une notice de musée cite le matériau dominant en tête : « Bois, pigments »
// est un objet en bois, pas un objet en pigment.
const SYNONYMES = [
  ['perle', ['perle', 'perlage', 'rocaille']],
  ['metal', ['laiton', 'bronze', 'cuivre', 'fer', 'fonte', 'metal', 'métal', 'alliage', 'aluminium', 'argent']],
  ['terre', ['terre cuite', 'terre crue', 'terre', 'argile', 'ceramique', 'céramique', 'poterie', 'banco', 'adobe']],
  ['ivoire', ['ivoire', 'corne', 'defense', 'défense']],
  ['textile', ['textile', 'coton', 'tissu', 'etoffe', 'étoffe', 'raphia', 'fibre', 'laine', 'toile', 'indigo', 'ecorce', 'écorce']],
  ['vannerie', ['vannerie', 'tresse', 'tressage', 'osier', 'rotin', 'paille', 'panier', 'natte']],
  ['calebasse', ['calebasse', 'gourde', 'courge']],
  ['cuir', ['cuir', 'peau', 'parchemin']],
  ['pierre', ['pierre', 'basalte', 'granit', 'steatite', 'stéatite', 'roche']],
  ['bois', ['bois', 'ebene', 'ébène', 'iroko', 'acajou', 'monoxyle']]
]

function normaliserMatiere(brut) {
  const t = cle(brut)
  if (!t) return { valeur: null, ok: true }
  if (MATIERES.includes(t)) return { valeur: t, ok: true }

  // Position du premier synonyme rencontré : c'est le matériau dominant.
  let meilleur = null
  let position = Infinity
  for (const [canon, mots] of SYNONYMES) {
    for (const m of mots) {
      const i = t.indexOf(cle(m))
      if (i >= 0 && i < position) { position = i; meilleur = canon }
    }
  }
  return meilleur ? { valeur: meilleur, ok: true } : { valeur: null, ok: false }
}

// --------------------------------------------------------------- le modèle --

function lignesDe(colonnes, donnees = []) {
  return [colonnes.map((c) => c.titre), ...donnees]
}

/** Construit le classeur à envoyer, garni de ce qui existe déjà. */
export function modeleClasseur({ musees = [], salles = [], objets = [] } = {}) {
  const nomMusee = new Map(musees.map((m) => [m.id, m.nom]))
  const salleParId = new Map(salles.map((s) => [s.id, s]))

  const lMusees = musees.map((m) => [
    m.nom || '', m.type || '', m.anneeFondation ?? m.annee_fondation ?? '',
    m.description || '', m.histoire || '', m.published ? 'oui' : 'non'
  ])

  const lSalles = salles.map((s) => [
    nomMusee.get(s.museumId) || '', s.nom || '', s.emplacement || '',
    s.etage ?? '', s.description || '', s.histoire || '', s.published ? 'oui' : 'non'
  ])

  const lObjets = objets.map((o) => {
    const s = salleParId.get(o.sectorId)
    return [
      s ? nomMusee.get(s.museumId) || '' : '', s?.nom || '',
      o.nom || '', o.nomCommun || '', o.description || '',
      o.matiere || '', o.tonNarratif || '',
      o.secretMot || '', o.secretRecit || '', o.secretIndice || '',
      o.published ? 'oui' : 'non'
    ]
  })

  const aide = [
    ['Onglet', 'Colonne', 'À quoi elle sert'],
    ...TABLES.flatMap((t) => t.colonnes.map((c) => [t.onglet, c.titre, c.aide])),
    ['', '', ''],
    ['ORDRE', 'Musées, puis Salles, puis Objets', 'L’import crée dans cet ordre. Un musée écrit dans ce fichier peut donc être utilisé par une salle du même fichier.'],
    ['NOMS', 'On désigne par le NOM', 'Jamais par un numéro : vous n’avez pas à connaître les identifiants internes.'],
    ['EXISTANT', 'Rien n’est dupliqué', 'Un musée ou une salle portant un nom déjà connu est réutilisé, pas recréé.'],
    ['MÉDIAS', 'Photos et modèles 3D', 'Ne se mettent PAS ici. Ils se déposent depuis l’application, une fois la structure créée.'],
    ['EN-TÊTES', 'Ne pas renommer la 1re ligne', 'C’est elle qui identifie les colonnes.'],
    ['CSV', 'Un onglet à la fois', 'En CSV, envoyez un fichier par table : le format ne porte qu’une seule feuille.']
  ]

  return construireClasseur([
    { nom: 'Musees', lignes: lignesDe(COL_MUSEES, lMusees), largeurs: COL_MUSEES.map((c) => c.largeur) },
    { nom: 'Salles', lignes: lignesDe(COL_SALLES, lSalles), largeurs: COL_SALLES.map((c) => c.largeur) },
    { nom: 'Objets', lignes: lignesDe(COL_OBJETS, lObjets), largeurs: COL_OBJETS.map((c) => c.largeur) },
    { nom: 'Aide', lignes: aide, largeurs: [14, 26, 92] }
  ])
}

/**
 * LE CLASSEUR NETTOYÉ — le travail, rendu.
 *
 * L'analyse a rangé les colonnes, normalisé les matières, écarté ce qui ne
 * tenait pas. Ce résultat n'existait jusqu'ici que dans la mémoire du
 * navigateur : fermer la fenêtre, et tout était à refaire.
 *
 * On le rend donc sous la forme d'un classeur au format MUSÉA. Il sert à trois
 * choses, et c'est pour la troisième qu'il compte le plus :
 *   · vérifier le nettoyage hors ligne, à tête reposée ;
 *   · le corriger dans Excel et le redéposer — il sera reconnu au premier coup,
 *     puisqu'il porte désormais NOS en-têtes ;
 *   · le garder. Un musée qui refait son import dans six mois repart de la
 *     version propre, pas de l'export brut de son ancien logiciel.
 */
export function classeurNettoye(analyse) {
  const lMusees = (analyse.musees || []).map((m) => [
    m.row.nom, m.row.type || '', m.row.annee_fondation ?? '',
    m.row.description || '', m.row.histoire || '', m.row.published ? 'oui' : 'non'
  ])
  const lSalles = (analyse.salles || []).map((s) => [
    s.musee, s.row.nom, s.row.emplacement || '', s.row.etage ?? '',
    s.row.description || '', s.row.histoire || '', s.row.published ? 'oui' : 'non'
  ])
  const lObjets = (analyse.objets || []).map((o) => [
    o.row.reference || '', o.musee, o.salle, o.row.nom, o.row.nom_commun || '', o.row.description || '',
    o.row.matiere || '', o.row.ton_narratif || '', o.row.secret_mot || '',
    o.row.secret_recit || '', o.row.secret_indice || '', o.row.published ? 'oui' : 'non'
  ])

  // Le journal accompagne les données : sans lui, on ne saurait plus dans six
  // mois pourquoi « Laiton (fonte à la cire perdue) » est devenu « metal », ni
  // quelles lignes ont été écartées ni pourquoi.
  const journal = [['Sujet', 'Détail']]
  for (const f of analyse.fichiers || []) journal.push(['Fichier lu', f])
  for (const t of analyse.transformations || []) {
    journal.push([`${t.champ} — valeurs réécrites`, String(t.total)])
    for (const e of t.exemples) journal.push([`  ${e.de}`, `→ ${e.vers}`])
  }
  for (const a of analyse.absentes || []) journal.push([`${a.onglet} — colonnes absentes`, a.colonnes.join(', ')])
  for (const p of (analyse.problemes || []).slice(0, 100)) {
    journal.push([`Ligne écartée — ${p.onglet || ''} L${p.ligne}`, `${p.motif}${p.detail ? ' : ' + p.detail : ''}`])
  }

  return construireClasseur([
    { nom: 'Musees', lignes: lignesDe(COL_MUSEES, lMusees), largeurs: COL_MUSEES.map((c) => c.largeur) },
    { nom: 'Salles', lignes: lignesDe(COL_SALLES, lSalles), largeurs: COL_SALLES.map((c) => c.largeur) },
    { nom: 'Objets', lignes: lignesDe(COL_OBJETS, lObjets), largeurs: COL_OBJETS.map((c) => c.largeur) },
    { nom: 'Journal', lignes: journal, largeurs: [46, 60] }
  ])
}

/** Le même modèle, mais pour une seule table, en CSV. */
export function modeleCsv(tableId, donnees = []) {
  const t = TABLES.find((x) => x.id === tableId) || TABLES[2]
  return construireCsv(lignesDe(t.colonnes, donnees))
}

// ------------------------------------------------------------- la relecture --

// RECONNAISSANCE DES COLONNES, en trois passes de plus en plus tolérantes.
//
// L'ordre compte : on épuise d'abord les correspondances certaines, pour que
// les approximatives ne viennent pas voler une colonne à qui la méritait. Sans
// cela, un fichier portant « Nom » ET « Nom courant » pouvait voir « Nom
// courant » capturé par la recherche floue de « nom ».
//
//   1. le TITRE exact de notre modèle ;
//   2. un ALIAS exact — les noms qu'emploient réellement les inventaires ;
//   3. une correspondance PARTIELLE, et seulement si UN SEUL en-tête convient.
//      L'ambiguïté n'est jamais tranchée au hasard : deux candidats, on renonce.
//
// Une colonne qu'aucune passe ne trouve est déclarée ABSENTE. Son champ restera
// vide, et le conservateur le remplira à la main.
function indexer(entetes, colonnes, forcees = {}) {
  const e = (entetes || []).map(cle)
  const index = {}
  const pris = new Set()
  const absentes = []
  // Par quelle passe chaque champ a été rangé. C'est ce que montre l'écran de
  // nettoyage : une correspondance exacte se relit d'un œil, une correspondance
  // partielle ou proposée par le modèle mérite un second regard.
  const sources = {}

  const prendre = (c, i, source) => { index[c.cle] = i; pris.add(i); sources[c.cle] = source }
  const libre = (i) => i >= 0 && !pris.has(i)

  // 0. LES CORRECTIONS DE L'UTILISATEUR PASSENT AVANT TOUT.
  // Il a vu le plan proposé et l'a corrigé : aucune heuristique ne doit défaire
  // sa décision. `-1` veut dire « ce champ, je n'en veux pas ».
  const restantes = [...colonnes]
  for (const c of [...restantes]) {
    const f = forcees[c.cle]
    if (f === undefined) continue
    restantes.splice(restantes.indexOf(c), 1)
    if (f !== null && f >= 0 && f < e.length) prendre(c, f, 'manuel')
  }

  // 1. titre exact
  for (const c of [...restantes]) {
    const i = e.indexOf(cle(c.titre))
    if (libre(i)) { prendre(c, i, 'titre'); restantes.splice(restantes.indexOf(c), 1) }
  }

  // 2. alias exact
  for (const c of [...restantes]) {
    const noms = c.alias || []
    const i = e.findIndex((h, k) => libre(k) && noms.includes(h))
    if (libre(i)) { prendre(c, i, 'alias'); restantes.splice(restantes.indexOf(c), 1) }
  }

  // 3. correspondance partielle, sans ambiguïté
  for (const c of [...restantes]) {
    const noms = [cle(c.titre), ...(c.alias || [])]
    const candidats = []
    e.forEach((h, k) => {
      if (!libre(k) || !h) return
      // Deux sens : l'en-tête contient notre nom (« Description de l'objet »),
      // ou notre nom contient l'en-tête (« Notice » pour « Notice complète »).
      if (noms.some((n) => n.length >= 4 && (h.includes(n) || n.includes(h)))) candidats.push(k)
    })
    if (candidats.length === 1) { prendre(c, candidats[0], 'partiel'); restantes.splice(restantes.indexOf(c), 1) }
  }

  for (const c of restantes) absentes.push(c.titre)
  return { index, trouvees: Object.keys(index).length, absentes, sources }
}

// Quelle table ce tableau décrit-il ? En CSV il n'y a pas de nom d'onglet pour
// le dire : on prend celle dont les en-têtes correspondent le mieux.
function reconnaitre(entetes) {
  let meilleure = null
  let score = 0
  for (const t of TABLES) {
    const { trouvees } = indexer(entetes, t.colonnes)
    if (trouvees > score) { score = trouvees; meilleure = t }
  }
  // Deux colonnes reconnues au minimum : en dessous, c'est un fichier étranger,
  // et l'importer produirait des lignes vides plutôt qu'une erreur claire.
  return score >= 2 ? meilleure : null
}

// L'IA EN RENFORT, JAMAIS EN PREMIER.
//
// Les trois passes déterministes couvrent les fichiers ordinaires : instantané,
// gratuit, hors ligne, et reproductible. On n'appelle le modèle que sur ce qui
// RESTE — un inventaire aux colonnes vraiment inattendues — et on ne lui confie
// que le PLAN : quelle colonne va dans quel champ.
//
// Il ne touche à aucune valeur. Les vocabulaires contraints restent normalisés
// par `normaliserMatiere`, contre une liste fermée. Un modèle qui se trompe de
// colonne fait une erreur visible à l'aperçu ; un modèle autorisé à réécrire les
// valeurs écrirait des notices plausibles pour des pièces qu'il n'a jamais vues,
// et personne ne s'en apercevrait.
//
// Son échec n'est jamais bloquant : sans réponse, les colonnes restent absentes,
// exactement comme avant.
async function completerParIA(lignes, table, index, absentes) {
  const manquantes = table.colonnes.filter((c) => absentes.includes(c.titre))
  if (!manquantes.length) return { ajouts: {}, source: null }
  try {
    const { supabase } = await import('./supabase')
    const { data, error } = await supabase.functions.invoke('classeur-ia', {
      body: {
        entetes: lignes[0] || [],
        echantillon: lignes.slice(1, 4),
        prises: Object.values(index),
        cibles: manquantes.map((c) => ({ cle: c.cle, titre: c.titre, aide: c.aide }))
      }
    })
    if (error || !data?.champs) return { ajouts: {}, source: null }

    // GARDE-FOU : ON RELIT CE QUE LE MODÈLE PROPOSE.
    //
    // Mesuré : sur un inventaire dont la première colonne s'appelle « Ref »,
    // le modèle a rangé le CODE D'INVENTAIRE dans « nom » et le vrai nom dans
    // « nom courant ». Chaque œuvre se serait appelée « MCO.1962.001 » sur le
    // site public.
    //
    // Un code se reconnaît sans modèle : court, sans espace, fait de chiffres,
    // de points et de majuscules. On refuse donc qu'une telle colonne devienne
    // un libellé destiné à être lu. Le champ reste vide — visible et corrigeable
    // — plutôt que rempli d'une référence de gestion.
    const estUnCode = (v) => {
      const s = norm(v)
      if (!s || s.length > 24 || /\s/.test(s)) return false
      return /^[A-Z0-9][A-Z0-9._/-]*$/.test(s) && /\d/.test(s)
    }
    const LIBELLES = new Set(['nom', 'nomCommun', 'description', 'histoire'])
    const echantillon = lignes.slice(1, 6)
    const ajouts = {}
    for (const [k, i] of Object.entries(data.champs)) {
      if (LIBELLES.has(k)) {
        const vus = echantillon.map((l) => l?.[i]).filter((v) => norm(v))
        if (vus.length && vus.every(estUnCode)) continue   // c'est une référence, pas un libellé
      }
      ajouts[k] = i
    }

    // RÉPARATION. Quand le code d'inventaire a été écarté de « nom », le vrai
    // libellé se retrouve souvent rangé en « nom courant » — c'est exactement
    // l'erreur observée. Une œuvre DOIT avoir un nom, et un nom courant sans nom
    // est un nom : on le promeut plutôt que de rejeter toutes les lignes pour
    // « nom manquant ».
    if (ajouts.nom == null && index.nom == null && ajouts.nomCommun != null) {
      ajouts.nom = ajouts.nomCommun
      delete ajouts.nomCommun
    }
    return { ajouts, source: data.source || 'ia' }
  } catch {
    return { ajouts: {}, source: null }
  }
}

async function lireTable(lignes, table, ia = true, forcees = {}) {
  const { index, absentes, sources } = indexer(lignes[0], table.colonnes, forcees)
  let source = null
  if (ia && absentes.length) {
    const r = await completerParIA(lignes, table, index, absentes)
    for (const [k, i] of Object.entries(r.ajouts)) {
      const col = table.colonnes.find((c) => c.cle === k)
      if (col && index[k] == null) {
        index[k] = i
        sources[k] = 'ia'
        absentes.splice(absentes.indexOf(col.titre), 1)
        source = r.source
      }
    }
  }
  const out = []
  for (let i = 1; i < lignes.length; i++) {
    const l = lignes[i] || []
    if (!l.some((c) => norm(c))) continue          // ligne vide = reste de mise en forme
    // Une colonne absente et une cellule vide donnent la MÊME chose : rien.
    // Le champ ne sera pas écrit, et restera à remplir dans l'ERP.
    const val = (k) => (index[k] == null ? '' : norm(l[index[k]]))
    out.push({ ligne: i + 1, val, brut: l })
  }
  // LE PLAN : ce que l'écran de nettoyage donne à relire, champ par champ.
  const plan = table.colonnes.map((c) => ({
    cle: c.cle,
    champ: c.titre,
    index: index[c.cle] ?? null,
    colonne: index[c.cle] == null ? null : norm(lignes[0]?.[index[c.cle]]),
    origine: sources[c.cle] || null,
    // Un aperçu de ce qui atterrira dans ce champ : c'est ce qui permet de
    // repérer une colonne mal rangée sans ouvrir le fichier à côté.
    exemple: index[c.cle] == null ? '' : norm(lignes.slice(1).find((l) => norm(l?.[index[c.cle]]))?.[index[c.cle]] || '')
  }))

  return { entrees: out, index, absentes, source, plan, entetes: (lignes[0] || []).map(norm) }
}

// LIRE UN LOT, PAS UN FICHIER.
//
// Un musée n'envoie presque jamais un seul fichier. Il envoie l'export de son
// logiciel d'inventaire, plus un tableau des salles tenu à part, plus la liste
// des acquisitions de l'année — trois fichiers, trois structures, parfois trois
// formats. Les traiter un par un obligerait à respecter l'ordre à la main et
// ferait échouer le premier, qui référence des salles créées par le second.
//
// On lit donc TOUT, on reconnaît la table de chaque feuille de chaque fichier,
// puis on déroule la cascade UNE FOIS sur l'ensemble : tous les musées de tous
// les fichiers, puis toutes les salles, puis toutes les œuvres. L'ordre des
// fichiers déposés n'a plus d'importance.
async function lireSources(fichiers, avance = () => {}) {
  const sources = []
  for (let n = 0; n < fichiers.length; n++) {
    const f = fichiers[n]
    avance(f.name || `fichier ${n + 1}`, n)
    try {
      if (estCsv(f)) {
        const lignes = await lireCsv(f)
        const t = reconnaitre(lignes[0])
        if (t && lignes.length > 1) sources.push({ n, fichier: f.name || `fichier ${n + 1}`, onglet: t.onglet, table: t, lignes })
      } else {
        for (const feuille of await lireClasseur(f)) {
          const t = TABLES.find((x) => cle(x.onglet) === cle(feuille.nom)) || reconnaitre(feuille.lignes[0])
          if (t && feuille.lignes.length > 1) {
            sources.push({ n, fichier: f.name || `fichier ${n + 1}`, onglet: feuille.nom, table: t, lignes: feuille.lignes })
          }
        }
      }
    } catch (e) {
      sources.push({ n, fichier: f.name || `fichier ${n + 1}`, erreur: String(e?.message || e) })
    }
  }
  return sources
}

/** Compatibilité : un seul fichier reste un lot d'un élément. */
export function analyserClasseur(fichier, ctx = {}) {
  return analyserLot([fichier], ctx)
}

/**
 * Relit un LOT de fichiers (.xlsx et/ou .csv). N'écrit RIEN.
 * @returns {Promise<{musees, salles, objets, problemes, plans, transformations, total}>}
 */
export async function analyserLot(fichiers, {
  musees = [], salles = [], objets = [], ia = true, corrections = {}, onEtape = () => {}
} = {}) {
  // LA PROGRESSION EST SIGNALÉE, PAS DEVINÉE.
  //
  // Lire dix fichiers, interroger le modèle sur ceux qu'on ne reconnaît pas et
  // normaliser deux mille lignes prend plusieurs secondes. Sans retour, l'écran
  // paraît figé : le conservateur reclique, redépose, ou ferme la fenêtre au
  // milieu de l'analyse. On annonce donc chaque étape et le fichier en cours.
  const etape = (phase, detail = null, n = 0, sur = 0) => {
    try { onEtape({ phase, detail, n, sur }) } catch { /* l'affichage ne doit rien casser */ }
  }
  const problemes = []
  const tables = { musees: [], salles: [], objets: [] }
  // Ce que le fichier NE contenait PAS : montré dans l'aperçu, pour que le
  // conservateur sache quels champs il devra remplir lui-même dans l'ERP.
  const absentes = []
  // Onglets dont une colonne a été rangée par le modèle : un plan proposé par
  // une IA se relit avant d'être appliqué.
  const parIA = []
  // Les valeurs de matière réécrites : forme d'origine -> forme normalisée.
  const majMatieres = new Map()
  // Le plan de rangement par onglet, et les valeurs que le nettoyage a
  // transformées. Les deux nourrissent l'écran « Nettoyage et unification ».
  const plans = []
  const transformations = []

  // ---- lecture du lot ----
  etape('lecture', null, 0, fichiers.length)
  const sources = await lireSources(fichiers, (nom, i) => etape('lecture', nom, i + 1, fichiers.length))
  for (const s of sources.filter((x) => x.erreur)) {
    problemes.push({ ligne: 0, onglet: s.fichier, motif: 'fichier_illisible', detail: s.erreur })
  }
  const lisibles = sources.filter((s) => !s.erreur)
  if (!lisibles.length) {
    return { ...tables, problemes: problemes.length ? problemes : [{ ligne: 1, motif: 'entetes_introuvables' }],
      absentes: [], parIA: [], plans: [], transformations: [], doublons: [], fichiers: [], total: 0 }
  }

  let total = 0

  // Chaque source garde SA clé de correction : deux fichiers n'ont pas les mêmes
  // en-têtes, et un rangement corrigé sur l'un n'a aucun sens sur l'autre.
  const cleSource = (s) => `${s.n}:${s.table.id}`

  // Déroule une table sur TOUTES les sources qui la portent, et rend les
  // entrées à la suite. C'est ce qui rend l'ordre des fichiers indifférent.
  const parcourir = async (tableId, onglet, traiter) => {
    const concernees = lisibles.filter((x) => x.table.id === tableId)
    let k = 0
    for (const src of concernees) {
      etape('rangement', `${src.fichier} › ${onglet}`, ++k, concernees.length)
      const { entrees, absentes: abs, source: origine, plan, entetes } =
        await lireTable(src.lignes, src.table, ia, corrections[cleSource(src)] || {})
      if (origine) parIA.push(`${src.fichier} › ${onglet}`)
      plans.push({ cle: cleSource(src), fichier: src.fichier, onglet, table: tableId, plan, entetes })
      if (abs.length) absentes.push({ onglet: `${src.fichier} › ${onglet}`, colonnes: abs })
      for (const e of entrees) { total++; traiter(e, src) }
    }
  }

  // ---- MUSÉES ----
  await parcourir('musees', 'Musées', ({ ligne, val }) => {
    const nom = val('nom')
    if (!nom) { problemes.push({ ligne, onglet: 'Musées', motif: 'nom_manquant' }); return }
    tables.musees.push({
      ligne,
      nom,
      row: {
        nom,
        type: val('type') || null,
        annee_fondation: entier(val('anneeFondation')),
        description: val('description') || null,
        histoire: val('histoire') || null,
        published: OUI.has(cle(val('publier')))
      }
    })
  })

  // ANNUAIRE DES MUSÉES — indexé pour le rapprochement, pas seulement pour
  // l'égalité. Un inventaire qui écrit « Musee des Chefferies (Ouest) » doit
  // retrouver « Musée des Chefferies de l'Ouest », pas être rejeté.
  const nomsMusees = [
    ...musees.map((m) => ({ cle: cle(m.nom), valeur: m.nom })),
    ...tables.musees.map((m) => ({ cle: cle(m.nom), valeur: m.nom }))
  ]
  const idxMusees = indexRapprochement(nomsMusees)
  // Les rapprochements non exacts sont tracés : ils s'affichent à l'écran de
  // nettoyage, car ils reposent sur une ressemblance, pas sur une certitude.
  const rapprochements = []
  const resoudreMusee = (v) => {
    const r = rapprocher(v, idxMusees)
    if (!r) return null
    if (r.methode !== 'exact') rapprochements.push({ champ: 'Musée', de: v, vers: r.entree.valeur, methode: r.methode })
    return r.entree.cle
  }

  // ---- SALLES ----
  await parcourir('salles', 'Salles', ({ ligne, val }) => {
    const nom = val('nom')
    const musee = val('musee')
    if (!nom) { problemes.push({ ligne, onglet: 'Salles', motif: 'nom_manquant' }); return }
    const museeResolu = resoudreMusee(musee)
    if (!museeResolu) {
      problemes.push({ ligne, onglet: 'Salles', motif: 'musee_inconnu', detail: musee || '(vide)' }); return
    }
    const emp = norm(val('emplacement'))
    const empOk = SECTOR_LOCATIONS.find((e) => cle(e) === cle(emp))
    if (emp && !empOk) {
      problemes.push({ ligne, onglet: 'Salles', motif: 'emplacement_invalide', detail: emp }); return
    }
    tables.salles.push({
      ligne, musee: museeResolu, nom,
      row: {
        nom,
        emplacement: empOk || 'Intérieur',
        etage: entier(val('etage')),
        description: val('description') || null,
        histoire: val('histoire') || null,
        published: OUI.has(cle(val('publier')))
      }
    })
  })

  // Annuaire des salles, par couple musée+salle : deux musées peuvent avoir une
  // salle du même nom, et les confondre enverrait des œuvres ailleurs.
  const nomMusee = new Map(musees.map((m) => [m.id, m.nom]))
  // Un index PAR MUSÉE : deux musées peuvent avoir une salle du même nom, et
  // rapprocher à l'aveugle enverrait des œuvres dans le mauvais bâtiment.
  const sallesParMusee = new Map()
  const ajouterSalle = (nomM, nomS) => {
    const k = cle(nomM)
    if (!sallesParMusee.has(k)) sallesParMusee.set(k, [])
    sallesParMusee.get(k).push({ cle: cle(nomS), valeur: nomS })
  }
  for (const s of salles) ajouterSalle(nomMusee.get(s.museumId) || '', s.nom)
  for (const s of tables.salles) ajouterSalle(s.musee, s.row.nom)
  const idxSalles = new Map([...sallesParMusee].map(([k, v]) => [k, indexRapprochement(v)]))

  const resoudreSalle = (nomM, nomS) => {
    const museeOk = resoudreMusee(nomM)
    if (!museeOk) return null
    const idx = idxSalles.get(cle(museeOk))
    if (!idx) return null
    const r = rapprocher(nomS, idx)
    if (!r) return null
    if (r.methode !== 'exact') rapprochements.push({ champ: 'Salle', de: nomS, vers: r.entree.valeur, methode: r.methode })
    return { musee: museeOk, salle: r.entree.valeur }
  }

  // ---- OBJETS ----
  etape('nettoyage')
  await parcourir('objets', 'Objets', ({ ligne, val }) => {
    const nom = val('nom')
    if (!nom) { problemes.push({ ligne, onglet: 'Objets', motif: 'nom_manquant' }); return }
    const lieu = resoudreSalle(val('musee'), val('salle'))
    if (!lieu) {
      problemes.push({ ligne, onglet: 'Objets', motif: 'salle_inconnue', detail: `${val('musee')} › ${val('salle')}` }); return
    }
    const { valeur: matiere, ok: matiereOk } = normaliserMatiere(val('matiere'))
    // On garde trace de CE QUI A ÉTÉ RÉÉCRIT : le conservateur doit pouvoir le
    // vérifier avant que ce soit en base, pas le découvrir après.
    if (matiere && cle(val('matiere')) !== matiere) majMatieres.set(val('matiere'), matiere)
    if (!matiereOk) {
      problemes.push({ ligne, onglet: 'Objets', motif: 'matiere_invalide', detail: val('matiere') }); return
    }
    const ton = cle(val('tonNarratif'))
    if (ton && !TONS.includes(ton)) {
      problemes.push({ ligne, onglet: 'Objets', motif: 'ton_invalide', detail: val('tonNarratif') }); return
    }
    tables.objets.push({
      ligne, musee: lieu.musee, salle: lieu.salle,
      row: {
        reference: val('reference') || null,
        nom,
        nom_commun: val('nomCommun') || null,
        description: val('description') || null,
        matiere: matiere || null,
        secret_mot: val('secretMot') || null,
        secret_recit: val('secretRecit') || null,
        secret_indice: val('secretIndice') || null,
        published: OUI.has(cle(val('publier'))),
        // Toujours présent, même vide : en insertion par LOT, une clé absente
        // d'une partie des lignes fait insérer NULL dans les autres.
        ton_narratif: ton || 'conteur'
      }
    })
  })

  if (rapprochements.length) {
    // Dédoublonnés : un même « Tresor Royal » rapproché sur cent lignes ne
    // mérite qu'une ligne à l'écran.
    const vus = new Map()
    for (const r of rapprochements) vus.set(`${r.champ}|${r.de}|${r.vers}`, r)
    transformations.push({
      champ: 'Rapprochements',
      motif: 'ressemblance',
      exemples: [...vus.values()].slice(0, 10).map((r) => ({ de: `${r.de} (${r.methode})`, vers: r.vers })),
      total: vus.size
    })
  }

  if (majMatieres.size) {
    transformations.push({
      champ: 'Matière',
      motif: 'vocabulaire',
      exemples: [...majMatieres.entries()].slice(0, 8).map(([de, vers]) => ({ de, vers })),
      total: majMatieres.size
    })
  }

  // ---- ÉTAGE 2 : classification des doublons ----
  //
  // L'écriture dédoublonne déjà sur le numéro d'inventaire — méthode classique,
  // exacte, réglée. Ce qui suit cherche ce qu'elle NE PEUT PAS voir : la même
  // œuvre ressaisie sans référence, ou déjà présente au catalogue.
  //
  // On compare le lot à lui-même ET à l'existant : un musée qui redépose un
  // inventaire enrichi ne doit pas recréer ce qu'il a déjà.
  etape('doublons')
  const fiches = [
    ...tables.objets.map((o) => ({
      source: 'fichier', ligne: o.ligne, salle: o.salle,
      reference: o.row.reference, nom: o.row.nom, matiere: o.row.matiere, description: o.row.description
    })),
    ...objets.map((o) => ({
      source: 'catalogue', id: o.id, salle: null,
      reference: o.reference, nom: o.nom, matiere: o.matiere, description: o.description
    }))
  ]
  const doublons = fiches.length > 1 ? chercherDoublons(fiches) : []

  etape('fini')
  return { ...tables, problemes, absentes, parIA, plans, transformations, doublons,
    fichiers: [...new Set(lisibles.map((x) => x.fichier))], total }
}

// ------------------------------------------------------------- l'écriture --

/**
 * Crée en cascade : musées, puis salles, puis œuvres.
 * @returns {Promise<{musees:number, salles:number, objets:number}>}
 */
export async function importerFonds(analyse, { musees = [], salles = [] } = {}) {
  const { supabase } = await import('./supabase')
  const fait = { musees: 0, salles: 0, objets: 0, majObjets: 0 }

  // ANNULATION EN CAS D'ÉCHEC.
  //
  // La cascade est en trois requêtes, donc en trois transactions : si les
  // œuvres échouent, les musées et les salles sont DÉJÀ créés. C'est arrivé —
  // deux imports ratés ont laissé quatre musées et huit salles vides dans la
  // base, que personne n'avait demandés et que rien ne signalait.
  //
  // On tient donc la liste de ce que CE passage a créé, et on le défait si la
  // suite échoue. Ce n'est pas une vraie transaction — pour cela il faudrait
  // une fonction en base — mais cela tient la promesse qui compte : un import
  // qui échoue ne laisse pas de moitié derrière lui.
  const creesM = []
  const creesS = []
  const defaire = async () => {
    // Salles d'abord : elles référencent les musées.
    if (creesS.length) await supabase.from('sectors').delete().in('id', creesS)
    if (creesM.length) await supabase.from('museums').delete().in('id', creesM)
  }

  // Annuaire des musées : identifiant par nom normalisé.
  const idMusee = new Map(musees.map((m) => [cle(m.nom), m.id]))

  try {

  // ---- 1. musées ----
  const nouveauxM = analyse.musees.filter((m) => !idMusee.has(cle(m.nom)))
  if (nouveauxM.length) {
    const { data, error } = await supabase.from('museums').insert(nouveauxM.map((m) => m.row)).select('id, nom')
    if (error) throw new Error(`musées : ${error.message}`)
    for (const m of data || []) { idMusee.set(cle(m.nom), m.id); creesM.push(m.id) }
    fait.musees = data?.length || 0
  }

  // ---- 2. salles ----
  const nomMusee = new Map(musees.map((m) => [m.id, m.nom]))
  const idSalle = new Map(salles.map((s) => [`${cle(nomMusee.get(s.museumId) || '')}|${cle(s.nom)}`, s.id]))

  const nouvellesS = analyse.salles.filter((s) => !idSalle.has(`${cle(s.musee)}|${cle(s.nom)}`))
  if (nouvellesS.length) {
    const rows = nouvellesS.map((s) => ({ ...s.row, museum_id: idMusee.get(cle(s.musee)) }))
    const manquant = rows.find((r) => !r.museum_id)
    if (manquant) throw new Error(`salle « ${manquant.nom} » : musée introuvable après création`)
    const { data, error } = await supabase.from('sectors').insert(rows).select('id, nom, museum_id')
    if (error) throw new Error(`salles : ${error.message}`)
    const nomParId = new Map([...idMusee].map(([n, id]) => [id, n]))
    for (const s of data || []) { idSalle.set(`${nomParId.get(s.museum_id)}|${cle(s.nom)}`, s.id); creesS.push(s.id) }
    fait.salles = data?.length || 0
  }

  // ---- 3. œuvres : MISE À JOUR OU CRÉATION, jamais de doublon ----
  //
  // C'est ici que se jouait la duplication. On insérait sans rien vérifier :
  // redéposer un inventaire corrigé recréait la collection entière. Constaté en
  // base — 12 des 20 œuvres du locataire 1 portent un nom déjà présent.
  //
  // La règle est celle des entrepôts de données : on écrit sur une CLÉ MÉTIER,
  // ici le numéro d'inventaire du musée, stable et attribué une fois pour
  // toutes. `upsert` sur `(tenant_id, reference)` met à jour ce qui existe et
  // crée le reste : l'import devient REJOUABLE sans conséquence.
  //
  // Les œuvres SANS référence sont insérées telles quelles. On ne peut pas les
  // reconnaître, et deviner une identité d'après le nom rapprocherait deux
  // masques légitimement homonymes.
  if (analyse.objets.length) {
    const rows = analyse.objets.map((o) => ({
      ...o.row,
      sector_id: idSalle.get(`${cle(o.musee)}|${cle(o.salle)}`)
    }))
    const manquant = rows.find((r) => !r.sector_id)
    if (manquant) throw new Error(`œuvre « ${manquant.nom} » : salle introuvable après création`)

    const avecRef = rows.filter((r) => r.reference)
    const sansRef = rows.filter((r) => !r.reference)

    if (avecRef.length) {
      // `ignoreDuplicates: false` = on MET À JOUR la ligne existante. Sans lui,
      // un fichier corrigé serait lu, validé… puis silencieusement ignoré.
      const { data, error } = await supabase
        .from('objects')
        .upsert(avecRef, { onConflict: 'tenant_id,reference', ignoreDuplicates: false })
        .select('id')
      if (error) throw new Error(`œuvres : ${error.message}`)
      fait.objets += data?.length || 0
    }
    if (sansRef.length) {
      const { data, error } = await supabase.from('objects').insert(sansRef).select('id')
      if (error) throw new Error(`œuvres : ${error.message}`)
      fait.objets += data?.length || 0
    }
  }
  } catch (e) {
    // On défait AVANT de relancer : l'appelant affichera l'erreur, mais la base
    // sera revenue à son état d'avant.
    await defaire().catch(() => {})
    throw e
  }

  return fait
}
