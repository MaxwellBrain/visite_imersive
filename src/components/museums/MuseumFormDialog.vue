<script setup>
import { reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import InputNumber from 'primevue/inputnumber'
import Message from 'primevue/message'
import { useToast } from 'primevue/usetoast'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { MUSEUM_TYPES, PARTNER_INSTITUTIONS } from '@/constants/options'
import ImageUploader from '@/components/common/ImageUploader.vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  museum: { type: Object, default: null }
})
const emit = defineEmits(['update:visible', 'saved'])

const { t } = useI18n()
const store = useMuseumStore()
const toast = useToast()
const submitted = ref(false)

const form = reactive({
  nom: '',
  type: null,
  anneeFondation: null,
  description: '',
  photo: '',
  partenaire: null
})

function reset() {
  form.nom = props.museum?.nom ?? ''
  form.type = props.museum?.type ?? null
  form.anneeFondation = props.museum?.anneeFondation ?? null
  form.description = props.museum?.description ?? ''
  form.photo = props.museum?.photo ?? ''
  form.partenaire = props.museum?.partenaire ?? null
  submitted.value = false
}

watch(
  () => props.visible,
  (open) => {
    if (open) reset()
  }
)

function close() {
  emit('update:visible', false)
}

async function save() {
  submitted.value = true
  if (!form.nom.trim()) return

  const payload = { ...form }
  try {
    if (props.museum) {
      await store.update(props.museum.id, payload)
      toast.add({ severity: 'success', summary: t('admin.museums.updated'), life: 2500 })
    } else {
      await store.add(payload)
      toast.add({ severity: 'success', summary: t('admin.museums.created'), detail: form.nom, life: 2500 })
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
    :header="museum ? $t('admin.museums.formEditTitle') : $t('admin.museums.formCreateTitle')"
    :style="{ width: '40rem', maxWidth: '95vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="vi-field">
      <label class="vi-req" for="m-nom">{{ $t('admin.museums.fNameReq') }}</label>
      <InputText
        id="m-nom"
        v-model="form.nom"
        :placeholder="$t('admin.museums.fNamePlaceholder')"
        :invalid="submitted && !form.nom.trim()"
      />
      <small v-if="submitted && !form.nom.trim()" style="color: var(--p-red-500)">
        {{ $t('admin.museums.fNameRequired') }}
      </small>
    </div>

    <div class="vi-row">
      <div class="vi-field">
        <label for="m-type">{{ $t('admin.museums.fType') }}</label>
        <Select
          id="m-type"
          v-model="form.type"
          :options="MUSEUM_TYPES"
          :placeholder="$t('admin.museums.fTypePlaceholder')"
          show-clear
        />
      </div>
      <div class="vi-field">
        <label for="m-annee">{{ $t('admin.museums.fYear') }}</label>
        <InputNumber
          id="m-annee"
          v-model="form.anneeFondation"
          :use-grouping="false"
          :min="0"
          :max="new Date().getFullYear()"
          :placeholder="$t('admin.museums.fYearPlaceholder')"
        />
        <small>{{ $t('admin.museums.fYearHint') }}</small>
      </div>
    </div>

    <div class="vi-field">
      <label for="m-desc">{{ $t('admin.museums.fDescription') }}</label>
      <Textarea
        id="m-desc"
        v-model="form.description"
        rows="4"
        auto-resize
        :placeholder="$t('admin.museums.fDescPlaceholder')"
      />
    </div>

    <div class="vi-field">
      <label for="m-part">{{ $t('admin.museums.fPartnerLabel') }}</label>
      <Select
        id="m-part"
        v-model="form.partenaire"
        :options="PARTNER_INSTITUTIONS"
        editable
        show-clear
        :placeholder="$t('admin.museums.fPartnerPlaceholder')"
      />
      <small>{{ $t('admin.museums.fPartnerHint') }}</small>
    </div>

    <Message v-if="form.partenaire" severity="info" :closable="false" class="partner-note">
      {{ $t('admin.museums.partnerNote', { partner: form.partenaire }) }}
    </Message>

    <div class="vi-field">
      <label>{{ $t('admin.museums.fPhotoLabel') }}</label>
      <ImageUploader v-model="form.photo" :label="$t('admin.museums.fPhotoUploader')" />
    </div>

    <template #footer>
      <Button :label="$t('admin.common.cancel')" severity="secondary" text @click="close" />
      <Button :label="$t('admin.common.save')" icon="pi pi-check" @click="save" />
    </template>
  </Dialog>
</template>

<style scoped>
.partner-note {
  margin-bottom: 1rem;
}
</style>
