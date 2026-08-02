<script setup>
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import MultiSelect from 'primevue/multiselect'
import ToggleSwitch from 'primevue/toggleswitch'
import Message from 'primevue/message'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import { useToast } from 'primevue/usetoast'
import { useVoiceStore } from '@/stores/useVoiceStore'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { useTts } from '@/services/tts'
import { CURRENCIES } from '@/constants/options'

const props = defineProps({ visible: { type: Boolean, default: false }, assistant: { type: Object, default: null } })
const emit = defineEmits(['update:visible', 'saved'])

const { t } = useI18n()
const store = useVoiceStore()
const museumStore = useMuseumStore()
const toast = useToast()
const submitted = ref(false)
const activeTab = ref('0')
const { supported: ttsOk, speaking: ttsSpeaking, speak: ttsSpeak, stop: ttsStop, cloudAvailable: ttsCloud, listVoices } = useTts()
const cloudVoices = ref([])
const providerOptions = computed(() => [
  { label: t('admin.voice.provBrowser'), value: 'browser' },
  { label: t('admin.voice.provElevenlabs'), value: 'elevenlabs' }
])

const museumOptions = computed(() => museumStore.items.map((m) => ({ label: m.nom, value: m.id })))
const langueOptions = [
  { label: 'Français', value: 'fr' },
  { label: 'English', value: 'en' },
  { label: 'Ewondo', value: 'ewo' },
  { label: 'Fufuldé', value: 'fub' },
  { label: 'Ghomala', value: 'bbj' }
]
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
const sourceOptions = computed(() => [
  { label: t('admin.voice.srcText'), value: 'texte' },
  { label: t('admin.voice.srcAudio'), value: 'audio' }
])
const traitementOptions = computed(() => [
  { label: t('admin.voice.traitTelQuel'), value: 'tel_quel' },
  { label: t('admin.voice.traitInspiration'), value: 'inspiration' }
])
const modeOptions = computed(() => [
  { label: t('admin.voice.modeNarration'), value: 'narration' },
  { label: t('admin.voice.modeDialogue'), value: 'narration_dialogue' }
])

const form = reactive({
  museumId: null, titre: '', langues: ['fr', 'en'], published: false, actif: false,
  sourceType: 'texte', scriptTexte: '', provider: 'elevenlabs', timbreVoix: 'standard', debit: 1, ton: 'neutre', voiceId: null,
  audioSourceUrl: '', audioTraitement: 'tel_quel',
  personnalisationNominative: true, modeleSalutation: 'Bonjour {prenom}, bienvenue au {musee}.',
  modeInteraction: 'narration', prix: null, devise: 'FCFA'
})

function reset() {
  const a = props.assistant
  Object.assign(form, {
    museumId: a?.museumId ?? null,
    titre: a?.titre ?? '',
    langues: a?.langues ?? ['fr', 'en'],
    published: a?.published ?? false,
    actif: a?.actif ?? false,
    sourceType: a?.sourceType ?? 'texte',
    scriptTexte: a?.scriptTexte ?? '',
    provider: a?.provider ?? 'elevenlabs',
    timbreVoix: a?.timbreVoix ?? 'standard',
    voiceId: a?.voiceId ?? null,
    debit: a?.debit ?? 1,
    ton: a?.ton ?? 'neutre',
    audioSourceUrl: a?.audioSourceUrl ?? '',
    audioTraitement: a?.audioTraitement ?? 'tel_quel',
    personnalisationNominative: a?.personnalisationNominative ?? true,
    modeleSalutation: a?.modeleSalutation ?? 'Bonjour {prenom}, bienvenue au {musee}.',
    modeInteraction: a?.modeInteraction ?? 'narration',
    prix: a?.prix ?? null,
    devise: a?.devise ?? 'FCFA'
  })
  submitted.value = false
  activeTab.value = '0'
}
watch(() => props.visible, async (o) => {
  if (!o) { ttsStop(); return }
  reset()
  if (ttsCloud && !cloudVoices.value.length) cloudVoices.value = await listVoices()
})
onBeforeUnmount(ttsStop)

const valid = computed(() => form.museumId != null && form.titre.trim())
function close() { emit('update:visible', false) }

// Aperçu audio du script avec le moteur, le débit et le timbre choisis.
function previewVoice() {
  if (ttsSpeaking.value) { ttsStop(); return }
  const demo = form.scriptTexte.trim() || t('admin.voice.ttsDemo')
  ttsSpeak(demo, { provider: form.provider, lang: form.langues?.[0] || 'fr', rate: form.debit, timbre: form.timbreVoix, voiceId: form.voiceId || undefined })
}

async function save() {
  submitted.value = true
  if (!valid.value) { activeTab.value = '0'; return }
  try {
    if (props.assistant) await store.updateAssistant(props.assistant.id, { ...form })
    else await store.addAssistant({ ...form })
    toast.add({ severity: 'success', summary: props.assistant ? t('admin.voice.updated') : t('admin.voice.created'), life: 2000 })
    emit('saved')
    close()
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.voice.failed'), detail: e.message, life: 3000 })
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="assistant ? $t('admin.voice.guideEdit') : $t('admin.voice.guideNew')"
    :style="{ width: '46rem', maxWidth: '96vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <Tabs v-model:value="activeTab">
      <TabList>
        <Tab value="0"><i class="pi pi-id-card" /> {{ $t('admin.voice.tabIdentity') }}</Tab>
        <Tab value="1"><i class="pi pi-microphone" /> {{ $t('admin.voice.tabSource') }}</Tab>
        <Tab value="2"><i class="pi pi-user" /> {{ $t('admin.voice.tabPerso') }}</Tab>
        <Tab value="3"><i class="pi pi-comments" /> {{ $t('admin.voice.tabBehavior') }}</Tab>
        <Tab value="4"><i class="pi pi-tag" /> {{ $t('admin.voice.tabPricing') }}</Tab>
      </TabList>

      <TabPanels>
        <!-- IDENTITÉ & ASSIGNATION -->
        <TabPanel value="0">
          <div class="vi-row">
            <div class="vi-field">
              <label>{{ $t('admin.voice.fMuseum') }}</label>
              <Select v-model="form.museumId" :options="museumOptions" option-label="label" option-value="value" filter
                :placeholder="$t('admin.voice.fMuseumPlaceholder')" :invalid="submitted && form.museumId == null" />
            </div>
            <div class="vi-field">
              <label>{{ $t('admin.voice.fName') }}</label>
              <InputText v-model="form.titre" :placeholder="$t('admin.voice.fNamePlaceholder')" :invalid="submitted && !form.titre.trim()" />
            </div>
          </div>
          <div class="vi-field">
            <label>{{ $t('admin.voice.fLangues') }}</label>
            <MultiSelect v-model="form.langues" :options="langueOptions" option-label="label" option-value="value" display="chip" />
          </div>
          <Message severity="secondary" :closable="false"><strong>{{ $t('admin.voice.kbTitle') }}.</strong> {{ $t('admin.voice.kbHint') }}</Message>
          <div class="switch-row" style="margin-top:0.9rem">
            <ToggleSwitch v-model="form.published" input-id="g-pub" />
            <label for="g-pub"><strong>{{ $t('admin.voice.fPublished') }}</strong><span>{{ $t('admin.voice.fStatusHint') }}</span></label>
          </div>
          <div class="switch-row">
            <ToggleSwitch v-model="form.actif" input-id="g-act" />
            <label for="g-act"><strong>{{ $t('admin.common.active') }}</strong></label>
          </div>
        </TabPanel>

        <!-- SOURCE & VOIX -->
        <TabPanel value="1">
          <div class="vi-field">
            <label>{{ $t('admin.voice.srcMode') }}</label>
            <SelectButton v-model="form.sourceType" :options="sourceOptions" option-label="label" option-value="value" :allow-empty="false" />
          </div>

          <template v-if="form.sourceType === 'texte'">
            <div class="vi-field">
              <label>{{ $t('admin.voice.fScript') }}</label>
              <Textarea v-model="form.scriptTexte" rows="5" auto-resize :placeholder="$t('admin.voice.fScriptPlaceholder')" />
              <small>{{ $t('admin.voice.fScriptHint') }}</small>
            </div>
            <div class="vi-field">
              <label>{{ $t('admin.voice.fEngine') }}</label>
              <SelectButton v-model="form.provider" :options="providerOptions" option-label="label" option-value="value" :allow-empty="false" />
              <small>{{ $t('admin.voice.fEngineHint') }}</small>
            </div>
            <div v-if="ttsCloud && form.provider === 'elevenlabs'" class="vi-field">
              <label>{{ $t('admin.voice.fVoice') }}</label>
              <Select
                v-model="form.voiceId"
                :options="cloudVoices"
                option-label="name"
                option-value="id"
                :placeholder="$t('admin.voice.fVoiceDefault')"
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
              <small>{{ $t('admin.voice.fVoiceHint') }}</small>
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
            <div class="tts-preview">
              <Button
                :label="ttsSpeaking ? $t('admin.voice.ttsStop') : $t('admin.voice.ttsPlay')"
                :icon="ttsSpeaking ? 'pi pi-stop' : 'pi pi-volume-up'"
                severity="secondary"
                outlined
                :disabled="!ttsOk"
                @click="previewVoice"
              />
              <small v-if="!ttsOk" class="tts-warn">{{ $t('admin.voice.ttsUnsupported') }}</small>
              <small v-else class="tts-hint">{{ $t('admin.voice.ttsHint') }}</small>
            </div>
          </template>

          <template v-else>
            <div class="vi-field">
              <label>{{ $t('admin.voice.fAudioUrl') }}</label>
              <InputText v-model="form.audioSourceUrl" :placeholder="$t('admin.voice.fAudioUrlPlaceholder')" />
            </div>
            <div class="vi-field">
              <label>{{ $t('admin.voice.fAudioTraitement') }}</label>
              <Select v-model="form.audioTraitement" :options="traitementOptions" option-label="label" option-value="value" />
            </div>
          </template>
        </TabPanel>

        <!-- PERSONNALISATION -->
        <TabPanel value="2">
          <div class="switch-row">
            <ToggleSwitch v-model="form.personnalisationNominative" input-id="g-nom" />
            <label for="g-nom"><strong>{{ $t('admin.voice.fNominative') }}</strong><span>{{ $t('admin.voice.fNominativeHint') }}</span></label>
          </div>
          <div class="vi-field" style="margin-top:0.9rem">
            <label>{{ $t('admin.voice.fSalutation') }}</label>
            <InputText v-model="form.modeleSalutation" :disabled="!form.personnalisationNominative" />
            <small>{{ $t('admin.voice.fSalutationHint') }}</small>
          </div>
        </TabPanel>

        <!-- COMPORTEMENT -->
        <TabPanel value="3">
          <div class="vi-field">
            <label>{{ $t('admin.voice.fMode') }}</label>
            <SelectButton v-model="form.modeInteraction" :options="modeOptions" option-label="label" option-value="value" :allow-empty="false" />
          </div>
          <Message severity="secondary" :closable="false">{{ $t('admin.voice.modeHint') }}</Message>
        </TabPanel>

        <!-- TARIF & ACCÈS -->
        <TabPanel value="4">
          <div class="vi-row">
            <div class="vi-field">
              <label>{{ $t('admin.voice.fPrice') }}</label>
              <InputNumber v-model="form.prix" :min="0" :max="1000000" show-clear />
            </div>
            <div class="vi-field" style="flex:0 1 120px">
              <label>{{ $t('admin.voice.fCurrency') }}</label>
              <Select v-model="form.devise" :options="CURRENCIES" />
            </div>
          </div>
          <Message :severity="form.prix == null ? 'warn' : 'info'" :closable="false">
            <template v-if="form.prix == null">{{ $t('admin.voice.priceHintNone') }}</template>
            <template v-else>{{ $t('admin.voice.priceHintSet', { price: form.prix, currency: form.devise }) }}</template>
          </Message>
        </TabPanel>
      </TabPanels>
    </Tabs>

    <template #footer>
      <Button :label="$t('admin.common.cancel')" severity="secondary" text @click="close" />
      <Button :label="$t('admin.common.save')" icon="pi pi-check" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.switch-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0;
}
.switch-row label {
  display: flex;
  flex-direction: column;
}
.switch-row label span {
  font-size: 0.78rem;
  color: var(--vi-muted);
}
.tts-preview {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}
.tts-preview .tts-hint { color: var(--vi-muted); font-size: 0.78rem; }
.tts-preview .tts-warn { color: var(--p-red-500, #ef4444); font-size: 0.78rem; }
.voice-hint { font-size: 0.75rem; color: var(--vi-muted); }
</style>
