import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/services/supabase'
import { scopeToTenant } from '@/services/tenant'

// Commandes passées sur le site public (lecture/gestion réservée au staff par RLS).
const fromRow = (r) => ({
  id: r.id,
  userId: r.user_id,
  statut: r.statut,                       // paiement : en_attente | payee | echouee
  fulfillment: r.fulfillment || 'nouvelle', // logistique : nouvelle | preparee | livree | annulee
  total: r.total == null ? 0 : Number(r.total),
  devise: r.devise || 'FCFA',
  moyenPaiement: r.moyen_paiement,
  paymentProvider: r.payment_provider,
  createdAt: r.created_at,
  paidAt: r.paid_at,
  items: (r.order_items || []).map((i) => ({
    id: i.id, type: i.type, refId: i.ref_id, museumId: i.museum_id,
    label: i.label, montant: i.montant == null ? 0 : Number(i.montant)
  }))
})

export const useOrderStore = defineStore('orders', () => {
  const items = ref([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    const { data, error } = await scopeToTenant(
      supabase.from('orders').select('*, order_items(*)')
    ).order('created_at', { ascending: false })
    if (error) console.error('[orders] load', error.message)
    else items.value = (data || []).map(fromRow)
    loading.value = false
  }

  async function setFulfillment(id, fulfillment) {
    const { data: r, error } = await supabase
      .from('orders').update({ fulfillment }).eq('id', id).select('*, order_items(*)').single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === id)
    if (i !== -1) items.value[i] = fromRow(r)
  }

  // Indicateurs affichés en tête de page et sur le tableau de bord.
  const paid = computed(() => items.value.filter((o) => o.statut === 'payee'))
  const revenue = computed(() => paid.value.reduce((s, o) => s + o.total, 0))
  const pendingCount = computed(() => paid.value.filter((o) => o.fulfillment === 'nouvelle').length)

  return { items, loading, load, setFulfillment, paid, revenue, pendingCount }
})
