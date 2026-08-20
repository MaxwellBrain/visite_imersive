<script setup>
import { computed, reactive, ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import { useToast } from 'primevue/usetoast'
import { useSectorStore } from '@/stores/useSectorStore'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { SECTOR_LOCATIONS } from '@/constants/options'
import { useTts } from '@/services/tts'

const props = defineProps({
  visible: { type: Boolean, default: false },
  sector: { type: Object, default: null }
})
const emit = defineEmits(['update:visible', 'saved'])

const { t } = useI18n()
const store = useSectorStore()
const museumStore = useMuseumStore()
const toast = useToast()
const submitted = ref(false)

const museumOptions = computed(() =>
  museumStore.items.map((m) => ({ label: m.nom, value: m.id }))
)

// Voix propre au secteur (mêmes réglages que l'assistant du musée)
const { cloudEnabled: ttsCloud, speaking: ttsSpeaking, speak: ttsSpeak, stop: ttsStop, listVoices } = useTts()
const cloudVoices = ref([])
const timbreOptions = computed(() => [
  { label: t('admin.voice.timbreStandard'), value: 'standard' },
  { label: t('admin.voice.timbreRobot'), value: 'robot' },
  { label: t('admin.voice.timbreGrave'), value: 'grave' },
  { label: t('admin.voice.timbreDouce'), value: 'douce' }
])
const tonOptions = computed(() => [
  { label: t('admin.voice.tonNeutre'), value: 'neutre' },
  { label: t('admin.voice.tonChaleureux'), value: 'chaleureux' },
  { label: t('admin.voice.tonSolennel'), value: 'solennel' }
])
onMounted(async () => { if (ttsCloud && !cloudVoices.value.length) cloudVoices.value = await listVoices() })

const form = reactive({
  nom: '',
  museumId: null,
  etage: null,
  emplacement: 'Intérieur',
  description: '',
  histoire: '',
  voiceId: null,
  ton: 'neutre',
  timbreVoix: 'standard',
  debit: 1
})

function reset() {
  form.nom = props.sector?.nom ?? ''
  form.museumId = props.sector?.museumId ?? null
  form.etage = props.sector?.etage ?? null
  form.emplacement = props.sector?.emplacement ?? 'Intérieur'
  form.description = props.sector?.description ?? ''
  form.histoire = props.sector?.histoire ?? ''
  form.voiceId = props.sector?.voiceId ?? null
  form.ton = props.sector?.ton ?? 'neutre'
  form.timbreVoix = props.sector?.timbreVoix ?? 'standard'
  form.debit = props.sector?.debit ?? 1
  submitted.value = false
}

function previewVoice() {
  if (ttsSpeaking.value) { ttsStop(); return }
  const demo = `Bienvenue dans la salle ${form.nom || ''}. ${form.histoire || form.description || 'Laissez-moi vous raconter son histoire.'}`
  ttsSpeak(demo, { lang: 'fr', rate: form.debit, timbre: form.timbreVoix, voiceId: form.voiceId || undefined })
}

watch(
  () => props.visible,
  (open) => {
    if (open) reset()
  }
)

const valid = computed(() => form.nom.trim() && form.museumId != null)

function close() {
  emit('update:visible', false)
}

async function save() {
  submitted.value = true
  if (!valid.value) return

  try {
    if (props.sector) {
      await store.update(props.sector.id, { ...form })
      toast.add({ severity: 'success', summary: t('admin.sectors.updated'), life: 2500 })
    } else {
      await store.add({ ...form })
      toast.add({ severity: 'success', summary: t('admin.sectors.created'), detail: form.nom, life: 2500 })
    }
    emit('saved')
    close()
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.museums.saveFailed'), detail: e.message, life: 3500 })
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="sector ? $t('admin.sectors.formEditTitle') : $t('admin.sectors.formCreateTitle')"
    :style="{ width: '40rem', maxWidth: '95vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="vi-field">
      <label class="vi-req" for="s-musee">{{ $t('admin.sectors.fMuseum') }}</label>
      <Select
        id="s-musee"
        v-model="form.museumId"
        :options="museumOptions"
        option-label="label"
        option-value="value"
        :placeholder="$t('admin.sectors.fMuseumPlaceholder')"
        filter
        :invalid="submitted && form.museumId == null"
      />
      <small v-if="submitted && form.museumId == null" style="color: var(--p-red-500)">
        {{ $t('admin.sectors.fMuseumRequired2') }}
      </small>
    </div>

    <div class="vi-field">
      <label class="vi-req" for="s-nom">{{ $t('admin.sectors.fName') }}</label>
      <InputText
        id="s-nom"
        v-model="form.nom"
        :placeholder="$t('admin.sectors.fNamePlaceholder')"
        :invalid="submitted && !form.nom.trim()"
      />
    </div>

    <div class="vi-row">
      <div class="vi-field">
        <label for="s-emplacement">{{ $t('admin.sectors.fLocation') }}</label>
        <Select id="s-emplacement" v-model="form.emplacement" :options="SECTOR_LOCATIONS" />
        <small>{{ $t('admin.sectors.fLocationHint') }}</small>
      </div>
      <div class="vi-field" style="flex: 0 1 130px">
        <label for="s-etage">{{ $t('admin.sectors.fFloor') }}</label>
        <InputNumber id="s-etage" v-model="form.etage" :min="-5" :max="200" placeholder="0" />
      </div>
    </div>

    <div class="vi-field">
      <label for="s-desc">{{ $t('admin.sectors.fDescription') }}</label>
      <Textarea
        id="s-desc"
        v-model="form.description"
        rows="3"
        auto-resize
        :placeholder="$t('admin.sectors.fDescPlaceholder')"
      />
    </div>

    <!-- ============ Assistant vocal propre au secteur ============ -->
    <fieldset class="s-voice">
      <legend><i class="pi pi-microphone" /> {{ $t('admin.sectors.voiceTitle') }}</legend>

      <div class="vi-field">
        <label for="s-histoire">{{ $t('admin.sectors.fHistoire') }}</label>
        <Textarea
          id="s-histoire"
          v-model="form.histoire"
          rows="4"
          auto-resize
          :placeholder="$t('admin.sectors.fHistoirePlaceholder')"
        />
        <small>{{ $t('admin.sectors.fHistoireHint') }}</small>
      </div>

      <div v-if="ttsCloud" class="vi-field">
        <label>{{ $t('admin.voice.fVoice') }}</label>
        <Select
          v-model="form.voiceId"
          :options="cloudVoices"
          option-label="name"
          option-value="id"
          :placeholder="$t('admin.sectors.fVoiceInherit')"
          show-clear
          filter
        >
          <template #option="{ option }">
            <div>
              <strong>{{ option.name }}</strong>
              <div class="voice-hint">{{ option.hint }}</div>
            </div>
          </template>
        </Select>
        <small>{{ $t('admin.sectors.fVoiceHint') }}</small>
      </div>

      <div class="vi-row">
        <div class="vi-field">
          <label>{{ $t('admin.voice.fTimbre') }}</label>
          <Select v-model="form.timbreVoix" :options="timbreOptions" option-label="label" option-value="value" />
        </div>
        <div class="vi-field" style="flex:0 1 130px">
          <label>{{ $t('admin.voice.fDebit') }}</label>
          <InputNumber v-model="form.debit" :min="0.5" :max="2" :step="0.1" :min-fraction-digits="1" :max-fraction-digits="1" show-buttons />
        </div>
        <div class="vi-field">
          <label>{{ $t('admin.voice.fTon') }}</label>
          <Select v-model="form.ton" :options="tonOptions" option-label="label" option-value="value" />
        </div>
      </div>

      <Button
        :label="ttsSpeaking ? $t('admin.voice.ttsStop') : $t('admin.voice.ttsPlay')"
        :icon="ttsSpeaking ? 'pi pi-stop' : 'pi pi-volume-up'"
        severity="secondary"
        outlined
        size="small"
        @click="previewVoice"
      />
    </fieldset>

    <template #footer>
      <Button :label="$t('admin.common.cancel')" severity="secondary" text @click="close" />
      <Button :label="$t('admin.common.save')" icon="pi pi-check" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.s-voice { border: 1px solid var(--p-content-border-color); border-radius: 10px; padding: 0.9rem 1.1rem 1.1rem; margin-top: 1.2rem; }
.s-voice legend { padding: 0 0.5rem; font-weight: 700; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 0.4rem; }
.s-voice legend i { color: var(--gold, #cda24e); }
.voice-hint { font-size: 0.75rem; opacity: 0.7; }
</style>
