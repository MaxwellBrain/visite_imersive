<script setup>
import { ref, nextTick, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from 'primevue/button'
import Textarea from 'primevue/textarea'
import Message from 'primevue/message'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { useMuseumStore } from '@/stores/useMuseumStore'
import { useSectorStore } from '@/stores/useSectorStore'
import { useObjectStore } from '@/stores/useObjectStore'

// ASSISTANT D'INSTALLATION — le responsable décrit son institution, l'agent la crée.
//
// Parti pris d'affichage : ce qui fait foi, c'est la LISTE DES CRÉATIONS renvoyée par
// le serveur, pas le récapitulatif rédigé par le modèle. En essai, l'agent a annoncé
// deux œuvres alors qu'une seule avait été enregistrée : le texte peut broder, la
// liste vient des insertions réellement acceptées par la base. On montre donc les deux,
// mais c'est la liste qui porte la vérité.

const { t } = useI18n()
const auth = useAuthStore()
const museums = useMuseumStore()
const sectors = useSectorStore()
const objects = useObjectStore()

const messages = ref([])   // { role: 'user' | 'assistant', content, cree? }
const saisie = ref('')
const busy = ref(false)
const erreur = ref('')
const listeRef = ref()

const EXEMPLES = [
  'setupAgent.ex1',
  'setupAgent.ex2',
  'setupAgent.ex3'
]

onMounted(() => {
  messages.value = [{ role: 'assistant', content: t('setupAgent.hello', { nom: auth.tenant?.nom || '' }) }]
})

async function descendre() {
  await nextTick()
  if (listeRef.value) listeRef.value.scrollTop = listeRef.value.scrollHeight
}

async function envoyer(texte) {
  const q = (texte ?? saisie.value).trim()
  if (!q || busy.value) return
  erreur.value = ''
  messages.value.push({ role: 'user', content: q })
  saisie.value = ''
  busy.value = true
  await descendre()

  try {
    // On n'envoie que le fil utile : l'agent n'a pas besoin de son propre bilan.
    const historique = messages.value
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }))

    const { data, error } = await supabase.functions.invoke('setup-agent', { body: { messages: historique } })
    if (error) throw new Error(error.message)

    if (!data?.ok) {
      erreur.value = data?.error === 'no_api_key' ? t('setupAgent.errNoKey') : t('setupAgent.errAgent')
      // Une panne du modèle n'annule PAS ce qui a déjà été enregistré. On l'affiche
      // quand même, sinon l'utilisateur croit que rien n'a eu lieu et recrée en double.
      if (data?.cree?.length) {
        messages.value.push({ role: 'assistant', content: t('setupAgent.partial'), cree: data.cree })
        await Promise.all([museums.load(), sectors.load(), objects.load()])
      }
      return
    }

    messages.value.push({ role: 'assistant', content: data.message || '', cree: data.cree || [] })

    // Du contenu vient d'apparaître : on recharge les magasins pour que le reste
    // de l'ERP le voie immédiatement, sans que l'utilisateur ait à rafraîchir.
    if (data.cree?.length) {
      await Promise.all([museums.load(), sectors.load(), objects.load()])
    }
  } catch (e) {
    erreur.value = e.message
  } finally {
    busy.value = false
    await descendre()
  }
}

function icone(type) {
  if (type.startsWith('mus')) return 'pi-building'
  if (type.startsWith('salle')) return 'pi-sitemap'
  if (type.startsWith('œuvre')) return 'pi-box'
  return 'pi-palette'
}
</script>

<template>
  <div class="vi-page">
    <div class="vi-page__header">
      <div>
        <h1 class="vi-page__title">{{ $t('setupAgent.title') }}</h1>
        <p class="vi-page__subtitle">{{ $t('setupAgent.subtitle') }}</p>
      </div>
    </div>

    <div class="sa">
      <div ref="listeRef" class="sa__fil">
        <div v-for="(m, i) in messages" :key="i" class="sa__msg" :class="`sa__msg--${m.role}`">
          <p class="sa__txt">{{ m.content }}</p>

          <!-- Ce qui a RÉELLEMENT été enregistré (source : la base, pas le texte). -->
          <div v-if="m.cree?.length" class="sa__cree">
            <span class="sa__cree-t"><i class="pi pi-check-circle" /> {{ $t('setupAgent.created') }}</span>
            <ul>
              <li v-for="(c, j) in m.cree" :key="j">
                <i :class="`pi ${icone(c.type)}`" />
                <strong>{{ c.nom }}</strong>
                <span class="sa__cree-type">{{ c.type }}</span>
              </li>
            </ul>
          </div>
        </div>

        <div v-if="busy" class="sa__msg sa__msg--assistant">
          <p class="sa__txt sa__wait"><i class="pi pi-spin pi-spinner" /> {{ $t('setupAgent.working') }}</p>
        </div>
      </div>

      <div v-if="messages.length <= 1" class="sa__ex">
        <span class="sa__ex-t">{{ $t('setupAgent.examplesTitle') }}</span>
        <button v-for="k in EXEMPLES" :key="k" type="button" @click="envoyer($t(k))">{{ $t(k) }}</button>
      </div>

      <Message v-if="erreur" severity="warn" :closable="false" class="sa__err">{{ erreur }}</Message>

      <form class="sa__form" @submit.prevent="envoyer()">
        <Textarea
          v-model="saisie"
          rows="2"
          auto-resize
          :placeholder="$t('setupAgent.placeholder')"
          :disabled="busy"
          @keydown.enter.exact.prevent="envoyer()"
        />
        <Button type="submit" icon="pi pi-send" :loading="busy" :disabled="!saisie.trim()"
                :aria-label="$t('common.send')" />
      </form>

      <p class="sa__note">
        <i class="pi pi-shield" /> {{ $t('setupAgent.securityNote') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.sa { max-width: 860px; }
.sa__fil {
  background: var(--vi-surface, #fff); border: 1px solid var(--vi-border, #E9EDF2);
  border-radius: 14px; padding: 1.2rem; min-height: 320px; max-height: 52vh; overflow-y: auto;
  display: flex; flex-direction: column; gap: 0.9rem;
}
.sa__msg { max-width: 88%; }
.sa__msg--user { align-self: flex-end; }
.sa__txt { margin: 0; padding: 0.7rem 0.95rem; border-radius: 12px; line-height: 1.6; font-size: 0.93rem; white-space: pre-wrap; }
.sa__msg--assistant .sa__txt { background: var(--vi-surface-2, #F1F3F6); color: var(--vi-text, #1B2A4A); }
.sa__msg--user .sa__txt { background: var(--p-primary-color); color: #fff; }
.sa__wait { color: var(--vi-muted, #6B7280); display: flex; align-items: center; gap: 0.5rem; }

.sa__cree { margin-top: 0.55rem; border: 1px solid #cfe3d4; background: #f3f9f4; border-radius: 10px; padding: 0.6rem 0.8rem; }
.sa__cree-t { display: flex; align-items: center; gap: 0.4rem; font-size: 0.76rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #2f7d4a; }
.sa__cree ul { list-style: none; margin: 0.45rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.sa__cree li { display: flex; align-items: center; gap: 0.5rem; font-size: 0.87rem; }
.sa__cree li i { color: #2f7d4a; }
.sa__cree-type { color: var(--vi-muted, #6B7280); font-size: 0.78rem; }

.sa__ex { display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: center; margin-top: 0.9rem; }
.sa__ex-t { font-size: 0.78rem; color: var(--vi-muted, #6B7280); font-weight: 700; }
.sa__ex button {
  background: var(--vi-surface, #fff); border: 1px solid var(--vi-border, #E9EDF2);
  border-radius: 999px; padding: 0.4rem 0.8rem; font-size: 0.8rem; cursor: pointer;
  color: var(--vi-text, #1B2A4A); font-family: inherit;
}
.sa__ex button:hover { border-color: var(--p-primary-color); }

.sa__err { margin-top: 0.8rem; }
.sa__form { display: flex; gap: 0.6rem; align-items: flex-end; margin-top: 0.9rem; }
.sa__form :deep(textarea) { flex: 1; }
.sa__note { margin-top: 0.8rem; font-size: 0.78rem; color: var(--vi-muted, #6B7280); display: flex; align-items: flex-start; gap: 0.45rem; line-height: 1.5; }
.sa__note i { color: var(--p-primary-color); margin-top: 0.15rem; }
</style>
