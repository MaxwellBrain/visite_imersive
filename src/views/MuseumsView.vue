<script setup>
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { messageSuppression } from '@/services/ecriture'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { useSectorStore } from '@/stores/useSectorStore'
import ImportFonds from '@/components/admin/ImportFonds.vue'
import { MUSEUM_TYPES } from '@/constants/options'
import MuseumFormDialog from '@/components/museums/MuseumFormDialog.vue'

const { t } = useI18n()
const store = useMuseumStore()
const sectorStore = useSectorStore()
const confirm = useConfirm()
const toast = useToast()

const dialogVisible = ref(false)
const editing = ref(null)

const draft = reactive({ search: '', type: null })
const applied = reactive({ search: '', type: null })

const filtered = computed(() => {
  const q = applied.search.trim().toLowerCase()
  return store.items.filter((m) => {
    const okQ = !q || m.nom.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q)
    const okType = !applied.type || m.type === applied.type
    return okQ && okType
  })
})

function applyFilters() {
  Object.assign(applied, draft)
}
function resetFilters() {
  Object.assign(draft, { search: '', type: null })
  Object.assign(applied, { search: '', type: null })
}

function openCreate() {
  editing.value = null
  dialogVisible.value = true
}
function openEdit(museum) {
  editing.value = museum
  dialogVisible.value = true
}
function age(year) {
  return year ? new Date().getFullYear() - year : null
}
function sectorCount(museumId) {
  return sectorStore.byMuseum(museumId).length
}
// Publication : tant qu'un musée n'est pas publié, il reste invisible sur le site public.
async function togglePublished(museum) {
  try {
    await store.update(museum.id, { ...museum, published: !museum.published })
    toast.add({
      severity: 'success',
      summary: museum.published ? t('admin.museums.unpublished') : t('admin.museums.published'),
      life: 2000
    })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.common.saveFailed'), detail: e.message, life: 3000 })
  }
}

function remove(museum) {
  confirm.require({
    message: t('admin.museums.deleteConfirm', { name: museum.nom }),
    header: t('admin.common.confirmDelete'),
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: t('admin.common.cancel'),
    acceptLabel: t('admin.common.delete'),
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await store.remove(museum.id)
        toast.add({ severity: 'info', summary: t('admin.museums.deleted'), life: 2000 })
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
        <h1 class="vi-page__title">{{ $t('admin.museums.title') }}</h1>
        <p class="vi-page__subtitle">
          {{ $t('admin.museums.subtitle', { shown: filtered.length, total: store.items.length }) }}
        </p>
      </div>
      <div class="vi-page__actions">
        <!-- Le même classeur qu'en « Objets » : il crée musées, salles ET
             œuvres. Une fondation qui démarre part d'ici, pas de la liste des
             œuvres — qui est vide à ce moment-là. -->
        <ImportFonds />
        <Button :label="$t('admin.museums.new')" icon="pi pi-plus" @click="openCreate" />
      </div>
    </div>

    <div class="list-layout">
      <div class="list-main">
        <div v-if="filtered.length" class="vi-grid">
          <article v-for="m in filtered" :key="m.id" class="museum-card">
            <div class="museum-card__media">
              <img v-if="m.photo" :src="m.photo" :alt="m.nom" />
              <div v-else class="museum-card__placeholder"><i class="pi pi-building" /></div>
              <Tag v-if="m.type" :value="m.type" class="museum-card__type" />
              <span v-if="!m.published" class="museum-card__draft">
                <i class="pi pi-eye-slash" /> {{ $t('admin.common.draft') }}
              </span>
              <span v-if="m.partenaire" class="museum-card__partner" :title="$t('admin.museums.federated')">
                <i class="pi pi-link" /> {{ m.partenaire }}
              </span>
            </div>
            <div class="museum-card__body">
              <h3 class="museum-card__name">{{ m.nom }}</h3>
              <div class="museum-card__meta">
                <span v-if="m.anneeFondation">
                  <i class="pi pi-calendar" /> {{ $t('admin.museums.foundedAge', { year: m.anneeFondation, age: age(m.anneeFondation) }) }}
                </span>
                <span><i class="pi pi-sitemap" /> {{ $t('admin.museums.sectorCount', { n: sectorCount(m.id) }) }}</span>
              </div>
              <p class="museum-card__desc">{{ m.description }}</p>
            </div>
            <div class="museum-card__actions">
              <label class="pubtoggle" :title="$t('admin.museums.publishHint')">
                <ToggleSwitch :model-value="m.published" @update:model-value="togglePublished(m)" />
                <span>{{ m.published ? $t('admin.common.online') : $t('admin.common.offline') }}</span>
              </label>
              <span class="museum-card__act-btns">
                <Button :label="$t('admin.common.edit')" icon="pi pi-pencil" size="small" text @click="openEdit(m)" />
                <Button icon="pi pi-trash" size="small" text severity="danger" :aria-label="$t('admin.common.delete')" @click="remove(m)" />
              </span>
            </div>
          </article>
        </div>

        <div v-else class="vi-empty">
          <i class="pi pi-building" />
          <p v-if="store.items.length">{{ $t('admin.museums.emptyFiltered') }}</p>
          <p v-else>{{ $t('admin.museums.empty') }}</p>
          <Button :label="$t('admin.museums.new')" icon="pi pi-plus" @click="openCreate" />
        </div>
      </div>

      <aside class="filters-card">
        <div class="filters-card__title"><i class="pi pi-filter" /> {{ $t('admin.common.filters') }}</div>
        <div class="filters-card__field">
          <label>{{ $t('admin.common.search') }}</label>
          <InputText v-model="draft.search" :placeholder="$t('admin.museums.searchPlaceholder')" @keyup.enter="applyFilters" />
        </div>
        <div class="filters-card__field">
          <label>{{ $t('admin.museums.typeLabel') }}</label>
          <Select v-model="draft.type" :options="MUSEUM_TYPES" show-clear :placeholder="$t('admin.common.all')" />
        </div>
        <div class="filters-card__actions">
          <Button :label="$t('admin.common.filter')" icon="pi pi-search" size="small" @click="applyFilters" />
          <Button :label="$t('admin.common.reset')" icon="pi pi-refresh" size="small" outlined @click="resetFilters" />
        </div>
      </aside>
    </div>

    <MuseumFormDialog v-model:visible="dialogVisible" :museum="editing" />
  </div>
</template>

<style scoped>
.museum-card {
  background: var(--vi-surface);
  border: 1px solid var(--vi-border);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--vi-shadow-sm);
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.museum-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--vi-shadow-md);
  border-color: color-mix(in srgb, var(--p-primary-color) 35%, var(--vi-border));
}
.museum-card__media {
  position: relative;
  height: 160px;
  background: var(--vi-surface-2);
  overflow: hidden;
}
.museum-card__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.35s ease;
}
.museum-card:hover .museum-card__media img {
  transform: scale(1.045);
}
.museum-card__placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vi-muted);
  font-size: 2.5rem;
}
.museum-card__type {
  position: absolute;
  top: 0.6rem;
  left: 0.6rem;
}
.museum-card__partner {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  background: rgba(17, 24, 39, 0.82);
  color: #fff;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.22rem 0.55rem;
  border-radius: 999px;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.museum-card__partner i {
  font-size: 0.62rem;
}
.museum-card__body {
  padding: 0.9rem 1rem 0.4rem;
  flex: 1;
}
.museum-card__name {
  margin: 0 0 0.4rem;
  font-size: 1.1rem;
}
.museum-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  color: var(--vi-muted);
  font-size: 0.78rem;
  margin-bottom: 0.6rem;
}
.museum-card__meta i {
  font-size: 0.75rem;
  margin-right: 0.2rem;
}
.museum-card__desc {
  margin: 0;
  font-size: 0.88rem;
  color: var(--vi-muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.museum-card__actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0.6rem;
  border-top: 1px solid var(--vi-border);
}
.museum-card__act-btns { display: flex; align-items: center; }
.pubtoggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding-left: 0.35rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--vi-muted);
  cursor: pointer;
}
.museum-card__draft {
  position: absolute;
  bottom: 0.6rem;
  left: 0.6rem;
  background: rgba(122, 31, 31, 0.92);
  color: #fff;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.22rem 0.55rem;
  border-radius: 999px;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
</style>
