<script setup>
import { formatMontant } from '@/constants/options'
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { useSectorStore } from '@/stores/useSectorStore'
import { useObjectStore } from '@/stores/useObjectStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useOrderStore } from '@/stores/useOrderStore'
import { useProductStore } from '@/stores/useProductStore'
import { useReviewStore } from '@/stores/useReviewStore'

const { t, locale } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const museumStore = useMuseumStore()
const sectorStore = useSectorStore()
const objectStore = useObjectStore()
const orderStore = useOrderStore()
const productStore = useProductStore()
const reviewStore = useReviewStore()

onMounted(() => {
  if (!orderStore.items.length) orderStore.load()
  if (!productStore.items.length) productStore.load()
  if (!reviewStore.items.length) reviewStore.load()
})

// ---- Indicateurs commerce ----
function money(v) { return formatMontant(v) }

const commerceStats = computed(() => [
  { label: t('admin.dashboard.statRevenue'), value: money(orderStore.revenue), icon: 'pi pi-wallet', to: '/commandes', tone: 'green' },
  { label: t('admin.dashboard.statOrders'), value: orderStore.paid.length, icon: 'pi pi-receipt', to: '/commandes', tone: 'blue' },
  { label: t('admin.dashboard.statToPrepare'), value: orderStore.pendingCount, icon: 'pi pi-clock', to: '/commandes', tone: 'orange' },
  { label: t('admin.dashboard.statProducts'), value: productStore.items.filter((p) => p.published).length, icon: 'pi pi-shopping-bag', to: '/produits', tone: 'green' },
  { label: t('admin.dashboard.statReviews'), value: reviewStore.pending.length, icon: 'pi pi-comments', to: '/evenements', tone: 'orange' }
])

// Top produits vendus (à partir des lignes de commandes payées).
const topProducts = computed(() => {
  const tally = new Map()
  for (const o of orderStore.paid) {
    for (const it of o.items) {
      if (it.type !== 'produit') continue
      const cur = tally.get(it.label) || { label: it.label, qty: 0, total: 0 }
      cur.qty += 1
      cur.total += it.montant
      tally.set(it.label, cur)
    }
  }
  return [...tally.values()].sort((a, b) => b.qty - a.qty).slice(0, 5)
})

const userName = computed(() => {
  const n = auth.user?.email?.split('@')[0] || 'Admin'
  return n.charAt(0).toUpperCase() + n.slice(1)
})

const published = computed(() => objectStore.items.filter((o) => o.published).length)
const drafts = computed(() => objectStore.items.length - published.value)

// Cartes KPI (style Génius : label + icône en carré, grande valeur)
const stats = computed(() => [
  { label: t('admin.dashboard.statMuseums'), value: museumStore.items.length, icon: 'pi pi-building', to: '/musees' },
  { label: t('admin.dashboard.statObjects'), value: objectStore.items.length, icon: 'pi pi-box', to: '/objets' },
  { label: t('admin.dashboard.statPublished'), value: published.value, icon: 'pi pi-globe', to: '/objets' },
  { label: t('admin.dashboard.statDrafts'), value: drafts.value, icon: 'pi pi-exclamation-triangle', to: '/objets', alert: true }
])

const recent = computed(() => [...objectStore.items].slice(-5).reverse())

const publishedHistory = computed(() =>
  objectStore.items
    .filter((o) => o.published)
    .slice()
    .sort(
      (a, b) =>
        new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt)
    )
)

function locationLabel(obj) {
  const sector = sectorStore.getById(obj.sectorId)
  const museum = sector ? museumStore.getById(sector.museumId) : null
  return sector ? `${museum?.nom ?? '—'} › ${sector.nom}` : '—'
}

function formatDate(d) {
  if (!d) return '—'
  return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(d)
  )
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('admin.dashboard.welcome', { name: userName }) }}</h1>
        <p class="vi-page__subtitle">{{ $t('admin.dashboard.subtitle') }}</p>
      </div>
    </div>

    <!-- Cartes KPI (style Génius : label + icône, grande valeur) -->
    <div class="stats">
      <button v-for="s in stats" :key="s.label" class="stat" @click="router.push(s.to)">
        <span class="stat__top">
          <span class="stat__label">{{ s.label }}</span>
          <span class="stat__icon" :class="{ 'stat__icon--alert': s.alert }"><i :class="s.icon" /></span>
        </span>
        <span class="stat__value">{{ s.value }}</span>
      </button>
    </div>

    <!-- Commerce : recettes, commandes, boutique -->
    <h2 class="dash-sec">{{ $t('admin.dashboard.commerceTitle') }}</h2>
    <div class="stats stats--commerce">
      <button v-for="c in commerceStats" :key="c.label" class="stat" @click="router.push(c.to)">
        <span class="stat__top">
          <span class="stat__label">{{ c.label }}</span>
          <span class="stat__icon" :class="`stat__icon--${c.tone}`"><i :class="c.icon" /></span>
        </span>
        <span class="stat__value">{{ c.value }}</span>
      </button>
    </div>

    <div class="dash-grid">
      <section class="panel">
        <header class="panel__head">
          <h2>{{ $t('admin.dashboard.recentTitle') }}</h2>
          <Button :label="$t('admin.dashboard.seeAll')" icon="pi pi-arrow-right" icon-pos="right" text size="small" @click="router.push('/objets')" />
        </header>
        <ul v-if="recent.length" class="recent">
          <li v-for="o in recent" :key="o.id">
            <div class="recent__main">
              <strong>{{ o.nom }}</strong>
              <span>{{ locationLabel(o) }}</span>
            </div>
            <Tag :value="o.published ? $t('admin.common.published') : $t('admin.common.draft')" :severity="o.published ? 'success' : 'warn'" />
          </li>
        </ul>
        <div v-else class="vi-empty"><i class="pi pi-box" /><p>{{ $t('admin.dashboard.noObjects') }}</p></div>
      </section>

      <section class="panel">
        <header class="panel__head">
          <h2>{{ $t('admin.dashboard.historyTitle') }}</h2>
          <span class="panel__count">{{ $t('admin.dashboard.publishedCount', { n: publishedHistory.length }) }}</span>
        </header>
        <ul v-if="publishedHistory.length" class="timeline">
          <li v-for="o in publishedHistory" :key="o.id">
            <span class="timeline__dot" />
            <div class="timeline__body">
              <strong>{{ o.nom }}</strong>
              <span class="timeline__loc">{{ locationLabel(o) }}</span>
              <span class="timeline__date">
                <i class="pi pi-globe" /> {{ $t('admin.dashboard.publishedOn', { date: formatDate(o.publishedAt || o.createdAt) }) }}
              </span>
            </div>
          </li>
        </ul>
        <div v-else class="vi-empty">
          <i class="pi pi-globe" />
          <p>{{ $t('admin.dashboard.noPublished') }}</p>
        </div>
      </section>

      <section class="panel">
        <header class="panel__head">
          <h2>{{ $t('admin.dashboard.topProductsTitle') }}</h2>
          <Button :label="$t('admin.dashboard.seeAll')" icon="pi pi-arrow-right" icon-pos="right" text size="small" @click="router.push('/produits')" />
        </header>
        <ul v-if="topProducts.length" class="top-list">
          <li v-for="(p, i) in topProducts" :key="p.label">
            <span class="top-rank">{{ i + 1 }}</span>
            <span class="top-name">
              {{ p.label }}
              <span class="top-qty">{{ $t('admin.dashboard.soldTimes', { n: p.qty }) }}</span>
            </span>
            <span class="top-total">{{ money(p.total) }}</span>
          </li>
        </ul>
        <div v-else class="vi-empty">
          <i class="pi pi-shopping-bag" />
          <p>{{ $t('admin.dashboard.noSales') }}</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* ---------- Cartes KPI (style Génius) ---------- */
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 1.25rem;
  margin-bottom: 1.75rem;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem 1.4rem 1.4rem;
  background: var(--vi-surface);
  border: 1px solid var(--vi-border);
  border-radius: var(--vi-radius);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  box-shadow: var(--vi-shadow-sm);
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.stat:hover {
  transform: translateY(-2px);
  box-shadow: var(--vi-shadow-md);
  border-color: color-mix(in srgb, var(--p-primary-color) 30%, var(--vi-border));
}
.stat__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.stat__label {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--vi-muted);
}
.stat__icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--vi-surface-2);
  color: var(--vi-text);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  flex-shrink: 0;
}
.stat__icon--alert {
  background: color-mix(in srgb, var(--p-primary-color) 14%, var(--vi-surface));
  color: var(--p-primary-color);
}
/* Indicateurs commerce */
.dash-sec { font-size: 1.05rem; margin: 2rem 0 1rem; }
.stats--commerce { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.stat__icon--green { background: #e6f4ee; color: #0e6f5c; }
.stat__icon--blue { background: #e7eefc; color: #2b5fd9; }
.stat__icon--orange { background: #fdf0e3; color: #c1741a; }
/* Top produits */
.top-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.top-list li { display: flex; align-items: center; gap: 0.75rem; background: var(--vi-bg); border-radius: 10px; padding: 0.6rem 0.85rem; }
.top-rank { width: 24px; height: 24px; border-radius: 50%; background: #0e6f5c; color: #fff; font-size: 0.75rem; font-weight: 800; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.top-name { flex: 1; min-width: 0; font-size: 0.9rem; }
.top-qty { font-size: 0.78rem; color: var(--vi-muted); }
.top-total { font-weight: 700; font-size: 0.9rem; }
.stat__value {
  font-size: 2rem;
  font-weight: 800;
  line-height: 1;
  color: var(--vi-text);
}

.dash-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  gap: 1.25rem;
}
@media (max-width: 900px) {
  .dash-grid {
    grid-template-columns: 1fr;
  }
}
.panel {
  background: var(--vi-surface);
  border: 1px solid var(--vi-border);
  border-radius: 16px;
  padding: 1.1rem 1.25rem 1.25rem;
  box-shadow: var(--vi-shadow-sm);
}
.panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.9rem;
}
.panel__head h2 {
  margin: 0;
  font-size: 1.1rem;
}
.panel__count {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--p-primary-color);
}
.recent {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.recent li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 0;
  border-top: 1px solid var(--vi-border);
}
.recent li:first-child {
  border-top: none;
}
.recent__main {
  display: flex;
  flex-direction: column;
}
.recent__main span {
  color: var(--vi-muted);
  font-size: 0.8rem;
}

/* ---------- Frise chronologique de publication ---------- */
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}
.timeline li {
  position: relative;
  padding: 0 0 1.15rem 1.5rem;
}
.timeline li:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 0.55rem;
  bottom: -0.15rem;
  width: 2px;
  background: var(--vi-border);
}
.timeline__dot {
  position: absolute;
  left: 0;
  top: 0.35rem;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--p-primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 22%, transparent);
}
.timeline__body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.timeline__body strong {
  font-size: 0.95rem;
}
.timeline__loc {
  color: var(--vi-muted);
  font-size: 0.8rem;
}
.timeline__date {
  color: var(--p-primary-color);
  font-size: 0.78rem;
  font-weight: 600;
  margin-top: 0.1rem;
}
.timeline__date i {
  font-size: 0.72rem;
  margin-right: 0.25rem;
}
</style>
