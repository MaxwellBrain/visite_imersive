<script setup>
import { reactive, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import DatePicker from 'primevue/datepicker'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { useToast } from 'primevue/usetoast'
import { useEventStore } from '@/stores/useEventStore'
import { useMuseumStore } from '@/stores/useMuseumStore'
import ImageUploader from '@/components/common/ImageUploader.vue'

const { t } = useI18n()
const props = defineProps({ visible: { type: Boolean, default: false }, event: { type: Object, default: null } })
const emit = defineEmits(['update:visible', 'saved'])

const store = useEventStore()
const museumStore = useMuseumStore()
const toast = useToast()
const submitted = ref(false)

const museumOptions = computed(() => museumStore.items.map((m) => ({ label: m.nom, value: m.id })))

const form = reactive({
  museumId: null, titre: '', description: '', image: '', lieu: '',
  dateDebut: null, dateFin: null, published: false
})

// Les dates transitent en ISO (yyyy-mm-dd) côté base, en Date côté DatePicker.
const toDate = (s) => (s ? new Date(s + 'T00:00:00') : null)
const toIso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d || null)

function reset() {
  const e = props.event
  Object.assign(form, {
    museumId: e?.museumId ?? null,
    titre: e?.titre ?? '',
    description: e?.description ?? '',
    image: e?.image ?? '',
    lieu: e?.lieu ?? '',
    dateDebut: toDate(e?.dateDebut),
    dateFin: toDate(e?.dateFin),
    published: e?.published ?? false
  })
  submitted.value = false
}
watch(() => props.visible, (o) => { if (o) reset() })

const valid = computed(() => form.titre.trim().length > 0)
function close() { emit('update:visible', false) }

async function save() {
  submitted.value = true
  if (!valid.value) return
  const payload = { ...form, dateDebut: toIso(form.dateDebut), dateFin: toIso(form.dateFin) }
  try {
    if (props.event) await store.update(props.event.id, payload)
    else await store.add(payload)
    toast.add({ severity: 'success', summary: props.event ? t('admin.events.updated') : t('admin.events.created'), life: 2000 })
    emit('saved')
    close()
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.events.failed'), detail: e.message, life: 3000 })
  }
}
</script>

<template>
  <Dialog
    :visible="visible" modal
    :header="event ? $t('admin.events.formEdit') : $t('admin.events.formNew')"
    :style="{ width: '44rem', maxWidth: '95vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="vi-field">
      <label class="vi-req">{{ $t('admin.events.fTitle') }}</label>
      <InputText v-model="form.titre" :placeholder="$t('admin.events.fTitlePlaceholder')" :invalid="submitted && !form.titre.trim()" />
    </div>

    <div class="vi-row">
      <div class="vi-field">
        <label>{{ $t('admin.events.fMuseum') }}</label>
        <Select v-model="form.museumId" :options="museumOptions" option-label="label" option-value="value"
          show-clear :placeholder="$t('admin.events.fMuseumPlaceholder')" />
      </div>
      <div class="vi-field">
        <label>{{ $t('admin.events.fPlace') }}</label>
        <InputText v-model="form.lieu" :placeholder="$t('admin.events.fPlacePlaceholder')" />
      </div>
    </div>

    <div class="vi-row">
      <div class="vi-field">
        <label>{{ $t('admin.events.fStart') }}</label>
        <DatePicker v-model="form.dateDebut" date-format="dd/mm/yy" show-icon />
      </div>
      <div class="vi-field">
        <label>{{ $t('admin.events.fEnd') }}</label>
        <DatePicker v-model="form.dateFin" date-format="dd/mm/yy" show-icon />
      </div>
    </div>

    <div class="vi-field">
      <label>{{ $t('admin.events.fDescription') }}</label>
      <Textarea v-model="form.description" rows="4" auto-resize :placeholder="$t('admin.events.fDescriptionPlaceholder')" />
    </div>

    <div class="vi-field">
      <label>{{ $t('admin.events.fImage') }}</label>
      <ImageUploader v-model="form.image" :label="$t('admin.events.fImageUploader')" height="150px" />
    </div>

    <div style="display:flex;align-items:center;gap:.75rem;padding:.9rem;background:var(--vi-bg);border-radius:12px">
      <ToggleSwitch v-model="form.published" input-id="e-pub" />
      <label for="e-pub">
        <strong>{{ $t('admin.events.fPublished') }}</strong>
        <span style="display:block;font-size:.8rem;color:var(--vi-muted)">{{ $t('admin.events.fPublishedHint') }}</span>
      </label>
    </div>

    <template #footer>
      <Button :label="$t('admin.common.cancel')" severity="secondary" text @click="close" />
      <Button :label="$t('admin.common.save')" icon="pi pi-check" @click="save" />
    </template>
  </Dialog>
</template>
