import { supabase } from './supabase'
import { currentTenantId } from './tenant'

// ============================================================================
// PHOTOGRAMMÉTRIE — campagne de prises de vue d'un objet.
// ----------------------------------------------------------------------------
// Ce module gère la CAPTURE et son acheminement. La reconstruction 3D est faite
// par un moteur externe (GPU nécessaire) : voir la migration 20260810.
//
// DEUX PARTIS PRIS, tirés de pièges déjà rencontrés sur ce projet :
//
// 1. AUCUNE URL `blob:` N'ENTRE EN BASE. Une URL d'objet local meurt au
//    rechargement de la page ; c'est ce qui avait rendu la 3D et l'AR
//    inopérantes. Les photos sont téléversées vers le Storage, et c'est le
//    CHEMIN qui est enregistré — jamais une référence mémoire.
//
// 2. LE COMPTEUR EST TENU PAR LA BASE. Un téléversement peut être interrompu
//    (réseau, écran verrouillé, onglet fermé). Compter côté navigateur
//    donnerait un total optimiste ; un trigger recompte donc à chaque cliché
//    reçu, et c'est ce chiffre qui autorise ou non la mise en file.
// ============================================================================

const BUCKET = 'captures'

// Répartition visée sur les trois orbites. Le total dépasse volontairement 50 :
// quelques clichés seront rejetés pour flou, et une campagne juste au seuil
// échouerait à la première photo écartée.
export const PLAN_ORBITES = [
  { cle: 'basse', cible: 20, elevation: '-20°' },
  { cle: 'mediane', cible: 20, elevation: '0°' },
  { cle: 'haute', cible: 16, elevation: '+35°' }
]

export const TOTAL_VISE = PLAN_ORBITES.reduce((n, o) => n + o.cible, 0)

// Formats proposés. glb et usdz couvrent l'affichage ; obj et ply servent
// à l'archivage et aux logiciels de retouche, qui ne lisent pas tous le glTF.
export const FORMATS = [
  { cle: 'glb', label: 'GLB', note: 'Android, navigateurs, model-viewer' },
  { cle: 'usdz', label: 'USDZ', note: 'iPhone / iPad — Quick Look' },
  { cle: 'obj', label: 'OBJ', note: 'archivage, logiciels de retouche' },
  { cle: 'ply', label: 'PLY', note: 'nuage de points brut, recherche' }
]

// ---------------------------------------------------------------------------
// Cycle de vie d'une campagne
// ---------------------------------------------------------------------------

export async function creerCampagne({ objectId, formats = ['glb', 'usdz'], note = '' }) {
  const { data: session } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('photogrammetry_jobs').insert({
    tenant_id: currentTenantId(),
    object_id: objectId,
    formats,
    note: note || null,
    operateur: session?.user?.id ?? null
  }).select().single()
  if (error) throw error
  return depuisLigne(data)
}

export async function campagnes(objectId) {
  const { data, error } = await supabase.from('photogrammetry_jobs')
    .select('*').eq('object_id', objectId).order('created_at', { ascending: false })
  if (error) { console.warn('[photogrammetrie] campagnes', error.message); return [] }
  return data.map(depuisLigne)
}

export async function campagne(jobId) {
  const { data, error } = await supabase.from('photogrammetry_jobs')
    .select('*').eq('id', jobId).maybeSingle()
  if (error) { console.warn('[photogrammetrie] campagne', error.message); return null }
  return data ? depuisLigne(data) : null
}

// Répartition réelle des clichés par orbite : c'est ce qui dit à l'opérateur
// quel tour il lui reste à faire.
export async function repartition(jobId) {
  const { data, error } = await supabase.from('photogrammetry_shots')
    .select('orbite').eq('job_id', jobId)
  if (error) { console.warn('[photogrammetrie] repartition', error.message); return {} }
  const parOrbite = {}
  for (const s of data) parOrbite[s.orbite] = (parOrbite[s.orbite] || 0) + 1
  return parOrbite
}

// Téléverse un cliché puis l'enregistre. L'ordre compte : si l'écriture en base
// échoue, on retire le fichier, sinon le bucket se remplirait d'orphelins
// invisibles depuis l'application.
export async function ajouterCliche(jobId, { blob, orbite, indice, nettete, largeur, hauteur }) {
  const tenant = currentTenantId()
  if (tenant == null) throw new Error('organisation_inconnue')

  // Le premier segment porte l'organisation : c'est sur lui que repose la
  // politique d'accès du bucket (voir prefixe_tenant en base).
  const chemin = `${tenant}/${jobId}/${orbite}-${String(indice).padStart(3, '0')}.jpg`

  const { error: eUp } = await supabase.storage.from(BUCKET).upload(chemin, blob, {
    contentType: 'image/jpeg',
    upsert: true
  })
  if (eUp) throw new Error(`televersement: ${eUp.message}`)

  const { error: eDb } = await supabase.from('photogrammetry_shots').insert({
    job_id: jobId, orbite, indice, chemin,
    nettete: nettete ?? null, largeur: largeur ?? null, hauteur: hauteur ?? null
  })
  if (eDb) {
    await supabase.storage.from(BUCKET).remove([chemin]).catch(() => {})
    throw new Error(`enregistrement: ${eDb.message}`)
  }
  return chemin
}

// Met la campagne en file. La base refuse en deçà du minimum : on remonte son
// message tel quel, il nomme le nombre manquant.
export async function soumettre(jobId) {
  const { data, error } = await supabase.rpc('photogrammetry_soumettre', { p_job_id: jobId })
  if (error) return { ok: false, error: lisible(error.message) }
  return { ok: true, ...(data || {}) }
}

export async function supprimerCampagne(jobId) {
  const tenant = currentTenantId()
  // Les fichiers ne partent pas en cascade avec la ligne : on vide le dossier
  // d'abord, sinon le bucket conserve des clichés que plus rien ne référence.
  const { data: fichiers } = await supabase.storage.from(BUCKET).list(`${tenant}/${jobId}`)
  if (fichiers?.length) {
    await supabase.storage.from(BUCKET)
      .remove(fichiers.map((f) => `${tenant}/${jobId}/${f.name}`))
      .catch(() => {})
  }
  const { error } = await supabase.from('photogrammetry_jobs').delete().eq('id', jobId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// TRAITEMENT MANUEL — récupérer les photos, déposer le modèle reconstruit.
//
// Le bucket `captures` est privé : on ne peut pas en donner l'URL directement.
// On signe donc des liens temporaires. Une heure suffit largement à lancer un
// téléchargement, et un lien qui expire ne traîne pas dans un historique.
// ---------------------------------------------------------------------------
const DUREE_LIEN = 3600

export async function liensPhotos(jobId) {
  const { data: shots, error } = await supabase.from('photogrammetry_shots')
    .select('chemin, orbite, indice').eq('job_id', jobId).order('orbite').order('indice')
  if (error) throw error
  if (!shots?.length) return []

  const { data, error: eSign } = await supabase.storage.from(BUCKET)
    .createSignedUrls(shots.map((s) => s.chemin), DUREE_LIEN)
  if (eSign) throw eSign

  return (data || [])
    .filter((d) => d.signedUrl)
    .map((d, i) => ({
      url: d.signedUrl,
      nom: `${shots[i].orbite}-${String(shots[i].indice).padStart(3, '0')}.jpg`
    }))
}

// Dépose un modèle reconstruit et le rattache à l'objet.
// `MIME` explicite : un .glb envoyé en `application/octet-stream` serait refusé
// par certains navigateurs à la lecture, et .usdz n'a pas de type standard fiable.
const MIME = {
  glb: 'model/gltf-binary',
  usdz: 'model/vnd.usdz+zip',
  obj: 'application/octet-stream'
}

export async function deposerModele(jobId, objectId, format, fichier) {
  const tenant = currentTenantId()
  if (tenant == null) throw new Error('organisation_inconnue')

  const chemin = `${tenant}/${objectId}/modele-${jobId}.${format}`
  const { error: eUp } = await supabase.storage.from('modeles').upload(chemin, fichier, {
    contentType: MIME[format] || 'application/octet-stream',
    upsert: true
  })
  if (eUp) throw new Error(`televersement: ${eUp.message}`)

  const { data: pub } = supabase.storage.from('modeles').getPublicUrl(chemin)
  const url = pub?.publicUrl
  if (!url) throw new Error('url_publique_absente')

  // On renseigne la colonne QUE lit l'appareil concerné : iOS ne lira jamais un
  // .glb, Android ne lira jamais un .usdz. Se tromper de colonne rendrait la
  // visualisation muette sur la moitié du parc.
  const majObjet = {}
  if (format === 'glb') { majObjet.model3d = url; majObjet.model3d_name = `modele-${jobId}.glb` }
  if (format === 'usdz') { majObjet.model3d_ios = url; majObjet.model3d_ios_name = `modele-${jobId}.usdz` }
  if (Object.keys(majObjet).length) {
    const { error } = await supabase.from('objects').update(majObjet).eq('id', objectId)
    if (error) throw error
  }

  const champ = { glb: 'resultat_glb', usdz: 'resultat_usdz', obj: 'resultat_obj' }[format]
  const majJob = { [champ]: url, moteur: 'manuel' }
  const { error: eJob } = await supabase.from('photogrammetry_jobs')
    .update(majJob).eq('id', jobId)
  if (eJob) throw eJob

  return url
}

// Clôture la campagne. La contrainte en base refuse « terminé » sans modèle :
// on remonte donc son refus plutôt que de prétendre au succès.
export async function cloturer(jobId) {
  const { error } = await supabase.from('photogrammetry_jobs')
    .update({ statut: 'termine', finished_at: new Date().toISOString() })
    .eq('id', jobId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// NETTETÉ — variance du laplacien.
//
// Une photo floue ne dégrade pas « un peu » la reconstruction : elle fausse
// l'appariement des points saillants et peut faire échouer toute la campagne.
// Mieux vaut la rejeter à la prise de vue, quand refaire le cliché ne coûte
// qu'un geste, que de le découvrir après le calcul.
//
// On travaille sur une image réduite : la mesure est stable et vingt fois plus
// rapide qu'en pleine résolution.
//
// ATTENTION — le seuil dépend de l'appareil, de l'éclairage et de la matière de
// l'objet. Celui d'un masque en bois mat n'est pas celui d'une perle brillante.
// Le composant affiche donc la valeur en direct et laisse l'opérateur ajuster,
// plutôt que d'imposer un chiffre qui serait faux la moitié du temps.
// ---------------------------------------------------------------------------
const LARGEUR_ANALYSE = 320

export function mesurerNettete(source, largeurSource, hauteurSource) {
  const ratio = LARGEUR_ANALYSE / largeurSource
  const w = LARGEUR_ANALYSE
  const h = Math.max(1, Math.round(hauteurSource * ratio))

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, w, h)

  const { data } = ctx.getImageData(0, 0, w, h)

  // Niveaux de gris (luminance perceptuelle : le vert pèse le plus).
  const gris = new Float32Array(w * h)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gris[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }

  // Laplacien 4-voisins. On calcule la moyenne et la variance en une passe.
  let somme = 0
  let sommeCarres = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const lap = gris[i - 1] + gris[i + 1] + gris[i - w] + gris[i + w] - 4 * gris[i]
      somme += lap
      sommeCarres += lap * lap
      n++
    }
  }
  if (!n) return 0
  const moyenne = somme / n
  return Math.max(0, sommeCarres / n - moyenne * moyenne)
}

// ---------------------------------------------------------------------------
const depuisLigne = (r) => ({
  id: r.id,
  objectId: r.object_id,
  statut: r.statut,
  formats: r.formats || [],
  nbPhotos: r.nb_photos ?? 0,
  nbPhotosMin: r.nb_photos_min ?? 50,
  moteur: r.moteur,
  note: r.note,
  erreur: r.erreur,
  resultatGlb: r.resultat_glb,
  resultatUsdz: r.resultat_usdz,
  resultatObj: r.resultat_obj,
  createdAt: r.created_at,
  finishedAt: r.finished_at
})

// Les erreurs de la base arrivent enrobées ; on ne garde que le message utile.
function lisible(msg) {
  const m = String(msg || '').match(/photos_insuffisantes:[^"]*/)
  if (m) return m[0]
  if (String(msg).includes('travail_introuvable')) return 'travail_introuvable'
  return String(msg || 'erreur')
}
