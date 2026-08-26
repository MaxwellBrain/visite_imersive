import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/services/supabase'

// Back-office plateforme : gestion de TOUTES les organisations.
// Réservé au super-admin (les RPC refusent tout autre utilisateur).
export const useAdminTenantStore = defineStore('adminTenants', () => {
  const items = ref([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    const { data, error } = await supabase.rpc('admin_tenants_overview')
    if (error) console.error('[admin tenants] load', error.message)
    else items.value = data || []
    loading.value = false
  }

  async function setStatus(id, statut) {
    const { data, error } = await supabase.rpc('set_tenant_status', { p_tenant_id: id, p_statut: statut })
    if (error) throw error
    const r = (data && data[0]) || {}
    if (!r.ok) throw new Error(r.reason || 'error')
    const t = items.value.find((x) => x.id === id)
    if (t) {
      t.statut = statut
      if (statut === 'approuve' && !t.approved_at) t.approved_at = new Date().toISOString()
    }
  }

  // ---------------------------------------------------------------- domaines --
  //
  // VÉRIFIER, ce n'est pas COCHER. Le drapeau `domain_verified` décide de
  // l'organisation servie à une adresse : le poser sans preuve laisserait une
  // organisation revendiquer le domaine d'une autre. La fonction de bord
  // interroge donc le DNS et ne renvoie vrai que si l'enregistrement TXT
  // attendu s'y trouve.
  //
  // Le diagnostic complet est renvoyé à l'appelant — l'enregistrement attendu,
  // ce qui a été trouvé, et vers où le domaine pointe. Un « échec » sans ces
  // trois informations n'apprend rien à celui qui doit corriger.
  async function verifierDomaine(id) {
    const { data, error } = await supabase.functions.invoke('verifier-domaine', {
      body: { tenantId: id }
    })
    if (error) throw new Error(error.message)

    const t = items.value.find((x) => x.id === id)
    if (t && data?.ok) t.domain_verified = true
    const f = aValider.value.find((x) => x.tenant_id === id)
    if (f) {
      f.domain_verified = !!data?.ok
      f.domaine_resultat = data?.resultat || null
      f.domaine_essaye_le = new Date().toISOString()
    }
    return data || { ok: false, resultat: 'reponse_vide' }
  }

  // Dérogation du super-admin, pour les configurations DNS qui ne se prêtent pas
  // au TXT. Elle est tracée en base (`force_par_super_admin`) : on doit pouvoir
  // dire, plus tard, que ce domaine n'a pas été prouvé mais forcé.
  async function setDomainVerified(id, verified) {
    const { data, error } = await supabase.rpc('forcer_domaine_verifie', {
      p_tenant_id: id, p_verifie: verified
    })
    if (error) throw error
    if (!data) throw new Error('forbidden')
    const t = items.value.find((x) => x.id === id)
    if (t) t.domain_verified = verified
    const f = aValider.value.find((x) => x.tenant_id === id)
    if (f) f.domain_verified = verified
  }

  // ------------------------------------------------------- file de validation --
  //
  // Tout ce qui attend une décision, en un seul appel : les organisations à
  // approuver et les domaines à vérifier. C'est ce que le super-admin doit voir
  // en arrivant, sans avoir à parcourir la liste complète pour le découvrir.
  const aValider = ref([])
  const chargementFile = ref(false)

  async function chargerFile() {
    chargementFile.value = true
    const { data, error } = await supabase.rpc('file_validation_plateforme')
    if (error) console.error('[validation] file', error.message)
    else aValider.value = data || []
    chargementFile.value = false
  }

  const aApprouver = computed(() => aValider.value.filter((t) => t.statut === 'en_attente'))
  const domainesAVerifier = computed(() =>
    aValider.value.filter((t) => t.custom_domain && !t.domain_verified))

  const pending = computed(() => items.value.filter((t) => t.statut === 'en_attente'))
  const approved = computed(() => items.value.filter((t) => t.statut === 'approuve'))
  const totalRevenue = computed(() => items.value.reduce((s, t) => s + Number(t.ca_total || 0), 0))

  return {
    items, loading, pending, approved, totalRevenue, load, setStatus,
    setDomainVerified, verifierDomaine,
    aValider, chargementFile, chargerFile, aApprouver, domainesAVerifier
  }
})
