import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/services/supabase'
import { scopeToTenant } from '@/services/tenant'

const today = () => new Date().toISOString().slice(0, 10)

const fromRow = (r) => ({
  id: r.id,
  sectorId: r.sector_id,
  nom: r.nom,
  nomCommun: r.nom_commun,
  description: r.description,
  photo: r.photo,
  photoThumb: r.photo_thumb || null,
  model3d: r.model3d,
  model3dName: r.model3d_name,
  // Réalité augmentée (migration 20260801_object_ar.sql)
  model3dIos: r.model3d_ios || null,
  model3dIosName: r.model3d_ios_name || '',
  arPlacement: r.ar_placement || 'floor',
  arEchelle: r.ar_echelle == null ? 1 : Number(r.ar_echelle),
  published: r.published,
  publishedAt: r.published_at,
  seo: r.seo || { title: '', description: '', slug: '', keywords: [] },
  createdAt: r.created_at
})
const toRow = (o) => ({
  sector_id: o.sectorId ?? null,
  nom: o.nom,
  nom_commun: o.nomCommun ?? null,
  description: o.description ?? null,
  photo: o.photo ?? null,
  photo_thumb: o.photoThumb ?? null,
  model3d: o.model3d ?? null,
  model3d_name: o.model3dName ?? null,
  model3d_ios: o.model3dIos ?? null,
  model3d_ios_name: o.model3dIosName ?? null,
  ar_placement: o.arPlacement || 'floor',
  ar_echelle: o.arEchelle == null || o.arEchelle === '' ? 1 : Number(o.arEchelle),
  published: o.published ?? false,
  seo: o.seo ?? {}
})

// Compatibilité avec une base où la migration 20260801_object_ar.sql n'a pas
// encore été passée : ses colonnes n'existent pas, et PostgREST rejette alors
// l'écriture entière. Plutôt que de bloquer l'enregistrement d'un objet — ce
// qui rendrait l'ERP inutilisable pour un motif sans rapport — on réessaie une
// fois sans ces colonnes, et on ne les renvoie plus jusqu'au rechargement.
const AR_COLONNES = ['model3d_ios', 'model3d_ios_name', 'ar_placement', 'ar_echelle']
let arColonnesPresentes = true

const sansAr = (row) => {
  const copie = { ...row }
  for (const c of AR_COLONNES) delete copie[c]
  return copie
}
const colonneAbsente = (e) =>
  /does not exist|Could not find the .* column|schema cache/i.test(e?.message || '')

// Exécute une écriture, en retirant les colonnes RA si la base ne les connaît pas.
async function ecrire(requete) {
  const { data, error } = await requete(arColonnesPresentes)
  if (!error) return data
  if (!arColonnesPresentes || !colonneAbsente(error)) throw error

  console.warn(
    '[objects] colonnes de réalité augmentée absentes — exécutez ' +
    'supabase/migrations/20260801_object_ar.sql. Enregistrement sans elles.'
  )
  arColonnesPresentes = false
  const { data: d2, error: e2 } = await requete(false)
  if (e2) throw e2
  return d2
}

export const useObjectStore = defineStore('objects', () => {
  const items = ref([])
  const loading = ref(false)

  // Colonnes de la LISTE. `photo`, `model3d` et `model3d_ios` en sont ABSENTS :
  // ce sont des data URL en base64 pesant des centaines de kilo-octets chacune.
  // Un `select('*')` sur vingt objets téléchargeait plusieurs méga-octets
  // uniquement pour afficher un tableau de noms.
  //
  // La vignette vient de `photo_thumb`, une miniature de 240 px produite au
  // téléversement (~8 Ko). Le tableau reste illustré, sans le poids.
  // Les médias complets ne sont chargés qu'à l'ouverture d'une fiche,
  // par `chargerMedias()`.
  const COLONNES_LISTE =
    'id, sector_id, nom, nom_commun, description, published, published_at, seo, created_at,' +
    ' photo_thumb, model3d_name, model3d_ios_name, ar_placement, ar_echelle'

  async function load() {
    loading.value = true
    const { data, error } = await scopeToTenant(
      supabase.from('objects').select(COLONNES_LISTE)
    ).order('id')
    if (error) console.error('[objects] load', error.message)
    else items.value = data.map(fromRow)
    loading.value = false
  }

  // Charge les médias lourds d'UN objet, à l'ouverture de sa fiche seulement.
  async function chargerMedias(id) {
    const { data, error } = await supabase
      .from('objects').select('photo, model3d, model3d_ios').eq('id', id).single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === id)
    if (i !== -1) {
      items.value[i] = {
        ...items.value[i],
        photo: data.photo,
        model3d: data.model3d,
        model3dIos: data.model3d_ios
      }
    }
    return data
  }

  async function add(data) {
    const row = toRow(data)
    if (row.published && !row.published_at) row.published_at = today()
    const r = await ecrire((avecAr) =>
      // On ne redemande PAS la photo : la renvoyer doublerait le poids de
      // l aller-retour pour une donnee qu on vient nous-meme d envoyer.
      supabase.from('objects').insert(avecAr ? row : sansAr(row)).select(COLONNES_LISTE).single()
    )
    const o = fromRow(r)
    items.value.push(o)
    return o
  }

  async function update(id, data) {
    const row = toRow(data)
    const existing = getById(id)
    if (row.published && !existing?.publishedAt) row.published_at = today()
    const r = await ecrire((avecAr) =>
      supabase.from('objects').update(avecAr ? row : sansAr(row)).eq('id', id).select(COLONNES_LISTE).single()
    )
    const i = items.value.findIndex((x) => x.id === id)
    // fromRow(r) n a pas les medias (non redemandes) : on garde ceux en memoire.
    if (i !== -1) items.value[i] = { ...items.value[i], ...fromRow(r), photo: row.photo, model3d: row.model3d }
  }

  async function remove(id) {
    const { error } = await supabase.from('objects').delete().eq('id', id)
    if (error) throw error
    items.value = items.value.filter((x) => x.id !== id)
  }

  async function togglePublished(id) {
    const o = getById(id)
    if (!o) return
    const published = !o.published
    const patch = { published }
    if (published && !o.publishedAt) patch.published_at = today()
    const { data: r, error } = await supabase.from('objects').update(patch).eq('id', id).select(COLONNES_LISTE).single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === id)
    if (i !== -1) items.value[i] = fromRow(r)
  }

  const getById = (id) => items.value.find((o) => o.id === id)

  return { items, loading, load, chargerMedias, add, update, remove, togglePublished, getById }
})
