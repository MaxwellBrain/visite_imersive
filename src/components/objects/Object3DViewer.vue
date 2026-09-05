<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { chargerModelViewer, modelViewerPret } from '@/services/modelViewer'
import ObjectGuideRobot from './ObjectGuideRobot.vue'
import { useGuideFocus } from '@/composables/useGuideFocus'

// VISUALISEUR 3D — et la distinction que tout le monde rate ici.
//
// `<model-viewer>` affiche à l'écran du glTF/GLB, et RIEN D'AUTRE. Un .usdz est
// une archive ZIP : lui passer dans `src` ne produit pas un rendu dégradé, cela
// produit « le modèle n'a pas pu être chargé ». C'est exactement ce qui est
// arrivé le 19 août 2026, un USDZ ayant été déposé dans le champ GLB.
//
// Le .usdz sert UNIQUEMENT à Quick Look, la visionneuse RA d'Apple, et se passe
// par l'attribut `ios-src` — qui n'était pas transmis jusqu'ici : la colonne
// model3d_ios existait mais n'atteignait jamais le composant.
//
// TROIS CAS, traités séparément parce qu'ils n'ont pas la même issue :
//   GLB (+ USDZ) — rendu à l'écran partout, RA sur Android et iPhone.
//   USDZ SEUL    — rien à afficher à l'écran ; sur iPhone on ouvre Quick Look
//                  directement, ailleurs on l'explique au lieu de faire échouer
//                  un chargement.
//   Rien         — état vide habituel.

// ⚠️ CE COMPOSANT NE DOIT DÉPENDRE D'AUCUN COMPOSANT PRIMEVUE.
//
// Il est monté sur LE SITE VISITEUR, où PrimeVue n'est délibérément pas installé
// — la bibliothèque pèse 300 des 339 ko du fragment applicatif et le site public
// n'en utilise rien (voir services/primevue.js). Le garde de route ne l'installe
// que pour l'ERP.
//
// Or ce fichier affichait un `<Dialog>` PrimeVue. Sur le site public, le plugin
// absent, le dialogue ne se rendait pas : le bouton « Voir en 3D » d'une fiche
// d'œuvre ne produisait RIEN, sans erreur visible. La surcouche ci-dessous est
// donc écrite à la main — quelques lignes de CSS contre une dépendance qui ne
// peut pas être là.
const props = defineProps({
  visible: { type: Boolean, default: false },
  src: { type: String, default: '' },        // .glb — le seul format affichable
  iosSrc: { type: String, default: '' },     // .usdz — Quick Look uniquement
  title: { type: String, default: '' },
  // Périmètre transmis au guide : il répond sur le corpus de CE musée, pas sur
  // l'ensemble du locataire. Facultatifs — sans eux, le guide reste pertinent
  // mais cherche plus large.
  museumId: { type: [String, Number], default: null },
  sectorId: { type: [String, Number], default: null },
  // Le guide salue-t-il de lui-même à l'ouverture ? OUI côté visiteur, NON dans
  // l'ERP — un conservateur qui contrôle un maillage n'a pas demandé qu'une voix
  // parte et que le navigateur réclame son micro. Là-bas, l'avatar continue
  // d'attendre un geste sur la pièce.
  accueil: { type: Boolean, default: false },
  // STUDIO PLEIN ÉCRAN — le mode du site visiteur.
  //
  // La réalité augmentée pose l'objet dans la pièce du visiteur : son salon, sa
  // table, sa lumière. C'est justement ce dont on ne veut pas ici. Une couronne
  // royale posée entre un téléviseur et un canapé perd ce qu'elle est.
  //
  // Le studio retire le monde réel au lieu de s'y superposer : plein écran, fond
  // sombre, l'objet seul dans sa lumière. Ce n'est pas de la RA, et c'est le
  // propos — aucune caméra, donc aucun décor à subir, et cela fonctionne sur
  // TOUS les appareils, iPhone compris.
  //
  // L'ERP garde le dialogue compact : un conservateur qui vérifie un maillage
  // n'a pas besoin qu'on lui prenne l'écran entier.
  pleinEcran: { type: Boolean, default: false },
  // L'objet caché ({ mot, recit }) — transmis tel quel au guide vocal.
  secret: { type: Object, default: null },
  // Sans identifiant, pas d'agent vocal temps réel : la session xAI se noue
  // autour d'une pièce précise, dont le serveur charge le dossier.
  objectId: { type: [String, Number], default: null },
  tenantId: { type: [String, Number], default: null }
})
const emit = defineEmits(['update:visible'])

function fermer() { emit('update:visible', false) }

// Échap ferme, comme n'importe quelle fenêtre modale. L'écouteur ne vit que
// pendant l'ouverture : posé en permanence, il fermerait une visionneuse déjà
// close et intercepterait l'Échap d'autres écrans.
function surTouche(e) { if (e.key === 'Escape') fermer() }
watch(() => props.visible, (ouvert) => {
  if (typeof document === 'undefined') return
  if (ouvert) {
    document.addEventListener('keydown', surTouche)
    // Sans cela, le doigt qui fait tourner l'objet fait aussi défiler la fiche
    // derrière — et l'on perd sa place dans la page en manipulant le modèle.
    document.body.style.overflow = 'hidden'
  } else {
    document.removeEventListener('keydown', surTouche)
    document.body.style.overflow = ''
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', surTouche)
  document.body.style.overflow = ''
})

// iPadOS 13+ se déclare « Macintosh » : sans le test tactile, un iPad serait
// traité comme un ordinateur de bureau et perdrait l'accès à Quick Look.
const estIOS = computed(() => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)
})

const usdzSeul = computed(() => !props.src && !!props.iosSrc)

// LA RA DANS LA VISIONNEUSE SUIT LA MÊME RÈGLE QUE LA FICHE.
//
// L'attribut `ar` était posé en dur : model-viewer affichait donc son bouton
// « Réalité augmentée » même sans rien à ouvrir. Sur iPhone, Quick Look a besoin
// du .usdz — sans lui le bouton échouait en silence. Ailleurs, c'est le .glb qui
// alimente Scene Viewer et WebXR.
const arPossible = computed(() => (estIOS.value ? !!props.iosSrc : !!props.src))

// <model-viewer> pese 1 Mo : on ne le telecharge qu'a l'ouverture reelle du
// dialogue, et seulement s'il y a un GLB a afficher. Un objet n'ayant qu'un
// USDZ passe par Quick Look et n'en a aucun besoin.
//
// ⚠️ ET ON N'AFFICHE L'ÉLÉMENT QU'UNE FOIS SA DÉFINITION ARRIVÉE.
//
// `<model-viewer>` est un ÉLÉMENT PERSONNALISÉ. Le poser dans le DOM avant que
// `customElements.define` ait eu lieu ne donne pas un élément « en attente » :
// il donne un élément INERTE, sur lequel Vue écrit `src` sous forme d'attribut
// — puisque la propriété n'existe pas encore. Quand la définition arrive enfin
// et que le navigateur promeut l'élément, model-viewer ne relit pas cet
// attribut déjà présent : le .glb n'est JAMAIS demandé au réseau. Ni erreur,
// ni modèle, ni message — un cadre vide.
//
// C'est ce qui faisait « ne rien faire » au bouton « Voir en 3D » : la panne
// était intermittente, donc trompeuse. À la première ouverture d'une session le
// module n'était pas là et le cadre restait vide ; à la seconde il l'était, et
// tout marchait. `Objet3DVedette` et `ArViewer` attendaient déjà, chacun à leur
// manière ; ce dialogue était le seul à ne pas le faire.
const pret = ref(modelViewerPret())
const echecModule = ref(false)

watch(() => props.visible, async (ouvert) => {
  if (!ouvert || !props.src || pret.value) return
  try {
    await chargerModelViewer()
    pret.value = true
  } catch {
    // Réseau coupé ou module bloqué : on le dit, au lieu de laisser un cadre
    // vide que personne ne sait interpréter.
    echecModule.value = true
  }
}, { immediate: true })

// ─── Convocation du guide ───────────────────────────────────────────────
//
// Le robot n'apparaît qu'au premier geste réel sur l'objet : un clic dessus, ou
// une rotation faite à la main. C'est ce qui le distingue d'une bulle d'aide
// permanente, qu'on cesse de voir au bout de deux écrans.
//
// PIÈGE, et c'est tout l'enjeu ici : `auto-rotate` émet `camera-change` en
// continu, plusieurs fois par seconde, sans que personne n'ait touché à rien.
// Se contenter d'écouter l'événement ferait surgir le robot tout seul, aussitôt
// le dialogue ouvert — exactement ce qu'on cherche à éviter. `detail.source`
// distingue le geste du visiteur (`user-interaction`) du reste.

const robot = ref(null)
const { prendreLaParole, rendreLaParole } = useGuideFocus()

function surRotation(e) {
  if (e?.detail?.source !== 'user-interaction') return
  robot.value?.reveiller()
  // Le nombre de manipulations nourrit la lecture du tempérament : beaucoup de
  // rotations en peu de temps, c'est quelqu'un qui cherche, pas qui contemple.
  robot.value?.noterGeste()
}

// Le dialogue se referme : le guide aussi, et il se tait. Sans cela, la voix
// continuerait de parler d'un objet qui n'est plus à l'écran.
//
// Et tant qu'il est ouvert, l'avatar a la parole POUR LUI SEUL. Le site monte
// en permanence un fil de discussion écrit (`GuideChat`) et un bot vocal
// (`VoiceBot`) : sans cette prise de parole, ouvrir la 3D d'une œuvre affichait
// une bulle de chat par-dessus l'avatar, et deux composants se disputaient le
// même moteur de synthèse et le même micro. Voir `useGuideFocus`.
// `immediate` : un visualiseur monté déjà ouvert (navigation directe sur une
// fiche, lien partagé) doit prendre la parole sans attendre un changement.
watch(() => props.visible, (ouvert) => {
  if (ouvert) prendreLaParole()
  else { robot.value?.fermer(); rendreLaParole() }
}, { immediate: true })
</script>

<template>
  <!-- Téléporté à la racine : imbriquée dans la fiche, la surcouche serait
       découpée par le moindre parent en `overflow: hidden` ou en
       `transform` — et un plein écran qui n'occupe pas l'écran n'est plus un
       plein écran. -->
  <Teleport to="body">
    <div
      v-if="visible" class="v3d-mask" :class="{ 'v3d-mask--studio': pleinEcran }"
      role="dialog" aria-modal="true" @click.self="fermer"
    >
      <div class="v3d-shell" :class="{ 'v3d-shell--studio': pleinEcran }">
        <div class="v3d-bar">
          <h2 class="v3d-titre">{{ title || $t('viewer3d.defaultTitle') }}</h2>
          <button class="v3d-close" :aria-label="$t('common.close')" @click="fermer">
            <i class="pi pi-times" />
          </button>
        </div>

        <div class="viewer3d" :class="{ 'viewer3d--studio': pleinEcran }">
      <!-- Cas nominal : un GLB à afficher. `ios-src` bascule Quick Look sur iPhone.
           `loading="eager"` : par défaut model-viewer attend d'être JUGÉ VISIBLE
           avant de télécharger le .glb, verdict rendu par un IntersectionObserver.
           Dans une fenêtre modale qui vient de s'ouvrir, ce verdict n'arrive pas
           de façon fiable — le modèle n'est alors jamais demandé, sans la moindre
           erreur. L'attente n'a de toute façon plus lieu d'être : le visiteur a
           cliqué « Voir en 3D », il a dit ce qu'il voulait. Même raison que dans
           `Objet3DVedette`. -->
      <template v-if="src">
        <!-- `position: relative` : le robot se place en absolu DANS le cadre du
             modèle, pas dans celui du dialogue. -->
        <div class="viewer3d__scene">
          <!-- Le cadre d'attente occupe EXACTEMENT la hauteur du modèle : sans
               cela, le dialogue sauterait au moment où la visionneuse apparaît. -->
          <div v-if="!pret" class="viewer3d__attente">
            <template v-if="echecModule">
              <i class="pi pi-exclamation-triangle" />
              <p>{{ $t('viewer3d.moduleFailed') }}</p>
            </template>
            <template v-else>
              <i class="pi pi-spin pi-spinner" />
              <p>{{ $t('viewer3d.moduleLoading') }}</p>
            </template>
          </div>

          <model-viewer
            v-else
            :src="src"
            :ios-src="iosSrc || undefined"
            camera-controls
            auto-rotate
            :ar="arPossible || undefined"
            ar-modes="webxr scene-viewer quick-look"
            loading="eager"
            reveal="auto"
            ar-scale="auto"
            touch-action="pan-y"
            :auto-rotate-delay="pleinEcran ? 0 : 3000"
            :rotation-per-second="pleinEcran ? '14deg' : '30deg'"
            :interaction-prompt="pleinEcran ? 'none' : 'auto'"
            :environment-image="pleinEcran ? 'neutral' : undefined"
            :shadow-intensity="pleinEcran ? '1.7' : '1'"
            :shadow-softness="pleinEcran ? '0.9' : undefined"
            :exposure="pleinEcran ? '1.15' : undefined"
            :style="pleinEcran
              ? 'width:100%;height:100%;background:transparent'
              : 'width:100%;height:440px;background:#f0ece4;border-radius:12px'"
            @click="robot?.reveiller()"
            @camera-change="surRotation"
          >
            <button slot="ar-button" class="viewer3d__ar">
              <i class="pi pi-mobile" /> {{ $t('viewer3d.arButton') }}
            </button>
          </model-viewer>

          <ObjectGuideRobot
            ref="robot"
            :objet="title"
            :museum-id="museumId"
            :sector-id="sectorId"
            :auto="accueil"
            :secret="secret"
            :object-id="objectId"
            :tenant-id="tenantId"
          />
        </div>
        <p class="viewer3d__hint">
          <i class="pi pi-sync" /> {{ $t('viewer3d.hint') }}
        </p>
      </template>

      <!-- USDZ seul : aucun rendu à l'écran n'est possible, on le dit franchement. -->
      <template v-else-if="usdzSeul">
        <div class="viewer3d__usdz">
          <i class="pi pi-apple" />
          <strong>{{ $t('viewer3d.usdzOnly') }}</strong>

          <!-- Sur iOS, `rel="ar"` ouvre Quick Look nativement. Safari EXIGE un
               enfant <img> : sans lui, le lien se comporte en téléchargement. -->
          <a v-if="estIOS" :href="iosSrc" rel="ar" class="viewer3d__quicklook">
            <img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" alt="" width="1" height="1" />
            <i class="pi pi-mobile" /> {{ $t('viewer3d.openQuickLook') }}
          </a>
          <p v-else class="viewer3d__usdz-note">{{ $t('viewer3d.usdzOnlyHint') }}</p>
        </div>

        <p class="viewer3d__conseil">
          <i class="pi pi-info-circle" /> {{ $t('viewer3d.needGlb') }}
        </p>
      </template>

      <div v-else class="viewer3d__empty">
        <i class="pi pi-box" />
        <p>{{ $t('viewer3d.empty') }}</p>
        <small>{{ $t('viewer3d.emptyHint') }}</small>
      </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ------------------------------------------------------------- surcouche ----
   Écrite à la main, pour ne dépendre d'aucun composant PrimeVue : ce fichier
   s'affiche sur le site visiteur, où la bibliothèque n'est pas chargée. */
.v3d-mask {
  position: fixed; inset: 0; z-index: 1200;
  display: flex; align-items: center; justify-content: center;
  padding: 1rem;
  background: rgba(12, 14, 12, 0.62);
  backdrop-filter: blur(3px);
}
.v3d-shell {
  width: 46rem; max-width: 100%; max-height: 92dvh;
  display: flex; flex-direction: column;
  background: #fff; border-radius: 12px; overflow: hidden;
  box-shadow: 0 30px 80px -30px rgba(0, 0, 0, 0.55);
}
.v3d-bar {
  display: flex; align-items: center; gap: 1rem;
  padding: 0.9rem 1.1rem; border-bottom: 1px solid #e8e9e6;
}
.v3d-titre { margin: 0; font-size: 1.02rem; font-weight: 700; color: #101210; }
.v3d-close {
  margin-left: auto; border: none; background: none; cursor: pointer;
  width: 2rem; height: 2rem; border-radius: 50%; color: #5c615c;
  display: grid; place-items: center; font-size: 0.95rem;
}
.v3d-close:hover { background: #f0f1ee; }
.v3d-close:focus-visible { outline: 2px solid var(--site-primary, #0e6f5c); outline-offset: 2px; }

.viewer3d__scene { position: relative; }

/* ---------------------------------------------------------------- STUDIO ----
   Le mode plein écran du site visiteur. Tout ici sert un seul but : qu'il ne
   reste RIEN à l'écran que l'objet et sa lumière — ni pièce, ni meuble, ni
   fenêtre du navigateur. C'est ce que la réalité augmentée ne pouvait pas
   donner, puisqu'elle montre justement la pièce du visiteur.

   Le dégradé radial fait le travail d'un éclairage de vitrine : un halo chaud
   au centre, une nuit profonde sur les bords. L'objet paraît éclairé par la
   scène plutôt que découpé dessus. */
.v3d-mask--studio { padding: 0; background: none; backdrop-filter: none; }
.v3d-shell--studio {
  width: 100%; max-width: none; height: 100dvh; max-height: none;
  border-radius: 0; box-shadow: none;
  background: radial-gradient(ellipse 70% 55% at 50% 42%, #2b2722 0%, #16130f 55%, #0b0a08 100%);
}
/* La barre de titre FLOTTE au-dessus de la scène au lieu de la repousser : sur
   un téléphone, une barre opaque mange le tiers de la hauteur utile. */
.v3d-shell--studio .v3d-bar {
  position: absolute; inset: 0 0 auto 0; z-index: 2;
  border: none;
  padding: 1rem 1.1rem 2.4rem;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.6), transparent);
}
.v3d-shell--studio .v3d-titre { color: #fff; }
.v3d-shell--studio .v3d-close { color: rgba(255, 255, 255, 0.85); }
.v3d-shell--studio .v3d-close:hover { background: rgba(255, 255, 255, 0.16); }

.viewer3d--studio {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.viewer3d--studio .viewer3d__scene {
  flex: 1;
  min-height: 0;
  display: flex;
}
.viewer3d--studio .viewer3d__hint {
  position: relative;
  z-index: 1;
  margin: 0;
  padding: 0.9rem 1.2rem calc(0.9rem + env(safe-area-inset-bottom));
  text-align: center;
  color: rgba(255, 255, 255, 0.62);
  font-size: 0.84rem;
}
/* Le bouton RA reste accessible — le studio ne la remplace pas, il l'accompagne :
   qui VEUT poser l'objet chez lui doit encore pouvoir le faire. */
.viewer3d--studio .viewer3d__ar { bottom: 5.2rem; }


/* Même hauteur que <model-viewer> (440 px) : l'attente ne doit pas déplacer le
   dialogue quand la visionneuse prend sa place. */
.viewer3d__attente {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  height: 440px;
  background: #f0ece4;
  border-radius: 12px;
  color: #6b6255;
}
.viewer3d__attente i { font-size: 1.6rem; }
.viewer3d__attente p { margin: 0; font-size: 0.85rem; text-align: center; max-width: 26rem; }

.viewer3d__ar {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  border: none;
  background: var(--p-primary-color);
  color: #fff;
  font-weight: 600;
  font-size: 0.85rem;
  padding: 0.55rem 1rem;
  border-radius: 999px;
  cursor: pointer;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.viewer3d__hint {
  margin: 0.9rem 0 0;
  color: var(--vi-muted);
  font-size: 0.82rem;
  line-height: 1.5;
}
.viewer3d__hint i {
  color: var(--p-primary-color);
  margin-right: 0.25rem;
}

.viewer3d__usdz {
  text-align: center;
  padding: 2.6rem 1.2rem;
  background: #f0ece4;
  border-radius: 12px;
  color: var(--vi-muted);
}
.viewer3d__usdz > i {
  font-size: 2.8rem;
  opacity: 0.55;
  display: block;
  margin-bottom: 0.7rem;
}
.viewer3d__usdz strong {
  display: block;
  color: #101210;
  font-size: 1.02rem;
  margin-bottom: 0.5rem;
}
.viewer3d__usdz-note {
  margin: 0.3rem auto 0;
  max-width: 34rem;
  font-size: 0.86rem;
  line-height: 1.55;
}
.viewer3d__quicklook {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.6rem;
  background: var(--p-primary-color);
  color: #fff;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9rem;
  padding: 0.6rem 1.2rem;
  border-radius: 999px;
}
.viewer3d__quicklook img { display: none; }
.viewer3d__conseil { margin-top: 0.9rem; }

.viewer3d__empty {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--vi-muted);
}
.viewer3d__empty i {
  font-size: 3rem;
  opacity: 0.5;
  display: block;
  margin-bottom: 0.75rem;
}
.viewer3d__empty small {
  display: block;
  margin-top: 0.4rem;
  opacity: 0.8;
}
</style>
