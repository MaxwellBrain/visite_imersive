<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import Button from 'primevue/button'
import DatePicker from 'primevue/datepicker'
import Slider from 'primevue/slider'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import { formatMontant } from '@/constants/options'
import {
  cubeVentes, frequentation, reglesPanier, objetsCovus, fiabilite, lireLift,
  couvertureFreres
} from '@/services/biApi'

// DÉCISIONNEL — la sortie visible de l'entrepôt de données.
//
// Deux familles d'analyse, volontairement séparées car elles ne se lisent pas
// de la même façon :
//   • le CUBE (ROLLUP) répond à « combien, où, quand » — un fait comptable ;
//   • les RÈGLES d'association répondent à « qu'est-ce qui va avec quoi » —
//     une inférence statistique, qui n'a de sens qu'au-dessus d'un certain
//     volume. D'où l'avertissement de fiabilité, affiché en tête et non caché
//     en bas de page : une règle calculée sur 4 commandes s'affiche avec la
//     même autorité qu'une règle solide, et c'est précisément le piège.
//
// Tout le calcul est en base (voir biApi.js). Ici : présentation seulement.

const { t, locale } = useI18n()

const onglet = ref('0')
const chargement = ref(true)

const cube = ref([])
const freq = ref([])
const regles = ref([])
const covus = ref([])
const fiab = ref(null)
const couv = ref(null)

// Filtres du cube. Nuls par défaut : on montre tout l'historique d'abord,
// l'utilisateur restreint ensuite s'il le souhaite.
const depuis = ref(null)
const jusqu = ref(null)
// Support minimal en POURCENTAGE pour le curseur ; converti en fraction pour
// la base, qui raisonne en 0-1.
const supportPct = ref(2)

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : null)

async function chargerCube() {
  cube.value = await cubeVentes({ depuis: iso(depuis.value), jusqu: iso(jusqu.value) })
  freq.value = await frequentation({ depuis: iso(depuis.value), jusqu: iso(jusqu.value) })
}

async function chargerRegles() {
  regles.value = await reglesPanier({ supportMin: supportPct.value / 100, limite: 40 })
  covus.value = await objetsCovus({ jours: 180, limite: 40 })
}

onMounted(async () => {
  chargement.value = true
  fiab.value = await fiabilite()
  couv.value = await couvertureFreres()
  await Promise.all([chargerCube(), chargerRegles()])
  chargement.value = false
})

// Répartition des institutions par pays détenteur. C'est le chiffre qui porte
// le propos de « Mémoire Réunifiée » : montrer où sont réellement parties les
// pièces, plutôt qu'un simple total.
const parPays = computed(() => {
  const liste = couv.value?.par_institution || []
  const m = new Map()
  for (const i of liste) {
    const pays = i.pays || t('admin.bi.unknownCountry')
    if (!m.has(pays)) m.set(pays, { pays, institutions: 0, objets: 0 })
    const e = m.get(pays)
    e.institutions++
    e.objets += Number(i.n) || 0
  }
  return [...m.values()].sort((a, b) => b.objets - a.objets)
})

const maxObjetsPays = computed(() =>
  Math.max(1, ...parPays.value.map((p) => p.objets)))

const institutions = computed(() => couv.value?.par_institution || [])

const fmtMois = (d) => {
  if (!d) return '—'
  return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-GB' : 'fr-FR', {
    month: 'long', year: 'numeric'
  }).format(new Date(d))
}

// Le cube renvoie trois niveaux dans la MÊME table : détail, sous-total par
// musée, total général. Sans distinction visuelle, on additionnerait des
// lignes déjà agrégées — l'erreur classique de lecture d'un ROLLUP.
const classeLigne = (d) => ({
  'l-total': d.niveau === 'total',
  'l-soustotal': d.niveau === 'sous_total_musee'
})

const libelleNiveau = (n) => ({
  detail: t('admin.bi.lvlDetail'),
  sous_total_musee: t('admin.bi.lvlSubtotal'),
  total: t('admin.bi.lvlTotal')
}[n] || n)

const pourcent = (v) => `${(Number(v || 0) * 100).toFixed(1)} %`

// Barre proportionnelle : la lecture d'un lift est plus rapide en longueur
// qu'en chiffre. Plafonnée à 3 — au-delà, l'échelle écraserait tout le reste.
const largeurLift = (lift) => `${Math.min(Number(lift || 0) / 3, 1) * 100}%`

const aucuneVente = computed(() => !chargement.value && !cube.value.length)
const aucuneRegle = computed(() => !chargement.value && !regles.value.length)
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('admin.bi.title') }}</h1>
        <p class="vi-page__subtitle">{{ $t('admin.bi.subtitle') }}</p>
      </div>
    </div>

    <!-- Volumétrie : ce qui autorise, ou non, à conclure. -->
    <div v-if="fiab" class="vi-stats">
      <div class="vi-stat">
        <span class="vi-stat__label">{{ $t('admin.bi.statOrders') }}</span>
        <strong>{{ fiab.commandes }}</strong>
      </div>
      <div class="vi-stat">
        <span class="vi-stat__label">{{ $t('admin.bi.statLines') }}</span>
        <strong>{{ fiab.lignes_vente }}</strong>
      </div>
      <div class="vi-stat">
        <span class="vi-stat__label">{{ $t('admin.bi.statDays') }}</span>
        <strong>{{ fiab.jours_observes }}</strong>
      </div>
      <div class="vi-stat">
        <span class="vi-stat__label">{{ $t('admin.bi.statObjects') }}</span>
        <strong>{{ fiab.objets_vus }}</strong>
      </div>
    </div>

    <Message v-if="fiab?.avertissement" severity="warn" :closable="false" class="bi-avert">
      <strong>{{ $t('admin.bi.warnTitle') }}</strong> — {{ fiab.avertissement }}
    </Message>

    <Tabs :value="onglet" @update:value="onglet = $event">
      <TabList>
        <Tab value="0">{{ $t('admin.bi.tabCube') }}</Tab>
        <Tab value="1">{{ $t('admin.bi.tabRules') }}</Tab>
        <Tab value="2">{{ $t('admin.bi.tabTraffic') }}</Tab>
        <Tab value="3">{{ $t('admin.bi.tabCoverage') }}</Tab>
      </TabList>

      <TabPanels>
        <!-- ============================ CUBE OLAP ============================ -->
        <TabPanel value="0">
          <p class="bi-lead">{{ $t('admin.bi.cubeLead') }}</p>

          <div class="bi-filtres">
            <label>
              <span>{{ $t('admin.bi.from') }}</span>
              <DatePicker v-model="depuis" date-format="dd/mm/yy" show-icon :max-date="jusqu || undefined" />
            </label>
            <label>
              <span>{{ $t('admin.bi.to') }}</span>
              <DatePicker v-model="jusqu" date-format="dd/mm/yy" show-icon :min-date="depuis || undefined" />
            </label>
            <Button :label="$t('admin.bi.apply')" icon="pi pi-filter" @click="chargerCube" />
            <Button v-if="depuis || jusqu" :label="$t('admin.bi.reset')" text
                    @click="depuis = null; jusqu = null; chargerCube()" />
          </div>

          <DataTable :value="cube" :loading="chargement" :row-class="classeLigne"
                     data-key="" striped-rows paginator :rows="20" class="bi-table">
            <template #empty>
              <div class="vi-empty">
                <i class="pi pi-chart-bar" />
                <strong>{{ $t('admin.bi.emptyCubeTitle') }}</strong>
                <p>{{ $t('admin.bi.emptyCube') }}</p>
              </div>
            </template>

            <Column field="musee" :header="$t('admin.bi.colMuseum')" sortable />
            <Column :header="$t('admin.bi.colMonth')" sortable field="mois">
              <template #body="{ data }">{{ data.mois ? fmtMois(data.mois) : '—' }}</template>
            </Column>
            <Column field="nb_lignes" :header="$t('admin.bi.colLines')" sortable style="width:8rem" />
            <Column :header="$t('admin.bi.colRevenue')" sortable field="chiffre" style="width:11rem">
              <template #body="{ data }">
                <strong>{{ formatMontant(data.chiffre) }}</strong>
              </template>
            </Column>
            <Column :header="$t('admin.bi.colLevel')" style="width:9rem">
              <template #body="{ data }">
                <Tag :value="libelleNiveau(data.niveau)"
                     :severity="data.niveau === 'total' ? 'contrast' : data.niveau === 'sous_total_musee' ? 'info' : 'secondary'" />
              </template>
            </Column>
          </DataTable>

          <p v-if="!aucuneVente" class="bi-note">{{ $t('admin.bi.cubeNote') }}</p>
        </TabPanel>

        <!-- ======================= RÈGLES D'ASSOCIATION ====================== -->
        <TabPanel value="1">
          <p class="bi-lead">{{ $t('admin.bi.rulesLead') }}</p>

          <div class="bi-filtres">
            <label class="bi-slider">
              <span>{{ $t('admin.bi.minSupport', { n: supportPct }) }}</span>
              <Slider v-model="supportPct" :min="1" :max="20" />
            </label>
            <Button :label="$t('admin.bi.apply')" icon="pi pi-filter" @click="chargerRegles" />
          </div>

          <h3 class="bi-h3">{{ $t('admin.bi.basketTitle') }}</h3>
          <DataTable :value="regles" :loading="chargement" striped-rows paginator :rows="10" class="bi-table">
            <template #empty>
              <div class="vi-empty">
                <i class="pi pi-sitemap" />
                <strong>{{ $t('admin.bi.emptyRulesTitle') }}</strong>
                <p>{{ $t('admin.bi.emptyRules') }}</p>
              </div>
            </template>

            <Column :header="$t('admin.bi.colRule')">
              <template #body="{ data }">
                <span class="bi-regle">
                  <strong>{{ data.article_a }}</strong>
                  <i class="pi pi-arrow-right" />
                  <strong>{{ data.article_b }}</strong>
                </span>
              </template>
            </Column>
            <Column field="ensemble" :header="$t('admin.bi.colTogether')" sortable style="width:8rem" />
            <Column :header="$t('admin.bi.colSupport')" sortable field="support" style="width:8rem">
              <template #body="{ data }">{{ pourcent(data.support) }}</template>
            </Column>
            <Column :header="$t('admin.bi.colConfidence')" sortable field="confiance" style="width:9rem">
              <template #body="{ data }">{{ pourcent(data.confiance) }}</template>
            </Column>
            <Column :header="$t('admin.bi.colLift')" sortable field="lift" style="width:13rem">
              <template #body="{ data }">
                <div class="bi-lift">
                  <div class="bi-lift__barre">
                    <span :style="{ width: largeurLift(data.lift) }"
                          :class="`is-${lireLift(data.lift).cle}`" />
                  </div>
                  <span class="bi-lift__val">{{ Number(data.lift || 0).toFixed(2) }}</span>
                </div>
              </template>
            </Column>
          </DataTable>

          <Message severity="secondary" :closable="false" class="bi-legende">
            {{ $t('admin.bi.liftLegend') }}
          </Message>

          <h3 class="bi-h3">{{ $t('admin.bi.covuesTitle') }}</h3>
          <p class="bi-lead bi-lead--petit">{{ $t('admin.bi.covuesLead') }}</p>
          <DataTable :value="covus" :loading="chargement" striped-rows paginator :rows="10" class="bi-table">
            <template #empty>
              <div class="vi-empty">
                <i class="pi pi-eye" />
                <p>{{ $t('admin.bi.emptyCovues') }}</p>
              </div>
            </template>
            <Column :header="$t('admin.bi.colRule')">
              <template #body="{ data }">
                <span class="bi-regle">
                  <strong>{{ data.objet_a }}</strong>
                  <i class="pi pi-arrow-right" />
                  <strong>{{ data.objet_b }}</strong>
                </span>
              </template>
            </Column>
            <Column field="jours_communs" :header="$t('admin.bi.colDaysTogether')" sortable style="width:9rem" />
            <Column :header="$t('admin.bi.colSupport')" sortable field="support" style="width:8rem">
              <template #body="{ data }">{{ pourcent(data.support) }}</template>
            </Column>
            <Column :header="$t('admin.bi.colLift')" sortable field="lift" style="width:13rem">
              <template #body="{ data }">
                <div class="bi-lift">
                  <div class="bi-lift__barre">
                    <span :style="{ width: largeurLift(data.lift) }"
                          :class="`is-${lireLift(data.lift).cle}`" />
                  </div>
                  <span class="bi-lift__val">{{ Number(data.lift || 0).toFixed(2) }}</span>
                </div>
              </template>
            </Column>
          </DataTable>
        </TabPanel>

        <!-- ========================== FRÉQUENTATION ========================== -->
        <TabPanel value="2">
          <p class="bi-lead">{{ $t('admin.bi.trafficLead') }}</p>

          <DataTable :value="freq" :loading="chargement" striped-rows paginator :rows="15" class="bi-table">
            <template #empty>
              <div class="vi-empty">
                <i class="pi pi-eye" />
                <strong>{{ $t('admin.bi.emptyTrafficTitle') }}</strong>
                <p>{{ $t('admin.bi.emptyTraffic') }}</p>
              </div>
            </template>

            <Column :header="$t('admin.bi.colMonth')" sortable field="mois">
              <template #body="{ data }">{{ fmtMois(data.mois) }}</template>
            </Column>
            <Column field="musee" :header="$t('admin.bi.colMuseum')" sortable />
            <Column field="vues" :header="$t('admin.bi.colViews')" sortable style="width:8rem" />
            <Column field="objets_vus" :header="$t('admin.bi.colDistinct')" sortable style="width:9rem" />
            <Column :header="$t('admin.bi.colShare')" sortable field="part_pourcent" style="width:12rem">
              <template #body="{ data }">
                <div class="bi-part">
                  <div class="bi-part__barre">
                    <span :style="{ width: `${Math.min(Number(data.part_pourcent || 0), 100)}%` }" />
                  </div>
                  <span class="bi-part__val">{{ Number(data.part_pourcent || 0).toFixed(1) }} %</span>
                </div>
              </template>
            </Column>
          </DataTable>
        </TabPanel>

        <!-- ====================== MÉMOIRE RÉUNIFIÉE ========================= -->
        <TabPanel value="3">
          <p class="bi-lead">{{ $t('admin.bi.coverageLead') }}</p>

          <div class="vi-stats">
            <div class="vi-stat">
              <span class="vi-stat__label">{{ $t('admin.bi.covInstitutions') }}</span>
              <strong>{{ couv?.institutions_explorees ?? 0 }}</strong>
            </div>
            <div class="vi-stat">
              <span class="vi-stat__label">{{ $t('admin.bi.covCountries') }}</span>
              <strong>{{ couv?.pays_detenteurs ?? 0 }}</strong>
            </div>
            <div class="vi-stat">
              <span class="vi-stat__label">{{ $t('admin.bi.covObjects') }}</span>
              <strong>{{ couv?.objets_explores ?? 0 }}</strong>
            </div>
            <div class="vi-stat">
              <span class="vi-stat__label">{{ $t('admin.bi.covSources') }}</span>
              <strong>{{ couv?.sources_actives ?? 0 }}</strong>
            </div>
            <div class="vi-stat">
              <span class="vi-stat__label">{{ $t('admin.bi.covValidated') }}</span>
              <strong>{{ couv?.institutions_retenues ?? 0 }}</strong>
            </div>
          </div>

          <Message severity="secondary" :closable="false" class="bi-legende">
            {{ $t('admin.bi.coverageNote') }}
          </Message>

          <template v-if="institutions.length">
            <h3 class="bi-h3">{{ $t('admin.bi.byCountry') }}</h3>
            <div class="bi-pays">
              <div v-for="p in parPays" :key="p.pays" class="bi-pays__ligne">
                <span class="bi-pays__nom">{{ p.pays }}</span>
                <div class="bi-pays__barre">
                  <span :style="{ width: `${(p.objets / maxObjetsPays) * 100}%` }" />
                </div>
                <span class="bi-pays__val">
                  {{ $t('admin.bi.countryDetail', { i: p.institutions, o: p.objets }) }}
                </span>
              </div>
            </div>

            <h3 class="bi-h3">{{ $t('admin.bi.byInstitution') }}</h3>
            <DataTable :value="institutions" striped-rows paginator :rows="15" class="bi-table">
              <Column field="institution" :header="$t('admin.bi.colInstitution')" sortable />
              <Column field="pays" :header="$t('admin.bi.colCountry')" sortable style="width:12rem">
                <template #body="{ data }">{{ data.pays || '—' }}</template>
              </Column>
              <Column field="n" :header="$t('admin.bi.colHeld')" sortable style="width:9rem" />
            </DataTable>
          </template>

          <div v-else class="vi-empty">
            <i class="pi pi-globe" />
            <strong>{{ $t('admin.bi.emptyCoverageTitle') }}</strong>
            <p>{{ $t('admin.bi.emptyCoverage') }}</p>
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>
  </div>
</template>

<style scoped>
.bi-avert { margin: 0 0 1rem; }
.bi-lead { color: var(--vi-muted, #6B7280); margin: 0.9rem 0 1rem; max-width: 68ch; line-height: 1.55; }
.bi-lead--petit { font-size: 0.88rem; margin-top: 0.2rem; }
.bi-h3 { margin: 1.6rem 0 0.2rem; font-size: 1.02rem; }
.bi-note { color: var(--vi-muted, #6B7280); font-size: 0.82rem; margin-top: 0.7rem; }
.bi-legende { margin-top: 0.8rem; }

.bi-filtres { display: flex; align-items: flex-end; gap: 0.9rem; flex-wrap: wrap; margin-bottom: 1rem; }
.bi-filtres label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.78rem; color: var(--vi-muted, #6B7280); }
.bi-slider { min-width: 16rem; }
.bi-slider :deep(.p-slider) { margin-top: 0.6rem; }

.bi-table :deep(.l-soustotal) { background: color-mix(in srgb, var(--p-primary-color, #0e6f5c) 7%, transparent); font-weight: 600; }
.bi-table :deep(.l-total) { background: color-mix(in srgb, var(--p-primary-color, #0e6f5c) 15%, transparent); font-weight: 800; }

.bi-regle { display: inline-flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.bi-regle i { color: var(--vi-muted, #9CA3AF); font-size: 0.78rem; }

.bi-lift, .bi-part { display: flex; align-items: center; gap: 0.55rem; }
.bi-lift__barre, .bi-part__barre {
  flex: 1; height: 7px; border-radius: 999px; overflow: hidden;
  background: var(--p-surface-200, #e5e7eb); min-width: 3.5rem;
}
.bi-lift__barre span, .bi-part__barre span { display: block; height: 100%; border-radius: 999px; }
.bi-lift__barre .is-positif { background: var(--p-green-500, #22c55e); }
.bi-lift__barre .is-neutre  { background: var(--p-surface-400, #9ca3af); }
.bi-lift__barre .is-negatif { background: var(--p-orange-500, #f97316); }
.bi-lift__barre .is-inconnu { background: var(--p-surface-300, #d1d5db); }
.bi-part__barre span { background: var(--p-primary-color, #0e6f5c); }
.bi-lift__val, .bi-part__val { font-variant-numeric: tabular-nums; font-size: 0.85rem; white-space: nowrap; }

/* Répartition par pays détenteur — le propos de « Mémoire Réunifiée ». */
.bi-pays { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.7rem; }
.bi-pays__ligne { display: grid; grid-template-columns: minmax(6rem, 12rem) 1fr auto; align-items: center; gap: 0.8rem; }
@media (max-width: 620px) {
  .bi-pays__ligne { grid-template-columns: 1fr auto; }
  .bi-pays__barre { grid-column: 1 / -1; }
}
.bi-pays__nom { font-size: 0.88rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bi-pays__barre { height: 9px; border-radius: 999px; background: var(--p-surface-200, #e5e7eb); overflow: hidden; }
.bi-pays__barre span { display: block; height: 100%; border-radius: 999px; background: var(--p-primary-color, #0e6f5c); }
.bi-pays__val { font-size: 0.8rem; color: var(--vi-muted, #6B7280); white-space: nowrap; font-variant-numeric: tabular-nums; }
</style>
