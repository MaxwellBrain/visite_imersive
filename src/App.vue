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
//
// ⚠️ CE DRAPEAU DOIT ÊTRE RÉACTIF — corrigé le 2026-08-04.
//
// Il était calculé une seule fois, dans un `onMounted`, à partir de la promesse
// d'installation. Sur le parcours réel, cette promesse n'existe pas encore à ce
// moment-là : le visiteur arrive par le site public, qui est marqué
// `sansPrimeVue` et n'installe donc rien. Le test échouait, le drapeau restait
// faux POUR TOUTE LA SESSION, et plus aucune boîte de confirmation ni aucun
// toast ne se montait ensuite dans l'ERP — « Supprimer » ne supprimait rien, en
// silence. Le service `primevue.js` expose désormais un `ref` : peu importe qui
// arrive en premier.
import { defineAsyncComponent } from 'vue'
import { primeVuePose } from '@/services/primevue'

const Toast = defineAsyncComponent(() => import('primevue/toast'))
const ConfirmDialog = defineAsyncComponent(() => import('primevue/confirmdialog'))
</script>

<template>
  <router-view />
  <template v-if="primeVuePose">
    <Toast position="top-right" />
    <ConfirmDialog />
  </template>
</template>
