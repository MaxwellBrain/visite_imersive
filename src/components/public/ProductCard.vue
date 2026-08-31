<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCartStore } from '@/stores/useCartStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

const props = defineProps({ product: { type: Object, required: true } })
const { t } = useI18n()
// LA CONFIRMATION EST SUR LA CARTE, PAS DANS UN COIN DE L'ÉCRAN.
//
// Ce composant utilisait le toast de PrimeVue. C'était le SEUL lien du site
// public vers cette bibliothèque — et comme la carte figure sur la page
// d'accueil, il obligeait chaque visiteur à télécharger tout PrimeVue pour un
// message de deux secondes.
//
// Le remplacer par un état local n'est pas seulement plus léger : « Ajouté ✓ »
// s'affiche LÀ OÙ LE DOIGT VIENT D'APPUYER, au lieu d'apparaître à l'autre bout
// de l'écran, ce qui est le bon endroit pour un retour d'action.
const message = ref('')
let minuterie = null
const cart = useCartStore()
const settings = useSettingsStore()

// Commande directe par WhatsApp (usage courant au Cameroun) — gratuit, via wa.me.
// Le numéro provient des réglages du site (lien WhatsApp ou téléphone de contact).
const whatsappUrl = computed(() => {
  const s = settings.settings || {}
  const raw = s.reseaux?.whatsapp || s.contactTel || ''
  const digits = String(raw).replace(/\D/g, '')
  if (!digits) return null
  const msg = t('boutique.waMessage', { name: props.product.nom, price: money(props.product.prix, props.product.devise) })
  return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`
})

function money(v, d) {
  if (v == null) return ''
  return `${Number(v).toLocaleString('fr-FR')} ${d || 'FCFA'}`
}
function addToCart() {
  const ok = cart.add({
    type: 'produit',
    refId: props.product.id,
    museumId: props.product.museumId,
    label: props.product.nom,
    montant: props.product.prix || 0,
    devise: props.product.devise || 'FCFA'
  })
  message.value = ok ? t('boutique.added') : t('boutique.alreadyIn')
  // On repart de zéro à chaque clic : sans cela, deux ajouts rapprochés
  // laisseraient la première minuterie effacer le second message.
  clearTimeout(minuterie)
  minuterie = setTimeout(() => { message.value = '' }, 1800)
}
</script>

<template>
  <article class="pc">
    <div class="pc__img">
      <img v-if="product.image" :src="product.image" :alt="product.nom" loading="lazy" />
      <div v-else class="pc__ph"><i class="pi pi-shopping-bag" /></div>
      <span v-if="product.categorie" class="pc__cat">{{ product.categorie }}</span>
    </div>
    <div class="pc__body">
      <h3 class="pc__name">{{ product.nom }}</h3>
      <p v-if="product.description" class="pc__desc">{{ product.description }}</p>
      <div class="pc__foot">
        <strong class="pc__price">{{ money(product.prix, product.devise) }}</strong>
        <div class="pc__btns">
          <a
            v-if="whatsappUrl" :href="whatsappUrl" target="_blank" rel="noopener"
            class="pc__wa" :title="$t('boutique.orderWhatsApp')" :aria-label="$t('boutique.orderWhatsApp')"
          ><i class="pi pi-whatsapp" /></a>
          <button class="pc__add" :aria-label="$t('boutique.add')" @click="addToCart">
            <i class="pi pi-shopping-bag" /> {{ $t('boutique.add') }}
          </button>
        </div>
      </div>
      <p v-if="message" class="pc__ok" role="status" aria-live="polite">
        <i class="pi pi-check-circle" /> {{ message }}
      </p>
    </div>
  </article>
</template>

<style scoped>
.pc__ok {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.5rem 0 0;
  font-size: 0.78rem;
  font-weight: 700;
  color: #1f7a4d;
}
.pc { background: #fff; border: 1px solid #e8e9e6; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; transition: transform 0.18s, box-shadow 0.18s; }
.pc:hover { transform: translateY(-4px); box-shadow: 0 20px 44px -20px rgba(10,20,15,0.28); }
.pc__img { position: relative; aspect-ratio: 1 / 1; background: #eef0ed; overflow: hidden; }
.pc__img img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.35s; }
.pc:hover .pc__img img { transform: scale(1.05); }
.pc__ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #b9beb8; font-size: 2.4rem; }
.pc__cat { position: absolute; top: 0.7rem; left: 0.7rem; background: #0d0f0d; color: #fff; font-size: 0.64rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.28rem 0.6rem; border-radius: 4px; }
.pc__body { padding: 0.95rem 1rem 1.1rem; display: flex; flex-direction: column; flex: 1; }
.pc__name { font-size: 0.98rem; font-weight: 600; margin: 0 0 0.3rem; color: #101210; }
.pc__desc { margin: 0 0 0.85rem; font-size: 0.8rem; color: #7c817b; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pc__foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.pc__price { font-size: 1.18rem; color: #101210; font-weight: 800; letter-spacing: -0.01em; }
.pc__btns { display: flex; align-items: center; gap: 0.4rem; }
.pc__add { display: inline-flex; align-items: center; gap: 0.4rem; background: var(--site-primary, #0e6f5c); color: #fff; border: none; border-radius: 4px; padding: 0.55rem 0.95rem; font-weight: 800; font-size: 0.74rem; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; transition: 0.15s; }
.pc__add:hover { filter: brightness(1.12); transform: translateY(-1px); }
.pc__wa {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 4px; flex: 0 0 auto;
  background: #25d366; color: #fff; font-size: 1.05rem; transition: 0.15s;
}
.pc__wa:hover { filter: brightness(1.08); transform: translateY(-1px); }
</style>
