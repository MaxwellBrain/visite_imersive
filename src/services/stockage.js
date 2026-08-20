import { supabase } from './supabase'
import { currentTenantId } from './tenant'

// ============================================================================
// TÉLÉVERSEMENT DES MÉDIAS vers le Storage.
// ----------------------------------------------------------------------------
// POURQUOI CE MODULE
// Photos et modèles 3D étaient enregistrés en DATA URL base64, directement dans
// les colonnes. Ils étaient donc relus à CHAQUE requête, y compris par des
// écrans n'affichant qu'un titre. Mesuré le 2026-08-19 : un objet pesait 2,72 Mo
// et sa fiche publique mettait 12 s à s'afficher.
//
// Ici on dépose le fichier dans un bucket et on ne garde que son URL. Le média
// est alors servi par le CDN, avec son cache, et la ligne redevient légère.
//
// LE CHEMIN COMMENCE PAR L'ORGANISATION — `<tenant>/<uuid>.<ext>` — parce que
// c'est ce préfixe que lisent les politiques d'accès du Storage
// (`public.prefixe_tenant`). Un chemin qui ne le respecterait pas serait refusé
// à l'écriture.
//
// POURQUOI UN UUID ET PAS L'IDENTIFIANT DE L'OBJET : au moment où l'on choisit
// une image, un objet NOUVEAU n'a pas encore d'identifiant — il n'existera
// qu'à l'enregistrement. Un nom aléatoire évite ce problème, et évite aussi
// qu'un second envoi n'écrase silencieusement le premier.
// ============================================================================

const EXT_PAR_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'model/gltf-binary': 'glb', 'model/vnd.usdz+zip': 'usdz'
}

function extension(fichier, defaut = 'bin') {
  const parNom = (fichier.name || '').split('.').pop()?.toLowerCase()
  if (parNom && parNom.length <= 5 && /^[a-z0-9]+$/.test(parNom)) return parNom
  return EXT_PAR_MIME[fichier.type] || defaut
}

function identifiant() {
  // `randomUUID` n'existe pas hors contexte sécurisé (http:// autre que
  // localhost) ; le repli garde le module utilisable en développement.
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Dépose un fichier et renvoie son URL publique.
 * Lève une erreur explicite : l'appelant décide s'il se rabat sur le base64.
 */
export async function televerser(fichier, bucket, { extensionForcee = null } = {}) {
  const tenant = currentTenantId()
  if (tenant == null) throw new Error('organisation_inconnue')

  const ext = extensionForcee || extension(fichier)
  const chemin = `${tenant}/${identifiant()}.${ext}`

  const { error } = await supabase.storage.from(bucket).upload(chemin, fichier, {
    contentType: fichier.type || EXT_PAR_MIME[ext] || 'application/octet-stream',
    // Le nom étant aléatoire, une collision n'arrive pas : `upsert` ne sert
    // qu'à rendre un réessai inoffensif après une coupure.
    upsert: true
  })
  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from(bucket).getPublicUrl(chemin)
  if (!data?.publicUrl) throw new Error('url_publique_absente')
  return data.publicUrl
}

/**
 * Supprime un média dont on ne garde plus l'URL.
 * Silencieux à dessein : un fichier déjà absent, ou une URL qui ne vient pas de
 * nos buckets, ne doit pas faire échouer l'enregistrement d'une fiche.
 */
export async function supprimerParUrl(url, bucket) {
  if (typeof url !== 'string') return
  const marque = `/storage/v1/object/public/${bucket}/`
  const i = url.indexOf(marque)
  if (i === -1) return
  const chemin = decodeURIComponent(url.slice(i + marque.length).split('?')[0])
  await supabase.storage.from(bucket).remove([chemin]).catch(() => {})
}

// Vrai si la valeur est déjà une URL de Storage — sert à distinguer un média
// déjà migré d'une DATA URL héritée.
export function estUrlStockage(valeur) {
  return typeof valeur === 'string' && /^https?:\/\/.+\/storage\/v1\/object\/public\//.test(valeur)
}
