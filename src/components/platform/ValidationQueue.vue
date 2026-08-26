<script setup>
// FILE DE VALIDATION DU SUPER-ADMIN
//
// Deux décisions lui reviennent, et une seule personne peut les prendre :
//   1. approuver une organisation — tant qu'elle ne l'est pas, son site est
//      introuvable pour le public (policy `tenants_public_read`) ;
//   2. vérifier un domaine personnalisé — le drapeau décide de l'organisation
//      servie à cette adresse.
//
// La seconde ne se coche pas : on interroge le DNS. Voir la fonction de bord
// `verifier-domaine` et la migration 20260821_validation_domaines.sql.
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useAdminTenantStore } from '@/stores/useAdminTenantStore'
import { sendTenantApproved } from '@/services/emailApi'
import { urlPubliqueTenant } from '@/services/host'

const { t } = useI18n()
const store = useAdminTenantStore()
const confirm = useConfirm()
const toast = useToast()

// Diagnostic de la dernière vérification, par organisation : c'est lui qui dit
// au super-admin quoi répondre au client. Un échec sans l'enregistrement attendu
// n'apprend rien à personne.
const diagnostics = ref({})
const enCours = ref(null)

onMounted(() => store.chargerFile())

async function approuver(ligne) {
  confirm.require({
    message: t('platform.validation.confirmApprove', { nom: ligne.nom }),
    header: t('platform.validation.approve'),
    acceptLabel: t('platform.validation.approve'),
    rejectLabel: t('common.cancel'),
    accept: async () => {
      try {
        await store.setStatus(ligne.tenant_id, 'approuve')
        ligne.statut = 'approuve'
        toast.add({ severity: 'success', summary: t('platform.validation.approved'), detail: ligne.nom, life: 2500 })
        // L'organisation doit apprendre que son site est en ligne : sans cet
        // envoi, elle attend sans savoir quoi.
        if (ligne.contact_email) {
          sendTenantApproved({
            to: ligne.contact_email,
            nomOrganisation: ligne.nom,
            tenantId: ligne.tenant_id,
            lien: urlPubliqueTenant(ligne.slug)
          })
        }
      } catch (e) {
        toast.add({ severity: 'error', summary: e.message, life: 4000 })
      }
    }
  })
}

async function refuser(ligne) {
  confirm.require({
    message: t('platform.validation.confirmReject', { nom: ligne.nom }),
    header: t('platform.validation.reject'),
    acceptLabel: t('platform.validation.reject'),
    rejectLabel: t('common.cancel'),
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await store.setStatus(ligne.tenant_id, 'suspendu')
        ligne.statut = 'suspendu'
        toast.add({ severity: 'success', summary: t('platform.validation.rejected'), life: 2500 })
      } catch (e) {
        toast.add({ severity: 'error', summary: e.message, life: 4000 })
      }
    }
  })
}

async function verifier(ligne) {
  enCours.value = ligne.tenant_id
  try {
    const r = await store.verifierDomaine(ligne.tenant_id)
    diagnostics.value = { ...diagnostics.value, [ligne.tenant_id]: r }
    toast.add({
      severity: r.ok ? 'success' : 'warn',
      summary: r.ok ? t('platform.validation.domainOk') : t('platform.validation.domainKo'),
      detail: ligne.custom_domain,
      life: 3500
    })
  } catch (e) {
    toast.add({ severity: 'error', summary: e.message, life: 4000 })
  } finally {
    enCours.value = null
  }
}

// Dérogation : certaines configurations DNS ne se prêtent pas au TXT. Le
// super-admin peut passer outre, mais on le lui fait confirmer — et la base
// garde la trace que ce domaine a été forcé, non prouvé.
async function forcer(ligne) {
  confirm.require({
    message: t('platform.validation.confirmForce', { domaine: ligne.custom_domain }),
    header: t('platform.validation.force'),
    acceptLabel: t('platform.validation.force'),
    rejectLabel: t('common.cancel'),
    acceptClass: 'p-button-warning',
    accept: async () => {
      try {
        await store.setDomainVerified(ligne.tenant_id, true)
        toast.add({ severity: 'success', summary: t('platform.validation.domainForced'), life: 2500 })
      } catch (e) {
        toast.add({ severity: 'error', summary: e.message, life: 4000 })
      }
    }
  })
}

async function copier(texte) {
  try {
    await navigator.clipboard.writeText(texte)
    toast.add({ severity: 'success', summary: t('platform.validation.copied'), life: 1600 })
  } catch {
    toast.add({ severity: 'warn', summary: texte, life: 6000 })
  }
}

function dateFmt(d) {
  return d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
}
</script>

<template>
  <section class="vq">
    <div class="vq__head">
      <h2>{{ $t('platform.validation.title') }}</h2>
      <Button icon="pi pi-refresh" text rounded :loading="store.chargementFile"
              :aria-label="$t('platform.validation.refresh')" @click="store.chargerFile()" />
    </div>

    <p v-if="!store.chargementFile && !store.aValider.length" class="vq__vide">
      <i class="pi pi-check-circle" /> {{ $t('platform.validation.empty') }}
    </p>

    <!-- 1. Organisations en attente d'approbation -->
    <template v-if="store.aApprouver.length">
      <h3 class="vq__sec">{{ $t('platform.validation.pendingOrgs', { n: store.aApprouver.length }) }}</h3>
      <ul class="vq__liste">
        <li v-for="l in store.aApprouver" :key="`t${l.tenant_id}`">
          <span class="vq__main">
            <strong>{{ l.nom }}</strong>
            <span class="vq__meta">{{ urlPubliqueTenant(l.slug).replace(/^https?:\/\//, '') }}</span>
            <span class="vq__meta">{{ l.contact_email || '—' }} · {{ dateFmt(l.created_at) }}</span>
          </span>
          <span class="vq__actions">
            <Button size="small" severity="secondary" outlined :label="$t('platform.validation.reject')"
                    @click="refuser(l)" />
            <Button size="small" icon="pi pi-check" :label="$t('platform.validation.approve')"
                    @click="approuver(l)" />
          </span>
        </li>
      </ul>
    </template>

    <!-- 2. Domaines personnalisés à vérifier -->
    <template v-if="store.domainesAVerifier.length">
      <h3 class="vq__sec">{{ $t('platform.validation.pendingDomains', { n: store.domainesAVerifier.length }) }}</h3>
      <p class="vq__aide">{{ $t('platform.validation.domainHelp') }}</p>
      <ul class="vq__liste">
        <li v-for="l in store.domainesAVerifier" :key="`d${l.tenant_id}`" class="vq__li--col">
          <div class="vq__ligne">
            <span class="vq__main">
              <strong>{{ l.custom_domain }}</strong>
              <span class="vq__meta">{{ l.nom }}</span>
              <span v-if="l.domaine_resultat" class="vq__meta">
                {{ $t('platform.validation.lastTry') }} {{ dateFmt(l.domaine_essaye_le) }} ·
                <Tag :value="l.domaine_resultat" severity="warn" />
              </span>
            </span>
            <span class="vq__actions">
              <Button size="small" severity="secondary" outlined :label="$t('platform.validation.force')"
                      @click="forcer(l)" />
              <Button size="small" icon="pi pi-search" :loading="enCours === l.tenant_id"
                      :label="$t('platform.validation.check')" @click="verifier(l)" />
            </span>
          </div>

          <!-- Ce que le client doit poser chez son hébergeur DNS. Affiché après
               une tentative : avant, il n'y a rien à recopier. -->
          <div v-if="diagnostics[l.tenant_id]" class="vq__diag"
               :class="{ 'vq__diag--ok': diagnostics[l.tenant_id].ok }">
            <template v-if="diagnostics[l.tenant_id].ok">
              <i class="pi pi-check-circle" /> {{ $t('platform.validation.domainOk') }}
            </template>
            <template v-else>
              <p><i class="pi pi-info-circle" /> {{ $t('platform.validation.toCreate') }}</p>
              <code class="vq__dns">
                {{ diagnostics[l.tenant_id].enregistrement?.nom }}
                &nbsp;TXT&nbsp;
                {{ diagnostics[l.tenant_id].enregistrement?.valeur }}
              </code>
              <Button size="small" text icon="pi pi-copy" :label="$t('platform.validation.copy')"
                      @click="copier(`${diagnostics[l.tenant_id].enregistrement?.nom} TXT ${diagnostics[l.tenant_id].enregistrement?.valeur}`)" />
              <p v-if="diagnostics[l.tenant_id].trouve?.length" class="vq__trouve">
                {{ $t('platform.validation.found') }} {{ diagnostics[l.tenant_id].trouve.join(', ') }}
              </p>
              <p v-if="diagnostics[l.tenant_id].routage?.length" class="vq__trouve">
                {{ $t('platform.validation.routing') }} {{ diagnostics[l.tenant_id].routage.join(', ') }}
              </p>
            </template>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.vq { margin-top: 1.5rem; }
.vq__head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.vq__head h2 { font-size: 1.05rem; font-weight: 700; margin: 0; }
.vq__vide { display: flex; align-items: center; gap: 0.5rem; color: var(--text-color-secondary, #6b7280); margin: 0.75rem 0 0; }
.vq__sec { font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-color-secondary, #6b7280); margin: 1.2rem 0 0.6rem; }
.vq__aide { margin: 0 0 0.7rem; font-size: 0.85rem; color: var(--text-color-secondary, #6b7280); }
.vq__liste { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
.vq__liste li { background: var(--surface-card, #fff); border: 1px solid var(--surface-border, #e5e7eb); border-radius: 10px; padding: 0.8rem 1rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.vq__li--col { flex-direction: column; align-items: stretch; }
.vq__ligne { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; width: 100%; }
.vq__main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 220px; }
.vq__meta { font-size: 0.8rem; color: var(--text-color-secondary, #6b7280); }
.vq__actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.vq__diag { margin-top: 0.8rem; padding: 0.75rem 0.9rem; border-radius: 8px; background: #fffbeb; border: 1px solid #f3d99b; font-size: 0.85rem; }
.vq__diag--ok { background: #ecfdf5; border-color: #a7dfc8; }
.vq__diag p { margin: 0 0 0.5rem; }
.vq__dns { display: block; padding: 0.6rem 0.7rem; background: #101210; color: #e8f0ec; border-radius: 6px; font-size: 0.78rem; word-break: break-all; margin-bottom: 0.4rem; }
.vq__trouve { margin: 0.4rem 0 0; color: #7c6218; font-size: 0.8rem; word-break: break-all; }
</style>
