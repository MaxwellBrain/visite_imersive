import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/services/supabase'
import { supprimerOuEchouer } from '@/services/ecriture'
import { scopeToTenant } from '@/services/tenant'

// Produits vendus dans les boutiques des musées (une boutique par musée).
const fromRow = (r) => ({
  id: r.id,
  museumId: r.museum_id,
  nom: r.nom,
  description: r.description,
  prix: r.prix == null ? null : Number(r.prix),
  devise: r.devise || 'FCFA',
  image: r.image,
  categorie: r.categorie,
  stock: r.stock,
  published: r.published ?? false
})
const toRow = (p) => ({
  museum_id: p.museumId ?? null,
  nom: p.nom,
  description: p.description ?? null,
  prix: p.prix === '' || p.prix == null ? null : p.prix,
  devise: p.devise ?? 'FCFA',
  image: p.image ?? null,
  categorie: p.categorie ?? null,
  stock: p.stock === '' || p.stock == null ? null : p.stock,
  published: p.published ?? false,
  // Sert au tri « nouveautés » côté site public.
  published_at: p.published ? new Date().toISOString() : null
})

export const useProductStore = defineStore('products', () => {
  const items = ref([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    const { data, error } = await scopeToTenant(supabase.from('products').select('*')).order('id', { ascending: false })
    if (error) console.error('[products] load', error.message)
    else items.value = data.map(fromRow)
    loading.value = false
  }
  async function add(d) {
    const { data: r, error } = await supabase.from('products').insert(toRow(d)).select().single()
    if (error) throw error
    items.value.unshift(fromRow(r))
  }
  async function update(id, d) {
    const { data: r, error } = await supabase.from('products').update(toRow(d)).eq('id', id).select().single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === id)
    if (i !== -1) items.value[i] = fromRow(r)
  }
  async function remove(id) {
    await supprimerOuEchouer(supabase.from('products').delete().eq('id', id))
    items.value = items.value.filter((x) => x.id !== id)
  }
  async function togglePublished(p) {
    const next = !p.published
    const { data: r, error } = await supabase
      .from('products')
      .update({ published: next, published_at: next ? new Date().toISOString() : null })
      .eq('id', p.id).select().single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === p.id)
    if (i !== -1) items.value[i] = fromRow(r)
  }

  return { items, loading, load, add, update, remove, togglePublished }
})
