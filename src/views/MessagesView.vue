<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import SelectButton from 'primevue/selectbutton'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { useMessageStore } from '@/stores/useMessageStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { sendMessageReply } from '@/services/emailApi'

// Boîte de réception : les messages reçus par l'organisation, et la réponse.
// Répondre fait DEUX choses : la réponse est jointe au fil (elle reste consultable
// dans l'espace client du visiteur) et elle part par e-mail aux couleurs du site.
// Si l'e-mail ne part pas — aucune clé d'envoi posée, par exemple — le fil garde la
// réponse et l'affiche comme non acheminée : rien n'est perdu, et cela se voit.

const { t, locale } = useI18n()
const store = useMessageStore()
const settings = useSettingsStore()
const auth = useAuthStore()
const confirm = useConfirm()
const toast = useToast()

const filtre = ref('a_traiter')
const brouillon = ref('')
const envoiEnCours = ref(false)

onMounted(() => {
  store.load()
  if (!settings.settings) settings.load(auth.tenantId)
})

const filtres = computed(() => [
  { label: t('admin.messages.filterTodo'), value: 'a_traiter' },
  { label: t('admin.messages.filterAll'), value: 'tous' },
  { label: t('admin.messages.filterDone'), value: 'traite' },
  { label: t('admin.messages.filterSpam'), value: 'spam' }
])

const liste = computed(() => {
  const tous = store.items
  if (filtre.value === 'tous') return tous.filter((m) => m.statut !== 'spam')
  if (filtre.value === 'traite') return tous.filter((m) => m.statut === 'traite')
  if (filtre.value === 'spam') return tous.filter((m) => m.statut === 'spam')
  return tous.filter((m) => m.statut === 'nouveau' || m.statut === 'en_cours')
})

const filOuvert = computed(() => store.items.find((m) => m.id === store.openId) || null)

// Le tout premier échange est la question d'origine : on la cite dans l'e-mail
// de réponse pour que le visiteur retrouve son contexte.
const questionOrigine = computed(() => store.replies.find((r) => r.auteur === 'visiteur')?.corps || '')

const canalLabel = (c) => ({
  public: t('admin.messages.canalPublic'),
  commande: t('admin.messages.canalOrder'),
  plateforme: t('admin.messages.canalPlatform')
}[c] || c)

const canalSeverity = (c) => ({ public: 'info', commande: 'warn', plateforme: 'contrast' }[c] || 'secondary')
const statutSeverity = (s) => ({ nouveau: 'danger', en_cours: 'warn', traite: 'success', spam: 'secondary' }[s] || 'secondary')

function fmt(d) {
  if (!d) return '—'
  return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-GB' : 'fr-FR', {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(d))
}

function expediteur(m) {
  return m.expediteurNom || m.expediteurEmail || t('admin.messages.anonymous')
}

function ouvrir(m) {
  brouillon.value = ''
  store.open(m.id)
}

async function changerStatut(statut) {
  try {
    await store.setStatut(filOuvert.value.id, statut)
    toast.add({ severity: 'success', summary: t('admin.messages.statusChanged'), life: 2000 })
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.messages.failed'), detail: e.message, life: 3500 })
  }
}

// Envoi de la réponse : on tente d'abord l'e-mail, puis on journalise le fil avec
// l'issue réelle de cet envoi. L'ordre compte — le fil doit dire la vérité.
async function repondre() {
  const corps = brouillon.value.trim()
  if (!corps || !filOuvert.value) return
  envoiEnCours.value = true
  const m = filOuvert.value

  let achemine = false
  const destinataire = m.expediteurEmail
  if (destinataire) {
    achemine = await sendMessageReply({
      to: destinataire,
      prenom: (m.expediteurNom || '').trim().split(/\s+/)[0] || '',
      sujet: m.sujet,
      contenu: corps,
      question: questionOrigine.value,
      lien: `${window.location.origin}/site/compte`,
      tenantId: auth.tenantId,
      settings: settings.settings,
      tenant: auth.tenant
    })
  }

  try {
    await store.reply(m.id, corps, { emailEnvoye: achemine })
    brouillon.value = ''
    if (achemine) {
      toast.add({ severity: 'success', summary: t('admin.messages.replySent'), life: 3000 })
    } else {
      toast.add({
        severity: 'warn',
        summary: t('admin.messages.replySavedOnly'),
        detail: destinataire ? t('admin.messages.replyNoMailHint') : t('admin.messages.replyNoAddress'),
        life: 6000
      })
    }
  } catch (e) {
    toast.add({ severity: 'error', summary: t('admin.messages.failed'), detail: e.message, life: 3500 })
  }
  envoiEnCours.value = false
}

function supprimer(m) {
  confirm.require({
    message: t('admin.messages.deleteConfirm', { name: m.sujet }),
    header: t('admin.messages.confirm'), icon: 'pi pi-exclamation-triangle',
    rejectLabel: t('admin.common.cancel'), acceptLabel: t('admin.common.delete'), acceptClass: 'p-button-danger',
    accept: async () => {
      try { await store.remove(m.id); toast.add({ severity: 'info', summary: t('admin.messages.deleted'), life: 2000 }) }
      catch (e) { toast.add({ severity: 'error', summary: t('admin.messages.failed'), detail: e.message, life: 3500 }) }
    }
  })
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('admin.messages.title') }}</h1>
        <p class="vi-page__subtitle">
          {{ $t('admin.messages.subtitle', { n: store.items.length, u: store.unreadCount }) }}
        </p>
      </div>
    </div>

    <SelectButton v-model="filtre" :options="filtres" option-label="label" option-value="value"
                  :allow-empty="false" class="m-filters" />

    <div class="m-layout">
      <!-- Liste des fils -->
      <div class="m-list">
        <div v-if="store.loading" class="m-empty"><i class="pi pi-spin pi-spinner" /></div>
        <div v-else-if="!liste.length" class="vi-empty">
          <i class="pi pi-inbox" />
          <strong>{{ $t('admin.messages.emptyTitle') }}</strong>
          <p>{{ $t('admin.messages.empty') }}</p>
        </div>
        <button v-for="m in liste" :key="m.id" type="button"
                class="m-item" :class="{ 'is-open': m.id === store.openId, 'is-unread': !m.lu }"
                @click="ouvrir(m)">
          <div class="m-item__top">
            <span class="m-item__from">{{ expediteur(m) }}</span>
            <span class="m-item__date">{{ fmt(m.dernierMessageAt) }}</span>
          </div>
          <div class="m-item__subject">{{ m.sujet }}</div>
          <div class="m-item__tags">
            <Tag :value="canalLabel(m.canal)" :severity="canalSeverity(m.canal)" />
            <Tag :value="$t(`admin.messages.status_${m.statut}`)" :severity="statutSeverity(m.statut)" />
            <span v-if="m.orderId" class="m-item__order">{{ $t('admin.messages.orderRef', { n: m.orderId }) }}</span>
          </div>
        </button>
      </div>

      <!-- Conversation -->
      <div class="m-thread">
        <div v-if="!filOuvert" class="vi-empty">
          <i class="pi pi-comments" />
          <strong>{{ $t('admin.messages.pickTitle') }}</strong>
          <p>{{ $t('admin.messages.pick') }}</p>
        </div>

        <template v-else>
          <div class="m-thread__head">
            <div>
              <h2 class="m-thread__subject">{{ filOuvert.sujet }}</h2>
              <p class="m-thread__meta">
                {{ expediteur(filOuvert) }}
                <template v-if="filOuvert.expediteurEmail"> · {{ filOuvert.expediteurEmail }}</template>
                · {{ fmt(filOuvert.createdAt) }}
              </p>
            </div>
            <div class="row-actions">
              <Button v-if="filOuvert.statut !== 'traite'" icon="pi pi-check" text rounded
                      :aria-label="$t('admin.messages.markDone')" @click="changerStatut('traite')" />
              <Button v-if="filOuvert.statut !== 'spam'" icon="pi pi-ban" text rounded
                      :aria-label="$t('admin.messages.markSpam')" @click="changerStatut('spam')" />
              <Button icon="pi pi-trash" text rounded severity="danger"
                      :aria-label="$t('admin.common.delete')" @click="supprimer(filOuvert)" />
            </div>
          </div>

          <div class="m-bubbles">
            <div v-for="r in store.replies" :key="r.id"
                 class="m-bubble" :class="`m-bubble--${r.auteur === 'visiteur' ? 'in' : 'out'}`">
              <div class="m-bubble__body">{{ r.corps }}</div>
              <div class="m-bubble__foot">
                {{ fmt(r.createdAt) }}
                <template v-if="r.auteur !== 'visiteur'">
                  · <span :class="r.emailEnvoye ? 'is-ok' : 'is-warn'">
                      {{ r.emailEnvoye ? $t('admin.messages.mailed') : $t('admin.messages.notMailed') }}
                    </span>
                </template>
              </div>
            </div>
          </div>

          <div class="m-reply">
            <Textarea v-model="brouillon" rows="4" auto-resize
                      :placeholder="$t('admin.messages.replyPlaceholder')" />
            <div class="m-reply__foot">
              <small v-if="!filOuvert.expediteurEmail" class="m-reply__warn">
                {{ $t('admin.messages.replyNoAddress') }}
              </small>
              <small v-else class="m-reply__hint">
                {{ $t('admin.messages.replyHint', { email: filOuvert.expediteurEmail }) }}
              </small>
              <Button :label="$t('admin.messages.reply')" icon="pi pi-send"
                      :disabled="!brouillon.trim()" :loading="envoiEnCours" @click="repondre" />
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.m-filters { margin-bottom: 1rem; }

.m-layout {
  display: grid;
  grid-template-columns: minmax(0, 22rem) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}
@media (max-width: 900px) {
  .m-layout { grid-template-columns: minmax(0, 1fr); }
}

.m-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 70vh;
  overflow-y: auto;
}
.m-empty { padding: 2rem; text-align: center; color: var(--vi-muted, #6B7280); }

.m-item {
  display: block;
  width: 100%;
  text-align: left;
  cursor: pointer;
  background: var(--p-content-background, #fff);
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-radius: 10px;
  padding: 0.7rem 0.8rem;
  font: inherit;
  color: inherit;
}
.m-item:hover { border-color: var(--p-primary-color, #0e6f5c); }
.m-item.is-open { border-color: var(--p-primary-color, #0e6f5c); box-shadow: 0 0 0 1px var(--p-primary-color, #0e6f5c) inset; }
/* Le non-lu se signale par une barre latérale, lisible sans dépendre de la couleur seule. */
.m-item.is-unread { border-left: 3px solid var(--p-primary-color, #0e6f5c); }
.m-item.is-unread .m-item__subject { font-weight: 700; }

.m-item__top { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.78rem; color: var(--vi-muted, #6B7280); }
.m-item__from { font-weight: 600; color: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-item__date { white-space: nowrap; }
.m-item__subject { margin: 0.25rem 0 0.4rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-item__tags { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
.m-item__order { font-size: 0.72rem; color: var(--vi-muted, #6B7280); }

.m-thread {
  background: var(--p-content-background, #fff);
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-radius: 12px;
  padding: 1rem 1.1rem;
  min-height: 24rem;
}
.m-thread__head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
.m-thread__subject { margin: 0; font-size: 1.1rem; }
.m-thread__meta { margin: 0.2rem 0 0; font-size: 0.82rem; color: var(--vi-muted, #6B7280); }

.m-bubbles {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  margin: 1.1rem 0;
  max-height: 42vh;
  overflow-y: auto;
}
.m-bubble { max-width: 85%; border-radius: 12px; padding: 0.65rem 0.85rem; }
.m-bubble--in  { align-self: flex-start; background: var(--p-surface-100, #f3f4f6); }
.m-bubble--out { align-self: flex-end; background: color-mix(in srgb, var(--p-primary-color, #0e6f5c) 12%, transparent); }
.m-bubble__body { white-space: pre-wrap; line-height: 1.55; font-size: 0.92rem; }
.m-bubble__foot { margin-top: 0.3rem; font-size: 0.72rem; color: var(--vi-muted, #6B7280); }
.m-bubble__foot .is-ok { color: var(--p-green-600, #16a34a); }
.m-bubble__foot .is-warn { color: var(--p-orange-600, #ea580c); }

.m-reply { border-top: 1px solid var(--p-content-border-color, #e5e7eb); padding-top: 0.8rem; }
.m-reply :deep(textarea) { width: 100%; }
.m-reply__foot { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-top: 0.6rem; flex-wrap: wrap; }
.m-reply__hint { color: var(--vi-muted, #6B7280); }
.m-reply__warn { color: var(--p-orange-600, #ea580c); }
</style>
