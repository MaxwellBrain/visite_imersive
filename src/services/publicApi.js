import { supabase } from './supabase'

// Accès en LECTURE au contenu PUBLIÉ uniquement (filtre explicite en plus de la RLS,
// pour que le site public reste identique même si un membre du staff est connecté).
//
// MULTI-TENANT : le site public affiche UNE organisation à la fois. Le layout
// résout l'adresse (/c/:slug ou domaine personnalisé) puis appelle setPublicTenant().
// Tant qu'aucune organisation n'est fixée, on ne filtre pas (site historique).

let publicTenantId = null
export function setPublicTenant(id) {
  // Changer d'organisation DOIT vider le cache : sans cela, un visiteur passant
  // d'une chefferie à une autre verrait les musées de la première.
  if (publicTenantId !== (id ?? null)) cache.clear()
  publicTenantId = id ?? null
}
export function getPublicTenant() { return publicTenantId }

// Restreint une requête à l'organisation affichée.
function scoped(q) {
  return publicTenantId == null ? q : q.eq('tenant_id', publicTenantId)
}

// ============================================================================
// MÉMORISATION entre navigations
// ----------------------------------------------------------------------------
// POURQUOI : `pubMuseums()` est appelé depuis cinq vues (accueil, catalogue,
// panier, compte, layout). Chaque navigation vers l'une d'elles refaisait la
// requête, alors que la liste des musées ne change pas entre deux clics.
// Mesuré le 2026-08-20 : un aller-retour vers Supabase coûte 323 à 2 050 ms
// même pour une requête triviale. Ce temps-là ne se gagne pas en optimisant la
// requête — il se gagne en ne la faisant pas.
//
// DURÉE DE VIE : 5 minutes. Assez pour que la navigation paraisse instantanée,
// assez court pour qu'une publication faite dans l'ERP apparaisse sans que le
// visiteur ait à vider son cache. Un cache permanent ferait gagner quelques
// millisecondes de plus au prix d'un site qui ment sur son contenu.
//
// On mémorise la PROMESSE, pas seulement le résultat : deux vues qui demandent
// la même donnée en même temps partagent alors un seul appel réseau.
// ============================================================================
const cache = new Map()
const DUREE_CACHE = 5 * 60 * 1000

function memo(cle, produire, duree = DUREE_CACHE) {
  const k = `${publicTenantId ?? 'tous'}:${cle}`
  const e = cache.get(k)
  if (e && Date.now() - e.pose < duree) return e.promesse

  const promesse = produire().catch((err) => {
    // Un échec ne doit pas rester en cache : la tentative suivante doit pouvoir
    // aboutir, sinon une coupure passagère condamnerait la donnée 5 minutes.
    cache.delete(k)
    throw err
  })
  cache.set(k, { pose: Date.now(), promesse })
  return promesse
}

// À appeler après une action qui modifie le contenu public (rare côté visiteur).
export function viderCachePublic() { cache.clear() }

// Colonnes des LISTES d'objets.
//
// `model3d`, `model3d_ios`, `model_usdz`, `embedding` et `texte_indexe` en sont
// volontairement ABSENTS. Mesuré le 2026-08-19 sur 13 objets publiés :
// `select('*')` transportait 3 159 Ko quand 19 Ko suffisent — 99,3 % de charge
// inutile, un seul objet pesant 3,1 Mo à lui seul (son modèle en base64).
// Ces écrans n'affichent qu'une vignette et un titre : ils n'ont aucun usage du
// maillage. La colonne calculée `a_3d` porte l'information « ce objet a un
// modèle », qui suffit à la pastille « 3D · AR ».
//
// La fiche détaillée ajoute `COLONNES_RA` ci-dessous : elle ne charge qu'UNE
// ligne, elle peut se permettre les réglages d'immersion.
const COLONNES_LISTE =
  'id, sector_id, nom, nom_commun, description, photo, photo_thumb,' +
  // `a_glb` et `a_ar_ios` disent CE QUI EST RÉELLEMENT DISPONIBLE, là où `a_3d`
  // se contente de « il existe un modèle, quel qu'il soit ». Sans eux, la fiche
  // proposait une visionneuse 3D à une pièce n'ayant qu'un .usdz, et une réalité
  // augmentée à un iPhone qui n'a rien à ouvrir. Voir 20260902_ar_separee.sql.
  ' published, published_at, seo, created_at, a_3d, a_glb, a_ar_ios,' +
  ' model3d_name, model3d_ios_name, ar_placement, ar_echelle, ar_seulement,' +
  ' depth_map_url, amplitude_relief'

// Mémorisées : appelées depuis cinq vues, elles étaient refaites à chaque
// navigation alors que leur contenu ne change pas entre deux clics.
export function pubMuseums() {
  return memo('museums', async () => {
    const { data, error } = await scoped(supabase.from('museums').select('*')).eq('published', true).order('id')
    if (error) { console.error('[public] museums', error.message); return [] }
    return data || []
  })
}

export function pubMuseum(id) {
  return memo(`museum:${id}`, async () => {
    const { data } = await scoped(supabase.from('museums').select('*')).eq('id', id).eq('published', true).maybeSingle()
    return data
  })
}

export function pubSectors(museumId) {
  return memo(`sectors:${museumId}`, async () => {
    const { data } = await scoped(supabase.from('sectors').select('*'))
      .eq('museum_id', museumId).eq('published', true).order('id')
    return data || []
  })
}

export async function pubObjectsForMuseum(museumId) {
  const sectors = await pubSectors(museumId)
  const ids = sectors.map((s) => s.id)
  if (!ids.length) return { sectors, objects: [] }
  const { data } = await scoped(supabase.from('objects').select(COLONNES_LISTE)).in('sector_id', ids).eq('published', true).order('id')
  return { sectors, objects: data || [] }
}

// Fiche d'un objet, SANS son modele 3D.
//
// MESURE (2026-08-19) : avec `select('*')`, cette page mettait ~12 s a s'afficher.
// La cause n'etait pas la requete mais son POIDS — un objet portait 2,72 Mo de
// modele en base64, transportes avant le moindre pixel. Or la page affiche
// d'abord un titre, une photo et une notice : le maillage n'est utile qu'au
// moment ou le visiteur ouvre la visionneuse, et beaucoup ne l'ouvrent jamais.
//
// Meme parti pris que l'ERP (useObjectStore.chargerMedias) : le lourd se
// demande separement, quand il sert.
// Réglages d'immersion RA — UNE SEULE LIGNE À LA FOIS, jamais dans une liste.
//
// Ils ne servent qu'à la visionneuse : les vignettes d'un catalogue n'ont que
// faire d'une douceur d'ombre. Les mêler à `COLONNES_LISTE` rejouerait à petite
// échelle la faute mesurée le 2026-08-19 — transporter partout ce qui n'est
// utile qu'à un endroit. On les ajoute donc à la fiche, et à elle seule.
const COLONNES_RA =
  // Vues complémentaires (20260905_objet_galerie.sql). Sur la FICHE seulement :
  // une liste de catalogue n'affiche qu'une vignette, lui envoyer huit URL par
  // objet rejouerait en petit la faute mesurée le 2026-08-19.
  ', photos' +
  ', ar_scale, ar_xr_environment, ar_shadow_intensity, ar_shadow_softness,' +
  ' ar_exposure, ar_camera_orbit, ar_min_orbit, ar_max_orbit,' +
  ' ar_interpolation_decay, ar_annotations,' +
  // Immersion sensorielle : ambiance sonore, matière (retour haptique),
  // adaptation de la lumière à l'heure du visiteur.
  ' ambiance_url, ambiance_volume, ambiance_spatiale, matiere, lumiere_auto,' +
  // L'objet caché : mot déclencheur et récit relu (voir services/intentions.js).
  ' secret_mot, secret_recit, secret_indice'

export async function pubObject(id) {
  const { data } = await scoped(supabase.from('objects').select(
    COLONNES_LISTE + COLONNES_RA + ', sectors(museum_id)'
  )).eq('id', id).eq('published', true).maybeSingle()
  return data
}

// Modeles 3D d'un objet, charges A L'OUVERTURE de la visionneuse seulement.
// Renvoie un objet vide en cas d'echec : la fiche reste consultable, seule la
// 3D manque — jamais l'inverse.
// ŒUVRES EN 3D, MISES EN AVANT SUR L'ACCUEIL.
//
// `model3d` est volontairement absent de la sélection commune (voir plus haut) :
// c'est une URL par objet, inutile aux listes. Ici on la veut, mais seulement
// pour la poignée d'œuvres qu'on va faire tourner — et en UNE requête, pas une
// par objet comme le ferait `pubObjectModels` appelé en boucle.
//
// Filtre `not model3d is null` : `a_3d` peut être coché sans qu'aucun fichier
// n'ait été déposé, et une visionneuse sans modèle n'affiche qu'une erreur.
export function pubObjects3D(limite = 3) {
  return memo(`objets3d:${limite}`, async () => {
    const { data, error } = await scoped(supabase.from('objects')
      .select('id, nom, nom_commun, photo, photo_thumb, model3d, model3d_ios, ar_placement, ar_echelle'))
      .eq('published', true).eq('a_3d', true).not('model3d', 'is', null)
      .order('id', { ascending: false }).limit(limite)
    if (error) { console.warn('[public] objets 3D', error.message); return [] }
    return data || []
  })
}

export async function pubObjectModels(id) {
  const { data, error } = await scoped(supabase.from('objects')
    .select('model3d, model3d_ios')).eq('id', id).eq('published', true).maybeSingle()
  if (error) { console.warn('[public] modeles', error.message); return {} }
  return data || {}
}

// Offre du guide vocal (règle §2.5 : uniquement si publié, actif ET prix défini).
// RPC server-side : ne renvoie QUE l'offre (jamais le script ni l'audio → paywall).
export async function pubVoiceOffer(museumId) {
  const { data, error } = await supabase.rpc('pub_voice_offer', { p_museum_id: museumId })
  if (error) console.error('[public] voice offer', error.message)
  const r = (data && data[0]) || null
  return r && {
    id: r.id, museumId: r.museum_id, titre: r.titre, prix: r.prix == null ? null : Number(r.prix),
    devise: r.devise, langues: r.langues || ['fr'], modeInteraction: r.mode_interaction,
    personnalisationNominative: r.personnalisation_nominative, modeleSalutation: r.modele_salutation
  }
}

// Contenu complet du guide (script, voix, audio) — RPC gated : renvoyé uniquement
// si le visiteur a un accès assistant_vocal actif (ou est staff), sinon null.
export async function getGuide(museumId) {
  const { data, error } = await supabase.rpc('get_guide', { p_museum_id: museumId })
  if (error) console.error('[public] get_guide', error.message)
  const r = (data && data[0]) || null
  return r && {
    id: r.id, museumId: r.museum_id, titre: r.titre, prix: r.prix == null ? null : Number(r.prix),
    devise: r.devise, langues: r.langues || ['fr'],
    modeInteraction: r.mode_interaction || 'narration',
    personnalisationNominative: r.personnalisation_nominative ?? true,
    modeleSalutation: r.modele_salutation || 'Bonjour {prenom}, bienvenue au {musee}.',
    sourceType: r.source_type || 'texte', scriptTexte: r.script_texte || '',
    timbreVoix: r.timbre_voix || 'standard', debit: r.debit == null ? 1 : Number(r.debit),
    ton: r.ton || 'neutre', audioSourceUrl: r.audio_source_url || '',
    audioTraitement: r.audio_traitement || 'tel_quel',
    provider: r.provider || 'elevenlabs',
    voiceId: r.voice_id || null
  }
}

// Pistes de l'audioguide — contenu payant : la RLS ne les renvoie qu'aux
// visiteurs disposant d'un accès assistant_vocal actif (sinon liste vide).
export async function pubAudioTracks(assistantId) {
  const { data, error } = await scoped(supabase
    .from('audio_tracks')
    .select('id, langue, fichier, texte, duree_sec, sector_id, object_id, sectors(nom), objects(nom)'))
    .eq('assistant_id', assistantId)
    .eq('actif', true)
    .order('id')
  if (error) console.error('[public] audio_tracks', error.message)
  return data || []
}

// Tarifs et paliers de don : parmi les données les plus stables du site, et
// pourtant rechargées à chaque passage au panier.
export function pubPlans() {
  return memo('plans', async () => {
    const { data } = await scoped(supabase.from('subscription_plans').select('*')).eq('actif', true).order('prix')
    return data || []
  })
}

export function pubDonationTiers() {
  return memo('dons', async () => {
    const { data } = await scoped(supabase.from('donation_tiers').select('*')).order('montant')
    return data || []
  })
}

export async function pubObjectChefs(objectId) {
  const { data } = await scoped(supabase
    .from('object_personnage')
    .select('type_lien, personnages(*)'))
    .eq('object_id', objectId)
  return (data || []).filter((r) => r.personnages && r.personnages.published)
}

export async function pubFeaturedObjects(limit = 6) {
  const { data } = await scoped(supabase.from('objects').select(COLONNES_LISTE)).eq('published', true)
    .order('published_at', { ascending: false, nullsFirst: false }).limit(limit)
  return data || []
}

export async function pubSearch(q) {
  const like = `%${q}%`
  const [m, o] = await Promise.all([
    scoped(supabase.from('museums').select('id,nom,photo')).eq('published', true).ilike('nom', like).limit(5),
    scoped(supabase.from('objects').select('id,nom,photo')).eq('published', true).ilike('nom', like).limit(8)
  ])
  return { museums: m.data || [], objects: o.data || [] }
}

// ---------- Boutiques (une par musée) ----------
const productFrom = (r) => ({
  id: r.id, museumId: r.museum_id, nom: r.nom, description: r.description,
  prix: r.prix == null ? null : Number(r.prix), devise: r.devise || 'FCFA',
  image: r.image, categorie: r.categorie, stock: r.stock
})

// Liste des boutiques = musées publiés ayant au moins un produit publié.
// La LISTE des boutiques (quels musées vendent, et combien d'articles) est
// stable. Le CONTENU d'une boutique ne l'est pas — stock et prix bougent — et
// n'est donc volontairement PAS mémorisé : voir pubMuseumProducts plus bas.
export function pubBoutiques() {
  return memo('boutiques', async () => {
    const { data, error } = await scoped(supabase
      .from('products')
      .select('museum_id, museums!inner(id, nom, photo, type, published)'))
      .eq('published', true)
    if (error) { console.error('[public] boutiques', error.message); return [] }
    const seen = new Map()
    for (const r of data || []) {
      const m = r.museums
      if (m?.published && !seen.has(m.id)) seen.set(m.id, { id: m.id, nom: m.nom, photo: m.photo, type: m.type, count: 0 })
      if (seen.has(m?.id)) seen.get(m.id).count++
    }
    return [...seen.values()]
  })
}

// Produits publiés d'un musée (sa boutique).
export async function pubMuseumProducts(museumId) {
  const { data, error } = await scoped(supabase.from('products').select('*')).eq('museum_id', museumId).eq('published', true).order('id')
  if (error) console.error('[public] museum products', error.message)
  return (data || []).map(productFrom)
}

// Quelques produits mis en avant (page d'accueil).
export async function pubFeaturedProducts(limit = 4) {
  const { data } = await scoped(supabase.from('products').select('*')).eq('published', true)
    .order('published_at', { ascending: false, nullsFirst: false }).limit(limit)
  return (data || []).map(productFrom)
}

// ---------- Événements ----------
const eventFrom = (r) => ({
  id: r.id, museumId: r.museum_id, titre: r.titre, description: r.description,
  image: r.image, lieu: r.lieu, dateDebut: r.date_debut, dateFin: r.date_fin
})

// Événements publiés, à venir ou en cours (on masque ceux qui sont terminés).
export async function pubEvents(limit = 6, museumId = null) {
  const today = new Date().toISOString().slice(0, 10)
  let q = scoped(supabase.from('events').select('*')).eq('published', true)
  if (museumId != null) q = q.eq('museum_id', museumId)
  const { data, error } = await q.or(`date_fin.gte.${today},date_fin.is.null`).order('date_debut').limit(limit)
  if (error) { console.error('[public] events', error.message); return [] }
  return (data || []).map(eventFrom)
}

// ---------- Livre d'or ----------
export async function pubReviews(limit = 12, museumId = null) {
  let q = scoped(supabase.from('reviews').select('*')).eq('published', true)
  if (museumId != null) q = q.eq('museum_id', museumId)
  const { data } = await q.order('created_at', { ascending: false }).limit(limit)
  return (data || []).map((r) => ({ id: r.id, nom: r.nom, message: r.message, note: r.note, createdAt: r.created_at }))
}

// Dépôt d'un avis : toujours en attente de modération (published = false, imposé par la RLS).
// Le visiteur n'étant pas connecté, le trigger ne peut pas deviner l'organisation :
// on la transmet explicitement (celle du site consulté).
export async function pubAddReview({ nom, message, note, museumId = null }) {
  const { error } = await supabase.from('reviews').insert({
    nom, message, note: note || null, museum_id: museumId,
    tenant_id: publicTenantId, published: false
  })
  if (error) throw error
  return true
}

// ---------- Messagerie ----------
// L'écriture passe par une fonction SECURITY DEFINER : le visiteur n'a aucun droit
// d'insertion sur les tables. C'est la base qui valide l'organisation, exige une
// adresse joignable et plafonne le débit — un contrôle côté navigateur ne
// protégerait de rien.
//
// Les erreurs sont renvoyées telles quelles (codes courts, ex. « trop_de_messages ») :
// l'appelant les traduit pour le visiteur.
export async function pubSendMessage({ sujet, corps, nom = null, email = null, orderId = null }) {
  if (publicTenantId == null) throw new Error('organisation_indisponible')
  const { data, error } = await supabase.rpc('envoyer_message_public', {
    p_tenant_id: publicTenantId,
    p_sujet: sujet,
    p_corps: corps,
    p_nom: nom,
    p_email: email,
    p_order_id: orderId
  })
  if (error) throw new Error(extraitCode(error.message))
  return data
}

// Réponse d'un visiteur connecté dans un fil qui lui appartient.
export async function pubReplyMessage(messageId, corps) {
  const { data, error } = await supabase.rpc('repondre_message_public', {
    p_message_id: messageId,
    p_corps: corps
  })
  if (error) throw new Error(extraitCode(error.message))
  return data
}

// Fils du visiteur connecté, avec leurs échanges (espace client).
export async function pubMyMessages() {
  const { data, error } = await supabase
    .from('messages')
    .select('*, message_replies(*)')
    .order('dernier_message_at', { ascending: false })
  if (error) { console.error('[public] messages', error.message); return [] }
  return data || []
}

// Postgres enrobe nos RAISE EXCEPTION ; on ne garde que le code court.
function extraitCode(msg) {
  const m = String(msg || '').match(/(champs_obligatoires|organisation_indisponible|email_requis|email_invalide|commande_introuvable|trop_de_messages|fil_introuvable)/)
  return m ? m[1] : 'erreur'
}

// ---------- Généalogie ----------
export async function pubPersonnage(id) {
  const { data } = await scoped(supabase.from('personnages').select('*')).eq('id', id).eq('published', true).maybeSingle()
  return data
}

// L'arbre généalogique complet : une lignée de chefs ne change pas d'une
// navigation à l'autre. C'était la dernière page à repayer ses données à
// chaque visite (4,3 s mesurées en ligne le 2026-08-20).
export function pubAllPersonnages() {
  return memo('personnages', async () => {
    const { data } = await scoped(supabase.from('personnages').select('*')).eq('published', true).order('id')
    return data || []
  })
}

// Objets liés à un personnage (avec le type de lien) — « son histoire liée à l'objet »
export async function pubPersonnageObjects(id) {
  const { data } = await scoped(supabase
    .from('object_personnage').select('type_lien, objects(id,nom,photo,description,published)'))
    .eq('personnage_id', id)
  return (data || []).filter((r) => r.objects?.published).map((r) => ({ ...r.objects, relation: r.type_lien }))
}

// Migrations historiques d'un personnage — le déplacement d'une lignée fait
// partie de son récit autant que sa filiation. Si la table n'est pas ouverte au
// public, on renvoie une liste vide plutôt que de casser la fiche.
export async function pubMigrations(personnageId) {
  const { data, error } = await scoped(supabase.from('migrations_historiques').select('*'))
    .eq('personnage_id', personnageId).order('id')
  if (error) { console.error('[public] migrations', error.message); return [] }
  return (data || []).map((r) => ({
    id: r.id, lieuDepart: r.lieu_depart, lieuArrivee: r.lieu_arrivee,
    date: r.date_migration, recit: r.recit
  }))
}

// Chefs/personnages rattachés à un musée (via ses objets publiés)
export async function pubMuseumChefs(museumId) {
  const { objects } = await pubObjectsForMuseum(museumId)
  const ids = objects.map((o) => o.id)
  if (!ids.length) return []
  const { data } = await scoped(supabase
    .from('object_personnage').select('type_lien, personnages(*)')).in('object_id', ids)
  const seen = new Map()
  for (const r of data || []) {
    const p = r.personnages
    if (p?.published && !seen.has(p.id)) seen.set(p.id, { ...p, relation: r.type_lien })
  }
  return [...seen.values()]
}

// Noms d'affichage des institutions. La base ne stocke qu'une clé technique :
// écrire « met » sous une planche du cabinet ne dirait rien à un visiteur.
const MUSEES = {
  met: 'The Metropolitan Museum of Art',
  artic: 'Art Institute of Chicago',
  cleveland: 'Cleveland Museum of Art',
  vam: 'Victoria & Albert Museum',
  wikidata: 'Wikidata',
  europeana: 'Europeana',
  rijksmuseum: 'Rijksmuseum',
  smithsonian: 'Smithsonian',
  harvard: 'Harvard Art Museums'
}

// ---------- Mémoire réunifiée : dispersion publique (Phase 5) ----------
// Ne remonte QUE les correspondances validées par un conservateur (RLS :
// statut = 'valide'). La recherche automatique propose, l'humain décide — et
// seul ce qui a été décidé est montré au public.
export async function pubSiblings(objectId) {
  const { data, error } = await scoped(supabase
    .from('object_siblings')
    .select('id, source, external_id, titre, culture, pays, image_url, source_url, ' +
            'score, type_lien, justification, ' +
            // La carte de profondeur vit sur le catalogue GLOBAL, pas sur le
            // lien : elle est calculée une fois pour toutes les organisations.
            'objets_externes(depth_map_url, amplitude_relief)'))
    .eq('object_id', objectId)
    .order('score', { ascending: false })
  if (error) { console.error('[public] siblings', error.message); return [] }
  return (data || []).map((r) => ({
    id: r.id,
    source: r.source,
    inventaire: r.external_id || '',
    titre: r.titre || '',
    culture: r.culture || '',
    pays: r.pays || '',
    image: r.image_url || '',
    url: r.source_url || '',
    score: r.score,
    // La justification est ce qui distingue une salle de musée d'une grille
    // d'images : elle dit POURQUOI ces deux objets sont côte à côte.
    typeLien: r.type_lien || null,
    justification: r.justification || '',
    // Nom lisible de l'institution, à défaut la clé technique de la source.
    musee: MUSEES[r.source] || r.source,
    // Relief 2.5D. Absent tant que la carte n'a pas été produite : la planche
    // reste alors une image plate, ce qui est le comportement normal.
    profondeur: r.objets_externes?.depth_map_url || '',
    amplitude: r.objets_externes?.amplitude_relief ?? 0.12
  }))
}

// Décompte pour le bandeau public : « N frères dans X pays ».
export async function pubDispersion(objectId) {
  const freres = await pubSiblings(objectId)
  const pays = new Set(freres.map((f) => f.pays).filter(Boolean))
  return { total: freres.length, pays: [...pays], freres }
}

// ---------- Visites immersives (Phase 6) ----------
// Publication en cascade : la RLS ne renvoie une visite que si l'organisation
// est publique, la visite publiée ET le musée publié. Les scènes et points
// chauds suivent la visibilité de leur visite.

const tourFrom = (r) => ({
  id: r.id, museumId: r.museum_id, titre: r.titre, description: r.description || '',
  couverture: r.couverture || '', dureeMin: r.duree_min
})

export async function pubTours(museumId = null) {
  let q = scoped(supabase.from('tours').select('*')).eq('published', true)
  if (museumId != null) q = q.eq('museum_id', museumId)
  const { data, error } = await q.order('id')
  if (error) { console.error('[public] tours', error.message); return [] }
  return (data || []).map(tourFrom)
}

// Visite complète : le parcours, ses salles et tout ce que les points chauds
// désignent — en trois requêtes, pour que la visite démarre sans attente.
export async function pubTour(id) {
  const { data: t } = await scoped(supabase.from('tours').select('*')).eq('id', id).eq('published', true).maybeSingle()
  if (!t) return null

  const { data: rawScenes } = await scoped(supabase
    .from('tour_scenes')
    .select('*, sectors(id, nom, description, histoire, voice_id, ton, timbre_voix, debit)'))
    .eq('tour_id', id).order('ordre').order('id')

  const scenes = (rawScenes || []).map((s) => ({
    id: s.id,
    sectorId: s.sector_id,
    titre: s.titre,
    type: s.type || 'photo360',
    mediaUrl: s.media_url || '',
    ordre: s.ordre ?? 0,
    positionInitiale: s.position_initiale || {},
    // Le secteur n'est joint que s'il est publié (RLS) : il peut être absent.
    secteur: s.sectors
      ? {
          id: s.sectors.id, nom: s.sectors.nom, description: s.sectors.description || '',
          histoire: s.sectors.histoire || '', voiceId: s.sectors.voice_id || null,
          ton: s.sectors.ton || 'neutre', timbreVoix: s.sectors.timbre_voix || 'standard',
          debit: s.sectors.debit == null ? 1 : Number(s.sectors.debit)
        }
      : null
  }))

  const ids = scenes.map((s) => s.id)
  let hotspots = []
  if (ids.length) {
    const { data: raw } = await scoped(supabase
      .from('scene_hotspots')
      .select(`*,
        objects(id, nom, nom_commun, photo, description, model3d, model3d_ios,
                ar_placement, ar_echelle, ar_seulement, ar_scale, ar_xr_environment,
                ar_shadow_intensity, ar_shadow_softness, ar_exposure,
                ar_camera_orbit, ar_min_orbit, ar_max_orbit,
                ar_interpolation_decay, ar_annotations, sector_id, published),
        personnages(id, nom, prenom, titre, portrait, regne_debut, regne_fin, published)`))
      .in('scene_id', ids).order('id')

    hotspots = (raw || []).map((h) => ({
      id: h.id, sceneId: h.scene_id, type: h.type || 'objet',
      libelle: h.libelle || '', texte: h.texte || '',
      x: Number(h.x) || 0, y: Number(h.y) || 0,
      sceneCibleId: h.scene_cible_id,
      objet: h.objects?.published ? h.objects : null,
      personnage: h.personnages?.published ? h.personnages : null
    }))
    // Un point chaud dont la cible n'est plus publiée ne mène nulle part :
    // on le retire plutôt que d'offrir une pastille morte au visiteur.
    hotspots = hotspots.filter((h) =>
      (h.type === 'objet' && h.objet) ||
      (h.type === 'personnage' && h.personnage) ||
      (h.type === 'navigation' && ids.includes(h.sceneCibleId)) ||
      (h.type === 'info' && h.texte)
    )
  }

  return { ...tourFrom(t), scenes, hotspots }
}

// ————— Adhésions visiteur (V2 Phase 1) —————
// Rattache le visiteur connecté à l'organisation du site consulté (idempotent côté RPC).
// `source` trace l'origine de l'adhésion (site, panier, campagne…).
export async function joinTenant(tenantId, source = 'site') {
  if (tenantId == null) return { ok: false, reason: 'no_tenant' }
  const { data, error } = await supabase.rpc('join_tenant', { p_tenant_id: tenantId, p_source: source })
  if (error) return { ok: false, reason: error.message }
  const row = Array.isArray(data) ? data[0] : data
  return { ok: !!row?.ok, reason: row?.reason || null }
}

// Organisations auxquelles le visiteur connecté adhère.
export async function myMemberships() {
  const { data, error } = await supabase.rpc('my_memberships')
  if (error) { console.error('[memberships]', error.message); return [] }
  return (data || []).map((r) => ({
    tenantId: r.tenant_id, slug: r.slug, nom: r.nom, logo: r.logo,
    role: r.role, accepteEmails: r.accepte_emails, depuis: r.depuis
  }))
}

// ————— Rareté d'une œuvre (Mémoire Réunifiée) —————
// Moins une œuvre a de frères recensés dans le monde, plus elle est rare.
// La vue `object_rarity` applique la RLS de l'appelant : un visiteur ne compte
// que les correspondances validées d'objets publiés.
export async function pubObjectRarity(objectId) {
  const { data, error } = await supabase
    .from('object_rarity').select('*').eq('object_id', objectId).maybeSingle()
  if (error) { console.warn('[rarete]', error.message); return null }
  return data && {
    nbFreres: data.nb_freres, nbPays: data.nb_pays,
    niveau: data.niveau, score: data.score_rarete
  }
}

// Rareté de plusieurs œuvres en UNE requête (catalogue, accueil) : évite le N+1.
export async function pubRarityFor(objectIds) {
  const ids = (objectIds || []).filter((i) => i != null)
  if (!ids.length) return {}
  const { data, error } = await supabase
    .from('object_rarity').select('*').in('object_id', ids)
  if (error) { console.warn('[rarete]', error.message); return {} }
  const map = {}
  for (const r of data || []) {
    map[r.object_id] = { nbFreres: r.nb_freres, nbPays: r.nb_pays, niveau: r.niveau, score: r.score_rarete }
  }
  return map
}

// ————— Parcours musée → secteur → objets —————
// Le visiteur entre dans un musée, choisit une salle, et n'y voit que SES œuvres.
// La cascade de publication s'applique : la salle n'existe pour le public que si
// le musée est publié, et l'œuvre que si sa salle l'est.
export async function pubSector(id) {
  const { data, error } = await scoped(
    supabase.from('sectors').select('*, museums(id, nom, published)')
  ).eq('id', id).eq('published', true).maybeSingle()
  if (error) { console.error('[public] secteur', error.message); return null }
  if (!data || !data.museums?.published) return null
  return data
}

export async function pubObjectsForSector(sectorId) {
  const { data, error } = await scoped(supabase.from('objects').select(COLONNES_LISTE))
    .eq('sector_id', sectorId).eq('published', true).order('id')
  if (error) { console.error('[public] objets du secteur', error.message); return [] }
  return data || []
}

// Nombre d'œuvres par salle, en UNE requête : la fiche musée annonce ainsi
// « 4 œuvres » sur chaque carte sans déclencher un appel par salle (N+1).
export async function pubObjectCountBySector(sectorIds) {
  const ids = (sectorIds || []).filter((i) => i != null)
  if (!ids.length) return {}
  const { data, error } = await scoped(supabase.from('objects').select('id, sector_id'))
    .in('sector_id', ids).eq('published', true)
  if (error) { console.error('[public] comptage', error.message); return {} }
  const map = {}
  for (const o of data || []) map[o.sector_id] = (map[o.sector_id] || 0) + 1
  return map
}

// ————— Consultations (mise en avant automatique) —————
// Enregistrement silencieux : une mesure d'audience ne doit jamais faire échouer
// l'affichage d'une fiche. En cas d'erreur, on se tait.
export async function marquerVue(objectId) {
  if (!objectId) return
  try { await supabase.rpc('vue_oeuvre', { p_object_id: objectId }) } catch { /* sans effet */ }
}

// Œuvres les plus consultées. `museumId` null = tous les musées de l'organisation.
//
// Le cloisonnement passe ici par un ARGUMENT et non par scoped() : une RPC ne
// se filtre pas avec .eq(). Sans lui, l'accueil d'une chefferie mettrait en
// avant les œuvres d'une autre — la RPC ne connaît pas l'organisation affichée.
// `tenantId` explicite (l'ERP passe la sienne) sinon celle du site en cours.
export async function oeuvresPopulaires(museumId = null, jours = 30, limite = 6, tenantId = undefined) {
  const { data, error } = await supabase.rpc('oeuvres_populaires', {
    p_museum_id: museumId,
    p_jours: jours,
    p_limite: limite,
    p_tenant_id: tenantId === undefined ? publicTenantId : tenantId
  })
  if (error) { console.warn('[populaires]', error.message); return [] }
  return (data || []).map((o) => ({
    id: o.object_id, nom: o.nom, photo: o.photo,
    musee: o.musee, museumId: o.museum_id, vues: Number(o.vues)
  }))
}
