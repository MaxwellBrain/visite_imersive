<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ask } from '@/services/guideAgent'
import { useTts } from '@/services/tts'

const { t } = useI18n()

const props = defineProps({
  title: { type: String, default: '' },
  context: { type: String, default: '' },
  suggestions: { type: Array, default: () => [] },
  // Ancrage : réponses en rapport avec ce musée / cette salle
  museumId: { type: [Number, String], default: null },
  sectorId: { type: [Number, String], default: null },
  objectId: { type: [Number, String], default: null },
  // Voix de l'assistant (musée ou secteur) pour lire la réponse à voix haute
  voiceId: { type: String, default: null },
  ton: { type: String, default: 'neutre' },
  timbreVoix: { type: String, default: 'standard' },
  debit: { type: [Number, String], default: 1 },
  lang: { type: String, default: 'fr' }
})

const input = ref('')
const busy = ref(false)
const answer = ref(null)
const { supported: ttsOk, speaking: ttsSpeaking, speak: ttsSpeak, stop: ttsStop } = useTts()

function scope() {
  const s = {}
  if (props.museumId) s.museumId = Number(props.museumId)
  if (props.sectorId) s.sectorId = Number(props.sectorId)
  if (props.objectId) s.objectId = Number(props.objectId)
  return s
}

async function send(text) {
  const q = (text ?? input.value).trim()
  if (!q || busy.value) return
  input.value = q
  busy.value = true
  answer.value = null
  ttsStop()
  try {
    answer.value = await ask(props.context ? `${props.context} ${q}` : q, scope())
    // L'assistant répond à voix haute avec la voix configurée (musée/secteur).
    if (answer.value?.text) {
      ttsSpeak(answer.value.text, {
        lang: props.lang, rate: props.debit, timbre: props.timbreVoix, voiceId: props.voiceId || undefined
      })
    }
  } catch (e) {
    answer.value = { text: t('common.error'), links: [] }
  } finally {
    busy.value = false
  }
}

function replay() {
  if (ttsSpeaking.value) { ttsStop(); return }
  if (answer.value?.text) {
    ttsSpeak(answer.value.text, { lang: props.lang, rate: props.debit, timbre: props.timbreVoix, voiceId: props.voiceId || undefined })
  }
}
</script>

<template>
  <div class="gi">
    <div class="gi__head"><i class="pi pi-sparkles" /> {{ title || $t('guideInline.defaultTitle') }}</div>
    <div v-if="suggestions.length" class="gi__sugg">
      <button v-for="s in suggestions" :key="s" type="button" @click="send(s)">{{ s }}</button>
    </div>
    <form class="gi__form" @submit.prevent="send()">
      <input v-model="input" type="text" :placeholder="$t('guideInline.placeholder')" :disabled="busy" />
      <button type="submit" :disabled="busy || !input.trim()" :aria-label="$t('common.send')">
        <i :class="busy ? 'pi pi-spin pi-spinner' : 'pi pi-send'" />
      </button>
    </form>
    <div v-if="answer" class="gi__ans">
      <p>{{ answer.text }}</p>
      <button v-if="ttsOk" type="button" class="gi__replay" @click="replay">
        <i :class="ttsSpeaking ? 'pi pi-stop-circle' : 'pi pi-volume-up'" />
        {{ ttsSpeaking ? $t('voiceGuide.stop') : $t('audioguide.listen') }}
      </button>
      <div v-if="answer.links?.length" class="gi__links">
        <router-link v-for="(l, i) in answer.links" :key="i" :to="l.to">{{ l.label }} <i class="pi pi-arrow-right" /></router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gi { background: #fff; border: 1px solid #e7ddcf; border-left: 4px solid var(--gold, #cda24e); border-radius: 14px; padding: 1.1rem 1.2rem; }
.gi__head { display: flex; align-items: center; gap: 0.5rem; font-family: 'Fraunces', Georgia, serif; font-weight: 600; margin-bottom: 0.8rem; }
.gi__head i { color: var(--gold, #cda24e); }
.gi__sugg { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.8rem; }
.gi__sugg button { background: #faf7f2; border: 1px solid #e7ddcf; border-radius: 999px; padding: 0.35rem 0.75rem; font-size: 0.78rem; cursor: pointer; color: #4b4034; }
.gi__sugg button:hover { border-color: var(--gold, #cda24e); }
.gi__form { display: flex; gap: 0.5rem; }
.gi__form input { flex: 1; border: 1px solid #e7ddcf; border-radius: 10px; padding: 0.6rem 0.75rem; outline: none; font-family: inherit; }
.gi__form button { width: 44px; border: none; border-radius: 10px; background: var(--gold, #cda24e); color: #201607; cursor: pointer; }
.gi__form button:disabled { opacity: 0.5; cursor: default; }
.gi__ans { margin-top: 0.9rem; background: #faf7f2; border-radius: 10px; padding: 0.8rem 0.9rem; }
.gi__ans p { margin: 0; line-height: 1.55; font-size: 0.92rem; }
.gi__replay { display: inline-flex; align-items: center; gap: 0.35rem; margin-top: 0.5rem; background: transparent; border: 1px solid var(--gold, #cda24e); color: #7a5a1e; border-radius: 999px; padding: 0.3rem 0.7rem; font-size: 0.78rem; font-weight: 700; cursor: pointer; }
.gi__links { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 0.5rem; }
.gi__links a { font-weight: 700; font-size: 0.82rem; color: var(--site-primary, #a86b2d); }
</style>
