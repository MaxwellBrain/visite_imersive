<script setup>
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import { useRouter } from 'vue-router'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useObjectStore } from '@/stores/useObjectStore'
import { useSectorStore } from '@/stores/useSectorStore'
import { useMuseumStore } from '@/stores/useMuseumStore'
import ObjectFormDialog from '@/components/objects/ObjectFormDialog.vue'
import Object3DViewer from '@/components/objects/Object3DViewer.vue'

const { t } = useI18n()
const store = useObjectStore()
const sectorStore = useSectorStore()
const museumStore = useMuseumStore()
const confirm = useConfirm()
const toast = useToast()
const router = useRouter()

const dialogVisible = ref(false)
const editing = ref(null)
const viewer = reactive({ visible: false, src: '', title: '' })

const museumOptions = computed(() => museumStore.items.map((m) => ({ label: m.nom, value: m.id })))
const statusOptions = computed(() => [
  { label: t('admin.common.published'), value: 'published' },
  { label: t('admin.common.draft'), value: 'draft' }
])

const draft = reactive({ search: '', statut: null, museumId: null })
const applied = reactive({ search: '', statut: null, museumId: null })

const filtered = computed(() => {
  const q = applied.search.trim().toLowerCase()
  return store.items.filter((o) => {
    const okQ =
      !q || o.nom.toLowerCase().includes(q) || (o.nomCommun || '').toLowerCase().includes(q)
    const okS =
      !applied.statut || (applied.statut === 'published' ? o.published : !o.published)
    const museumId = sectorStore.getById(o.sectorId)?.museumId
    const okM = applied.museumId == null || museumId === applied.museumId
    return okQ && okS && okM
  })
})

function applyFilters() {
  Object.assign(applied, draft)
}
function resetFilters() {
  Object.assign(draft, { search: '', statut: null, museumId: null })
  Object.assign(applied, { search: '', statut: null, museumId: null })
}

function openCreate() {
  editing.value = null
  dialogVisible.value = true
}
function openEdit(obj) {
  editing.value = obj
  dialogVisible.value = true
}
function locationLabel(obj) {
  const sector = sectorStore.getById(obj.sectorId)
  if (!sector) return t('admin.objects.sectorDeleted')
  const museum = museumStore.getById(sector.museumId)
  return `${museum?.nom ?? '—'} › ${sector.nom}`
}
function view3d(obj) {
  viewer.src = obj.model3d || ''
  viewer.title = obj.nom
  viewer.visible = true
}
async function togglePublish(obj) {
  const nowPublished = !obj.published
  try {
    await store.togglePublished(obj.id)
    toast.add({
      severity: nowPublished ? 'success' : 'info',
      summary: nowPublished ? t('admin.objects.published') : t('admin.objects.backToDraft'),
      life: 1800
    })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.objects.failed'), detail: e.message, life: 3000 })
  }
}
function remove(obj) {
  confirm.require({
    message: t('admin.objects.deleteConfirm', { name: obj.nom }),
    header: t('admin.common.confirmDelete'),
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: t('admin.common.cancel'),
    acceptLabel: t('admin.common.delete'),
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await store.remove(obj.id)
        toast.add({ severity: 'info', summary: t('admin.objects.deleted'), life: 2000 })
      } catch (e) {
        toast.add({ severity: 'error', summary: t('admin.common.deleteFailed'), detail: e.message, life: 3000 })
      }
    }
  })
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('admin.objects.title') }}</h1>
        <p class="vi-page__subtitle">
          {{ $t('admin.objects.subtitle', { shown: filtered.length, total: store.items.length }) }}
        </p>
      </div>
      <Button :label="$t('admin.objects.new')" icon="pi pi-plus" @click="openCreate" />
    </div>

    <div class="list-layout">
      <div class="list-main">
        <div v-if="filtered.length" class="vi-grid">
          <article v-for="o in filtered" :key="o.id" class="obj-card">
            <div class="obj-card__media">
              <img v-if="o.photoThumb || o.photo" :src="o.photoThumb || o.photo" :alt="o.nom" />
              <div v-else class="obj-card__placeholder"><i class="pi pi-box" /></div>
              <Tag
                :value="o.published ? $t('admin.common.published') : $t('admin.common.draft')"
                :severity="o.published ? 'success' : 'warn'"
                class="obj-card__status"
              />
              <span v-if="o.model3d" class="obj-card__badge3d" :title="$t('admin.objects.has3d')">
                <i class="pi pi-box" /> 3D
              </span>
            </div>
            <div class="obj-card__body">
              <h3 class="obj-card__name">{{ o.nom }}</h3>
              <p v-if="o.nomCommun" class="obj-card__common">{{ o.nomCommun }}</p>
              <p class="obj-card__loc"><i class="pi pi-sitemap" /> {{ locationLabel(o) }}</p>
            </div>
            <div class="obj-card__actions">
              <Button
                :icon="o.published ? 'pi pi-eye-slash' : 'pi pi-globe'"
                :label="o.published ? $t('admin.common.unpublish') : $t('admin.common.publish')"
                size="small"
                text
                @click="togglePublish(o)"
              />
              <div class="obj-card__actions-right">
                <Button icon="pi pi-id-card" size="small" text :aria-label="$t('admin.objects.detail')" v-tooltip.top="$t('admin.objects.detail')" @click="router.push('/objets/' + o.id)" />
                <Button icon="pi pi-box" size="small" text :aria-label="$t('admin.objects.view3d')" v-tooltip.top="$t('admin.objects.view3d')" @click="view3d(o)" />
                <Button icon="pi pi-pencil" size="small" text @click="openEdit(o)" />
                <Button icon="pi pi-trash" size="small" text severity="danger" @click="remove(o)" />
              </div>
            </div>
          </article>
        </div>

        <div v-else class="vi-empty">
          <i class="pi pi-box" />
          <p v-if="store.items.length">{{ $t('admin.objects.emptyFiltered') }}</p>
          <p v-else>{{ $t('admin.objects.empty') }}</p>
          <Button :label="$t('admin.objects.new')" icon="pi pi-plus" @click="openCreate" />
        </div>
      </div>

      <aside class="filters-card">
        <div class="filters-card__title"><i class="pi pi-filter" /> {{ $t('admin.common.filters') }}</div>
        <div class="filters-card__field">
          <label>{{ $t('admin.common.search') }}</label>
          <InputText v-model="draft.search" :placeholder="$t('admin.objects.searchPlaceholder')" @keyup.enter="applyFilters" />
        </div>
        <div class="filters-card__field">
          <label>{{ $t('admin.objects.statusLabel') }}</label>
          <Select
            v-model="draft.statut"
            :options="statusOptions"
            option-label="label"
            option-value="value"
            show-clear
            :placeholder="$t('admin.common.all')"
          />
        </div>
        <div class="filters-card__field">
          <label>{{ $t('admin.objects.museumLabel') }}</label>
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

    <ObjectFormDialog v-model:visible="dialogVisible" :object="editing" />
    <Object3DViewer v-model:visible="viewer.visible" :src="viewer.src" :title="viewer.title" />
  </div>
</template>

<style scoped>
.obj-card {
  background: var(--vi-surface);
  border: 1px solid var(--vi-border);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--vi-shadow-sm);
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.obj-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--vi-shadow-md);
  border-color: color-mix(in srgb, var(--p-primary-color) 35%, var(--vi-border));
}
.obj-card__media {
  position: relative;
  height: 170px;
  background: var(--vi-surface-2);
  overflow: hidden;
}
.obj-card__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.35s ease;
}
.obj-card:hover .obj-card__media img {
  transform: scale(1.045);
}
.obj-card__placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vi-muted);
  font-size: 2.5rem;
}
.obj-card__status {
  position: absolute;
  top: 0.6rem;
  left: 0.6rem;
}
.obj-card__badge3d {
  position: absolute;
  bottom: 0.6rem;
  right: 0.6rem;
  background: rgba(17, 24, 39, 0.8);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
}
.obj-card__body {
  padding: 0.85rem 1rem 0.3rem;
  flex: 1;
}
.obj-card__name {
  margin: 0 0 0.2rem;
  font-size: 1.05rem;
}
.obj-card__common {
  margin: 0 0 0.4rem;
  font-size: 0.82rem;
  font-style: italic;
  color: var(--vi-muted);
}
.obj-card__loc {
  margin: 0;
  font-size: 0.78rem;
  color: var(--vi-muted);
}
.obj-card__loc i {
  font-size: 0.72rem;
  margin-right: 0.25rem;
}
.obj-card__actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.3rem 0.5rem;
  border-top: 1px solid var(--vi-border);
}
.obj-card__actions-right {
  display: flex;
  gap: 0.1rem;
}
</style>
