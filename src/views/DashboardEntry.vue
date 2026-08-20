<script setup>
// `/dashboard` désigne deux postes de travail différents. Ce n'est pas le chemin
// qui les distingue, c'est l'ADRESSE :
//
//   nexacode.store/dashboard          → pilotage de la PLATEFORME (super-admin) :
//                                       toutes les organisations hébergées.
//   <slug>.nexacode.store/dashboard   → l'ERP de CETTE organisation : ses musées,
//                                       ses œuvres, ses commandes.
//
// Garder la même URL des deux côtés est voulu : chacun apprend une seule adresse,
// « /dashboard », et atterrit chez lui.
import { computed, defineAsyncComponent } from 'vue'
import { parseHost } from '@/services/host'
import { useAuthStore } from '@/stores/useAuthStore'

// Chargées à la demande : sans cela, ouvrir l'un des deux tableaux de bord
// téléchargerait aussi le code de l'autre.
const DashboardView = defineAsyncComponent(() => import('@/views/DashboardView.vue'))
const PlatformDashboard = defineAsyncComponent(() => import('@/views/platform/PlatformDashboard.vue'))

const auth = useAuthStore()

// En développement, les sous-domaines n'existent pas (localhost) : l'hôte local
// vaut la plateforme, sinon le tableau de bord plateforme serait intestable hors
// production. Le rôle reste décisif : un membre du personnel voit son ERP.
const surPlateforme = computed(() => {
  const { kind } = parseHost()
  return (kind === 'platform' || kind === 'local') && auth.isSuperAdmin
})
</script>

<template>
  <PlatformDashboard v-if="surPlateforme" />
  <DashboardView v-else />
</template>
