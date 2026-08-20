<script setup>
// POSTE DE PILOTAGE DE LA PLATEFORME — nexacode.store/dashboard
//
// À ne pas confondre avec l'ERP d'une organisation, qui porte la même adresse
// mais sur SON sous-domaine (madjin.nexacode.store/dashboard). Ici on ne gère
// aucune collection : on suit les organisations hébergées.
//
// Tout vient de la RPC `admin_tenants_overview` (déjà utilisée par l'écran
// « Organisations »), qui refuse tout appelant autre que le super-admin. Aucune
// requête supplémentaire : les chiffres ci-dessous sont des agrégats de la même
// liste, calculés à l'affichage.
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import { formatMontant } from '@/constants/options'
import { useAdminTenantStore } from '@/stores/useAdminTenantStore'
import { urlPubliqueTenant } from '@/services/host'

const router = useRouter()
const store = useAdminTenantStore()

onMounted(() => { if (!store.items.length) store.load() })

const total = computed(() => store.items.length)
const enLigne = computed(() => store.approved.length)
const enAttente = computed(() => store.pending.length)

function somme(champ) {
  return store.items.reduce((s, t) => s + Number(t[champ] || 0), 0)
}

const stats = computed(() => [
  { label: 'platform.dash.statTenants', value: total.value, icon: 'pi pi-sitemap' },
  { label: 'platform.dash.statOnline', value: enLigne.value, icon: 'pi pi-globe' },
  // La seule carte qui appelle une action : une organisation en attente est une
  // organisation qui ne peut pas travailler. On la signale, on ne l'enterre pas.
  { label: 'platform.dash.statPending', value: enAttente.value, icon: 'pi pi-clock', alerte: enAttente.value > 0 },
  { label: 'platform.dash.statRevenue', value: formatMontant(store.totalRevenue), icon: 'pi pi-wallet' }
])

// Ce que la plateforme héberge, tous locataires confondus.
const volumes = computed(() => [
  { label: 'platform.dash.volMuseums', value: somme('nb_musees') },
  { label: 'platform.dash.volObjects', value: somme('nb_objets') },
  { label: 'platform.dash.volProducts', value: somme('nb_produits') },
  { label: 'platform.dash.volMembers', value: somme('nb_membres') },
  { label: 'platform.dash.volOrders', value: somme('nb_commandes') }
])

// Les plus récentes d'abord : c'est là que se trouve ce qui demande une décision.
const recentes = computed(() =>
  [...store.items].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
)

const SEVERITE = { en_attente: 'warn', approuve: 'success', suspendu: 'danger' }

function dateFmt(d) {
  return d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}
function adresse(slug) { return urlPubliqueTenant(slug) }
function versOrganisations() { router.push('/plateforme/organisations') }
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('platform.dash.title') }}</h1>
        <p class="vi-page__subtitle">{{ $t('platform.dash.subtitle') }}</p>
      </div>
      <Button icon="pi pi-sitemap" :label="$t('platform.dash.manage')" outlined @click="versOrganisations" />
    </div>

    <div class="pd-stats">
      <div v-for="s in stats" :key="s.label" class="pd-stat" :class="{ 'pd-stat--alerte': s.alerte }">
        <span class="pd-stat__top">
          <span class="pd-stat__label">{{ $t(s.label) }}</span>
          <span class="pd-stat__icon"><i :class="s.icon" /></span>
        </span>
        <span class="pd-stat__value">{{ s.value }}</span>
      </div>
    </div>

    <!-- Une inscription en attente bloque une organisation entière : elle ne
         peut ni publier son site, ni être vue. C'est l'action prioritaire. -->
    <button v-if="enAttente" class="pd-alerte" @click="versOrganisations">
      <span class="pd-alerte__icon"><i class="pi pi-bell" /></span>
      <span class="pd-alerte__txt">
        <strong>{{ $t('platform.dash.pendingTitle', { n: enAttente }) }}</strong>
        <span>{{ $t('platform.dash.pendingHint') }}</span>
      </span>
      <i class="pi pi-arrow-right pd-alerte__go" />
    </button>

    <h2 class="pd-sec">{{ $t('platform.dash.hosted') }}</h2>
    <div class="pd-vols">
      <div v-for="v in volumes" :key="v.label" class="pd-vol">
        <span class="pd-vol__value">{{ v.value }}</span>
        <span class="pd-vol__label">{{ $t(v.label) }}</span>
      </div>
    </div>

    <h2 class="pd-sec">{{ $t('platform.dash.tenants') }}</h2>
    <p v-if="!store.loading && !total" class="pd-vide">{{ $t('platform.dash.empty') }}</p>
    <ul v-else class="pd-liste">
      <li v-for="t in recentes" :key="t.id">
        <span class="pd-liste__main">
          <strong>{{ t.nom }}</strong>
          <!-- L'adresse d'une organisation est son sous-domaine : on la montre
               telle qu'on la donnerait au téléphone, et elle s'ouvre. -->
          <a :href="adresse(t.slug)" target="_blank" rel="noopener" class="pd-liste__url">
            {{ adresse(t.slug).replace(/^https?:\/\//, '') }}
          </a>
        </span>
        <Tag :value="$t('admin.tenants.s' + (t.statut === 'approuve' ? 'Approved' : t.statut === 'suspendu' ? 'Suspended' : 'Pending'))"
             :severity="SEVERITE[t.statut] || 'info'" />
        <span class="pd-liste__chiffres">
          <span><i class="pi pi-building" /> {{ t.nb_musees || 0 }}</span>
          <span><i class="pi pi-box" /> {{ t.nb_objets || 0 }}</span>
          <span><i class="pi pi-receipt" /> {{ t.nb_commandes || 0 }}</span>
          <span class="pd-liste__ca">{{ formatMontant(t.ca_total || 0) }}</span>
        </span>
        <span class="pd-liste__date">{{ dateFmt(t.created_at) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.pd-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
.pd-stat { background: var(--surface-card, #fff); border: 1px solid var(--surface-border, #e5e7eb); border-radius: 12px; padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: 0.6rem; }
.pd-stat--alerte { border-color: #f59e0b; background: #fffbeb; }
.pd-stat__top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.pd-stat__label { font-size: 0.82rem; color: var(--text-color-secondary, #6b7280); }
.pd-stat__icon { width: 2rem; height: 2rem; border-radius: 8px; display: grid; place-items: center; background: var(--surface-100, #f3f4f6); }
.pd-stat--alerte .pd-stat__icon { background: #fde68a; }
.pd-stat__value { font-size: 1.7rem; font-weight: 700; line-height: 1; }

.pd-alerte { width: 100%; display: flex; align-items: center; gap: 0.9rem; text-align: left; cursor: pointer; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 12px; padding: 0.9rem 1.1rem; margin-bottom: 1.5rem; }
.pd-alerte__icon { width: 2.2rem; height: 2.2rem; border-radius: 50%; display: grid; place-items: center; background: #fde68a; flex: none; }
.pd-alerte__txt { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; }
.pd-alerte__txt span { font-size: 0.85rem; color: #92400e; }
.pd-alerte__go { color: #92400e; }

.pd-sec { font-size: 1.05rem; font-weight: 700; margin: 1.5rem 0 0.75rem; }
.pd-vols { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; }
.pd-vol { background: var(--surface-card, #fff); border: 1px solid var(--surface-border, #e5e7eb); border-radius: 10px; padding: 0.8rem 1rem; display: flex; flex-direction: column; gap: 0.2rem; }
.pd-vol__value { font-size: 1.3rem; font-weight: 700; }
.pd-vol__label { font-size: 0.78rem; color: var(--text-color-secondary, #6b7280); }

.pd-liste { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.pd-liste li { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; background: var(--surface-card, #fff); border: 1px solid var(--surface-border, #e5e7eb); border-radius: 10px; padding: 0.75rem 1rem; }
.pd-liste__main { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; min-width: 200px; }
.pd-liste__url { font-size: 0.8rem; color: var(--primary-color, #0e6f5c); text-decoration: none; }
.pd-liste__url:hover { text-decoration: underline; }
.pd-liste__chiffres { display: flex; gap: 0.9rem; font-size: 0.85rem; color: var(--text-color-secondary, #6b7280); }
.pd-liste__ca { font-weight: 600; color: var(--text-color, #111827); }
.pd-liste__date { font-size: 0.8rem; color: var(--text-color-secondary, #6b7280); min-width: 90px; text-align: right; }
.pd-vide { color: var(--text-color-secondary, #6b7280); }
</style>
