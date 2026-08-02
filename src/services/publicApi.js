import { supabase } from './supabase'

// Accès en LECTURE au contenu PUBLIÉ uniquement (filtre explicite en plus de la RLS,
// pour que le site public reste identique même si un membre du staff est connecté).
//
// MULTI-TENANT : le site public affiche UNE organisation à la fois. Le layout
// résout l'adresse (/c/:slug ou domaine personnalisé) puis appelle setPublicTenant().
// Tant qu'aucune organisation n'est fixée, on ne filtre pas (site historique).

let publicTenantId = null
export function setPublicTenant(id) { publicTenantId = id ?? null }
export function getPublicTenant() { return publicTenantId }

// Restreint une requête à l'organisation affichée.
function scoped(q) {
  return publicTenantId == null ? q : q.eq('tenant_id', publicTenantId)
}

export async function pubMuseums() {
  const { data, error } = await scoped(supabase.from('museums').select('*')).eq('published', true).order('id')
  if (error) console.error('[public] museums', error.message)
  return data || []
}

export async function pubMuseum(id) {
  const { data } = await scoped(supabase.from('museums').select('*')).eq('id', id).eq('published', true).maybeSingle()
  return data
}

export async function pubSectors(museumId) {
  const { data } = await scoped(supabase.from('sectors').select('*'))
    .eq('museum_id', museumId).eq('published', true).order('id')
  return data || []
}

export async function pubObjectsForMuseum(museumId) {
  const sectors = await pubSectors(museumId)
  const ids = sectors.map((s) => s.id)
  if (!ids.length) return { sectors, objects: [] }
  const { data } = await scoped(supabase.from('objects').select('*')).in('sector_id', ids).eq('published', true).order('id')
  return { sectors, objects: data || [] }
}

export async function pubObject(id) {
  const { data } = await scoped(supabase.from('objects').select('*, sectors(museum_id)'))
    .eq('id', id).eq('published', true).maybeSingle()
  return data
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

export async function pubPlans() {
  const { data } = await scoped(supabase.from('subscription_plans').select('*')).eq('actif', true).order('prix')
  return data || []
}

export async function pubDonationTiers() {
  const { data } = await scoped(supabase.from('donation_tiers').select('*')).order('montant')
  return data || []
}

export async function pubObjectChefs(objectId) {
  const { data } = await scoped(supabase
    .from('object_personnage')
    .select('type_lien, personnages(*)'))
    .eq('object_id', objectId)
  return (data || []).filter((r) => r.personnages && r.personnages.published)
}

export async function pubFeaturedObjects(limit = 6) {
  const { data } = await scoped(supabase.from('objects').select('*')).eq('published', true)
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
export async function pubBoutiques() {
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

// ---------- Généalogie ----------
export async function pubPersonnage(id) {
  const { data } = await scoped(supabase.from('personnages').select('*')).eq('id', id).eq('published', true).maybeSingle()
  return data
}

export async function pubAllPersonnages() {
  const { data } = await scoped(supabase.from('personnages').select('*')).eq('published', true).order('id')
  return data || []
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

// ---------- Mémoire réunifiée : dispersion publique (Phase 5) ----------
// Ne remonte QUE les correspondances validées par un conservateur (RLS :
// statut = 'valide'). La recherche automatique propose, l'humain décide — et
// seul ce qui a été décidé est montré au public.
export async function pubSiblings(objectId) {
  const { data, error } = await scoped(supabase
    .from('object_siblings')
    .select('id, source, external_id, titre, culture, pays, image_url, source_url, score'))
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
    score: r.score
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
                ar_placement, ar_echelle, sector_id, published),
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
