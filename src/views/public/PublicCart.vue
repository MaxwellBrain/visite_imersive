<script setup>
import { formatMontant } from '@/constants/options'
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/useAuthStore'
import { useCartStore } from '@/stores/useCartStore'
import { useAccessStore } from '@/stores/useAccessStore'
import { pubPlans, pubDonationTiers, pubMuseums } from '@/services/publicApi'
import { createOrder, confirmSimulated, startRealPayment, orderStatus, isRealPayment } from '@/services/paymentApi'
import { sendOrderReceipt } from '@/services/emailApi'
import { useSiteLink } from '@/composables/useSiteLink'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { usePublicTenantStore } from '@/stores/usePublicTenantStore'

// Liens internes : reste sur le site consulte (/site ou /c/<slug>)
const { to } = useSiteLink()

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const cart = useCartStore()
const access = useAccessStore()
const settings = useSettingsStore()
const pubTenant = usePublicTenantStore()

// Reçu envoyé après paiement — n'interrompt jamais le parcours en cas d'échec.
async function envoyerRecu(order, items) {
  const meta = auth.user?.user_metadata?.full_name || ''
  await sendOrderReceipt({
    to: auth.user?.email,
    prenom: meta ? meta.trim().split(/\s+/)[0] : '',
    order,
    items,
    tenantId: pubTenant.tenant?.id ?? null,
    settings: settings.settings,
    tenant: pubTenant.tenant,
    lien: `${window.location.origin}${to('/compte')}`
  })
}

const plans = ref([])
const dons = ref([])
const museums = ref([])
const paying = ref(false)
const done = ref(false)
const pending = ref(false)
const error = ref('')

onMounted(async () => {
  ;[plans.value, dons.value, museums.value] = await Promise.all([pubPlans(), pubDonationTiers(), pubMuseums()])
  // Retour depuis le prestataire de paiement : on interroge le statut de la commande.
  if (route.query.ret && route.query.order) await handleReturn(Number(route.query.order))
})

// Après paiement réel, le webhook confirme côté serveur. On sonde la commande quelques
// secondes ; si « payee », on affiche la confirmation, sinon on invite à vérifier son compte.
async function handleReturn(orderId) {
  await auth.ensureReady()
  pending.value = true
  const articles = cart.items.map((i) => ({ label: i.label, montant: i.montant }))
  const montantTotal = cart.total
  const deviseCmd = cart.items[0]?.devise || 'FCFA'
  for (let i = 0; i < 6; i++) {
    if ((await orderStatus(orderId)) === 'payee') {
      cart.clear()
      await access.load()
      pending.value = false
      done.value = true
      envoyerRecu({ id: orderId, total: montantTotal, devise: deviseCmd }, articles)
      return
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  // Toujours pas confirmée : le webhook peut arriver un peu plus tard.
  pending.value = true
}

function museumName(id) { return museums.value.find((m) => m.id === id)?.nom || '' }

function addPlan(p) {
  cart.add({
    type: 'abonnement',
    refId: p.id,
    museumId: null,
    label: p.nom,
    montant: Number(p.prix),
    devise: p.devise
  })
}
function addDon(d) {
  cart.add({ type: 'don', refId: d.id, museumId: null, label: t('cart.donationLabel', { label: d.label }), montant: Number(d.montant), devise: d.devise })
}

async function checkout() {
  error.value = ''
  await auth.ensureReady()
  if (!auth.user) {
    router.push({ name: 'pub-account', query: { redirect: to('/panier') } })
    return
  }
  if (!cart.items.length) return
  paying.value = true
  // On garde une copie : le panier est vidé avant l'envoi du reçu.
  const articles = cart.items.map((i) => ({ label: i.label, montant: i.montant }))
  const montantTotal = cart.total
  const deviseCmd = cart.items[0]?.devise || 'FCFA'
  try {
    const order = await createOrder(auth.user.id, cart.items, cart.total)

    if (isRealPayment) {
      const returnUrl = `${window.location.origin}/site/panier?ret=1&order=${order.id}`
      const res = await startRealPayment(order.id, returnUrl)
      if (res.paymentUrl) {
        // Redirection vers la page de paiement du prestataire (mobile money / carte).
        window.location.href = res.paymentUrl
        return
      }
      // Pas de clés prestataire posées → repli simulation.
    }

    await confirmSimulated(order.id)
    cart.clear()
    await access.load()
    done.value = true
    envoyerRecu({ ...order, total: montantTotal, devise: deviseCmd }, articles) // sans attendre
  } catch (e) {
    error.value = e.message
  } finally {
    paying.value = false
  }
}
</script>

<template>
  <div>
    <header class="ps-hero">
      <div class="ps-hero__in ps-hero__in--slim">
        <span class="ps-hero__over">{{ $t('publicLayout.cart') }}</span>
        <h1>{{ $t('cart.title') }}</h1>
      </div>
    </header>

    <div class="ps-wrap ps-wrap--narrow">
      <!-- Confirmation -->
      <div v-if="done" class="okbox ps-card">
        <i class="pi pi-check-circle" />
        <h2>{{ $t('cart.thanks') }} <small v-if="!isRealPayment">{{ $t('cart.simulation') }}</small></h2>
        <p>{{ $t('cart.unlocked') }}</p>
        <div class="okbox__actions">
          <router-link :to="to('/compte')" class="ps-btn">{{ $t('cart.seeAccesses') }}</router-link>
          <router-link :to="to('/musees')" class="ps-btn ps-btn--line">{{ $t('cart.continueVisit') }}</router-link>
        </div>
      </div>

      <!-- Paiement en cours de confirmation (retour prestataire) -->
      <div v-else-if="pending" class="okbox ps-card">
        <i class="pi pi-spin pi-spinner" />
        <h2>{{ $t('cart.pendingTitle') }}</h2>
        <p>{{ $t('cart.pendingText') }}</p>
        <div class="okbox__actions">
          <router-link :to="to('/compte')" class="ps-btn">{{ $t('cart.seeAccesses') }}</router-link>
        </div>
      </div>

      <template v-else>
        <!-- Items -->
        <div v-if="cart.items.length" class="cartbox ps-card">
          <div v-for="(i, idx) in cart.items" :key="idx" class="citem">
            <span class="citem__ic"><i :class="i.type === 'don' ? 'pi pi-heart' : i.type === 'assistant_vocal' ? 'pi pi-volume-up' : i.type === 'produit' ? 'pi pi-shopping-bag' : 'pi pi-ticket'" /></span>
            <div class="citem__b">
              <strong>{{ i.label }}</strong>
              <span v-if="i.museumId">{{ museumName(i.museumId) }}</span>
            </div>
            <span class="ps-price">{{ formatMontant(i.montant, i.devise) }}</span>
            <button class="citem__del" :aria-label="$t('cart.removeAria')" @click="cart.remove(idx)"><i class="pi pi-times" /></button>
          </div>
          <div class="ctotal">
            <span>{{ $t('cart.total') }}</span>
            <strong>{{ formatMontant(cart.total, cart.items[0]?.devise) }}</strong>
          </div>
          <p v-if="error" class="err"><i class="pi pi-exclamation-triangle" /> {{ error }}</p>
          <button class="ps-btn btn-pay" :disabled="paying" @click="checkout">
            <i :class="paying ? 'pi pi-spin pi-spinner' : 'pi pi-lock'" />
            {{ !auth.user ? $t('cart.signInToPay') : (paying && isRealPayment ? $t('cart.redirecting') : (isRealPayment ? $t('cart.payReal') : $t('cart.pay'))) }}
          </button>
          <p class="paynote">{{ isRealPayment ? $t('cart.payNoteReal') : $t('cart.payNote') }}</p>
        </div>
        <p v-else class="ps-muted">{{ $t('cart.empty') }}</p>

        <!-- Pass -->
        <h2 class="ps-title">{{ $t('cart.ourPasses') }}</h2>
        <div class="plans">
          <div v-for="p in plans.filter(x => x.code !== 'free' && x.code !== 'per_museum')" :key="p.id" class="plan ps-card">
            <strong>{{ p.nom }}</strong>
            <span class="ps-price plan__price">{{ formatMontant(p.prix, p.devise) }} <small>{{ $t('cart.perDays', { n: p.duree_jours }) }}</small></span>
            <p>{{ p.description }}</p>
            <button class="ps-btn ps-btn--sm" @click="addPlan(p)"><i class="pi pi-plus" /> {{ $t('cart.addToCart') }}</button>
          </div>
          <div class="plan plan--muted ps-card">
            <strong>{{ $t('cart.passMuseum') }}</strong>
            <span class="ps-price plan__price">{{ $t('cart.passMuseumPrice') }} <small>{{ $t('cart.perDays', { n: 30 }) }}</small></span>
            <p>{{ $t('cart.passMuseumSub') }}</p>
            <router-link :to="to('/musees')" class="ps-btn ps-btn--line ps-btn--sm">{{ $t('cart.chooseMuseum') }}</router-link>
          </div>
        </div>

        <!-- Dons -->
        <h2 class="ps-title">{{ $t('cart.supportTitle') }}</h2>
        <div class="dons ps-chips">
          <button v-for="d in dons" :key="d.id" class="don" @click="addDon(d)">
            <i class="pi pi-heart" /> {{ d.label }} — <strong>{{ formatMontant(d.montant, d.devise) }}</strong>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ps-hero__in--slim { padding-top: 2rem; padding-bottom: 2rem; }

.cartbox { padding: 1.3rem 1.35rem; }
.citem { display: flex; align-items: center; gap: 0.95rem; padding: 0.8rem 0; border-bottom: 1px solid #f0f1ee; }
.citem__ic {
  width: 40px; height: 40px; border-radius: 50%; flex: 0 0 auto;
  background: color-mix(in srgb, var(--site-primary) 10%, #fff); color: var(--site-primary);
  display: flex; align-items: center; justify-content: center; font-size: 1rem;
}
.citem__b { flex: 1; min-width: 0; }
.citem__b strong { display: block; color: #101210; }
.citem__b span { font-size: 0.8rem; color: #7c817b; }
.citem__del { border: none; background: transparent; color: #c0392b; cursor: pointer; width: 34px; height: 34px; border-radius: 50%; }
.citem__del:hover { background: #fdf0ee; }
.ctotal { display: flex; justify-content: space-between; align-items: center; padding: 1.1rem 0 0.5rem; font-size: 1rem; color: #5c615c; }
.ctotal strong { font-family: 'Anton', 'Inter', sans-serif; font-size: 1.6rem; color: #101210; letter-spacing: 0.01em; }
.err { color: #c0392b; font-size: 0.88rem; }
.btn-pay { width: 100%; justify-content: center; margin-top: 0.6rem; }
.paynote { font-size: 0.78rem; color: #7c817b; text-align: center; margin: 0.7rem 0 0; }

.plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.1rem; }
.plan { padding: 1.25rem 1.3rem; display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; }
.plan--muted { background: #f2f4f1; }
.plan strong { font-size: 1.1rem; font-weight: 800; color: #101210; }
.plan__price { font-size: 1.3rem; }
.plan p { margin: 0 0 0.4rem; color: #5c615c; font-size: 0.88rem; flex: 1; line-height: 1.55; }

.dons .don { text-transform: none; letter-spacing: 0; font-weight: 600; font-size: 0.86rem; border-radius: 999px; }
.don i { color: #c0392b; margin-right: 0.3rem; }
.don strong { color: #101210; }

.okbox { text-align: center; padding: 2.8rem 1.6rem; }
.okbox > i { font-size: 3rem; color: var(--site-primary); }
.okbox h2 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; margin: 0.9rem 0 0.4rem; color: #101210; }
.okbox h2 small { color: #7c817b; font-weight: 500; text-transform: none; font-family: 'Inter', sans-serif; font-size: 0.85rem; }
.okbox p { color: #5c615c; }
.okbox__actions { display: flex; gap: 0.8rem; justify-content: center; margin-top: 1.3rem; flex-wrap: wrap; }
</style>
