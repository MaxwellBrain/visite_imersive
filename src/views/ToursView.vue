<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { messageSuppression } from '@/services/ecriture'
import { useTourStore } from '@/stores/useTourStore'
import { useMuseumStore } from '@/stores/useMuseumStore'
import TourFormDialog from '@/components/tours/TourFormDialog.vue'
import SceneEditorDialog from '@/components/tours/SceneEditorDialog.vue'

const { t } = useI18n()
const store = useTourStore()
const museumStore = useMuseumStore()
const confirm = useConfirm()
const toast = useToast()

const dialogVisible = ref(false)
const editorVisible = ref(false)
const editing = ref(null)

onMounted(() => store.load())

const museumOptions = computed(() => museumStore.items.map((m) => ({ label: m.nom, value: m.id })))
const draft = ref({ search: '', museumId: null })
const applied = ref({ search: '', museumId: null })

const filtered = computed(() => {
  const q = applied.value.search.trim().toLowerCase()
  return store.items.filter((tr) => {
    const okQ = !q || tr.titre.toLowerCase().includes(q) || (tr.description || '').toLowerCase().includes(q)
    const okM = applied.value.museumId == null || tr.museumId === applied.value.museumId
    return okQ && okM
  })
})
const published = computed(() => store.items.filter((x) => x.published).length)

function applyFilters() { applied.value = { ...draft.value } }
function resetFilters() { draft.value = { search: '', museumId: null }; applied.value = { search: '', museumId: null } }

function museumName(id) { return museumStore.getById(id)?.nom ?? t('admin.sectors.museumDeleted') }

function openCreate() { editing.value = null; dialogVisible.value = true }
function openEdit(tr) { editing.value = tr; dialogVisible.value = true }
function openEditor(tr) { editing.value = tr; editorVisible.value = true }

// Une visite créée s'ouvre directement dans l'éditeur : sans salle, elle ne
// montre rien — autant enchaîner sur la seule action qui reste à faire.
function onSaved(created) {
  if (created) openEditor(created)
}

// Publication en cascade : une visite publiée reste invisible tant que son
// musée ne l'est pas. On le dit plutôt que de laisser l'admin chercher.
async function togglePublished(tr) {
  try {
    await store.update(tr.id, { ...tr, published: !tr.published })
    const museum = museumStore.getById(tr.museumId)
    if (!tr.published && museum && !museum.published) {
      toast.add({ severity: 'warn', summary: t('admin.tours.published'), detail: t('admin.tours.museumDraft'), life: 5000 })
    } else {
      toast.add({ severity: 'success', summary: tr.published ? t('admin.tours.unpublished') : t('admin.tours.published'), life: 2000 })
    }
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.common.saveFailed'), detail: e.message, life: 3000 })
  }
}

function remove(tr) {
  confirm.require({
    message: t('admin.tours.deleteConfirm', { name: tr.titre }),
    header: t('admin.common.confirmDelete'),
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: t('admin.common.cancel'),
    acceptLabel: t('admin.common.delete'),
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await store.remove(tr.id)
        toast.add({ severity: 'info', summary: t('admin.tours.deleted'), life: 2000 })
      } catch (e) {
        toast.add({ severity: 'error', summary: t('admin.common.deleteFailed'), detail: messageSuppression(e, t), life: 3000 })
      }
    }
  })
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('admin.tours.title') }}</h1>
        <p class="vi-page__subtitle">{{ $t('admin.tours.subtitle', { n: store.items.length, p: published }) }}</p>
      </div>
      <Button :label="$t('admin.tours.new')" icon="pi pi-plus" @click="openCreate" />
    </div>

    <div class="list-layout">
      <div class="list-main">
        <DataTable :value="filtered" data-key="id" striped-rows removable-sort>
          <template #empty>
            <div class="vi-empty">
              <i class="pi pi-compass" />
              <strong>{{ $t('admin.tours.emptyTitle') }}</strong>
              <p>{{ $t('admin.tours.empty') }}</p>
            </div>
          </template>
          <Column field="titre" :header="$t('admin.common.name')" sortable />
          <Column :header="$t('admin.tours.colMuseum')">
            <template #body="{ data }"><Tag :value="museumName(data.museumId)" severity="info" /></template>
          </Column>
          <Column field="dureeMin" :header="$t('admin.tours.colDuration')" sortable style="width: 8rem">
            <template #body="{ data }">{{ data.dureeMin ? `${data.dureeMin} min` : '—' }}</template>
          </Column>
          <Column field="description" :header="$t('admin.common.description')">
            <template #body="{ data }"><span class="tour-desc">{{ data.description || '—' }}</span></template>
          </Column>
          <Column :header="$t('admin.common.online')" style="width: 6.5rem">
            <template #body="{ data }">
              <ToggleSwitch :model-value="data.published" @update:model-value="togglePublished(data)" />
            </template>
          </Column>
          <Column header="" style="width: 9rem">
            <template #body="{ data }">
              <div class="row-actions">
                <Button
                  icon="pi pi-compass"
                  text
                  rounded
                  :title="$t('admin.tours.editScenes')"
                  @click="openEditor(data)"
                />
                <Button icon="pi pi-pencil" text rounded @click="openEdit(data)" />
                <Button icon="pi pi-trash" text rounded severity="danger" @click="remove(data)" />
              </div>
            </template>
          </Column>
        </DataTable>
      </div>

      <aside class="filters-card">
        <div class="filters-card__title"><i class="pi pi-filter" /> {{ $t('admin.common.filters') }}</div>
        <div class="filters-card__field">
          <label>{{ $t('admin.common.search') }}</label>
          <InputText v-model="draft.search" :placeholder="$t('admin.tours.searchPlaceholder')" @keyup.enter="applyFilters" />
        </div>
        <div class="filters-card__field">
          <label>{{ $t('admin.sectors.museum') }}</label>
          <Select
            v-model="draft.museumId"
            :options="museumOptions"
            option-label="label"
            option-value="value"
            show-clear
            filter
            :placeholder="$t('admin.common.all')"
          />
        </div>
        <div class="filters-card__actions">
          <Button :label="$t('admin.common.filter')" icon="pi pi-search" size="small" @click="applyFilters" />
          <Button :label="$t('admin.common.reset')" icon="pi pi-refresh" size="small" outlined @click="resetFilters" />
        </div>
      </aside>
    </div>

    <TourFormDialog v-model:visible="dialogVisible" :tour="editing" @saved="onSaved" />
    <SceneEditorDialog v-model:visible="editorVisible" :tour="editing" />
  </div>
</template>

<style scoped>
.tour-desc {
  display: block;
  max-width: 320px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--vi-muted);
}
.row-actions { display: flex; gap: 0.2rem; }
</style>
