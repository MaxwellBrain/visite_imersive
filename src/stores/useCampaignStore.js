import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/services/supabase'
import { supprimerOuEchouer } from '@/services/ecriture'
import { scopeToTenant } from '@/services/tenant'

// Campagnes e-mail adressées au public de l'organisation (V2 Phase 4).
// La RLS `campaigns_staff_all` restreint déjà tout à can_manage_tenant(tenant_id) ;
// scopeToTenant() ajoute le filtre applicatif habituel.

const fromRow = (r) => ({
  id: r.id,
  type: r.type,
  sujet: r.sujet,
  contenu: r.contenu,
  image: r.image,
  lien: r.lien,
  lienTexte: r.lien_texte,
  cible: r.cible,
  museumId: r.museum_id,
  eventId: r.event_id,
  statut: r.statut,
  nbDestinataires: r.nb_destinataires ?? 0,
  nbEnvoyes: r.nb_envoyes ?? 0,
  nbEchecs: r.nb_echecs ?? 0,
  genereParIa: r.genere_par_ia ?? false,
  createdAt: r.created_at,
  sentAt: r.sent_at
})
const toRow = (c) => ({
  type: c.type || 'annonce',
  sujet: c.sujet,
  contenu: c.contenu,
  image: c.image || null,
  lien: c.lien || null,
  lien_texte: c.lienTexte || null,
  cible: c.cible || 'tous',
  museum_id: c.museumId ?? null,
  event_id: c.eventId ?? null,
  genere_par_ia: c.genereParIa ?? false
})

export const useCampaignStore = defineStore('campaigns', () => {
  const items = ref([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    const { data, error } = await scopeToTenant(supabase.from('campaigns').select('*'))
      .order('created_at', { ascending: false })
    if (error) console.error('[campaigns] load', error.message)
    else items.value = data.map(fromRow)
    loading.value = false
  }

  async function add(d) {
    const { data, error } = await supabase.from('campaigns').insert(toRow(d)).select().single()
    if (error) throw error
    const c = fromRow(data)
    items.value.unshift(c)
    return c
  }

  // Une campagne déjà envoyée n'est plus modifiable (l'historique doit rester fidèle).
  async function update(id, d) {
    const { data, error } = await supabase.from('campaigns').update(toRow(d)).eq('id', id).select().single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === id)
    if (i !== -1) items.value[i] = fromRow(data)
  }

  async function remove(id) {
    await supprimerOuEchouer(supabase.from('campaigns').delete().eq('id', id))
    items.value = items.value.filter((x) => x.id !== id)
  }

  // Destinataires réels d'une campagne (RPC : opt-in + adhérents actifs de l'organisation).
  async function recipients(campaignId) {
    const { data, error } = await supabase.rpc('campaign_recipients', { p_campaign_id: campaignId })
    if (error) throw error
    return (data || []).map((r) => ({ userId: r.user_id, email: r.email, nom: r.nom_affiche }))
  }

  // Rédaction assistée (Groq, clé serveur). Jamais bloquant : en cas d'échec on renvoie
  // { ok:false } et l'administrateur écrit lui-même.
  async function compose({ sujet, type, organisation, contexte, langue }) {
    const { data, error } = await supabase.functions.invoke('campaign-ai', {
      body: { sujet, type, organisation, contexte, langue }
    })
    if (error) return { ok: false, error: error.message }
    return data || { ok: false, error: 'empty' }
  }

  // Met à jour le bilan d'envoi (statut + compteurs).
  async function markSent(id, { destinataires, envoyes, echecs }) {
    const { data, error } = await supabase.from('campaigns').update({
      statut: envoyes > 0 ? 'envoyee' : 'echec',
      nb_destinataires: destinataires,
      nb_envoyes: envoyes,
      nb_echecs: echecs,
      sent_at: new Date().toISOString()
    }).eq('id', id).select().single()
    if (error) throw error
    const i = items.value.findIndex((x) => x.id === id)
    if (i !== -1) items.value[i] = fromRow(data)
  }

  return { items, loading, load, add, update, remove, recipients, compose, markSent }
})
