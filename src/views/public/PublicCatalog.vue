<script setup>
import { ref, computed, onMounted } from 'vue'
import { pubMuseums } from '@/services/publicApi'
import { useSiteLink } from '@/composables/useSiteLink'

// Liens internes : reste sur le site consulte (/site ou /c/<slug>)
const { to } = useSiteLink()

const museums = ref([])
const q = ref('')
const type = ref(null)
const loading = ref(true)

onMounted(async () => {
  museums.value = await pubMuseums()
  loading.value = false
})

const types = computed(() => [...new Set(museums.value.map((m) => m.type).filter(Boolean))])
const filtered = computed(() => {
  const t = q.value.trim().toLowerCase()
  return museums.value.filter((m) => {
    const okQ = !t || m.nom.toLowerCase().includes(t) || (m.description || '').toLowerCase().includes(t)
    const okT = !type.value || m.type === type.value
    return okQ && okT
  })
})
</script>

<template>
  <div>
    <!-- Bandeau de page -->
    <header class="ps-hero">
      <div class="ps-hero__in">
        <span class="ps-hero__over">{{ $t('catalog.eyebrow') }}</span>
        <h1>{{ $t('catalog.title') }}</h1>
        <p class="ps-hero__lead">{{ $t('catalog.lead') }}</p>
        <div class="csearch">
          <i class="pi pi-search" />
          <input v-model="q" type="text" :aria-label="$t('catalog.searchPlaceholder')" :placeholder="$t('catalog.searchPlaceholder')" />
        </div>
      </div>
    </header>

    <div class="ps-wrap">
      <div v-if="types.length" class="ps-chips cat-chips">
        <button :class="{ on: !type }" @click="type = null">{{ $t('common.all') }}</button>
        <button v-for="t in types" :key="t" :class="{ on: type === t }" @click="type = t">{{ t }}</button>
      </div>

      <p v-if="loading" class="ps-muted">{{ $t('common.loading') }}</p>
      <div v-else-if="filtered.length" class="cards">
        <router-link v-for="m in filtered" :key="m.id" :to="to(`/musees/${m.id}`)" class="mcard ps-card ps-card--hover">
          <div class="mcard__img">
            <img v-if="m.photo" :src="m.photo" :alt="m.nom" loading="lazy" decoding="async" />
            <div v-else class="ps-ph"><i class="pi pi-building" /></div>
            <span v-if="m.type" class="ps-tag mcard__type">{{ m.type }}</span>
          </div>
          <div class="mcard__b">
            <strong>{{ m.nom }}</strong>
            <p>{{ m.description }}</p>
            <span class="ps-link">{{ $t('home.heroCta') }} <i class="pi pi-arrow-right" /></span>
          </div>
        </router-link>
      </div>
      <p v-else class="ps-muted">{{ $t('catalog.empty') }}</p>
    </div>
  </div>
</template>

<style scoped>
/* Recherche intégrée au bandeau noir */
.csearch {
  margin-top: 1.4rem; display: flex; align-items: center; gap: 0.6rem;
  background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px; padding: 0.75rem 1rem; max-width: 460px; backdrop-filter: blur(4px);
}
.csearch:focus-within { border-color: var(--site-primary); background: rgba(255, 255, 255, 0.14); }
.csearch input { border: none; outline: none; background: transparent; width: 100%; font-family: inherit; color: #fff; font-size: 0.95rem; }
.csearch input::placeholder { color: rgba(255, 255, 255, 0.55); }
.csearch i { color: rgba(255, 255, 255, 0.7); }

.cat-chips { margin-bottom: 1.8rem; }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.4rem; }
.mcard { overflow: hidden; display: flex; flex-direction: column; }
.mcard__img { position: relative; height: 200px; background: #eef0ed; overflow: hidden; }
.mcard__img img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.35s; }
.mcard:hover .mcard__img img { transform: scale(1.04); }
.mcard__type { position: absolute; top: 0.8rem; left: 0.8rem; }
.mcard__b { padding: 1.1rem 1.2rem 1.25rem; display: flex; flex-direction: column; gap: 0.45rem; }
.mcard__b strong { font-size: 1.18rem; font-weight: 800; color: #101210; }
.mcard__b p { margin: 0; color: #5c615c; font-size: 0.9rem; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mcard__b .ps-link { margin-top: 0.35rem; }
</style>
