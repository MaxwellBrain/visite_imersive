import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/services/supabase'
import { supprimerOuEchouer } from '@/services/ecriture'
import { scopeToTenant } from '@/services/tenant'

// Événements & expositions temporaires.
const fromRow = (r) => ({
  id: r.id,
  museumId: r.museum_id,
  titre: r.titre,
  description: r.description,
  image: r.image,
  lieu: r.lieu,
  dateDebut: r.date_debut,
  dateFin: r.date_fin,
  published: r.published ?? false
})
const toRow = (e) => ({
  museum_id: e.museumId ?? null,
  titre: e.titre,
  description: e.description ?? null,
  image: e.image ?? null,
  lieu: e.lieu ?? null,
  date_debut: e.dateDebut || null,
  date_fin: e.dateFin || null,
  published: e.published ?? false
})

export const useEventStore = defineStore('events', () => {
  const items = ref([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    const { data, error } = await scopeToTenant(supabase.from('events').select('*')).order('date_debut', { ascending: false, nullsFirst: false })
    if (error) console.error('[events] load', error.message)
    else items.value = data.map(fromRow)
    loading.value = false
  }
  async function add(d) {
    const { data: r, error } = await supabase.from('events').insert(toRow(d)).select().single()
    if (error) throw error
    items.value.unshift(fromRow(r))
  }
  async function update(id, d) {
    const { data: r, error } = await supabase.from('events').update(toRow(d)).eq('id', id).select().single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === id)
    if (i !== -1) items.value[i] = fromRow(r)
  }
  async function remove(id) {
    await supprimerOuEchouer(supabase.from('events').delete().eq('id', id))
    items.value = items.value.filter((x) => x.id !== id)
  }
  async function togglePublished(e) {
    const { data: r, error } = await supabase.from('events').update({ published: !e.published }).eq('id', e.id).select().single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === e.id)
    if (i !== -1) items.value[i] = fromRow(r)
  }

  return { items, loading, load, add, update, remove, togglePublished }
})
