<script setup>
import { reactive, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { useToast } from 'primevue/usetoast'
import { useProductStore } from '@/stores/useProductStore'
import { useMuseumStore } from '@/stores/useMuseumStore'
import ImageUploader from '@/components/common/ImageUploader.vue'
import { CURRENCIES } from '@/constants/options'

const { t } = useI18n()
const props = defineProps({ visible: { type: Boolean, default: false }, product: { type: Object, default: null } })
const emit = defineEmits(['update:visible', 'saved'])

const store = useProductStore()
const museumStore = useMuseumStore()
const toast = useToast()
const submitted = ref(false)

const museumOptions = computed(() => museumStore.items.map((m) => ({ label: m.nom, value: m.id })))
const categorieOptions = computed(() =>
  [
    t('admin.products.catSouvenirs'), t('admin.products.catBooks'), t('admin.products.catCrafts'),
    t('admin.products.catJewelry'), t('admin.products.catDecor'), t('admin.products.catTextile')
  ].map((c) => ({ label: c, value: c }))
)

const form = reactive({
  museumId: null, nom: '', description: '', prix: null, devise: 'FCFA',
  image: '', categorie: '', stock: null, published: false
})

function reset() {
  const p = props.product
  Object.assign(form, {
    museumId: p?.museumId ?? null,
    nom: p?.nom ?? '',
    description: p?.description ?? '',
    prix: p?.prix ?? null,
    devise: p?.devise ?? 'FCFA',
    image: p?.image ?? '',
    categorie: p?.categorie ?? '',
    stock: p?.stock ?? null,
    published: p?.published ?? false
  })
  submitted.value = false
}
watch(() => props.visible, (o) => { if (o) reset() })

const valid = computed(() => form.museumId != null && form.nom.trim() && form.prix != null)
function close() { emit('update:visible', false) }

async function save() {
  submitted.value = true
  if (!valid.value) return
  try {
    if (props.product) await store.update(props.product.id, { ...form })
    else await store.add({ ...form })
    toast.add({ severity: 'success', summary: props.product ? t('admin.products.updated') : t('admin.products.created'), life: 2000 })
    emit('saved')
    close()
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.products.failed'), detail: e.message, life: 3000 })
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="product ? $t('admin.products.formEdit') : $t('admin.products.formNew')"
    :style="{ width: '46rem', maxWidth: '95vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="vi-row">
      <div class="vi-field">
        <label class="vi-req">{{ $t('admin.products.fMuseum') }}</label>
        <Select v-model="form.museumId" :options="museumOptions" option-label="label" option-value="value"
          :placeholder="$t('admin.products.fMuseumPlaceholder')" :invalid="submitted && form.museumId == null" />
      </div>
      <div class="vi-field">
        <label class="vi-req">{{ $t('admin.products.fName') }}</label>
        <InputText v-model="form.nom" :placeholder="$t('admin.products.fNamePlaceholder')" :invalid="submitted && !form.nom.trim()" />
      </div>
    </div>

    <div class="vi-field">
      <label>{{ $t('admin.products.fDescription') }}</label>
      <Textarea v-model="form.description" rows="3" auto-resize :placeholder="$t('admin.products.fDescriptionPlaceholder')" />
    </div>

    <div class="vi-field">
      <label>{{ $t('admin.products.fImage') }}</label>
      <ImageUploader v-model="form.image" :label="$t('admin.products.fImageUploader')" height="150px" />
    </div>

    <div class="vi-row">
      <div class="vi-field">
        <label class="vi-req">{{ $t('admin.products.fPrice') }}</label>
        <InputNumber v-model="form.prix" :min="0" :max="99999999" :invalid="submitted && form.prix == null" />
      </div>
      <div class="vi-field" style="flex:0 1 130px">
        <label>{{ $t('admin.products.fCurrency') }}</label>
        <Select v-model="form.devise" :options="CURRENCIES" editable />
      </div>
      <div class="vi-field" style="flex:0 1 140px">
        <label>{{ $t('admin.products.fStock') }}</label>
        <InputNumber v-model="form.stock" :min="0" :max="999999" :placeholder="$t('admin.products.fStockPlaceholder')" />
      </div>
    </div>

    <div class="vi-field">
      <label>{{ $t('admin.products.fCategory') }}</label>
      <Select v-model="form.categorie" :options="categorieOptions" option-label="label" option-value="value"
        editable show-clear :placeholder="$t('admin.products.fCategoryPlaceholder')" />
    </div>

    <div style="display:flex;align-items:center;gap:.75rem;padding:.9rem;background:var(--vi-bg);border-radius:12px">
      <ToggleSwitch v-model="form.published" input-id="p-pub" />
      <label for="p-pub">
        <strong>{{ $t('admin.products.fPublished') }}</strong>
        <span style="display:block;font-size:.8rem;color:var(--vi-muted)">{{ $t('admin.products.fPublishedHint') }}</span>
      </label>
    </div>

    <template #footer>
      <Button :label="$t('admin.common.cancel')" severity="secondary" text @click="close" />
      <Button :label="$t('admin.common.save')" icon="pi pi-check" @click="save" />
    </template>
  </Dialog>
</template>
