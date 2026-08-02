import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/services/supabase'
import { setPublicTenant } from '@/services/publicApi'
import { parseHost } from '@/services/host'
import { useAuthStore } from './useAuthStore'

// Organisation dont on affiche le site public.
// Résolution, par ordre de priorité :
//   1. domaine personnalisé (chefferie-bandjoun.cm) — quand l'hébergement le permettra
//   2. segment d'URL /c/:slug
//   3. aucune → site historique (première organisation approuvée)
export const usePublicTenantStore = defineStore('publicTenant', () => {
  const tenant = ref(null)
  const status = ref('idle') // idle | loading | ready | not_found
  const apercu = ref(false)  // site pas encore publié, visible par son propriétaire
  let resolvedKey = null     // évite de recharger la même organisation

  const isReady = computed(() => status.value === 'ready')
  const notFound = computed(() => status.value === 'not_found')

  async function resolveBySlug(slug) {
    const key = `slug:${slug}`
    if (resolvedKey === key && tenant.value) return tenant.value
    status.value = 'loading'
    const { data } = await supabase
      .from('tenants').select('*').eq('slug', String(slug || '').toLowerCase()).maybeSingle()
    apply(data, key)
    return tenant.value
  }

  // Domaine personnalisé : utilisé plus tard, quand le client aura pointé son DNS.
  async function resolveByDomain(host) {
    const key = `host:${host}`
    if (resolvedKey === key && tenant.value) return tenant.value
    status.value = 'loading'
    const { data } = await supabase
      .from('tenants').select('*')
      .eq('custom_domain', String(host || '').toLowerCase().replace(/^www\./, ''))
      .eq('domain_verified', true)
      .maybeSingle()
    apply(data, key)
    return tenant.value
  }

  // Résolution par NOM D'HÔTE (Phase 2). Priorité au sous-domaine <slug>.musea.nexacode.store
  // puis au domaine personnalisé. Renvoie true si l'hôte désigne une organisation
  // précise (sous-domaine ou domaine perso), false si l'hôte est neutre
  // (plateforme, réservé, local) → l'appelant enchaîne alors sur le repli /c/:slug.
  async function resolveByHost(hostname) {
    const { kind, slug } = parseHost(hostname)
    if (kind === 'subdomain') { await resolveBySlug(slug); return true }
    if (kind === 'custom') {
      await resolveByDomain(hostname || (typeof window !== 'undefined' ? window.location.hostname : ''))
      return true
    }
    return false // 'platform' | 'reserved' | 'local' : pas d'organisation dans l'hôte
  }

  // Site historique : aucune organisation dans l'URL → la première approuvée.
  async function resolveDefault() {
    if (resolvedKey === 'default' && tenant.value) return tenant.value
    status.value = 'loading'
    const { data } = await supabase
      .from('tenants').select('*').eq('statut', 'approuve').order('id').limit(1).maybeSingle()
    apply(data, 'default')
    return tenant.value
  }

  function apply(data, key) {
    // Pour un visiteur, une organisation non approuvée est indiscernable
    // d'une organisation inexistante. En revanche, ses propres membres (et le
    // super-admin) doivent pouvoir prévisualiser leur site avant publication —
    // sinon on ne peut jamais vérifier son travail avant de le mettre en ligne.
    const auth = useAuthStore()
    const proprietaire = !!data && (auth.isSuperAdmin || (auth.tenantId != null && auth.tenantId === data.id))

    if (!data || (data.statut !== 'approuve' && !proprietaire)) {
      tenant.value = null
      resolvedKey = null
      apercu.value = false
      setPublicTenant(null)
      status.value = 'not_found'
      return
    }
    tenant.value = data
    resolvedKey = key
    apercu.value = data.statut !== 'approuve'
    setPublicTenant(data.id)
    status.value = 'ready'
  }

  function reset() {
    tenant.value = null
    resolvedKey = null
    apercu.value = false
    status.value = 'idle'
    setPublicTenant(null)
  }

  return { tenant, status, apercu, isReady, notFound, resolveBySlug, resolveByDomain, resolveByHost, resolveDefault, reset }
})
