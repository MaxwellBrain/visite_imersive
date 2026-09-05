import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/services/supabase'
import { supprimerOuEchouer } from '@/services/ecriture'
import { scopeToTenant } from '@/services/tenant'

const fromRow = (r) => ({
  id: r.id,
  nom: r.nom,
  type: r.type,
  anneeFondation: r.annee_fondation,
  description: r.description,
  photo: r.photo,
  partenaire: r.partenaire,
  published: r.published
})
const toRow = (m) => ({
  nom: m.nom,
  type: m.type ?? null,
  annee_fondation: m.anneeFondation ?? null,
  description: m.description ?? null,
  photo: m.photo ?? null,
  partenaire: m.partenaire ?? null,
  published: m.published ?? false
})

export const useMuseumStore = defineStore('museums', () => {
  const items = ref([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    const { data, error } = await scopeToTenant(supabase.from('museums').select('*')).order('id')
    if (error) console.error('[museums] load', error.message)
    else items.value = data.map(fromRow)
    loading.value = false
  }

  async function add(data) {
    const { data: row, error } = await supabase.from('museums').insert(toRow(data)).select().single()
    if (error) throw error
    const m = fromRow(row)
    items.value.push(m)
    return m
  }

  async function update(id, data) {
    const { data: row, error } = await supabase.from('museums').update(toRow(data)).eq('id', id).select().single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === id)
    if (i !== -1) items.value[i] = fromRow(row)
  }

  async function remove(id) {
    await supprimerOuEchouer(supabase.from('museums').delete().eq('id', id))
    items.value = items.value.filter((x) => x.id !== id)
  }

  const getById = (id) => items.value.find((m) => m.id === id)

  return { items, loading, load, add, update, remove, getById }
})
