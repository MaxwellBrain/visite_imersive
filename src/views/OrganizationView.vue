<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Message from 'primevue/message'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { useAuthStore } from '@/stores/useAuthStore'
import { supabase } from '@/services/supabase'
import { urlPubliqueTenant } from '@/services/host'

const { t } = useI18n()
const auth = useAuthStore()
const toast = useToast()
const saving = ref(false)
const slugState = ref('') // '' | 'checking' | 'free' | 'taken' | 'invalid'

const form = reactive({ nom: '', slug: '', type: 'chefferie', contactEmail: '', contactTel: '', customDomain: '' })

const typeOptions = computed(() => [
  { label: t('admin.org.typeChefferie'), value: 'chefferie' },
  { label: t('admin.org.typeMusee'), value: 'musee' },
  { label: t('admin.org.typeFondation'), value: 'fondation' },
  { label: t('admin.org.typeAssociation'), value: 'association' }
])

function fill() {
  const o = auth.tenant
  if (!o) return
  Object.assign(form, {
    nom: o.nom ?? '',
    slug: o.slug ?? '',
    type: o.type ?? 'chefferie',
    contactEmail: o.contact_email ?? '',
    contactTel: o.contact_tel ?? '',
    customDomain: o.custom_domain ?? ''
  })
}
onMounted(fill)
watch(() => auth.tenant, fill)

// ---------------------------------------------------- domaine personnalisé --
//
// La plateforme n'a aucun moyen de savoir qu'un domaine saisi ici appartient
// vraiment à cette organisation. On demande donc une preuve : un enregistrement
// TXT que seul le détenteur du domaine peut poser. Le jeton est propre à
// l'organisation, secret (table à part, RLS), et régénéré si le domaine change.
const verification = ref(null)
const verifEnCours = ref(false)
const verifResultat = ref(null)

const enregistrementDns = computed(() =>
  verification.value
    ? `_musea.${verification.value.domaine}   TXT   musea-verification=${verification.value.jeton}`
    : '')

async function chargerVerification() {
  if (!auth.tenantId) return
  const { data } = await supabase
    .from('tenant_domain_verification')
    .select('domaine, jeton, dernier_essai, dernier_resultat')
    .eq('tenant_id', auth.tenantId)
    .maybeSingle()
  verification.value = data || null
}
onMounted(chargerVerification)
// Enregistrer un nouveau domaine régénère le jeton : on le relit.
watch(() => auth.tenant?.custom_domain, chargerVerification)

async function copierDns() {
  try {
    await navigator.clipboard.writeText(enregistrementDns.value)
    toast.add({ severity: 'success', summary: t('admin.org.dnsCopied'), life: 1600 })
  } catch {
    toast.add({ severity: 'warn', summary: enregistrementDns.value, life: 8000 })
  }
}

async function verifierMonDomaine() {
  verifEnCours.value = true
  verifResultat.value = null
  try {
    const { data, error } = await supabase.functions.invoke('verifier-domaine', {
      body: { tenantId: auth.tenantId }
    })
    if (error) throw new Error(error.message)
    verifResultat.value = data
    if (data?.ok) await auth.fetchRole() // le drapeau vient de changer
    await chargerVerification()
  } catch (e) {
    toast.add({ severity: 'error', summary: e.message, life: 4000 })
  } finally {
    verifEnCours.value = false
  }
}

// Adresse publique du site de l'organisation : son SOUS-DOMAINE, la seule
// qu'elle ait à communiquer.
const publicUrl = computed(() => urlPubliqueTenant(form.slug) || '…')
// Le site du locataire vit sur un AUTRE hôte : on le quitte l'ERP pour l'ouvrir.
// `router.push` serait resté sur le domaine de la plateforme et n'aurait jamais
// montré l'adresse réelle à celui qui doit la communiquer.
function ouvrirSite() {
  const u = publicUrl.value
  if (u && u !== '…') window.open(u, '_blank', 'noopener')
}

const statut = computed(() => auth.tenant?.statut ?? 'en_attente')
const statutSeverity = { approuve: 'success', en_attente: 'warn', suspendu: 'danger' }

// Vérifie la disponibilité de l'identifiant d'URL (sauf si inchangé).
let slugTimer = null
watch(() => form.slug, (v) => {
  clearTimeout(slugTimer)
  const val = (v || '').trim().toLowerCase()
  if (!val || val === auth.tenant?.slug) { slugState.value = ''; return }
  slugState.value = 'checking'
  slugTimer = setTimeout(async () => {
    const { data, error } = await supabase.rpc('slug_available', { p_slug: val })
    if (error) { slugState.value = ''; return }
    slugState.value = data ? 'free' : (/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$/.test(val) ? 'taken' : 'invalid')
  }, 450)
})

function copyLink() {
  navigator.clipboard?.writeText(publicUrl.value)
  toast.add({ severity: 'success', summary: t('admin.org.linkCopied'), life: 1800 })
}

const canSave = computed(() =>
  form.nom.trim() && form.slug.trim() && slugState.value !== 'taken' && slugState.value !== 'invalid'
)

async function save() {
  if (!canSave.value) return
  saving.value = true
  try {
    await auth.updateTenant({
      nom: form.nom.trim(),
      slug: form.slug.trim().toLowerCase(),
      type: form.type,
      contact_email: form.contactEmail || null,
      contact_tel: form.contactTel || null,
      custom_domain: form.customDomain.trim().toLowerCase() || null
    })
    slugState.value = ''
    toast.add({ severity: 'success', summary: t('admin.org.saved'), life: 2200 })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.org.failed'), detail: e.message, life: 4000 })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('admin.org.title') }}</h1>
        <p class="vi-page__subtitle">{{ $t('admin.org.subtitle') }}</p>
      </div>
      <Button :label="$t('admin.org.save')" icon="pi pi-check" :loading="saving" :disabled="!canSave" @click="save" />
    </div>

    <div v-if="!auth.tenant" class="vi-empty">
      <i class="pi pi-building" />
      <p>{{ $t('admin.org.none') }}</p>
    </div>

    <div v-else class="org">
      <!-- Statut + lien public -->
      <section class="ocard">
        <div class="ocard__head">
          <h2>{{ $t('admin.org.statusTitle') }}</h2>
          <Tag :value="$t(`admin.org.st_${statut}`)" :severity="statutSeverity[statut]" />
        </div>

        <Message v-if="statut === 'en_attente'" severity="warn" :closable="false">
          {{ $t('admin.org.pendingNote') }}
        </Message>
        <Message v-else-if="statut === 'suspendu'" severity="error" :closable="false">
          {{ $t('admin.org.suspendedNote') }}
        </Message>

        <label class="olbl">{{ $t('admin.org.publicLink') }}</label>
        <div class="olink">
          <code>{{ publicUrl }}</code>
          <Button icon="pi pi-copy" text :aria-label="$t('admin.org.copy')" @click="copyLink" />
          <!-- Le site du locataire vit sur un AUTRE hôte : on quitte l'ERP, on
               n'y navigue pas en interne. `$router.push` serait resté sur le
               domaine de la plateforme et n'aurait jamais montré l'adresse réelle. -->
          <Button icon="pi pi-external-link" text :aria-label="$t('admin.org.open')"
            :disabled="statut !== 'approuve'" @click="ouvrirSite" />
        </div>
        <small class="ohint">{{ $t('admin.org.publicLinkHint') }}</small>
      </section>

      <!-- Identité -->
      <section class="ocard">
        <h2>{{ $t('admin.org.identityTitle') }}</h2>
        <div class="vi-field">
          <label>{{ $t('admin.org.fName') }}</label>
          <InputText v-model="form.nom" :placeholder="$t('admin.org.fNamePlaceholder')" />
        </div>
        <div class="vi-field">
          <label>{{ $t('admin.org.fType') }}</label>
          <Select v-model="form.type" :options="typeOptions" option-label="label" option-value="value" />
        </div>
        <div class="vi-field">
          <label>{{ $t('admin.org.fSlug') }}</label>
          <InputText v-model="form.slug" placeholder="bandjoun"
            :invalid="slugState === 'taken' || slugState === 'invalid'" />
          <small v-if="slugState === 'checking'" class="ohint">{{ $t('admin.org.slugChecking') }}</small>
          <small v-else-if="slugState === 'free'" class="ook"><i class="pi pi-check" /> {{ $t('admin.org.slugFree') }}</small>
          <small v-else-if="slugState === 'taken'" class="oerr"><i class="pi pi-times" /> {{ $t('admin.org.slugTaken') }}</small>
          <small v-else-if="slugState === 'invalid'" class="oerr"><i class="pi pi-times" /> {{ $t('admin.org.slugInvalid') }}</small>
          <small v-else class="ohint">{{ $t('admin.org.slugHint') }}</small>
        </div>
        <div class="vi-row">
          <div class="vi-field">
            <label>{{ $t('admin.org.fEmail') }}</label>
            <InputText v-model="form.contactEmail" />
          </div>
          <div class="vi-field">
            <label>{{ $t('admin.org.fPhone') }}</label>
            <InputText v-model="form.contactTel" />
          </div>
        </div>
      </section>

      <!-- Domaine personnalisé -->
      <section class="ocard">
        <h2>{{ $t('admin.org.domainTitle') }}</h2>
        <p class="ocard__lead">{{ $t('admin.org.domainLead') }}</p>
        <div class="vi-field">
          <label>{{ $t('admin.org.fDomain') }}</label>
          <InputText v-model="form.customDomain" placeholder="chefferie-bandjoun.cm" />
          <small class="ohint">{{ $t('admin.org.domainHint') }}</small>
        </div>
        <Message v-if="auth.tenant?.domain_verified" severity="success" :closable="false">
          {{ $t('admin.org.domainVerified') }}
        </Message>

        <!-- PREUVE DE POSSESSION — sans cet enregistrement, la vérification ne
             peut pas aboutir : la plateforme n'a aucun moyen de savoir que ce
             domaine est bien le vôtre. Le jeton est propre à l'organisation et
             change si le domaine change. -->
        <template v-else-if="verification">
          <Message severity="info" :closable="false">{{ $t('admin.org.domainPending') }}</Message>
          <p class="ohint" style="margin-top:.9rem">{{ $t('admin.org.dnsToCreate') }}</p>
          <code class="odns">{{ enregistrementDns }}</code>
          <div class="odns__act">
            <Button size="small" text icon="pi pi-copy" :label="$t('admin.org.dnsCopy')"
                    @click="copierDns" />
            <Button size="small" outlined icon="pi pi-search" :loading="verifEnCours"
                    :label="$t('admin.org.dnsCheck')" @click="verifierMonDomaine" />
          </div>
          <Message v-if="verifResultat" :severity="verifResultat.ok ? 'success' : 'warn'" :closable="false">
            {{ verifResultat.ok ? $t('admin.org.dnsOk') : $t('admin.org.dnsKo') }}
          </Message>
          <small v-if="verification.dernier_essai" class="ohint">
            {{ $t('admin.org.dnsLastTry') }} {{ new Date(verification.dernier_essai).toLocaleString('fr-FR') }}
          </small>
        </template>

        <Message v-else-if="form.customDomain" severity="info" :closable="false">
          {{ $t('admin.org.dnsSaveFirst') }}
        </Message>
      </section>
    </div>
  </div>
</template>

<style scoped>
.org { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1.25rem; align-items: start; }
.ocard { background: var(--vi-surface); border: 1px solid var(--vi-border); border-radius: 16px; padding: 1.15rem 1.25rem 1.35rem; box-shadow: var(--vi-shadow-sm); }
.ocard h2 { font-size: 1.05rem; margin: 0 0 1rem; }
.ocard__head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.9rem; }
.ocard__head h2 { margin: 0; }
.ocard__lead { margin: -0.4rem 0 1rem; font-size: 0.88rem; color: var(--vi-muted); line-height: 1.55; }

.olbl { display: block; font-size: 0.85rem; font-weight: 600; margin: 1rem 0 0.45rem; }
.olink { display: flex; align-items: center; gap: 0.35rem; background: var(--vi-bg); border: 1px solid var(--vi-border); border-radius: 10px; padding: 0.5rem 0.5rem 0.5rem 0.85rem; }
.olink code { flex: 1; font-size: 0.88rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ohint { display: block; font-size: 0.78rem; color: var(--vi-muted); margin-top: 0.35rem; }
.ook { display: block; font-size: 0.78rem; color: #0e6f5c; font-weight: 600; margin-top: 0.35rem; }
.oerr { display: block; font-size: 0.78rem; color: #c0392b; font-weight: 600; margin-top: 0.35rem; }

/* Enregistrement DNS à recopier : il doit se lire caractère par caractère,
   d'où la police à chasse fixe et la coupure autorisée en fin de ligne. */
.odns { display: block; margin: 0.5rem 0; padding: 0.7rem 0.8rem; background: #101210; color: #e8f0ec; border-radius: 6px; font-family: ui-monospace, 'Cascadia Code', Consolas, monospace; font-size: 0.78rem; line-height: 1.6; word-break: break-all; }
.odns__act { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
</style>
