<script setup>
import { formatMontant } from '@/constants/options'
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'
import { useOrderStore } from '@/stores/useOrderStore'
import { useMuseumStore } from '@/stores/useMuseumStore'

const { t } = useI18n()
const store = useOrderStore()
const museumStore = useMuseumStore()
const toast = useToast()
const expanded = ref([])
const statusFilter = ref(null)

onMounted(() => {
  store.load()
  if (!museumStore.items.length) museumStore.load()
})

const fulfillmentOptions = computed(() => [
  { label: t('admin.orders.fNew'), value: 'nouvelle' },
  { label: t('admin.orders.fPrepared'), value: 'preparee' },
  { label: t('admin.orders.fDelivered'), value: 'livree' },
  { label: t('admin.orders.fCancelled'), value: 'annulee' }
])
const FULFILLMENT_SEVERITY = { nouvelle: 'warn', preparee: 'info', livree: 'success', annulee: 'danger' }
const PAY_SEVERITY = { payee: 'success', en_attente: 'warn', echouee: 'danger' }

const rows = computed(() =>
  statusFilter.value ? store.items.filter((o) => o.fulfillment === statusFilter.value) : store.items
)

function money(v, d) { return formatMontant(v, d || 'FCFA') }
function dateFmt(s) { return s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—' }
function museumName(id) { return museumStore.items.find((m) => m.id === id)?.nom || '' }
function fulfillmentLabel(v) { return fulfillmentOptions.value.find((o) => o.value === v)?.label || v }
function payLabel(v) { return t(`admin.orders.pay_${v}`) }
function itemIcon(type) {
  return { don: 'pi pi-heart', assistant_vocal: 'pi pi-volume-up', produit: 'pi pi-shopping-bag' }[type] || 'pi pi-ticket'
}

async function changeFulfillment(order, value) {
  try {
    await store.setFulfillment(order.id, value)
    toast.add({ severity: 'success', summary: t('admin.orders.statusUpdated'), life: 1800 })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.orders.failed'), detail: e.message, life: 3000 })
  }
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('admin.orders.title') }}</h1>
        <p class="vi-page__subtitle">{{ $t('admin.orders.subtitle', { n: store.items.length }) }}</p>
      </div>
      <div class="vi-page__actions">
        <Button icon="pi pi-refresh" :label="$t('admin.orders.refresh')" outlined @click="store.load()" />
      </div>
    </div>

    <!-- Indicateurs -->
    <div class="vi-stats">
      <div class="vi-stat">
        <span class="vi-stat__ic vi-stat__ic--green"><i class="pi pi-wallet" /></span>
        <div class="vi-stat__b"><strong>{{ money(store.revenue) }}</strong><span>{{ $t('admin.orders.statRevenue') }}</span></div>
      </div>
      <div class="vi-stat">
        <span class="vi-stat__ic vi-stat__ic--blue"><i class="pi pi-check-circle" /></span>
        <div class="vi-stat__b"><strong>{{ store.paid.length }}</strong><span>{{ $t('admin.orders.statPaid') }}</span></div>
      </div>
      <div class="vi-stat">
        <span class="vi-stat__ic vi-stat__ic--orange"><i class="pi pi-clock" /></span>
        <div class="vi-stat__b"><strong>{{ store.pendingCount }}</strong><span>{{ $t('admin.orders.statToPrepare') }}</span></div>
      </div>
    </div>

    <div class="vi-toolbar">
      <i class="pi pi-filter" style="color:var(--vi-muted)" />
      <Select v-model="statusFilter" :options="fulfillmentOptions" option-label="label" option-value="value"
        :placeholder="$t('admin.orders.allStatuses')" show-clear style="min-width:210px" />
      <span class="vi-toolbar__grow" />
      <span class="ocount">{{ $t('admin.products.shown', { n: rows.length, total: store.items.length }) }}</span>
    </div>

    <DataTable
      v-model:expanded-rows="expanded"
      :value="rows" data-key="id" paginator :rows="12" :loading="store.loading" removable-sort
    >
      <template #empty>
        <div class="vi-empty">
          <i class="pi pi-receipt" />
          <strong>{{ $t('admin.orders.emptyTitle') }}</strong>
          <p>{{ $t('admin.orders.empty') }}</p>
        </div>
      </template>

      <Column expander style="width:3rem" />
      <Column field="id" :header="$t('admin.orders.colOrder')" sortable>
        <template #body="{ data }">
          <span class="cell-id">
            <strong>#{{ data.id }}</strong>
            <span><i class="pi pi-calendar" /> {{ dateFmt(data.createdAt) }}</span>
          </span>
        </template>
      </Column>
      <Column :header="$t('admin.orders.colItems')" style="width:7.5rem" header-class="num" body-class="num">
        <template #body="{ data }">{{ data.items.length }}</template>
      </Column>
      <Column field="total" :header="$t('admin.orders.colTotal')" sortable style="width:10rem"
        header-class="num" body-class="num">
        <template #body="{ data }"><strong>{{ money(data.total, data.devise) }}</strong></template>
      </Column>
      <Column :header="$t('admin.orders.colPayment')" style="width:9rem">
        <template #body="{ data }">
          <Tag :value="payLabel(data.statut)" :severity="PAY_SEVERITY[data.statut] || 'secondary'" />
        </template>
      </Column>
      <Column :header="$t('admin.orders.colFulfillment')" style="width:14rem">
        <template #body="{ data }">
          <Select
            :model-value="data.fulfillment" :options="fulfillmentOptions"
            option-label="label" option-value="value" size="small" style="width:100%"
            @update:model-value="changeFulfillment(data, $event)"
          />
        </template>
      </Column>

      <template #expansion="{ data }">
        <div class="odetail">
          <h4>{{ $t('admin.orders.detailTitle', { id: data.id }) }}</h4>
          <ul class="oitems">
            <li v-for="i in data.items" :key="i.id">
              <i :class="itemIcon(i.type)" />
              <span class="oitems__label">
                {{ i.label }}
                <small v-if="i.museumId">{{ museumName(i.museumId) }}</small>
              </span>
              <strong>{{ money(i.montant, data.devise) }}</strong>
            </li>
          </ul>
          <p class="odetail__meta">
            <Tag :value="fulfillmentLabel(data.fulfillment)" :severity="FULFILLMENT_SEVERITY[data.fulfillment]" />
            <span v-if="data.paidAt">{{ $t('admin.orders.paidAt', { d: dateFmt(data.paidAt) }) }}</span>
            <span v-if="data.paymentProvider">· {{ data.paymentProvider }}</span>
          </p>
        </div>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
.ocount { font-size: 0.8rem; color: var(--vi-muted); white-space: nowrap; }

.odetail { padding: 0.6rem 1rem 1rem; }
.odetail h4 { margin: 0 0 0.7rem; font-size: 0.95rem; }
.oitems { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.oitems li { display: flex; align-items: center; gap: 0.7rem; background: var(--vi-bg); border-radius: 10px; padding: 0.55rem 0.8rem; }
.oitems li > i { color: var(--vi-muted); }
.oitems__label { flex: 1; }
.oitems__label small { display: block; font-size: 0.75rem; color: var(--vi-muted); }
.odetail__meta { display: flex; align-items: center; gap: 0.6rem; margin: 0.9rem 0 0; font-size: 0.82rem; color: var(--vi-muted); flex-wrap: wrap; }
</style>
