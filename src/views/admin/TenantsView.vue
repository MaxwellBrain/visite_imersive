<script setup>
import { formatMontant } from '@/constants/options'
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useAdminTenantStore } from '@/stores/useAdminTenantStore'
import { sendTenantApproved } from '@/services/emailApi'

// Back-office PLATEFORME : approbation et suivi de toutes les organisations.
// L'accès est doublement verrouillé : garde de route + is_super_admin() en base.
const { t } = useI18n()
const store = useAdminTenantStore()
const confirm = useConfirm()
const toast = useToast()
const statusFilter = ref(null)
const expanded = ref([])

onMounted(() => store.load())

const statusOptions = computed(() => [
  { label: t('admin.tenants.sPending'), value: 'en_attente' },
  { label: t('admin.tenants.sApproved'), value: 'approuve' },
  { label: t('admin.tenants.sSuspended'), value: 'suspendu' }
])
const SEVERITY = { en_attente: 'warn', approuve: 'success', suspendu: 'danger' }
function statusLabel(v) { return statusOptions.value.find((o) => o.value === v)?.label || v }

const rows = computed(() =>
  statusFilter.value ? store.items.filter((x) => x.statut === statusFilter.value) : store.items
)

function money(v) { return formatMontant(v) }
function dateFmt(d) { return d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' }
function publicUrl(slug) { return `${window.location.origin}/c/${slug}` }

async function copyLink(slug) {
  try {
    await navigator.clipboard.writeText(publicUrl(slug))
    toast.add({ severity: 'success', summary: t('admin.tenants.linkCopied'), life: 1800 })
  } catch {
    toast.add({ severity: 'warn', summary: publicUrl(slug), life: 4000 })
  }
}

async function change(tenant, statut) {
  try {
    await store.setStatus(tenant.id, statut)
    toast.add({ severity: 'success', summary: t('admin.tenants.statusUpdated'), detail: tenant.nom, life: 2200 })
    // À l'approbation, on prévient l'organisation que son site est en ligne.
    if (statut === 'approuve' && tenant.contact_email) {
      sendTenantApproved({
        to: tenant.contact_email,
        nomOrganisation: tenant.nom,
        tenantId: tenant.id,
        lien: publicUrl(tenant.slug)
      })
    }
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.tenants.failed'), detail: e.message, life: 3000 })
  }
}

function approve(tenant) {
  confirm.require({
    message: t('admin.tenants.approveConfirm', { nom: tenant.nom, slug: tenant.slug }),
    header: t('admin.tenants.approveHeader'),
    icon: 'pi pi-check-circle',
    rejectLabel: t('admin.common.cancel'),
    acceptLabel: t('admin.tenants.approve'),
    accept: () => change(tenant, 'approuve')
  })
}
function suspend(tenant) {
  confirm.require({
    message: t('admin.tenants.suspendConfirm', { nom: tenant.nom }),
    header: t('admin.tenants.suspendHeader'),
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: t('admin.common.cancel'),
    acceptLabel: t('admin.tenants.suspend'),
    acceptClass: 'p-button-danger',
    accept: () => change(tenant, 'suspendu')
  })
}
async function toggleDomain(tenant) {
  try {
    await store.setDomainVerified(tenant.id, !tenant.domain_verified)
    toast.add({ severity: 'success', summary: t('admin.tenants.domainUpdated'), life: 2000 })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.tenants.failed'), detail: e.message, life: 3000 })
  }
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('admin.tenants.title') }}</h1>
        <p class="vi-page__subtitle">{{ $t('admin.tenants.subtitle', { n: store.items.length }) }}</p>
      </div>
      <div class="vi-page__actions">
        <Select v-model="statusFilter" :options="statusOptions" option-label="label" option-value="value"
          :placeholder="$t('admin.tenants.allStatuses')" show-clear style="min-width:200px" />
        <Button icon="pi pi-refresh" :label="$t('admin.orders.refresh')" outlined @click="store.load()" />
      </div>
    </div>

    <!-- Indicateurs plateforme -->
    <div class="vi-stats">
      <div class="vi-stat">
        <span class="vi-stat__ic vi-stat__ic--orange"><i class="pi pi-clock" /></span>
        <div class="vi-stat__b"><strong>{{ store.pending.length }}</strong><span>{{ $t('admin.tenants.statPending') }}</span></div>
      </div>
      <div class="vi-stat">
        <span class="vi-stat__ic vi-stat__ic--green"><i class="pi pi-check-circle" /></span>
        <div class="vi-stat__b"><strong>{{ store.approved.length }}</strong><span>{{ $t('admin.tenants.statApproved') }}</span></div>
      </div>
      <div class="vi-stat">
        <span class="vi-stat__ic vi-stat__ic--blue"><i class="pi pi-wallet" /></span>
        <div class="vi-stat__b"><strong>{{ money(store.totalRevenue) }}</strong><span>{{ $t('admin.tenants.statRevenue') }}</span></div>
      </div>
    </div>

    <DataTable v-model:expanded-rows="expanded" :value="rows" data-key="id" striped-rows :loading="store.loading" paginator :rows="12">
      <template #empty>
        <div class="vi-empty"><i class="pi pi-sitemap" /><strong>{{ $t('admin.tenants.emptyTitle') }}</strong><p>{{ $t('admin.tenants.empty') }}</p></div>
      </template>

      <Column expander style="width:3rem" />
      <Column :header="$t('admin.tenants.colName')" sortable field="nom">
        <template #body="{ data }">
          <strong>{{ data.nom }}</strong>
          <div class="tslug"><i class="pi pi-link" /> /c/{{ data.slug }}</div>
        </template>
      </Column>
      <Column :header="$t('admin.tenants.colType')" field="type" style="width:9rem">
        <template #body="{ data }"><Tag :value="data.type" severity="secondary" /></template>
      </Column>
      <Column :header="$t('admin.tenants.colStatus')" style="width:9rem">
        <template #body="{ data }"><Tag :value="statusLabel(data.statut)" :severity="SEVERITY[data.statut]" /></template>
      </Column>
      <Column :header="$t('admin.tenants.colContent')" style="width:12rem">
        <template #body="{ data }">
          <span class="tmini"><i class="pi pi-building" /> {{ data.nb_musees }}</span>
          <span class="tmini"><i class="pi pi-box" /> {{ data.nb_objets }}</span>
          <span class="tmini"><i class="pi pi-shopping-bag" /> {{ data.nb_produits }}</span>
        </template>
      </Column>
      <Column :header="$t('admin.tenants.colRevenue')" style="width:9rem">
        <template #body="{ data }"><strong>{{ money(data.ca_total) }}</strong></template>
      </Column>
      <Column header="" style="width:12rem">
        <template #body="{ data }">
          <div class="row-actions">
            <Button icon="pi pi-external-link" text rounded :aria-label="$t('admin.tenants.openSite')"
              @click="copyLink(data.slug)" />
            <Button v-if="data.statut !== 'approuve'" icon="pi pi-check" text rounded severity="success"
              :aria-label="$t('admin.tenants.approve')" @click="approve(data)" />
            <Button v-if="data.statut === 'approuve'" icon="pi pi-ban" text rounded severity="danger"
              :aria-label="$t('admin.tenants.suspend')" @click="suspend(data)" />
          </div>
        </template>
      </Column>

      <template #expansion="{ data }">
        <div class="tdetail">
          <div class="tdetail__grid">
            <div><span>{{ $t('admin.tenants.dLink') }}</span><a :href="publicUrl(data.slug)" target="_blank">{{ publicUrl(data.slug) }}</a></div>
            <div><span>{{ $t('admin.tenants.dEmail') }}</span><strong>{{ data.contact_email || '—' }}</strong></div>
            <div><span>{{ $t('admin.tenants.dPhone') }}</span><strong>{{ data.contact_tel || '—' }}</strong></div>
            <div><span>{{ $t('admin.tenants.dMembers') }}</span><strong>{{ data.nb_membres }}</strong></div>
            <div><span>{{ $t('admin.tenants.dCreated') }}</span><strong>{{ dateFmt(data.created_at) }}</strong></div>
            <div><span>{{ $t('admin.tenants.dApproved') }}</span><strong>{{ dateFmt(data.approved_at) }}</strong></div>
            <div><span>{{ $t('admin.tenants.dOrders') }}</span><strong>{{ data.nb_commandes }}</strong></div>
            <div><span>{{ $t('admin.tenants.dPlan') }}</span><strong>{{ data.plan }}</strong></div>
          </div>

          <div class="tdomain">
            <div>
              <span class="tdomain__lbl">{{ $t('admin.tenants.dDomain') }}</span>
              <strong>{{ data.custom_domain || $t('admin.tenants.noDomain') }}</strong>
              <Tag v-if="data.custom_domain" :value="data.domain_verified ? $t('admin.tenants.verified') : $t('admin.tenants.unverified')"
                :severity="data.domain_verified ? 'success' : 'warn'" style="margin-left:.5rem" />
            </div>
            <Button v-if="data.custom_domain" size="small" outlined
              :label="data.domain_verified ? $t('admin.tenants.unverify') : $t('admin.tenants.verify')"
              @click="toggleDomain(data)" />
          </div>

          <div v-if="data.statut === 'suspendu'" class="treactivate">
            <Button size="small" :label="$t('admin.tenants.reactivate')" icon="pi pi-refresh" @click="change(data, 'approuve')" />
          </div>
        </div>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>

.tslug { font-size: 0.76rem; color: var(--vi-muted); margin-top: 0.15rem; }
.tmini { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.82rem; margin-right: 0.7rem; color: var(--vi-muted); }

.tdetail { padding: 0.6rem 1rem 1rem; }
.tdetail__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.7rem 1.4rem; }
.tdetail__grid > div { display: flex; flex-direction: column; }
.tdetail__grid span { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vi-muted); }
.tdetail__grid a { color: var(--p-primary-color); word-break: break-all; }
.tdomain { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-top: 1rem; padding-top: 0.9rem; border-top: 1px solid var(--vi-border); }
.tdomain__lbl { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vi-muted); }
.treactivate { margin-top: 0.9rem; }
</style>
