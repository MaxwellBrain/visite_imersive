<script setup>
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { pubSendMessage } from '@/services/publicApi'
import { useAuthStore } from '@/stores/useAuthStore'

// Formulaire de contact du site public. Deux usages :
//   - libre : le visiteur écrit à l'institution (avec ou sans compte)
//   - rattaché à une commande : passer `orderId` — le fil arrive côté ERP marqué SAV
//
// L'anti-spam sérieux est en base (plafond horaire par adresse). Ici on ajoute
// seulement un honeypot : un champ invisible que les humains ne remplissent jamais
// et que les robots à remplissage automatique remplissent presque toujours.

const props = defineProps({
  orderId: { type: Number, default: null },
  sujetImpose: { type: String, default: '' },
  compact: { type: Boolean, default: false }
})

const { t } = useI18n()
const auth = useAuthStore()

const form = reactive({ nom: '', email: '', sujet: props.sujetImpose, message: '', piege: '' })
const sending = ref(false)
const sent = ref(false)
const error = ref('')

// Un visiteur connecté est déjà identifié : la fonction en base rattache le fil à
// son compte, inutile de lui redemander son nom et son adresse.
const connecte = computed(() => !!auth.user)

function reset() {
  form.sujet = props.sujetImpose
  form.message = ''
  form.piege = ''
  sent.value = false
}

async function submit() {
  error.value = ''
  if (form.piege) return                       // robot : on ne dit rien, on n'envoie rien
  if (!form.sujet.trim() || !form.message.trim()) { error.value = t('contact.errRequired'); return }
  if (!connecte.value && !form.email.trim()) { error.value = t('contact.errEmail'); return }

  sending.value = true
  try {
    await pubSendMessage({
      sujet: form.sujet.trim(),
      corps: form.message.trim(),
      nom: connecte.value ? null : form.nom.trim() || null,
      email: connecte.value ? null : form.email.trim() || null,
      orderId: props.orderId
    })
    sent.value = true
  } catch (e) {
    // Les codes viennent de la base ; tout autre cas retombe sur un message générique.
    const cles = ['trop_de_messages', 'email_invalide', 'email_requis', 'organisation_indisponible', 'commande_introuvable']
    error.value = cles.includes(e.message) ? t(`contact.err_${e.message}`) : t('contact.errGeneric')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <form class="cf ps-card" :class="{ 'cf--compact': compact }" @submit.prevent="submit">
    <div v-if="sent" class="cf-sent">
      <i class="pi pi-check-circle" />
      <strong>{{ $t('contact.thanks') }}</strong>
      <p>{{ $t('contact.thanksNote') }}</p>
      <button type="button" class="ps-link" @click="reset">{{ $t('contact.writeAnother') }}</button>
    </div>

    <template v-else>
      <template v-if="!compact">
        <h3 class="cf-title">{{ $t('contact.title') }}</h3>
        <p class="cf-lead">{{ $t('contact.lead') }}</p>
      </template>

      <template v-if="!connecte">
        <label class="cf-lbl" for="cf-nom">{{ $t('contact.fName') }}</label>
        <input id="cf-nom" v-model="form.nom" type="text" class="cf-in" maxlength="80"
               :placeholder="$t('contact.fNamePlaceholder')" autocomplete="name" />

        <label class="vi-req cf-lbl" for="cf-email">{{ $t('contact.fEmail') }}</label>
        <input id="cf-email" v-model="form.email" type="email" class="cf-in" maxlength="150"
               :placeholder="$t('contact.fEmailPlaceholder')" autocomplete="email" required />
      </template>

      <template v-if="!sujetImpose">
        <label class="vi-req cf-lbl" for="cf-sujet">{{ $t('contact.fSubject') }}</label>
        <input id="cf-sujet" v-model="form.sujet" type="text" class="cf-in" maxlength="200"
               :placeholder="$t('contact.fSubjectPlaceholder')" required />
      </template>

      <label class="vi-req cf-lbl" for="cf-msg">{{ $t('contact.fMessage') }}</label>
      <textarea id="cf-msg" v-model="form.message" class="cf-in cf-ta" rows="5" maxlength="5000"
                :placeholder="$t('contact.fMessagePlaceholder')" required />

      <!-- Honeypot : masqué aux humains, laissé accessible aux robots qui remplissent tout.
           aria-hidden + tabindex=-1 pour qu'aucun lecteur d'écran ne le propose. -->
      <div class="cf-hp" aria-hidden="true">
        <label for="cf-site">Site web</label>
        <input id="cf-site" v-model="form.piege" type="text" tabindex="-1" autocomplete="off" />
      </div>

      <p v-if="error" class="cf-err"><i class="pi pi-exclamation-triangle" /> {{ error }}</p>

      <button type="submit" class="ps-btn" :disabled="sending">
        <i :class="sending ? 'pi pi-spin pi-spinner' : 'pi pi-send'" /> {{ $t('contact.submit') }}
      </button>
      <p class="cf-note">{{ $t('contact.privacy') }}</p>
    </template>
  </form>
</template>

<style scoped>
.cf { padding: 1.4rem 1.5rem 1.5rem; display: flex; flex-direction: column; }
.cf--compact { padding: 1.1rem 1.2rem 1.2rem; }

.cf-title { font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase; font-size: 1.25rem; margin: 0 0 0.4rem; color: #101210; }
.cf-lead { color: #5c615c; font-size: 0.9rem; margin: 0 0 1.1rem; }

.cf-lbl { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #5c615c; margin-bottom: 0.4rem; }
.cf-in {
  border: 1px solid #dcdedb; border-radius: 6px; padding: 0.7rem 0.85rem;
  font-family: inherit; font-size: 0.95rem; color: #101210; margin-bottom: 1rem; width: 100%;
}
.cf-in:focus { outline: none; border-color: var(--site-primary, #0e6f5c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--site-primary) 15%, transparent); }
.cf-ta { resize: vertical; line-height: 1.55; }

/* Hors flux et hors champ, sans display:none — certains robots ignorent les champs masqués ainsi. */
.cf-hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }

.cf-err { color: #c0392b; font-size: 0.85rem; margin: 0 0 0.7rem; }
.cf-note { font-size: 0.76rem; color: #7c817b; margin: 0.8rem 0 0; text-align: center; }

.cf-sent { text-align: center; padding: 1.5rem 0.5rem; }
.cf-sent > i { font-size: 2.6rem; color: var(--site-primary, #0e6f5c); }
.cf-sent strong { display: block; font-size: 1.15rem; margin: 0.7rem 0 0.3rem; color: #101210; }
.cf-sent p { color: #5c615c; font-size: 0.88rem; margin: 0 0 1rem; }
.cf-sent .ps-link { background: none; border: none; cursor: pointer; font-family: inherit; }
</style>
