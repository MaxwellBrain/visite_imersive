<script setup>
// INSTALLATION DE LA PLATEFORME — désignation du super-admin.
//
// Cet écran n'existe QUE tant qu'aucun super-admin n'a été désigné. Dès qu'il y
// en a un, la porte se referme : c'est la condition du premier démarrage, et
// elle est vérifiée EN BASE (`amorcer_super_admin` refuse quoi qu'il arrive),
// pas seulement ici — une garde côté navigateur se contourne avec la console.
//
// Deux chemins, parce que les deux situations existent :
//   • créer un compte neuf ;
//   • se servir d'un compte déjà présent, dont on connaît le mot de passe.
// Le second évite l'impasse d'un compte existant dont le mot de passe est perdu :
// on prend celui qui fonctionne.
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import '@/assets/public-site.css'

const router = useRouter()
const auth = useAuthStore()

const etat = ref('verification')  // verification | ouvert | deja_configure | termine
const mode = ref('creer')         // creer | existant
const busy = ref(false)
const erreur = ref('')

const form = reactive({ fullName: '', email: '', password: '', passwordConfirm: '' })

const motsDePasseIdentiques = computed(() =>
  !!form.passwordConfirm && form.password === form.passwordConfirm)
const peutCreer = computed(() =>
  form.email.includes('@') && form.password.length >= 6 && motsDePasseIdentiques.value)
const peutEntrer = computed(() => form.email.includes('@') && form.password.length >= 1)

onMounted(async () => {
  const { data, error } = await supabase.rpc('plateforme_a_un_super_admin')
  if (error) { erreur.value = error.message; etat.value = 'ouvert'; return }
  etat.value = data ? 'deja_configure' : 'ouvert'
})

// La promotion est demandée à la base APRÈS l'ouverture de session : c'est
// `auth.uid()` qui désigne le compte promu, jamais une valeur venue du client.
async function reclamerLeRole() {
  const { data, error } = await supabase.rpc('amorcer_super_admin')
  if (error) throw new Error(error.message)
  const r = (data && data[0]) || {}
  if (!r.ok) throw new Error(r.raison || 'refus')
  await auth.fetchRole()
}

async function creerCompte() {
  erreur.value = ''
  if (form.password !== form.passwordConfirm) { erreur.value = 'mismatch'; return }
  if (!peutCreer.value) { erreur.value = 'incomplet'; return }
  busy.value = true
  try {
    await auth.signUp(form.email.trim(), form.password, form.fullName.trim())
    await reclamerLeRole()
    etat.value = 'termine'
  } catch (e) {
    // Le cas le plus courant : l'adresse est déjà prise. On oriente vers l'autre
    // chemin plutôt que de laisser l'utilisateur devant un message d'API.
    erreur.value = /already|exist|registered/i.test(e.message) ? 'email_pris' : e.message
  } finally {
    busy.value = false
  }
}

async function utiliserCompteExistant() {
  erreur.value = ''
  if (!peutEntrer.value) { erreur.value = 'incomplet'; return }
  busy.value = true
  try {
    await auth.signIn(form.email.trim(), form.password)
    await reclamerLeRole()
    etat.value = 'termine'
  } catch (e) {
    erreur.value = /invalid|credential/i.test(e.message) ? 'identifiants' : e.message
  } finally {
    busy.value = false
  }
}

function versTableauDeBord() { router.push('/dashboard') }
</script>

<template>
  <div class="sp">
    <header class="sp-top">
      <router-link to="/" class="sp-logo"><span class="sp-logo__mark">M</span> MUSÉA</router-link>
    </header>

    <main class="sp-main">
      <p v-if="etat === 'verification'" class="sp-attente">
        <i class="pi pi-spin pi-spinner" /> {{ $t('setup.checking') }}
      </p>

      <!-- Porte déjà franchie : on ne redonne pas les clés une seconde fois. -->
      <section v-else-if="etat === 'deja_configure'" class="sp-card ps-card sp-fin">
        <i class="pi pi-lock" />
        <h1>{{ $t('setup.closedTitle') }}</h1>
        <p>{{ $t('setup.closedLead') }}</p>
        <router-link to="/login" class="ps-btn">{{ $t('setup.goLogin') }}</router-link>
      </section>

      <section v-else-if="etat === 'termine'" class="sp-card ps-card sp-fin">
        <i class="pi pi-check-circle" />
        <h1>{{ $t('setup.doneTitle') }}</h1>
        <p>{{ $t('setup.doneLead') }}</p>
        <button class="ps-btn" @click="versTableauDeBord">{{ $t('setup.goDashboard') }}</button>
      </section>

      <section v-else class="sp-card ps-card">
        <h1>{{ $t('setup.title') }}</h1>
        <p class="sp-lead">{{ $t('setup.lead') }}</p>

        <div class="sp-onglets">
          <button :class="{ on: mode === 'creer' }" @click="mode = 'creer'; erreur = ''">
            {{ $t('setup.tabNew') }}
          </button>
          <button :class="{ on: mode === 'existant' }" @click="mode = 'existant'; erreur = ''">
            {{ $t('setup.tabExisting') }}
          </button>
        </div>

        <template v-if="mode === 'creer'">
          <label class="sp-lbl">{{ $t('setup.fName') }}</label>
          <input v-model="form.fullName" class="sp-in" type="text" :placeholder="$t('setup.fNamePlaceholder')" />

          <label class="vi-req sp-lbl">{{ $t('setup.fEmail') }}</label>
          <input v-model="form.email" class="sp-in" type="email" placeholder="vous@exemple.cm" autocomplete="username" />

          <label class="vi-req sp-lbl">{{ $t('setup.fPassword') }}</label>
          <input v-model="form.password" class="sp-in" type="password" autocomplete="new-password"
                 :placeholder="$t('setup.fPasswordPlaceholder')" />

          <label class="vi-req sp-lbl">{{ $t('setup.fPasswordConfirm') }}</label>
          <input v-model="form.passwordConfirm" class="sp-in" type="password" autocomplete="new-password"
                 :class="{ 'sp-in--bad': form.passwordConfirm && !motsDePasseIdentiques }" />
          <small v-if="form.passwordConfirm && !motsDePasseIdentiques" class="sp-bad">
            {{ $t('setup.errMismatch') }}
          </small>

          <p v-if="erreur" class="sp-err"><i class="pi pi-exclamation-triangle" /> {{ $t('setup.err_' + erreur, erreur) }}</p>
          <button class="ps-btn sp-btn" :disabled="busy || !peutCreer" @click="creerCompte">
            <i :class="busy ? 'pi pi-spin pi-spinner' : 'pi pi-shield'" /> {{ $t('setup.create') }}
          </button>
        </template>

        <template v-else>
          <p class="sp-note">{{ $t('setup.existingNote') }}</p>

          <label class="vi-req sp-lbl">{{ $t('setup.fEmail') }}</label>
          <input v-model="form.email" class="sp-in" type="email" autocomplete="username" />

          <label class="vi-req sp-lbl">{{ $t('setup.fPasswordExisting') }}</label>
          <input v-model="form.password" class="sp-in" type="password" autocomplete="current-password" />

          <p v-if="erreur" class="sp-err"><i class="pi pi-exclamation-triangle" /> {{ $t('setup.err_' + erreur, erreur) }}</p>
          <button class="ps-btn sp-btn" :disabled="busy || !peutEntrer" @click="utiliserCompteExistant">
            <i :class="busy ? 'pi pi-spin pi-spinner' : 'pi pi-shield'" /> {{ $t('setup.claim') }}
          </button>
        </template>

        <p class="sp-warn"><i class="pi pi-info-circle" /> {{ $t('setup.onceOnly') }}</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.sp { min-height: 100vh; background: #f6f7f5; color: #101210; font-family: 'Inter', system-ui, sans-serif; }
.sp-top { padding: 1rem clamp(1rem, 4vw, 3rem); background: #fff; border-bottom: 1px solid #e8e9e6; }
.sp-logo { display: inline-flex; align-items: center; gap: 0.6rem; font-family: 'Anton', sans-serif; font-size: 1.35rem; letter-spacing: 0.05em; color: #101210; text-decoration: none; }
.sp-logo__mark { width: 34px; height: 34px; border-radius: 50%; background: #101210; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1rem; }
.sp-main { max-width: 480px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
.sp-card { padding: 1.8rem 1.9rem 2rem; background: #fff; border: 1px solid #e8e9e6; border-radius: 12px; }
.sp-card h1 { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: 1.6rem; margin: 0 0 0.5rem; }
.sp-lead { color: #4a504a; font-size: 0.92rem; line-height: 1.6; margin: 0 0 1.4rem; }
.sp-attente { display: flex; align-items: center; gap: 0.6rem; color: #4a504a; }

.sp-onglets { display: flex; gap: 0.5rem; margin-bottom: 1.3rem; }
.sp-onglets button { flex: 1; padding: 0.6rem 0.8rem; border: 1px solid #d5d9d3; background: #fff; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 600; color: #4a504a; }
.sp-onglets button.on { background: #101210; color: #fff; border-color: #101210; }

.sp-lbl { display: block; font-size: 0.82rem; font-weight: 600; margin: 0 0 0.35rem; }
.sp-in { width: 100%; padding: 0.65rem 0.8rem; border: 1px solid #d5d9d3; border-radius: 6px; font-size: 0.95rem; margin-bottom: 1rem; background: #fff; }
.sp-in:focus { outline: 2px solid #0e6f5c; outline-offset: 1px; }
.sp-in--bad { border-color: #c0392b; }
.sp-bad { display: block; margin: -0.7rem 0 1rem; color: #c0392b; font-size: 0.8rem; }
.sp-note { font-size: 0.85rem; color: #4a504a; background: #f2f9f6; border: 1px solid #d9e5e0; border-radius: 8px; padding: 0.7rem 0.9rem; margin: 0 0 1.2rem; }
.sp-err { display: flex; align-items: center; gap: 0.4rem; color: #c0392b; font-size: 0.86rem; margin: 0 0 1rem; }
.sp-btn { width: 100%; justify-content: center; }
.sp-warn { display: flex; align-items: flex-start; gap: 0.45rem; margin: 1.2rem 0 0; font-size: 0.78rem; color: #7c817b; line-height: 1.5; }

.sp-fin { text-align: center; }
.sp-fin > i { font-size: 3rem; color: #0e6f5c; }
.sp-fin p { color: #4a504a; margin: 0.4rem 0 1.4rem; line-height: 1.6; }
</style>
