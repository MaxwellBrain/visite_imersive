import { createApp } from 'vue'
import { createPinia } from 'pinia'

import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import { definePreset } from '@primevue/themes'
import ToastService from 'primevue/toastservice'
import ConfirmationService from 'primevue/confirmationservice'
import Tooltip from 'primevue/tooltip'

// <model-viewer> N'EST PLUS CHARGÉ ICI. Il l'était au démarrage, donc sur CHAQUE
// page — 1 Mo, près d'un tiers du JavaScript du site, pour un composant que la
// plupart des visiteurs n'ouvrent jamais. Il est désormais demandé au moment où
// une visionneuse s'ouvre : voir src/services/modelViewer.js.

import 'primeicons/primeicons.css'
import './style.css'

import App from './App.vue'
import router from './router'
import { activerPrechargement, prechargerAuRepos } from '@/services/prefetch'
import i18n from './i18n'
import { useAuthStore } from '@/stores/useAuthStore'

// PWA : service worker (public/sw.js — écrit à la main, sans dépendance).
// Rend le site installable (écran d'accueil) et consultable hors-ligne.
//
// IMPORTANT : uniquement en production. En développement, un service worker
// servirait d'anciennes versions en cache et les modifications ne s'afficheraient
// jamais ; on le désinstalle donc activement et on vide ses caches.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[pwa] sw non enregistré :', e.message))
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()))
    if (window.caches) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
  }
}

// Palette ERP « Génius » : orange #F26B21 (primaire) + navy #16223C.
const Marron = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#fef3ec',
      100: '#fcdcc6',
      200: '#f9bd97',
      300: '#f69a67',
      400: '#f47f40',
      500: '#f26b21',
      600: '#d85817',
      700: '#b44513',
      800: '#8f3612',
      900: '#742d12',
      950: '#3f1507'
    }
  }
})

// Applique le thème mémorisé avant le montage pour éviter le flash.
if (localStorage.getItem('vi-theme') === 'dark') {
  document.documentElement.classList.add('app-dark')
}

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(i18n)
app.use(PrimeVue, {
  theme: {
    preset: Marron,
    options: {
      darkModeSelector: '.app-dark',
      cssLayer: false
    }
  }
})
app.use(ToastService)
app.use(ConfirmationService)
app.directive('tooltip', Tooltip)

// Vérifie la session Supabase avant le 1er rendu (le guard de route attend ensureReady()).
useAuthStore(pinia).init()

app.mount('#app')

// PRÉCHARGEMENT DES ROUTES — après le montage, pour ne rien disputer au premier
// rendu. Le découpage par route évite de tout télécharger au démarrage, mais
// fait payer le PREMIER accès à chaque page (mesuré : 1,2 s pour les musées,
// 6,3 s pour les boutiques). On profite du survol d'un lien, pendant lequel
// personne n'attend, pour aller chercher le code à l'avance.
router.isReady().then(() => {
  activerPrechargement(router)

  // Les trois destinations que presque tout visiteur finit par ouvrir. On s'en
  // tient à celles-là : tout précharger reviendrait à annuler le découpage.
  const base = router.currentRoute.value.path.startsWith('/c/')
    ? '/c/' + router.currentRoute.value.params.slug
    : '/site'
  prechargerAuRepos(router, [`${base}/musees`, `${base}/boutiques`, `${base}/genealogie`])
})
