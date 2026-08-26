<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCartStore } from '@/stores/useCartStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { usePublicTenantStore } from '@/stores/usePublicTenantStore'
import { applySiteHead } from '@/composables/useSiteHead'
import { pubMuseums, joinTenant } from '@/services/publicApi'
import { canonicalOrigin, parseHost } from '@/services/host'
import '@/assets/public-site.css' // design system partagé des pages publiques (.ps-*)
import GuideChat from '@/components/public/GuideChat.vue'
import VoiceBot from '@/components/public/VoiceBot.vue'
import LangSwitcher from '@/components/LangSwitcher.vue'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const settings = useSettingsStore()
const cart = useCartStore()
const auth = useAuthStore()
const pubTenant = usePublicTenantStore()
const museums = ref([])

// Base des liens internes : /site ou /c/<slug> selon le site consulté.
const base = computed(() => (route.params.slug ? `/c/${route.params.slug}` : '/site'))
// Le défaut n'est pas cosmétique : `to()` sans argument sert au lien du logo et
// à trois liens de pied de page. Sans lui, ils pointaient tous vers « /siteundefined ».
const to = (p = '') => `${base.value}${p}`

// Résout l'organisation à afficher, puis charge SES réglages et SES musées.
// Priorité (Phase 2) : NOM D'HÔTE d'abord (sous-domaine <slug>.musea.space ou
// domaine personnalisé), puis repli local sur /c/:slug, sinon site historique.
async function resolveTenant() {
  const host = window.location.hostname
  const byHost = await pubTenant.resolveByHost(host)
  if (!byHost) {
    // Hôte neutre (plateforme, réservé, dev) : repli sur le chemin /c/:slug,
    // sinon le site historique (première organisation approuvée).
    if (route.params.slug) await pubTenant.resolveBySlug(route.params.slug)
    // AUCUNE ORGANISATION PAR DÉFAUT SUR LE DOMAINE DE LA PLATEFORME.
    //
    // `resolveDefault()` charge « la première organisation approuvée ». Sur
    // nexacode.store/site, cela affichait le site de la Fondation à l'adresse de
    // la plateforme : une institution présentée là où l'on présente un hébergeur,
    // et le même contenu servi à deux adresses. Chaque organisation a son
    // sous-domaine ; la plateforme, elle, n'en héberge aucune en propre.
    //
    // On garde ce repli en développement, où les sous-domaines n'existent pas :
    // sans lui, le site public serait intestable en local.
    else if (parseHost().kind === 'local') await pubTenant.resolveDefault()
  }

  // Organisation introuvable ou non publiée : on vide tout pour ne rien laisser
  // apparaître de l'organisation précédemment consultée.
  if (!pubTenant.isReady) { museums.value = []; settings.clear(); updateCanonical(); return }
  await settings.load(pubTenant.tenant.id)
  museums.value = await pubMuseums()
  updateCanonical()
}

// URL canonique : évite le contenu dupliqué entre /site, /c/:slug et le sous-domaine.
function updateCanonical() {
  const origin = canonicalOrigin(pubTenant.tenant)
  let el = document.head.querySelector('link[rel="canonical"]')
  if (!origin) { if (el) el.remove(); return }
  if (!el) { el = document.createElement('link'); el.setAttribute('rel', 'canonical'); document.head.appendChild(el) }
  // Sur le sous-domaine canonique, les pages sont servies à la racine
  // (sans le préfixe /c/:slug ni /site du repli local).
  const path = route.fullPath.replace(/^\/c\/[^/]+/, '').replace(/^\/site/, '') || '/'
  el.setAttribute('href', origin + (path === '/' ? '' : path))
}

// Adhésion (V2 Phase 1) : un visiteur connecté qui consulte le site d'une organisation
// en devient adhérent — c'est ce qui permet à l'admin de connaître et contacter SON public.
// Idempotent côté RPC ; le staff n'est pas concerné (il passe par profiles.tenant_id).
let joined = null
async function ensureMembership() {
  const id = pubTenant.tenant?.id
  if (!id || !auth.user || auth.isStaff || joined === id) return
  const r = await joinTenant(id, 'site')
  if (r.ok) joined = id
}

onMounted(async () => {
  await resolveTenant()
  await ensureMembership()
  settings.subscribeRealtime() // les modifs enregistrées s'appliquent en direct
})
// Changement d'organisation dans l'URL → on recharge tout.
watch(() => route.params.slug, async () => { joined = null; await resolveTenant(); await ensureMembership() })
// Connexion en cours de visite (OTP, Google) → on rattache aussi.
watch(() => auth.user, ensureMembership)

const s = computed(() => settings.settings || {})
const primary = computed(() => s.value.couleurPrimaire || '#0e6f5c')

// Marque affichée : réglable dans l'ERP, avec repli sur le nom de l'organisation.
const marque = computed(() => s.value.marque || s.value.nomEntite || pubTenant.tenant?.nom || 'MUSÉA')
const marqueInitiale = computed(() =>
  (s.value.marqueInitiale || marque.value).trim().charAt(0).toUpperCase())
const year = new Date().getFullYear()

// Métadonnées SEO + Analytics injectées dès que les réglages sont chargés.
watch(s, (v) => applySiteHead(v), { immediate: true, deep: true })

// Aperçu admin : ?preview=maintenance force l'affichage de la page visiteur.
const previewMaintenance = computed(() => route.query.preview === 'maintenance')
// Mode maintenance : masque le site public à tous, sauf au staff connecté
// (sauf en mode aperçu, où le staff voit exactement la page des visiteurs).
const underMaintenance = computed(() => previewMaintenance.value || (s.value.maintenanceActif && !auth.isStaff))

// Réseaux sociaux (icône PrimeIcons par clé). Affichés seulement si renseignés.
const socials = computed(() => {
  const r = s.value.reseaux || {}
  return [
    { key: 'facebook', icon: 'pi-facebook', url: r.facebook },
    { key: 'instagram', icon: 'pi-instagram', url: r.instagram },
    { key: 'youtube', icon: 'pi-youtube', url: r.youtube },
    { key: 'tiktok', icon: 'pi-tiktok', url: r.tiktok },
    { key: 'twitter', icon: 'pi-twitter', url: r.twitter },
    { key: 'linkedin', icon: 'pi-linkedin', url: r.linkedin },
    { key: 'whatsapp', icon: 'pi-whatsapp', url: r.whatsapp }
  ].filter((x) => x.url)
})
const footerLinks = computed(() => (s.value.footerLiens || []).filter((l) => l && l.label && l.url))
const hasPractical = computed(() => !!(s.value.horaires || s.value.joursFermeture || s.value.tarifEntree))
function isExternal(url) { return /^https?:\/\//i.test(url || '') }

const drawer = ref(false)
const nav = computed(() => [
  { label: t('publicLayout.nav.museums'), to: to('/musees') },
  { label: t('publicLayout.nav.boutiques'), to: to('/boutiques') },
  { label: t('publicLayout.nav.genealogy'), to: to('/genealogie') }
])
function go(to) { drawer.value = false; router.push(to) }
</script>

<template>
  <div class="site" :style="{ '--site-primary': primary, '--gold': '#c9a227' }">
    <!-- Bandeau d'annonce -->
    <component
      :is="s.bandeauLien ? 'a' : 'div'"
      v-if="s.bandeauActif && s.bandeauTexte"
      class="annbar"
      :href="s.bandeauLien || undefined"
      :style="{ background: s.bandeauCouleur || primary }"
    >
      <i class="pi pi-megaphone" /> <span>{{ s.bandeauTexte }}</span>
    </component>

    <!-- Header blanc : nav à gauche, logo centré, actions à droite -->
    <header class="topbar">
      <div class="topbar__left">
        <button class="topbar__burger" :aria-label="$t('common.menu')" @click="drawer = true"><i class="pi pi-bars" /></button>
        <nav class="topnav">
          <router-link v-for="n in nav" :key="n.label" :to="n.to" class="topnav__lnk">{{ n.label }}</router-link>
        </nav>
        <button class="ic ic--search" :aria-label="$t('publicLayout.search')" @click="go(to('/musees'))"><i class="pi pi-search" /></button>
      </div>

      <router-link :to="to()" class="logo">
        <img v-if="s.logo" :src="s.logo" :alt="marque" class="logo__img" />
        <span v-else class="logo__mark">{{ marqueInitiale }}</span>
        <span class="logo__stack">
          <span class="logo__name">{{ marque }}</span>
          <span class="logo__sub">{{ s.nomEntite || $t('brand.foundation') }}</span>
        </span>
      </router-link>

      <div class="topbar__actions">
        <LangSwitcher variant="light" />
        <!-- Raccourci vers l'ERP : visible UNIQUEMENT par le personnel de l'organisation.
             Un membre du personnel peut consulter son site public sans se déconnecter,
             et revenir à son back-office d'un clic. Invisible pour tout visiteur. -->
        <router-link v-if="auth.isStaff" to="/dashboard" class="ic ic--erp" :title="$t('publicLayout.goErp')">
          <i class="pi pi-th-large" />
          <span class="ic--erp-txt">{{ $t('publicLayout.erp') }}</span>
        </router-link>
        <button class="ic" :aria-label="$t('publicLayout.account')" @click="go(to('/compte'))"><i class="pi pi-user" /></button>
        <button class="ic ic--cart" :aria-label="$t('publicLayout.cart')" @click="go(to('/panier'))">
          <i class="pi pi-shopping-bag" />
          <span v-if="cart.count" class="ic__badge">{{ cart.count }}</span>
        </button>
      </div>
    </header>

    <!-- Drawer mobile -->
    <transition name="fade">
      <div v-if="drawer" class="drawer-bg" @click="drawer = false" />
    </transition>
    <transition name="slide">
      <aside v-if="drawer" class="drawer">
        <div class="drawer__head">
          <span class="drawer__logo">{{ marque }}</span>
          <button class="ic" :aria-label="$t('common.close')" @click="drawer = false"><i class="pi pi-times" /></button>
        </div>
        <nav>
          <a @click="go(to(''))">{{ $t('publicLayout.nav.home') }}</a>
          <a v-for="n in nav" :key="n.label" @click="go(n.to)">{{ n.label }}</a>
        </nav>
        <router-link to="/login" class="drawer__pro" @click="drawer = false">
          <i class="pi pi-lock" /> {{ $t('publicLayout.pro') }}
        </router-link>
      </aside>
    </transition>

    <!-- L'admin voit le site normalement, mais est prévenu que la maintenance est active. -->
    <!-- Site pas encore approuvé : seul son propriétaire le voit. -->
    <div v-if="pubTenant.apercu" class="apercubar">
      <i class="pi pi-eye" /> {{ $t('publicLayout.tenantPreview') }}
    </div>

    <div v-if="s.maintenanceActif && auth.isStaff && !previewMaintenance" class="staffbar">
      <i class="pi pi-exclamation-triangle" /> {{ $t('publicLayout.maintenanceStaff') }}
    </div>

    <main class="site-main">
      <!-- Slug inconnu, ou organisation pas encore approuvée -->
      <div v-if="pubTenant.notFound" class="maint">
        <i class="pi pi-compass" />
        <h1>{{ $t('publicLayout.tenantNotFoundTitle') }}</h1>
        <p>{{ $t('publicLayout.tenantNotFoundText') }}</p>
        <router-link to="/" class="ps-btn" style="margin-top:1.4rem">
          {{ $t('publicLayout.backToPlatform') }} <i class="pi pi-arrow-right" />
        </router-link>
      </div>
      <div v-else-if="underMaintenance" class="maint">
        <i class="pi pi-cog pi-spin" />
        <h1>{{ s.nomEntite || $t('brand.foundation') }}</h1>
        <p>{{ s.maintenanceMessage || $t('publicLayout.maintenanceDefault') }}</p>
      </div>
      <!-- On n'affiche les pages qu'une fois l'organisation résolue : sinon la page
           enfant se monterait avant et chargerait les réglages d'une autre organisation. -->
      <router-view v-else-if="pubTenant.isReady" />
      <div v-else class="maint maint--loading"><i class="pi pi-spin pi-spinner" /></div>
    </main>

    <!-- Footer sombre 4 colonnes, façon boutique -->
    <footer class="foot">
      <div class="foot__cols">
        <div class="foot__brand">
          <span class="foot__logo">{{ marque }}</span>
          <p class="foot__tag">{{ s.footerTexte || s.accroche || $t('brand.tagline') }}</p>
          <div v-if="socials.length" class="foot__social">
            <a v-for="soc in socials" :key="soc.key" :href="soc.url" target="_blank" rel="noopener" :aria-label="soc.key"><i :class="`pi ${soc.icon}`" /></a>
          </div>
          <div v-if="footerLinks.length" class="foot__custom">
            <template v-for="l in footerLinks" :key="l.label">
              <a v-if="isExternal(l.url)" :href="l.url" target="_blank" rel="noopener">{{ l.label }}</a>
              <router-link v-else :to="l.url">{{ l.label }}</router-link>
            </template>
          </div>
        </div>

        <div>
          <h4>{{ $t('publicLayout.footer.explore') }}</h4>
          <router-link :to="to('/musees')">{{ $t('publicLayout.nav.museums') }}</router-link>
          <router-link :to="to('/boutiques')">{{ $t('publicLayout.nav.boutiques') }}</router-link>
          <router-link :to="to('/musees')">{{ $t('publicLayout.nav.works') }}</router-link>
          <router-link :to="to('/genealogie')">{{ $t('publicLayout.nav.genealogy') }}</router-link>
        </div>

        <div>
          <h4>{{ $t('publicLayout.footer.help') }}</h4>
          <router-link :to="to('/compte')">{{ $t('publicLayout.account') }}</router-link>
          <router-link :to="to('/panier')">{{ $t('publicLayout.cart') }}</router-link>
          <router-link :to="to()">{{ $t('publicLayout.nav.faq') }}</router-link>
          <router-link to="/login">{{ $t('publicLayout.pro') }}</router-link>
          <template v-if="hasPractical">
            <p v-if="s.horaires"><i class="pi pi-clock" /> {{ s.horaires }}</p>
            <p v-if="s.joursFermeture"><i class="pi pi-ban" /> {{ $t('publicLayout.footer.closed') }} {{ s.joursFermeture }}</p>
            <p v-if="s.tarifEntree"><i class="pi pi-ticket" /> {{ s.tarifEntree }}</p>
          </template>
        </div>

        <div>
          <h4>{{ $t('publicLayout.nav.boutiques') }}</h4>
          <router-link v-for="m in museums.slice(0, 3)" :key="m.id" :to="to(`/musees/${m.id}/boutique`)" class="foot__shop">
            <i class="pi pi-map-marker" />
            <span>{{ m.nom }}</span>
          </router-link>
          <router-link :to="to('/boutiques')" class="foot__all">{{ $t('publicLayout.footer.allShops') }} <i class="pi pi-arrow-right" /></router-link>
          <p v-if="s.contactTel"><i class="pi pi-phone" /> {{ s.contactTel }}</p>
          <p v-if="s.contactEmail"><i class="pi pi-envelope" /> {{ s.contactEmail }}</p>
          <p v-if="s.adresse"><i class="pi pi-map-marker" /> {{ s.adresse }}</p>
          <a v-if="s.mapsUrl" :href="s.mapsUrl" target="_blank" rel="noopener" class="foot__all"><i class="pi pi-directions" /> {{ $t('publicLayout.footer.directions') }}</a>
        </div>
      </div>
      <div class="foot__legal">
        <span>© {{ year }} {{ s.nomEntite || $t('brand.foundation') }} — {{ $t('publicLayout.footer.rights') }}</span>
        <span class="foot__legal-lnks">
          <router-link :to="to()">{{ $t('admin.settings.legalNotice') }}</router-link>
          <router-link :to="to()">{{ $t('admin.settings.privacy') }}</router-link>
        </span>
      </div>
    </footer>

    <GuideChat />
    <VoiceBot />
  </div>
</template>

<style scoped>
.site {
  min-height: 100vh; display: flex; flex-direction: column;
  background: #f6f7f5; color: #101210;
  font-family: 'Inter', system-ui, sans-serif;
  --ink: #101210;
}

/* Bandeau d'annonce */
.annbar { display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.55rem 1rem; color: #fff; font-size: 0.82rem; font-weight: 600; letter-spacing: 0.02em; text-align: center; text-decoration: none; }
.annbar[href]:hover { filter: brightness(1.08); }

/* Header blanc */
.topbar {
  position: sticky; top: 0; z-index: 40;
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
  padding: 0 clamp(1rem, 3vw, 2.2rem); height: 72px;
  background: #fff; color: var(--ink);
  border-bottom: 1px solid #e8e9e6;
}
.topbar__left { display: flex; align-items: center; gap: 0.4rem; }
.topnav { display: flex; align-items: center; gap: 1.4rem; margin-right: 0.6rem; }
.topnav__lnk { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink); padding: 0.4rem 0; border-bottom: 2px solid transparent; }
.topnav__lnk:hover, .topnav__lnk.router-link-active { color: var(--site-primary); border-bottom-color: var(--site-primary); }

.topbar__burger, .ic { background: transparent; border: none; color: var(--ink); cursor: pointer; width: 42px; height: 42px; border-radius: 50%; font-size: 1.05rem; display: inline-flex; align-items: center; justify-content: center; }
.topbar__burger { display: none; }
.topbar__burger:hover, .ic:hover { background: #f0f1ee; }
.ic--cart { position: relative; }
.ic__badge {
  position: absolute; top: 3px; right: 1px; min-width: 17px; height: 17px; padding: 0 4px;
  border-radius: 999px; background: var(--site-primary); color: #fff;
  font-size: 0.62rem; font-weight: 800; display: flex; align-items: center; justify-content: center;
}
.topbar__actions { justify-self: end; display: flex; align-items: center; gap: 0.15rem; }
.ic--erp {
  display: inline-flex; align-items: center; gap: 0.4rem; width: auto;
  padding: 0.4rem 0.75rem; margin-right: 0.35rem; border-radius: 999px;
  background: var(--site-primary, #0e6f5c); color: #fff; text-decoration: none;
  font-size: 0.78rem; font-weight: 700; white-space: nowrap;
}
.ic--erp:hover { filter: brightness(1.1); }
@media (max-width: 700px) { .ic--erp-txt { display: none; } .ic--erp { padding: 0.4rem 0.55rem; } }

.logo { justify-self: center; display: flex; align-items: center; gap: 0.6rem; line-height: 1; }
.logo__mark {
  width: 40px; height: 40px; border-radius: 50%; background: var(--ink); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Anton', 'Inter', sans-serif; font-size: 1.25rem;
}
.logo__img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; display: block; }
.logo__stack { display: flex; flex-direction: column; }
.logo__name { font-family: 'Anton', 'Inter', sans-serif; font-size: 1.45rem; letter-spacing: 0.05em; color: var(--ink); }
.logo__sub { font-size: 0.55rem; letter-spacing: 0.26em; text-transform: uppercase; color: #8a8f89; margin-top: 0.2rem; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Drawer */
.drawer-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 50; }
.drawer { position: fixed; top: 0; left: 0; bottom: 0; width: 290px; background: #0d0f0d; color: #f2f3f0; z-index: 60; padding: 1.2rem; display: flex; flex-direction: column; }
.drawer__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
.drawer__logo { font-family: 'Anton', sans-serif; font-size: 1.5rem; letter-spacing: 0.05em; }
.drawer .ic { color: #f2f3f0; }
.drawer .ic:hover { background: rgba(255,255,255,0.08); }
.drawer nav { display: flex; flex-direction: column; }
.drawer nav a { padding: 0.95rem 0.3rem; border-bottom: 1px solid rgba(255,255,255,0.08); font-weight: 700; cursor: pointer; font-size: 0.9rem; letter-spacing: 0.08em; text-transform: uppercase; color: #f2f3f0; }
.drawer nav a:hover { color: var(--site-primary); }
.drawer__pro { margin-top: auto; display: inline-flex; align-items: center; gap: 0.5rem; border: 1px solid var(--site-primary); color: #fff; background: var(--site-primary); border-radius: 10px; padding: 0.7rem 0.9rem; justify-content: center; font-weight: 700; font-size: 0.85rem; }

/* Barre d'alerte staff (maintenance active) */
.staffbar { display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.5rem 1rem; background: #7a1f1f; color: #ffe3e3; font-size: 0.85rem; font-weight: 600; }
.apercubar { display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.5rem 1rem; background: #7a5a12; color: #ffeec2; font-size: 0.85rem; font-weight: 600; }

/* Mode maintenance */
.maint { max-width: 560px; margin: 5rem auto; text-align: center; padding: 2rem; }
.maint > i { font-size: 3rem; color: var(--site-primary); }
.maint h1 { font-family: 'Anton', sans-serif; letter-spacing: 0.02em; margin: 1.2rem 0 0.6rem; font-size: 2rem; }
.maint p { color: #5c615c; font-size: 1.05rem; line-height: 1.6; }

.site-main { flex: 1; }
.maint--loading { color: var(--site-primary); font-size: 2rem; }

/* Footer sombre */
.foot { background: #0d0f0d; color: #b9beb8; margin-top: 4rem; }
.foot__cols { max-width: 1240px; margin: 0 auto; display: grid; grid-template-columns: 1.5fr 1fr 1fr 1.3fr; gap: 2.5rem; padding: 3.2rem 1.5rem 2rem; }
.foot__logo { font-family: 'Anton', sans-serif; font-size: 1.9rem; letter-spacing: 0.04em; color: #fff; }
.foot__tag { margin: 0.8rem 0 1.1rem; font-size: 0.92rem; line-height: 1.6; max-width: 320px; }
.foot h4 { margin: 0.3rem 0 1rem; font-size: 0.78rem; letter-spacing: 0.14em; text-transform: uppercase; color: #fff; font-weight: 800; }
.foot a { display: block; color: #b9beb8; font-size: 0.92rem; padding: 0.28rem 0; }
.foot a:hover { color: #fff; }
.foot p { margin: 0.35rem 0; font-size: 0.9rem; display: flex; align-items: center; gap: 0.5rem; }
.foot p i { color: var(--site-primary); font-size: 0.9rem; }

.foot__social { display: flex; gap: 0.6rem; }
.foot__social a { width: 42px; height: 42px; border-radius: 50%; border: 1px solid #2c302c; display: flex; align-items: center; justify-content: center; font-size: 1.05rem; padding: 0; }
.foot__social a:hover { border-color: var(--site-primary); color: #fff; background: var(--site-primary); }
.foot__custom { display: flex; flex-wrap: wrap; gap: 0.2rem 1rem; margin-top: 1rem; }
.foot__custom a { display: inline; font-size: 0.85rem; color: #8f948e; }

.foot__shop { display: flex !important; align-items: flex-start; gap: 0.55rem; padding: 0.35rem 0 !important; }
.foot__shop i { color: var(--site-primary); margin-top: 0.2rem; }
.foot__shop span { line-height: 1.4; }
.foot__all { color: color-mix(in srgb, var(--site-primary) 70%, #fff) !important; font-weight: 700; display: inline-flex !important; align-items: center; gap: 0.4rem; margin: 0.4rem 0 0.6rem; }
.foot__all:hover { color: #fff !important; }

.foot__legal { border-top: 1px solid #1e211e; padding: 1.1rem 1.5rem; font-size: 0.8rem; color: #7d827c; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; max-width: 1240px; margin: 0 auto; }
.foot__legal-lnks { display: flex; gap: 1.2rem; }
.foot__legal a { color: #7d827c; display: inline; padding: 0; }
.foot__legal a:hover { color: #fff; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-active, .slide-leave-active { transition: transform 0.25s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(-100%); }

@media (max-width: 980px) {
  .topnav, .ic--search { display: none; }
  .topbar__burger { display: inline-flex; }
  .logo__sub { display: none; }
  .foot__cols { grid-template-columns: 1fr 1fr; gap: 2rem; }
}
@media (max-width: 560px) {
  .foot__cols { grid-template-columns: 1fr; }
  .foot__legal { justify-content: center; text-align: center; }
}
</style>
