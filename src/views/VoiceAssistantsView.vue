<script setup>
import { formatMontant } from '@/constants/options'
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useVoiceStore } from '@/stores/useVoiceStore'
import { useMuseumStore } from '@/stores/useMuseumStore'
import VoiceAssistantDialog from '@/components/voice/VoiceAssistantDialog.vue'
import VoiceTracksDialog from '@/components/voice/VoiceTracksDialog.vue'

const { t } = useI18n()
const store = useVoiceStore()
const museumStore = useMuseumStore()
const confirm = useConfirm()
const toast = useToast()

const dialog = ref(false)
const editing = ref(null)
const tracksDialog = ref(false)
const tracksTarget = ref(null)

onMounted(() => store.load())

const SOURCE_LABEL = computed(() => ({ import: t('admin.voice.srcImport'), enregistrement: t('admin.voice.srcRecording'), synthese: t('admin.voice.srcTts') }))
function museumName(id) { return museumStore.getById(id)?.nom ?? '—' }
function openCreate() { editing.value = null; dialog.value = true }
function openEdit(a) { editing.value = a; dialog.value = true }
function openTracks(a) { tracksTarget.value = a; tracksDialog.value = true }
function remove(a) {
  confirm.require({
    message: t('admin.voice.deleteConfirm', { name: a.titre || museumName(a.museumId) }),
    header: t('admin.voice.confirm'), icon: 'pi pi-exclamation-triangle',
    rejectLabel: t('admin.common.cancel'), acceptLabel: t('admin.common.delete'), acceptClass: 'p-button-danger',
    accept: async () => {
      try { await store.removeAssistant(a.id); toast.add({ severity: 'info', summary: t('admin.voice.deleted'), life: 2000 }) }
      catch (e) { toast.add({ severity: 'error', summary: t('admin.voice.failed'), detail: e.message, life: 3000 }) }
    }
  })
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('admin.voice.title') }}</h1>
        <p class="vi-page__subtitle">{{ $t('admin.voice.subtitle') }}</p>
      </div>
      <Button :label="$t('admin.voice.new')" icon="pi pi-plus" @click="openCreate" />
    </div>

    <DataTable :value="store.assistants" data-key="id" striped-rows>
      <template #empty><div class="vi-empty"><i class="pi pi-volume-up" /><strong>{{ $t('admin.voice.emptyTitle') }}</strong><p>{{ $t('admin.voice.empty') }}</p></div></template>
      <Column :header="$t('admin.voice.colMuseum')"><template #body="{ data }"><Tag :value="museumName(data.museumId)" severity="info" /></template></Column>
      <Column field="titre" :header="$t('admin.voice.colTitle')"><template #body="{ data }">{{ data.titre || '—' }}</template></Column>
      <Column :header="$t('admin.voice.colSource')"><template #body="{ data }">{{ SOURCE_LABEL[data.source] || data.source }}</template></Column>
      <Column :header="$t('admin.voice.colPrice')">
        <template #body="{ data }">
          <strong v-if="data.prix != null">{{ formatMontant(data.prix, data.devise) }}</strong>
          <Tag v-else :value="$t('admin.voice.notOffered')" severity="warn" />
        </template>
      </Column>
      <Column :header="$t('admin.common.status')" style="width: 7rem">
        <template #body="{ data }"><Tag :value="data.actif ? $t('admin.common.active') : $t('admin.common.inactive')" :severity="data.actif ? 'success' : 'secondary'" /></template>
      </Column>
      <Column header="" style="width: 12rem">
        <template #body="{ data }">
          <div class="row-actions">
            <Button icon="pi pi-list" :label="$t('admin.voice.tracks')" size="small" text @click="openTracks(data)" />
            <Tag :value="String(store.tracksFor(data.id).length)" severity="secondary" />
            <Button icon="pi pi-pencil" text rounded @click="openEdit(data)" />
            <Button icon="pi pi-trash" text rounded severity="danger" @click="remove(data)" />
          </div>
        </template>
      </Column>
    </DataTable>

    <VoiceAssistantDialog v-model:visible="dialog" :assistant="editing" />
    <VoiceTracksDialog v-model:visible="tracksDialog" :assistant="tracksTarget" />
  </div>
</template>
