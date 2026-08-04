<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Menu from 'primevue/menu'
import Popover from 'primevue/popover'
import LangSwitcher from '@/components/LangSwitcher.vue'
import { useTheme } from '@/composables/useTheme'
import { useAuthStore } from '@/stores/useAuthStore'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { useSectorStore } from '@/stores/useSectorStore'
import { useObjectStore } from '@/stores/useObjectStore'
import { usePricingStore } from '@/stores/usePricingStore'
import { useGenealogyStore } from '@/stores/useGenealogyStore'
import { supabase } from '@/services/supabase'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const auth = useAuthStore()
const objectStore = useObjectStore()
const { isDark, toggle } = useTheme()

const isDesktop = ref(window.innerWidth >= 992)
const collapsed = ref(false) // desktop : sidebar réduite (icônes seules)
const drawerOpen = ref(false) // mobile : sidebar en tiroir
const search = ref('')
const year = new Date().getFullYear()

function toggleSidebar() {
  if (isDesktop.value) collapsed.value = !collapsed.value
  else drawerOpen.value = !drawerOpen.value
}

// Badge « à traiter » : nombre d'objets en brouillon (comme les compteurs orange du template).
const draftCount = computed(() => objectStore.items.filter((o) => !o.published).length)

// « Voir le site » doit mener au site de MON organisation (/c/<slug>).
// Sans cela, /site résout « la première organisation approuvée » et renvoie
// tout le monde vers le site du premier inscrit.
const lienMonSite = computed(() => (auth.tenant?.slug ? `/c/${auth.tenant.slug}` : '/site'))

// Badge plateforme : organisations en attente de validation (super-admin uniquement).
const pendingTenants = ref(0)
async function loadPendingTenants() {
  if (!auth.isSuperAdmin) { pendingTenants.value = 0; return }
  const { count } = await supabase
    .from('tenants').select('id', { count: 'exact', head: true }).eq('statut', 'en_attente')
  pendingTenants.value = count || 0
}

// Navigation groupée par sections (labels gris majuscules — style Génius).
const navGroups = computed(() => [
  { label: t('admin.nav.grpPilotage'), items: [
    { to: '/dashboard', icon: 'pi pi-th-large', label: t('admin.nav.dashboard') },
    { to: '/assistant-installation', icon: 'pi pi-sparkles', label: t('admin.nav.setupAgent') },
    { to: '/brouillons', icon: 'pi pi-inbox', label: t('admin.nav.drafts') },
    { to: '/quetes', icon: 'pi pi-compass', label: t('admin.nav.quests') },
    { to: '/questions', icon: 'pi pi-comments', label: t('admin.nav.questions') },
    { to: '/reseau', icon: 'pi pi-share-alt', label: t('admin.nav.network') }
  ] },
  { label: t('admin.nav.grpContent'), items: [
    { to: '/musees', icon: 'pi pi-building', label: t('admin.nav.museums') },
    { to: '/secteurs', icon: 'pi pi-sitemap', label: t('admin.nav.sectors') },
    { to: '/objets', icon: 'pi pi-box', label: t('admin.nav.objects'), badge: draftCount.value || null },
    { to: '/visites', icon: 'pi pi-compass', label: t('admin.nav.tours') },
    { to: '/genealogie', icon: 'pi pi-share-alt', label: t('admin.nav.genealogy') }
  ] },
  { label: t('admin.nav.grpCommerce'), items: [
    { to: '/produits', icon: 'pi pi-shopping-bag', label: t('admin.nav.products') },
    { to: '/commandes', icon: 'pi pi-receipt', label: t('admin.nav.orders') },
    { to: '/billets', icon: 'pi pi-qrcode', label: t('admin.nav.tickets') }
  ] },
  { label: t('admin.nav.grpEngagement'), items: [
    { to: '/evenements', icon: 'pi pi-calendar', label: t('admin.nav.events') },
    { to: '/faq', icon: 'pi pi-question-circle', label: t('admin.nav.faq') },
    { to: '/assistant-vocal', icon: 'pi pi-volume-up', label: t('admin.nav.voice') },
    { to: '/visiteurs', icon: 'pi pi-users', label: t('admin.nav.audience') },
    { to: '/campagnes', icon: 'pi pi-send', label: t('admin.nav.campaigns') }
  ] },
  { label: t('admin.nav.grpManagement'), items: [
    { to: '/tarifs', icon: 'pi pi-tag', label: t('admin.nav.pricing') },
    { to: '/organisation', icon: 'pi pi-building', label: t('admin.nav.organization') },
    { to: '/parametres', icon: 'pi pi-cog', label: t('admin.nav.settings') }
  ] },
  // Pilotage de la plateforme — visible uniquement pour le super-admin.
  ...(auth.isSuperAdmin ? [{ label: t('admin.nav.grpPlatform'), items: [
    { to: '/plateforme/organisations', icon: 'pi pi-sitemap', label: t('admin.nav.tenants'), badge: pendingTenants.value || null }
  ] }] : [])
])

const userMenu = ref()
const notifPanel = ref()

const userItems = computed(() => [
  {
    label: auth.user?.email || t('admin.layout.account'),
    items: [
      { label: t('admin.layout.settingsItem'), icon: 'pi pi-cog', command: () => router.push('/parametres') },
      { separator: true },
      { label: t('admin.layout.logout'), icon: 'pi pi-sign-out', command: doSignOut }
    ]
  }
])
const userLabel = computed(() => auth.user?.email?.split('@')[0] || t('admin.layout.account'))
const roleLabel = computed(() => (auth.isStaff ? t('admin.layout.superAdmin') : (auth.role || '')))
const initials = computed(() => (auth.user?.email || 'AD').slice(0, 2).toUpperCase())
async function doSignOut() {
  await auth.signOut()
  router.push({ name: 'login' })
}
function onSearch() {
  if (!search.value.trim()) return
  router.push({ name: 'objets' })
}

const notifs = computed(() => [
  { icon: 'pi pi-box', text: t('admin.layout.notif1'), time: t('admin.layout.time1h') },
  { icon: 'pi pi-building', text: t('admin.layout.notif2'), time: t('admin.layout.time3h') },
  { icon: 'pi pi-euro', text: t('admin.layout.notif3'), time: t('admin.layout.yesterday') }
])

function toggleUser(e) {
  userMenu.value.toggle(e)
}
function toggleNotif(e) {
  notifPanel.value.toggle(e)
}
function onNavClick() {
  if (!isDesktop.value) drawerOpen.value = false
}

function onResize() {
  const d = window.innerWidth >= 992
  if (d !== isDesktop.value) {
    isDesktop.value = d
    drawerOpen.value = false
  }
}
onMounted(() => {
  window.addEventListener('resize', onResize)
  // Chargement des données de contenu (l'utilisateur est staff authentifié à ce stade).
  useMuseumStore().load()
  useSectorStore().load()
  useObjectStore().load()
  usePricingStore().load()
  useGenealogyStore().load()
  loadPendingTenants()
})
onUnmounted(() => window.removeEventListener('resize', onResize))
</script>

<template>
  <div class="layout">
    <aside class="sidebar" :class="{ 'is-collapsed': collapsed && isDesktop, 'is-open': drawerOpen }">
      <div class="side-brand">
        <span class="side-brand__mark"><i class="pi pi-building" /></span>
        <div class="side-brand__text">
          <strong>MUSÉA</strong>
          <span>ERP &amp; SITE</span>
        </div>
        <button v-if="isDesktop" class="side-collapse" :aria-label="$t('common.menu')" @click="collapsed = !collapsed">
          <i :class="collapsed ? 'pi pi-angle-right' : 'pi pi-angle-left'" />
        </button>
      </div>

      <!-- Navigation groupée par sections (labels gris majuscules — style Génius) -->
      <nav class="nav">
        <div v-for="g in navGroups" :key="g.label" class="nav-group">
          <p class="nav__label">{{ g.label }}</p>
          <router-link v-for="it in g.items" :key="it.to" :to="it.to" class="nav-item" @click="onNavClick">
            <i :class="it.icon" /><span>{{ it.label }}</span>
            <span v-if="it.badge" class="nav-badge">{{ it.badge }}</span>
          </router-link>
        </div>
      </nav>

      <!-- Bas de sidebar : carte utilisateur (avatar orange + rôle) -->
      <div class="side-bottom">
        <button class="side-user" @click="toggleUser">
          <span class="side-user__avatar"><i class="pi pi-briefcase" /></span>
          <span class="side-user__info">
            <strong>{{ userLabel }}</strong>
            <small>{{ roleLabel }}</small>
          </span>
          <i class="pi pi-angle-up" />
        </button>
      </div>
    </aside>

    <div v-if="drawerOpen && !isDesktop" class="backdrop" @click="drawerOpen = false" />

    <div class="main">
      <!-- Topbar blanche (style Génius) : recherche + Voir le site + cloche + avatar -->
      <header class="topbar">
        <button class="icon-btn topbar__burger" :aria-label="$t('common.menu')" @click="toggleSidebar">
          <i class="pi pi-bars" />
        </button>

        <label class="search">
          <i class="pi pi-search" />
          <input v-model="search" type="text" :placeholder="$t('admin.layout.searchPlaceholder')" @keyup.enter="onSearch" />
        </label>

        <div class="topbar__right">
          <router-link :to="lienMonSite" class="topbar__site" target="_blank">
            <i class="pi pi-external-link" /> <span>{{ $t('admin.layout.viewSite') }}</span>
          </router-link>
          <LangSwitcher variant="light" />
          <button class="icon-btn" v-tooltip.bottom="$t('admin.layout.notifications')" :aria-label="$t('admin.layout.notifications')" @click="toggleNotif">
            <i class="pi pi-bell" />
            <span class="badge">{{ notifs.length }}</span>
          </button>
          <button
            class="icon-btn"
            v-tooltip.bottom="isDark ? $t('admin.layout.lightMode') : $t('admin.layout.darkMode')"
            :aria-label="$t('admin.layout.toggleTheme')"
            @click="toggle"
          >
            <i :class="isDark ? 'pi pi-sun' : 'pi pi-moon'" />
          </button>
          <button class="avatar-btn" :aria-label="$t('admin.layout.account')" @click="toggleUser">{{ initials }}</button>
        </div>
      </header>

      <div class="main__content">
        <router-view />
      </div>

      <footer class="foot">
        © {{ year }} Fondation Jean Félicien Gacha — MUSÉA
      </footer>
    </div>

    <Menu ref="userMenu" :model="userItems" popup />

    <Popover ref="notifPanel">
      <div class="notif">
        <div class="notif__title">{{ $t('admin.layout.notifications') }}</div>
        <ul class="notif__list">
          <li v-for="(n, i) in notifs" :key="i">
            <i :class="n.icon" />
            <div>
              <p>{{ n.text }}</p>
              <small>{{ n.time }}</small>
            </div>
          </li>
        </ul>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
/* ---------- Plein écran (style Génius) ---------- */
.layout {
  display: flex;
  height: 100vh;
  background: var(--vi-bg);
  overflow: hidden;
}

/* ---------- Sidebar blanche (item actif navy) ---------- */
.sidebar {
  flex: 0 0 var(--vi-sidebar-w);
  width: var(--vi-sidebar-w);
  height: 100%;
  background: var(--vi-side-bg);
  color: var(--vi-side-text);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--vi-side-border);
  transition: width 0.2s ease, flex-basis 0.2s ease, transform 0.25s ease;
  overflow: hidden;
  z-index: 30;
}
.sidebar.is-collapsed {
  flex-basis: var(--vi-sidebar-w-mini);
  width: var(--vi-sidebar-w-mini);
  min-width: var(--vi-sidebar-w-mini);
  max-width: var(--vi-sidebar-w-mini);
}

.side-brand {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 1.05rem 1rem;
  border-bottom: 1px solid var(--vi-side-border);
}
.side-brand__mark {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--p-primary-color);
  color: #fff;
  font-size: 1.15rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.side-brand__text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  min-width: 0;
}
.side-brand__text strong {
  font-family: var(--vi-sans);
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--vi-text);
  letter-spacing: 0.01em;
}
.side-brand__text span {
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--vi-side-muted);
  margin-top: 0.1rem;
}
.side-collapse {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--vi-side-muted);
  cursor: pointer;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.side-collapse:hover {
  background: var(--vi-side-hover);
  color: var(--vi-side-active-text);
}

.nav {
  flex: 1;
  padding: 0.9rem 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  overflow-y: auto;
}
.nav-group {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-bottom: 0.7rem;
}
.nav__label {
  margin: 0.5rem 0.85rem 0.35rem;
  font-size: 0.66rem;
  font-weight: 700;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  color: var(--vi-side-muted);
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.85rem;
  border-radius: 10px;
  font-weight: 500;
  font-size: 0.92rem;
  color: var(--vi-side-text);
}
.nav-item i {
  width: 1.2rem;
  text-align: center;
  font-size: 1.05rem;
  color: var(--vi-side-muted);
}
.nav-item:hover {
  background: var(--vi-side-hover);
}
.nav-item.router-link-active {
  background: var(--vi-side-active-bg);
  color: var(--vi-side-active-text);
  font-weight: 600;
}
.nav-item.router-link-active i {
  color: var(--vi-side-active-text);
}
.nav-badge {
  margin-left: auto;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--p-primary-color);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-item.router-link-active .nav-badge {
  background: #fff;
  color: var(--vi-side-active-bg);
}
/* ---------- Bas de sidebar : carte utilisateur (avatar orange + rôle) ---------- */
.side-bottom {
  padding: 0.75rem 0.8rem 0.85rem;
  border-top: 1px solid var(--vi-side-border);
}
.side-user {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0.4rem 0.45rem;
  border-radius: 12px;
  text-align: left;
  color: var(--vi-text);
  font-family: inherit;
  width: 100%;
}
.side-user:hover {
  background: var(--vi-side-hover);
}
.side-user__avatar {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--p-primary-color);
  color: #fff;
  font-size: 1.05rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 40px;
}
.side-user__info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}
.side-user__info strong {
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.side-user__info small {
  color: var(--vi-side-muted);
  font-size: 0.72rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.side-user > i {
  margin-left: auto;
  color: var(--vi-side-muted);
  font-size: 0.8rem;
}

/* ---------- Main ---------- */
.main {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
/* Topbar blanche (style Génius) */
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  flex-shrink: 0;
  height: var(--vi-topbar-h);
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0 1.5rem;
  background: var(--vi-surface);
  border-bottom: 1px solid var(--vi-border);
}
.topbar__burger {
  display: none;
}
.search {
  flex: 1;
  max-width: 560px;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: var(--vi-surface-2);
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 0.6rem 0.95rem;
}
.search:focus-within {
  border-color: color-mix(in srgb, var(--p-primary-color) 45%, var(--vi-border));
  background: var(--vi-surface);
}
.search i {
  color: var(--vi-muted);
  font-size: 0.95rem;
}
.search input {
  border: none;
  background: transparent;
  outline: none;
  width: 100%;
  color: var(--vi-text);
  font-size: 0.92rem;
  font-family: inherit;
}
.search input::placeholder {
  color: var(--vi-muted);
}
.topbar__right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.topbar__site {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--vi-border);
  border-radius: 10px;
  padding: 0.5rem 0.9rem;
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--vi-text);
  white-space: nowrap;
}
.topbar__site:hover {
  border-color: color-mix(in srgb, var(--p-primary-color) 50%, var(--vi-border));
  color: var(--p-primary-color);
}
.icon-btn {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: var(--vi-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.05rem;
}
.icon-btn:hover {
  background: var(--vi-surface-2);
}
.badge {
  position: absolute;
  top: 3px;
  right: 3px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--p-primary-color);
  color: #fff;
  font-size: 0.62rem;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}
.avatar-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: var(--vi-navy);
  color: #fff;
  font-weight: 800;
  font-size: 0.85rem;
  margin-left: 0.2rem;
}
.backdrop {
  display: none;
}

.main__content {
  flex: 1;
}
.foot {
  padding: 1.4rem 1.75rem;
  text-align: center;
  color: var(--vi-muted);
  font-size: 0.8rem;
  border-top: 1px solid var(--vi-border);
}

/* ---------- Notifications ---------- */
.notif {
  width: 280px;
}
.notif__title {
  font-family: var(--vi-sans);
  font-weight: 700;
  margin-bottom: 0.6rem;
}
.notif__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.notif__list li {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
}
.notif__list i {
  color: var(--p-primary-color);
  margin-top: 0.15rem;
}
.notif__list p {
  margin: 0;
  font-size: 0.85rem;
}
.notif__list small {
  color: var(--vi-muted);
}

/* ---------- Sidebar réduite (icônes seules) ---------- */
.sidebar.is-collapsed .side-brand {
  justify-content: center;
  padding: 1.05rem 0;
}
.sidebar.is-collapsed .side-brand__text,
.sidebar.is-collapsed .side-brand__mark,
.sidebar.is-collapsed .nav__label,
.sidebar.is-collapsed .nav-item span,
.sidebar.is-collapsed .nav-badge,
.sidebar.is-collapsed .side-user__info,
.sidebar.is-collapsed .side-user > i {
  display: none;
}
/* En mode réduit, l'icône du haut sert à ré-étendre */
.sidebar.is-collapsed .side-collapse {
  margin: 0 auto;
  width: 36px;
  height: 36px;
}
.sidebar.is-collapsed .nav-group {
  align-items: center;
}
.sidebar.is-collapsed .nav-item {
  justify-content: center;
  padding-left: 0.5rem;
  padding-right: 0.5rem;
}
.sidebar.is-collapsed .nav-item i {
  margin: 0;
}
.sidebar.is-collapsed .side-bottom {
  padding: 0.75rem 0.5rem 0.85rem;
}
.sidebar.is-collapsed .side-user {
  justify-content: center;
  padding: 0.35rem;
}

/* ---------- Responsive ---------- */
@media (max-width: 991px) {
  .layout {
    margin: 0.5rem;
    height: calc(100vh - 1rem);
    max-width: none;
  }
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    transform: translateX(-100%);
    z-index: 60;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  }
  .sidebar.is-open {
    transform: translateX(0);
  }
  .backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 55;
  }
  .topbar__burger {
    display: flex;
  }
}
</style>
