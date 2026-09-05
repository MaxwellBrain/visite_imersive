import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/services/supabase'
import { supprimerOuEchouer } from '@/services/ecriture'
import { scopeToTenant } from '@/services/tenant'

// Visites immersives (Phase 6) — côté ERP.
// Un parcours = une suite de scènes 360, chaque scène portant des points chauds.
// Les scènes et les points chauds ne sont chargés qu'à l'ouverture d'une visite :
// inutile de tirer tout le média de l'organisation pour afficher une liste.

const tourFrom = (r) => ({
  id: r.id,
  museumId: r.museum_id,
  titre: r.titre,
  description: r.description || '',
  couverture: r.couverture || '',
  dureeMin: r.duree_min,
  published: r.published,
  createdAt: r.created_at
})
const tourTo = (t) => ({
  museum_id: t.museumId,
  titre: t.titre,
  description: t.description || null,
  couverture: t.couverture || null,
  duree_min: t.dureeMin === '' || t.dureeMin == null ? null : Number(t.dureeMin),
  published: t.published ?? false
})

const sceneFrom = (r) => ({
  id: r.id,
  tourId: r.tour_id,
  sectorId: r.sector_id,
  titre: r.titre,
  type: r.type || 'photo360',
  mediaUrl: r.media_url || '',
  ordre: r.ordre ?? 0,
  positionInitiale: r.position_initiale || {}
})
const sceneTo = (s) => ({
  tour_id: s.tourId,
  sector_id: s.sectorId ?? null,
  titre: s.titre,
  type: s.type || 'photo360',
  media_url: s.mediaUrl || null,
  ordre: s.ordre ?? 0,
  position_initiale: s.positionInitiale || {}
})

const hotspotFrom = (r) => ({
  id: r.id,
  sceneId: r.scene_id,
  objectId: r.object_id,
  personnageId: r.personnage_id,
  sceneCibleId: r.scene_cible_id,
  type: r.type || 'objet',
  libelle: r.libelle || '',
  texte: r.texte || '',
  x: Number(r.x) || 0,
  y: Number(r.y) || 0,
  z: Number(r.z) || 0
})
const hotspotTo = (h) => ({
  scene_id: h.sceneId,
  object_id: h.type === 'objet' ? h.objectId ?? null : null,
  personnage_id: h.type === 'personnage' ? h.personnageId ?? null : null,
  scene_cible_id: h.type === 'navigation' ? h.sceneCibleId ?? null : null,
  type: h.type || 'objet',
  libelle: h.libelle || null,
  texte: h.type === 'info' ? h.texte || null : null,
  x: Number(h.x) || 0,
  y: Number(h.y) || 0,
  z: Number(h.z) || 0
})

export const useTourStore = defineStore('tours', () => {
  const items = ref([])
  const scenes = ref([]) // scènes de la visite ouverte
  const hotspots = ref([]) // points chauds de toutes ces scènes
  const loading = ref(false)
  const openTourId = ref(null)

  async function load() {
    loading.value = true
    const { data, error } = await scopeToTenant(supabase.from('tours').select('*')).order('id')
    if (error) console.error('[tours] load', error.message)
    else items.value = data.map(tourFrom)
    loading.value = false
  }

  async function add(data) {
    const { data: row, error } = await supabase.from('tours').insert(tourTo(data)).select().single()
    if (error) throw error
    const t = tourFrom(row)
    items.value.push(t)
    return t
  }

  async function update(id, data) {
    const { data: row, error } = await supabase.from('tours').update(tourTo(data)).eq('id', id).select().single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === id)
    if (i !== -1) items.value[i] = tourFrom(row)
  }

  async function remove(id) {
    await supprimerOuEchouer(supabase.from('tours').delete().eq('id', id))
    items.value = items.value.filter((x) => x.id !== id)
    if (openTourId.value === id) { openTourId.value = null; scenes.value = []; hotspots.value = [] }
  }

  // ---------------------------------------------------------------- scènes --
  async function loadScenes(tourId) {
    openTourId.value = tourId
    const { data, error } = await scopeToTenant(supabase.from('tour_scenes').select('*'))
      .eq('tour_id', tourId).order('ordre').order('id')
    if (error) { console.error('[tours] scenes', error.message); scenes.value = []; hotspots.value = []; return }
    scenes.value = data.map(sceneFrom)
    await loadHotspots(scenes.value.map((s) => s.id))
  }

  async function addScene(data) {
    const ordre = data.ordre ?? scenes.value.length
    const { data: row, error } = await supabase.from('tour_scenes').insert(sceneTo({ ...data, ordre })).select().single()
    if (error) throw error
    const s = sceneFrom(row)
    scenes.value.push(s)
    return s
  }

  async function updateScene(id, data) {
    const { data: row, error } = await supabase.from('tour_scenes').update(sceneTo(data)).eq('id', id).select().single()
    if (error) throw error
    const i = scenes.value.findIndex((x) => x.id === id)
    if (i !== -1) scenes.value[i] = sceneFrom(row)
  }

  async function removeScene(id) {
    await supprimerOuEchouer(supabase.from('tour_scenes').delete().eq('id', id))
    scenes.value = scenes.value.filter((x) => x.id !== id)
    hotspots.value = hotspots.value.filter((h) => h.sceneId !== id)
  }

  // Réordonne la visite : on renumérote tout, c'est trivial à cette échelle
  // (une visite compte quelques dizaines de salles au plus).
  async function moveScene(id, delta) {
    const list = [...scenes.value].sort((a, b) => a.ordre - b.ordre || a.id - b.id)
    const i = list.findIndex((s) => s.id === id)
    const j = i + delta
    if (i === -1 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    await Promise.all(
      list.map((s, k) => (s.ordre === k ? null : supabase.from('tour_scenes').update({ ordre: k }).eq('id', s.id)))
    )
    list.forEach((s, k) => { s.ordre = k })
    scenes.value = list
  }

  // --------------------------------------------------------- points chauds --
  async function loadHotspots(sceneIds) {
    if (!sceneIds.length) { hotspots.value = []; return }
    const { data, error } = await scopeToTenant(supabase.from('scene_hotspots').select('*'))
      .in('scene_id', sceneIds).order('id')
    if (error) { console.error('[tours] hotspots', error.message); hotspots.value = []; return }
    hotspots.value = data.map(hotspotFrom)
  }

  async function addHotspot(data) {
    const { data: row, error } = await supabase.from('scene_hotspots').insert(hotspotTo(data)).select().single()
    if (error) throw error
    const h = hotspotFrom(row)
    hotspots.value.push(h)
    return h
  }

  async function updateHotspot(id, data) {
    const { data: row, error } = await supabase.from('scene_hotspots').update(hotspotTo(data)).eq('id', id).select().single()
    if (error) throw error
    const i = hotspots.value.findIndex((x) => x.id === id)
    if (i !== -1) hotspots.value[i] = hotspotFrom(row)
  }

  async function removeHotspot(id) {
    await supprimerOuEchouer(supabase.from('scene_hotspots').delete().eq('id', id))
    hotspots.value = hotspots.value.filter((x) => x.id !== id)
  }

  const getById = (id) => items.value.find((t) => t.id === id)
  const byMuseum = (museumId) => items.value.filter((t) => t.museumId === museumId)
  const sceneHotspots = (sceneId) => hotspots.value.filter((h) => h.sceneId === sceneId)
  const orderedScenes = () => [...scenes.value].sort((a, b) => a.ordre - b.ordre || a.id - b.id)

  return {
    items, scenes, hotspots, loading, openTourId,
    load, add, update, remove,
    loadScenes, addScene, updateScene, removeScene, moveScene,
    addHotspot, updateHotspot, removeHotspot,
    getById, byMuseum, sceneHotspots, orderedScenes
  }
})
