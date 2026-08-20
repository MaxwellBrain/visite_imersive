<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import ToggleSwitch from 'primevue/toggleswitch'
import { useToast } from 'primevue/usetoast'
import ImageUploader from '@/components/common/ImageUploader.vue'
import { useTourStore } from '@/stores/useTourStore'
import { useMuseumStore } from '@/stores/useMuseumStore'

const props = defineProps({
  visible: { type: Boolean, default: false },
  tour: { type: Object, default: null }
})
const emit = defineEmits(['update:visible', 'saved'])

const { t } = useI18n()
const store = useTourStore()
const museumStore = useMuseumStore()
const toast = useToast()
const submitted = ref(false)

const museumOptions = computed(() => museumStore.items.map((m) => ({ label: m.nom, value: m.id })))

const form = reactive({ museumId: null, titre: '', description: '', couverture: '', dureeMin: null, published: false })

function reset() {
  form.museumId = props.tour?.museumId ?? null
  form.titre = props.tour?.titre ?? ''
  form.description = props.tour?.description ?? ''
  form.couverture = props.tour?.couverture ?? ''
  form.dureeMin = props.tour?.dureeMin ?? null
  form.published = props.tour?.published ?? false
  submitted.value = false
}
watch(() => props.visible, (open) => { if (open) reset() })

const valid = computed(() => form.titre.trim() && form.museumId != null)
const close = () => emit('update:visible', false)

async function save() {
  submitted.value = true
  if (!valid.value) return
  try {
    // `saved` ne porte la visite que lorsqu'elle vient d'être CRÉÉE : la vue
    // enchaîne alors sur l'éditeur de salles, puisqu'un parcours vide ne montre rien.
    if (props.tour) {
      await store.update(props.tour.id, { ...form })
      toast.add({ severity: 'success', summary: t('admin.tours.updated'), life: 2500 })
      emit('saved', null)
    } else {
      const created = await store.add({ ...form })
      toast.add({ severity: 'success', summary: t('admin.tours.created'), detail: form.titre, life: 2500 })
      emit('saved', created)
    }
    close()
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.common.saveFailed'), detail: e.message, life: 3500 })
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="tour ? $t('admin.tours.formEditTitle') : $t('admin.tours.formCreateTitle')"
    :style="{ width: '42rem', maxWidth: '95vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="vi-field">
      <label class="vi-req" for="t-musee">{{ $t('admin.tours.fMuseum') }}</label>
      <Select
        id="t-musee"
        v-model="form.museumId"
        :options="museumOptions"
        option-label="label"
        option-value="value"
        filter
        :placeholder="$t('admin.tours.fMuseumPlaceholder')"
        :invalid="submitted && form.museumId == null"
      />
      <small>{{ $t('admin.tours.fMuseumHint') }}</small>
    </div>

    <div class="vi-field">
      <label class="vi-req" for="t-titre">{{ $t('admin.tours.fTitle') }}</label>
      <InputText
        id="t-titre"
        v-model="form.titre"
        :placeholder="$t('admin.tours.fTitlePlaceholder')"
        :invalid="submitted && !form.titre.trim()"
      />
    </div>

    <div class="vi-field">
      <label for="t-desc">{{ $t('admin.common.description') }}</label>
      <Textarea id="t-desc" v-model="form.description" rows="3" auto-resize :placeholder="$t('admin.tours.fDescPlaceholder')" />
    </div>

    <div class="vi-row">
      <div class="vi-field" style="flex: 0 1 180px">
        <label for="t-duree">{{ $t('admin.tours.fDuration') }}</label>
        <InputNumber id="t-duree" v-model="form.dureeMin" :min="1" :max="600" suffix=" min" />
      </div>
      <div class="vi-field">
        <label>{{ $t('admin.common.online') }}</label>
        <div class="t-pub">
          <ToggleSwitch v-model="form.published" />
          <small>{{ $t('admin.tours.fPublishedHint') }}</small>
        </div>
      </div>
    </div>

    <div class="vi-field">
      <label>{{ $t('admin.tours.fCover') }}</label>
      <ImageUploader v-model="form.couverture" :label="$t('admin.tours.fCover')" height="160px" />
    </div>

    <template #footer>
      <Button :label="$t('admin.common.cancel')" severity="secondary" text @click="close" />
      <Button :label="$t('admin.common.save')" icon="pi pi-check" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.t-pub { display: flex; align-items: center; gap: 0.7rem; }
.t-pub small { color: var(--vi-muted); }
</style>
