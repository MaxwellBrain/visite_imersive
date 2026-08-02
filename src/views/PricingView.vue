<script setup>
import { reactive, ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import { useToast } from 'primevue/usetoast'
import { usePricingStore } from '@/stores/usePricingStore'
import { useObjectStore } from '@/stores/useObjectStore'
import { VISIT_TYPES, CURRENCIES, formatMontant } from '@/constants/options'

const { t } = useI18n()
const pricing = usePricingStore()
const objectStore = useObjectStore()
const toast = useToast()

const activeTab = ref('0')

const objectNameOptions = computed(() => [
  t('admin.pricing.allObjects'),
  ...objectStore.items.map((o) => o.nom)
])

/* ---- Dialog : tarif objet ---- */
const tariffDialog = ref(false)
const tariffForm = reactive({ objectLabel: '', typeVisite: 'Visite guidée', dureeMin: 30, prix: 0, devise: 'FCFA' })

function openTariff() {
  Object.assign(tariffForm, { objectLabel: '', typeVisite: 'Visite guidée', dureeMin: 30, prix: 0, devise: 'FCFA' })
  tariffDialog.value = true
}
async function saveTariff() {
  if (!tariffForm.objectLabel) {
    toast.add({ severity: 'warn', summary: t('admin.pricing.needObject'), life: 2500 })
    return
  }
  try {
    await pricing.addObjectTariff({ ...tariffForm })
    tariffDialog.value = false
    toast.add({ severity: 'success', summary: t('admin.pricing.tariffAdded'), life: 2000 })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.pricing.failed'), detail: e.message, life: 3000 })
  }
}

/* ---- Dialog : palier de donation ---- */
const donationDialog = ref(false)
const donationForm = reactive({ label: '', montant: 20, devise: 'FCFA', description: '' })

function openDonation() {
  Object.assign(donationForm, { label: '', montant: 20, devise: 'FCFA', description: '' })
  donationDialog.value = true
}
async function saveDonation() {
  if (!donationForm.label.trim()) {
    toast.add({ severity: 'warn', summary: t('admin.pricing.needTier'), life: 2500 })
    return
  }
  try {
    await pricing.addDonationTier({ ...donationForm })
    donationDialog.value = false
    toast.add({ severity: 'success', summary: t('admin.pricing.tierAdded'), life: 2000 })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.pricing.failed'), detail: e.message, life: 3000 })
  }
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('admin.pricing.title') }}</h1>
        <p class="vi-page__subtitle">
          {{ $t('admin.pricing.subtitle') }}
        </p>
      </div>
    </div>

    <Tabs v-model:value="activeTab">
      <TabList>
        <Tab value="0"><i class="pi pi-box" /> {{ $t('admin.pricing.tabObjects') }}</Tab>
        <Tab value="1"><i class="pi pi-heart" /> {{ $t('admin.pricing.tabDonations') }}</Tab>
      </TabList>

      <TabPanels>
        <!-- TARIFS OBJETS -->
        <TabPanel value="0">
          <div class="tab-toolbar">
            <span class="tab-toolbar__hint">
              {{ $t('admin.pricing.objectsHint') }}
            </span>
            <Button :label="$t('admin.pricing.addTariff')" icon="pi pi-plus" size="small" @click="openTariff" />
          </div>

          <DataTable :value="pricing.objectTariffs" data-key="id" striped-rows>
            <template #empty>
              <div class="vi-empty"><i class="pi pi-euro" /><strong>{{ $t('admin.pricing.emptyTariffsTitle') }}</strong><p>{{ $t('admin.pricing.emptyTariffs') }}</p></div>
            </template>
            <Column field="objectLabel" :header="$t('admin.pricing.colObject')" sortable />
            <Column field="typeVisite" :header="$t('admin.pricing.colVisitType')">
              <template #body="{ data }"><Tag :value="data.typeVisite" severity="info" /></template>
            </Column>
            <Column field="dureeMin" :header="$t('admin.pricing.colDuration')">
              <template #body="{ data }">{{ data.dureeMin ? data.dureeMin + ' min' : '—' }}</template>
            </Column>
            <Column field="prix" :header="$t('admin.pricing.colPrice')" sortable>
              <template #body="{ data }">
                <strong>{{ data.prix === 0 ? $t('admin.pricing.free') : `${data.prix} ${data.devise}` }}</strong>
              </template>
            </Column>
            <Column header="" style="width: 4rem">
              <template #body="{ data }">
                <Button
                  icon="pi pi-trash"
                  text
                  size="small"
                  severity="danger"
                  @click="pricing.removeObjectTariff(data.id)"
                />
              </template>
            </Column>
          </DataTable>
        </TabPanel>

        <!-- TARIFS DONATION -->
        <TabPanel value="1">
          <Message severity="info" :closable="false" class="donation-note">
            {{ $t('admin.pricing.donationNote') }}
          </Message>
          <div class="tab-toolbar">
            <span class="tab-toolbar__hint">{{ $t('admin.pricing.donationsHint') }}</span>
            <Button :label="$t('admin.pricing.addTier')" icon="pi pi-plus" size="small" @click="openDonation" />
          </div>

          <DataTable :value="pricing.donationTiers" data-key="id" striped-rows>
            <template #empty>
              <div class="vi-empty"><i class="pi pi-heart" /><strong>{{ $t('admin.pricing.emptyTiersTitle') }}</strong><p>{{ $t('admin.pricing.emptyTiers') }}</p></div>
            </template>
            <Column field="label" :header="$t('admin.pricing.colTier')" sortable />
            <Column field="montant" :header="$t('admin.pricing.colAmount')" sortable>
              <template #body="{ data }"><strong>{{ formatMontant(data.montant, data.devise) }}</strong></template>
            </Column>
            <Column field="description" :header="$t('admin.pricing.colBenefit')" />
            <Column header="" style="width: 4rem">
              <template #body="{ data }">
                <Button
                  icon="pi pi-trash"
                  text
                  size="small"
                  severity="danger"
                  @click="pricing.removeDonationTier(data.id)"
                />
              </template>
            </Column>
          </DataTable>
        </TabPanel>
      </TabPanels>
    </Tabs>

    <!-- Dialog tarif objet -->
    <Dialog v-model:visible="tariffDialog" modal :header="$t('admin.pricing.tariffDialogTitle')" :style="{ width: '32rem', maxWidth: '95vw' }">
      <div class="vi-field">
        <label>{{ $t('admin.pricing.fObject') }}</label>
        <Select
          v-model="tariffForm.objectLabel"
          :options="objectNameOptions"
          editable
          :placeholder="$t('admin.pricing.fObjectPlaceholder')"
        />
      </div>
      <div class="vi-field">
        <label>{{ $t('admin.pricing.fVisitType') }}</label>
        <Select v-model="tariffForm.typeVisite" :options="VISIT_TYPES" />
      </div>
      <div class="vi-row">
        <div class="vi-field">
          <label>{{ $t('admin.pricing.fDuration') }}</label>
          <InputNumber v-model="tariffForm.dureeMin" :min="0" :max="600" />
        </div>
        <div class="vi-field">
          <label>{{ $t('admin.pricing.fPrice') }}</label>
          <InputNumber v-model="tariffForm.prix" :min="0" :max="100000" :min-fraction-digits="0" :max-fraction-digits="2" />
        </div>
        <div class="vi-field" style="flex: 0 1 110px">
          <label>{{ $t('admin.pricing.fCurrency') }}</label>
          <Select v-model="tariffForm.devise" :options="CURRENCIES" />
        </div>
      </div>
      <template #footer>
        <Button :label="$t('admin.common.cancel')" severity="secondary" text @click="tariffDialog = false" />
        <Button :label="$t('admin.common.add')" icon="pi pi-check" @click="saveTariff" />
      </template>
    </Dialog>

    <!-- Dialog palier donation -->
    <Dialog v-model:visible="donationDialog" modal :header="$t('admin.pricing.donationDialogTitle')" :style="{ width: '32rem', maxWidth: '95vw' }">
      <div class="vi-row">
        <div class="vi-field" style="flex: 2 1 200px">
          <label>{{ $t('admin.pricing.fTierName') }}</label>
          <InputText v-model="donationForm.label" :placeholder="$t('admin.pricing.fTierPlaceholder')" />
        </div>
        <div class="vi-field">
          <label>{{ $t('admin.pricing.fAmount') }}</label>
          <InputNumber v-model="donationForm.montant" :min="0" :max="1000000" />
        </div>
        <div class="vi-field" style="flex: 0 1 110px">
          <label>{{ $t('admin.pricing.fCurrency') }}</label>
          <Select v-model="donationForm.devise" :options="CURRENCIES" />
        </div>
      </div>
      <div class="vi-field">
        <label>{{ $t('admin.pricing.fBenefit') }}</label>
        <Textarea v-model="donationForm.description" rows="3" auto-resize :placeholder="$t('admin.pricing.fBenefitPlaceholder')" />
      </div>
      <template #footer>
        <Button :label="$t('admin.common.cancel')" severity="secondary" text @click="donationDialog = false" />
        <Button :label="$t('admin.common.add')" icon="pi pi-check" @click="saveDonation" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.tab-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 0.75rem 0 1rem;
  flex-wrap: wrap;
}
.tab-toolbar__hint {
  color: var(--vi-muted);
  font-size: 0.85rem;
}
.donation-note {
  margin-bottom: 0.5rem;
}
</style>
