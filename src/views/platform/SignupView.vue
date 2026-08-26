<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { sendTenantWelcome, sendNouvelleOrganisation } from '@/services/emailApi'
import { urlPubliqueTenant } from '@/services/host'
import { televerser } from '@/services/stockage'
import SetupAgentView from '@/views/SetupAgentView.vue'
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

const account = reactive({ email: '', password: '', passwordConfirm: '', fullName: '' })

// LOGO — le fichier attend en mémoire et n'est déposé qu'APRÈS la création de
// l'organisation : le Storage range les médias sous `<tenant>/…` et refuse tout
// dépôt tant que l'organisation n'existe pas (`televerser` lève alors
// « organisation_inconnue »).
const logoFichier = ref(null)
// URL `blob:` d'AFFICHAGE uniquement. Elle meurt au rechargement de la page :
// ce qui est enregistré en base est l'URL publique renvoyée par le Storage.
const logoApercu = ref('')

const cguAcceptees = ref(false)

// Écran d'attente de la création. Les étapes ne sont pas décoratives : elles
// disent ce qui se passe réellement, dans l'ordre où cela se passe.
const creation = reactive({ enCours: false, etape: 0 })
const etapesCreation = [
  'signup.stepCreate1', 'signup.stepCreate2', 'signup.stepCreate3', 'signup.stepCreate4'
]
const ETAPES_CREATION = etapesCreation.length

// Assistant d'installation : proposé une fois, à la fin de l'inscription.
const assistantOuvert = ref(false)
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
// Un mot de passe se saisit deux fois : une faute de frappe dans le seul champ
// caché du formulaire enfermerait le responsable dehors dès sa première connexion.
const motsDePasseIdentiques = computed(() =>
  !!account.passwordConfirm && account.password === account.passwordConfirm)
const canCreateAccount = computed(() =>
  account.email.includes('@') && account.password.length >= 6 && motsDePasseIdentiques.value)
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

function choisirLogo(e) {
  const f = e.target.files?.[0]
  if (!f) return
  if (logoApercu.value) URL.revokeObjectURL(logoApercu.value)
  logoFichier.value = f
  logoApercu.value = URL.createObjectURL(f)
}

function retirerLogo() {
  if (logoApercu.value) URL.revokeObjectURL(logoApercu.value)
  logoFichier.value = null
  logoApercu.value = ''
}

async function createAccount() {
  error.value = ''
  // Deux refus distincts : « mot de passe trop court » et « les deux saisies
  // diffèrent » n'appellent pas la même correction.
  if (account.password && account.passwordConfirm && !motsDePasseIdentiques.value) {
    error.value = t('signup.errPasswordMismatch'); return
  }
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

function attendre(ms) { return new Promise((r) => setTimeout(r, ms)) }

// L'écran d'attente avance à son rythme pendant que le travail se fait. La RPC
// répond souvent en moins d'une seconde : sans cette durée plancher, l'écran
// clignoterait et laisserait croire que rien n'a été enregistré.
async function animerCreation() {
  for (let i = 1; i <= ETAPES_CREATION; i++) {
    creation.etape = i
    await attendre(750)
  }
}

async function createOrg() {
  error.value = ''
  if (!canCreateOrg.value) { error.value = t('signup.errOrg'); return }
  if (!cguAcceptees.value) { error.value = t('signup.errTerms'); return }
  busy.value = true
  creation.etape = 0
  creation.enCours = true
  const animation = animerCreation()
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

    // LOGO — maintenant seulement : le Storage exige que l'organisation existe.
    // Un dépôt qui échoue ne doit pas annuler une inscription réussie ; le logo
    // se repose en deux clics depuis « Mon organisation ».
    if (logoFichier.value) {
      try {
        const url = await televerser(logoFichier.value, 'photos')
        await supabase.from('tenants').update({ logo: url }).eq('id', auth.tenantId)
      } catch (eLogo) {
        console.warn('[inscription] logo non déposé :', eLogo.message)
      }
    }

    // Accusé de création (l'espace attend encore la validation du super-admin).
    //
    // Le lien ne doit PAS pointer sur la plateforme où l'inscription vient d'avoir
    // lieu : l'espace de travail du client est sur SON sous-domaine, et c'est là
    // qu'il devra se connecter — la session ne franchit pas les sous-domaines.
    // Envoyer `nexacode.store/dashboard`, comme auparavant, le menait sur un
    // tableau de bord qui n'est pas le sien.
    //
    // `auth.fetchRole()` vient de renseigner tenantId : on le joint pour que
    // l'envoi soit rattaché à l'organisation dans `email_log` (il y était `null`).
    const espace = urlPubliqueTenant(org.slug)
    sendTenantWelcome({
      to: org.contactEmail || account.email,
      nomOrganisation: org.nom.trim(),
      lien: `${espace}/dashboard`,
      adresseSite: espace,
      tenantId: auth.tenantId
    })

    // Et on prévient la plateforme, dans le même mouvement : sans cela, personne
    // n'est au courant qu'une organisation attend, et elle peut patienter des
    // jours pendant que son site reste introuvable.
    sendNouvelleOrganisation({
      nomOrganisation: org.nom.trim(),
      adresseSite: espace,
      contactEmail: org.contactEmail || account.email,
      typeOrganisation: org.type,
      lien: `${window.location.origin}/dashboard`
    })

    // L'écran d'attente va jusqu'au bout de ses étapes avant de céder la place :
    // s'arrêter au milieu donnerait le sentiment d'un travail interrompu.
    await animation
    step.value = 4
  } catch (e) {
    error.value = e.message
  } finally {
    creation.enCours = false
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

        <label class="vi-req su-lbl">{{ $t('signup.fEmail') }}</label>
        <input v-model="account.email" class="su-in" type="email" placeholder="vous@exemple.cm" />

        <label class="vi-req su-lbl">{{ $t('signup.fPassword') }}</label>
        <input v-model="account.password" class="su-in" type="password" :placeholder="$t('signup.fPasswordPlaceholder')" />

        <label class="vi-req su-lbl">{{ $t('signup.fPasswordConfirm') }}</label>
        <input v-model="account.passwordConfirm" class="su-in" type="password"
               :class="{ 'su-in--bad': account.passwordConfirm && !motsDePasseIdentiques }"
               :placeholder="$t('signup.fPasswordConfirmPlaceholder')" />
        <!-- Le désaccord se signale à la saisie, pas au clic sur « Suivant » :
             corriger deux champs cachés après coup est autrement plus pénible. -->
        <small v-if="account.passwordConfirm && !motsDePasseIdentiques" class="su-mismatch">
          <i class="pi pi-times-circle" /> {{ $t('signup.errPasswordMismatch') }}
        </small>
        <small v-else-if="motsDePasseIdentiques" class="su-match">
          <i class="pi pi-check-circle" /> {{ $t('signup.passwordsMatch') }}
        </small>

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

        <label class="vi-req su-lbl">{{ $t('signup.fOrgName') }}</label>
        <input v-model="org.nom" class="su-in" type="text" :placeholder="$t('admin.org.fNamePlaceholder')" />

        <label class="su-lbl">{{ $t('signup.fType') }}</label>
        <select v-model="org.type" class="su-in">
          <option v-for="o in typeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>

        <label class="vi-req su-lbl">{{ $t('signup.fSlug') }}</label>
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

        <!-- LOGO — posé ici plutôt que dans l'ERP : un site sans identité le jour
             de son ouverture donne l'impression d'un espace inachevé. -->
        <label class="su-lbl">{{ $t('signup.fLogo') }}</label>
        <div class="su-logo-pick">
          <div class="su-logo-pick__vue">
            <img v-if="logoApercu" :src="logoApercu" :alt="org.nom" />
            <span v-else><i class="pi pi-image" /></span>
          </div>
          <div class="su-logo-pick__act">
            <input id="su-logo" type="file" accept="image/png,image/jpeg,image/webp" @change="choisirLogo" />
            <label for="su-logo" class="su-logo-pick__btn">
              <i class="pi pi-upload" /> {{ logoApercu ? $t('signup.logoChange') : $t('signup.logoPick') }}
            </label>
            <button v-if="logoApercu" type="button" class="su-logo-pick__rm" @click="retirerLogo">
              {{ $t('signup.logoRemove') }}
            </button>
            <small>{{ $t('signup.logoHint') }}</small>
          </div>
        </div>

        <p class="su-optional"><i class="pi pi-info-circle" /> {{ $t('signup.optionalNote') }}</p>

        <!-- Acceptation explicite : rien n'était accepté jusqu'ici, alors que la
             plateforme héberge les données de l'organisation et encaisse pour elle. -->
        <label class="su-cgu">
          <input v-model="cguAcceptees" type="checkbox" />
          <span>
            {{ $t('signup.termsBefore') }}
            <router-link to="/conditions" target="_blank" class="ps-link">{{ $t('signup.termsLink') }}</router-link>
            {{ $t('signup.termsAnd') }}
            <router-link to="/confidentialite" target="_blank" class="ps-link">{{ $t('signup.privacyLink') }}</router-link>
          </span>
        </label>

        <p v-if="error" class="su-err"><i class="pi pi-exclamation-triangle" /> {{ error }}</p>
        <div class="su-actions">
          <button class="su-back" @click="step = 2"><i class="pi pi-arrow-left" /> {{ $t('signup.back') }}</button>
          <button class="ps-btn su-btn" :disabled="busy || !canCreateOrg || !cguAcceptees" @click="createOrg">
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

        <!-- ASSISTANT D'INSTALLATION — proposé ICI, tant que la session ouverte
             sur la plateforme est encore valide. Depuis le sous-domaine il
             faudrait se reconnecter, et l'élan serait perdu. Facultatif : le même
             écran reste accessible plus tard depuis l'ERP. -->
        <div v-if="!assistantOuvert" class="su-assist">
          <i class="pi pi-sparkles su-assist__ico" />
          <strong>{{ $t('signup.setupTitle') }}</strong>
          <p>{{ $t('signup.setupLead') }}</p>
          <button class="ps-btn su-assist__btn" @click="assistantOuvert = true">
            <i class="pi pi-comments" /> {{ $t('signup.setupStart') }}
          </button>
          <small>{{ $t('signup.setupSkip') }}</small>
        </div>

        <!-- Le lien change d'origine (sous-domaine) : un <a>, pas le routeur. -->
        <a class="ps-btn su-btn" :href="`${publicUrl}/dashboard`">
          {{ $t('signup.goErp') }} <i class="pi pi-arrow-right" />
        </a>
      </section>

      <!-- L'assistant a besoin de toute la largeur : il ne tient pas dans la carte. -->
      <section v-if="step === 4 && assistantOuvert" class="su-assist-panneau">
        <SetupAgentView />
      </section>
    </main>

    <!-- ÉCRAN DE CRÉATION — il ne masque pas un travail lent, il rend compte du
         travail fait. Chaque ligne correspond à une opération réelle. -->
    <transition name="su-fade">
      <div v-if="creation.enCours" class="su-splash" role="status" aria-live="polite">
        <div class="su-splash__halo" />
        <div class="su-splash__boite">
          <div class="su-splash__marque">
            <img v-if="logoApercu" :src="logoApercu" alt="" />
            <span v-else>{{ (org.nom || 'M').trim().charAt(0).toUpperCase() }}</span>
          </div>
          <h2>{{ org.nom || $t('signup.creatingFallback') }}</h2>
          <p class="su-splash__lead">{{ $t('signup.creatingLead') }}</p>
          <ul class="su-splash__etapes">
            <li v-for="(cle, i) in etapesCreation" :key="cle"
                :class="{ faite: creation.etape > i + 1, active: creation.etape === i + 1 }">
              <i :class="creation.etape > i + 1 ? 'pi pi-check'
                       : creation.etape === i + 1 ? 'pi pi-spin pi-spinner' : 'pi pi-circle'" />
              <span>{{ $t(cle) }}</span>
            </li>
          </ul>
          <div class="su-splash__barre">
            <span :style="{ width: `${(creation.etape / ETAPES_CREATION) * 100}%` }" />
          </div>
          <p class="su-splash__adresse"><i class="pi pi-link" /> {{ publicUrl }}</p>
        </div>
      </div>
    </transition>
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

/* ---------- Confirmation du mot de passe ---------- */
.su-in--bad { border-color: #c0392b; }
.su-mismatch { display: block; margin: -0.5rem 0 0.9rem; color: #c0392b; font-size: 0.8rem; }
.su-match { display: block; margin: -0.5rem 0 0.9rem; color: #0e6f5c; font-size: 0.8rem; }

/* ---------- Logo ---------- */
.su-logo-pick { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.1rem; }
.su-logo-pick__vue { width: 76px; height: 76px; flex: none; border-radius: 12px; border: 1px dashed #c8cdc6; background: #fff; display: grid; place-items: center; overflow: hidden; }
.su-logo-pick__vue img { width: 100%; height: 100%; object-fit: cover; }
.su-logo-pick__vue i { font-size: 1.5rem; color: #9aa09a; }
.su-logo-pick__act { display: flex; flex-direction: column; align-items: flex-start; gap: 0.35rem; }
.su-logo-pick__act input[type="file"] { position: absolute; width: 1px; height: 1px; opacity: 0; }
.su-logo-pick__btn { display: inline-flex; align-items: center; gap: 0.45rem; cursor: pointer; border: 1px solid #101210; border-radius: 6px; padding: 0.45rem 0.9rem; font-size: 0.84rem; font-weight: 600; }
.su-logo-pick__btn:hover { background: #101210; color: #fff; }
.su-logo-pick__rm { background: none; border: none; padding: 0; cursor: pointer; color: #c0392b; font-size: 0.8rem; text-decoration: underline; }
.su-logo-pick__act small { color: #7c817b; font-size: 0.76rem; }

/* ---------- Acceptation des conditions ---------- */
.su-cgu { display: flex; align-items: flex-start; gap: 0.6rem; margin: 0 0 1.2rem; font-size: 0.86rem; line-height: 1.5; cursor: pointer; }
.su-cgu input { margin-top: 0.2rem; width: 17px; height: 17px; flex: none; accent-color: var(--site-primary); }

/* ---------- Invitation à l'assistant ---------- */
.su-assist { border: 1px solid #d9e5e0; background: linear-gradient(160deg, #f2f9f6, #fff); border-radius: 12px; padding: 1.3rem 1.2rem; margin: 0 0 1.4rem; display: flex; flex-direction: column; align-items: center; gap: 0.4rem; }
.su-assist__ico { font-size: 1.6rem; color: var(--site-primary); }
.su-assist strong { font-size: 1rem; }
.su-assist p { margin: 0; font-size: 0.86rem; color: #4a504a; }
.su-assist__btn { margin-top: 0.5rem; }
.su-assist small { color: #7c817b; font-size: 0.76rem; }
.su-assist-panneau { margin-top: 1.5rem; background: #fff; border: 1px solid #e8e9e6; border-radius: 14px; padding: 0.5rem 1rem 1rem; }

/* ---------- Écran de création ---------- */
.su-splash { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 1.25rem; background: radial-gradient(120% 120% at 50% 0%, #123c33 0%, #0b1a17 55%, #070f0d 100%); overflow: hidden; }
.su-splash__halo { position: absolute; width: min(70vw, 620px); aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle, rgba(212, 175, 55, 0.28), rgba(14, 111, 92, 0.16) 45%, transparent 70%); filter: blur(6px); animation: su-pulse 4.5s ease-in-out infinite; }
@keyframes su-pulse { 0%, 100% { transform: scale(0.92); opacity: 0.75; } 50% { transform: scale(1.08); opacity: 1; } }

.su-splash__boite { position: relative; width: min(100%, 420px); text-align: center; color: #f3f6f4; animation: su-monte 0.5s ease both; }
@keyframes su-monte { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

.su-splash__marque { width: 84px; height: 84px; margin: 0 auto 1.1rem; border-radius: 22px; overflow: hidden; display: grid; place-items: center; background: linear-gradient(145deg, #0e6f5c, #17a184); color: #fff; font-family: 'Anton', sans-serif; font-size: 2.1rem; box-shadow: 0 18px 42px rgba(0, 0, 0, 0.45); }
.su-splash__marque img { width: 100%; height: 100%; object-fit: cover; }
.su-splash__boite h2 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; letter-spacing: 0.02em; font-size: 1.5rem; margin: 0 0 0.3rem; }
.su-splash__lead { margin: 0 0 1.5rem; font-size: 0.9rem; color: #a8bdb6; }

.su-splash__etapes { list-style: none; margin: 0 0 1.4rem; padding: 0; display: flex; flex-direction: column; gap: 0.65rem; text-align: left; }
.su-splash__etapes li { display: flex; align-items: center; gap: 0.7rem; font-size: 0.88rem; color: #7d938c; transition: color 0.35s ease; }
.su-splash__etapes li i { width: 1.15rem; font-size: 0.85rem; }
.su-splash__etapes li.active { color: #fff; }
.su-splash__etapes li.faite { color: #6fcbb2; }

.su-splash__barre { height: 4px; border-radius: 4px; background: rgba(255, 255, 255, 0.12); overflow: hidden; }
.su-splash__barre span { display: block; height: 100%; border-radius: 4px; background: linear-gradient(90deg, #0e6f5c, #d4af37); transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1); }
.su-splash__adresse { margin: 1.1rem 0 0; font-size: 0.8rem; color: #8fa9a1; display: flex; align-items: center; justify-content: center; gap: 0.4rem; }

.su-fade-enter-active, .su-fade-leave-active { transition: opacity 0.35s ease; }
.su-fade-enter-from, .su-fade-leave-to { opacity: 0; }

/* Une animation qui pulse peut gêner ; on la retire pour qui l'a demandé. */
@media (prefers-reduced-motion: reduce) {
  .su-splash__halo { animation: none; }
  .su-splash__boite { animation: none; }
}

/* ---------- Téléphone ----------
   Deux défauts mesurés en 375 px de large : le fil d'étapes débordait de 11 px
   (quatre libellés côte à côte n'y tiennent pas), et les champs héritaient
   d'une police sous 16 px — en dessous de ce seuil, Safari iOS zoome à la mise
   au point et décale toute la page, ce qui donne l'impression d'un formulaire
   cassé. */
@media (max-width: 640px) {
  .su-steps { flex-wrap: wrap; gap: 0.4rem 0.9rem; }
  .su-steps li { flex: 0 0 auto; font-size: 0.72rem; }
  /* Sur les tout petits écrans, seul le numéro reste : les quatre libellés
     prendraient trois lignes pour une information déjà donnée par la page. */
  .su-in { font-size: 16px; min-height: 44px; }
  .su-ta { min-height: 88px; }
  .su-btn, .su-back { min-height: 44px; }
  .su-main { padding-left: 1rem; padding-right: 1rem; }
}
</style>
