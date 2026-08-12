<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { useAccessStore } from '@/stores/useAccessStore'
import { pubMuseums } from '@/services/publicApi'
import { useSiteLink } from '@/composables/useSiteLink'
import { qrSvg } from '@/services/qrcode'
import { formatMontant } from '@/constants/options'
import ContactForm from '@/components/public/ContactForm.vue'

// Liens internes : reste sur le site consulte (/site ou /c/<slug>)
const { to } = useSiteLink()

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const access = useAccessStore()

const orders = ref([])
const museums = ref([])
// Commande dont le formulaire de contact est déplié (une seule à la fois).
const askOrder = ref(null)

// Cette page est l'ESPACE COMPTE, pas une porte d'entrée.
//
// Elle portait auparavant son propre formulaire connexion/inscription, avec ses
// onglets, son mot de passe oublié et son code par e-mail — un doublon complet
// de /login, à l'aspect différent. Deux portes pour une même serrure : le
// visiteur ne savait plus laquelle pousser, et toute évolution était à faire deux fois.
// On renvoie donc vers /login, qui sait faire les deux, et qui ramène ici ensuite.
onMounted(async () => {
  await auth.ensureReady()
  if (!auth.user) {
    // On reste DANS le site de l'organisation : sa propre page de connexion,
    // à ses couleurs. `/login` est la porte de la plateforme, pas celle du tenant.
    router.replace({ path: to('/connexion'), query: { redirect: route.fullPath } })
    return
  }
  await loadAccount()
})

// Retour d'un login OAuth (Google) : la session est détectée dans l'URL après le montage,
// auth.user passe de null à défini via onAuthStateChange → on (re)charge accès & commandes.
watch(() => auth.user, (u) => { if (u) loadAccount() })

async function loadAccount() {
  await access.load()
  museums.value = await pubMuseums()
  const { data } = await supabase
    .from('orders').select('*, order_items(*)').order('created_at', { ascending: false })
  orders.value = data || []
}

function museumName(id) { return id == null ? t('account.allMuseums') : museums.value.find((m) => m.id === id)?.nom || t('account.museumN', { id }) }
function fmtDate(d) { return d ? new Intl.DateTimeFormat(locale.value === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium' }).format(new Date(d)) : '' }
// QR du billet.
//
// Deux défauts corrigés ici :
//
//  1. Le code encodé était le NUMÉRO DE BILLET NU. Scanné avec l'appareil photo
//     d'un téléphone, il n'affichait qu'une suite de caractères et ne menait
//     nulle part. On encode désormais une ADRESSE : le visiteur qui scanne son
//     propre billet arrive sur son compte, et le contrôleur reste libre de
//     lire le code à l'œil, toujours affiché sous l'image.
//
//  2. L'image venait d'api.qrserver.com — un service tiers gratuit, donc une
//     dépendance réseau hors de notre contrôle, et le numéro de billet de
//     chaque visiteur envoyé à un inconnu. On le fabrique nous-mêmes avec
//     services/qrcode.js, déjà écrit pour la réalité augmentée.
function qrSvgBillet(code) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  try {
    return qrSvg(`${base}${to('/compte')}?billet=${encodeURIComponent(code)}`, { size: 132 })
  } catch {
    return '' // un QR absent n'empêche pas de lire le code écrit dessous
  }
}

async function logout() {
  await auth.signOut()
  orders.value = []
}
</script>

<template>
  <div class="wrap">
    <!-- Espace compte. Un visiteur non authentifié a déjà été renvoyé vers /login. -->
    <div v-if="auth.user">
      <div class="acct-head">
        <div>
          <h1 class="title">{{ $t('account.myAccount') }}</h1>
          <p class="muted">{{ auth.user.email }}</p>
        </div>
        <button class="btn-line" @click="logout"><i class="pi pi-sign-out" /> {{ $t('account.logout') }}</button>
      </div>

      <h2 class="sub">{{ $t('account.myTickets') }}</h2>
      <p v-if="access.rows.length" class="tickets-hint"><i class="pi pi-info-circle" /> {{ $t('account.ticketsHint') }}</p>
      <div v-if="access.rows.length" class="tickets">
        <article v-for="a in access.rows" :key="a.id" class="tk" :class="{ 'is-used': a.scanned_at }">
          <div class="tk__main">
            <span class="tk__type">
              <i :class="a.type === 'assistant_vocal' ? 'pi pi-volume-up' : 'pi pi-ticket'" />
              {{ a.type === 'assistant_vocal' ? $t('account.audioguide') : $t('account.subscription') }}
            </span>
            <strong class="tk__museum">{{ museumName(a.museum_id) }}</strong>
            <span class="tk__date">
              <template v-if="a.expires_at">{{ $t('account.expiresOn', { date: fmtDate(a.expires_at) }) }}</template>
              <template v-else>{{ $t('account.noExpiry') }}</template>
            </span>
            <span v-if="a.scanned_at" class="tk__used"><i class="pi pi-check-circle" /> {{ $t('account.ticketUsed', { date: fmtDate(a.scanned_at) }) }}</span>
            <span v-else class="tk__ok"><i class="pi pi-check" /> {{ $t('account.active') }}</span>
          </div>
          <div v-if="a.ticket_code" class="tk__qr">
            <div class="tk__qrimg" v-html="qrSvgBillet(a.ticket_code)" />
            <code>{{ a.ticket_code }}</code>
          </div>
        </article>
      </div>
      <p v-else class="muted">{{ $t('account.noAccess') }} <router-link :to="to('/panier')" class="lnk">{{ $t('account.noAccessLink') }}</router-link>.</p>

      <h2 class="sub">{{ $t('account.myOrders') }}</h2>
      <div v-if="orders.length" class="orders">
        <div v-for="o in orders" :key="o.id" class="order">
          <div class="order__head">
            <strong>{{ $t('account.orderN', { id: o.id }) }}</strong>
            <span class="order__st" :class="`st-${o.statut}`">{{ o.statut === 'payee' ? $t('account.paid') : o.statut }}</span>
            <span class="order__date">{{ fmtDate(o.created_at) }}</span>
            <strong class="order__total">{{ formatMontant(o.total, o.devise) }}</strong>
          </div>
          <ul>
            <li v-for="it in o.order_items" :key="it.id">{{ it.label }} — {{ formatMontant(it.montant, o.devise) }}</li>
          </ul>

          <!-- SAV : le fil arrive dans la messagerie de l'ERP, rattaché à cette commande. -->
          <button type="button" class="order__ask" @click="askOrder = askOrder === o.id ? null : o.id">
            <i class="pi pi-comment" /> {{ $t('contact.orderAsk') }}
          </button>
          <ContactForm
            v-if="askOrder === o.id"
            compact
            :order-id="o.id"
            :sujet-impose="$t('contact.orderSubject', { n: o.id })"
            class="order__form"
          />
        </div>
      </div>
      <p v-else class="muted">{{ $t('account.noOrders') }}</p>
    </div>
  </div>
</template>

<style scoped>
.wrap { max-width: 720px; margin: 0 auto; padding: 2.5rem 1.5rem 0; }
.title { font-family: 'Fraunces', Georgia, serif; font-size: 2rem; margin: 0 0 0.3rem; }
.muted { color: #897f70; }
.sub { font-family: 'Fraunces', Georgia, serif; font-size: 1.3rem; margin: 2rem 0 0.9rem; }
.lnk { color: var(--site-primary, #a86b2d); font-weight: 700; }

.acct-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
/* ---- Billets avec QR code ---- */
.tickets-hint { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: #5c615c; margin: -0.4rem 0 0.9rem; }
.tickets-hint i { color: var(--site-primary, #0e6f5c); }
.tickets { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 1rem; }
.tk {
  display: flex; align-items: center; gap: 1rem; background: #fff;
  border: 1px solid #e8e9e6; border-radius: 12px; padding: 1rem 1.1rem;
  border-left: 5px solid var(--site-primary, #0e6f5c); position: relative; overflow: hidden;
}
.tk.is-used { border-left-color: #b9beb8; opacity: 0.72; }
.tk__qrimg { line-height: 0; background: #fff; border-radius: 6px; }
.tk__qrimg :deep(svg) { display: block; width: 132px; height: 132px; }
.tk__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.tk__type { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.68rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--site-primary, #0e6f5c); }
.tk__museum { font-size: 1.05rem; font-weight: 800; color: #101210; line-height: 1.25; }
.tk__date { font-size: 0.8rem; color: #7c817b; }
.tk__ok { font-size: 0.8rem; font-weight: 700; color: var(--site-primary, #0e6f5c); margin-top: 0.2rem; }
.tk__used { font-size: 0.78rem; font-weight: 700; color: #7c817b; margin-top: 0.2rem; }
.tk__qr { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; flex: 0 0 auto; }
.tk__qr img { width: 110px; height: 110px; border-radius: 8px; background: #fff; }
.tk__qr code { font-size: 0.68rem; letter-spacing: 0.04em; color: #5c615c; font-weight: 700; }

.orders { display: flex; flex-direction: column; gap: 0.8rem; }
.order { background: #fff; border: 1px solid #e7ddcf; border-radius: 14px; padding: 0.9rem 1.1rem; }
.order__head { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; }
.order__st { font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.55rem; border-radius: 999px; background: #eee; }
.st-payee { background: #e2f3e9; color: #2f7a4d; }
.order__date { color: #897f70; font-size: 0.82rem; }
.order__total { margin-left: auto; }
.order ul { margin: 0.5rem 0 0; padding-left: 1.1rem; color: #6b6052; font-size: 0.88rem; }
.order__ask {
  margin-top: 0.7rem; background: none; border: none; padding: 0; cursor: pointer;
  font: inherit; font-size: 0.84rem; color: var(--site-primary, #0e6f5c);
  display: inline-flex; align-items: center; gap: 0.35rem;
}
.order__ask:hover { text-decoration: underline; }
.order__form { margin-top: 0.8rem; }
</style>
