<script setup>
import { ref, reactive, computed } from 'vue'
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
import { useSectorStore } from '@/stores/useSectorStore'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { SECTOR_LOCATIONS } from '@/constants/options'
import SectorFormDialog from '@/components/sectors/SectorFormDialog.vue'

const { t } = useI18n()
const store = useSectorStore()
const museumStore = useMuseumStore()
const confirm = useConfirm()
const toast = useToast()

const dialogVisible = ref(false)
const editing = ref(null)

const museumOptions = computed(() => museumStore.items.map((m) => ({ label: m.nom, value: m.id })))

const draft = reactive({ search: '', museumId: null, emplacement: null })
const applied = reactive({ search: '', museumId: null, emplacement: null })

const filtered = computed(() => {
  const q = applied.search.trim().toLowerCase()
  return store.items.filter((s) => {
    const okQ = !q || s.nom.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)
    const okM = applied.museumId == null || s.museumId === applied.museumId
    const okE = !applied.emplacement || s.emplacement === applied.emplacement
    return okQ && okM && okE
  })
})

function applyFilters() {
  Object.assign(applied, draft)
}
function resetFilters() {
  Object.assign(draft, { search: '', museumId: null, emplacement: null })
  Object.assign(applied, { search: '', museumId: null, emplacement: null })
}

function openCreate() {
  editing.value = null
  dialogVisible.value = true
}
function openEdit(sector) {
  editing.value = sector
  dialogVisible.value = true
}
function museumName(id) {
  return museumStore.getById(id)?.nom ?? t('admin.sectors.museumDeleted')
}
// Publication : un secteur non publié (et ses objets) reste invisible sur le site public.
async function togglePublished(sector) {
  try {
    await store.update(sector.id, { ...sector, published: !sector.published })
    toast.add({
      severity: 'success',
      summary: sector.published ? t('admin.sectors.unpublished') : t('admin.sectors.published'),
      life: 2000
    })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.common.saveFailed'), detail: e.message, life: 3000 })
  }
}

function remove(sector) {
  confirm.require({
    message: t('admin.sectors.deleteConfirm', { name: sector.nom }),
    header: t('admin.common.confirmDelete'),
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: t('admin.common.cancel'),
    acceptLabel: t('admin.common.delete'),
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await store.remove(sector.id)
        toast.add({ severity: 'info', summary: t('admin.sectors.deleted'), life: 2000 })
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
        <h1 class="vi-page__title">{{ $t('admin.sectors.title') }}</h1>
        <p class="vi-page__subtitle">
          {{ $t('admin.sectors.subtitle', { shown: filtered.length, total: store.items.length }) }}
        </p>
      </div>
      <Button :label="$t('admin.sectors.new')" icon="pi pi-plus" @click="openCreate" />
    </div>

    <div class="list-layout">
      <div class="list-main">
        <DataTable :value="filtered" data-key="id" striped-rows removable-sort>
          <template #empty>
            <div class="vi-empty"><i class="pi pi-sitemap" /><strong>{{ $t('admin.sectors.emptyTitle') }}</strong><p>{{ $t('admin.sectors.empty') }}</p></div>
          </template>
          <Column field="nom" :header="$t('admin.common.name')" sortable />
          <Column :header="$t('admin.sectors.colMuseum')">
            <template #body="{ data }"><Tag :value="museumName(data.museumId)" severity="info" /></template>
          </Column>
          <Column field="emplacement" :header="$t('admin.sectors.colLocation')" sortable style="width: 9rem">
            <template #body="{ data }">
              <Tag
                :value="data.emplacement || 'Intérieur'"
                :severity="data.emplacement === 'Extérieur' ? 'success' : 'secondary'"
                :icon="data.emplacement === 'Extérieur' ? 'pi pi-cloud' : 'pi pi-home'"
              />
            </template>
          </Column>
          <Column field="etage" :header="$t('admin.sectors.colFloor')" sortable style="width: 5.5rem">
            <template #body="{ data }">{{ data.etage ?? '—' }}</template>
          </Column>
          <Column field="description" :header="$t('admin.common.description')">
            <template #body="{ data }">
              <span class="sector-desc">{{ data.description || '—' }}</span>
            </template>
          </Column>
          <Column :header="$t('admin.common.online')" style="width: 6.5rem">
            <template #body="{ data }">
              <ToggleSwitch :model-value="data.published" @update:model-value="togglePublished(data)" />
            </template>
          </Column>
          <Column header="" style="width: 7rem">
            <template #body="{ data }">
              <div class="row-actions">
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
          <InputText v-model="draft.search" :placeholder="$t('admin.museums.searchPlaceholder')" @keyup.enter="applyFilters" />
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
        <div class="filters-card__field">
          <label>{{ $t('admin.sectors.location') }}</label>
          <Select v-model="draft.emplacement" :options="SECTOR_LOCATIONS" show-clear :placeholder="$t('admin.common.all')" />
        </div>
        <div class="filters-card__actions">
          <Button :label="$t('admin.common.filter')" icon="pi pi-search" size="small" @click="applyFilters" />
          <Button :label="$t('admin.common.reset')" icon="pi pi-refresh" size="small" outlined @click="resetFilters" />
        </div>
      </aside>
    </div>

    <SectorFormDialog v-model:visible="dialogVisible" :sector="editing" />
  </div>
</template>

<style scoped>
.sector-desc {
  display: block;
  max-width: 300px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--vi-muted);
}
.row-actions {
  display: flex;
  gap: 0.2rem;
}
</style>
