<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'
import { useGenealogyStore } from '@/stores/useGenealogyStore'
import { GENEALOGY_TITLES } from '@/constants/options'
import ImageUploader from '@/components/common/ImageUploader.vue'

const props = defineProps({ visible: { type: Boolean, default: false } })
const emit = defineEmits(['update:visible', 'saved'])

const { t } = useI18n()
const store = useGenealogyStore()
const toast = useToast()
const submitted = ref(false)

const SEXES = computed(() => [
  { label: t('admin.genealogy.sexM'), value: 'M' },
  { label: t('admin.genealogy.sexF'), value: 'F' },
  { label: t('admin.genealogy.sexU'), value: 'U' }
])

const individuOptions = computed(() =>
  store.individus.map((i) => ({
    label: `${store.nomComplet(i)}${i.titre ? ` — ${i.titre}` : ''}`,
    value: i.id
  }))
)

const form = reactive({
  nom: '', prenom: '', titre: null, sexe: 'M',
  naissance: '', deces: '', regneDebut: null, regneFin: null,
  lieuOrigine: '', biographie: '', photo: '',
  parent1Id: null, parent2Id: null
})

function reset() {
  Object.assign(form, {
    nom: '', prenom: '', titre: null, sexe: 'M',
    naissance: '', deces: '', regneDebut: null, regneFin: null,
    lieuOrigine: '', biographie: '', photo: '',
    parent1Id: null, parent2Id: null
  })
  submitted.value = false
}

watch(() => props.visible, (open) => { if (open) reset() })

function close() { emit('update:visible', false) }

async function save() {
  submitted.value = true
  if (!form.nom.trim()) return
  const { parent1Id, parent2Id, ...data } = form
  try {
    await store.addMember(data, { parent1Id, parent2Id })
    toast.add({ severity: 'success', summary: t('admin.genealogy.created'), detail: store.nomComplet(data), life: 2500 })
    emit('saved')
    close()
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.genealogy.failed'), detail: e.message, life: 3000 })
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="$t('admin.genealogy.formTitle')"
    :style="{ width: '40rem', maxWidth: '95vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="vi-row">
      <div class="vi-field">
        <label class="vi-req" for="i-nom">{{ $t('admin.genealogy.fLastName') }}</label>
        <InputText id="i-nom" v-model="form.nom" :placeholder="$t('admin.genealogy.fLastNamePlaceholder')" :invalid="submitted && !form.nom.trim()" />
      </div>
      <div class="vi-field">
        <label for="i-prenom">{{ $t('admin.genealogy.fFirstNames') }}</label>
        <InputText id="i-prenom" v-model="form.prenom" :placeholder="$t('admin.genealogy.fFirstNamePlaceholder')" />
      </div>
    </div>

    <div class="vi-row">
      <div class="vi-field">
        <label for="i-titre">{{ $t('admin.genealogy.fCustomTitle') }}</label>
        <Select id="i-titre" v-model="form.titre" :options="GENEALOGY_TITLES" editable show-clear :placeholder="$t('admin.genealogy.fCustomTitlePlaceholder')" />
      </div>
      <div class="vi-field" style="flex: 0 1 150px">
        <label for="i-sexe">{{ $t('admin.genealogy.fSexe') }}</label>
        <Select id="i-sexe" v-model="form.sexe" :options="SEXES" option-label="label" option-value="value" />
      </div>
    </div>

    <div class="vi-row">
      <div class="vi-field">
        <label for="i-nais">{{ $t('admin.genealogy.fBirth') }}</label>
        <InputText id="i-nais" v-model="form.naissance" :placeholder="$t('admin.genealogy.fBirthPlaceholder')" />
      </div>
      <div class="vi-field">
        <label for="i-deces">{{ $t('admin.genealogy.fDeath') }}</label>
        <InputText id="i-deces" v-model="form.deces" :placeholder="$t('admin.genealogy.fDeathPlaceholder')" />
      </div>
    </div>

    <div class="vi-row">
      <div class="vi-field">
        <label for="i-rd">{{ $t('admin.genealogy.fReignStart') }}</label>
        <InputNumber id="i-rd" v-model="form.regneDebut" :use-grouping="false" :min="0" :max="new Date().getFullYear()" :placeholder="$t('admin.genealogy.fReignStartPlaceholder')" />
      </div>
      <div class="vi-field">
        <label for="i-rf">{{ $t('admin.genealogy.fReignEnd') }}</label>
        <InputNumber id="i-rf" v-model="form.regneFin" :use-grouping="false" :min="0" :max="new Date().getFullYear()" :placeholder="$t('admin.genealogy.fReignEndPlaceholder')" />
      </div>
      <div class="vi-field">
        <label for="i-lieu">{{ $t('admin.genealogy.fOrigin') }}</label>
        <InputText id="i-lieu" v-model="form.lieuOrigine" :placeholder="$t('admin.genealogy.fOriginPlaceholder')" />
      </div>
    </div>

    <div class="vi-field">
      <label for="i-bio">{{ $t('admin.genealogy.fBio') }}</label>
      <Textarea id="i-bio" v-model="form.biographie" rows="3" auto-resize :placeholder="$t('admin.genealogy.fBioPlaceholder2')" />
    </div>

    <div class="vi-field">
      <label>{{ $t('admin.genealogy.fPhotoLabel') }}</label>
      <ImageUploader v-model="form.photo" :label="$t('admin.genealogy.fPortraitUploader')" height="140px" />
    </div>

    <div class="vi-row">
      <div class="vi-field">
        <label for="i-p1">{{ $t('admin.genealogy.fParent1') }}</label>
        <Select id="i-p1" v-model="form.parent1Id" :options="individuOptions" option-label="label" option-value="value" show-clear filter :placeholder="$t('admin.genealogy.parentPlaceholder')" />
      </div>
      <div class="vi-field">
        <label for="i-p2">{{ $t('admin.genealogy.fParent2') }}</label>
        <Select id="i-p2" v-model="form.parent2Id" :options="individuOptions" option-label="label" option-value="value" show-clear filter :placeholder="$t('admin.genealogy.parentPlaceholder')" />
      </div>
    </div>
    <small style="color: var(--vi-muted)">
      {{ $t('admin.genealogy.parentHint') }}
    </small>

    <template #footer>
      <Button :label="$t('admin.common.cancel')" severity="secondary" text @click="close" />
      <Button :label="$t('admin.common.save')" icon="pi pi-check" @click="save" />
    </template>
  </Dialog>
</template>
