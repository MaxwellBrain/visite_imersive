<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import Message from 'primevue/message'
import { useToast } from 'primevue/usetoast'
import { useCampaignStore } from '@/stores/useCampaignStore'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { useAuthStore } from '@/stores/useAuthStore'

const props = defineProps({
  visible: { type: Boolean, default: false },
  campaign: { type: Object, default: null }
})
const emit = defineEmits(['update:visible', 'saved'])

const { t, locale } = useI18n()
const store = useCampaignStore()
const museums = useMuseumStore()
const auth = useAuthStore()
const toast = useToast()
const submitted = ref(false)
const composing = ref(false)

const typeOptions = computed(() => [
  { label: t('admin.campaigns.typeAnnonce'), value: 'annonce' },
  { label: t('admin.campaigns.typeExposition'), value: 'exposition' },
  { label: t('admin.campaigns.typeMessage'), value: 'message' }
])
const cibleOptions = computed(() => [
  { label: t('admin.campaigns.cibleAll'), value: 'tous' },
  { label: t('admin.campaigns.cibleMuseum'), value: 'musee' }
])
const museumOptions = computed(() => museums.items.map((m) => ({ label: m.nom, value: m.id })))

const form = reactive({
  type: 'annonce', sujet: '', contenu: '', image: '', lien: '', lienTexte: '',
  cible: 'tous', museumId: null, genereParIa: false
})
// Sujet court donné à l'IA — n'est pas enregistré, sert seulement à rédiger.
const brief = ref('')

function reset() {
  const c = props.campaign
  form.type = c?.type ?? 'annonce'
  form.sujet = c?.sujet ?? ''
  form.contenu = c?.contenu ?? ''
  form.image = c?.image ?? ''
  form.lien = c?.lien ?? ''
  form.lienTexte = c?.lienTexte ?? ''
  form.cible = c?.cible ?? 'tous'
  form.museumId = c?.museumId ?? null
  form.genereParIa = c?.genereParIa ?? false
  brief.value = ''
  submitted.value = false
}
watch(() => props.visible, (open) => { if (open) { reset(); if (!museums.items.length) museums.load() } })

const valid = computed(() => form.sujet.trim() && form.contenu.trim() &&
  (form.cible !== 'musee' || form.museumId != null))

// Rédaction assistée : l'IA propose objet + corps à partir d'un brief d'une ligne.
async function composeWithAi() {
  const b = brief.value.trim()
  if (!b || composing.value) return
  composing.value = true
  try {
    const r = await store.compose({
      sujet: b,
      type: form.type,
      organisation: auth.tenant?.nom || '',
      contexte: form.contenu.trim(), // le texte déjà saisi sert de matière vérifiée
      langue: locale.value
    })
    if (r?.ok) {
      form.sujet = r.sujet || form.sujet
      form.contenu = r.contenu
      form.genereParIa = true
      toast.add({ severity: 'success', summary: t('admin.campaigns.aiDone'), life: 2000 })
    } else {
      toast.add({
        severity: 'warn',
        summary: t('admin.campaigns.aiFailed'),
        detail: r?.error === 'no_api_key' ? t('admin.campaigns.aiNoKey') : (r?.error || ''),
        life: 4000
      })
    }
  } finally {
    composing.value = false
  }
}

function close() { emit('update:visible', false) }

async function save() {
  submitted.value = true
  if (!valid.value) return
  try {
    if (props.campaign) await store.update(props.campaign.id, { ...form })
    else await store.add({ ...form })
    toast.add({ severity: 'success', summary: t('admin.campaigns.saved'), life: 2200 })
    emit('saved')
    close()
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.campaigns.failed'), detail: e.message, life: 3500 })
  }
}
</script>

<template>
  <Dialog :visible="visible" modal
          :header="campaign ? $t('admin.campaigns.editTitle') : $t('admin.campaigns.newTitle')"
          :style="{ width: '46rem', maxWidth: '95vw' }"
          @update:visible="$emit('update:visible', $event)">
    <div class="vi-row">
      <div class="vi-field">
        <label>{{ $t('admin.campaigns.fType') }}</label>
        <Select v-model="form.type" :options="typeOptions" option-label="label" option-value="value" />
      </div>
      <div class="vi-field">
        <label>{{ $t('admin.campaigns.fTarget') }}</label>
        <Select v-model="form.cible" :options="cibleOptions" option-label="label" option-value="value" />
      </div>
      <div v-if="form.cible === 'musee'" class="vi-field">
        <label class="vi-req">{{ $t('admin.campaigns.fMuseum') }}</label>
        <Select v-model="form.museumId" :options="museumOptions" option-label="label" option-value="value"
                filter :invalid="submitted && form.museumId == null" />
      </div>
    </div>

    <!-- Rédaction assistée par IA -->
    <fieldset class="c-ai">
      <legend><i class="pi pi-sparkles" /> {{ $t('admin.campaigns.aiTitle') }}</legend>
      <p class="c-ai__hint">{{ $t('admin.campaigns.aiHint') }}</p>
      <div class="c-ai__row">
        <InputText v-model="brief" :placeholder="$t('admin.campaigns.aiPlaceholder')"
                   @keydown.enter.prevent="composeWithAi" />
        <Button :label="$t('admin.campaigns.aiWrite')" icon="pi pi-sparkles"
                :loading="composing" :disabled="!brief.trim()" @click="composeWithAi" />
      </div>
    </fieldset>

    <div class="vi-field">
      <label class="vi-req">{{ $t('admin.campaigns.fSubject') }}</label>
      <InputText v-model="form.sujet" :placeholder="$t('admin.campaigns.fSubjectPlaceholder')"
                 :invalid="submitted && !form.sujet.trim()" />
    </div>

    <div class="vi-field">
      <label class="vi-req">{{ $t('admin.campaigns.fBody') }}</label>
      <Textarea v-model="form.contenu" rows="8" auto-resize
                :placeholder="$t('admin.campaigns.fBodyPlaceholder')"
                :invalid="submitted && !form.contenu.trim()" />
      <small>{{ $t('admin.campaigns.fBodyHint') }}</small>
    </div>

    <div class="vi-row">
      <div class="vi-field">
        <label>{{ $t('admin.campaigns.fLink') }}</label>
        <InputText v-model="form.lien" placeholder="https://…" />
      </div>
      <div class="vi-field">
        <label>{{ $t('admin.campaigns.fLinkText') }}</label>
        <InputText v-model="form.lienTexte" :placeholder="$t('admin.campaigns.fLinkTextPlaceholder')" />
      </div>
    </div>

    <div class="vi-field">
      <label>{{ $t('admin.campaigns.fImage') }}</label>
      <InputText v-model="form.image" placeholder="https://…" />
    </div>

    <Message v-if="form.genereParIa" severity="info" :closable="false" class="c-ai__flag">
      {{ $t('admin.campaigns.aiReview') }}
    </Message>

    <template #footer>
      <Button :label="$t('admin.common.cancel')" severity="secondary" text @click="close" />
      <Button :label="$t('admin.common.save')" icon="pi pi-check" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.c-ai { border: 1px solid var(--p-content-border-color); border-radius: 10px; padding: 0.6rem 1rem 1rem; margin: 0.4rem 0 1.1rem; }
.c-ai legend { padding: 0 0.5rem; font-weight: 700; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 0.4rem; }
.c-ai legend i { color: var(--p-primary-color); }
.c-ai__hint { margin: 0 0 0.6rem; font-size: 0.82rem; color: var(--vi-muted, #6B7280); }
.c-ai__row { display: flex; gap: 0.5rem; }
.c-ai__row :deep(input) { flex: 1; }
.c-ai__flag { margin-top: 0.4rem; }
</style>
