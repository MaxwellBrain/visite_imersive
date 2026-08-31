<script setup>
// LES DEUX SURFACES GLOBALES DE PRIMEVUE, CHARGÉES SEULEMENT SI ELLES SERVENT.
//
// Elles vivent à la racine de l'application, donc un import statique les aurait
// ramenées dans le chemin critique de TOUTES les pages — y compris celles du
// site public, qui n'affichent ni toast ni boîte de confirmation. En composants
// asynchrones, leur code ne part que lorsqu'un écran les utilise vraiment.
//
// LE v-if N'EST PAS UNE PRÉCAUTION DÉCORATIVE : ces deux composants exigent que
// le plugin soit installé (ils lisent des services injectés). Les monter avant
// produirait une erreur d'injection au premier rendu.
import { defineAsyncComponent, shallowRef, onMounted } from 'vue'
import { primeVuePret } from '@/services/primevue'

const Toast = defineAsyncComponent(() => import('primevue/toast'))
const ConfirmDialog = defineAsyncComponent(() => import('primevue/confirmdialog'))

const primeVueInstalle = shallowRef(false)
onMounted(() => {
  // Le garde de route installe PrimeVue avant d'entrer sur un écran qui en a
  // besoin ; on se contente d'attendre cette promesse si elle existe.
  const p = primeVuePret()
  if (p) p.then(() => { primeVueInstalle.value = true })
})
</script>

<template>
  <router-view />
  <template v-if="primeVueInstalle">
    <Toast position="top-right" />
    <ConfirmDialog />
  </template>
</template>
