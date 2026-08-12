import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/services/supabase'
import { scopeToTenant, currentTenantId } from '@/services/tenant'

// Boîte de réception de l'organisation.
//
// Deux niveaux : le FIL (`messages`) et ses ÉCHANGES (`message_replies`). La liste
// ne charge que les fils ; les échanges d'un fil sont chargés à son ouverture,
// pour ne pas rapatrier toute la correspondance à chaque affichage.
//
// La RLS restreint déjà tout à can_manage_tenant(tenant_id) ; scopeToTenant()
// ajoute le filtre applicatif habituel.

const fromRow = (r) => ({
  id: r.id,
  tenantId: r.tenant_id,
  canal: r.canal,
  sujet: r.sujet,
  expediteurNom: r.expediteur_nom,
  expediteurEmail: r.expediteur_email,
  userId: r.user_id,
  orderId: r.order_id,
  statut: r.statut,
  lu: r.lu,
  dernierMessageAt: r.dernier_message_at,
  createdAt: r.created_at
})

const fromReply = (r) => ({
  id: r.id,
  messageId: r.message_id,
  corps: r.corps,
  auteur: r.auteur,
  authorId: r.author_id,
  emailEnvoye: r.email_envoye,
  createdAt: r.created_at
})

export const useMessageStore = defineStore('messages', () => {
  const items = ref([])
  const replies = ref([])        // échanges du fil actuellement ouvert
  const loading = ref(false)
  const openId = ref(null)

  // Sert la pastille du menu : ce qui attend vraiment une action.
  const unreadCount = computed(() => items.value.filter((m) => !m.lu && m.statut !== 'spam').length)

  async function load() {
    loading.value = true
    const { data, error } = await scopeToTenant(supabase.from('messages').select('*'))
      .order('dernier_message_at', { ascending: false })
    if (error) console.error('[messages] load', error.message)
    else items.value = data.map(fromRow)
    loading.value = false
  }

  // Ouvre un fil : charge ses échanges et le marque lu au passage.
  async function open(id) {
    openId.value = id
    replies.value = []
    const { data, error } = await supabase.from('message_replies')
      .select('*').eq('message_id', id).order('created_at')
    if (error) { console.error('[messages] replies', error.message); return }
    replies.value = data.map(fromReply)

    const fil = items.value.find((m) => m.id === id)
    if (fil && !fil.lu) await markRead(id, true)
  }

  function close() {
    openId.value = null
    replies.value = []
  }

  async function markRead(id, lu = true) {
    const { error } = await supabase.from('messages').update({ lu }).eq('id', id)
    if (error) { console.error('[messages] markRead', error.message); return }
    const i = items.value.findIndex((m) => m.id === id)
    if (i !== -1) items.value[i] = { ...items.value[i], lu }
  }

  async function setStatut(id, statut) {
    const { data, error } = await supabase.from('messages')
      .update({ statut }).eq('id', id).select().single()
    if (error) throw error
    const i = items.value.findIndex((m) => m.id === id)
    if (i !== -1) items.value[i] = fromRow(data)
  }

  // Ajoute une réponse au fil. `emailEnvoye` retrace si le visiteur a bien été
  // prévenu par e-mail — l'envoi lui-même est déclenché par la vue, qui seule
  // dispose de l'identité visuelle de l'organisation.
  async function reply(messageId, corps, { emailEnvoye = false, auteur = 'staff' } = {}) {
    const { data: session } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('message_replies').insert({
      message_id: messageId,
      corps,
      auteur,
      author_id: session?.user?.id ?? null,
      email_envoye: emailEnvoye
    }).select().single()
    if (error) throw error
    const r = fromReply(data)
    if (openId.value === messageId) replies.value.push(r)

    // Le trigger en base a fait remonter le fil et ajusté son statut : on relit
    // la ligne plutôt que de deviner sa nouvelle valeur.
    const { data: fil } = await supabase.from('messages').select('*').eq('id', messageId).single()
    if (fil) {
      const i = items.value.findIndex((m) => m.id === messageId)
      if (i !== -1) items.value[i] = fromRow(fil)
    }
    return r
  }

  async function remove(id) {
    const { error } = await supabase.from('messages').delete().eq('id', id)
    if (error) throw error
    items.value = items.value.filter((m) => m.id !== id)
    if (openId.value === id) close()
  }

  // Ouvre une conversation avec l'équipe MUSÉA (canal « plateforme »).
  async function contactPlatform({ sujet, corps }) {
    const { data, error } = await supabase.from('messages').insert({
      tenant_id: currentTenantId(),
      canal: 'plateforme',
      sujet
    }).select().single()
    if (error) throw error
    const fil = fromRow(data)
    items.value.unshift(fil)
    await reply(fil.id, corps, { auteur: 'staff' })
    return fil
  }

  return {
    items, replies, loading, openId, unreadCount,
    load, open, close, markRead, setStatut, reply, remove, contactPlatform
  }
})
