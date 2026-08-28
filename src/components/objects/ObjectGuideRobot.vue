<script setup>
import { ref, nextTick, watch } from 'vue'
import { ask } from '@/services/guideAgent'
import { useTts } from '@/services/tts'

// ROBOT ASSISTANT DU VISUALISEUR 3D
//
// Il n'est PAS affiché en permanence, et c'est le point de conception : une
// bulle d'aide toujours présente devient un décor qu'on ne voit plus. Celui-ci
// n'existe qu'à partir du moment où le visiteur a manipulé l'objet — cliqué
// dessus ou fait tourner la caméra. Ce geste est le signal qu'il regarde
// vraiment, et c'est lui qui autorise le robot à prendre la parole.
//
// Il ne réécrit ni l'IA ni la voix : `guideAgent.ask()` sait déjà interroger le
// corpus du locataire (avec repli local si l'Edge Function est indisponible), et
// `useTts()` sait déjà parler, en ElevenLabs ou par le navigateur selon le
// musée. Ce composant n'apporte que la mise en scène et le fil de conversation.

const props = defineProps({
  objet: { type: String, default: '' },      // titre de l'objet regardé
  museumId: { type: [String, Number], default: null },
  sectorId: { type: [String, Number], default: null }
})

const tts = useTts()

const visible = ref(false)
const reflechit = ref(false)
const question = ref('')
const fil = ref([])          // { role: 'guide' | 'visiteur', texte, liens }
const filEl = ref(null)
const voixActive = ref(true)

async function defiler() {
  await nextTick()
  if (filEl.value) filEl.value.scrollTop = filEl.value.scrollHeight
}

function dire(texte) {
  if (voixActive.value && tts.supported?.value !== false) {
    try { tts.speak(texte) } catch { /* la voix ne doit jamais bloquer le texte */ }
  }
}

/**
 * Le robot se manifeste. Appelé par le visualiseur au premier geste du visiteur.
 *
 * La salutation nomme l'objet : c'est ce qui fait la différence entre un
 * assistant générique et un guide qui regarde la même chose que vous. Elle est
 * écrite ici plutôt que demandée au modèle — on n'appelle pas une IA pour dire
 * bonjour, et le robot doit apparaître instantanément.
 */
function reveiller() {
  if (visible.value) return
  visible.value = true

  const nom = props.objet || 'cette pièce'
  const salut = `Bonjour. Je vois que vous examinez ${nom}. ` +
    `Demandez-moi ce que vous voulez savoir : à quoi elle servait, qui la fabriquait, ` +
    `d'où elle vient — ou faites-la tourner encore, je vous suis.`

  fil.value = [{ role: 'guide', texte: salut, liens: [] }]
  dire(salut)
  defiler()
}

function fermer() {
  visible.value = false
  try { tts.stop() } catch { /* rien à arrêter */ }
}

/**
 * Une question du visiteur.
 *
 * Le titre de l'objet est réinjecté dans la question : « à quoi ça sert ? » n'a
 * aucun sens pour l'agent hors contexte, alors que le visiteur, lui, a l'objet
 * sous les yeux et ne voit pas pourquoi il le renommerait.
 */
async function envoyer() {
  const q = question.value.trim()
  if (!q || reflechit.value) return

  fil.value.push({ role: 'visiteur', texte: q, liens: [] })
  question.value = ''
  reflechit.value = true
  defiler()

  const contextualisee = props.objet ? `À propos de « ${props.objet} » : ${q}` : q

  try {
    const r = await ask(contextualisee, {
      museumId: props.museumId || undefined,
      sectorId: props.sectorId || undefined
    })
    const texte = r?.text || "Je n'ai pas trouvé de quoi vous répondre sur cette pièce."
    fil.value.push({ role: 'guide', texte, liens: r?.links || [] })
    dire(texte)
  } catch {
    // L'agent a déjà un repli local ; si même lui échoue, on le dit plutôt que
    // de laisser le visiteur devant un robot muet.
    fil.value.push({
      role: 'guide',
      texte: "Je n'arrive pas à joindre mes sources pour l'instant. Réessayez dans un instant.",
      liens: []
    })
  } finally {
    reflechit.value = false
    defiler()
  }
}

function basculerVoix() {
  voixActive.value = !voixActive.value
  if (!voixActive.value) { try { tts.stop() } catch { /* déjà silencieux */ } }
}

// Changer d'objet remet le guide à zéro : le fil précédent parlait d'autre chose.
watch(() => props.objet, () => { if (visible.value) fermer() })

defineExpose({ reveiller, fermer, visible })
</script>

<template>
  <transition name="robot">
    <div v-if="visible" class="robot" role="complementary" aria-live="polite">

      <header class="robot__tete">
        <!-- L'avatar : un halo qui respire. Volontairement non figuratif —
             un visage réaliste raté est pire qu'une présence abstraite. -->
        <div class="robot__avatar" :class="{ 'robot__avatar--parle': tts.speaking?.value }">
          <span class="robot__visiere" />
        </div>
        <div class="robot__ident">
          <strong>{{ $t('objectGuide.name') }}</strong>
          <small>{{ objet || $t('objectGuide.fallbackObject') }}</small>
        </div>
        <button class="robot__ic" :title="$t('objectGuide.toggleVoice')" @click="basculerVoix">
          <i :class="voixActive ? 'pi pi-volume-up' : 'pi pi-volume-off'" />
        </button>
        <button class="robot__ic" :title="$t('objectGuide.close')" @click="fermer">
          <i class="pi pi-times" />
        </button>
      </header>

      <div ref="filEl" class="robot__fil">
        <div v-for="(m, i) in fil" :key="i" class="robot__msg" :class="`robot__msg--${m.role}`">
          <p>{{ m.texte }}</p>
          <a v-for="(l, j) in m.liens" :key="j" :href="l.to || l.href" class="robot__lien">
            <i class="pi pi-arrow-up-right" /> {{ l.label || l.title }}
          </a>
        </div>
        <div v-if="reflechit" class="robot__msg robot__msg--guide robot__pense">
          <span /><span /><span />
        </div>
      </div>

      <form class="robot__saisie" @submit.prevent="envoyer">
        <input
          v-model="question"
          type="text"
          :placeholder="$t('objectGuide.placeholder')"
          :disabled="reflechit"
        />
        <button type="submit" :disabled="reflechit || !question.trim()">
          <i class="pi pi-send" />
        </button>
      </form>
    </div>
  </transition>
</template>

<style scoped>
.robot {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: min(330px, calc(100% - 24px));
  display: flex;
  flex-direction: column;
  max-height: 88%;
  background: rgba(18, 16, 24, 0.93);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.42);
  color: #f3efe8;
  overflow: hidden;
  z-index: 5;
}

/* --- Tête --- */
.robot__tete {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.6rem 0.65rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.robot__avatar {
  position: relative;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #8fe3ff, var(--p-primary-color, #3aa0d8));
  box-shadow: 0 0 0 0 rgba(143, 227, 255, 0.55);
  animation: respire 3.4s ease-in-out infinite;
}
/* Quand il parle, le halo bat plus vite : le visiteur voit d'où vient la voix. */
.robot__avatar--parle { animation-duration: 1s; }
.robot__visiere {
  position: absolute;
  inset: 38% 22% auto;
  height: 5px;
  border-radius: 3px;
  background: rgba(9, 12, 18, 0.78);
}
@keyframes respire {
  0%, 100% { box-shadow: 0 0 0 0 rgba(143, 227, 255, 0.5); }
  50%      { box-shadow: 0 0 0 9px rgba(143, 227, 255, 0); }
}
.robot__ident { flex: 1; min-width: 0; line-height: 1.2; }
.robot__ident strong { display: block; font-size: 0.86rem; }
.robot__ident small {
  display: block;
  font-size: 0.72rem;
  opacity: 0.62;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.robot__ic {
  flex: none;
  width: 27px;
  height: 27px;
  border: none;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.08);
  color: #f3efe8;
  cursor: pointer;
  font-size: 0.76rem;
}
.robot__ic:hover { background: rgba(255, 255, 255, 0.16); }

/* --- Fil --- */
.robot__fil {
  flex: 1;
  overflow-y: auto;
  padding: 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 90px;
  max-height: 260px;
}
.robot__msg { max-width: 92%; }
.robot__msg p {
  margin: 0;
  padding: 0.5rem 0.7rem;
  border-radius: 11px;
  font-size: 0.82rem;
  line-height: 1.5;
}
.robot__msg--guide p { background: rgba(255, 255, 255, 0.09); }
.robot__msg--visiteur { align-self: flex-end; }
.robot__msg--visiteur p {
  background: var(--p-primary-color, #3aa0d8);
  color: #fff;
}
.robot__lien {
  display: inline-block;
  margin-top: 0.3rem;
  font-size: 0.75rem;
  color: #8fe3ff;
  text-decoration: none;
}

/* Trois points : le silence d'une IA qui réfléchit inquiète, il faut le montrer. */
.robot__pense { display: flex; gap: 4px; padding: 0.6rem 0.7rem; }
.robot__pense span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.55);
  animation: rebond 1.15s infinite;
}
.robot__pense span:nth-child(2) { animation-delay: 0.16s; }
.robot__pense span:nth-child(3) { animation-delay: 0.32s; }
@keyframes rebond {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
  30%           { transform: translateY(-5px); opacity: 1; }
}

/* --- Saisie --- */
.robot__saisie {
  display: flex;
  gap: 0.4rem;
  padding: 0.55rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
.robot__saisie input {
  flex: 1;
  min-width: 0;
  padding: 0.5rem 0.7rem;
  border-radius: 9px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: #f3efe8;
  font-size: 0.82rem;
}
.robot__saisie input::placeholder { color: rgba(243, 239, 232, 0.45); }
.robot__saisie button {
  flex: none;
  width: 36px;
  border: none;
  border-radius: 9px;
  background: var(--p-primary-color, #3aa0d8);
  color: #fff;
  cursor: pointer;
}
.robot__saisie button:disabled { opacity: 0.4; cursor: default; }

/* --- Apparition : il monte dans le champ, il ne surgit pas --- */
.robot-enter-active { transition: opacity 0.32s, transform 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.2); }
.robot-leave-active { transition: opacity 0.2s, transform 0.2s; }
.robot-enter-from,
.robot-leave-to { opacity: 0; transform: translateY(14px) scale(0.96); }

@media (max-width: 560px) {
  .robot { right: 8px; left: 8px; bottom: 8px; width: auto; }
  .robot__fil { max-height: 190px; }
}
</style>
