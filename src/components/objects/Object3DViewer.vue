<script setup>
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'
import { chargerModelViewer } from '@/services/modelViewer'
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
  // L'objet caché ({ mot, recit }) — transmis tel quel au guide vocal.
  secret: { type: Object, default: null },
  // Sans identifiant, pas d'agent vocal temps réel : la session xAI se noue
  // autour d'une pièce précise, dont le serveur charge le dossier.
  objectId: { type: [String, Number], default: null },
  tenantId: { type: [String, Number], default: null }
})
defineEmits(['update:visible'])

// iPadOS 13+ se déclare « Macintosh » : sans le test tactile, un iPad serait
// traité comme un ordinateur de bureau et perdrait l'accès à Quick Look.
const estIOS = computed(() => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)
})

const usdzSeul = computed(() => !props.src && !!props.iosSrc)

// <model-viewer> pese 1 Mo : on ne le telecharge qu'a l'ouverture reelle du
// dialogue, et seulement s'il y a un GLB a afficher. Un objet n'ayant qu'un
// USDZ passe par Quick Look et n'en a aucun besoin.
watch(() => props.visible, (ouvert) => {
  if (ouvert && props.src) chargerModelViewer().catch(() => {})
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
  <Dialog
    :visible="visible"
    modal
    :header="title || $t('viewer3d.defaultTitle')"
    :style="{ width: '46rem', maxWidth: '95vw' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="viewer3d">
      <!-- Cas nominal : un GLB à afficher. `ios-src` bascule Quick Look sur iPhone. -->
      <template v-if="src">
        <!-- `position: relative` : le robot se place en absolu DANS le cadre du
             modèle, pas dans celui du dialogue. -->
        <div class="viewer3d__scene">
          <model-viewer
            :src="src"
            :ios-src="iosSrc || undefined"
            camera-controls
            auto-rotate
            ar
            ar-modes="webxr scene-viewer quick-look"
            ar-scale="auto"
            shadow-intensity="1"
            touch-action="pan-y"
            style="width: 100%; height: 440px; background: #f0ece4; border-radius: 12px"
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

        <Message severity="warn" :closable="false" class="viewer3d__conseil">
          {{ $t('viewer3d.needGlb') }}
        </Message>
      </template>

      <div v-else class="viewer3d__empty">
        <i class="pi pi-box" />
        <p>{{ $t('viewer3d.empty') }}</p>
        <small>{{ $t('viewer3d.emptyHint') }}</small>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.viewer3d__scene { position: relative; }

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
