import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/services/supabase'
import { supprimerOuEchouer } from '@/services/ecriture'
import { scopeToTenant } from '@/services/tenant'

// Livre d'or : les avis arrivent en attente (published = false) et sont modérés dans l'ERP.
const fromRow = (r) => ({
  id: r.id,
  museumId: r.museum_id,
  nom: r.nom,
  message: r.message,
  note: r.note,
  published: r.published ?? false,
  createdAt: r.created_at
})

export const useReviewStore = defineStore('reviews', () => {
  const items = ref([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    const { data, error } = await scopeToTenant(supabase.from('reviews').select('*')).order('created_at', { ascending: false })
    if (error) console.error('[reviews] load', error.message)
    else items.value = data.map(fromRow)
    loading.value = false
  }
  async function setPublished(id, published) {
    const { data: r, error } = await supabase.from('reviews').update({ published }).eq('id', id).select().single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === id)
    if (i !== -1) items.value[i] = fromRow(r)
  }
  async function remove(id) {
    await supprimerOuEchouer(supabase.from('reviews').delete().eq('id', id))
    items.value = items.value.filter((x) => x.id !== id)
  }

  const pending = computed(() => items.value.filter((r) => !r.published))

  return { items, loading, pending, load, setPublished, remove }
})
