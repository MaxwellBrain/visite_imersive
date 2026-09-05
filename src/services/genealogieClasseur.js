// ============================================================================
// LA GÉNÉALOGIE PAR CLASSEUR — la dynastie se remplit dans un tableau.
// ----------------------------------------------------------------------------
// Même raison que pour les objets : personne ne saisira quarante règnes dans un
// formulaire web, un chef à la fois. La différence, c'est que les personnes se
// DÉSIGNENT ENTRE ELLES — père, mère, prédécesseur — et qu'un musée ne peut pas
// écrire des identifiants de lignes qui n'existent pas encore au moment où il
// remplit son fichier.
//
// D'OÙ L'IMPORT EN DEUX PASSES, qui est tout le sujet de ce module :
//
//   1. on crée toutes les personnes SANS leurs liens, et la base rend les
//      identifiants qu'elle vient d'attribuer ;
//   2. on relit les colonnes « Père », « Mère », « Prédécesseur » — qui
//      contiennent des NOMS — et on les convertit en identifiants, en cherchant
//      d'abord parmi les personnes du classeur, puis parmi celles déjà en base.
//
// Une passe unique était impossible : un fils peut précéder son père dans le
// tableau, et rien n'oblige un remplisseur à trier sa dynastie.
//
// CE QUI EST REFUSÉ PLUTÔT QUE DEVINÉ. Un nom de parent qui ne correspond à
// personne, ou qui correspond à DEUX personnes, n'est pas résolu au hasard : le
// lien est laissé vide et signalé. Une filiation fausse dans une généalogie de
// chefferie n'est pas une coquille, c'est une contre-vérité historique.
// ============================================================================

import { construireClasseur, lireClasseur, lireCsv, estCsv } from './xlsx'

export const COLONNES = [
  { cle: 'nom', titre: 'Nom *', largeur: 22, aide: 'Le nom de la personne. Obligatoire.' },
  { cle: 'prenom', titre: 'Prénom', largeur: 18, aide: 'S’il est connu et distinct du nom.' },
  { cle: 'titre', titre: 'Titre', largeur: 20, aide: 'Fo’, Chef, Reine mère, Notable…' },
  { cle: 'sexe', titre: 'Sexe (M/F)', largeur: 11, aide: 'M ou F. Laisser vide si inconnu.' },
  { cle: 'chefferie', titre: 'Chefferie', largeur: 22, aide: 'La chefferie de rattachement.' },
  { cle: 'rangDynastique', titre: 'Rang dynastique', largeur: 16, aide: 'Ex. « 9e » ou « IX ». Texte libre.' },
  { cle: 'regneDebut', titre: 'Début de règne', largeur: 14, aide: 'Une année, en chiffres. Ex. 1903.' },
  { cle: 'regneFin', titre: 'Fin de règne', largeur: 14, aide: 'Une année, en chiffres.' },
  { cle: 'dateNaissance', titre: 'Naissance', largeur: 16, aide: 'Texte libre : « vers 1870 » est accepté.' },
  { cle: 'dateAccession', titre: 'Accession', largeur: 16, aide: 'Texte libre.' },
  { cle: 'dateDeces', titre: 'Décès', largeur: 16, aide: 'Texte libre.' },
  { cle: 'biographie', titre: 'Biographie', largeur: 70, aide: 'Le récit de la vie. C’est le cœur du travail.' },
  { cle: 'accomplissements', titre: 'Accomplissements', largeur: 50, aide: 'Ce qu’il ou elle a laissé.' },
  { cle: 'personnalite', titre: 'Personnalité', largeur: 40, aide: 'Le caractère, tel que la tradition le rapporte.' },
  { cle: 'anecdotes', titre: 'Anecdotes', largeur: 50, aide: 'Les récits qui se transmettent.' },
  { cle: 'circonstancesDeces', titre: 'Circonstances du décès', largeur: 40, aide: 'Facultatif.' },
  { cle: 'lieuSepulture', titre: 'Lieu de sépulture', largeur: 26, aide: 'Facultatif.' },
  { cle: 'nbEpouses', titre: 'Nombre d’épouses', largeur: 16, aide: 'En chiffres.' },
  { cle: 'nbEnfants', titre: 'Nombre d’enfants', largeur: 16, aide: 'En chiffres.' },
  { cle: 'pere', titre: 'Père (nom)', largeur: 22, aide: 'Le NOM du père, tel qu’écrit dans ce classeur ou déjà en base.' },
  { cle: 'mere', titre: 'Mère (nom)', largeur: 22, aide: 'Le NOM de la mère, même règle.' },
  { cle: 'predecesseur', titre: 'Prédécesseur (nom)', largeur: 24, aide: 'Le NOM de celui ou celle à qui la personne succède.' },
  { cle: 'sources', titre: 'Sources', largeur: 40, aide: 'D’où vient l’information : témoin, archive, ouvrage.' },
  { cle: 'publier', titre: 'Publier (oui/non)', largeur: 16, aide: 'oui = visible sur le site. Vide ou non = brouillon.' }
]

const OUI = new Set(['oui', 'o', 'yes', 'y', 'true', 'vrai', '1', 'x'])
const normaliser = (s) => String(s ?? '').trim()
const cle = (s) => normaliser(s).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')

// Clé d'identité d'une personne : nom + prénom. Le prénom compte, sinon deux
// chefs homonymes d'une même dynastie — cas fréquent — seraient confondus.
const cleIdentite = (nom, prenom) => `${cle(nom)}|${cle(prenom)}`

// Un entier, ou null. « vers 1870 » ne devient pas 1870 : ce serait inventer
// une précision que le remplisseur n'a pas donnée. Ces colonnes-là sont du
// texte libre, et c'est voulu.
function entier(v) {
  const s = normaliser(v).replace(/\s/g, '')
  if (!/^-?\d+$/.test(s)) return null
  return Number(s)
}

/** Construit le classeur à envoyer, garni des personnes déjà saisies. */
export function modeleClasseur({ personnes = [] } = {}) {
  const parId = new Map(personnes.map((p) => [p.id, p]))
  const nomDe = (id) => {
    const p = parId.get(id)
    return p ? normaliser(p.nom) : ''
  }

  const lignes = [COLONNES.map((c) => c.titre)]
  for (const p of personnes) {
    lignes.push([
      p.nom || '', p.prenom || '', p.titre || '', p.sexe || '', p.chefferie || '',
      p.rang_dynastique || '', p.regne_debut ?? '', p.regne_fin ?? '',
      p.date_naissance || '', p.date_accession || '', p.date_deces || '',
      p.biographie || '', p.accomplissements || '', p.personnalite || '', p.anecdotes || '',
      p.circonstances_deces || '', p.lieu_sepulture || '',
      p.nb_epouses ?? '', p.nb_enfants ?? '',
      nomDe(p.pere_id), nomDe(p.mere_id), nomDe(p.predecesseur_id),
      p.sources || '', p.published ? 'oui' : 'non'
    ])
  }

  const aide = [
    ['Colonne', 'À quoi elle sert'],
    ...COLONNES.map((c) => [c.titre, c.aide]),
    ['', ''],
    ['Père, Mère, Prédécesseur', 'On y écrit un NOM, pas un numéro. La personne peut se trouver plus bas dans le tableau : l’ordre des lignes n’a aucune importance.'],
    ['Un nom introuvable', 'n’est pas deviné : le lien reste vide et la ligne est signalée. Une filiation fausse dans une généalogie est une contre-vérité, pas une coquille.'],
    ['Deux personnes du même nom', 'rendent le lien ambigu : ajoutez le prénom pour les distinguer.'],
    ['Ne pas renommer', 'la première ligne : c’est elle qui identifie les colonnes.'],
    ['Les portraits', 'ne se mettent pas ici. Ils se déposent depuis l’application.']
  ]

  return construireClasseur([
    { nom: 'Genealogie', lignes, largeurs: COLONNES.map((c) => c.largeur) },
    { nom: 'Aide', lignes: aide, largeurs: [26, 96] }
  ])
}

/**
 * Relit un classeur rempli. N'écrit rien.
 * @returns {Promise<{pretes: object[], problemes: object[], total: number}>}
 */
export async function analyserClasseur(fichier, { personnes = [] } = {}) {
  // Un CSV ne porte qu'une table et aucun nom d'onglet : ses lignes SONT la
  // dynastie. Le format reste utile — tous les musées n'ont pas Excel, et
  // certains exportent depuis un ancien logiciel d'inventaire.
  const feuilles = estCsv(fichier)
    ? [{ nom: 'Genealogie', lignes: await lireCsv(fichier) }]
    : await lireClasseur(fichier)
  const f = feuilles.find((x) => cle(x.nom).startsWith('genealog')) || feuilles[0]
  if (!f || !f.lignes.length) {
    return { pretes: [], problemes: [{ ligne: 0, motif: 'classeur_vide' }], total: 0 }
  }

  const entetes = (f.lignes[0] || []).map(cle)
  const index = {}
  for (const c of COLONNES) {
    const i = entetes.indexOf(cle(c.titre))
    if (i >= 0) index[c.cle] = i
  }
  if (index.nom == null) {
    return { pretes: [], problemes: [{ ligne: 1, motif: 'entetes_introuvables' }], total: 0 }
  }

  const pretes = []
  const problemes = []
  let total = 0

  for (let i = 1; i < f.lignes.length; i++) {
    const l = f.lignes[i] || []
    if (!l.some((c) => normaliser(c))) continue
    total++
    const val = (k) => (index[k] == null ? '' : normaliser(l[index[k]]))
    const ligne = i + 1

    const nom = val('nom')
    if (!nom) { problemes.push({ ligne, motif: 'nom_manquant' }); continue }

    const sexeBrut = cle(val('sexe'))
    let sexe = null
    if (sexeBrut) {
      const c0 = sexeBrut[0]
      if (c0 === 'm' || c0 === 'h') sexe = 'M'
      else if (c0 === 'f') sexe = 'F'
      else { problemes.push({ ligne, motif: 'sexe_invalide', detail: val('sexe') }); continue }
    }

    pretes.push({
      ligne,
      // Les noms des parents voyagent à part : ils ne sont pas des colonnes de
      // la table, ils seront convertis en identifiants à la seconde passe.
      _liens: { pere: val('pere'), mere: val('mere'), predecesseur: val('predecesseur') },
      row: {
        nom,
        prenom: val('prenom') || null,
        titre: val('titre') || null,
        sexe,
        chefferie: val('chefferie') || null,
        rang_dynastique: val('rangDynastique') || null,
        regne_debut: entier(val('regneDebut')),
        regne_fin: entier(val('regneFin')),
        date_naissance: val('dateNaissance') || null,
        date_accession: val('dateAccession') || null,
        date_deces: val('dateDeces') || null,
        biographie: val('biographie') || null,
        accomplissements: val('accomplissements') || null,
        personnalite: val('personnalite') || null,
        anecdotes: val('anecdotes') || null,
        circonstances_deces: val('circonstancesDeces') || null,
        lieu_sepulture: val('lieuSepulture') || null,
        nb_epouses: entier(val('nbEpouses')),
        nb_enfants: entier(val('nbEnfants')),
        sources: val('sources') || null,
        published: OUI.has(cle(val('publier')))
      }
    })
  }

  // Les liens se vérifient MAINTENANT, pas à l'écriture : le musée doit voir
  // ses noms introuvables dans l'aperçu, tant qu'il peut encore corriger son
  // fichier — et non découvrir des filiations manquantes après coup.
  const annuaire = new Map()
  const doublons = new Set()
  const inscrire = (nom, prenom, valeur) => {
    for (const k of [cleIdentite(nom, prenom), cleIdentite(nom, '')]) {
      if (annuaire.has(k) && annuaire.get(k) !== valeur) doublons.add(k)
      else annuaire.set(k, valeur)
    }
  }
  for (const p of personnes) inscrire(p.nom, p.prenom, { id: p.id })
  for (const p of pretes) inscrire(p.row.nom, p.row.prenom, { ligne: p.ligne })

  for (const p of pretes) {
    for (const [role, nom] of Object.entries(p._liens)) {
      if (!nom) continue
      const k = cleIdentite(nom, '')
      if (doublons.has(k)) problemes.push({ ligne: p.ligne, motif: 'lien_ambigu', detail: `${role} : ${nom}` })
      else if (!annuaire.has(k)) problemes.push({ ligne: p.ligne, motif: 'lien_introuvable', detail: `${role} : ${nom}` })
    }
  }

  return { pretes, problemes, total }
}

/**
 * Écrit en base, en deux passes.
 *
 * @returns {Promise<{crees: number, liens: number}>}
 */
export async function importerPersonnages(pretes, { personnes = [] } = {}) {
  const { supabase } = await import('./supabase')

  // ---- passe 1 : les personnes, sans leurs liens ----------------------------
  const { data: crees, error } = await supabase
    .from('personnages')
    .insert(pretes.map((p) => p.row))
    .select('id, nom, prenom')
  if (error) throw new Error(error.message)

  // ---- passe 2 : les liens, convertis de noms en identifiants ---------------
  const annuaire = new Map()
  const doublons = new Set()
  const inscrire = (nom, prenom, id) => {
    for (const k of [cleIdentite(nom, prenom), cleIdentite(nom, '')]) {
      if (annuaire.has(k) && annuaire.get(k) !== id) doublons.add(k)
      else annuaire.set(k, id)
    }
  }
  for (const p of personnes) inscrire(p.nom, p.prenom, p.id)
  for (const c of crees || []) inscrire(c.nom, c.prenom, c.id)

  const resoudre = (nom) => {
    if (!nom) return null
    const k = cleIdentite(nom, '')
    return doublons.has(k) ? null : (annuaire.get(k) ?? null)
  }

  let liens = 0
  const majs = []
  for (let i = 0; i < pretes.length; i++) {
    const id = crees?.[i]?.id
    if (!id) continue
    const patch = {}
    const pere = resoudre(pretes[i]._liens.pere)
    const mere = resoudre(pretes[i]._liens.mere)
    const pred = resoudre(pretes[i]._liens.predecesseur)
    if (pere) patch.pere_id = pere
    if (mere) patch.mere_id = mere
    if (pred) patch.predecesseur_id = pred
    if (Object.keys(patch).length) {
      majs.push(supabase.from('personnages').update(patch).eq('id', id))
      liens += Object.keys(patch).length
      // Réciproque : si A succède à B, alors B a pour successeur A. La colonne
      // existe, et la laisser vide couperait la dynastie en deux dans l'arbre.
      if (pred) majs.push(supabase.from('personnages').update({ successeur_id: id }).eq('id', pred))
    }
  }
  const res = await Promise.all(majs)
  const echec = res.find((r) => r.error)
  if (echec) throw new Error(echec.error.message)

  return { crees: crees?.length || 0, liens }
}
