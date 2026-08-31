import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/useAuthStore'
import { installerPrimeVue } from '@/services/primevue'
import { parseHost, urlPubliqueTenant } from '@/services/host'

// Pages du site public — partagées entre le site historique (/site) et
// le site d'une organisation (/c/:slug). Les noms de route sont suffixés
// pour rester uniques.
// LE MARQUEUR DU SITE VISITEUR — il commande le chargement de PrimeVue.
//
// Pose ici, dans la fabrique, il couvre d'un coup les DEUX arbres publics
// (/site et /c/:slug). Le garde plus bas s'en sert a l'envers : PrimeVue est
// installe pour tout ce qui n'est PAS marque. Cette inversion est deliberee —
// une route nouvelle, oubliee, recevra PrimeVue et fonctionnera. L'inverse
// produirait un ecran casse que personne ne verrait avant la production.
const META_PUBLIC = { sansPrimeVue: true }

const publicChildren = (suffix = '') => [
  { path: '', name: `pub-home${suffix}`, component: () => import('@/views/public/PublicHome.vue'), meta: META_PUBLIC },
  { path: 'musees', name: `pub-catalog${suffix}`, component: () => import('@/views/public/PublicCatalog.vue'), meta: META_PUBLIC },
  { path: 'boutiques', name: `pub-boutiques${suffix}`, component: () => import('@/views/public/PublicBoutiques.vue'), meta: META_PUBLIC },
  { path: 'musees/:id', name: `pub-museum${suffix}`, component: () => import('@/views/public/PublicMuseum.vue'), meta: META_PUBLIC },
  // Parcours voulu : musée → salle → œuvres. La salle est une étape à part entière,
  // pas un simple libellé : c'est elle qui donne le sentiment de se déplacer.
  { path: 'secteurs/:id', name: `pub-sector${suffix}`, component: () => import('@/views/public/PublicSector.vue'), meta: META_PUBLIC },
  { path: 'musees/:id/boutique', name: `pub-museum-boutique${suffix}`, component: () => import('@/views/public/PublicMuseumBoutique.vue'), meta: META_PUBLIC },
  { path: 'objets/:id', name: `pub-object${suffix}`, component: () => import('@/views/public/PublicObject.vue'), meta: META_PUBLIC },
  { path: 'visite/:id', name: `pub-tour${suffix}`, component: () => import('@/views/public/PublicTour.vue'), meta: META_PUBLIC },
  // Cible du QR affiché sur l'ordinateur ; « demo » ouvre la pièce générée.
  { path: 'ar/:id', name: `pub-ar${suffix}`, component: () => import('@/views/public/PublicAr.vue'), meta: META_PUBLIC },
  // Guide Spectral : la case entière, grandeur nature, avec son guide.
  // `?audio=1` bascule en mode audio-seul (accessibilité, appareil sans WebXR).
  { path: 'spectral/:id', name: `pub-spectral${suffix}`, component: () => import('@/views/public/PublicSpectral.vue'), meta: META_PUBLIC },
  { path: 'genealogie', name: `pub-genealogy${suffix}`, component: () => import('@/views/public/PublicGenealogy.vue'), meta: META_PUBLIC },
  { path: 'personnages/:id', name: `pub-personnage${suffix}`, component: () => import('@/views/public/PublicPersonnage.vue'), meta: META_PUBLIC },
  { path: 'panier', name: `pub-cart${suffix}`, component: () => import('@/views/public/PublicCart.vue'), meta: META_PUBLIC },
  // Porte d'entrée du site de l'organisation : un seul formulaire, visiteur ET
  // personnel. C'est le rôle du compte qui décide de la suite (site ou ERP).
  { path: 'connexion', name: `pub-login${suffix}`, component: () => import('@/views/public/PublicLogin.vue'), meta: META_PUBLIC },
  { path: 'quetes/:id', name: `pub-quest${suffix}`, component: () => import('@/views/public/PublicQuest.vue'), meta: META_PUBLIC },
  { path: 'compte', name: `pub-account${suffix}`, component: () => import('@/views/public/PublicAccount.vue'), meta: META_PUBLIC }
]

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue')
  },
  // Vitrine de la plateforme + inscription d'une organisation.
  // Un membre du personnel connecté est renvoyé vers son tableau de bord.
  {
    path: '/',
    name: 'platform-home',
    component: () => import('@/views/platform/PlatformHome.vue'),
    beforeEnter: async () => {
      const auth = useAuthStore()
      await auth.ensureReady()
      return auth.isStaff ? { name: 'dashboard' } : true
    }
  },
  { path: '/inscription', name: 'platform-signup', component: () => import('@/views/platform/SignupView.vue') },
  // Installation de la plateforme : désignation du super-admin. La page se
  // referme d'elle-même dès qu'un super-admin existe (vérifié en base).
  { path: '/installation', name: 'platform-setup', component: () => import('@/views/platform/SetupPlatformView.vue') },
  // Documents juridiques de la plateforme — liés par la case à cocher de
  // l'inscription. Publics : ils doivent être lisibles avant de créer un compte.
  { path: '/conditions', name: 'platform-terms', component: () => import('@/views/platform/LegalView.vue') },
  { path: '/confidentialite', name: 'platform-privacy', component: () => import('@/views/platform/LegalView.vue') },
  {
    path: '/site',
    component: () => import('@/layouts/PublicLayout.vue'),
    // SUR LE DOMAINE DE LA PLATEFORME, `/site` NE DÉSIGNE AUCUNE ORGANISATION.
    // C'est la vitrine qui y répond : l'endroit où une institution vient créer
    // son espace. Sur un sous-domaine, en revanche, `/site` EST le site du
    // locataire — on n'y touche pas. En local non plus, sans quoi le site public
    // deviendrait intestable.
    beforeEnter: () => (parseHost().kind === 'platform' ? { name: 'platform-home' } : true),
    children: publicChildren()
  },
  // Site public d'une organisation : /c/<slug>
  {
    path: '/c/:slug',
    component: () => import('@/layouts/PublicLayout.vue'),
    children: publicChildren('-c')
  },
  {
    path: '/',
    // Chargé à la demande, comme PublicLayout. Importé statiquement, il
    // entraînait la barre latérale, six stores métier et les composants de
    // l'ERP dans le fichier que télécharge le moindre visiteur du site public.
    component: () => import('@/layouts/AdminLayout.vue'),
    meta: { requiresStaff: true },
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        // Aiguilleur : pilotage de la plateforme sur nexacode.store, ERP de
        // l'organisation sur son sous-domaine. Même URL, deux postes de travail.
        component: () => import('@/views/DashboardEntry.vue'),
        meta: { title: 'admin.nav.dashboard', icon: 'pi pi-chart-line' }
      },
      {
        path: 'musees',
        name: 'musees',
        component: () => import('@/views/MuseumsView.vue'),
        meta: { title: 'admin.nav.museums', group: 'admin.groups.collections', icon: 'pi pi-building' }
      },
      {
        path: 'secteurs',
        name: 'secteurs',
        component: () => import('@/views/SectorsView.vue'),
        meta: { title: 'admin.nav.sectors', group: 'admin.groups.collections', icon: 'pi pi-sitemap' }
      },
      {
        path: 'objets',
        name: 'objets',
        component: () => import('@/views/ObjectsView.vue'),
        meta: { title: 'admin.nav.objects', group: 'admin.groups.collections', icon: 'pi pi-box' }
      },
      {
        path: 'objets/:id',
        name: 'objet-detail',
        component: () => import('@/views/ObjectDetailView.vue'),
        meta: { title: 'admin.nav.objectDetail', group: 'admin.groups.collections', icon: 'pi pi-box' }
      },
      {
        path: 'visites',
        name: 'visites',
        component: () => import('@/views/ToursView.vue'),
        meta: { title: 'admin.nav.tours', group: 'admin.groups.collections', icon: 'pi pi-compass' }
      },
      {
        path: 'genealogie',
        name: 'genealogie',
        component: () => import('@/views/GenealogyView.vue'),
        meta: { title: 'admin.nav.genealogyFull', icon: 'pi pi-share-alt' }
      },
      {
        path: 'produits',
        name: 'produits',
        component: () => import('@/views/ProductsView.vue'),
        meta: { title: 'admin.nav.products', group: 'admin.groups.commerce', icon: 'pi pi-shopping-bag' }
      },
      {
        path: 'commandes',
        name: 'commandes',
        component: () => import('@/views/OrdersView.vue'),
        meta: { title: 'admin.nav.orders', group: 'admin.groups.commerce', icon: 'pi pi-receipt' }
      },
      {
        path: 'tarifs',
        name: 'tarifs',
        component: () => import('@/views/PricingView.vue'),
        meta: { title: 'admin.nav.pricing', icon: 'pi pi-euro' }
      },
      {
        path: 'evenements',
        name: 'evenements',
        component: () => import('@/views/EventsView.vue'),
        meta: { title: 'admin.nav.events', group: 'admin.groups.engagement', icon: 'pi pi-calendar' }
      },
      {
        path: 'faq',
        name: 'faq',
        component: () => import('@/views/FaqView.vue'),
        meta: { title: 'admin.nav.faq', group: 'admin.groups.engagement', icon: 'pi pi-question-circle' }
      },
      {
        path: 'assistant-vocal',
        name: 'assistant-vocal',
        component: () => import('@/views/VoiceAssistantsView.vue'),
        meta: { title: 'admin.nav.voice', group: 'admin.groups.engagement', icon: 'pi pi-volume-up' }
      },
      {
        path: 'assistant-installation',
        name: 'assistant-installation',
        component: () => import('@/views/SetupAgentView.vue'),
        meta: { title: 'admin.nav.setupAgent', icon: 'pi pi-sparkles' }
      },
      {
        path: 'questions',
        name: 'questions',
        component: () => import('@/views/GuideQuestionsView.vue'),
        meta: { title: 'admin.nav.questions', group: 'admin.groups.engagement', icon: 'pi pi-comments' }
      },
      {
        path: 'quetes',
        name: 'quetes',
        component: () => import('@/views/QuestsView.vue'),
        meta: { title: 'admin.nav.quests', group: 'admin.groups.engagement', icon: 'pi pi-compass' }
      },
      {
        path: 'reseau',
        name: 'reseau',
        component: () => import('@/views/NetworkView.vue'),
        meta: { title: 'admin.nav.network', group: 'admin.groups.system', icon: 'pi pi-share-alt' }
      },
      {
        path: 'brouillons',
        name: 'brouillons',
        component: () => import('@/views/DraftsView.vue'),
        meta: { title: 'admin.nav.drafts', icon: 'pi pi-inbox' }
      },
      {
        path: 'messagerie',
        name: 'messagerie',
        component: () => import('@/views/MessagesView.vue'),
        meta: { title: 'admin.nav.messages', group: 'admin.groups.engagement', icon: 'pi pi-envelope' }
      },
      {
        path: 'campagnes',
        name: 'campagnes',
        component: () => import('@/views/CampaignsView.vue'),
        meta: { title: 'admin.nav.campaigns', group: 'admin.groups.engagement', icon: 'pi pi-send' }
      },
      {
        path: 'visiteurs',
        name: 'visiteurs',
        component: () => import('@/views/AudienceView.vue'),
        meta: { title: 'admin.nav.audience', group: 'admin.groups.engagement', icon: 'pi pi-users' }
      },
      {
        path: 'organisation',
        name: 'organisation',
        component: () => import('@/views/OrganizationView.vue'),
        meta: { title: 'admin.nav.organization', group: 'admin.groups.system', icon: 'pi pi-building' }
      },
      {
        path: 'parametres',
        name: 'parametres',
        component: () => import('@/views/SiteSettingsView.vue'),
        meta: { title: 'admin.nav.settings', group: 'admin.groups.system', icon: 'pi pi-cog' }
      },
      // Back-office plateforme — réservé au super-admin
      {
        path: 'plateforme/organisations',
        name: 'admin-tenants',
        component: () => import('@/views/admin/TenantsView.vue'),
        meta: { title: 'admin.nav.tenants', requiresSuperAdmin: true, icon: 'pi pi-sitemap' }
      }
    ]
  },

  // ─── TOUT LE RESTE ────────────────────────────────────────────────────────
  //
  // Il n'y avait AUCUNE route de repli : n'importe quelle adresse inconnue
  // donnait un écran blanc, sans message ni retour possible. Une faute de frappe
  // dans une URL, un lien partagé qui a vieilli, un favori vers un écran retiré
  // — et le visiteur se retrouvait devant du vide, en se demandant si le site
  // était en panne.
  //
  // ON RAMÈNE OÙ L'ON ÉTAIT, pas à la racine de la plateforme. Un visiteur perdu
  // sur le site d'une chefferie doit revenir à l'accueil DE CETTE CHEFFERIE : le
  // renvoyer sur la vitrine générale lui ferait quitter le musée qu'il visitait.
  {
    path: '/:reste(.*)*',
    name: 'introuvable',
    redirect: (to) => {
      const chemin = to.path || '/'
      // On découpe plutôt qu'on ne filtre : '/c/madjin/musees' donne
      // ['', 'c', 'madjin', 'musees'], et la chefferie est en troisième position.
      const morceaux = chemin.split('/')
      if (morceaux[1] === 'c' && morceaux[2]) return '/c/' + morceaux[2]
      if (chemin.startsWith('/site')) return '/site'
      return '/'
    }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to) => {
  // PRIMEVUE, AVANT D'ENTRER — et seulement si l'écran en a besoin.
  //
  // On l'installe pour tout ce qui n'est PAS marqué site visiteur. Attendre ici
  // plutôt que de lancer le chargement en arrière-plan est ce qui supprime la
  // course : un composant PrimeVue ne peut pas se monter avant que le plugin
  // soit posé, puisque sa route ne s'ouvre pas tant que cette promesse n'est
  // pas tenue.
  //
  // Le site public, lui, ne paie rien : ni le téléchargement, ni l'attente.
  if (!to.matched.some((r) => r.meta?.sansPrimeVue)) {
    await installerPrimeVue().catch((e) => console.error('[primevue]', e.message))
  }

  const auth = useAuthStore()
  await auth.ensureReady()
  const needsStaff = to.matched.some((r) => r.meta.requiresStaff)
  if (needsStaff && !auth.isStaff) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  // Back-office plateforme : réservé au super-admin (la base le vérifie aussi).
  const needsSuperAdmin = to.matched.some((r) => r.meta.requiresSuperAdmin)
  if (needsSuperAdmin && !auth.isSuperAdmin) return { name: 'dashboard' }

  // L'ERP D'UNE ORGANISATION VIT SUR SON SOUS-DOMAINE, ET NULLE PART AILLEURS.
  //
  //   nexacode.store/dashboard        → pilotage de la plateforme (super-admin)
  //   madjin.nexacode.store/dashboard → ERP de la CHEFFERIE BATOUFAM
  //
  // Un membre du personnel arrivé sur la plateforme, ou sur le sous-domaine
  // d'une AUTRE organisation, est renvoyé chez lui. Le renvoi change d'origine,
  // donc `window.location` et non le routeur.
  //
  // Il devra s'y reconnecter : la session Supabase est conservée dans le
  // localStorage, cloisonné par origine, et ne franchit pas les sous-domaines.
  // C'est le prix du cloisonnement, et il est assumé — l'alternative (un cookie
  // posé sur .nexacode.store) rendrait le jeton lisible depuis le site de
  // n'importe quel locataire.
  //
  // Le super-admin échappe à la règle : il doit pouvoir intervenir partout.
  if (needsStaff && !auth.isSuperAdmin) {
    const { kind, slug } = parseHost()
    const sien = auth.tenant?.slug || null
    const ailleurs = !!sien
      && (kind === 'platform' || (kind === 'subdomain' && slug !== sien))
    if (ailleurs) {
      window.location.assign(`${urlPubliqueTenant(sien)}/dashboard`)
      return false
    }
  }

  // /login sert les deux publics. Une fois authentifié, on n'y reste pas :
  // le personnel part vers son ERP, le visiteur vers son compte. C'est aussi ce
  // qui rattrape le retour de Google, où le rôle n'est connu qu'après coup.
  if (to.name === 'login' && auth.user) {
    return auth.isStaff ? { name: 'dashboard' } : '/site/compte'
  }

  // Phase 2 — sur un hôte d'ORGANISATION (sous-domaine <slug>.musea.nexacode.store ou domaine
  // personnalisé), la racine et l'inscription mènent au site de l'organisation, pas à
  // la vitrine de la plateforme. En local/plateforme (kind 'local'/'platform'), rien ne change.
  if (to.name === 'platform-home' || to.name === 'platform-signup') {
    const kind = parseHost().kind
    if ((kind === 'subdomain' || kind === 'custom') && !auth.isStaff) return { name: 'pub-home' }
  }

  // Sur un hôte d'organisation, `/login` (porte de la PLATEFORME) n'a pas lieu d'être :
  // le site du tenant a sa propre page de connexion, à ses couleurs, qui sert aussi
  // bien le visiteur que le personnel. On y renvoie pour n'avoir qu'une seule porte.
  if (to.name === 'login') {
    const kind = parseHost().kind
    if (kind === 'subdomain' || kind === 'custom') {
      return { name: 'pub-login', query: to.query }
    }
  }
  return true
})

export default router
