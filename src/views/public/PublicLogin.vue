<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/useAuthStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { usePublicTenantStore } from '@/stores/usePublicTenantStore'
import { useSiteLink } from '@/composables/useSiteLink'

// PORTE D'ENTRÉE UNIQUE DU SITE D'UNE ORGANISATION.
//
// Un seul formulaire pour tout le monde : c'est le RÔLE du compte, connu après
// l'authentification, qui décide de la suite.
//   • visiteur          → il reste sur le site (retour d'où il venait, sinon son compte)
//   • membre du personnel → il file dans l'ERP de SON organisation
//
// L'organisation garde la main sur l'habillage (image, titre, sous-titre) depuis
// l'ERP : rien n'est écrit en dur, chaque tenant a donc sa propre page.

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const settings = useSettingsStore()
const pubTenant = usePublicTenantStore()
const { to } = useSiteLink()

const mode = ref('login')      // login | signup | code
const email = ref('')
const password = ref('')
// L'oeil du champ. Ici il compte double : cet ecran sert AUSSI a l'inscription
// d'un visiteur, sur un telephone, souvent debout dans un musee.
const voirMdp = ref(false)
const fullName = ref('')
const code = ref('')
const codeEnvoye = ref(false)
const loading = ref(false)
const error = ref('')
const info = ref('')

const s = computed(() => settings.settings || {})
const marque = computed(() => s.value.marque || s.value.nomEntite || pubTenant.tenant?.nom || 'MUSÉA')

onMounted(async () => {
  await auth.ensureReady()
  // Déjà connecté : on n'affiche pas un formulaire inutile, on oriente.
  if (auth.user) redirigerSelonRole()
})

// LE cœur de la logique : après authentification, le rôle décide.
function redirigerSelonRole() {
  if (auth.isStaff) {
    router.replace('/dashboard')          // ERP de son organisation
    return
  }
  const cible = route.query.redirect ? String(route.query.redirect) : to('/compte')
  router.replace(cible)
}

function switchMode(m) {
  mode.value = m
  error.value = ''
  info.value = ''
  if (m !== 'code') { codeEnvoye.value = false; code.value = '' }
}

async function submit() {
  error.value = ''
  info.value = ''
  if (!email.value.trim() || !password.value) { error.value = t('siteLogin.errRequired'); return }
  if (mode.value === 'signup' && password.value.length < 6) { error.value = t('siteLogin.errShortPassword'); return }
  loading.value = true
  try {
    if (mode.value === 'signup') {
      await auth.signUp(email.value.trim(), password.value, fullName.value.trim())
    } else {
      await auth.signIn(email.value.trim(), password.value)
    }
    redirigerSelonRole()
  } catch (e) {
    error.value = e.message === 'Invalid login credentials' ? t('siteLogin.errInvalid') : e.message
  } finally {
    loading.value = false
  }
}

// Connexion par code e-mail : dépanne un mot de passe oublié sans jamais
// exposer ni réinitialiser le mot de passe existant.
async function envoyerCode() {
  error.value = ''
  if (!email.value.trim()) { error.value = t('siteLogin.errEmailRequired'); return }
  loading.value = true
  try {
    await auth.sendEmailOtp(email.value.trim())
    codeEnvoye.value = true
    info.value = t('siteLogin.codeSent', { email: email.value.trim() })
  } catch (e) { error.value = e.message } finally { loading.value = false }
}

async function verifierCode() {
  error.value = ''
  if (!code.value.trim()) { error.value = t('siteLogin.errCodeRequired'); return }
  loading.value = true
  try {
    await auth.verifyEmailOtp(email.value.trim(), code.value.trim())
    redirigerSelonRole()
  } catch (e) { error.value = t('siteLogin.errCodeInvalid') } finally { loading.value = false }
}

async function google() {
  error.value = ''
  try {
    // On revient sur cette page : elle saura alors où envoyer selon le rôle.
    await auth.signInGoogle(route.fullPath)
  } catch (e) { error.value = t('siteLogin.errGoogle') }
}
</script>

<template>
  <div class="sl">
    <div class="sl__card">
      <!-- Colonne formulaire -->
      <div class="sl__form">
        <h1 class="sl__title">
          {{ mode === 'signup' ? $t('siteLogin.titleSignup') : $t('siteLogin.title') }}
        </h1>
        <p class="sl__lead">
          {{ mode === 'signup' ? $t('siteLogin.leadSignup', { marque }) : $t('siteLogin.lead', { marque }) }}
        </p>

        <div v-if="mode !== 'code'" class="sl__tabs">
          <button type="button" :class="{ on: mode === 'login' }" @click="switchMode('login')">
            {{ $t('siteLogin.tabLogin') }}
          </button>
          <button type="button" :class="{ on: mode === 'signup' }" @click="switchMode('signup')">
            {{ $t('siteLogin.tabSignup') }}
          </button>
        </div>

        <p v-if="error" class="sl__err"><i class="pi pi-exclamation-triangle" /> {{ error }}</p>
        <p v-if="info" class="sl__ok"><i class="pi pi-check-circle" /> {{ info }}</p>

        <!-- Connexion par code e-mail -->
        <form v-if="mode === 'code'" @submit.prevent="codeEnvoye ? verifierCode() : envoyerCode()">
          <label class="vi-req sl__lbl" for="sl-email">{{ $t('siteLogin.email') }}</label>
          <input id="sl-email" v-model="email" class="sl__in" type="email" autocomplete="username"
                 placeholder="vous@exemple.com" :disabled="codeEnvoye" />
          <template v-if="codeEnvoye">
            <label class="vi-req sl__lbl" for="sl-code">{{ $t('siteLogin.code') }}</label>
            <input id="sl-code" v-model="code" class="sl__in" inputmode="numeric" autocomplete="one-time-code"
                   placeholder="123456" maxlength="8" />
          </template>
          <button class="ps-btn sl__btn" :disabled="loading">
            <i :class="loading ? 'pi pi-spin pi-spinner' : 'pi pi-envelope'" />
            {{ codeEnvoye ? $t('siteLogin.codeVerify') : $t('siteLogin.codeSend') }}
          </button>
          <button type="button" class="sl__link" @click="switchMode('login')">
            <i class="pi pi-arrow-left" /> {{ $t('siteLogin.backToPassword') }}
          </button>
        </form>

        <!-- Connexion / création de compte visiteur -->
        <form v-else @submit.prevent="submit">
          <template v-if="mode === 'signup'">
            <label class="sl__lbl" for="sl-fullName">{{ $t('siteLogin.fullName') }}</label>
            <input id="sl-fullName" v-model="fullName" class="sl__in" type="text" autocomplete="name"
                   :placeholder="$t('siteLogin.fullNamePlaceholder')" />
          </template>

          <label class="vi-req sl__lbl" for="sl-email">{{ $t('siteLogin.email') }}</label>
          <input id="sl-email" v-model="email" class="sl__in" type="email" autocomplete="username" placeholder="vous@exemple.com" />

          <label class="vi-req sl__lbl" for="sl-mdp">{{ $t('siteLogin.password') }}</label>
          <span class="vi-mdp">
            <input id="sl-mdp" v-model="password" class="sl__in"
                   :type="voirMdp ? 'text' : 'password'"
                   :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'" placeholder="••••••••" />
          <button type="button" class="vi-mdp__oeil"
                  :aria-label="voirMdp ? $t('common.hidePassword') : $t('common.showPassword')"
                  :aria-pressed="voirMdp" @click="voirMdp = !voirMdp">
            <i :class="voirMdp ? 'pi pi-eye-slash' : 'pi pi-eye'" />
          </button>
          </span>

          <button class="ps-btn sl__btn" :disabled="loading">
            <i :class="loading ? 'pi pi-spin pi-spinner' : (mode === 'signup' ? 'pi pi-user-plus' : 'pi pi-sign-in')" />
            {{ mode === 'signup' ? $t('siteLogin.signup') : $t('siteLogin.signin') }}
          </button>

          <button v-if="mode === 'login'" type="button" class="sl__link" @click="switchMode('code')">
            {{ $t('siteLogin.forgot') }}
          </button>
        </form>

        <template v-if="s.authGoogle !== false">
          <div class="sl__sep"><span>{{ $t('siteLogin.or') }}</span></div>
          <button type="button" class="sl__google" @click="google">
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            {{ $t('siteLogin.google') }}
          </button>
        </template>

        <p class="sl__staff"><i class="pi pi-info-circle" /> {{ $t('siteLogin.staffHint') }}</p>
      </div>

      <!-- Colonne visuelle : image réglée par l'organisation dans l'ERP -->
      <div class="sl__art" :style="s.loginImage ? { backgroundImage: `url(${s.loginImage})` } : {}">
        <div class="sl__art-in">
          <span class="sl__art-kicker">{{ marque }}</span>
          <h2 class="sl__art-title">{{ s.loginTitre || $t('siteLogin.artTitle') }}</h2>
          <p class="sl__art-lead">{{ s.loginSousTitre || $t('siteLogin.artLead') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sl { padding: clamp(1.5rem, 5vw, 3.5rem) 1rem; display: flex; justify-content: center; }
.sl__card {
  width: min(980px, 100%); display: grid; grid-template-columns: 1fr 1fr;
  background: #fff; border: 1px solid #e8e9e6; border-radius: 18px; overflow: hidden;
  box-shadow: 0 24px 60px -28px rgba(16, 18, 16, 0.35);
}
@media (max-width: 820px) { .sl__card { grid-template-columns: 1fr; } .sl__art { display: none; } }

.sl__form { padding: clamp(1.6rem, 4vw, 2.6rem); }
.sl__title { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: clamp(1.5rem, 3vw, 1.9rem); margin: 0 0 0.5rem; color: #101210; }
.sl__lead { color: #5c615c; line-height: 1.6; margin: 0 0 1.5rem; font-size: 0.94rem; }

.sl__tabs { display: flex; gap: 0.4rem; background: #f2f4f1; border-radius: 999px; padding: 0.25rem; margin-bottom: 1.4rem; }
.sl__tabs button { flex: 1; border: none; background: transparent; padding: 0.55rem 0.8rem; border-radius: 999px; font-family: inherit; font-size: 0.88rem; font-weight: 700; color: #5c615c; cursor: pointer; }
.sl__tabs button.on { background: #fff; color: #101210; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }

.sl__lbl { display: block; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase; color: #5c615c; margin-bottom: 0.4rem; }
.sl__in { width: 100%; border: 1px solid #dcdedb; border-radius: 8px; padding: 0.75rem 0.9rem; font-family: inherit; font-size: 0.95rem; margin-bottom: 1.05rem; background: #fff; color: #101210; }
.sl__in:focus { outline: none; border-color: var(--site-primary, #0e6f5c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--site-primary, #0e6f5c) 15%, transparent); }
.sl__in:disabled { background: #f6f7f5; color: #7c817b; }

.sl__btn { width: 100%; justify-content: center; margin-top: 0.2rem; }
.sl__link { display: block; width: 100%; background: none; border: none; color: var(--site-primary, #0e6f5c); font-family: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer; margin-top: 0.8rem; text-align: center; }
.sl__err { color: #c0392b; font-size: 0.88rem; margin: 0 0 0.9rem; display: flex; align-items: center; gap: 0.4rem; }
.sl__ok { color: var(--site-primary, #0e6f5c); font-size: 0.88rem; margin: 0 0 0.9rem; display: flex; align-items: center; gap: 0.4rem; }

.sl__sep { text-align: center; margin: 1.2rem 0 1rem; position: relative; color: #7c817b; font-size: 0.8rem; }
.sl__sep::before { content: ''; position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: #e8e9e6; }
.sl__sep span { background: #fff; padding: 0 0.7rem; position: relative; }
.sl__google { width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 0.6rem; background: #fff; border: 1px solid #dcdedb; border-radius: 8px; padding: 0.72rem 1rem; font-family: inherit; font-size: 0.92rem; font-weight: 600; color: #101210; cursor: pointer; }
.sl__google:hover { border-color: #b9bdb7; }
.sl__google svg { width: 18px; height: 18px; }
.sl__staff { margin: 1.3rem 0 0; font-size: 0.78rem; color: #7c817b; display: flex; align-items: flex-start; gap: 0.45rem; line-height: 1.5; }
.sl__staff i { color: var(--site-primary, #0e6f5c); margin-top: 0.15rem; }

.sl__art { background: #17110b center/cover no-repeat; position: relative; display: flex; align-items: flex-end; }
.sl__art::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(16,18,16,0.15), rgba(16,18,16,0.85)); }
.sl__art-in { position: relative; z-index: 1; padding: 2rem; color: #fff; }
.sl__art-kicker { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.85; }
.sl__art-title { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: 1.6rem; margin: 0.5rem 0 0.6rem; line-height: 1.15; }
.sl__art-lead { margin: 0; font-size: 0.9rem; line-height: 1.6; opacity: 0.9; }
</style>
