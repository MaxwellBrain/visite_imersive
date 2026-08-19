<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { demoModelUrl, demoModelInfo } from '@/services/glb'
import { qrSvg } from '@/services/qrcode'
import { chargerModelViewer } from '@/services/modelViewer'
import { useTts } from '@/services/tts'

// RÉALITÉ AUGMENTÉE — « Retour au pays ».
//
// La thèse du projet en dix secondes : on pointe le sol de la cour de la
// chefferie et l'objet exilé réapparaît, à sa taille réelle. D'où deux partis pris :
//
//   1. ar-scale="fixed" — l'objet garde ses dimensions réelles. Le mode « auto »
//      laisserait le visiteur l'agrandir, et le propos tomberait à plat.
//   2. Sur ordinateur, la RA est indisponible : au lieu d'un bouton grisé, on
//      affiche un QR. Le jury scanne, l'objet apparaît dans la salle. C'est
//      précisément le scénario d'une soutenance assistée par ordinateur.

const props = defineProps({
  objet: { type: Object, default: null },
  // Variante du modèle de démonstration quand l'objet n'a pas encore été numérisé.
  variante: { type: String, default: 'tabouret' },
  // Adresse à encoder dans le QR ; par défaut la page RA autonome de cet objet.
  lienMobile: { type: String, default: '' },
  compact: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const { t } = useI18n()
const { speaking: ttsSpeaking, speak: ttsSpeak, stop: ttsStop } = useTts()

const mv = ref(null)
const arPossible = ref(null) // null = on ne sait pas encore
const charge = ref(false)
const statut = ref('')
const dimensions = ref(null)
const erreur = ref('')

// Modèle réellement affiché : celui de l'objet s'il existe, sinon la pièce de
// démonstration générée en mémoire. Une URL `blob:` héritée d'une ancienne
// version de l'ERP ne survit pas au rechargement : on la traite comme absente.
const modeleReel = computed(() => {
  const m = props.objet?.model3d || ''
  return m && !m.startsWith('blob:') ? m : ''
})
const demo = computed(() => !modeleReel.value)
const src = computed(() => modeleReel.value || demoModelUrl(props.variante))
const titre = computed(() => props.objet?.nom || demoModelInfo(props.variante).nom)

// iOS ne lit QUE le .usdz : sans lui, Quick Look refuse et le bouton RA ne
// s'affiche pas sur iPhone, quel que soit l'hébergement.
const srcIos = computed(() => {
  const u = props.objet?.model3d_ios || ''
  return u && !u.startsWith('blob:') ? u : ''
})
// Un tabouret se pose au sol, un masque s'accroche au mur. Sans cette
// distinction, model-viewer suppose le sol et couche les masques par terre.
const placement = computed(() => (props.objet?.ar_placement === 'wall' ? 'wall' : 'floor'))
// Correctif d'unité : un scan exporté en centimètres arriverait cent fois trop grand.
const echelle = computed(() => {
  const e = Number(props.objet?.ar_echelle)
  return Number.isFinite(e) && e > 0 ? e : 1
})
const echelleAttr = computed(() => `${echelle.value} ${echelle.value} ${echelle.value}`)

const hauteurCm = computed(() => {
  if (dimensions.value) return Math.round(dimensions.value.y * 100)
  return demo.value ? Math.round(demoModelInfo(props.variante).hauteur * 100) : null
})

const lien = computed(() => {
  if (props.lienMobile) return props.lienMobile
  if (typeof window === 'undefined') return ''
  return window.location.href
})
// Sur un poste de développement, l'adresse est en localhost : un téléphone ne
// la joindra pas. On le dit plutôt que de laisser le jury scanner dans le vide.
const lienLocal = computed(() => /localhost|127\.0\.0\.1/.test(lien.value))

// Le QR n'a de sens que sur un ORDINATEUR : afficher un code à scanner sur un
// téléphone qui est déjà la bonne machine serait absurde. Quand la RA échoue sur
// un mobile, la cause est presque toujours l'une des deux ci-dessous, et le
// visiteur mérite qu'on la lui nomme.
const surMobile = computed(() =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 820)
)
const surIos = computed(() =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
)
const nonSecurise = computed(() =>
  typeof window !== 'undefined' && !window.isSecureContext
)
const qr = computed(() => {
  try { return qrSvg(lien.value, { size: 190 }) } catch { return '' }
})

// ---------------------------------------------------------------- cycle ----
let poll = null
async function detecter() {
  const el = mv.value
  if (!el) return
  try { await customElements.whenDefined('model-viewer') } catch { /* ignore */ }
  // `canActivateAR` n'est fiable qu'une fois le composant initialisé : on
  // interroge quelques fois plutôt que de trancher trop tôt et d'afficher un QR
  // à un visiteur qui, lui, pourrait très bien lancer la RA.
  let essais = 0
  poll = setInterval(() => {
    if (!mv.value) return
    const ok = mv.value.canActivateAR
    if (ok || ++essais > 12) {
      arPossible.value = !!ok
      clearInterval(poll)
      poll = null
    }
  }, 250)
}

function onLoad() {
  charge.value = true
  erreur.value = ''
  try { dimensions.value = mv.value?.getDimensions?.() || null } catch { dimensions.value = null }
}
function onError() {
  erreur.value = t('ar.loadFailed')
  charge.value = true
}
function onArStatus(e) {
  statut.value = e?.detail?.status || ''
}

function lancerAr() {
  try { mv.value?.activateAR() } catch { erreur.value = t('ar.launchFailed') }
}

function raconter() {
  if (ttsSpeaking.value) { ttsStop(); return }
  const o = props.objet
  const texte = [
    titre.value,
    o?.description || (demo.value ? t('ar.demoStory') : ''),
    hauteurCm.value ? t('ar.spokenHeight', { n: hauteurCm.value }) : ''
  ].filter(Boolean).join('. ')
  ttsSpeak(texte, { lang: 'fr' })
}

// Cette vue EXISTE pour montrer un modele : le charger des son montage est
// justifie, contrairement au chargement global qui frappait toutes les pages.
onMounted(() => { chargerModelViewer().catch(() => {}); nextTick(detecter) })
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
  ttsStop()
})
watch(() => props.objet?.id, () => { charge.value = false; dimensions.value = null; erreur.value = '' })
</script>

<template>
  <div class="arv" :class="{ 'arv--compact': compact }">
    <div class="arv__stage">
      <model-viewer
        ref="mv"
        :src="src"
        :alt="titre"
        camera-controls
        auto-rotate
        auto-rotate-delay="2500"
        rotation-per-second="14deg"
        :ios-src="srcIos || undefined"
        :ar-placement="placement"
        :scale="echelleAttr"
        ar
        ar-modes="webxr scene-viewer quick-look"
        ar-scale="fixed"
        loading="eager"
        reveal="auto"
        shadow-intensity="1.4"
        shadow-softness="0.9"
        exposure="1.05"
        environment-image="neutral"
        touch-action="pan-y"
        class="arv__mv"
        @load="onLoad"
        @error="onError"
        @ar-status="onArStatus"
      >
        <!-- Annotations ancrées sur le maillage : elles ne valent que pour la
             pièce de démonstration, dont on connaît la géométrie. -->
        <template v-if="demo">
          <button slot="hotspot-1" class="arv__pin" data-position="0 0.52 0" data-normal="0 1 0">
            <span>{{ $t('ar.pinSeat') }}</span>
          </button>
          <button slot="hotspot-2" class="arv__pin" data-position="0.09 0.24 0" data-normal="1 0 0">
            <span>{{ $t('ar.pinShaft') }}</span>
          </button>
        </template>

        <button slot="ar-button" class="arv__arbtn">
          <i class="pi pi-mobile" /> {{ $t('ar.launch') }}
        </button>

        <div slot="progress-bar" class="arv__load" :class="{ on: !charge }">
          <i class="pi pi-spin pi-spinner" /> {{ $t('ar.loading') }}
        </div>
      </model-viewer>

      <span v-if="hauteurCm" class="arv__scale">
        <i class="pi pi-arrows-v" /> {{ $t('ar.realHeight', { n: hauteurCm }) }}
      </span>
      <span v-if="demo" class="arv__demo"><i class="pi pi-info-circle" /> {{ $t('ar.demoModel') }}</span>
      <button v-if="compact" class="arv__x" :aria-label="$t('common.close')" @click="emit('close')">
        <i class="pi pi-times" />
      </button>
    </div>

    <div class="arv__side">
      <span class="arv__over">{{ $t('ar.over') }}</span>
      <h2>{{ titre }}</h2>
      <p class="arv__lead">{{ $t('ar.lead') }}</p>

      <!-- Chemin d'accès à la RA : soit on la lance, soit on passe au téléphone -->
      <div v-if="arPossible === true" class="arv__go">
        <button class="ps-btn" @click="lancerAr"><i class="pi pi-mobile" /> {{ $t('ar.launch') }}</button>
        <small>{{ $t('ar.launchHint') }}</small>
      </div>

      <!-- Sur ordinateur : on passe la main au téléphone par un QR. -->
      <div v-else-if="arPossible === false && !surMobile" class="arv__qr">
        <div class="arv__qrimg" v-html="qr" />
        <div class="arv__qrtxt">
          <strong>{{ $t('ar.qrTitle') }}</strong>
          <span>{{ $t('ar.qrText') }}</span>
          <small v-if="lienLocal" class="arv__warn"><i class="pi pi-exclamation-triangle" /> {{ $t('ar.qrLocalhost') }}</small>
          <code v-else>{{ lien }}</code>
        </div>
      </div>

      <!-- Sur téléphone : on nomme la raison du refus au lieu d'un QR inutile. -->
      <div v-else-if="arPossible === false" class="arv__nope">
        <i class="pi pi-info-circle" />
        <div>
          <strong>{{ $t('ar.unavailable') }}</strong>
          <span v-if="nonSecurise">{{ $t('ar.needHttps') }}</span>
          <span v-else-if="surIos && !srcIos">{{ $t('ar.needIos') }}</span>
          <span v-else-if="surIos">{{ $t('ar.needIosOther') }}</span>
          <span v-else>{{ $t('ar.needArcore') }}</span>
        </div>
      </div>

      <p v-else class="arv__checking"><i class="pi pi-spin pi-spinner" /> {{ $t('ar.checking') }}</p>

      <div class="arv__actions">
        <button class="ps-btn ps-btn--sm ps-btn--line" @click="raconter">
          <i :class="ttsSpeaking ? 'pi pi-stop' : 'pi pi-volume-up'" />
          {{ ttsSpeaking ? $t('tour.stopGuide') : $t('ar.narrate') }}
        </button>
        <slot name="actions" />
      </div>

      <p v-if="statut === 'session-started'" class="arv__status"><i class="pi pi-check-circle" /> {{ $t('ar.statusStarted') }}</p>
      <p v-else-if="statut === 'object-placed'" class="arv__status"><i class="pi pi-check-circle" /> {{ $t('ar.statusPlaced') }}</p>
      <p v-else-if="statut === 'failed'" class="arv__status arv__status--ko"><i class="pi pi-times-circle" /> {{ $t('ar.statusFailed') }}</p>
      <p v-if="erreur" class="arv__status arv__status--ko"><i class="pi pi-times-circle" /> {{ erreur }}</p>

      <slot />
    </div>
  </div>
</template>

<style scoped>
.arv { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 1.6rem; align-items: stretch; }
@media (max-width: 900px) { .arv { grid-template-columns: 1fr; } }

.arv__stage { position: relative; border-radius: 14px; overflow: hidden; background: #17171a; min-height: 380px; }
.arv--compact .arv__stage { min-height: 320px; }
.arv__mv { width: 100%; height: 100%; min-height: inherit; background: radial-gradient(circle at 50% 62%, #2b2b31 0%, #131316 72%); --poster-color: transparent; }

.arv__arbtn {
  position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
  border: none; background: var(--gold, #c9a227); color: #14140f;
  font-weight: 800; font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 0.62rem 1.15rem; border-radius: 999px; cursor: pointer;
  display: flex; align-items: center; gap: 0.45rem;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4);
}
.arv__pin {
  border: 2px solid #fff; background: rgba(20, 20, 15, 0.72); color: #fff;
  width: 22px; height: 22px; border-radius: 50%; cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center;
}
.arv__pin span {
  position: absolute; left: 26px; top: 50%; transform: translateY(-50%);
  white-space: nowrap; font-size: 0.72rem; font-weight: 700;
  background: rgba(20, 20, 15, 0.82); padding: 0.22rem 0.55rem; border-radius: 999px;
  opacity: 0; transition: opacity 0.18s ease; pointer-events: none;
}
.arv__pin:hover span, .arv__pin:focus-visible span { opacity: 1; }

.arv__load { display: none; align-items: center; gap: 0.5rem; color: #cfc9bd; font-size: 0.85rem; }
.arv__load.on { display: flex; }

.arv__scale, .arv__demo {
  position: absolute; display: inline-flex; align-items: center; gap: 0.35rem;
  background: rgba(10, 10, 8, 0.62); color: #ded9cf; font-size: 0.74rem;
  padding: 0.35rem 0.65rem; border-radius: 999px; backdrop-filter: blur(4px);
}
.arv__scale { top: 0.8rem; left: 0.8rem; }
.arv__demo { bottom: 0.8rem; left: 0.8rem; max-width: calc(100% - 1.6rem); }
.arv__scale i, .arv__demo i { color: var(--gold, #c9a227); }
.arv__x {
  position: absolute; top: 0.7rem; right: 0.7rem; width: 34px; height: 34px;
  border-radius: 50%; border: 0; cursor: pointer; background: rgba(10, 10, 8, 0.6); color: #fff;
}

/* ---------------- panneau ---------------- */
.arv__side { display: flex; flex-direction: column; }
.arv__over { font-size: 0.66rem; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: var(--gold, #c9a227); }
.arv__side h2 {
  font-family: 'Anton', 'Inter', sans-serif; font-weight: 400; text-transform: uppercase;
  font-size: clamp(1.4rem, 3vw, 2.1rem); line-height: 1.08; margin: 0.35rem 0 0.5rem; color: #101210;
}
.arv__lead { color: #3c403c; line-height: 1.7; margin: 0 0 1.2rem; font-size: 0.94rem; }

.arv__go { display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; margin-bottom: 1.1rem; }
.arv__go small { color: #7c817b; font-size: 0.8rem; }
.arv__checking { color: #7c817b; font-size: 0.86rem; display: flex; align-items: center; gap: 0.45rem; }

.arv__qr { display: flex; gap: 1rem; align-items: flex-start; margin-bottom: 1.1rem; }
.arv__qrimg { flex: 0 0 auto; line-height: 0; border: 1px solid #e8e9e6; border-radius: 10px; padding: 6px; background: #fff; }
.arv__qrtxt { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
.arv__qrtxt strong { font-size: 0.98rem; color: #101210; }
.arv__qrtxt span { font-size: 0.85rem; color: #5c615c; line-height: 1.55; }
.arv__qrtxt code { font-size: 0.72rem; color: #7c817b; word-break: break-all; }
.arv__warn { font-size: 0.76rem; color: #b4541a; line-height: 1.5; }

.arv__nope {
  display: flex; gap: 0.8rem; align-items: flex-start; margin-bottom: 1.1rem;
  background: #faf6ef; border-left: 4px solid var(--gold, #c9a227);
  padding: 0.9rem 1.05rem; border-radius: 0 10px 10px 0;
}
.arv__nope > i { color: var(--gold, #c9a227); font-size: 1.1rem; margin-top: 0.1rem; }
.arv__nope strong { display: block; font-size: 0.95rem; color: #101210; margin-bottom: 0.2rem; }
.arv__nope span { font-size: 0.85rem; color: #5c615c; line-height: 1.6; }

.arv__actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: auto; padding-top: 0.6rem; }
.arv__status { display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; color: var(--site-primary, #0e6f5c); margin: 0.8rem 0 0; }
.arv__status--ko { color: #b03a2e; }
</style>
