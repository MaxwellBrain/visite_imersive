<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import GenealogyTree from '@/components/genealogy/GenealogyTree.vue'
import ReignTimeline from '@/components/genealogy/ReignTimeline.vue'
import { pubAllPersonnages } from '@/services/publicApi'
import { useSiteLink } from '@/composables/useSiteLink'
import { useRouter } from 'vue-router'
import { normalise, indexer, nomComplet, periode, rechercher, cheminFiliation } from '@/services/genealogy'

// Exploration publique de la généalogie des chefferies.
//
// Le fil narratif du projet arrive ici depuis un objet du musée. La page doit
// donc répondre à trois questions dans cet ordre : qui est-ce, d'où vient-il,
// et qu'est-ce qui le relie aux autres. D'où l'arbre navigable, la frise des
// règnes, et la comparaison de deux lignées.

const { to } = useSiteLink()
const router = useRouter()
const route = useRoute()

const people = ref([])
const focusId = ref(null)
const compareId = ref(null)
const q = ref('')
const loading = ref(true)

onMounted(async () => {
  people.value = normalise(await pubAllPersonnages())
  // On entre par la personne demandée dans l'adresse (lien depuis la visite),
  // sinon par le premier chef titré : l'arbre a plus de sens vu d'un règne.
  const demande = Number(route.query.p)
  const defaut = people.value.find((p) => p.titre) || people.value[0]
  focusId.value = people.value.some((p) => p.id === demande) ? demande : defaut?.id ?? null
  loading.value = false
})

const byId = computed(() => indexer(people.value))
const focus = computed(() => byId.value.get(focusId.value) || null)
const compare = computed(() => byId.value.get(compareId.value) || null)

const resultats = computed(() => rechercher(people.value, q.value))
const liste = computed(() => (q.value.trim() ? resultats.value : people.value))
const idsTrouves = computed(() => (q.value.trim() ? resultats.value.map((p) => p.id) : []))

// Chemin de filiation entre les deux personnes retenues — surligné dans l'arbre.
const chemin = computed(() =>
  compareId.value && compareId.value !== focusId.value
    ? cheminFiliation(people.value, focusId.value, compareId.value)
    : null
)
const cheminIds = computed(() => chemin.value || [])
const degre = computed(() => (chemin.value ? chemin.value.length - 1 : 0))

function centrer(id) {
  focusId.value = id
  if (compareId.value === id) compareId.value = null
}
function basculerComparaison(id) {
  compareId.value = compareId.value === id ? null : id
}
function ouvrir(id) {
  router.push(to(`/personnages/${id}`))
}

// L'adresse suit la personne au centre : un lien de visite reste partageable.
watch(focusId, (id) => {
  if (id != null) router.replace({ query: { ...route.query, p: String(id) } })
})
</script>

<template>
  <div>
    <header class="ps-hero">
      <div class="ps-hero__in">
        <span class="ps-hero__over">{{ $t('genealogy.eyebrow') }}</span>
        <h1>{{ $t('genealogy.title') }}</h1>
        <p class="ps-hero__lead">{{ $t('genealogy.lead') }}</p>
      </div>
    </header>

    <div class="ps-wrap">
      <p v-if="loading" class="ps-muted">{{ $t('common.loading') }}</p>
      <p v-else-if="!people.length" class="ps-muted">{{ $t('genealogy.empty') }}</p>

      <div v-else class="gen">
        <!-- ---------------- Colonne de gauche : recherche et liste ---------------- -->
        <aside class="gen__side">
          <div class="gen__search">
            <i class="pi pi-search" />
            <input v-model="q" type="text" :aria-label="$t('genealogy.searchPlaceholder')" :placeholder="$t('genealogy.searchPlaceholder')" />
            <button v-if="q" class="gen__clear" :aria-label="$t('common.close')" @click="q = ''">
              <i class="pi pi-times" />
            </button>
          </div>
          <p v-if="q.trim()" class="gen__count">
            {{ $t('genealogy.results', { n: resultats.length }) }}
          </p>

          <ul class="gen__list">
            <li v-for="p in liste" :key="p.id">
              <div class="gen__row" :class="{ on: p.id === focusId, cmp: p.id === compareId }">
                <button class="gen__item" @click="centrer(p.id)">
                  <img v-if="p.portrait" :src="p.portrait" :alt="nomComplet(p)" loading="lazy" decoding="async" />
                  <span v-else class="gen__ph"><i class="pi pi-user" /></span>
                  <span class="gen__item-b">
                    <strong>{{ nomComplet(p) }}</strong>
                    <small v-if="p.titre">{{ p.titre }}</small>
                    <small v-else-if="p.chefferie">{{ p.chefferie }}</small>
                    <small v-if="periode(p)" class="gen__per">{{ periode(p) }}</small>
                  </span>
                </button>
                <button
                  class="gen__cmp"
                  :title="$t('genealogy.compareWith', { name: nomComplet(p) })"
                  @click="basculerComparaison(p.id)"
                >
                  <i class="pi pi-link" />
                </button>
              </div>
            </li>
            <li v-if="!liste.length" class="gen__none">{{ $t('genealogy.noResult') }}</li>
          </ul>
        </aside>

        <!-- ---------------- Colonne principale ---------------- -->
        <section class="gen__main">
          <div v-if="focus" class="gen__head ps-card">
            <img v-if="focus.portrait" :src="focus.portrait" :alt="nomComplet(focus)" class="gen__portrait" />
            <div v-else class="gen__portrait gen__portrait--ph"><i class="pi pi-user" /></div>
            <div class="gen__head-b">
              <span v-if="focus.titre" class="ps-over">{{ focus.titre }}</span>
              <h2>{{ nomComplet(focus) }}</h2>
              <p v-if="periode(focus)" class="gen__life">{{ periode(focus) }}</p>
              <p v-if="focus.chefferie" class="gen__chefferie"><i class="pi pi-map-marker" /> {{ focus.chefferie }}</p>
              <router-link :to="to(`/personnages/${focus.id}`)" class="ps-link">
                {{ $t('genealogy.seeProfile') }} <i class="pi pi-arrow-right" />
              </router-link>
            </div>
          </div>

          <!-- Résultat de la comparaison : le lien de sang, ou son absence -->
          <div v-if="compare" class="gen__link-box ps-card">
            <i class="pi pi-sitemap" />
            <div class="gen__link-txt">
              <strong v-if="chemin">
                {{ $t('genealogy.pathFound', { a: nomComplet(focus), b: nomComplet(compare), n: degre }) }}
              </strong>
              <strong v-else>{{ $t('genealogy.pathNone', { a: nomComplet(focus), b: nomComplet(compare) }) }}</strong>
              <span v-if="chemin">{{ $t('genealogy.pathHint') }}</span>
              <span v-else>{{ $t('genealogy.pathNoneHint') }}</span>
            </div>
            <button class="gen__link-x" :aria-label="$t('common.close')" @click="compareId = null">
              <i class="pi pi-times" />
            </button>
          </div>

          <div class="gen__tree-wrap">
            <GenealogyTree
              :people="people"
              :focus-id="focusId"
              :highlight-ids="idsTrouves"
              :path-ids="cheminIds"
              :height="560"
              variant="public"
              @focus="centrer"
              @open="ouvrir"
            />
          </div>

          <ReignTimeline :people="people" :focus-id="focusId" @focus="centrer" />
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gen { display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 1.5rem; align-items: start; }
@media (max-width: 900px) { .gen { grid-template-columns: 1fr; } }

.gen__side { position: sticky; top: 90px; }
.gen__search {
  display: flex; align-items: center; gap: 0.5rem; background: #fff;
  border: 1px solid #dcdedb; border-radius: 6px; padding: 0.65rem 0.85rem; margin-bottom: 0.6rem;
}
.gen__search input { border: none; outline: none; background: transparent; width: 100%; font-family: inherit; font-size: 0.92rem; }
.gen__search i { color: #7c817b; }
.gen__clear { border: 0; background: none; cursor: pointer; color: #9aa09a; padding: 0; }
.gen__count { margin: 0 0 0.6rem; font-size: 0.78rem; color: var(--site-primary, #0e6f5c); font-weight: 700; }

.gen__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; max-height: 58vh; overflow-y: auto; }
.gen__none { color: #9aa09a; font-size: 0.86rem; padding: 0.8rem 0.2rem; }
.gen__row {
  display: flex; align-items: stretch; background: #fff;
  border: 1px solid #e8e9e6; border-radius: 8px; overflow: hidden; transition: 0.15s;
}
.gen__row:hover { border-color: var(--site-primary, #0e6f5c); }
.gen__row.on { border-color: var(--site-primary, #0e6f5c); background: color-mix(in srgb, var(--site-primary) 7%, #fff); }
.gen__row.cmp { border-color: var(--gold, #c9a227); background: color-mix(in srgb, var(--gold) 10%, #fff); }
.gen__item {
  flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 0.7rem;
  cursor: pointer; text-align: left; background: none; border: 0; padding: 0.6rem 0.7rem; font-family: inherit;
}
.gen__cmp {
  flex: 0 0 auto; width: 36px; border: 0; border-left: 1px solid #eef0ec;
  background: none; cursor: pointer; color: #b3b8b2;
}
.gen__cmp:hover { color: var(--gold, #c9a227); background: #faf8f2; }
.gen__row.cmp .gen__cmp { color: var(--gold, #c9a227); }
.gen__item img, .gen__ph { width: 42px; height: 42px; border-radius: 50%; object-fit: cover; flex: 0 0 42px; }
.gen__ph { display: flex; align-items: center; justify-content: center; background: #eef0ed; color: #b9beb8; }
.gen__item-b { min-width: 0; display: flex; flex-direction: column; }
.gen__item-b strong { font-size: 0.92rem; color: #101210; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gen__item-b small { font-size: 0.75rem; color: #7c817b; }
.gen__per { font-variant-numeric: tabular-nums; }

.gen__main { display: flex; flex-direction: column; gap: 1.2rem; }
.gen__head { display: flex; gap: 1.2rem; padding: 1.3rem 1.4rem; align-items: center; }
.gen__portrait { width: 96px; height: 96px; border-radius: 10px; object-fit: cover; flex: 0 0 96px; }
.gen__portrait--ph { display: flex; align-items: center; justify-content: center; background: #eef0ed; color: #b9beb8; font-size: 2.2rem; }
.gen__head-b h2 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: 1.7rem; margin: 0.25rem 0 0.3rem; color: #101210; }
.gen__life { margin: 0 0 0.25rem; color: #5c615c; font-size: 0.92rem; font-variant-numeric: tabular-nums; }
.gen__chefferie { margin: 0 0 0.7rem; color: #7c817b; font-size: 0.85rem; }
.gen__chefferie i { color: var(--site-primary, #0e6f5c); margin-right: 0.3rem; }

.gen__link-box { display: flex; align-items: center; gap: 0.9rem; padding: 0.9rem 1.1rem; border-left: 4px solid var(--gold, #c9a227); }
.gen__link-box > i { color: var(--gold, #c9a227); font-size: 1.2rem; }
.gen__link-txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
.gen__link-txt strong { font-size: 0.95rem; color: #101210; }
.gen__link-txt span { font-size: 0.82rem; color: #7c817b; }
.gen__link-x { border: 0; background: none; cursor: pointer; color: #9aa09a; }
</style>
