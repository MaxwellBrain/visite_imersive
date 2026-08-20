<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { sendTenantWelcome } from '@/services/emailApi'
import { urlPubliqueTenant } from '@/services/host'
import '@/assets/public-site.css'

// Inscription d'une organisation : compte → création du tenant (statut « en attente »).
const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

// 1 = compte · 2 = identité de l'organisation · 3 = coordonnées & responsable · 4 = confirmation
const step = ref(1)
const busy = ref(false)
const error = ref('')
const slugState = ref('')    // '' | checking | free | taken | invalid

const account = reactive({ email: '', password: '', fullName: '' })
const org = reactive({
  // Identité (étape 2)
  nom: '', slug: '', type: 'chefferie', sigle: '', description: '', anneeCreation: '', siteWeb: '',
  // Coordonnées & responsable (étape 3) — tout est facultatif, l'espace se crée sans.
  contactEmail: '', contactTel: '',
  pays: 'Cameroun', region: '', ville: '', adresse: '',
  responsableNom: '', responsableFonction: '', responsableEmail: '', responsableTel: '',
  registreNumero: '', langueDefaut: 'fr', devise: 'FCFA'
})

const langueOptions = computed(() => [
  { label: t('signup.langFr'), value: 'fr' },
  { label: t('signup.langEn'), value: 'en' }
])
const deviseOptions = ['FCFA', '€', '$', '£']

const typeOptions = computed(() => [
  { label: t('admin.org.typeChefferie'), value: 'chefferie' },
  { label: t('admin.org.typeMusee'), value: 'musee' },
  { label: t('admin.org.typeFondation'), value: 'fondation' },
  { label: t('admin.org.typeAssociation'), value: 'association' }
])

onMounted(async () => {
  await auth.ensureReady()
  // Déjà connecté : on passe directement à la création de l'organisation.
  if (auth.user) {
    if (auth.tenantId) { step.value = 4; return } // possède déjà une organisation
    account.email = auth.user.email || ''
    account.fullName = auth.user.user_metadata?.full_name || ''
    step.value = 2
  }
})

// Propose un identifiant d'URL à partir du nom saisi.
watch(() => org.nom, (v) => {
  if (!v) return
  const auto = v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  if (!org.slug || org.slug === lastAuto) { org.slug = auto; lastAuto = auto }
})
let lastAuto = ''

let slugTimer = null
watch(() => org.slug, (v) => {
  clearTimeout(slugTimer)
  const val = (v || '').trim().toLowerCase()
  if (!val) { slugState.value = ''; return }
  slugState.value = 'checking'
  slugTimer = setTimeout(async () => {
    const { data, error: e } = await supabase.rpc('slug_available', { p_slug: val })
    if (e) { slugState.value = ''; return }
    slugState.value = data ? 'free' : (/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])$/.test(val) ? 'taken' : 'invalid')
  }, 450)
})

// L'adresse ANNONCÉE est le sous-domaine — `musee-odz.nexacode.store` — et non
// le chemin `/c/musee-odz`. C'est celle que l'organisation imprimera et
// partagera : lui montrer un chemin donnait l'impression qu'elle n'a pas de
// site à elle. Le joker DNS répond déjà pour n'importe quel nom : rien n'est à
// créer dans AWS au moment de l'inscription.
const publicUrl = computed(() => urlPubliqueTenant(org.slug) || '…')
const canCreateAccount = computed(() => account.email.includes('@') && account.password.length >= 6)
// Seuls le nom et l'adresse publique sont obligatoires : tout le reste peut être
// complété plus tard depuis « Mon organisation », pour ne pas décourager l'inscription.
const canCreateOrg = computed(() => org.nom.trim() && org.slug.trim() && slugState.value === 'free')

function goToContacts() {
  error.value = ''
  if (!canCreateOrg.value) { error.value = t('signup.errOrg'); return }
  // Pré-remplissage courtois : le responsable, c'est souvent la personne qui s'inscrit.
  if (!org.contactEmail) org.contactEmail = account.email.trim()
  if (!org.responsableNom) org.responsableNom = account.fullName.trim()
  if (!org.responsableEmail) org.responsableEmail = org.contactEmail
  step.value = 3
}

async function createAccount() {
  error.value = ''
  if (!canCreateAccount.value) { error.value = t('signup.errAccount'); return }
  busy.value = true
  try {
    await auth.signUp(account.email.trim(), account.password, account.fullName.trim())
    if (!org.contactEmail) org.contactEmail = account.email.trim()
    step.value = 2
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

async function createOrg() {
  error.value = ''
  if (!canCreateOrg.value) { error.value = t('signup.errOrg'); return }
  busy.value = true
  try {
    // Le profil détaillé part dans la même transaction que la création (RPC), pour
    // qu'aucune organisation ne puisse exister à moitié renseignée.
    const { data, error: e } = await supabase.rpc('create_tenant', {
      p_nom: org.nom.trim(),
      p_slug: org.slug.trim().toLowerCase(),
      p_type: org.type,
      p_email: org.contactEmail || null,
      p_tel: org.contactTel || null,
      p_profil: {
        sigle: org.sigle,
        description: org.description,
        site_web: org.siteWeb,
        annee_creation: org.anneeCreation,
        pays: org.pays,
        region: org.region,
        ville: org.ville,
        adresse: org.adresse,
        responsable_nom: org.responsableNom,
        responsable_fonction: org.responsableFonction,
        responsable_email: org.responsableEmail,
        responsable_tel: org.responsableTel,
        registre_numero: org.registreNumero,
        langue_defaut: org.langueDefaut,
        devise: org.devise
      }
    })
    if (e) throw e
    const r = (data && data[0]) || {}
    if (!r.ok) { error.value = t(`signup.err_${r.reason}`); return }
    await auth.fetchRole() // récupère le nouveau rôle admin + tenant
    step.value = 4
    // Accusé de création (l'espace attend encore la validation du super-admin).
    sendTenantWelcome({
      to: org.contactEmail || account.email,
      nomOrganisation: org.nom.trim(),
      lien: `${window.location.origin}/dashboard`
    })
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="su" style="--site-primary:#0e6f5c">
    <header class="su-top">
      <router-link to="/" class="su-logo"><span class="su-logo__mark">M</span> MUSÉA</router-link>
    </header>

    <main class="su-main">
      <!-- Fil d'étapes -->
      <ol class="su-steps">
        <li :class="{ on: step >= 1, done: step > 1 }"><span>1</span> {{ $t('signup.step1') }}</li>
        <li :class="{ on: step >= 2, done: step > 2 }"><span>2</span> {{ $t('signup.step2') }}</li>
        <li :class="{ on: step >= 3, done: step > 3 }"><span>3</span> {{ $t('signup.step3') }}</li>
        <li :class="{ on: step >= 4 }"><span>4</span> {{ $t('signup.step4') }}</li>
      </ol>

      <!-- Étape 1 : compte -->
      <section v-if="step === 1" class="su-card ps-card">
        <h1>{{ $t('signup.title1') }}</h1>
        <p class="su-lead">{{ $t('signup.lead1') }}</p>

        <label class="su-lbl">{{ $t('signup.fFullName') }}</label>
        <input v-model="account.fullName" class="su-in" type="text" :placeholder="$t('signup.fFullNamePlaceholder')" />

        <label class="su-lbl">{{ $t('signup.fEmail') }}</label>
        <input v-model="account.email" class="su-in" type="email" placeholder="vous@exemple.cm" />

        <label class="su-lbl">{{ $t('signup.fPassword') }}</label>
        <input v-model="account.password" class="su-in" type="password" :placeholder="$t('signup.fPasswordPlaceholder')" />

        <p v-if="error" class="su-err"><i class="pi pi-exclamation-triangle" /> {{ error }}</p>
        <button class="ps-btn su-btn" :disabled="busy || !canCreateAccount" @click="createAccount">
          <i :class="busy ? 'pi pi-spin pi-spinner' : 'pi pi-arrow-right'" /> {{ $t('signup.next') }}
        </button>
        <p class="su-alt">
          {{ $t('signup.haveAccount') }} <router-link to="/login" class="ps-link">{{ $t('signup.login') }}</router-link>
        </p>
      </section>

      <!-- Étape 2 : organisation -->
      <section v-else-if="step === 2" class="su-card ps-card">
        <h1>{{ $t('signup.title2') }}</h1>
        <p class="su-lead">{{ $t('signup.lead2') }}</p>

        <label class="su-lbl">{{ $t('signup.fOrgName') }}</label>
        <input v-model="org.nom" class="su-in" type="text" :placeholder="$t('admin.org.fNamePlaceholder')" />

        <label class="su-lbl">{{ $t('signup.fType') }}</label>
        <select v-model="org.type" class="su-in">
          <option v-for="o in typeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>

        <label class="su-lbl">{{ $t('signup.fSlug') }}</label>
        <input v-model="org.slug" class="su-in" type="text" placeholder="bandjoun" />
        <div class="su-url"><i class="pi pi-link" /> <code>{{ publicUrl }}</code></div>
        <small v-if="slugState === 'checking'" class="su-hint">{{ $t('admin.org.slugChecking') }}</small>
        <small v-else-if="slugState === 'free'" class="su-ok"><i class="pi pi-check" /> {{ $t('admin.org.slugFree') }}</small>
        <small v-else-if="slugState === 'taken'" class="su-bad"><i class="pi pi-times" /> {{ $t('admin.org.slugTaken') }}</small>
        <small v-else-if="slugState === 'invalid'" class="su-bad"><i class="pi pi-times" /> {{ $t('admin.org.slugInvalid') }}</small>
        <small v-else class="su-hint">{{ $t('admin.org.slugHint') }}</small>

        <div class="su-row">
          <div>
            <label class="su-lbl">{{ $t('signup.fSigle') }}</label>
            <input v-model="org.sigle" class="su-in" type="text" :placeholder="$t('signup.fSiglePlaceholder')" />
          </div>
          <div>
            <label class="su-lbl">{{ $t('signup.fYear') }}</label>
            <input v-model="org.anneeCreation" class="su-in" type="number" min="1000" :max="new Date().getFullYear()" placeholder="1932" />
          </div>
        </div>

        <label class="su-lbl">{{ $t('signup.fDescription') }}</label>
        <textarea v-model="org.description" class="su-in su-ta" rows="3" :placeholder="$t('signup.fDescriptionPlaceholder')" />

        <label class="su-lbl">{{ $t('signup.fWebsite') }}</label>
        <input v-model="org.siteWeb" class="su-in" type="url" placeholder="https://…" />

        <p v-if="error" class="su-err"><i class="pi pi-exclamation-triangle" /> {{ error }}</p>
        <button class="ps-btn su-btn" :disabled="!canCreateOrg" @click="goToContacts">
          <i class="pi pi-arrow-right" /> {{ $t('signup.next') }}
        </button>
      </section>

      <!-- Étape 3 : coordonnées & responsable (facultatif) -->
      <section v-else-if="step === 3" class="su-card ps-card">
        <h1>{{ $t('signup.title3') }}</h1>
        <p class="su-lead">{{ $t('signup.lead3') }}</p>

        <h2 class="su-sec">{{ $t('signup.secContact') }}</h2>
        <div class="su-row">
          <div>
            <label class="su-lbl">{{ $t('signup.fContactEmail') }}</label>
            <input v-model="org.contactEmail" class="su-in" type="email" />
          </div>
          <div>
            <label class="su-lbl">{{ $t('signup.fPhone') }}</label>
            <input v-model="org.contactTel" class="su-in" type="tel" />
          </div>
        </div>
        <div class="su-row">
          <div>
            <label class="su-lbl">{{ $t('signup.fCountry') }}</label>
            <input v-model="org.pays" class="su-in" type="text" />
          </div>
          <div>
            <label class="su-lbl">{{ $t('signup.fRegion') }}</label>
            <input v-model="org.region" class="su-in" type="text" :placeholder="$t('signup.fRegionPlaceholder')" />
          </div>
        </div>
        <div class="su-row">
          <div>
            <label class="su-lbl">{{ $t('signup.fCity') }}</label>
            <input v-model="org.ville" class="su-in" type="text" />
          </div>
          <div>
            <label class="su-lbl">{{ $t('signup.fAddress') }}</label>
            <input v-model="org.adresse" class="su-in" type="text" />
          </div>
        </div>

        <h2 class="su-sec">{{ $t('signup.secManager') }}</h2>
        <div class="su-row">
          <div>
            <label class="su-lbl">{{ $t('signup.fManagerName') }}</label>
            <input v-model="org.responsableNom" class="su-in" type="text" />
          </div>
          <div>
            <label class="su-lbl">{{ $t('signup.fManagerRole') }}</label>
            <input v-model="org.responsableFonction" class="su-in" type="text" :placeholder="$t('signup.fManagerRolePlaceholder')" />
          </div>
        </div>
        <div class="su-row">
          <div>
            <label class="su-lbl">{{ $t('signup.fManagerEmail') }}</label>
            <input v-model="org.responsableEmail" class="su-in" type="email" />
          </div>
          <div>
            <label class="su-lbl">{{ $t('signup.fManagerPhone') }}</label>
            <input v-model="org.responsableTel" class="su-in" type="tel" />
          </div>
        </div>

        <h2 class="su-sec">{{ $t('signup.secAdmin') }}</h2>
        <label class="su-lbl">{{ $t('signup.fRegistry') }}</label>
        <input v-model="org.registreNumero" class="su-in" type="text" :placeholder="$t('signup.fRegistryPlaceholder')" />
        <div class="su-row">
          <div>
            <label class="su-lbl">{{ $t('signup.fLanguage') }}</label>
            <select v-model="org.langueDefaut" class="su-in">
              <option v-for="o in langueOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>
          <div>
            <label class="su-lbl">{{ $t('signup.fCurrency') }}</label>
            <select v-model="org.devise" class="su-in">
              <option v-for="d in deviseOptions" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
        </div>

        <p class="su-optional"><i class="pi pi-info-circle" /> {{ $t('signup.optionalNote') }}</p>
        <p v-if="error" class="su-err"><i class="pi pi-exclamation-triangle" /> {{ error }}</p>
        <div class="su-actions">
          <button class="su-back" @click="step = 2"><i class="pi pi-arrow-left" /> {{ $t('signup.back') }}</button>
          <button class="ps-btn su-btn" :disabled="busy || !canCreateOrg" @click="createOrg">
            <i :class="busy ? 'pi pi-spin pi-spinner' : 'pi pi-check'" /> {{ $t('signup.create') }}
          </button>
        </div>
      </section>

      <!-- Étape 4 : confirmation -->
      <section v-else class="su-card ps-card su-done">
        <i class="pi pi-check-circle" />
        <h1>{{ $t('signup.title4') }}</h1>
        <p class="su-lead">{{ $t('signup.lead4') }}</p>
        <div class="su-url su-url--big"><i class="pi pi-link" /> <code>{{ publicUrl }}</code></div>
        <p class="su-pending"><i class="pi pi-clock" /> {{ $t('signup.pending') }}</p>
        <button class="ps-btn su-btn" @click="router.push('/dashboard')">
          {{ $t('signup.goErp') }} <i class="pi pi-arrow-right" />
        </button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.su { min-height: 100vh; background: #f6f7f5; color: #101210; font-family: 'Inter', system-ui, sans-serif; }
.su-top { padding: 1rem clamp(1rem, 4vw, 3rem); background: #fff; border-bottom: 1px solid #e8e9e6; }
.su-logo { display: inline-flex; align-items: center; gap: 0.6rem; font-family: 'Anton', sans-serif; font-size: 1.35rem; letter-spacing: 0.05em; color: #101210; }
.su-logo__mark { width: 34px; height: 34px; border-radius: 50%; background: #101210; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1rem; }

.su-main { max-width: 620px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }

.su-steps { list-style: none; display: flex; gap: 0.5rem; margin: 0 0 1.6rem; padding: 0; }
.su-steps li { flex: 1; display: flex; align-items: center; gap: 0.5rem; font-size: 0.78rem; font-weight: 700; color: #9aa09a; }
.su-steps span { width: 26px; height: 26px; border-radius: 50%; background: #e2e5e1; color: #7c817b; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; flex: 0 0 auto; }
.su-steps li.on { color: #101210; }
.su-steps li.on span { background: var(--site-primary); color: #fff; }
.su-steps li.done span { background: #101210; }

.su-card { padding: 1.8rem 1.9rem 2rem; }
.su-card h1 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: 1.7rem; margin: 0 0 0.5rem; }
.su-lead { color: #5c615c; line-height: 1.6; margin: 0 0 1.6rem; }

.su-lbl { display: block; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #5c615c; margin-bottom: 0.4rem; }
.su-in { width: 100%; border: 1px solid #dcdedb; border-radius: 6px; padding: 0.75rem 0.9rem; font-family: inherit; font-size: 0.95rem; color: #101210; margin-bottom: 1.1rem; background: #fff; }
.su-in:focus { outline: none; border-color: var(--site-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--site-primary) 15%, transparent); }
.su-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; }
@media (max-width: 520px) { .su-row { grid-template-columns: 1fr; } }

.su-url { display: flex; align-items: center; gap: 0.5rem; background: #f2f4f1; border-radius: 6px; padding: 0.6rem 0.8rem; margin: -0.6rem 0 0.5rem; font-size: 0.85rem; overflow: hidden; }
.su-url code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.su-url i { color: var(--site-primary); }
.su-url--big { justify-content: center; font-size: 0.95rem; margin: 1rem 0 1.2rem; }

.su-hint { display: block; font-size: 0.78rem; color: #7c817b; margin-bottom: 1.1rem; }
.su-ok { display: block; font-size: 0.78rem; color: var(--site-primary); font-weight: 700; margin-bottom: 1.1rem; }
.su-bad { display: block; font-size: 0.78rem; color: #c0392b; font-weight: 700; margin-bottom: 1.1rem; }
.su-err { color: #c0392b; font-size: 0.88rem; margin: 0 0 0.9rem; }

.su-btn { width: 100%; justify-content: center; }
.su-ta { resize: vertical; line-height: 1.5; }
.su-sec { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--site-primary); margin: 1.4rem 0 0.9rem; padding-top: 1rem; border-top: 1px solid #e8e9e6; }
.su-sec:first-of-type { margin-top: 0.4rem; padding-top: 0; border-top: none; }
.su-optional { display: flex; align-items: center; gap: 0.5rem; background: #f2f4f1; border-radius: 6px; padding: 0.7rem 0.9rem; font-size: 0.82rem; color: #5c615c; margin: 0.2rem 0 1.1rem; }
.su-optional i { color: var(--site-primary); }
.su-actions { display: flex; align-items: center; gap: 0.8rem; }
.su-actions .su-btn { width: auto; flex: 1; }
.su-back { display: inline-flex; align-items: center; gap: 0.4rem; background: transparent; border: 1px solid #dcdedb; border-radius: 6px; padding: 0.75rem 1.1rem; font-family: inherit; font-size: 0.9rem; color: #5c615c; cursor: pointer; }
.su-back:hover { border-color: var(--site-primary); color: #101210; }
.su-alt { text-align: center; font-size: 0.85rem; color: #5c615c; margin: 1.2rem 0 0; }

.su-done { text-align: center; }
.su-done > i { font-size: 3.2rem; color: var(--site-primary); }
.su-done h1 { margin-top: 1rem; }
.su-pending { display: inline-flex; align-items: center; gap: 0.5rem; background: #fdf6e3; border: 1px solid #e8d9a8; color: #8a6d1f; border-radius: 8px; padding: 0.7rem 1rem; font-size: 0.86rem; margin: 0 0 1.4rem; text-align: left; }
</style>
