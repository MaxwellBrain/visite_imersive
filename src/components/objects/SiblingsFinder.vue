<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import ProgressBar from 'primevue/progressbar'
import Message from 'primevue/message'
import { chercherFreres, chercherReferences, repartitionParPays, pointsGlobe, SOURCES_INFO } from '@/services/collectionsApi'
import { enrichirRequete, synthetiser, termesDeRecherche, memoryAiDisponible } from '@/services/memorySearch'
import { couverture } from '@/services/freres'
import DispersionGlobe from './DispersionGlobe.vue'

// « Mémoire réunifiée » — retrouve les objets apparentés dispersés dans les
// collections mondiales. Le conservateur affine les critères puis juge les
// propositions : la note est décomposée pour rester vérifiable.
const props = defineProps({ objet: { type: Object, required: true } })

const { t } = useI18n()
const critere = reactive({
  culture: '',
  pays: '',
  materiau: '',
  periode: ''
})
const candidats = ref([])
const references = ref([])
const cherche = ref(false)
const fait = ref(false)

// --- Enrichissement de la requête (Phase 5) --------------------------------
// Les catalogues du monde indexent en anglais, avec le vocabulaire de
// l'ethnographie. Chercher « masque éléphant » n'y renvoie rien. On fait donc
// traduire ET enrichir la requête côté serveur avant d'interroger quoi que ce soit.
const enrichi = ref(null)
const enrichissement = ref(false)
const enrichiErreur = ref('')

async function enrichir() {
  enrichiErreur.value = ''
  enrichissement.value = true
  try {
    const r = await enrichirRequete({
      requete: [props.objet.nom, props.objet.nomCommun, props.objet.description]
        .filter(Boolean).join('. ').slice(0, 400),
      culture: critere.culture,
      pays: critere.pays,
      materiau: critere.materiau,
      periode: critere.periode
    })
    if (!r.ok) { enrichiErreur.value = r.error; enrichi.value = null; return }
    enrichi.value = r
    // Le conservateur garde la main : les champs vides sont complétés, ceux
    // qu'il a renseignés ne sont jamais écrasés.
    if (!critere.culture && r.culture) critere.culture = r.culture
    if (!critere.pays && r.pays) critere.pays = r.pays
    if (!critere.materiau && r.materiaux?.length) critere.materiau = r.materiaux.join(', ')
    if (!critere.periode && r.periode) critere.periode = r.periode
  } finally {
    enrichissement.value = false
  }
}

const termesEnrichis = computed(() => termesDeRecherche(enrichi.value))

// --- Synthèse sourcée -------------------------------------------------------
const synthese = ref(null)
const syntheseEnCours = ref(false)
const syntheseErreur = ref('')

async function resumer() {
  syntheseErreur.value = ''
  syntheseEnCours.value = true
  try {
    const r = await synthetiser({ objet: props.objet.nom, candidats: candidats.value })
    if (!r.ok) { syntheseErreur.value = r.error; synthese.value = null; return }
    synthese.value = r
  } finally {
    syntheseEnCours.value = false
  }
}
const progres = reactive({ courant: 0, total: 0 })
const erreur = ref('')
const avertissements = ref([])

// Sources interrogées — toutes actives par défaut, désactivables une à une.
const sourcesInfo = SOURCES_INFO
const sourcesActives = ref(SOURCES_INFO.map((s) => s.cle))
const filtreSource = ref(null) // filtre d'affichage des résultats

function basculerSource(cle) {
  const i = sourcesActives.value.indexOf(cle)
  if (i === -1) sourcesActives.value.push(cle)
  else if (sourcesActives.value.length > 1) sourcesActives.value.splice(i, 1)
}

const pourcent = computed(() =>
  progres.total ? Math.round((progres.courant / progres.total) * 100) : 0
)
const dispersion = computed(() => repartitionParPays(candidats.value))
// Données du globe : origine + un marqueur par musée détenteur.
const globe = computed(() => pointsGlobe(candidats.value, critere.pays))
const nbSources = computed(() => new Set(candidats.value.map((c) => c.source)).size)
const nbMusees = computed(() => new Set(candidats.value.map((c) => c.musee).filter(Boolean)).size)

// ---------------------------------------------------------------------------
// Couverture CUMULÉE de l'enquête (toutes recherches, toutes organisations).
//
// Les compteurs ci-dessus ne parlent que de la requête en cours. Celui-ci dit
// sur combien d'institutions porte la Mémoire Réunifiée dans son ensemble —
// c'est l'indicateur qui justifie l'ampleur du travail. Objectif fixé : 40.
const OBJECTIF_INSTITUTIONS = 40
const couvertureGlobale = ref(null)

async function rafraichirCouverture() {
  couvertureGlobale.value = await couverture()
}
onMounted(rafraichirCouverture)

const institutionsCouvertes = computed(
  () => Number(couvertureGlobale.value?.institutions_explorees || 0)
)
const partObjectif = computed(() =>
  Math.min(100, Math.round((institutionsCouvertes.value / OBJECTIF_INSTITUTIONS) * 100))
)
const topInstitutions = computed(() =>
  (couvertureGlobale.value?.par_institution || []).slice(0, 12)
)

const affiches = computed(() =>
  filtreSource.value ? candidats.value.filter((c) => c.source === filtreSource.value) : candidats.value
)
function compteSource(cle) { return candidats.value.filter((c) => c.source === cle).length }

async function lancer() {
  erreur.value = ''
  avertissements.value = []
  cherche.value = true
  fait.value = false
  candidats.value = []
  references.value = []
  synthese.value = null
  filtreSource.value = null
  progres.courant = 0
  progres.total = 0
  try {
    const local = {
      nom: props.objet.nom,
      nomCommun: props.objet.nomCommun,
      culture: critere.culture,
      pays: critere.pays,
      materiau: critere.materiau,
      periode: critere.periode
    }
    // Musées et documentation en parallèle : ce sont deux questions distinctes
    // (« où sont les objets frères » / « qui en a parlé »), autant les poser ensemble.
    const termes = termesEnrichis.value
    const [freres, doc] = await Promise.all([
      chercherFreres(local, {
        limite: 24,
        scoreMin: 25,
        sources: sourcesActives.value,
        termes: termes.length ? termes : null,
        onProgress: (c, tot) => { progres.courant = c; progres.total = tot }
      }),
      chercherReferences(termes.length ? termes : [critere.culture, critere.pays, props.objet.nom])
    ])
    const { candidats: res, erreurs } = freres
    references.value = doc.references
    candidats.value = res
    // Une source indisponible ne doit pas faire échouer toute la recherche.
    avertissements.value = erreurs || []
    fait.value = true
  } catch (e) {
    erreur.value = e.message
  } finally {
    cherche.value = false
  }
}

function severite(score) {
  if (score >= 70) return 'success'
  if (score >= 50) return 'info'
  return 'warn'
}
</script>

<template>
  <section class="sf">
    <header class="sf__head">
      <div>
        <h2 class="sf__title"><i class="pi pi-globe" /> {{ $t('siblings.title') }}</h2>
        <p class="sf__sub">{{ $t('siblings.subtitle') }}</p>
      </div>
    </header>

    <!-- Critères : l'objet local n'ayant pas ces champs, le conservateur les précise. -->
    <div class="sf__form">
      <div class="sf__field">
        <label>{{ $t('siblings.fCulture') }}</label>
        <InputText v-model="critere.culture" :placeholder="$t('siblings.fCulturePlaceholder')" @keyup.enter="lancer" />
      </div>
      <div class="sf__field">
        <label>{{ $t('siblings.fCountry') }}</label>
        <InputText v-model="critere.pays" :placeholder="$t('siblings.fCountryPlaceholder')" @keyup.enter="lancer" />
      </div>
      <div class="sf__field">
        <label>{{ $t('siblings.fMaterial') }}</label>
        <InputText v-model="critere.materiau" :placeholder="$t('siblings.fMaterialPlaceholder')" @keyup.enter="lancer" />
      </div>
      <div class="sf__field sf__field--sm">
        <label>{{ $t('siblings.fPeriod') }}</label>
        <InputText v-model="critere.periode" placeholder="1850" @keyup.enter="lancer" />
      </div>
      <Button
        :label="$t('siblings.search')" icon="pi pi-search"
        :loading="cherche" :disabled="!critere.culture && !critere.pays"
        @click="lancer"
      />
    </div>

    <!-- Traduction et enrichissement (Phase 5) : les catalogues indexent en
         anglais ethnographique, pas en français courant. -->
    <div v-if="memoryAiDisponible" class="sf__ai">
      <div class="sf__ai-head">
        <div>
          <strong><i class="pi pi-sparkles" /> {{ $t('siblings.aiTitle') }}</strong>
          <span>{{ $t('siblings.aiHint') }}</span>
        </div>
        <Button
          :label="$t('siblings.aiRun')"
          icon="pi pi-language"
          size="small"
          outlined
          :loading="enrichissement"
          @click="enrichir"
        />
      </div>

      <div v-if="enrichi" class="sf__ai-out">
        <p class="sf__ai-note" v-if="enrichi.note">{{ enrichi.note }}</p>
        <div class="sf__terms">
          <span class="sf__terms-lbl">{{ $t('siblings.aiTerms') }}</span>
          <span v-for="t in enrichi.termes_en" :key="t" class="sf__term sf__term--main">{{ t }}</span>
          <span v-for="s in enrichi.synonymes" :key="s" class="sf__term">{{ s }}</span>
        </div>
        <p class="sf__ai-warn">
          <i class="pi pi-exclamation-circle" /> {{ $t('siblings.aiReview') }}
        </p>
      </div>
      <p v-else-if="enrichiErreur" class="sf__warn">
        <i class="pi pi-exclamation-circle" />
        {{ enrichiErreur === 'no_api_key' ? $t('siblings.aiNoKey') : $t('siblings.aiFailed') }}
      </p>
    </div>

    <!-- Sources interrogées : le conservateur peut en écarter -->
    <div class="sf__sources">
      <span class="sf__sources-lbl">{{ $t('siblings.sourcesLabel') }}</span>
      <button
        v-for="s in sourcesInfo" :key="s.cle"
        class="sf__srcchip" :class="{ on: sourcesActives.includes(s.cle) }"
        type="button" @click="basculerSource(s.cle)"
      >
        <i :class="sourcesActives.includes(s.cle) ? 'pi pi-check' : 'pi pi-times'" /> {{ s.label }}
      </button>
    </div>

    <p class="sf__hint"><i class="pi pi-info-circle" /> {{ $t('siblings.hint') }}</p>

    <div v-if="cherche" class="sf__progress">
      <ProgressBar :value="pourcent" />
      <span>{{ $t('siblings.analyzingSources', { n: progres.courant, total: progres.total }) }}</span>
    </div>

    <p v-if="erreur" class="sf__error"><i class="pi pi-exclamation-triangle" /> {{ erreur }}</p>
    <p v-for="a in avertissements" :key="a.source" class="sf__warn">
      <i class="pi pi-exclamation-circle" /> {{ $t('siblings.sourceFailed', { source: a.source, message: a.message }) }}
    </p>

    <!-- Synthèse de la dispersion -->
    <div v-if="fait && candidats.length" class="sf__summary">
      <div class="sf__stat">
        <strong>{{ candidats.length }}</strong>
        <span>{{ $t('siblings.statFound') }}</span>
      </div>
      <div class="sf__stat">
        <strong>{{ dispersion.length }}</strong>
        <span>{{ $t('siblings.statCountries') }}</span>
      </div>
      <div class="sf__stat">
        <strong>{{ nbMusees }}</strong>
        <span>{{ $t('siblings.statMuseums') }}</span>
      </div>
      <div class="sf__stat">
        <strong>{{ nbSources }}</strong>
        <span>{{ $t('siblings.statSources') }}</span>
      </div>
    </div>

    <!-- Ampleur cumulée : ce que la Mémoire Réunifiée a balayé en tout.
         Distinct des compteurs ci-dessus, qui ne parlent que de cette recherche. -->
    <div v-if="institutionsCouvertes" class="sf__couverture">
      <div class="sf__couverture-tete">
        <span class="sf__couverture-titre">{{ $t('siblings.coverageTitle') }}</span>
        <strong class="sf__couverture-chiffre">
          {{ institutionsCouvertes }}<span> / {{ OBJECTIF_INSTITUTIONS }}</span>
        </strong>
      </div>
      <div class="sf__jauge" role="progressbar"
           :aria-valuenow="institutionsCouvertes" aria-valuemin="0" :aria-valuemax="OBJECTIF_INSTITUTIONS">
        <div class="sf__jauge-remplie" :style="{ width: partObjectif + '%' }" />
      </div>
      <p class="sf__couverture-detail">
        {{ $t('siblings.coverageDetail', {
          objets: couvertureGlobale?.objets_explores || 0,
          pays: couvertureGlobale?.pays_detenteurs || 0,
          sources: couvertureGlobale?.sources_actives || 0
        }) }}
      </p>
      <div v-if="topInstitutions.length" class="sf__institutions">
        <span v-for="i in topInstitutions" :key="i.institution" class="sf__institution"
              :title="`${i.institution} — ${i.n}`">
          {{ i.institution }}<em>{{ i.n }}</em>
        </span>
      </div>
    </div>

    <!-- Globe : le trajet des objets hors de leur terre natale -->
    <div v-if="fait && globe.lieux.length" class="sf__globe">
      <DispersionGlobe :origine="globe.origine" :lieux="globe.lieux" :taille="380" />
    </div>

    <!-- Carte textuelle de la dispersion : où se trouve le patrimoine -->
    <div v-if="fait && dispersion.length" class="sf__disp">
      <h3 class="sf__disp-title">{{ $t('siblings.dispersionTitle') }}</h3>
      <ul class="sf__disp-list">
        <li v-for="d in dispersion" :key="d.pays">
          <span class="sf__disp-pays"><i class="pi pi-map-marker" /> {{ d.pays }}</span>
          <span class="sf__disp-bar">
            <span :style="{ width: Math.round((d.total / candidats.length) * 100) + '%' }" />
          </span>
          <span class="sf__disp-n">{{ d.total }}</span>
          <span class="sf__disp-musees">{{ d.musees.slice(0, 2).join(' · ') }}</span>
        </li>
      </ul>
    </div>

    <!-- Synthèse sourcée : chaque affirmation cite son musée et son inventaire -->
    <div v-if="fait && candidats.length" class="sf__synth">
      <div class="sf__synth-head">
        <h3><i class="pi pi-file-edit" /> {{ $t('siblings.synthTitle') }}</h3>
        <Button
          :label="synthese ? $t('siblings.synthRedo') : $t('siblings.synthRun')"
          icon="pi pi-sparkles"
          size="small"
          outlined
          :loading="syntheseEnCours"
          @click="resumer"
        />
      </div>

      <template v-if="synthese">
        <Message
          :severity="synthese.confiance === 'forte' ? 'success' : synthese.confiance === 'faible' ? 'warn' : 'info'"
          :closable="false"
        >
          {{ $t('siblings.synthConfidence', { n: $t(`siblings.conf_${synthese.confiance}`) }) }}
        </Message>
        <p class="sf__synth-resume">{{ synthese.resume }}</p>
        <ul v-if="synthese.points.length" class="sf__synth-points">
          <li v-for="(p, i) in synthese.points" :key="i">{{ p }}</li>
        </ul>
        <div v-if="synthese.reserves.length" class="sf__synth-res">
          <strong>{{ $t('siblings.synthReserves') }}</strong>
          <ul><li v-for="(r, i) in synthese.reserves" :key="i">{{ r }}</li></ul>
        </div>
        <p class="sf__ai-warn"><i class="pi pi-exclamation-circle" /> {{ $t('siblings.synthReview') }}</p>
      </template>
      <p v-else-if="syntheseErreur" class="sf__warn">
        <i class="pi pi-exclamation-circle" />
        {{ syntheseErreur === 'no_api_key' ? $t('siblings.aiNoKey') : $t('siblings.synthFailed') }}
      </p>
      <p v-else class="sf__hint">{{ $t('siblings.synthIntro') }}</p>
    </div>

    <!-- Traces documentaires : ce ne sont pas des objets, mais des références -->
    <div v-if="fait && references.length" class="sf__refs">
      <h3 class="sf__disp-title"><i class="pi pi-book" /> {{ $t('siblings.refsTitle') }}</h3>
      <p class="sf__hint">{{ $t('siblings.refsHint') }}</p>
      <ul class="sf__refs-list">
        <li v-for="(r, i) in references" :key="`${r.source}-${i}`">
          <a :href="r.url" target="_blank" rel="noopener noreferrer">
            <span class="sf__ref-type" :class="`sf__ref-type--${r.type}`">
              <i :class="r.type === 'ouvrage' ? 'pi pi-book' : 'pi pi-file'" />
            </span>
            <span class="sf__ref-b">
              <strong>{{ r.titre }}</strong>
              <small v-if="r.auteur || r.annee">{{ [r.auteur, r.annee].filter(Boolean).join(' · ') }}</small>
              <small v-if="r.extrait" class="sf__ref-ex">{{ r.extrait }}</small>
              <em>{{ r.sourceLabel }}</em>
            </span>
            <i class="pi pi-external-link" />
          </a>
        </li>
      </ul>
    </div>

    <!-- Filtre d'affichage par source -->
    <div v-if="fait && candidats.length" class="sf__filters">
      <button class="sf__fchip" :class="{ on: !filtreSource }" type="button" @click="filtreSource = null">
        {{ $t('siblings.allSources') }} ({{ candidats.length }})
      </button>
      <button
        v-for="s in sourcesInfo.filter((x) => compteSource(x.cle))" :key="s.cle"
        class="sf__fchip" :class="{ on: filtreSource === s.cle }"
        type="button" @click="filtreSource = s.cle"
      >
        {{ s.label }} ({{ compteSource(s.cle) }})
      </button>
    </div>

    <p v-if="fait && !candidats.length" class="sf__empty">{{ $t('siblings.none') }}</p>

    <!-- Propositions -->
    <ul v-if="affiches.length" class="sf__list">
      <li v-for="c in affiches" :key="c.source + c.externalId" class="sfc">
        <div class="sfc__img">
          <img v-if="c.image" :src="c.image" :alt="c.title" loading="lazy" />
          <div v-else class="sfc__ph"><i class="pi pi-image" /></div>
        </div>
        <div class="sfc__body">
          <div class="sfc__top">
            <strong class="sfc__title">{{ c.title }}</strong>
            <Tag :value="`${c.score}%`" :severity="severite(c.score)" />
          </div>
          <p class="sfc__meta">
            <span v-if="c.culture"><i class="pi pi-users" /> {{ c.culture }}</span>
            <span v-if="c.origine && c.origine !== c.culture"><i class="pi pi-map-marker" /> {{ c.origine }}</span>
            <span v-if="c.date"><i class="pi pi-calendar" /> {{ c.date }}</span>
            <span v-if="c.inventaire" class="sfc__inv"><i class="pi pi-hashtag" /> {{ c.inventaire }}</span>
          </p>
          <p v-if="c.musee" class="sfc__musee">
            <i class="pi pi-building" /> {{ c.musee }}<template v-if="c.paysMusee"> — {{ c.paysMusee }}</template>
          </p>
          <p v-if="c.medium" class="sfc__medium">{{ c.medium }}</p>
          <!-- Décomposition de la note : le conservateur voit POURQUOI c'est proposé -->
          <div class="sfc__why">
            <span v-for="r in c.raisons" :key="r.cle" class="sfc__chip">
              {{ $t('siblings.reason_' + r.cle) }} +{{ r.poids }}
            </span>
          </div>
          <div class="sfc__foot">
            <span class="sfc__src">{{ c.sourceLabel }}</span>
            <a :href="c.url" target="_blank" rel="noopener" class="sfc__link">
              {{ $t('siblings.openSource') }} <i class="pi pi-external-link" />
            </a>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
/* ---------- enrichissement de la requête ---------- */
.sf__ai {
  border: 1px solid var(--p-content-border-color); border-radius: 10px;
  padding: 0.9rem 1.05rem; margin: 0.9rem 0;
  background: color-mix(in srgb, var(--gold, #cda24e) 6%, transparent);
}
.sf__ai-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.sf__ai-head strong { display: block; font-size: 0.92rem; }
.sf__ai-head strong i { color: var(--gold, #cda24e); margin-right: 0.3rem; }
.sf__ai-head span { display: block; font-size: 0.8rem; color: var(--vi-muted); margin-top: 0.15rem; max-width: 60ch; line-height: 1.5; }
.sf__ai-out { margin-top: 0.9rem; }
.sf__ai-note { margin: 0 0 0.6rem; font-size: 0.84rem; color: var(--vi-muted); line-height: 1.6; }
.sf__terms { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
.sf__terms-lbl { font-size: 0.76rem; color: var(--vi-muted); margin-right: 0.2rem; }
.sf__term {
  font-size: 0.76rem; padding: 0.22rem 0.55rem; border-radius: 999px;
  background: var(--vi-surface-2, #f1f2f4); border: 1px solid var(--p-content-border-color);
}
.sf__term--main { background: var(--gold, #cda24e); border-color: transparent; color: #14140f; font-weight: 700; }
.sf__ai-warn { margin: 0.7rem 0 0; font-size: 0.78rem; color: #b4541a; display: flex; align-items: center; gap: 0.35rem; }

/* ---------- synthèse ---------- */
.sf__synth { border: 1px solid var(--p-content-border-color); border-radius: 10px; padding: 1rem 1.15rem; margin: 1.2rem 0; }
.sf__synth-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.8rem; }
.sf__synth-head h3 { margin: 0; font-size: 1rem; }
.sf__synth-head h3 i { color: var(--gold, #cda24e); margin-right: 0.35rem; }
.sf__synth-resume { margin: 0.8rem 0 0; line-height: 1.7; }
.sf__synth-points { margin: 0.7rem 0 0; padding-left: 1.1rem; line-height: 1.65; font-size: 0.9rem; }
.sf__synth-points li { margin-bottom: 0.35rem; }
.sf__synth-res { margin-top: 0.9rem; font-size: 0.86rem; color: var(--vi-muted); }
.sf__synth-res ul { margin: 0.3rem 0 0; padding-left: 1.1rem; }

/* ---------- références documentaires ---------- */
.sf__refs { margin: 1.2rem 0; }
.sf__refs-list { list-style: none; margin: 0.7rem 0 0; padding: 0; display: grid; gap: 0.45rem; }
.sf__refs-list a {
  display: flex; align-items: flex-start; gap: 0.7rem; padding: 0.65rem 0.8rem;
  border: 1px solid var(--p-content-border-color); border-radius: 9px;
  text-decoration: none; color: inherit; transition: 0.15s;
}
.sf__refs-list a:hover { border-color: var(--gold, #cda24e); background: var(--vi-surface-2, #f8f9fa); }
.sf__ref-type {
  width: 30px; height: 30px; flex: 0 0 30px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  background: var(--vi-surface-2, #f1f2f4); color: var(--vi-muted); font-size: 0.85rem;
}
.sf__ref-type--ouvrage { background: color-mix(in srgb, var(--gold, #cda24e) 18%, transparent); color: #8a6d12; }
.sf__ref-b { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.sf__ref-b strong { font-size: 0.9rem; }
.sf__ref-b small { font-size: 0.78rem; color: var(--vi-muted); }
.sf__ref-ex { line-height: 1.5; }
.sf__ref-b em { font-size: 0.72rem; color: var(--vi-muted); font-style: normal; opacity: 0.8; }
.sf__refs-list a > i { color: var(--vi-muted); margin-top: 0.2rem; }

.sf { background: var(--vi-surface); border: 1px solid var(--vi-border); border-radius: 16px; padding: 1.25rem 1.35rem 1.5rem; }
.sf__head { margin-bottom: 1rem; }
.sf__title { margin: 0; font-size: 1.05rem; display: flex; align-items: center; gap: 0.5rem; }
.sf__title i { color: var(--p-primary-color); }
.sf__sub { margin: 0.3rem 0 0; color: var(--vi-muted); font-size: 0.88rem; }

.sf__form { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end; }
.sf__field { display: flex; flex-direction: column; gap: 0.3rem; flex: 1 1 170px; }
.sf__field--sm { flex: 0 1 110px; }
.sf__field label { font-size: 0.76rem; font-weight: 600; color: var(--vi-muted); }

.sf__hint { margin: 0.8rem 0 0; font-size: 0.8rem; color: var(--vi-muted); display: flex; gap: 0.4rem; align-items: flex-start; }
.sf__progress { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.4rem; }
.sf__progress span { font-size: 0.8rem; color: var(--vi-muted); }
.sf__error { color: #c0392b; font-size: 0.88rem; margin-top: 0.8rem; }
.sf__warn { color: #b06f18; font-size: 0.82rem; margin: 0.4rem 0 0; display: flex; gap: 0.4rem; align-items: flex-start; }

/* Sources interrogées */
.sf__sources { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; margin-top: 0.9rem; }
.sf__sources-lbl { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vi-muted); margin-right: 0.2rem; }
.sf__srcchip {
  display: inline-flex; align-items: center; gap: 0.35rem; cursor: pointer;
  border: 1px solid var(--vi-border); background: var(--vi-surface); color: var(--vi-muted);
  border-radius: 999px; padding: 0.3rem 0.7rem; font-size: 0.76rem; font-family: inherit; transition: 0.15s;
}
.sf__srcchip.on { border-color: #0e6f5c; color: #0e6f5c; background: color-mix(in srgb, #0e6f5c 8%, transparent); font-weight: 600; }
.sf__srcchip i { font-size: 0.7rem; }

/* Carte textuelle de dispersion */
.sf__globe { display: flex; justify-content: center; margin: 1.4rem 0 0.4rem; padding: 1rem; background: #061a16; border-radius: 14px; }
.sf__disp { margin: 1rem 0 0.4rem; }
.sf__disp-title { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.09em; color: var(--vi-muted); margin: 0 0 0.6rem; }
.sf__disp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.sf__disp-list li { display: grid; grid-template-columns: 10rem 1fr 2rem auto; align-items: center; gap: 0.7rem; font-size: 0.83rem; }
.sf__disp-pays { display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600; }
.sf__disp-bar { height: 8px; background: var(--vi-bg); border-radius: 999px; overflow: hidden; }
.sf__disp-bar > span { display: block; height: 100%; background: #0e6f5c; border-radius: 999px; }
.sf__disp-n { text-align: right; font-weight: 700; }
.sf__disp-musees { color: var(--vi-muted); font-size: 0.76rem; }

/* Filtres d'affichage */
.sf__filters { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 1rem 0 0.2rem; }
.sf__fchip {
  cursor: pointer; border: 1px solid var(--vi-border); background: var(--vi-surface);
  color: var(--vi-muted); border-radius: 6px; padding: 0.35rem 0.75rem;
  font-size: 0.76rem; font-family: inherit; transition: 0.15s;
}
.sf__fchip.on { background: #0e6f5c; border-color: #0e6f5c; color: #fff; font-weight: 600; }

.sfc__musee { margin: 0.2rem 0 0; font-size: 0.8rem; color: var(--vi-muted); display: flex; align-items: center; gap: 0.35rem; }
.sfc__inv { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.76rem; }

@media (max-width: 720px) {
  .sf__disp-list li { grid-template-columns: 1fr auto; }
  .sf__disp-bar, .sf__disp-musees { display: none; }
}
.sf__empty { margin-top: 1rem; color: var(--vi-muted); }

.sf__summary { display: flex; gap: 1rem; margin: 1.2rem 0 0.6rem; flex-wrap: wrap; }
.sf__stat { background: var(--vi-bg); border-radius: 12px; padding: 0.7rem 1.1rem; min-width: 110px; }
.sf__stat strong { display: block; font-size: 1.5rem; line-height: 1.1; }
.sf__stat span { font-size: 0.76rem; color: var(--vi-muted); }

/* Couverture cumulée — volontairement distincte des compteurs de recherche :
   un encadré, pas une tuile, pour qu'on ne confonde pas les deux échelles. */
.sf__couverture {
  margin: 0.9rem 0 0.4rem; padding: 0.9rem 1.1rem;
  border: 1px solid var(--p-content-border-color, #e5e7eb); border-radius: 12px;
}
.sf__couverture-tete { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
.sf__couverture-titre { font-size: 0.78rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--vi-muted); }
.sf__couverture-chiffre { font-size: 1.35rem; line-height: 1; }
.sf__couverture-chiffre span { font-size: 0.9rem; font-weight: 400; color: var(--vi-muted); }

.sf__jauge { height: 6px; border-radius: 999px; background: var(--vi-bg, #f1f2f0); margin: 0.55rem 0 0.5rem; overflow: hidden; }
.sf__jauge-remplie { height: 100%; background: var(--p-primary-color, #0e6f5c); border-radius: 999px; transition: width 0.4s ease; }

.sf__couverture-detail { margin: 0; font-size: 0.8rem; color: var(--vi-muted); }
.sf__institutions { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.7rem; }
.sf__institution {
  font-size: 0.74rem; padding: 0.2rem 0.5rem; border-radius: 999px;
  background: var(--vi-bg, #f1f2f0); color: inherit;
  max-width: 15rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sf__institution em { font-style: normal; color: var(--vi-muted); margin-left: 0.35rem; }

.sf__list { list-style: none; margin: 1rem 0 0; padding: 0; display: grid; gap: 0.85rem; }
.sfc { display: flex; gap: 0.95rem; background: var(--vi-bg); border: 1px solid var(--vi-border); border-radius: 12px; padding: 0.85rem; }
.sfc__img { width: 92px; height: 92px; border-radius: 8px; overflow: hidden; background: var(--vi-surface-2); flex: 0 0 92px; }
.sfc__img img { width: 100%; height: 100%; object-fit: cover; }
.sfc__ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--vi-muted); font-size: 1.5rem; }
.sfc__body { flex: 1; min-width: 0; }
.sfc__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.7rem; }
.sfc__title { font-size: 0.98rem; }
.sfc__meta { margin: 0.35rem 0 0; display: flex; flex-wrap: wrap; gap: 0.9rem; font-size: 0.8rem; color: var(--vi-muted); }
.sfc__meta i { margin-right: 0.25rem; }
.sfc__medium { margin: 0.3rem 0 0; font-size: 0.78rem; color: var(--vi-muted); font-style: italic; }
.sfc__why { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.5rem; }
.sfc__chip { font-size: 0.68rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 999px; background: color-mix(in srgb, var(--p-primary-color) 12%, transparent); color: var(--p-primary-color); }
.sfc__foot { display: flex; align-items: center; justify-content: space-between; gap: 0.7rem; margin-top: 0.6rem; }
.sfc__src { font-size: 0.72rem; color: var(--vi-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.sfc__link { font-size: 0.8rem; font-weight: 600; color: var(--p-primary-color); }
</style>
