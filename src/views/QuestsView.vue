<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { listerQuetes, etapesErp, genererQuete, publierQuete, supprimerQuete } from '@/services/quetes'

// QUÊTES — génération assistée et validation.
//
// L'IA propose, l'humain publie. Une quête générée reste en BROUILLON : un indice qui
// nomme l'œuvre par mégarde ruinerait le jeu, et seul un relecteur peut le voir.
// C'est pourquoi cet écran montre l'indice ET la réponse attendue, côte à côte.

const { t } = useI18n()
const museums = useMuseumStore()
const confirm = useConfirm()
const toast = useToast()

const quetes = ref([])
const etapesOuvertes = ref({})   // questId -> étapes chargées
const museeChoisi = ref(null)
const combien = ref(4)
const busy = ref(false)
const chargement = ref(true)

const museumOptions = computed(() => museums.items.map((m) => ({ label: m.nom, value: m.id })))

async function charger() {
  chargement.value = true
  quetes.value = await listerQuetes()
  chargement.value = false
}

onMounted(async () => {
  if (!museums.items.length) await museums.load()
  if (!museeChoisi.value && museums.items.length) museeChoisi.value = museums.items[0].id
  await charger()
})

async function generer() {
  if (!museeChoisi.value) return
  busy.value = true
  try {
    const r = await genererQuete(museeChoisi.value, combien.value)
    if (!r.ok) {
      const cle = {
        no_api_key: 'questsAdmin.errNoKey',
        pas_assez_oeuvres: 'questsAdmin.errFewWorks',
        aucune_salle: 'questsAdmin.errNoRoom',
        aucune_etape_valide: 'questsAdmin.errNoStep'
      }[r.error] || 'questsAdmin.errGeneric'
      toast.add({ severity: 'warn', summary: t(cle), life: 5000 })
      return
    }
    toast.add({
      severity: 'success',
      summary: t('questsAdmin.generated', { titre: r.titre, n: r.nbEtapes }),
      detail: t('questsAdmin.generatedDraft'), life: 5000
    })
    await charger()
  } finally {
    busy.value = false
  }
}

async function voirEtapes(q) {
  if (etapesOuvertes.value[q.id]) { delete etapesOuvertes.value[q.id]; return }
  etapesOuvertes.value[q.id] = await etapesErp(q.id)
}

async function basculer(q) {
  try {
    await publierQuete(q.id, !q.published)
    await charger()
    toast.add({ severity: 'success', summary: q.published ? t('questsAdmin.unpublished') : t('questsAdmin.published'), life: 2200 })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('questsAdmin.failed'), detail: e.message, life: 3500 })
  }
}

function supprimer(q) {
  confirm.require({
    message: t('questsAdmin.deleteConfirm', { titre: q.titre }),
    header: t('questsAdmin.confirm'), icon: 'pi pi-exclamation-triangle',
    rejectLabel: t('admin.common.cancel'), acceptLabel: t('admin.common.delete'), acceptClass: 'p-button-danger',
    accept: async () => {
      try { await supprimerQuete(q.id); await charger() }
      catch (e) { toast.add({ severity: 'error', summary: t('questsAdmin.failed'), detail: e.message, life: 3500 }) }
    }
  })
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('questsAdmin.title') }}</h1>
        <p class="vi-page__subtitle">{{ $t('questsAdmin.subtitle') }}</p>
      </div>
    </div>

    <!-- Génération -->
    <section class="qa__gen">
      <h2 class="qa__h"><i class="pi pi-sparkles" /> {{ $t('questsAdmin.generateTitle') }}</h2>
      <p class="qa__hint">{{ $t('questsAdmin.generateHint') }}</p>
      <div class="qa__row">
        <Select v-model="museeChoisi" :options="museumOptions" option-label="label" option-value="value"
                :placeholder="$t('questsAdmin.pickMuseum')" filter class="qa__sel" />
        <InputNumber v-model="combien" :min="2" :max="8" show-buttons class="qa__nb" />
        <Button :label="$t('questsAdmin.generate')" icon="pi pi-sparkles"
                :loading="busy" :disabled="!museeChoisi" @click="generer" />
      </div>
    </section>

    <Message severity="info" :closable="false" class="qa__note">{{ $t('questsAdmin.reviewNote') }}</Message>

    <p v-if="chargement" class="vi-muted">{{ $t('common.loading') }}</p>

    <div v-else-if="!quetes.length" class="vi-empty">
      <i class="pi pi-compass" />
      <strong>{{ $t('questsAdmin.emptyTitle') }}</strong>
      <p>{{ $t('questsAdmin.empty') }}</p>
    </div>

    <article v-for="q in quetes" :key="q.id" class="qa__card" :class="{ 'is-draft': !q.published }">
      <div class="qa__b">
        <div class="qa__t">
          <strong>{{ q.titre }}</strong>
          <Tag v-if="q.genereParIa" :value="$t('questsAdmin.aiTag')" severity="info" />
          <Tag :value="q.published ? $t('questsAdmin.live') : $t('questsAdmin.draft')"
               :severity="q.published ? 'success' : 'warn'" />
        </div>
        <span class="qa__meta">
          {{ q.musee }}
          <template v-if="q.badgeNom"> · {{ $t('questsAdmin.badge', { nom: q.badgeNom }) }}</template>
          <template v-if="q.dureeMin"> · {{ $t('questsAdmin.minutes', { n: q.dureeMin }) }}</template>
        </span>
        <p v-if="q.description" class="qa__desc">{{ q.description }}</p>

        <!-- Relecture : indice ET réponse, car c'est là que se voit un indice raté -->
        <div v-if="etapesOuvertes[q.id]" class="qa__steps">
          <div v-for="(e, i) in etapesOuvertes[q.id]" :key="e.id" class="qa__step">
            <span class="qa__step-n">{{ i + 1 }}</span>
            <div>
              <p class="qa__indice">{{ e.indice }}</p>
              <p class="qa__sol">
                <i class="pi pi-eye" /> {{ e.oeuvre }}
                <template v-if="e.question"> — {{ e.question }}
                  <strong v-if="e.reponse"> → {{ e.reponse }}</strong>
                </template>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="row-actions">
        <Button :icon="etapesOuvertes[q.id] ? 'pi pi-eye-slash' : 'pi pi-list'" text rounded
                :aria-label="$t('questsAdmin.steps')" @click="voirEtapes(q)" />
        <Button :icon="q.published ? 'pi pi-times' : 'pi pi-check'" text rounded
                :aria-label="q.published ? $t('questsAdmin.unpublish') : $t('questsAdmin.publish')"
                @click="basculer(q)" />
        <Button icon="pi pi-trash" text rounded severity="danger"
                :aria-label="$t('admin.common.delete')" @click="supprimer(q)" />
      </div>
    </article>
  </div>
</template>

<style scoped>
.qa__gen { background: var(--vi-surface, #fff); border: 1px solid var(--vi-border, #E9EDF2); border-radius: 12px; padding: 1.1rem 1.3rem 1.3rem; margin-bottom: 1.1rem; }
.qa__h { display: flex; align-items: center; gap: 0.5rem; font-size: 0.98rem; margin: 0 0 0.3rem; }
.qa__h i { color: var(--p-primary-color); }
.qa__hint { font-size: 0.85rem; color: var(--vi-muted, #6B7280); margin: 0 0 0.9rem; }
.qa__row { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; }
.qa__sel { min-width: 240px; flex: 1; }
.qa__nb { width: 120px; }
.qa__note { margin-bottom: 1.2rem; }

.qa__card { display: flex; gap: 1rem; align-items: flex-start; background: var(--vi-surface, #fff); border: 1px solid var(--vi-border, #E9EDF2); border-radius: 10px; padding: 1rem 1.2rem; margin-bottom: 0.7rem; }
.qa__card.is-draft { border-left: 3px solid #E8A33D; }
.qa__b { flex: 1; min-width: 0; }
.qa__t { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.qa__t strong { font-size: 1.02rem; color: var(--vi-text, #1B2A4A); }
.qa__meta { display: block; font-size: 0.79rem; color: var(--vi-muted, #6B7280); margin-top: 0.2rem; }
.qa__desc { margin: 0.5rem 0 0; font-size: 0.88rem; line-height: 1.55; color: #4b5563; }

.qa__steps { margin-top: 0.9rem; border-top: 1px solid var(--vi-border, #E9EDF2); padding-top: 0.8rem; }
.qa__step { display: flex; gap: 0.7rem; margin-bottom: 0.7rem; }
.qa__step-n { flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%; background: var(--vi-surface-2, #F1F3F6); color: var(--vi-muted, #6B7280); font-size: 0.75rem; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.qa__indice { margin: 0; font-size: 0.9rem; line-height: 1.5; color: var(--vi-text, #1B2A4A); }
.qa__sol { margin: 0.25rem 0 0; font-size: 0.8rem; color: var(--vi-muted, #6B7280); }
.qa__sol i { color: #2f7d4a; margin-right: 0.2rem; }
.qa__sol strong { color: #2f7d4a; }
</style>
