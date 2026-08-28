import { supabase } from './supabase'
import { getPublicTenant } from './publicApi'

// ACCÈS AUX DONNÉES DU GUIDE SPECTRAL — lecture seule, contenu publié.
//
// Trois responsabilités, et elles se tiennent :
//   1. charger une scène complète en UN aller-retour logique (scène + points +
//      récits publiés + configuration de l'avatar) ;
//   2. la garder disponible HORS LIGNE — une visite en cour de chefferie se
//      fait rarement sous une bonne couverture réseau ;
//   3. journaliser ce qui sert au conservateur, jamais ce qui identifie un
//      visiteur.
//
// CLOISONNEMENT. Comme pour le guide textuel (`guideAgent.js`), la RLS distingue
// « publié » de « non publié », pas « chez moi » de « chez le voisin » : sans le
// filtre `tenant_id` explicite, un visiteur de la chefferie A verrait la case de
// la chefferie B. Le filtre est donc posé ici, en plus de la politique.

const scoped = (q) => {
  const t = getPublicTenant()
  return t == null ? q : q.eq('tenant_id', t)
}

// Cache hors ligne. Deux étages, pour deux natures de données :
//   — les métadonnées (JSON, quelques kilo-octets) vont dans localStorage ;
//   — les modèles et l'audio (méga-octets) vont dans le Cache Storage, seul
//     magasin du navigateur dimensionné pour ça.
const CLE_CACHE = 'musea:spectral:v1'
const NOM_CACHE = 'musea-spectral-v1'

function lireCache(sceneId) {
  try {
    const brut = localStorage.getItem(`${CLE_CACHE}:${sceneId}`)
    if (!brut) return null
    const { pose, donnees } = JSON.parse(brut)
    // Sept jours : au-delà, une notice corrigée à l'ERP resterait invisible
    // trop longtemps. En deçà, on ne rappelle pas le réseau pour rien.
    if (Date.now() - pose > 7 * 24 * 3600 * 1000) return null
    return donnees
  } catch { return null }
}

function ecrireCache(sceneId, donnees) {
  try {
    localStorage.setItem(`${CLE_CACHE}:${sceneId}`, JSON.stringify({ pose: Date.now(), donnees }))
  } catch { /* quota plein : la visite marche encore, simplement en ligne */ }
}

// La scene immersive attachee a un objet du catalogue, s'il en existe une.
//
// C'est ce lien qui fait basculer la fiche de « poser l'objet devant soi » a
// « entrer dans la case » : une enveloppe de vingt metres ne se pose pas sur
// une table, elle se traverse. Rend null quand l'objet n'est qu'un objet.
export async function sceneArPourObjet(objectId) {
  const id = Number(objectId)
  if (!Number.isFinite(id)) return null
  const { data } = await scoped(supabase.from('ar_scenes').select('id, titre, emprise_m'))
    .eq('object_id', id).eq('published', true).maybeSingle()
  return data || null
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------
export async function chargerScene(sceneId) {
  const id = Number(sceneId)

  const { data: s } = await scoped(supabase.from('ar_scenes').select('*'))
    .eq('id', id).eq('published', true).maybeSingle()
  if (!s) {
    // Hors ligne : la scène est peut-être déjà en poche.
    const cache = lireCache(id)
    if (cache) return { ...cache, horsLigne: true }
    return null
  }

  const { data: pts } = await scoped(supabase.from('ar_hotspots').select('*'))
    .eq('scene_id', id).order('priorite').order('id')

  const ids = (pts || []).map((p) => p.id)
  let recits = []
  if (ids.length) {
    // `statut = 'publie'` est déjà imposé par la RLS ; on le répète pour que le
    // site reste identique quand un membre du personnel le consulte connecté.
    const { data } = await scoped(supabase.from('ar_recits')
      .select('id, hotspot_id, lang, variante, texte, duree_s, audio_url'))
      .in('hotspot_id', ids).eq('statut', 'publie').order('variante')
    recits = data || []
  }

  const { data: av } = await scoped(supabase.from('ar_avatar_configs').select('*'))
    .eq('museum_id', s.museum_id).eq('published', true).maybeSingle()

  const donnees = {
    scene: {
      id: s.id,
      museumId: s.museum_id,
      sectorId: s.sector_id,
      titre: s.titre,
      description: s.description || '',
      archetype: s.archetype,
      modeleUrl: s.modele_url || '',
      modeleIosUrl: s.modele_ios_url || '',
      modeleOctets: s.modele_octets || 0,
      echelle: Number(s.echelle) || 1,
      empriseM: Number(s.emprise_m) || 6,
      hauteurM: Number(s.hauteur_m) || 4.5,
      orientationDeg: Number(s.orientation_deg) || 0
    },
    hotspots: (pts || []).map((p) => ({
      id: p.id,
      code: p.code,
      libelle: p.libelle,
      objectId: p.object_id,
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      z: Number(p.z) || 0,
      rayon: Number(p.rayon) || 0.45,
      poseAvatar: p.pose_avatar || { dx: 0.9, dz: 0.7 },
      priorite: p.priorite ?? 0
    })),
    recits: recits.map((r) => ({
      id: r.id,
      hotspotId: r.hotspot_id,
      lang: r.lang,
      variante: r.variante,
      texte: r.texte,
      dureeS: r.duree_s,
      audioUrl: r.audio_url || null
    })),
    avatar: avatarDepuis(av)
  }

  ecrireCache(id, donnees)
  return donnees
}

// Configuration de repli quand aucune n'a été publiée. Elle reproduit
// exactement les valeurs par défaut de la table : le guide se comporte de la
// même façon avec ou sans réglage, ce qui rend la mise en service progressive.
function avatarDepuis(av) {
  return {
    nom: av?.nom || 'Guide',
    modeleUrl: av?.modele_url || '',
    echelle: Number(av?.echelle) || 1,
    opacite: av?.opacite != null ? Number(av.opacite) : 0.55,
    teinte: av?.teinte || '#9fe8d4',
    voixProvider: av?.voix_provider || 'browser',
    voixId: av?.voix_id || null,
    debit: av?.debit != null ? Number(av.debit) : 0.95,
    salutation: av?.salutation || 'Bienvenue. Je suis là si tu veux comprendre ce que tu vois. Prends ton temps.',
    // ---- Parole en direct ---------------------------------------------------
    // La valeur par défaut est `true` : un musée qui n'a rien réglé a un guide
    // qui improvise, et retombe tout seul sur ses textes relus si Bedrock
    // manque. Couper l'improvisation est une décision, pas un oubli.
    improvisation: av?.improvisation !== false,
    questionsOuvertes: av?.questions_ouvertes !== false,
    persona: av?.persona || '',
    modele: av?.modele || 'equilibre',
    // Le moteur et la machine à états parlent en millisecondes / mètres ; la
    // base parle en secondes pour rester lisible dans l'éditeur SQL. La
    // conversion se fait ICI, une seule fois, et pas dans la boucle de rendu.
    delaiApparitionMs: av?.delai_apparition_ms ?? 3000,
    salutationMaxS: av?.salutation_max_s ?? 10,
    distanceMinM: av?.distance_min_m != null ? Number(av.distance_min_m) : 1.5,
    distanceMaxM: av?.distance_max_m != null ? Number(av.distance_max_m) : 2.0,
    decalageLateralDeg: av?.decalage_lateral_deg != null ? Number(av.decalage_lateral_deg) : 32,
    fixationMs: av?.fixation_ms ?? 2000,
    silenceContemplatifS: av?.silence_contemplatif_s ?? 6,
    relanceStagnationS: av?.relance_stagnation_s ?? 12
  }
}

// ---------------------------------------------------------------------------
// Sélection du récit
// ---------------------------------------------------------------------------
// Rend la fonction `recitPour(hotspotId, fois)` que consomment la machine à
// états et le moteur. `fois` est le nombre de passages déjà effectués sur ce
// point : on sert la variante suivante, en boucle. Un visiteur qui revient au
// foyer entend autre chose — c'est ce qui distingue un guide d'une borne audio.
export function fabriquerSelecteurRecits(recits, lang = 'fr') {
  const parPoint = new Map()
  for (const r of recits) {
    if (r.lang !== lang) continue
    if (!parPoint.has(r.hotspotId)) parPoint.set(r.hotspotId, [])
    parPoint.get(r.hotspotId).push(r)
  }
  for (const liste of parPoint.values()) liste.sort((a, b) => a.variante - b.variante)

  return (hotspotId, fois = 0) => {
    const liste = parPoint.get(hotspotId)
    if (!liste || !liste.length) return null
    return liste[fois % liste.length]
  }
}

// ---------------------------------------------------------------------------
// Préchargement hors ligne
// ---------------------------------------------------------------------------
// Appelé depuis la fiche de la visite, AVANT d'entrer dans la case : « préparer
// la visite hors connexion ». On met en cache le modèle du bâtiment, celui de
// l'avatar et les pistes audio des récits publiés. Les textes, eux, sont déjà
// dans le cache JSON — le mode sous-titres survit donc même si l'audio manque.
export async function precharger(donnees, onProgression = () => {}) {
  if (typeof caches === 'undefined') return { ok: false, raison: 'Cache Storage indisponible' }
  const cache = await caches.open(NOM_CACHE)

  const urls = [
    donnees.scene.modeleUrl,
    donnees.avatar.modeleUrl,
    ...donnees.recits.map((r) => r.audioUrl)
  ].filter(Boolean)

  let faits = 0
  for (const url of urls) {
    try {
      // `cache.add` refait la requête même si l'entrée existe ; on vérifie donc
      // d'abord. Sur une connexion mobile, retélécharger 40 Mo de modèle parce
      // que le visiteur a rouvert la page serait impardonnable.
      const dejaLa = await cache.match(url)
      if (!dejaLa) await cache.add(url)
    } catch { /* une pièce manquante ne doit pas annuler tout le préchargement */ }
    faits += 1
    onProgression({ faits, total: urls.length })
  }
  return { ok: true, faits, total: urls.length }
}

export async function estPrechargee(donnees) {
  if (typeof caches === 'undefined') return false
  try {
    const cache = await caches.open(NOM_CACHE)
    const url = donnees?.scene?.modeleUrl
    return url ? !!(await cache.match(url)) : false
  } catch { return false }
}

// ---------------------------------------------------------------------------
// Télémétrie
// ---------------------------------------------------------------------------
// Anonyme et jamais bloquante : un journal ne doit pas gêner un visiteur.
// L'identifiant de séance est tiré dans le navigateur et n'est rattaché à
// aucun compte — il sert à recoudre les événements d'UNE visite, rien de plus.
let sessionId = null
function idSeance() {
  if (sessionId) return sessionId
  sessionId = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`)
  return sessionId
}

const FILE = []
let minuterieEnvoi = null

export function tracer(sceneId, type, valeur = {}, hotspotId = null) {
  FILE.push({
    scene_id: Number(sceneId),
    hotspot_id: hotspotId,
    session: idSeance(),
    type,
    valeur
  })
  // On envoie par paquets. Un `insert` par fixation ferait plusieurs dizaines
  // de requêtes par minute pendant que le téléphone essaie de tenir 30 im/s.
  if (!minuterieEnvoi) minuterieEnvoi = setTimeout(viderFile, 5000)
  if (FILE.length >= 25) viderFile()
}

export function viderFile() {
  clearTimeout(minuterieEnvoi)
  minuterieEnvoi = null
  if (!FILE.length) return
  const lot = FILE.splice(0, FILE.length)
  supabase.from('ar_events').insert(lot).then(() => {}, () => { /* jamais bloquant */ })
}
