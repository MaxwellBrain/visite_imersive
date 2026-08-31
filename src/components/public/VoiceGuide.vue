<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import GuideInline from '@/components/public/GuideInline.vue'
import { pubAudioTracks } from '@/services/publicApi'
import { useAuthStore } from '@/stores/useAuthStore'
import { useTts } from '@/services/tts'

const props = defineProps({
  guide: { type: Object, required: true }, // objet complet renvoyé par get_guide
  museumName: { type: String, default: '' }
})

const { t } = useI18n()
const auth = useAuthStore()

const tracks = ref([])
const loading = ref(true)
const playingId = ref(null)
const lang = ref(props.guide.langues?.[0] || 'fr')
const { supported: supportsTTS, speaking: ttsSpeaking, speak: ttsSpeak, stop: ttsStop } = useTts()
// Fin de lecture (ou coupure) → on réinitialise le segment en cours.
watch(ttsSpeaking, (v) => { if (!v) playingId.value = null })

// ---- Personnalisation nominative ----
const firstName = computed(() => {
  const meta = auth.user?.user_metadata?.full_name
  if (meta) return meta.trim().split(/\s+/)[0]
  const email = auth.user?.email
  if (email) {
    const l = email.split('@')[0].split(/[._-]/)[0]
    return l ? l.charAt(0).toUpperCase() + l.slice(1) : ''
  }
  return ''
})
const greeting = computed(() => {
  if (props.guide.personnalisationNominative && firstName.value) {
    return (props.guide.modeleSalutation || 'Bonjour {prenom}, bienvenue au {musee}.')
      .replaceAll('{prenom}', firstName.value)
      .replaceAll('{musee}', props.museumName)
  }
  return t('voiceGuide.fallbackGreeting', { musee: props.museumName })
})
const introText = computed(() => [greeting.value, props.guide.scriptTexte].filter(Boolean).join(' '))

const dialogue = computed(() => props.guide.modeInteraction === 'narration_dialogue')
const langTracks = computed(() => {
  const f = tracks.value.filter((tr) => tr.langue === lang.value)
  return f.length ? f : tracks.value
})

function labelFor(tr) {
  if (tr.objects?.nom) return `${tr.objects.nom}`
  if (tr.sectors?.nom) return `${tr.sectors.nom}`
  return t('audioguide.intro')
}
function stop() {
  ttsStop()
  playingId.value = null
}
// Lecture via le service partagé : voix IA ElevenLabs (avec la voix choisie dans l'ERP)
// si le provider cloud est actif, sinon repli sur la voix du navigateur.
function speak(id, text) {
  if (playingId.value === id) { stop(); return }
  stop()
  if (!text) return
  playingId.value = id
  ttsSpeak(text, {
    provider: props.guide.provider,
    lang: lang.value,
    rate: props.guide.debit,
    timbre: props.guide.timbreVoix,
    voiceId: props.guide.voiceId || undefined
  })
}

onMounted(async () => {
  tracks.value = await pubAudioTracks(props.guide.id)
  loading.value = false
  // Le guide prend l'initiative de la parole (si le navigateur l'autorise après interaction).
  if (props.guide.sourceType === 'texte') {
    setTimeout(() => { try { speak('intro', introText.value) } catch { /* autoplay bloqué */ } }, 400)
  }
})
onBeforeUnmount(stop)
</script>

<template>
  <div class="vg">
    <div class="vg__head">
      <i class="pi pi-microphone" />
      <div class="vg__head-b">
        <strong>{{ guide.titre || $t('voiceGuide.title') }}</strong>
        <span class="vg__ok"><i class="pi pi-check-circle" /> {{ $t('voiceGuide.unlocked') }}</span>
      </div>
      <label v-if="guide.langues && guide.langues.length > 1" class="vg__lang">
        <i class="pi pi-globe" />
        <select v-model="lang" :aria-label="$t('voiceGuide.language')">
          <option v-for="l in guide.langues" :key="l" :value="l">{{ l.toUpperCase() }}</option>
        </select>
      </label>
    </div>

    <p v-if="loading" class="vg__muted">{{ $t('voiceGuide.loading') }}</p>

    <template v-else>
      <!-- Accueil & présentation -->
      <section class="vg__block">
        <h4 class="vg__title">{{ $t('voiceGuide.introTitle') }}</h4>

        <!-- Mode audio « tel quel » : lecteur natif du fichier importé -->
        <template v-if="guide.sourceType === 'audio' && guide.audioTraitement === 'tel_quel' && guide.audioSourceUrl">
          <audio class="vg__audio" controls preload="none" :src="guide.audioSourceUrl" />
        </template>

        <!-- Sinon : accueil nominatif + script lus par synthèse vocale -->
        <template v-else>
          <p class="vg__greeting">{{ greeting }}</p>
          <p v-if="guide.scriptTexte" class="vg__script">{{ guide.scriptTexte }}</p>
          <p v-if="guide.sourceType === 'audio' && guide.audioTraitement === 'inspiration'" class="vg__note">
            <i class="pi pi-sparkles" /> {{ $t('voiceGuide.inspirationNote') }}
          </p>
          <button v-if="supportsTTS" class="vg__btn" @click="speak('intro', introText)">
            <i :class="playingId === 'intro' ? 'pi pi-stop-circle' : 'pi pi-play-circle'" />
            {{ playingId === 'intro' ? $t('voiceGuide.stop') : $t('voiceGuide.listenGreeting') }}
          </button>
          <span v-else class="vg__muted">{{ $t('voiceGuide.unsupported') }}</span>
        </template>
      </section>

      <!-- La visite guidée : narration par salle / œuvre -->
      <section v-if="langTracks.length" class="vg__block">
        <h4 class="vg__title">{{ $t('voiceGuide.segmentsTitle') }}</h4>
        <ul class="vg__list">
          <li v-for="tr in langTracks" :key="tr.id" class="vg__seg" :class="{ 'is-playing': playingId === tr.id }">
            <div class="vg__seg-b">
              <span class="vg__seg-label">
                <i :class="tr.objects ? 'pi pi-box' : tr.sectors ? 'pi pi-sitemap' : 'pi pi-flag'" />
                {{ labelFor(tr) }}
              </span>
              <p v-if="tr.texte" class="vg__seg-text">{{ tr.texte }}</p>
            </div>
            <audio v-if="tr.fichier" class="vg__audio" controls preload="none" :src="tr.fichier" />
            <button v-else-if="supportsTTS && tr.texte" class="vg__btn vg__btn--sm" @click="speak(tr.id, tr.texte)">
              <i :class="playingId === tr.id ? 'pi pi-stop-circle' : 'pi pi-play-circle'" />
              {{ playingId === tr.id ? $t('voiceGuide.stop') : $t('audioguide.listen') }}
            </button>
          </li>
        </ul>
      </section>

      <!-- Dialogue : le guide répond aux questions (base de connaissances du musée) -->
      <section v-if="dialogue" class="vg__block">
        <GuideInline
          :title="$t('voiceGuide.askTitle')"
          :context="museumName"
          :suggestions="[$t('voiceGuide.sug1'), $t('voiceGuide.sug2')]"
          :museum-id="guide.museumId"
          :voice-id="guide.voiceId || undefined"
          :ton="guide.ton || 'neutre'"
          :timbre-voix="guide.timbreVoix || 'standard'"
          :debit="guide.debit || 1"
          :lang="lang"
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.vg { background: #fff; border: 1px solid #e7ddcf; border-left: 4px solid var(--gold, #cda24e); border-radius: 16px; padding: 1.1rem 1.2rem; }
.vg__head { display: flex; align-items: center; gap: 0.8rem; }
.vg__head > i { color: var(--gold, #cda24e); font-size: 1.5rem; }
.vg__head-b { display: flex; flex-direction: column; }
.vg__head-b strong { font-family: 'Fraunces', Georgia, serif; font-size: 1.1rem; }
.vg__ok { color: #3f8f5f; font-weight: 700; font-size: 0.8rem; }
.vg__lang { margin-left: auto; display: inline-flex; align-items: center; gap: 0.35rem; color: #6b6052; font-size: 0.85rem; }
.vg__lang select { border: 1px solid #e7ddcf; border-radius: 8px; padding: 0.25rem 0.4rem; font-family: inherit; background: #fff; }
.vg__muted { color: #897f70; font-size: 0.9rem; }
.vg__block { margin-top: 1rem; padding-top: 0.9rem; border-top: 1px solid #f0e8db; }
.vg__block:first-of-type { border-top: none; }
.vg__title { margin: 0 0 0.6rem; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--gold, #cda24e); font-weight: 800; }
.vg__greeting { margin: 0 0 0.4rem; font-weight: 700; color: #3a2f22; font-size: 1.02rem; }
.vg__script { margin: 0 0 0.7rem; line-height: 1.6; color: #4b4034; font-size: 0.92rem; }
.vg__note { margin: 0 0 0.6rem; font-size: 0.82rem; color: #897f70; }
.vg__note i { color: var(--gold, #cda24e); }
.vg__audio { width: 100%; margin-top: 0.3rem; }
.vg__btn { display: inline-flex; align-items: center; gap: 0.45rem; background: var(--gold, #cda24e); color: #201607; border: none; padding: 0.5rem 1rem; border-radius: 999px; font-weight: 700; cursor: pointer; font-size: 0.85rem; }
.vg__btn--sm { padding: 0.4rem 0.85rem; font-size: 0.8rem; }
.vg__btn:hover { transform: translateY(-1px); }
.vg__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
.vg__seg { border: 1px solid #efe7d9; border-radius: 12px; padding: 0.75rem 0.9rem; background: #fbf8f2; }
.vg__seg.is-playing { border-color: var(--gold, #cda24e); background: #fff; }
.vg__seg-label { font-weight: 700; color: #4b4034; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 0.4rem; }
.vg__seg-label i { color: var(--gold, #cda24e); }
.vg__seg-text { margin: 0.35rem 0 0.6rem; font-size: 0.88rem; line-height: 1.55; color: #6b6052; }
</style>
