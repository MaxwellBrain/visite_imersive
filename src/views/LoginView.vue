<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Message from 'primevue/message'
import { PAYS_AFRIQUE } from '@/constants/afrique'
import LangSwitcher from '@/components/LangSwitcher.vue'
import { useAuthStore } from '@/stores/useAuthStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

const { t } = useI18n()
const auth = useAuthStore()
// Habillage de la page : réglable dans l'ERP (rien n'est écrit en dur).
const settings = useSettingsStore()
onMounted(() => { if (!settings.settings) settings.load() })
const s = computed(() => settings.settings || {})
const marque = computed(() => s.value.marque || s.value.nomEntite || 'MUSÉA')
const sigle = computed(() =>
  (s.value.marqueInitiale || marque.value).trim().slice(0, 3).toUpperCase())
const route = useRoute()
const router = useRouter()

// PAGE DE CONNEXION UNIQUE — visiteurs ET personnel.
//
// Elle refusait auparavant tout compte non-staff : un visiteur qui saisissait ses
// identifiants ici était déconnecté de force avec « accès refusé ». C'était faux,
// et incompréhensible pour lui : son compte est valide, c'est la porte qui était
// mal étiquetée. On accepte donc les deux, et on oriente ensuite selon le rôle.
//
// CRÉER une organisation ne se fait pas ici : c'est un acte commercial, il a sa
// place sur la vitrine publique (/), pas sur un formulaire de connexion.
// login | signup | code — trois états d'un MÊME formulaire, pas trois pages.
// L'inscription visiteur vivait sur un écran séparé ; on ne quitte plus la carte,
// le formulaire s'allonge simplement des champs d'identité.
const mode = ref('login')

// Champs supplémentaires de l'inscription visiteur.
const prenom = ref('')
const nom = ref('')
const pays = ref('')
const telephone = ref('')
const paysOptions = PAYS_AFRIQUE.map((p) => ({ label: p.fr, value: p.fr }))

// Après authentification : le personnel va à son ERP, le visiteur à son compte.
// Une redirection demandée explicitement (garde de route) prime sur les deux.
function destination() {
  if (route.query.redirect) return String(route.query.redirect)
  return auth.isStaff ? '/dashboard' : '/site/compte'
}
const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const info = ref('')

// Connexion par code e-mail : dépanne un mot de passe oublié sans jamais
// exposer ni réinitialiser le mot de passe existant.
const codeEnvoye = ref(false)
const code = ref('')

function switchMode(m) {
  mode.value = m
  error.value = ''
  info.value = ''
  if (m !== 'code') { codeEnvoye.value = false; code.value = '' }
}

async function envoyerCode() {
  error.value = ''
  info.value = ''
  if (!email.value.trim()) { error.value = t('admin.login.errEmailRequired'); return }
  loading.value = true
  try {
    await auth.sendEmailOtp(email.value.trim())
    codeEnvoye.value = true
    info.value = t('admin.login.codeSent', { email: email.value.trim() })
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function verifierCode() {
  error.value = ''
  if (!code.value.trim()) { error.value = t('admin.login.errCodeRequired'); return }
  loading.value = true
  try {
    await auth.verifyEmailOtp(email.value.trim(), code.value.trim())
    router.push(destination())
  } catch (e) {
    error.value = t('admin.login.errCodeInvalid')
  } finally {
    loading.value = false
  }
}

async function submit() {
  error.value = ''
  info.value = ''
  if (!email.value || !password.value) { error.value = t('admin.login.errRequired'); return }
  loading.value = true
  try {
    await auth.signIn(email.value.trim(), password.value)
    router.push(destination())
  } catch (e) {
    error.value = e.message === 'Invalid login credentials' ? t('admin.login.errInvalid') : e.message
  } finally {
    loading.value = false
  }
}

// Inscription VISITEUR. Le rôle n'est pas transmis par le client : `profiles.role`
// vaut « visitor » par défaut en base. Un compte créé ici ne peut donc pas devenir
// membre du personnel par accident — c'était le défaut de l'ancien onglet supprimé.
async function inscrire() {
  error.value = ''
  info.value = ''
  if (!prenom.value.trim() || !nom.value.trim()) { error.value = t('admin.login.errNameRequired'); return }
  if (!email.value.trim() || !password.value) { error.value = t('admin.login.errRequired'); return }
  if (password.value.length < 6) { error.value = t('admin.login.errPasswordShort'); return }
  loading.value = true
  try {
    await auth.signUp(email.value.trim(), password.value, {
      prenom: prenom.value.trim(),
      nom: nom.value.trim(),
      pays: pays.value || null,
      telephone: telephone.value.trim() || null
    })
    router.push(destination())
  } catch (e) {
    error.value = /already registered|User already/i.test(e.message)
      ? t('admin.login.errEmailTaken')
      : e.message
  } finally {
    loading.value = false
  }
}

async function google() {
  error.value = ''
  try {
    // On ignore le rôle avant l'authentification : on revient donc sur cette page,
    // et la garde de route oriente ensuite vers l'ERP ou vers le compte visiteur.
    await auth.signInGoogle(route.query.redirect ? String(route.query.redirect) : '/login')
  } catch (e) {
    error.value = t('admin.login.errGoogle')
  }
}
</script>

<template>
  <div class="login">
    <div class="login__card">
      <!-- Colonne gauche : informations de connexion -->
      <div class="login__form">
        <div class="login__top">
          <router-link to="/site" class="login__back"><i class="pi pi-arrow-left" /> {{ $t('admin.login.backToSite') }}</router-link>
          <LangSwitcher variant="light" />
        </div>

        <div class="login__brand">
          <img v-if="s.logo" :src="s.logo" :alt="marque" class="login__logo" />
          <span v-else class="login__mark">{{ sigle }}</span>
          <div>
            <strong>{{ marque }}</strong>
            <span>{{ s.loginSousTitre || $t('admin.login.subtitle') }}</span>
          </div>
        </div>

        <Message v-if="error" severity="error" :closable="false" class="login__msg">{{ error }}</Message>
        <Message v-if="info" severity="success" :closable="false" class="login__msg">{{ info }}</Message>

        <!-- Connexion par code e-mail (mot de passe oublié) -->
        <form v-if="mode === 'code'" @submit.prevent="codeEnvoye ? verifierCode() : envoyerCode()">
          <div class="vi-field">
            <label class="vi-req" for="l-email-c">{{ $t('admin.login.email') }}</label>
            <InputText id="l-email-c" v-model="email" type="email" autocomplete="username"
              placeholder="vous@exemple.com" :disabled="codeEnvoye" />
          </div>
          <div v-if="codeEnvoye" class="vi-field">
            <label class="vi-req" for="l-code">{{ $t('admin.login.code') }}</label>
            <InputText id="l-code" v-model="code" inputmode="numeric" autocomplete="one-time-code"
              placeholder="123456" maxlength="8" />
          </div>
          <Button
            type="submit"
            :label="codeEnvoye ? $t('admin.login.codeVerify') : $t('admin.login.codeSend')"
            :icon="codeEnvoye ? 'pi pi-sign-in' : 'pi pi-envelope'"
            :loading="loading"
            class="login__submit"
          />
          <button v-if="codeEnvoye" type="button" class="login__link" @click="envoyerCode">
            {{ $t('admin.login.codeResend') }}
          </button>
          <button type="button" class="login__link" @click="switchMode('login')">
            <i class="pi pi-arrow-left" /> {{ $t('admin.login.backToPassword') }}
          </button>
        </form>

        <!-- Connexion et inscription : un seul formulaire, qui s'allonge. -->
        <form v-else @submit.prevent="mode === 'signup' ? inscrire() : submit()">
          <!-- Champs d'identité, présents à la seule inscription -->
          <transition name="grow">
            <div v-if="mode === 'signup'" class="login__extra">
              <div class="vi-row">
                <div class="vi-field">
                  <label for="l-prenom">{{ $t('admin.login.firstName') }}</label>
                  <InputText id="l-prenom" v-model="prenom" autocomplete="given-name" :placeholder="$t('admin.login.firstNamePh')" />
                </div>
                <div class="vi-field">
                  <label for="l-nom">{{ $t('admin.login.lastName') }}</label>
                  <InputText id="l-nom" v-model="nom" autocomplete="family-name" :placeholder="$t('admin.login.lastNamePh')" />
                </div>
              </div>
              <div class="vi-row">
                <div class="vi-field">
                  <label for="l-pays">{{ $t('admin.login.country') }}</label>
                  <Select
                    id="l-pays"
                    v-model="pays"
                    :options="paysOptions"
                    option-label="label"
                    option-value="value"
                    filter
                    show-clear
                    :placeholder="$t('admin.login.countryPh')"
                  />
                </div>
                <div class="vi-field">
                  <label for="l-tel">{{ $t('admin.login.phone') }}</label>
                  <InputText id="l-tel" v-model="telephone" type="tel" autocomplete="tel" placeholder="+237…" />
                </div>
              </div>
            </div>
          </transition>

          <div class="vi-field">
            <label class="vi-req" for="l-email">{{ $t('admin.login.email') }}</label>
            <InputText id="l-email" v-model="email" type="email" autocomplete="username" placeholder="vous@exemple.com" />
          </div>
          <div class="vi-field">
            <label class="vi-req" for="l-pw">{{ $t('admin.login.password') }}</label>
            <InputText
              id="l-pw"
              v-model="password"
              type="password"
              :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'"
              placeholder="••••••••"
            />
            <small v-if="mode === 'signup'">{{ $t('admin.login.passwordHint') }}</small>
          </div>
          <Button
            type="submit"
            :label="mode === 'signup' ? $t('admin.login.signUpBtn') : $t('admin.login.signIn')"
            :icon="mode === 'signup' ? 'pi pi-user-plus' : 'pi pi-sign-in'"
            :loading="loading"
            class="login__submit"
          />
          <button v-if="mode !== 'signup'" type="button" class="login__link" @click="switchMode('code')">
            {{ $t('admin.login.forgot') }}
          </button>
        </form>

        <div class="login__sep"><span>{{ $t('admin.login.or') }}</span></div>
        <button type="button" class="login__google" @click="google">
          <svg class="login__gicon" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {{ $t('admin.login.google') }}
        </button>

        <!-- Un visiteur sans compte doit pouvoir en créer un : c'est le prolongement
             direct de la connexion. Créer une ORGANISATION, en revanche, est un acte
             commercial — sa place est sur la vitrine publique, pas ici. -->
        <!-- Bascule connexion ⇄ inscription : on ne quitte jamais cette carte.
             Créer une ORGANISATION reste sur la vitrine publique — c'est un acte
             commercial, pas le prolongement d'une connexion. -->
        <p v-if="mode !== 'code'" class="login__signup">
          <template v-if="mode === 'signup'">
            {{ $t('admin.login.haveAccount') }}
            <button type="button" @click="switchMode('login')">{{ $t('admin.login.signIn') }}</button>
          </template>
          <template v-else>
            {{ $t('admin.login.noAccount') }}
            <button type="button" @click="switchMode('signup')">{{ $t('admin.login.createVisitor') }}</button>
          </template>
        </p>

        <p class="login__hint">{{ $t('admin.login.hint') }}</p>
      </div>

      <!-- Colonne droite : visuel (dépose ton image dans public/login-art.jpg) -->
      <div class="login__art" :style="s.loginImage ? { backgroundImage: `url(${s.loginImage})` } : {}">
        <div class="login__art-inner">
          <span class="login__art-kicker">{{ marque }}</span>
          <h2 class="login__art-title">{{ s.loginTitre || $t('admin.login.artTagline') }}</h2>
          <p class="login__art-quote">{{ $t('admin.login.artQuote') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background:
    radial-gradient(900px 500px at 80% -10%, color-mix(in srgb, var(--p-primary-color) 12%, transparent), transparent 60%),
    var(--vi-bg);
}
.login__card {
  width: 100%;
  max-width: 940px;
  min-height: 590px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: var(--vi-surface);
  border: 1px solid var(--vi-border);
  border-radius: 22px;
  overflow: hidden;
  box-shadow: var(--vi-shadow-lg);
}

/* Colonne formulaire */
.login__form { padding: 1.75rem 2.25rem 2rem; display: flex; flex-direction: column; }
.login__top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.4rem; }
.login__back { font-size: 0.8rem; color: var(--vi-muted); display: inline-flex; align-items: center; gap: 0.35rem; }
.login__back:hover { color: var(--p-primary-color); }
.login__brand { display: flex; align-items: center; gap: 0.7rem; margin-bottom: 1.3rem; }
.login__mark {
  width: 46px; height: 46px; border-radius: 13px;
  background: var(--p-primary-color); color: #fff;
  font-family: var(--vi-serif); font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.login__brand strong { display: block; font-family: var(--vi-serif); }
.login__brand span { font-size: 0.75rem; color: var(--vi-muted); }

.login__tabs { display: flex; gap: 0.35rem; background: var(--vi-bg); padding: 0.3rem; border-radius: 12px; margin-bottom: 1.1rem; }
.login__tabs button {
  flex: 1; padding: 0.55rem; border: none; background: transparent; border-radius: 9px;
  cursor: pointer; font-weight: 600; color: var(--vi-muted); font-family: inherit; transition: 0.15s;
}
.login__tabs button.on { background: var(--vi-surface); color: var(--p-primary-color); box-shadow: 0 1px 4px rgba(0,0,0,0.12); }

.login__msg { margin-bottom: 0.9rem; }
form { display: flex; flex-direction: column; gap: 0.85rem; }
.login__logo { width: 46px; height: 46px; border-radius: 12px; object-fit: cover; display: block; }
.login__submit { width: 100%; margin-top: 0.4rem; }
.login__link {
  display: block; width: 100%; margin-top: 0.7rem; padding: 0.35rem;
  background: none; border: none; cursor: pointer; font-family: inherit;
  font-size: 0.82rem; color: var(--vi-muted); text-align: center;
}
.login__link:hover { color: var(--p-primary-color); text-decoration: underline; }
.login__sep { text-align: center; margin: 1.1rem 0 0.9rem; position: relative; color: var(--vi-muted); font-size: 0.8rem; }
.login__sep::before { content: ''; position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: var(--vi-border); }
.login__sep span { background: var(--vi-surface); padding: 0 0.6rem; position: relative; }
.login__google {
  width: 100%;
  display: inline-flex; align-items: center; justify-content: center; gap: 0.6rem;
  background: #fff; color: #3c4043;
  border: 1px solid #dadce0; border-radius: 8px;
  padding: 0.62rem 1rem; font-weight: 600; font-size: 0.92rem;
  font-family: 'Roboto', 'Inter', sans-serif; cursor: pointer; transition: 0.15s;
}
.login__google:hover { background: #f8f9fa; border-color: #d2d5da; box-shadow: 0 1px 3px rgba(60,64,67,0.18); }
.login__gicon { width: 18px; height: 18px; flex: 0 0 18px; }
.login__hint { margin: 1.1rem 0 0; font-size: 0.76rem; color: var(--vi-muted); text-align: center; }
.login__signup {
  margin: 1.3rem 0 0; padding-top: 1.1rem; border-top: 1px solid var(--vi-border);
  text-align: center; font-size: 0.85rem; color: var(--vi-muted);
}
.login__signup button {
  background: none; border: 0; padding: 0; margin-left: 0.3rem; cursor: pointer;
  font: inherit; font-weight: 700; color: var(--p-primary-color);
}
.login__signup button:hover { text-decoration: underline; }

/* Les champs d'identité poussent le formulaire au lieu d'ouvrir une page. */
.login__extra { overflow: hidden; }
.grow-enter-active, .grow-leave-active { transition: opacity 0.22s ease, max-height 0.3s ease; max-height: 300px; }
.grow-enter-from, .grow-leave-to { opacity: 0; max-height: 0; }

/* Colonne visuelle : image utilisateur (public/login-art.jpg) sinon placeholder brandé */
.login__art {
  position: relative;
  background-color: #16233f;
  background-image:
    linear-gradient(150deg, rgba(20,16,10,0.28) 0%, rgba(20,16,10,0.78) 100%),
    url('/login-art.jpg'),
    url('/login-placeholder.svg');
  background-size: cover;
  background-position: center;
}
.login__art-inner {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; justify-content: flex-end;
  padding: 2.4rem; color: #fff;
}
.login__art-kicker { font-size: 0.72rem; letter-spacing: 0.34em; text-transform: uppercase; color: #cda24e; font-weight: 700; }
.login__art-title { font-family: var(--vi-serif); font-size: 1.7rem; line-height: 1.18; margin: 0.5rem 0 0.5rem; color: #fff; }
.login__art-quote { margin: 0; color: rgba(255,255,255,0.82); font-size: 0.92rem; }

@media (max-width: 780px) {
  .login__card { grid-template-columns: 1fr; max-width: 440px; min-height: 0; }
  .login__art { display: none; }
}
</style>
