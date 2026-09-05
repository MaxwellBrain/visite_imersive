import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/services/supabase'
import { supprimerOuEchouer } from '@/services/ecriture'
import { scopeToTenant } from '@/services/tenant'

const fromTariff = (r) => ({
  id: r.id,
  objectLabel: r.object_label,
  typeVisite: r.type_visite,
  dureeMin: r.duree_min,
  prix: Number(r.prix),
  devise: r.devise
})
const toTariff = (t) => ({
  object_label: t.objectLabel ?? null,
  type_visite: t.typeVisite ?? null,
  duree_min: t.dureeMin ?? null,
  prix: t.prix ?? 0,
  devise: t.devise ?? 'FCFA'
})
const fromDon = (r) => ({
  id: r.id,
  label: r.label,
  montant: Number(r.montant),
  devise: r.devise,
  description: r.description
})
const toDon = (d) => ({
  label: d.label,
  montant: d.montant ?? 0,
  devise: d.devise ?? 'FCFA',
  description: d.description ?? null
})

export const usePricingStore = defineStore('pricing', () => {
  const objectTariffs = ref([])
  const donationTiers = ref([])

  async function load() {
    const [t, d] = await Promise.all([
      scopeToTenant(supabase.from('object_tariffs').select('*')).order('id'),
      scopeToTenant(supabase.from('donation_tiers').select('*')).order('id')
    ])
    if (t.error) console.error('[tariffs] load', t.error.message)
    else objectTariffs.value = t.data.map(fromTariff)
    if (d.error) console.error('[donations] load', d.error.message)
    else donationTiers.value = d.data.map(fromDon)
  }

  async function addObjectTariff(data) {
    const { data: row, error } = await supabase.from('object_tariffs').insert(toTariff(data)).select().single()
    if (error) throw error
    objectTariffs.value.push(fromTariff(row))
  }
  async function removeObjectTariff(id) {
    await supprimerOuEchouer(supabase.from('object_tariffs').delete().eq('id', id))
    objectTariffs.value = objectTariffs.value.filter((t) => t.id !== id)
  }
  async function addDonationTier(data) {
    const { data: row, error } = await supabase.from('donation_tiers').insert(toDon(data)).select().single()
    if (error) throw error
    donationTiers.value.push(fromDon(row))
  }
  async function removeDonationTier(id) {
    await supprimerOuEchouer(supabase.from('donation_tiers').delete().eq('id', id))
    donationTiers.value = donationTiers.value.filter((t) => t.id !== id)
  }

  return { objectTariffs, donationTiers, load, addObjectTariff, removeObjectTariff, addDonationTier, removeDonationTier }
})
