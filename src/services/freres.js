import { supabase } from './supabase'
import { chercherFreres } from './collectionsApi'

// LE CABINET DE COMPARAISON — orchestration « retrieve then rerank ».
//
// LE PIÈGE QU'ON ÉVITE
//
// La tentation est d'interroger les API avec des mots-clés bruts, ou à
// l'inverse d'indexer Europeana en entier. Ni l'un ni l'autre : on ramène
// LARGE et bruité, puis on ORDONNE avec du sens, puis on JUGE, puis un humain
// tranche. Chaque étape retire du bruit d'une manière que la précédente ne
// savait pas faire.
//
// LES CINQ TEMPS
//
//   1. requête    — la fiche française → vocabulaire de catalogue anglais.
//   2. rappel     — les API de musées, en parallèle. 100 à 400 candidats.
//   3. cache      — les candidats entrent dans le catalogue GLOBAL.
//   4. plongement — par lots (le plafond de calcul est bas, cf. `freres`).
//   5. classement — pgvector, top 20. Puis jugement LLM. Puis l'humain.
//
// POURQUOI LE CACHE EST GLOBAL
//
// Un masque du Met est le même objet pour toutes les organisations de la
// plateforme. On l'interroge et on le plonge une seule fois ; tous les tenants
// en profitent. Seul le LIEN de fraternité est propre à un tenant, parce qu'il
// dépend de la validation de SON conservateur. Le coût par organisation baisse
// donc à mesure que la plateforme grandit — c'est l'inverse de l'intuition.

const FN = 'freres'

async function appeler(payload) {
  const { data, error } = await supabase.functions.invoke(FN, { body: payload })
  if (error) return { ok: false, error: error.message }
  return data || { ok: false, error: 'reponse_vide' }
}

// ---------------------------------------------------------------------------
// 1. La requête structurée
// ---------------------------------------------------------------------------
export async function requeteStructuree(objet, criteres = {}) {
  return appeler({
    action: 'requete',
    nom: objet.nom,
    nomCommun: objet.nomCommun,
    description: objet.description,
    culture: criteres.culture,
    pays: criteres.pays,
    materiau: criteres.materiau,
    periode: criteres.periode
  })
}

// ---------------------------------------------------------------------------
// 3. Mise en cache des candidats
// ---------------------------------------------------------------------------
// Le `texte_indexe` est composé ICI et en ANGLAIS. C'est un choix mesuré, pas
// une commodité : avec `gte-small`, une requête française classait une peinture
// de moulin hollandais devant deux masques. En anglais le classement se tient
// (vrais frères ≥ 0,898, bruit ≤ 0,779). Les notices des API sont déjà en
// anglais — on ne les traduit pas, on les concatène telles quelles.
function texteIndexe(c) {
  return [c.title, c.culture, c.region, c.origine, c.medium, c.date]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(', ')
    .slice(0, 600)
}

export async function mettreEnCache(candidats) {
  const lignes = candidats
    .filter((c) => c.source && c.externalId)
    .map((c) => ({
      source: c.source,
      source_id: String(c.externalId),
      titre: c.title || null,
      culture: c.culture || null,
      pays: c.origine || null,
      date_objet: c.date || null,
      materiau: c.medium || null,
      image_url: c.image || null,
      source_url: c.url || null,
      texte_indexe: texteIndexe(c) || null
    }))
  if (!lignes.length) return { ok: true, ids: [], aPlonger: 0 }

  const { data, error } = await supabase.rpc('externes_cacher', { p_lignes: lignes })
  if (error) return { ok: false, error: error.message, ids: [], aPlonger: 0 }
  const rangees = data || []
  return {
    ok: true,
    ids: rangees.map((r) => r.id),
    // Ce chiffre est le VRAI coût de la recherche : le reste est déjà payé par
    // les organisations qui sont passées avant.
    aPlonger: rangees.filter((r) => !r.a_embedding).length,
    // Correspondance clé API → identifiant du catalogue, pour rattacher les
    // scores lexicaux déjà calculés aux lignes revenues du reclassement.
    parCle: Object.fromEntries(rangees.map((r) => [`${r.source}:${r.source_id}`, r.id]))
  }
}

// ---------------------------------------------------------------------------
// 4. Les plongements, par lots
// ---------------------------------------------------------------------------
// La fonction serveur traite 12 candidats par appel (plafond mesuré : 18 passent,
// 20 déclenchent WORKER_RESOURCE_LIMIT). On boucle jusqu'à épuisement, avec un
// nombre de tours PLAFONNÉ : sans lui, une ligne au texte impossible à plonger
// ferait tourner la boucle indéfiniment.
export async function plongerCandidats(ids, onProgress) {
  let total = 0
  const maxTours = Math.ceil((ids?.length || 12) / 12) + 3
  for (let tour = 0; tour < maxTours; tour++) {
    const r = await appeler({ action: 'plonger', ids })
    if (!r.ok) return { ok: false, error: r.error, plonges: total }
    total += r.plonges || 0
    onProgress?.(total)
    if (!r.restants) return { ok: true, plonges: total }
    // Aucun progrès alors qu'il reste du travail : on s'arrête au lieu de
    // marteler le serveur.
    if (!r.plonges) return { ok: true, plonges: total, incomplet: true }
  }
  return { ok: true, plonges: total, incomplet: true }
}

export async function plongerObjet(objectId, texteEn) {
  return appeler({ action: 'plonger_objet', objectId, texte: texteEn })
}

// ---------------------------------------------------------------------------
// 5. Reclassement puis jugement
// ---------------------------------------------------------------------------
export async function reclasser(objectId, ids, limite = 20) {
  const { data, error } = await supabase.rpc('freres_reclasser_objet', {
    p_object_id: objectId, p_ids: ids?.length ? ids : null, p_limite: limite
  })
  if (error) return { ok: false, error: error.message, lignes: [] }
  return { ok: true, lignes: data || [] }
}

export async function juger(objet, finalistes) {
  return appeler({
    action: 'juger',
    nom: objet.nom,
    culture: objet.culture,
    materiau: objet.materiau,
    periode: objet.periode,
    description: objet.description,
    candidats: finalistes.map((f) => ({
      id: f.id, titre: f.titre, culture: f.culture, pays: f.pays,
      date_objet: f.date_objet, materiau: f.materiau, source: f.source
    }))
  })
}

export async function enregistrerPropositions(objectId, lignes) {
  const { data, error } = await supabase.rpc('freres_proposer', {
    p_object_id: objectId, p_lignes: lignes
  })
  if (error) return { ok: false, error: error.message, n: 0 }
  return { ok: true, n: data || 0 }
}

// ---------------------------------------------------------------------------
// La chaîne complète
// ---------------------------------------------------------------------------
/**
 * Enchaîne les cinq temps et enregistre les propositions.
 * `etape(cle, detail)` est appelé à chaque bascule : c'est ce qui permet à
 * l'écran de dire où on en est, sur une opération qui dure une minute.
 *
 * Ne lève jamais : renvoie { ok, ...} avec l'étape qui a échoué. Une recherche
 * qui s'arrête au reclassement a quand même rempli le cache — ce n'est pas
 * perdu, et le tour suivant repartira de là.
 */
export async function chercherEtJuger(objet, criteres = {}, etape = () => {}) {
  // --- 1. requête -----------------------------------------------------------
  etape('requete')
  const req = await requeteStructuree(objet, criteres)
  if (!req.ok) return { ok: false, etape: 'requete', error: req.error }

  // --- 2. rappel large ------------------------------------------------------
  etape('rappel')
  const local = {
    nom: objet.nom,
    nomCommun: objet.nomCommun,
    culture: req.culture || criteres.culture || '',
    pays: req.pays || criteres.pays || '',
    materiau: (req.materiaux || []).join(', ') || criteres.materiau || '',
    periode: req.periode || criteres.periode || ''
  }
  const rappel = await chercherFreres(local, {
    termes: req.termes_en,
    limite: 40,
    // Seuil bas VOULU : c'est l'étape du rappel, pas celle de la précision.
    // Filtrer ici sur le score lexical écarterait justement les objets que la
    // comparaison sémantique sait reconnaître et que les mots ne disent pas.
    scoreMin: 0,
    onProgress: (faites, total) => etape('rappel', { faites, total })
  })
  if (!rappel.candidats.length) {
    return { ok: false, etape: 'rappel', error: 'aucun_candidat', requete: req, erreurs: rappel.erreurs }
  }

  // --- 3. cache -------------------------------------------------------------
  etape('cache', { n: rappel.candidats.length })
  const cache = await mettreEnCache(rappel.candidats)
  if (!cache.ok) return { ok: false, etape: 'cache', error: cache.error }

  // --- 4. plongements -------------------------------------------------------
  // Le nôtre d'abord : sans lui, le reclassement n'a pas de point de référence.
  etape('plongement', { aFaire: cache.aPlonger })
  const moi = await plongerObjet(objet.id, req.texte_en)
  if (!moi.ok) return { ok: false, etape: 'plongement', error: moi.error }
  if (cache.aPlonger) {
    const p = await plongerCandidats(cache.ids, (n) => etape('plongement', { faits: n, aFaire: cache.aPlonger }))
    if (!p.ok) return { ok: false, etape: 'plongement', error: p.error }
  }

  // --- 5. classement --------------------------------------------------------
  etape('classement')
  const cl = await reclasser(objet.id, cache.ids, 20)
  if (!cl.ok) return { ok: false, etape: 'classement', error: cl.error }
  if (!cl.lignes.length) return { ok: false, etape: 'classement', error: 'aucun_plongement' }

  // --- 6. jugement ----------------------------------------------------------
  etape('jugement', { n: cl.lignes.length })
  const jug = await juger({ ...objet, ...local }, cl.lignes)
  const verdicts = new Map((jug.verdicts || []).map((v) => [v.id, v]))

  // Sans jugement (clé absente, réseau), on n'abandonne pas : on propose le
  // classement sémantique nu. Le conservateur perd la phrase d'explication,
  // pas la découverte — et l'écran le lui dit.
  const lignes = cl.lignes
    .map((l) => {
      const v = verdicts.get(l.id)
      return {
        externe_id: l.id,
        score: Math.round(l.similarite * 100),
        type_lien: v?.type_lien || null,
        justification: v?.justification || null,
        garder: v ? v.garder : true,
        _notice: l
      }
    })
    .filter((l) => l.garder)

  if (!lignes.length) {
    return { ok: true, propositions: 0, ecartes: cl.lignes.length, requete: req, jugee: jug.ok }
  }

  etape('enregistrement', { n: lignes.length })
  const ecrit = await enregistrerPropositions(
    objet.id,
    lignes.map(({ externe_id, score, type_lien, justification }) =>
      ({ externe_id, score, type_lien, justification }))
  )
  if (!ecrit.ok) return { ok: false, etape: 'enregistrement', error: ecrit.error }

  return {
    ok: true,
    propositions: ecrit.n,
    ecartes: cl.lignes.length - lignes.length,
    requete: req,
    jugee: jug.ok,
    moteur: jug.moteur,
    plongesPayes: cache.aPlonger,
    candidatsBruts: rappel.candidats.length,
    erreursSources: rappel.erreurs
  }
}

// ---------------------------------------------------------------------------
// Lecture et décision (étape D)
// ---------------------------------------------------------------------------
export async function listerFreres(objectId) {
  const { data, error } = await supabase
    .from('object_siblings')
    .select('id, externe_id, source, external_id, titre, culture, pays, date_objet, ' +
            'materiau, image_url, source_url, score, type_lien, justification, ' +
            'statut, note_curateur, decided_at')
    .eq('object_id', objectId)
    .order('score', { ascending: false })
  if (error) { console.error('[freres] liste', error.message); return [] }
  return data || []
}

export async function decider(id, statut, justification = null, note = null) {
  const { error } = await supabase.rpc('frere_decider', {
    p_id: id, p_statut: statut, p_justification: justification, p_note: note
  })
  return error ? { ok: false, error: error.message } : { ok: true }
}

// Les cinq natures de lien reconnues. Toute autre valeur est refusée côté
// serveur : les filtres du cabinet reposent sur cette liste exacte.
export const TYPES_LIEN = [
  'meme_culture', 'meme_technique', 'meme_periode', 'meme_atelier', 'meme_usage'
]
