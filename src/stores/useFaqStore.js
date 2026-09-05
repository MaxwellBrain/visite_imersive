import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/services/supabase'
import { supprimerOuEchouer } from '@/services/ecriture'
import { scopeToTenant } from '@/services/tenant'

const fromRow = (r) => ({
  id: r.id,
  question: r.question,
  reponse: r.reponse,
  categorie: r.categorie,
  ordre: r.ordre,
  visible: r.visible
})
const toRow = (f) => ({
  question: f.question,
  reponse: f.reponse ?? null,
  categorie: f.categorie ?? null,
  ordre: f.ordre ?? 0,
  visible: f.visible ?? true
})
const sortByOrdre = (a, b) => a.ordre - b.ordre || a.id - b.id

export const useFaqStore = defineStore('faq', () => {
  const items = ref([])

  async function load() {
    const { data, error } = await scopeToTenant(supabase.from('faq').select('*')).order('ordre').order('id')
    if (error) console.error('[faq] load', error.message)
    else items.value = data.map(fromRow)
  }
  async function add(d) {
    const { data: r, error } = await supabase.from('faq').insert(toRow(d)).select().single()
    if (error) throw error
    items.value.push(fromRow(r))
    items.value.sort(sortByOrdre)
  }
  async function update(id, d) {
    const { data: r, error } = await supabase.from('faq').update(toRow(d)).eq('id', id).select().single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === id)
    if (i !== -1) items.value[i] = fromRow(r)
    items.value.sort(sortByOrdre)
  }
  async function remove(id) {
    await supprimerOuEchouer(supabase.from('faq').delete().eq('id', id))
    items.value = items.value.filter((x) => x.id !== id)
  }
  async function toggleVisible(f) {
    const { data: r, error } = await supabase.from('faq').update({ visible: !f.visible }).eq('id', f.id).select().single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === f.id)
    if (i !== -1) items.value[i] = fromRow(r)
  }

  return { items, load, add, update, remove, toggleVisible }
})
