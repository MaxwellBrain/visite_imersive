<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { demoModelUrl, demoModelInfo } from '@/services/glb'
import { qrSvg } from '@/services/qrcode'
import { chargerModelViewer } from '@/services/modelViewer'
import { useTts } from '@/services/tts'
import ObjectGuideRobot from '@/components/objects/ObjectGuideRobot.vue'

// RÉALITÉ AUGMENTÉE — « Retour au pays ».
//
// La thèse du projet en dix secondes : on pointe le sol de la cour de la
// chefferie et l'objet exilé réapparaît.
//
// COMMENT LA RA FONCTIONNE ICI — le point que l'on comprend de travers une fois
// sur deux : ce n'est PAS le navigateur qui fait la réalité augmentée. Il ne
// fait que passer la main au système :
//
//   Android → intent vers SCENE VIEWER, l'application de Google adossée à
//             ARCore. C'est elle qui allume la caméra, détecte les plans et
//             pose l'objet. Elle télécharge le .glb elle-même, par son URL.
//   iOS     → le .usdz est remis à QUICK LOOK. Sans ce fichier, rien.
//   WebXR   → la seule voie qui s'exécute vraiment dans le navigateur, et la
//             moins fiable sur mobile.
//
// Trois conséquences : il faut DEUX fichiers (glb + usdz), le modèle doit être
// servi publiquement avec le bon type MIME puisqu'une AUTRE application vient
// le chercher, et le QR n'est pas un marqueur — le placement se fait par
// détection de plan, le QR n'est qu'un lien.
//
// L'ÉCHELLE. On laisse `ar-scale` en mode automatique, comme le projet de
// référence. « fixed » plaçait l'objet à sa taille réelle : intellectuellement
// juste, mais une case de six mètres posée dans une pièce devient un mur de
// texture, et le visiteur conclut que rien ne s'est affiché.
//
// Sur ordinateur, la RA est indisponible : au lieu d'un bouton grisé, on
// affiche un QR. Le jury scanne, l'objet apparaît dans la salle.

const props = defineProps({
  objet: { type: Object, default: null },
  // Variante du modèle de démonstration quand l'objet n'a pas encore été numérisé.
  variante: { type: String, default: 'tabouret' },
  // Adresse à encoder dans le QR ; par défaut la page RA autonome de cet objet.
  lienMobile: { type: String, default: '' },
  // RÉALITÉ AUGMENTÉE SEULE. Le modèle reste chargé — il le faut pour lancer la
  // RA — mais on retire tout ce qui invite à le manipuler : rotation
  // automatique, contrôles de caméra, mention de la hauteur. Une case de six
  // mètres qu'on fait tourner dans un cadre devient un bibelot, et c'est
  // exactement le contresens que ce mode évite.
  arSeul: { type: Boolean, default: false },
  compact: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])

const { t } = useI18n()
const { speaking: ttsSpeaking, speak: ttsSpeak, stop: ttsStop } = useTts()

const mv = ref(null)
const robot = ref(null)

// Le robot se réveille au premier geste sur la pièce. `camera-change` ne se
// déclenche que si la caméra est manipulable — donc pas en mode « RA seule »,
// où le clic reste le seul signal. On garde les deux : ils couvrent chacun un
// cas que l'autre laisse passer.
function surGeste(e) {
  if (!e || e?.detail?.source === 'user-interaction') robot.value?.reveiller()
}
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

// LANCEMENT — trois niveaux, du plus propre au plus brutal.
//
// `activateAR()` suffit dans le cas nominal. Mais sur un Android capricieux —
// version de Chrome ancienne, Services Google Play pour la RA en cours de mise
// à jour, WebView intégrée à une autre application — il échoue en silence, et
// le visiteur reste devant un bouton qui ne fait rien.
//
// D'où les deux recours. Le clic direct dans le `shadowRoot` contourne un
// model-viewer mal initialisé. L'`intent://` contourne model-viewer TOUT COURT
// et s'adresse à Scene Viewer, l'application de Google, en lui passant l'URL du
// modèle ; `S.browser_fallback_url` ramène le visiteur ici si l'application
// manque. Sur iPhone, on ouvre simplement le .usdz : c'est Quick Look qui prend.
async function lancerAr() {
  const el = mv.value
  erreur.value = ''
  try {
    if (el && typeof el.activateAR === 'function') { await el.activateAR(); return }
    // Le bouton projeté d'ABORD. Comme cette vue en fournit un (`slot="ar-button"`),
    // model-viewer n'en crée pas dans son `shadowRoot` : n'y chercher que là,
    // comme le fait le projet de référence, ne trouve jamais rien. On garde
    // quand même la recherche interne, pour le jour où le slot disparaîtra.
    const bouton =
      el?.querySelector('[slot="ar-button"]') ||
      el?.shadowRoot?.querySelector('[slot="ar-button"], button[part="default-ar-button"]')
    if (bouton) { bouton.click(); return }
    throw new Error('activateAR indisponible')
  } catch {
    if (surIos.value && srcIos.value) { window.location.href = srcIos.value; return }
    if (/Android/.test(navigator.userAgent) && src.value) {
      const retour = encodeURIComponent(window.location.href)
      // ABSOLUE, impérativement. Le modèle est référencé en chemin relatif —
      // c'est ce qui le garde sur l'origine de la page, donc hors CORS, quel
      // que soit le sous-domaine du locataire. Mais Scene Viewer est une
      // application Android distincte : elle n'a aucune page contre laquelle
      // résoudre « /modeles/… » et n'irait nulle part. On résout ici.
      const fichier = new URL(src.value, window.location.href).href
      window.location.href =
        `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(fichier)}` +
        `&mode=ar_preferred#Intent;scheme=https;` +
        `package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;` +
        `S.browser_fallback_url=${retour};end;`
      return
    }
    erreur.value = t('ar.launchFailed')
  }
}

// ---------------------------------------------------------------------------
// Panneau de préparation — trois étapes avant d'ouvrir la caméra
// ---------------------------------------------------------------------------
// Le bouton n'ouvre pas la caméra : il explique d'abord. Deux raisons, et la
// seconde compte plus que la première.
//
//  1. Un visiteur qui ignore qu'il doit BALAYER LE SOL pointe son téléphone
//     vers un mur, ne voit rien apparaître, et conclut que c'est cassé. La
//     détection de plan demande deux ou trois secondes de mouvement : c'est la
//     seule chose qu'il faut lui dire, et personne ne la devine.
//  2. Le diagnostic ne peut se dire QUE là. Sur un iPhone sans .usdz, la RA est
//     impossible ; le panneau le nomme, au lieu d'un bouton qui ne répond pas.
const guide = ref(false)
function ouvrirGuide() { erreur.value = ''; guide.value = true }
function fermerGuide() { guide.value = false }
function lancerDepuisGuide() {
  // On referme AVANT de lancer : le geste du visiteur est encore valide, et
  // model-viewer n'aime pas s'ouvrir sous une superposition.
  guide.value = false
  lancerAr()
}

// Ce qui empêchera la RA, su AVANT d'appuyer.
const empechementAr = computed(() => {
  if (nonSecurise.value) return 'https'
  if (!surMobile.value) return 'ordinateur'
  if (surIos.value && !srcIos.value) return 'ios'
  return ''
})

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
      <!-- RÉGLAGES RA — alignés sur le projet de référence.
           · ar-modes : WebXR d'abord, puis Scene Viewer (l'application Google,
             adossée à ARCore), puis Quick Look. Sur Android c'est Scene Viewer
             qui fait le travail dès que WebXR n'est pas disponible.
           · PAS de `ar-scale="fixed"` : à taille réelle, une case de six mètres
             posée dans une pièce est un mur de texture, et le visiteur croit que
             rien ne s'est affiché. En mode automatique, Scene Viewer la pose à
             une taille exploitable et la rend redimensionnable.
           · PAS de `xr-environment` : il ne concerne que WebXR et ajoute une
             surface d'échec pour rien. -->
      <model-viewer
        ref="mv"
        :src="src"
        :alt="titre"
        :camera-controls="arSeul ? undefined : true"
        :auto-rotate="arSeul ? undefined : true"
        auto-rotate-delay="2500"
        rotation-per-second="14deg"
        :ios-src="srcIos || undefined"
        :ar-placement="placement"
        :scale="echelleAttr"
        ar
        ar-modes="webxr scene-viewer quick-look"
        loading="eager"
        reveal="auto"
        shadow-intensity="1.4"
        shadow-softness="0.9"
        exposure="1.05"
        environment-image="neutral"
        touch-action="pan-y"
        class="arv__mv"
        @click="robot?.reveiller()"
        @camera-change="surGeste"
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

      <span v-if="hauteurCm && !arSeul" class="arv__scale">
        <i class="pi pi-arrows-v" /> {{ $t('ar.realHeight', { n: hauteurCm }) }}
      </span>
      <span v-if="demo" class="arv__demo"><i class="pi pi-info-circle" /> {{ $t('ar.demoModel') }}</span>
      <ObjectGuideRobot
        ref="robot"
        :objet="titre"
        :museum-id="objet?.sectors?.museum_id ?? null"
        :sector-id="objet?.sector_id ?? null"
      />

      <button v-if="compact" class="arv__x" :aria-label="$t('common.close')" @click="emit('close')">
        <i class="pi pi-times" />
      </button>
    </div>

    <div class="arv__side">
      <span class="arv__over">{{ $t('ar.over') }}</span>
      <h2>{{ titre }}</h2>
      <p class="arv__lead">{{ arSeul ? $t('ar.leadArOnly') : $t('ar.lead') }}</p>

      <!-- Chemin d'accès à la RA : soit on la lance, soit on passe au téléphone -->
      <!-- Le bouton reste offert même quand l'appareil ne suivra pas : c'est le
           panneau qui explique. Le masquer rendait le diagnostic inatteignable. -->
      <!-- Le bouton LANCE, il n'explique plus d'abord — comme dans le projet de
           référence. Un écran intercalé entre le geste du visiteur et la caméra
           coûte un tap, et surtout fait perdre l'activation par geste que
           certains Android exigent pour ouvrir Scene Viewer. Le conseil de
           balayage reste, en dessous, et le détail derrière un lien. -->
      <div v-if="arPossible === true || surMobile" class="arv__go">
        <button class="ps-btn" @click="lancerAr">
          <i class="pi pi-mobile" /> {{ $t('ar.launch') }}
        </button>
        <small>{{ $t('ar.launchHint') }}</small>
        <button class="arv__aide" type="button" @click="ouvrirGuide">
          <i class="pi pi-question-circle" /> {{ $t('ar.guideTitre') }}
        </button>
      </div>

      <!-- Sur ordinateur : on passe la main au téléphone par un QR. -->
      <div v-else-if="!surMobile" class="arv__qr">
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

    <!-- ===================== Panneau de préparation ===================== -->
    <div v-if="guide" class="arg" role="dialog" aria-modal="true">
      <div class="arg__carte">
        <button class="arg__x" :aria-label="$t('common.close')" @click="fermerGuide">
          <i class="pi pi-times" />
        </button>
        <h3>{{ $t('ar.guideTitre') }}</h3>

        <p v-if="empechementAr" class="arg__alerte">
          <i class="pi pi-exclamation-triangle" />
          <span>{{ $t(`ar.guideEmpeche.${empechementAr}`) }}</span>
        </p>

        <template v-else>
          <ol class="arg__etapes">
            <li>
              <span>1</span>
              <div><strong>{{ $t('ar.guide1') }}</strong><small>{{ $t('ar.guide1Sous') }}</small></div>
            </li>
            <li>
              <span>2</span>
              <div><strong>{{ $t('ar.guide2') }}</strong><small>{{ $t('ar.guide2Sous') }}</small></div>
            </li>
            <li>
              <span>3</span>
              <div><strong>{{ $t('ar.guide3') }}</strong><small>{{ $t('ar.guide3Sous') }}</small></div>
            </li>
          </ol>
          <button class="ps-btn arg__go" @click="lancerDepuisGuide">
            <i class="pi pi-video" /> {{ $t('ar.guideLancer') }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ---- Panneau de préparation -------------------------------------------- */
.arg { position: fixed; inset: 0; z-index: 60; display: flex;
  align-items: center; justify-content: center; padding: 1rem;
  background: rgba(0, 0, 0, .55); backdrop-filter: blur(3px); }
.arg__carte { position: relative; width: 100%; max-width: 23rem;
  padding: 1.4rem 1.25rem 1.25rem; border-radius: 1rem; background: #fff; color: #14181a;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .3); }
.arg__carte h3 { margin: 0 0 1rem; font-size: 1.12rem; }
.arg__x { position: absolute; top: .6rem; right: .6rem; width: 2rem; height: 2rem;
  border: 0; border-radius: 50%; background: rgba(0, 0, 0, .06); cursor: pointer; }
.arg__etapes { list-style: none; margin: 0 0 1.1rem; padding: 0;
  display: flex; flex-direction: column; gap: .55rem; }
.arg__etapes li { display: flex; gap: .75rem; align-items: flex-start;
  padding: .7rem .8rem; border-radius: .6rem; background: rgba(0, 0, 0, .04); }
.arg__etapes span { flex: 0 0 1.9rem; height: 1.9rem; display: grid; place-items: center;
  border-radius: 50%; background: rgba(11, 107, 75, .14); color: #0b6b4b; font-weight: 700; }
.arg__etapes strong { display: block; font-size: .95rem; }
.arg__etapes small { color: rgba(0, 0, 0, .6); line-height: 1.4; }
.arg__alerte { display: flex; gap: .6rem; align-items: flex-start; margin: 0 0 1rem;
  padding: .8rem .9rem; border-radius: .6rem;
  background: rgba(179, 38, 30, .08); color: #8c1d18; line-height: 1.45; }
.arg__go { width: 100%; justify-content: center; }

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

/* Lien d'aide secondaire : discret, il ne doit pas concurrencer le bouton. */
.arv__aide {
  display: inline-flex; align-items: center; gap: 0.35rem;
  margin-top: 0.5rem; padding: 0; border: 0; background: none; cursor: pointer;
  font-size: 0.78rem; color: #7c817b; text-decoration: underline;
}
.arv__aide:hover { color: var(--site-primary, #0e6f5c); }

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
