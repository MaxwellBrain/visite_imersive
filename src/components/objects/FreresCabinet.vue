<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import Textarea from 'primevue/textarea'
import ProgressBar from 'primevue/progressbar'
import { useToast } from 'primevue/usetoast'
import { chercherEtJuger, listerFreres, decider } from '@/services/freres'

// LE CABINET — côté conservateur. C'est l'étape D de la chaîne : la machine a
// proposé, l'humain tranche.
//
// POURQUOI CETTE ÉTAPE EST NON NÉGOCIABLE
//
// Aucun musée n'affichera des rapprochements scientifiques non relus. Un
// rapprochement faux publié sous le nom de l'institution, c'est sa crédibilité
// qui part — pas celle de l'algorithme. Le public ne voit donc QUE ce qui porte
// le statut « validé » (la RLS l'impose en base, pas seulement l'affichage).
//
// Et les rejets ne sont pas perdus : ils forment la vérité terrain qui
// permettra un jour d'évaluer, puis d'améliorer, le reclassement.

const props = defineProps({ objet: { type: Object, required: true } })

const { t } = useI18n()
const toast = useToast()

const lignes = ref([])
const chargement = ref(true)
const recherche = ref(false)
const etapeEnCours = ref('')
const detail = ref({})
const bilan = ref(null)
const erreur = ref('')
const enEdition = ref(null)
const brouillon = ref('')

onMounted(charger)

async function charger() {
  chargement.value = true
  lignes.value = await listerFreres(props.objet.id)
  chargement.value = false
}

const parStatut = computed(() => ({
  propose: lignes.value.filter((l) => l.statut === 'propose'),
  valide: lignes.value.filter((l) => l.statut === 'valide'),
  rejete: lignes.value.filter((l) => l.statut === 'rejete')
}))

const onglet = ref('propose')
const visibles = computed(() => parStatut.value[onglet.value] || [])

async function lancer() {
  recherche.value = true
  erreur.value = ''
  bilan.value = null
  try {
    const r = await chercherEtJuger(props.objet, {}, (cle, d) => {
      etapeEnCours.value = cle
      detail.value = d || {}
    })
    if (!r.ok) {
      erreur.value = t(`cabinet.erreur.${r.error}`, t('cabinet.erreur.generique'))
      return
    }
    bilan.value = r
    await charger()
    onglet.value = 'propose'
  } finally {
    recherche.value = false
    etapeEnCours.value = ''
  }
}

async function trancher(l, statut) {
  const r = await decider(l.id, statut)
  if (!r.ok) {
    toast.add({ severity: 'error', summary: t('cabinet.echecDecision'), detail: r.error, life: 4000 })
    return
  }
  l.statut = statut
  toast.add({
    severity: statut === 'valide' ? 'success' : 'info',
    summary: statut === 'valide' ? t('cabinet.valide') : t('cabinet.rejete'),
    life: 1600
  })
}

function editer(l) {
  enEdition.value = l.id
  brouillon.value = l.justification || ''
}

async function enregistrerJustification(l) {
  const r = await decider(l.id, l.statut, brouillon.value)
  if (!r.ok) {
    toast.add({ severity: 'error', summary: t('cabinet.echecDecision'), detail: r.error, life: 4000 })
    return
  }
  l.justification = brouillon.value
  enEdition.value = null
  toast.add({ severity: 'success', summary: t('cabinet.justificationEnregistree'), life: 1600 })
}

const libelleEtape = computed(() => {
  const c = etapeEnCours.value
  if (!c) return ''
  const d = detail.value
  if (c === 'rappel' && d.total) return t('cabinet.etape.rappelN', { faites: d.faites, total: d.total })
  if (c === 'cache' && d.n) return t('cabinet.etape.cacheN', { n: d.n })
  if (c === 'plongement' && d.aFaire) return t('cabinet.etape.plongementN', { faits: d.faits || 0, total: d.aFaire })
  return t(`cabinet.etape.${c}`)
})
</script>

<template>
  <section class="cab">
    <header class="cab__head">
      <div>
        <h2 class="cab__titre"><i class="pi pi-sparkles" /> {{ $t('cabinet.titre') }}</h2>
        <p class="cab__sous">{{ $t('cabinet.sousTitre') }}</p>
      </div>
      <Button
        :label="$t('cabinet.lancer')" icon="pi pi-search" :loading="recherche"
        :disabled="recherche" @click="lancer"
      />
    </header>

    <div v-if="recherche" class="cab__progres">
      <ProgressBar mode="indeterminate" style="height: 5px" />
      <p>{{ libelleEtape }}</p>
    </div>

    <Message v-if="erreur" severity="error" :closable="false">{{ erreur }}</Message>

    <!-- Le bilan dit ce que la recherche a VRAIMENT coûté et produit. Sans lui,
         le conservateur ne peut pas juger si la chaîne a bien tourné. -->
    <Message v-if="bilan" severity="success" :closable="true" class="cab__bilan">
      {{ $t('cabinet.bilan', {
        propositions: bilan.propositions, bruts: bilan.candidatsBruts, ecartes: bilan.ecartes
      }) }}
      <span v-if="bilan.plongesPayes === 0"> {{ $t('cabinet.bilanCacheTotal') }}</span>
      <span v-else> {{ $t('cabinet.bilanCache', { n: bilan.plongesPayes }) }}</span>
      <strong v-if="!bilan.jugee"> {{ $t('cabinet.bilanSansJugement') }}</strong>
    </Message>

    <div class="cab__tabs">
      <button v-for="s in ['propose', 'valide', 'rejete']" :key="s"
              :class="{ on: onglet === s }" @click="onglet = s">
        {{ $t('cabinet.onglet.' + s) }}
        <span v-if="parStatut[s].length" class="cab__n">{{ parStatut[s].length }}</span>
      </button>
    </div>

    <p v-if="chargement" class="vi-muted">{{ $t('common.loading') }}</p>

    <div v-else-if="!visibles.length" class="vi-empty">
      <i class="pi pi-inbox" />
      <p>{{ $t('cabinet.vide.' + onglet) }}</p>
    </div>

    <ul v-else class="cab__liste">
      <li v-for="l in visibles" :key="l.id" class="cab__item">
        <img v-if="l.image_url" :src="l.image_url" :alt="l.titre" class="cab__img" loading="lazy" />
        <div v-else class="cab__img cab__img--ph"><i class="pi pi-image" /></div>

        <div class="cab__corps">
          <div class="cab__ligne1">
            <strong>{{ l.titre || $t('cabinet.sansTitre') }}</strong>
            <Tag v-if="l.type_lien" :value="$t('cabinet.lien.' + l.type_lien)" severity="info" />
            <span class="cab__score">{{ l.score }}%</span>
          </div>
          <p class="cab__meta">
            {{ [l.culture, l.pays, l.date_objet, l.materiau].filter(Boolean).join(' · ') }}
          </p>

          <!-- La justification est le contenu éditorial affiché au public :
               le conservateur doit pouvoir la corriger, pas seulement l'accepter. -->
          <template v-if="enEdition === l.id">
            <Textarea v-model="brouillon" rows="2" autoResize class="cab__ta" />
            <div class="cab__edition">
              <Button :label="$t('cabinet.save')" icon="pi pi-check" size="small" @click="enregistrerJustification(l)" />
              <Button :label="$t('cabinet.cancel')" size="small" text @click="enEdition = null" />
            </div>
          </template>
          <p v-else class="cab__just" :class="{ vide: !l.justification }" @click="editer(l)">
            <template v-if="l.justification">« {{ l.justification }} »</template>
            <template v-else>{{ $t('cabinet.sansJustification') }}</template>
            <i class="pi pi-pencil" />
          </p>

          <div class="cab__actions">
            <a v-if="l.source_url" :href="l.source_url" target="_blank" rel="noopener" class="cab__lien">
              <i class="pi pi-external-link" /> {{ l.source }}
            </a>
            <span class="cab__sep" />
            <Button v-if="l.statut !== 'valide'" :label="$t('cabinet.valider')" icon="pi pi-check"
                    size="small" text @click="trancher(l, 'valide')" />
            <Button v-if="l.statut !== 'rejete'" :label="$t('cabinet.rejeter')" icon="pi pi-times"
                    size="small" text severity="danger" @click="trancher(l, 'rejete')" />
            <Button v-if="l.statut !== 'propose'" :label="$t('cabinet.remettre')" icon="pi pi-undo"
                    size="small" text severity="secondary" @click="trancher(l, 'propose')" />
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cab { background: var(--vi-surface, #fff); border: 1px solid var(--vi-border, #E9EDF2);
  border-radius: 16px; padding: 1.25rem 1.4rem 1.4rem; }
.cab__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.cab__titre { display: flex; align-items: center; gap: 0.5rem; font-size: 1.1rem; margin: 0 0 0.2rem; }
.cab__titre i { color: var(--p-primary-color); }
.cab__sous { margin: 0; font-size: 0.84rem; color: var(--vi-muted, #6B7280); max-width: 62ch; line-height: 1.5; }

.cab__progres { margin-bottom: 1rem; }
.cab__progres p { margin: 0.5rem 0 0; font-size: 0.82rem; color: var(--vi-muted, #6B7280); }
.cab__bilan { margin-bottom: 1rem; }

.cab__tabs { display: flex; gap: 0.4rem; margin: 1rem 0; }
.cab__tabs button { background: var(--vi-bg, #F6F8FB); border: 1px solid var(--vi-border, #E9EDF2);
  border-radius: 999px; padding: 0.45rem 1rem; font-family: inherit; font-size: 0.84rem;
  font-weight: 700; color: var(--vi-muted, #6B7280); cursor: pointer;
  display: inline-flex; align-items: center; gap: 0.4rem; }
.cab__tabs button.on { background: var(--p-primary-color); border-color: var(--p-primary-color); color: #fff; }
.cab__n { background: rgba(0,0,0,0.12); border-radius: 999px; padding: 0 0.4rem; font-size: 0.74rem; }

.cab__liste { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.7rem; }
.cab__item { display: flex; gap: 0.9rem; background: var(--vi-bg, #F6F8FB);
  border: 1px solid var(--vi-border, #E9EDF2); border-radius: 12px; padding: 0.8rem; }
.cab__img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; flex: 0 0 auto; background: #E9EDF2; }
.cab__img--ph { display: flex; align-items: center; justify-content: center; color: var(--vi-muted, #6B7280); font-size: 1.4rem; }
.cab__corps { flex: 1; min-width: 0; }
.cab__ligne1 { display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; }
.cab__ligne1 strong { font-size: 0.95rem; }
.cab__score { margin-left: auto; font-size: 0.8rem; font-weight: 800; color: var(--p-primary-color); }
.cab__meta { margin: 0.2rem 0 0.4rem; font-size: 0.79rem; color: var(--vi-muted, #6B7280); }
.cab__just { margin: 0 0 0.5rem; font-size: 0.86rem; font-style: italic; color: var(--vi-text, #1B2A4A);
  cursor: pointer; display: flex; gap: 0.45rem; align-items: baseline; }
.cab__just i { font-size: 0.7rem; opacity: 0.4; }
.cab__just:hover i { opacity: 0.9; }
.cab__just.vide { font-style: normal; color: var(--vi-muted, #6B7280); }
.cab__ta { width: 100%; font-size: 0.86rem; margin-bottom: 0.4rem; }
.cab__edition { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; }
.cab__actions { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }
.cab__lien { font-size: 0.78rem; color: var(--vi-muted, #6B7280); text-decoration: none;
  display: inline-flex; align-items: center; gap: 0.3rem; }
.cab__lien:hover { color: var(--p-primary-color); }
.cab__sep { flex: 1; }
</style>
