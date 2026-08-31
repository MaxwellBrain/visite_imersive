import { createApp } from 'vue'
import { createPinia } from 'pinia'

import { enregistrerApp } from '@/services/primevue'

// <model-viewer> N'EST PLUS CHARGÉ ICI. Il l'était au démarrage, donc sur CHAQUE
// page — 1 Mo, près d'un tiers du JavaScript du site, pour un composant que la
// plupart des visiteurs n'ouvrent jamais. Il est désormais demandé au moment où
// une visionneuse s'ouvre : voir src/services/modelViewer.js.

import 'primeicons/primeicons.css'
import './style.css'

import App from './App.vue'
import router from './router'
import { activerPrechargement, prechargerAuRepos } from '@/services/prefetch'
import i18n, { prechargerLangue } from './i18n'
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

// La palette ERP a suivi PrimeVue dans services/primevue.js : elle n'a de sens
// qu'avec le thème, et la garder ici aurait ramené definePreset — donc tout le
// moteur de thèmes — dans le chemin critique du site public.

// Applique le thème mémorisé avant le montage pour éviter le flash.
if (localStorage.getItem('vi-theme') === 'dark') {
  document.documentElement.classList.add('app-dark')
}

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(i18n)
// PRIMEVUE N'EST PLUS INSTALLÉ ICI. Il l'est à la demande, par le garde de
// route, pour les seuls écrans qui s'en servent — c'est-à-dire l'ERP. Le
// visiteur d'un musée ne télécharge plus la bibliothèque de composants du
// back-office pour regarder une œuvre. Voir services/primevue.js.
//
// L'application est déposée auprès du service : c'est le garde de route qui
// décidera, écran par écran, s'il faut poser le thème avant d'entrer.
enregistrerApp(app)

// Vérifie la session Supabase avant le 1er rendu (le guard de route attend ensureReady()).
useAuthStore(pinia).init()

// Le catalogue de la langue affichée est chargé À PART du bundle principal
// (202 Ko pour les deux langues, dont une que le visiteur ne lira jamais).
// On attend son arrivée avant de monter : sans cela, la première image de
// l'écran afficherait des clés brutes le temps du téléchargement.
prechargerLangue()
  .catch((e) => console.error('[i18n] catalogue introuvable', e))
  .finally(() => app.mount('#app'))

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
