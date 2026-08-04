<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import { supabase } from '@/services/supabase'
import { scopeToTenant } from '@/services/tenant'
import { themesFrequents } from '@/services/lacunes'

// CE QUE LES VISITEURS DEMANDENT — et surtout ce à quoi on n'a pas su répondre.
//
// L'intérêt de cet écran n'est pas la curiosité : chaque question restée SANS RÉPONSE
// désigne une lacune précise dans une notice. C'est un retour de terrain que le
// conservateur n'obtient autrement jamais — personne ne vient lui dire « votre cartel
// ne dit pas en quoi c'est fait ».

const { t } = useI18n()
const lignes = ref([])
const chargement = ref(true)
const onglet = ref('lacunes')   // lacunes | toutes

onMounted(charger)

async function charger() {
  chargement.value = true
  const { data, error } = await scopeToTenant(
    supabase.from('guide_questions').select('*, objects(nom), sectors(nom), museums(nom)')
  ).order('created_at', { ascending: false }).limit(300)
  if (error) console.error('[questions]', error.message)
  lignes.value = (data || []).map((q) => ({
    id: q.id, question: q.question, repondu: q.repondu, jour: q.jour,
    objet: q.objects?.nom || '', salle: q.sectors?.nom || '', musee: q.museums?.nom || ''
  }))
  chargement.value = false
}

const sansReponse = computed(() => lignes.value.filter((l) => !l.repondu))
const visibles = computed(() => (onglet.value === 'lacunes' ? sansReponse.value : lignes.value))

// Regroupement par œuvre : c'est l'unité d'action du conservateur. Voir « 6 questions
// sans réponse sur le Trône perlé » est actionnable ; une liste à plat ne l'est pas.
//
// Et pour chaque œuvre, on va plus loin que le comptage : on dit CE QU'IL MANQUE.
// « 4 personnes ont demandé en quoi c'est fait » se corrige en une minute ;
// « 6 questions sans réponse » laisse le conservateur devant une page blanche.
const parObjet = computed(() => {
  const m = new Map()
  for (const l of sansReponse.value) {
    const cle = l.objet || l.salle || l.musee || t('guideQuestions.noContext')
    if (!m.has(cle)) m.set(cle, [])
    m.get(cle).push(l)
  }
  return [...m.entries()]
    .map(([cle, qs]) => ({ cle, qs, themes: themesFrequents(qs) }))
    .sort((a, b) => b.qs.length - a.qs.length)
})

async function oublier(l) {
  await supabase.from('guide_questions').delete().eq('id', l.id)
  lignes.value = lignes.value.filter((x) => x.id !== l.id)
}

function fmt(d) {
  return d ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(d)) : ''
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('guideQuestions.title') }}</h1>
        <p class="vi-page__subtitle">{{ $t('guideQuestions.subtitle') }}</p>
      </div>
      <Button icon="pi pi-refresh" :label="$t('guideQuestions.refresh')" severity="secondary" outlined @click="charger" />
    </div>

    <Message severity="info" :closable="false" class="gq__note">{{ $t('guideQuestions.privacy') }}</Message>

    <div class="gq__tabs">
      <button :class="{ on: onglet === 'lacunes' }" @click="onglet = 'lacunes'">
        {{ $t('guideQuestions.tabGaps') }}
        <span v-if="sansReponse.length" class="gq__badge">{{ sansReponse.length }}</span>
      </button>
      <button :class="{ on: onglet === 'toutes' }" @click="onglet = 'toutes'">
        {{ $t('guideQuestions.tabAll', { n: lignes.length }) }}
      </button>
    </div>

    <p v-if="chargement" class="vi-muted">{{ $t('common.loading') }}</p>

    <template v-else-if="onglet === 'lacunes'">
      <div v-if="!sansReponse.length" class="vi-empty">
        <i class="pi pi-check-circle" />
        <strong>{{ $t('guideQuestions.noGapTitle') }}</strong>
        <p>{{ $t('guideQuestions.noGap') }}</p>
      </div>

      <!-- Groupé par œuvre : c'est l'unité d'action du conservateur -->
      <section v-for="g in parObjet" :key="g.cle" class="gq__grp">
        <h2 class="gq__h">
          <i class="pi pi-box" /> {{ g.cle }}
          <Tag :value="$t('guideQuestions.gapsN', { n: g.qs.length })" severity="warn" />
        </h2>

        <!-- LE CONSEIL, pas la statistique : ce que le conservateur doit écrire. -->
        <div v-if="g.themes.length" class="gq__conseils">
          <p class="gq__conseils-h">{{ $t('guideQuestions.adviceTitle') }}</p>
          <div v-for="th in g.themes" :key="th.cle" class="gq__conseil" :class="{ on: th.recurrent }">
            <i class="pi pi-arrow-right" />
            <span class="gq__conseil-txt">{{ $t('guideQuestions.advice.' + th.cle) }}</span>
            <span class="gq__conseil-n">{{ $t('guideQuestions.askedN', { n: th.n }) }}</span>
          </div>
        </div>
        <p v-else class="gq__todo">{{ $t('guideQuestions.todo') }}</p>

        <div v-for="q in g.qs" :key="q.id" class="gq__q">
          <span class="gq__txt">« {{ q.question }} »</span>
          <span class="gq__date">{{ fmt(q.jour) }}</span>
          <Button icon="pi pi-times" text rounded :aria-label="$t('guideQuestions.dismiss')" @click="oublier(q)" />
        </div>
      </section>
    </template>

    <template v-else>
      <div v-if="!lignes.length" class="vi-empty">
        <i class="pi pi-comments" />
        <strong>{{ $t('guideQuestions.emptyTitle') }}</strong>
        <p>{{ $t('guideQuestions.empty') }}</p>
      </div>
      <div v-for="q in visibles" :key="q.id" class="gq__q gq__q--flat">
        <Tag :value="q.repondu ? $t('guideQuestions.answered') : $t('guideQuestions.unanswered')"
             :severity="q.repondu ? 'success' : 'warn'" />
        <span class="gq__txt">« {{ q.question }} »</span>
        <span class="gq__ctx">{{ q.objet || q.salle || q.musee }}</span>
        <span class="gq__date">{{ fmt(q.jour) }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.gq__note { margin-bottom: 1rem; }
.gq__tabs { display: flex; gap: 0.4rem; margin-bottom: 1.1rem; }
.gq__tabs button {
  background: var(--vi-surface, #fff); border: 1px solid var(--vi-border, #E9EDF2);
  border-radius: 999px; padding: 0.5rem 1.05rem; font-family: inherit; font-size: 0.87rem;
  font-weight: 700; color: var(--vi-muted, #6B7280); cursor: pointer;
  display: inline-flex; align-items: center; gap: 0.45rem;
}
.gq__tabs button.on { background: var(--p-primary-color); border-color: var(--p-primary-color); color: #fff; }
.gq__badge { background: #E8A33D; color: #fff; border-radius: 999px; padding: 0 0.4rem; font-size: 0.72rem; }

.gq__grp { background: var(--vi-surface, #fff); border: 1px solid var(--vi-border, #E9EDF2); border-left: 3px solid #E8A33D; border-radius: 10px; padding: 1rem 1.2rem; margin-bottom: 0.8rem; }
.gq__h { display: flex; align-items: center; gap: 0.55rem; font-size: 1rem; margin: 0 0 0.3rem; color: var(--vi-text, #1B2A4A); }
.gq__h i { color: var(--p-primary-color); }
.gq__todo { margin: 0 0 0.7rem; font-size: 0.82rem; color: var(--vi-muted, #6B7280); }

.gq__conseils { background: #FBF6EA; border-radius: 8px; padding: 0.7rem 0.85rem; margin: 0 0 0.85rem; }
.gq__conseils-h { margin: 0 0 0.5rem; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.05em;
  text-transform: uppercase; color: #8A6A20; }
.gq__conseil { display: flex; align-items: center; gap: 0.5rem; padding: 0.22rem 0; font-size: 0.87rem; color: #5C4A1E; }
.gq__conseil i { font-size: 0.7rem; opacity: 0.55; }
.gq__conseil.on .gq__conseil-txt { font-weight: 700; }
.gq__conseil-txt { flex: 1; min-width: 0; }
.gq__conseil-n { font-size: 0.74rem; font-weight: 700; color: #8A6A20; white-space: nowrap;
  background: #F2E4C4; border-radius: 999px; padding: 0.08rem 0.5rem; }
.gq__q { display: flex; align-items: center; gap: 0.7rem; padding: 0.4rem 0; }
.gq__q--flat { background: var(--vi-surface, #fff); border: 1px solid var(--vi-border, #E9EDF2); border-radius: 8px; padding: 0.6rem 0.9rem; margin-bottom: 0.45rem; }
.gq__txt { flex: 1; min-width: 0; font-size: 0.9rem; color: var(--vi-text, #1B2A4A); font-style: italic; }
.gq__ctx { font-size: 0.78rem; color: var(--vi-muted, #6B7280); }
.gq__date { font-size: 0.76rem; color: var(--vi-muted, #6B7280); white-space: nowrap; }
</style>
