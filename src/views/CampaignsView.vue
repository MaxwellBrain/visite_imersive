<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useCampaignStore } from '@/stores/useCampaignStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { sendCampaignEmail } from '@/services/emailApi'
import CampaignFormDialog from '@/components/campaigns/CampaignFormDialog.vue'

// Campagnes e-mail (V2 Phase 4) : rédaction assistée par IA, destinataires calculés
// par la base (opt-in + adhérents de l'organisation), envoi séquentiel avec bilan.

const { t, locale } = useI18n()
const store = useCampaignStore()
const settings = useSettingsStore()
const auth = useAuthStore()
const confirm = useConfirm()
const toast = useToast()

const dialog = ref(false)
const editing = ref(null)
const sendingId = ref(null)
const progress = ref({ done: 0, total: 0 })

onMounted(() => {
  store.load()
  if (!settings.settings) settings.load(auth.tenantId)
})

const sentCount = computed(() => store.items.filter((c) => c.statut === 'envoyee').length)
const draftCount = computed(() => store.items.filter((c) => c.statut === 'brouillon').length)

function fmt(d) {
  return d ? new Intl.DateTimeFormat(locale.value === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium' }).format(new Date(d)) : '—'
}
function typeLabel(v) {
  return { annonce: t('admin.campaigns.typeAnnonce'), exposition: t('admin.campaigns.typeExposition'), message: t('admin.campaigns.typeMessage') }[v] || v
}
function statutSeverity(s) {
  return { brouillon: 'secondary', envoyee: 'success', echec: 'danger' }[s] || 'secondary'
}

function openCreate() { editing.value = null; dialog.value = true }
function openEdit(c) {
  if (c.statut === 'envoyee') {
    toast.add({ severity: 'info', summary: t('admin.campaigns.sentReadOnly'), life: 2600 })
    return
  }
  editing.value = c
  dialog.value = true
}

function removeCampaign(c) {
  confirm.require({
    message: t('admin.campaigns.deleteConfirm', { name: c.sujet }),
    header: t('admin.campaigns.confirm'), icon: 'pi pi-exclamation-triangle',
    rejectLabel: t('admin.common.cancel'), acceptLabel: t('admin.common.delete'), acceptClass: 'p-button-danger',
    accept: async () => {
      try { await store.remove(c.id); toast.add({ severity: 'info', summary: t('admin.campaigns.deleted'), life: 2000 }) }
      catch (e) { toast.add({ severity: 'error', summary: t('admin.campaigns.failed'), detail: e.message, life: 3500 }) }
    }
  })
}

// Envoi : on demande d'abord les destinataires réels à la base, on confirme le nombre,
// puis on envoie un e-mail par personne. Un échec isolé n'interrompt pas la campagne.
async function sendCampaign(c) {
  if (c.statut === 'envoyee') return
  let list = []
  try {
    list = await store.recipients(c.id)
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.campaigns.failed'), detail: e.message, life: 3500 })
    return
  }
  if (!list.length) {
    toast.add({ severity: 'warn', summary: t('admin.campaigns.noRecipients'), detail: t('admin.campaigns.noRecipientsHint'), life: 4500 })
    return
  }

  confirm.require({
    message: t('admin.campaigns.sendConfirm', { n: list.length }),
    header: t('admin.campaigns.sendHeader'), icon: 'pi pi-send',
    rejectLabel: t('admin.common.cancel'), acceptLabel: t('admin.campaigns.sendNow'),
    accept: async () => {
      sendingId.value = c.id
      progress.value = { done: 0, total: list.length }
      let envoyes = 0
      let echecs = 0
      const base = window.location.origin
      for (const r of list) {
        const ok = await sendCampaignEmail({
          to: r.email,
          prenom: (r.nom || '').trim().split(/\s+/)[0] || '',
          sujet: c.sujet,
          contenu: c.contenu,
          image: c.image,
          lien: c.lien,
          lienTexte: c.lienTexte,
          desinscription: `${base}/site/compte`,
          tenantId: auth.tenantId,
          settings: settings.settings,
          tenant: auth.tenant
        })
        ok ? envoyes++ : echecs++
        progress.value.done++
      }
      try {
        await store.markSent(c.id, { destinataires: list.length, envoyes, echecs })
      } catch (e) {
        console.error('[campaigns] bilan', e.message)
      }
      sendingId.value = null
      if (envoyes) {
        toast.add({ severity: 'success', summary: t('admin.campaigns.sendDone', { n: envoyes }), life: 3500 })
      } else {
        // Cas courant : aucune clé d'envoi posée → la fonction répond { skipped: true }.
        toast.add({ severity: 'warn', summary: t('admin.campaigns.sendNone'), detail: t('admin.campaigns.sendNoneHint'), life: 6000 })
      }
    }
  })
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('admin.campaigns.title') }}</h1>
        <p class="vi-page__subtitle">{{ $t('admin.campaigns.subtitle', { n: store.items.length, s: sentCount }) }}</p>
      </div>
      <Button :label="$t('admin.campaigns.new')" icon="pi pi-plus" @click="openCreate" />
    </div>

    <div class="vi-stats">
      <div class="vi-stat"><span class="vi-stat__label">{{ $t('admin.campaigns.statDrafts') }}</span><strong>{{ draftCount }}</strong></div>
      <div class="vi-stat"><span class="vi-stat__label">{{ $t('admin.campaigns.statSent') }}</span><strong>{{ sentCount }}</strong></div>
    </div>

    <DataTable :value="store.items" data-key="id" striped-rows paginator :rows="10" :loading="store.loading">
      <template #empty>
        <div class="vi-empty">
          <i class="pi pi-send" />
          <strong>{{ $t('admin.campaigns.emptyTitle') }}</strong>
          <p>{{ $t('admin.campaigns.empty') }}</p>
        </div>
      </template>

      <Column field="sujet" :header="$t('admin.campaigns.colSubject')" sortable>
        <template #body="{ data }">
          <div class="c-subject">
            <strong>{{ data.sujet }}</strong>
            <Tag v-if="data.genereParIa" :value="$t('admin.campaigns.aiTag')" severity="info" />
          </div>
        </template>
      </Column>
      <Column :header="$t('admin.campaigns.colType')" style="width:9rem">
        <template #body="{ data }">{{ typeLabel(data.type) }}</template>
      </Column>
      <Column :header="$t('admin.campaigns.colStatus')" style="width:9rem">
        <template #body="{ data }">
          <Tag :value="$t(`admin.campaigns.status_${data.statut}`)" :severity="statutSeverity(data.statut)" />
        </template>
      </Column>
      <Column :header="$t('admin.campaigns.colResult')" style="width:11rem">
        <template #body="{ data }">
          <span v-if="sendingId === data.id" class="c-progress">
            <i class="pi pi-spin pi-spinner" /> {{ progress.done }} / {{ progress.total }}
          </span>
          <span v-else-if="data.statut === 'brouillon'">—</span>
          <span v-else>
            {{ $t('admin.campaigns.resultLine', { e: data.nbEnvoyes, t: data.nbDestinataires }) }}
            <template v-if="data.nbEchecs"> · {{ $t('admin.campaigns.resultFailed', { n: data.nbEchecs }) }}</template>
          </span>
        </template>
      </Column>
      <Column :header="$t('admin.campaigns.colDate')" style="width:10rem">
        <template #body="{ data }">{{ fmt(data.sentAt || data.createdAt) }}</template>
      </Column>
      <Column header="" style="width:10rem">
        <template #body="{ data }">
          <div class="row-actions">
            <Button v-if="data.statut !== 'envoyee'" icon="pi pi-send" text rounded
                    :loading="sendingId === data.id" :aria-label="$t('admin.campaigns.send')"
                    @click="sendCampaign(data)" />
            <Button icon="pi pi-pencil" text rounded :aria-label="$t('admin.common.edit')" @click="openEdit(data)" />
            <Button icon="pi pi-trash" text rounded severity="danger" :aria-label="$t('admin.common.delete')" @click="removeCampaign(data)" />
          </div>
        </template>
      </Column>
    </DataTable>

    <CampaignFormDialog v-model:visible="dialog" :campaign="editing" @saved="store.load()" />
  </div>
</template>

<style scoped>
.c-subject { display: flex; align-items: center; gap: 0.5rem; }
.c-progress { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--vi-muted, #6B7280); }
</style>
