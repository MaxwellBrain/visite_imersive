<script setup>
import { reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import InputNumber from 'primevue/inputnumber'
import ToggleSwitch from 'primevue/toggleswitch'
import { useToast } from 'primevue/usetoast'
import { useFaqStore } from '@/stores/useFaqStore'

const { t } = useI18n()

const props = defineProps({ visible: { type: Boolean, default: false }, faq: { type: Object, default: null } })
const emit = defineEmits(['update:visible', 'saved'])

const store = useFaqStore()
const toast = useToast()
const submitted = ref(false)

const form = reactive({ question: '', reponse: '', categorie: '', ordre: 0, visible: true })

function reset() {
  form.question = props.faq?.question ?? ''
  form.reponse = props.faq?.reponse ?? ''
  form.categorie = props.faq?.categorie ?? ''
  form.ordre = props.faq?.ordre ?? 0
  form.visible = props.faq?.visible ?? true
  submitted.value = false
}
watch(() => props.visible, (o) => { if (o) reset() })

function close() { emit('update:visible', false) }

async function save() {
  submitted.value = true
  // La réponse est annoncée obligatoire depuis toujours (étoile sur son libellé),
  // mais rien ne la vérifiait : on pouvait enregistrer une question sans réponse,
  // qui s'affichait vide sur le site public.
  if (!form.question.trim() || !form.reponse.trim()) return
  try {
    if (props.faq) await store.update(props.faq.id, { ...form })
    else await store.add({ ...form })
    toast.add({ severity: 'success', summary: props.faq ? t('admin.faq.updated') : t('admin.faq.created'), life: 2000 })
    emit('saved')
    close()
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.faq.failed'), detail: e.message, life: 3000 })
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="faq ? $t('admin.faq.formEditTitle') : $t('admin.faq.formCreateTitle')"
    :style="{ width: '40rem', maxWidth: '95vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="vi-field">
      <label class="vi-req" for="f-q">{{ $t('admin.faq.fQuestion') }}</label>
      <InputText id="f-q" v-model="form.question" :invalid="submitted && !form.question.trim()" :placeholder="$t('admin.faq.fQuestionPlaceholder')" />
    </div>
    <div class="vi-field">
      <label class="vi-req" for="f-r">{{ $t('admin.faq.fAnswer') }}</label>
      <Textarea id="f-r" v-model="form.reponse" rows="5" auto-resize
                :invalid="submitted && !form.reponse.trim()" :placeholder="$t('admin.faq.fAnswerPlaceholder')" />
    </div>
    <div class="vi-row">
      <div class="vi-field">
        <label for="f-cat">{{ $t('admin.faq.fCategory') }}</label>
        <InputText id="f-cat" v-model="form.categorie" :placeholder="$t('admin.faq.fCategoryPlaceholder')" />
      </div>
      <div class="vi-field" style="flex: 0 1 130px">
        <label for="f-ord">{{ $t('admin.faq.fOrder') }}</label>
        <InputNumber id="f-ord" v-model="form.ordre" :min="0" :max="9999" />
      </div>
    </div>
    <div class="publish-row" style="display:flex;align-items:center;gap:.75rem;padding:.9rem;background:var(--vi-bg);border-radius:12px">
      <ToggleSwitch v-model="form.visible" input-id="f-vis" />
      <label for="f-vis"><strong>{{ $t('admin.faq.fVisible') }}</strong></label>
    </div>

    <template #footer>
      <Button :label="$t('admin.common.cancel')" severity="secondary" text @click="close" />
      <Button :label="$t('admin.common.save')" icon="pi pi-check" @click="save" />
    </template>
  </Dialog>
</template>
