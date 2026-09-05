import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/services/supabase'
import { supprimerOuEchouer } from '@/services/ecriture'
import { scopeToTenant } from '@/services/tenant'

const fromRow = (r) => ({
  id: r.id,
  museumId: r.museum_id,
  nom: r.nom,
  etage: r.etage,
  emplacement: r.emplacement,
  description: r.description,
  published: r.published,
  // Assistant vocal propre au secteur
  histoire: r.histoire || '',
  voiceId: r.voice_id || null,
  ton: r.ton || 'neutre',
  timbreVoix: r.timbre_voix || 'standard',
  debit: r.debit == null ? 1 : Number(r.debit)
})
const toRow = (s) => ({
  museum_id: s.museumId,
  nom: s.nom,
  etage: s.etage ?? null,
  emplacement: s.emplacement ?? 'Intérieur',
  description: s.description ?? null,
  published: s.published ?? false,
  histoire: s.histoire ?? null,
  voice_id: s.voiceId || null,
  ton: s.ton ?? 'neutre',
  timbre_voix: s.timbreVoix ?? 'standard',
  debit: s.debit == null || s.debit === '' ? 1 : s.debit
})

export const useSectorStore = defineStore('sectors', () => {
  const items = ref([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    const { data, error } = await scopeToTenant(supabase.from('sectors').select('*')).order('id')
    if (error) console.error('[sectors] load', error.message)
    else items.value = data.map(fromRow)
    loading.value = false
  }

  async function add(data) {
    const { data: row, error } = await supabase.from('sectors').insert(toRow(data)).select().single()
    if (error) throw error
    const s = fromRow(row)
    items.value.push(s)
    return s
  }

  async function update(id, data) {
    const { data: row, error } = await supabase.from('sectors').update(toRow(data)).eq('id', id).select().single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === id)
    if (i !== -1) items.value[i] = fromRow(row)
  }

  async function remove(id) {
    await supprimerOuEchouer(supabase.from('sectors').delete().eq('id', id))
    items.value = items.value.filter((x) => x.id !== id)
  }

  const getById = (id) => items.value.find((s) => s.id === id)
  const byMuseum = (museumId) => items.value.filter((s) => s.museumId === museumId)

  return { items, loading, load, add, update, remove, getById, byMuseum }
})
