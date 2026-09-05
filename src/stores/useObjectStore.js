import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/services/supabase'
import { supprimerOuEchouer } from '@/services/ecriture'
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
  // Vues complémentaires (migration 20260905_objet_galerie.sql). `photo` reste
  // la couverture ; celles-ci sont montrées à côté de la notice publique.
  photos: Array.isArray(r.photos) ? r.photos : [],
  model3d: r.model3d,
  model3dName: r.model3d_name,
  // Réalité augmentée (migration 20260801_object_ar.sql)
  model3dIos: r.model3d_ios || null,
  model3dIosName: r.model3d_ios_name || '',
  arPlacement: r.ar_placement || 'floor',
  arEchelle: r.ar_echelle == null ? 1 : Number(r.ar_echelle),
  // Réalité augmentée SEULE (migration 20260828_ar_seulement.sql)
  arSeulement: r.ar_seulement === true,
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
  // On nettoie AVANT d'écrire plutôt que d'attendre le refus de la contrainte
  // `objects_photos_forme` : une vue sans URL est un accident d'interface, pas
  // une erreur que le conservateur doit lire en langue de base de données.
  photos: (Array.isArray(o.photos) ? o.photos : [])
    .filter((v) => v && typeof v.url === 'string' && v.url && !v.url.startsWith('data:'))
    .slice(0, 12)
    .map((v) => ({ url: v.url, legende: String(v.legende || '').slice(0, 160) })),
  model3d: o.model3d ?? null,
  model3d_name: o.model3dName ?? null,
  model3d_ios: o.model3dIos ?? null,
  model3d_ios_name: o.model3dIosName ?? null,
  ar_placement: o.arPlacement || 'floor',
  ar_echelle: o.arEchelle == null || o.arEchelle === '' ? 1 : Number(o.arEchelle),
  ar_seulement: !!o.arSeulement,
  published: o.published ?? false,
  seo: o.seo ?? {}
})

// Compatibilité avec une base dont une migration n'a pas encore été passée :
// les colonnes n'existent pas, et PostgREST rejette alors l'écriture ENTIÈRE.
// Plutôt que de bloquer l'enregistrement d'un objet — ce qui rendrait l'ERP
// inutilisable pour un motif sans rapport — on réessaie une fois sans le groupe
// de colonnes en cause, et on ne le renvoie plus jusqu'au rechargement.
//
// Le mécanisme portait sur la seule réalité augmentée. Il en couvre désormais
// deux groupes : le rendre général coûtait moins cher que de le copier, et la
// prochaine migration de colonnes n'aura qu'une ligne à ajouter ici.
const GROUPES_OPTIONNELS = [
  {
    nom: 'réalité augmentée',
    migration: '20260801_object_ar.sql',
    colonnes: ['model3d_ios', 'model3d_ios_name', 'ar_placement', 'ar_echelle', 'ar_seulement'],
    present: true
  },
  {
    nom: 'vues complémentaires',
    migration: '20260905_objet_galerie.sql',
    colonnes: ['photos'],
    present: true
  }
]

// Retire de la ligne tout groupe dont on sait déjà qu'il manque en base.
const filtrer = (row) => {
  const copie = { ...row }
  for (const g of GROUPES_OPTIONNELS) {
    if (g.present) continue
    for (const c of g.colonnes) delete copie[c]
  }
  return copie
}

const colonneAbsente = (e) =>
  /does not exist|Could not find the .* column|schema cache/i.test(e?.message || '')

// PostgREST NOMME la colonne fautive (« Could not find the 'photos' column »),
// et Postgres aussi (« column "photos" of relation "objects" does not exist »).
// On s'en sert pour ne désactiver que le groupe réellement absent : désactiver
// les deux ferait perdre silencieusement la réalité augmentée à cause d'une
// galerie, ou l'inverse.
//
// Sans nom de colonne identifiable, on ne DEVINE PAS : renvoyer null fait
// remonter l'erreur telle quelle. Un mauvais pari abandonnerait sans bruit des
// données que l'utilisateur croit enregistrées — pire qu'un échec visible.
const groupeFautif = (e) => {
  const msg = e?.message || ''
  return GROUPES_OPTIONNELS.find(
    (g) => g.present && g.colonnes.some((c) => msg.includes(`'${c}'`) || msg.includes(`"${c}"`))
  ) || null
}

// Exécute une écriture, en retirant les colonnes que la base ne connaît pas.
async function ecrire(requete) {
  const { data, error } = await requete(filtrer)
  if (!error) return data
  if (!colonneAbsente(error)) throw error

  const g = groupeFautif(error)
  if (!g) throw error

  console.warn(
    `[objects] colonnes « ${g.nom} » absentes — exécutez ` +
    `supabase/migrations/${g.migration}. Enregistrement sans elles.`
  )
  g.present = false
  const { data: d2, error: e2 } = await requete(filtrer)
  if (e2) throw e2
  return d2
}

// Colonnes optionnelles encore réputées présentes — pour les SELECT, qui
// échouent de la même façon si l'une d'elles manque.
const colonnesPresentes = (noms) =>
  noms.filter((c) => GROUPES_OPTIONNELS.every((g) => g.present || !g.colonnes.includes(c)))

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
    ' photo_thumb, model3d_name, model3d_ios_name, ar_placement, ar_echelle, ar_seulement'

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
  //
  // `photos` ne pèse que des URL, mais y figure pour la même raison que le
  // reste : la LISTE n'en a pas l'usage, la FICHE si.
  async function chargerMedias(id) {
    const colonnes = ['photo', 'model3d', 'model3d_ios', ...colonnesPresentes(['photos'])]
    let { data, error } = await supabase
      .from('objects').select(colonnes.join(', ')).eq('id', id).single()

    // Même tolérance qu'à l'écriture. Ici `photos` est la SEULE colonne
    // optionnelle demandée : c'est donc elle, sans avoir à le deviner.
    if (error && colonneAbsente(error)) {
      const g = GROUPES_OPTIONNELS.find((x) => x.colonnes.includes('photos'))
      if (g?.present) {
        console.warn(`[objects] colonnes « ${g.nom} » absentes — exécutez supabase/migrations/${g.migration}.`)
        g.present = false
      }
      ;({ data, error } = await supabase
        .from('objects').select('photo, model3d, model3d_ios').eq('id', id).single())
    }
    if (error) throw error

    const i = items.value.findIndex((x) => x.id === id)
    if (i !== -1) {
      items.value[i] = {
        ...items.value[i],
        photo: data.photo,
        photos: Array.isArray(data.photos) ? data.photos : [],
        model3d: data.model3d,
        model3dIos: data.model3d_ios
      }
    }
    return data
  }

  async function add(data) {
    const row = toRow(data)
    if (row.published && !row.published_at) row.published_at = today()
    const r = await ecrire((prepare) =>
      // On ne redemande PAS la photo : la renvoyer doublerait le poids de
      // l aller-retour pour une donnee qu on vient nous-meme d envoyer.
      supabase.from('objects').insert(prepare(row)).select(COLONNES_LISTE).single()
    )
    const o = fromRow(r)
    items.value.push(o)
    return o
  }

  async function update(id, data) {
    const row = toRow(data)
    const existing = getById(id)
    if (row.published && !existing?.publishedAt) row.published_at = today()
    const r = await ecrire((prepare) =>
      supabase.from('objects').update(prepare(row)).eq('id', id).select(COLONNES_LISTE).single()
    )
    const i = items.value.findIndex((x) => x.id === id)
    // fromRow(r) n a pas les medias (non redemandes) : on garde ceux en memoire.
    if (i !== -1) {
      items.value[i] = {
        ...items.value[i], ...fromRow(r),
        photo: row.photo, photos: row.photos ?? items.value[i].photos, model3d: row.model3d
      }
    }
  }

  async function remove(id) {
    await supprimerOuEchouer(supabase.from('objects').delete().eq('id', id))
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
